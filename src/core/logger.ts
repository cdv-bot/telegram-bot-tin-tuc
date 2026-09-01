import pino from 'pino';
import fs from 'fs';
import path from 'path';
import { PATHS } from './env.js';
import type { DeliveryLog } from './types.js';

// Đảm bảo thư mục logs và data tồn tại
if (!fs.existsSync(PATHS.logs)) {
  fs.mkdirSync(PATHS.logs, { recursive: true });
}
if (!fs.existsSync(PATHS.data)) {
  fs.mkdirSync(PATHS.data, { recursive: true });
}

const getTodayDateString = () => new Date().toISOString().slice(0, 10);
const logFilePath = path.join(PATHS.logs, `app-${getTodayDateString()}.log`);
const fileStream = fs.createWriteStream(logFilePath, { flags: 'a' });

export const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  pino.multistream([
    { stream: process.stdout },
    { stream: fileStream },
  ])
);

const deliveryLogFilePath = path.join(PATHS.logs, 'delivery.log');

export function logDeliveryResult(logData: DeliveryLog) {
  const logLine = JSON.stringify(logData) + '\n';
  fs.appendFileSync(deliveryLogFilePath, logLine, 'utf8');

  if (logData.status === 'SUCCESS') {
    logger.info(
      logData,
      `[DELIVERY SUCCESS] [Job: ${logData.jobId}] Đã gửi thành công tới ${logData.targetChatId} (${logData.durationMs}ms)`
    );
  } else if (logData.status === 'RETRYING') {
    logger.warn(
      logData,
      `[DELIVERY RETRYING] [Job: ${logData.jobId}] Lần thử ${logData.retryAttempt}/${logData.maxRetries} thất bại. Đang chờ thử lại...`
    );
  } else {
    logger.error(
      logData,
      `[DELIVERY FAILED] [Job: ${logData.jobId}] Thất bại sau ${logData.retryAttempt} lần thử: ${logData.error}`
    );
  }
}
