import { botEngine } from './core/botEngine.js';
import { schedulerEngine } from './core/schedulerEngine.js';
import { logger } from './core/logger.js';
// Tự động nạp toàn bộ danh sách Jobs
import './jobs/index.js';

async function bootstrap() {
  logger.info('====================================================');
  logger.info('🚀 KHỞI ĐỘNG TELEGRAM AUTOMATION BOT ENGINE');
  logger.info('====================================================');

  // 1. Xác thực kết nối bot
  const check = await botEngine.verifyConnection();
  if (!check.success) {
    logger.error('❌ Không thể khởi động bot do lỗi xác thực. Vui lòng kiểm tra TELEGRAM_BOT_TOKEN trong .env');
    process.exit(1);
  }

  // 2. Khởi động Lập lịch cho toàn bộ Jobs
  schedulerEngine.start();

  // 3. Khởi động Bot Telegram & Lắng nghe lệnh
  await botEngine.start();

  // Xử lý dừng an toàn (Graceful Shutdown)
  const handleShutdown = (signal: string) => {
    logger.info(`Nhận tín hiệu ${signal}. Đang tắt dịch vụ an toàn...`);
    schedulerEngine.stop();
    botEngine.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => handleShutdown('SIGINT'));
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
}

bootstrap().catch((error) => {
  logger.error({ error }, 'Lỗi nghiêm trọng khi khởi động');
  process.exit(1);
});
