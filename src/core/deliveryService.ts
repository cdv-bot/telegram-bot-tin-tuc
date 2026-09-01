import type { Bot } from 'grammy';
import { getConfig } from './env.js';
import { logger, logDeliveryResult } from './logger.js';
import type { DeliveryOptions } from './types.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function splitMessageToSafeChunks(text: string, maxChunkSize: number = 3900): string[] {
  if (text.length <= maxChunkSize) {
    return [text];
  }

  const chunks: string[] = [];
  const lines = text.split('\n');
  let currentChunk = '';

  for (const line of lines) {
    if (currentChunk.length + line.length + 1 > maxChunkSize) {
      chunks.push(currentChunk);
      currentChunk = line + '\n';
    } else {
      currentChunk += line + '\n';
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

export function formatAdminAlertHtml(jobId: string, errorMsg: string, attemptCount: number): string {
  return `⚠️ <b>[CẢNH BÁO HỆ THỐNG - JOB: ${escapeHtml(jobId)}]</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `• <b>Trạng thái</b>: Gửi tin thất bại sau <b>${attemptCount}</b> lần thử.\n` +
    `• <b>Chi tiết lỗi</b>: <code>${escapeHtml(errorMsg)}</code>\n` +
    `• <b>Thời gian</b>: ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}\n` +
    `Vui lòng kiểm tra log hệ thống để xử lý sự cố.`;
}

/**
 * Bộ gửi tin đa năng: Hỗ trợ tự động phân đoạn tin dài, retry 3 lần x 5 phút, logging và cảnh báo admin
 */
export async function sendMessagesWithRetry(
  bot: Bot,
  jobId: string,
  messages: string | string[],
  options: DeliveryOptions = {}
): Promise<{ success: boolean; attempts: number; error?: string }> {
  const config = getConfig();
  const targetChatId = options.customChatId || config.TELEGRAM_CHAT_ID;
  const maxRetries = options.overrideMaxRetries ?? config.MAX_RETRIES;
  const retryDelayMs = options.overrideRetryDelayMs ?? config.RETRY_DELAY_MS;

  const rawList = Array.isArray(messages) ? messages : [messages];
  // Phân nhỏ từng tin nếu bị quá dài
  const messageChunks: string[] = [];
  for (const item of rawList) {
    messageChunks.push(...splitMessageToSafeChunks(item));
  }

  let attempt = 0;
  let lastError: string = '';

  while (attempt <= maxRetries) {
    const startTime = Date.now();
    try {
      logger.info(
        `[Job: ${jobId}] [Lần ${attempt + 1}/${maxRetries + 1}] Đang gửi ${messageChunks.length} tin tới Chat ID: ${targetChatId}`
      );

      for (const chunk of messageChunks) {
        await bot.api.sendMessage(targetChatId, chunk, {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
        });
      }

      const durationMs = Date.now() - startTime;
      logDeliveryResult({
        timestamp: new Date().toISOString(),
        jobId,
        targetChatId,
        status: 'SUCCESS',
        retryAttempt: attempt,
        maxRetries,
        durationMs,
      });

      return { success: true, attempts: attempt + 1 };
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      lastError = error?.message || String(error);
      attempt++;

      if (attempt <= maxRetries) {
        logDeliveryResult({
          timestamp: new Date().toISOString(),
          jobId,
          targetChatId,
          status: 'RETRYING',
          retryAttempt: attempt,
          maxRetries,
          durationMs,
          error: lastError,
        });

        logger.warn(
          `⚠️ [Job: ${jobId}] Gửi tin thất bại lần ${attempt}. Sẽ tự động thử lại sau ${Math.round(
            retryDelayMs / 1000
          )}s... Lỗi: ${lastError}`
        );

        await sleep(retryDelayMs);
      } else {
        logDeliveryResult({
          timestamp: new Date().toISOString(),
          jobId,
          targetChatId,
          status: 'FAILED',
          retryAttempt: attempt,
          maxRetries,
          durationMs,
          error: lastError,
        });

        logger.error(`❌ [Job: ${jobId}] Gửi tin thất bại hoàn toàn sau ${attempt} lần thử. Lỗi: ${lastError}`);

        if (config.TELEGRAM_ADMIN_CHAT_ID) {
          try {
            await bot.api.sendMessage(
              config.TELEGRAM_ADMIN_CHAT_ID,
              formatAdminAlertHtml(jobId, lastError, attempt),
              { parse_mode: 'HTML' }
            );
          } catch (adminErr) {
            logger.error({ adminErr }, 'Không thể gửi cảnh báo tới Admin Chat ID');
          }
        }

        return { success: false, attempts: attempt, error: lastError };
      }
    }
  }

  return { success: false, attempts: attempt, error: lastError };
}
