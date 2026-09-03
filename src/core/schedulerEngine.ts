import { Cron } from 'croner';
import type { Bot } from 'grammy';
import { getConfig } from './env.js';
import { logger } from './logger.js';
import { sendMessagesWithRetry } from './deliveryService.js';
import { jobRegistry } from './jobRegistry.js';
import type { BotJob, JobContext, JobResult, DeliveryOptions } from './types.js';

export class SchedulerEngine {
  private cronInstances: Map<string, Cron> = new Map();
  private runningJobs: Set<string> = new Set();
  private bot: Bot | null = null;
  private forexBot: Bot | null = null;

  setBot(bot: Bot) {
    this.bot = bot;
  }

  setForexBot(forexBot: Bot) {
    this.forexBot = forexBot;
  }

  /**
   * Thực thi một Job cụ thể kèm toàn bộ pipeline (Run logic -> Format -> Gửi với Retry -> Ghi log)
   */
  async executeJob(
    job: BotJob,
    options: DeliveryOptions & { triggerType?: 'CRON' | 'MANUAL_CLI' | 'BOT_COMMAND' } = {}
  ): Promise<{ success: boolean; error?: string; durationMs: number }> {
    if (this.runningJobs.has(job.id)) {
      logger.warn(`⚠️ [Job: ${job.id}] Đang có một phiên chạy, bỏ qua kích hoạt trùng lặp.`);
      return { success: false, error: 'JOB_ALREADY_RUNNING', durationMs: 0 };
    }

    const botToUse = (job.botType === 'FOREX' && this.forexBot) ? this.forexBot : (this.bot || this.forexBot);

    if (!botToUse) {
      throw new Error('Bot instance chưa được thiết lập trong SchedulerEngine.');
    }

    this.runningJobs.add(job.id);
    const startTime = Date.now();
    const config = getConfig();
    let jobDefaultChatId: string | number | undefined;
    if (typeof job.targetChatId === 'function') {
      jobDefaultChatId = job.targetChatId(config);
    } else if (job.targetChatId) {
      jobDefaultChatId = job.targetChatId;
    }
    const targetChatId = options.customChatId || jobDefaultChatId || config.TELEGRAM_CHAT_ID;
    const triggerType = options.triggerType || 'CRON';

    logger.info(`🚀 [Job: ${job.id}] Bắt đầu thực thi (Kích hoạt bởi: ${triggerType})...`);

    const ctx: JobContext = {
      bot: botToUse,
      logger,
      targetChatId,
      triggerType,
    };

    try {
      // 1. Thực thi logic nghiệp vụ của Job
      const output = await job.run(ctx);

      let messagesToSend: string[] = [];
      let skipDelivery = false;

      if (typeof output === 'string') {
        messagesToSend = [output];
      } else if (Array.isArray(output)) {
        messagesToSend = output;
      } else if (output && typeof output === 'object') {
        const res = output as JobResult;
        if (res.skipDelivery) {
          skipDelivery = true;
        } else if (res.message) {
          messagesToSend = Array.isArray(res.message) ? res.message : [res.message];
        }
      }

      // 2. Gửi tin qua Telegram với Retry nếu có nội dung tin nhắn
      if (!skipDelivery && messagesToSend.length > 0) {
        const deliveryResult = await sendMessagesWithRetry(
          botToUse,
          job.id,
          messagesToSend,
          {
            customChatId: targetChatId,
            overrideMaxRetries: job.retryConfig?.maxRetries ?? options.overrideMaxRetries,
            overrideRetryDelayMs: job.retryConfig?.retryDelayMs ?? options.overrideRetryDelayMs,
          }
        );

        const durationMs = Date.now() - startTime;
        return {
          success: deliveryResult.success,
          error: deliveryResult.error,
          durationMs,
        };
      }

      const durationMs = Date.now() - startTime;
      return { success: true, durationMs };
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      const errorMsg = error?.message || String(error);
      logger.error({ error: errorMsg, jobId: job.id }, `Lỗi nghiêm trọng khi thực thi Job ${job.id}`);
      return { success: false, error: errorMsg, durationMs };
    } finally {
      this.runningJobs.delete(job.id);
    }
  }

  /**
   * Kích hoạt chạy một Job theo ID
   */
  async executeJobById(jobId: string, options: DeliveryOptions = {}) {
    const job = jobRegistry.get(jobId);
    if (!job) {
      throw new Error(`Không tìm thấy Job có ID: "${jobId}"`);
    }
    return this.executeJob(job, { ...options, triggerType: 'MANUAL_CLI' });
  }

  /**
   * Khởi động lập lịch cho tất cả các Jobs đang được kích hoạt
   */
  start() {
    const config = getConfig();
    const jobs = jobRegistry.getEnabled();

    logger.info(`Đang kiểm tra và thiết lập lịch trình tự động cho ${jobs.length} Jobs...`);

    for (const job of jobs) {
      if (job.autoSchedule === false || !job.cronSchedule) {
        logger.info(`ℹ️ [Job: ${job.id}] "${job.name}" -> Tắt tự động gửi (Chỉ chạy thủ công / Lệnh Bot)`);
        continue;
      }

      const timezone = job.timezone || config.TIMEZONE;

      const cron = new Cron(
        job.cronSchedule,
        {
          timezone,
          name: `Job_${job.id}`,
        },
        async () => {
          logger.info(`⏰ [CRON TRIGGER] Kích hoạt tự động Job [${job.id}] theo lịch ${job.cronSchedule}`);
          await this.executeJob(job, { triggerType: 'CRON' });
        }
      );

      this.cronInstances.set(job.id, cron);
      const next = cron.nextRun();
      logger.info(
        `✅ [Job: ${job.id}] "${job.name}" -> Cron: "${job.cronSchedule}" | Tiếp theo: ${
          next ? next.toLocaleString('vi-VN', { timeZone: timezone }) : 'N/A'
        }`
      );
    }
  }

  /**
   * Dừng toàn bộ các lịch trình
   */
  stop() {
    for (const [id, cron] of this.cronInstances.entries()) {
      cron.stop();
      logger.debug(`Đã dừng lịch Job [${id}]`);
    }
    this.cronInstances.clear();
    logger.info('Đã dừng toàn bộ lịch trình Cron.');
  }

  getJobScheduleInfo() {
    const config = getConfig();
    return jobRegistry.getEnabled().map((job) => {
      const cron = this.cronInstances.get(job.id);
      const nextRun = cron?.nextRun();
      const isAuto = job.autoSchedule !== false && !!job.cronSchedule;
      return {
        id: job.id,
        name: job.name,
        command: job.command,
        cron: isAuto ? job.cronSchedule! : 'Không tự động (Chạy qua lệnh Bot)',
        nextRun: isAuto && nextRun
          ? nextRun.toLocaleString('vi-VN', { timeZone: job.timezone || config.TIMEZONE })
          : 'Thủ công (Chỉ chạy khi có lệnh)',
      };
    });
  }
}

export const schedulerEngine = new SchedulerEngine();
