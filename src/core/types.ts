import type { Bot } from 'grammy';
import type { Logger } from 'pino';

export interface JobContext {
  bot: Bot;
  logger: Logger;
  targetChatId: string | number;
  triggerType: 'CRON' | 'MANUAL_CLI' | 'BOT_COMMAND';
  customArgs?: string[];
}

export interface JobResult {
  message?: string | string[];
  success?: boolean;
  articlesCount?: number;
  data?: Record<string, any>;
  skipDelivery?: boolean; // If true, job handles custom delivery itself
}

export interface JobRetryConfig {
  maxRetries?: number;
  retryDelayMs?: number;
}

export interface BotJob {
  id: string;
  name: string;
  description: string;
  cronSchedule?: string; // e.g. "0 7 * * *"
  timezone?: string;
  command?: string; // e.g. "digest" -> triggers on /digest
  targetChatId?: string | number | ((config: any) => string | number | undefined);
  botType?: 'MAIN' | 'FOREX';
  enabled?: boolean;
  autoSchedule?: boolean; // false nếu không muốn tự động gửi theo lịch Cron
  retryConfig?: JobRetryConfig;
  run: (ctx: JobContext) => Promise<string | string[] | JobResult | void>;
}

export interface DeliveryLog {
  timestamp: string;
  jobId: string;
  targetChatId: string | number;
  status: 'SUCCESS' | 'FAILED' | 'RETRYING';
  retryAttempt: number;
  maxRetries: number;
  durationMs: number;
  error?: string;
}

export interface DeliveryOptions {
  customChatId?: string | number;
  customBot?: Bot;
  overrideRetryDelayMs?: number;
  overrideMaxRetries?: number;
}
