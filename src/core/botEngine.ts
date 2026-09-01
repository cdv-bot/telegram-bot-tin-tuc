import { Bot } from 'grammy';
import { getConfig } from './env.js';
import { logger } from './logger.js';
import { jobRegistry } from './jobRegistry.js';
import { schedulerEngine } from './schedulerEngine.js';

export class BotEngine {
  private bot: Bot | null = null;
  private healthIntervalId: NodeJS.Timeout | null = null;

  getBot(): Bot {
    if (this.bot) return this.bot;
    const config = getConfig();
    this.bot = new Bot(config.TELEGRAM_BOT_TOKEN);
    schedulerEngine.setBot(this.bot);
    return this.bot;
  }

  async verifyConnection(): Promise<{ success: boolean; botInfo?: any; error?: string }> {
    try {
      const bot = this.getBot();
      const botInfo = await bot.api.getMe();
      logger.info(`✅ Xác thực Telegram Bot thành công: @${botInfo.username} (ID: ${botInfo.id})`);
      return { success: true, botInfo };
    } catch (error: any) {
      const message = error?.message || String(error);
      logger.error({ error: message }, '❌ Không thể kết nối hoặc xác thực Telegram Bot');
      return { success: false, error: message };
    }
  }

  startPeriodicHealthCheck(intervalMs?: number) {
    const config = getConfig();
    const interval = intervalMs || config.HEALTH_CHECK_INTERVAL_MS;

    logger.info(`Đã kích hoạt giám sát kết nối định kỳ (chu kỳ: ${Math.round(interval / 60000)} phút)`);

    this.healthIntervalId = setInterval(async () => {
      logger.debug('Đang kiểm tra kết nối định kỳ tới Telegram API...');
      const result = await this.verifyConnection();
      if (!result.success) {
        logger.warn(`⚠️ Cảnh báo: Định kỳ kiểm tra kết nối Telegram thất bại: ${result.error}`);
      }
    }, interval);
  }

  /**
   * Tự động đăng ký các lệnh Telegram Bot từ danh sách Jobs
   */
  registerCommands() {
    const bot = this.getBot();
    const config = getConfig();

    // 1. Tự động ánh xạ lệnh cho từng Job
    const enabledJobs = jobRegistry.getEnabled();
    for (const job of enabledJobs) {
      if (job.command) {
        const cmdName = job.command.replace(/^\//, '');
        bot.command(cmdName, async (ctx) => {
          await ctx.reply(`⏳ Đang thực thi tính năng: <b>${job.name}</b>...`, { parse_mode: 'HTML' });
          const result = await schedulerEngine.executeJob(job, {
            customChatId: ctx.chat.id,
            triggerType: 'BOT_COMMAND',
          });
          if (!result.success) {
            await ctx.reply(`❌ Có lỗi khi thực thi: ${result.error || 'Không xác định'}`);
          }
        });
        logger.debug(`Đã đăng ký lệnh Telegram: /${cmdName} -> Job [${job.id}]`);
      }
    }

    // 2. Lệnh /start và /help
    bot.command(['start', 'help'], async (ctx) => {
      let msg = `👋 <b>Chào mừng bạn đến với Telegram Automation Bot!</b>\n━━━━━━━━━━━━━━━━━━━━\n\n`;
      msg += `📋 <b>Danh sách tính năng & Lệnh khả dụng:</b>\n`;

      for (const j of jobRegistry.getEnabled()) {
        const cmdStr = j.command ? `/${j.command}` : '(Chạy theo lịch)';
        msg += `• <b>${cmdStr}</b>: ${j.name}\n  <i>${j.description} (Lịch: <code>${j.cronSchedule}</code>)</i>\n`;
      }

      msg += `\n⚙️ <b>Lệnh hệ thống:</b>\n`;
      msg += `• /status - Xem trạng thái hệ thống và lịch chạy tiếp theo\n`;
      msg += `• /help - Xem hướng dẫn này\n`;

      await ctx.reply(msg, { parse_mode: 'HTML' });
    });

    // 3. Lệnh /status
    bot.command('status', async (ctx) => {
      const uptimeHours = (process.uptime() / 3600).toFixed(2);
      const scheduleInfo = schedulerEngine.getJobScheduleInfo();

      let msg = `📊 <b>TRẠNG THÁI HỆ THỐNG</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `• <b>Trạng thái</b>: 🟢 Hoạt động bình thường\n`;
      msg += `• <b>Uptime</b>: ${uptimeHours} giờ\n`;
      msg += `• <b>Timezone</b>: ${config.TIMEZONE}\n`;
      msg += `• <b>Số Jobs đang chạy</b>: ${scheduleInfo.length}\n\n`;
      msg += `📅 <b>Lịch trình các tác vụ:</b>\n`;

      for (const info of scheduleInfo) {
        msg += `• <b>${info.name}</b>\n  ⏰ Cron: <code>${info.cron}</code> | Kế tiếp: <i>${info.nextRun}</i>\n`;
      }

      await ctx.reply(msg, { parse_mode: 'HTML' });
    });
  }

  async start() {
    this.registerCommands();
    this.startPeriodicHealthCheck();

    logger.info('🚀 Đang chạy Telegram Bot Long Polling...');
    this.getBot().start({
      onStart: (botInfo) => {
        logger.info(`🤖 Bot @${botInfo.username} đã sẵn sàng phục vụ.`);
      },
    });
  }

  stop() {
    if (this.healthIntervalId) {
      clearInterval(this.healthIntervalId);
    }
    if (this.bot) {
      this.bot.stop();
    }
  }
}

export const botEngine = new BotEngine();
