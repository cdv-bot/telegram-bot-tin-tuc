import dotenv from 'dotenv';
import { z } from 'zod';
import path from 'path';

dotenv.config();

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required in .env'),
  TELEGRAM_FOREX_BOT_TOKEN: z.string().optional().default(''),
  TELEGRAM_CHAT_ID: z.string().min(1, 'TELEGRAM_CHAT_ID is required in .env'),
  TELEGRAM_ADMIN_CHAT_ID: z.string().optional().default(''),
  TELEGRAM_FOREX_CHAT_ID: z.string().optional().default(''),
  TELEGRAM_TRADING_CHAT_ID: z.string().optional().default(''),
  TELEGRAM_GITHUB_CHAT_ID: z.string().optional().default(''),
  TELEGRAM_NEWS_CHAT_ID: z.string().optional().default(''),
  TELEGRAM_GOLD_CHAT_ID: z.string().optional().default(''),
  CRON_SCHEDULE: z.string().default('30 6 * * *'),
  TIMEZONE: z.string().default('Asia/Ho_Chi_Minh'),
  MAX_RETRIES: z.coerce.number().default(3),
  RETRY_DELAY_MS: z.coerce.number().default(300000), // 5 minutes
  HEALTH_CHECK_INTERVAL_MS: z.coerce.number().default(1800000), // 30 minutes
  GEMINI_API_KEY: z.string().optional().default(''),
  OPENAI_API_KEY: z.string().optional().default(''),
  NINE_ROUTER_API_KEY: z.string().optional().default(''),
  NINE_ROUTER_BASE_URL: z.string().default('http://127.0.0.1:20128/v1'),
  NINE_ROUTER_MODEL: z.string().default('ag/gemini-3.7-flash-medium'),
  MAX_ARTICLES_PER_DIGEST: z.coerce.number().default(8),
  LOG_LEVEL: z.string().default('info'),
  TWELVE_DATA_API_KEY: z.string().optional().default('f14e12fd8f84461bbba9c981dbb46ba4'),
  TWELVE_DATA_WS_URL: z.string().default('wss://ws.twelvedata.com/v1/quotes/price'),
});

export type EnvConfig = z.infer<typeof envSchema>;

let cachedConfig: EnvConfig | null = null;

export function getConfig(): EnvConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const errorDetails = parsed.error.issues
      .map((issue) => ` - [${issue.path.join('.')}]: ${issue.message}`)
      .join('\n');
    console.error(`\n❌ [Config Error] Biến môi trường không hợp lệ:\n${errorDetails}\n`);
    console.error('👉 Vui lòng tạo file .env từ .env.example và điền các thông tin cần thiết.\n');
    throw new Error(`Invalid environment variables:\n${errorDetails}`);
  }

  cachedConfig = parsed.data;
  return cachedConfig;
}

export const PATHS = {
  root: process.cwd(),
  logs: path.resolve(process.cwd(), 'logs'),
  data: path.resolve(process.cwd(), 'data'),
  sourcesConfig: path.resolve(process.cwd(), 'config', 'sources.json'),
};
