import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { PATHS } from './env.js';
import { logger } from './logger.js';

const dbPath = path.join(PATHS.data, 'bot.sqlite');

if (!fs.existsSync(PATHS.data)) {
  fs.mkdirSync(PATHS.data, { recursive: true });
}

// Cấu hình timeout 10 giây để an toàn đa tiến trình (multi-process / test runners)
export const db: Database.Database = new Database(dbPath, {
  timeout: 10000,
});

try {
  // Tối ưu hiệu năng đọc ghi đồng thời với chế độ WAL (Write-Ahead Logging)
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 10000');
} catch (e: any) {
  // Tránh lỗi khi nhiều worker cùng cấu hình pragma
}

// Khởi tạo các bảng
db.exec(`
  CREATE TABLE IF NOT EXISTS tracked_orders (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    order_type TEXT NOT NULL,
    entry REAL NOT NULL,
    tp REAL,
    sl REAL,
    reward REAL,
    risk REAL,
    risk_reward_ratio REAL,
    tp_percent REAL,
    sl_percent REAL,
    status TEXT NOT NULL,
    initial_market_price REAL,
    last_checked_price REAL,
    fill_price REAL,
    close_price REAL,
    created_at TEXT NOT NULL,
    filled_at TEXT,
    closed_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_orders_status ON tracked_orders(status);
  CREATE INDEX IF NOT EXISTS idx_orders_chat_id ON tracked_orders(chat_id);

  CREATE TABLE IF NOT EXISTS news_history (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    sent_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_news_sent_at ON news_history(sent_at);
`);

/**
 * Tự động di chuyển dữ liệu cũ từ JSON sang SQLite nếu có
 */
function migrateFromJsonIfNecessary() {
  try {
    // 1. Migrate limit_orders.json
    const limitOrdersPath = path.join(PATHS.data, 'limit_orders.json');
    if (fs.existsSync(limitOrdersPath)) {
      const raw = fs.readFileSync(limitOrdersPath, 'utf-8').trim();
      if (raw && raw !== '[]' && raw !== '{}') {
        const orders = JSON.parse(raw);
        if (Array.isArray(orders) && orders.length > 0) {
          const insertOrder = db.prepare(`
            INSERT OR IGNORE INTO tracked_orders (
              id, chat_id, symbol, order_type, entry, tp, sl,
              reward, risk, risk_reward_ratio, tp_percent, sl_percent,
              status, initial_market_price, last_checked_price, fill_price, close_price,
              created_at, filled_at, closed_at
            ) VALUES (
              @id, @chatId, @symbol, @orderType, @entry, @tp, @sl,
              @reward, @risk, @riskRewardRatio, @tpPercent, @slPercent,
              @status, @initialMarketPrice, @lastCheckedPrice, @fillPrice, @closePrice,
              @createdAt, @filledAt, @closedAt
            )
          `);

          const insertMany = db.transaction((list: any[]) => {
            for (const item of list) {
              insertOrder.run({
                id: item.id,
                chatId: String(item.chatId),
                symbol: item.symbol || 'XAU/USD',
                orderType: item.orderType,
                entry: item.entry,
                tp: item.tp ?? null,
                sl: item.sl ?? null,
                reward: item.reward ?? null,
                risk: item.risk ?? null,
                riskRewardRatio: item.riskRewardRatio ?? null,
                tpPercent: item.tpPercent ?? null,
                slPercent: item.slPercent ?? null,
                status: item.status,
                initialMarketPrice: item.initialMarketPrice ?? null,
                lastCheckedPrice: item.lastCheckedPrice ?? null,
                fillPrice: item.fillPrice ?? null,
                closePrice: item.closePrice ?? null,
                createdAt: item.createdAt || new Date().toISOString(),
                filledAt: item.filledAt ?? null,
                closedAt: item.closedAt ?? null,
              });
            }
          });

          insertMany(orders);
          logger.info(`✅ Đã migrate thành công ${orders.length} lệnh từ limit_orders.json vào SQLite.`);
        }
      }
    }

    // 2. Migrate history.json
    const historyPath = path.join(PATHS.data, 'history.json');
    if (fs.existsSync(historyPath)) {
      const raw = fs.readFileSync(historyPath, 'utf-8').trim();
      if (raw && raw !== '[]' && raw !== '{}') {
        const history = JSON.parse(raw);
        if (Array.isArray(history) && history.length > 0) {
          const insertHistory = db.prepare(`
            INSERT OR IGNORE INTO news_history (id, url, title, sent_at)
            VALUES (@id, @url, @title, @sentAt)
          `);

          const insertMany = db.transaction((list: any[]) => {
            for (const item of list) {
              insertHistory.run({
                id: item.id,
                url: item.url,
                title: item.title,
                sentAt: item.sentAt || new Date().toISOString(),
              });
            }
          });

          insertMany(history);
          logger.info(`✅ Đã migrate thành công ${history.length} bài báo từ history.json vào SQLite.`);
        }
      }
    }
  } catch (err: any) {
    logger.error({ error: err.message }, 'Lỗi trong quá trình migrate dữ liệu từ JSON sang SQLite');
  }
}

migrateFromJsonIfNecessary();
