import initSqlJs, { type Database as SqlJsDb, type SqlJsStatic, type Statement as SqlJsStmt } from 'sql.js';
import path from 'path';
import fs from 'fs';
import { PATHS } from './env.js';
import { logger } from './logger.js';

const dbPath = path.join(PATHS.data, 'bot.sqlite');

if (!fs.existsSync(PATHS.data)) {
  fs.mkdirSync(PATHS.data, { recursive: true });
}

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface StatementWrapper {
  run(...params: unknown[]): RunResult;
  run(params: Record<string, unknown>): RunResult;
  all(...params: unknown[]): unknown[];
  all(params: Record<string, unknown>): unknown[];
  get(...params: unknown[]): unknown;
  get(params: Record<string, unknown>): unknown;
}

export interface DatabaseInstance {
  pragma(_sql: string): unknown;
  exec(sql: string): void;
  prepare(sql: string): StatementWrapper;
  transaction<T extends (...args: any[]) => any>(fn: T): T;
  close(): void;
}

export namespace Database {
  export type Database = DatabaseInstance;
}

let SQL: SqlJsStatic | null = null;

function getSqlJs(): SqlJsStatic {
  if (!SQL) {
    throw new Error('sql.js chưa được khởi tạo. Hãy đảm bảo initDatabase() đã chạy.');
  }
  return SQL;
}

function convertNamedBindParams(
  raw: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    out[`$${key}`] = value;
  }
  return out;
}

function rowsToObjects(stmt: SqlJsStmt, columnNames: string[]): unknown[] {
  const rows: unknown[] = [];
  while (stmt.step()) {
    const values = stmt.get();
    const row: Record<string, unknown> = {};
    for (let i = 0; i < columnNames.length; i++) {
      row[columnNames[i]!] = values[i];
    }
    rows.push(row);
  }
  return rows;
}

class SqlJsCompatibleDatabase implements DatabaseInstance {
  private db: SqlJsDb;
  private filePath: string;
  private saveTimer: NodeJS.Timeout | null = null;
  private pendingSave = false;

  constructor(db: SqlJsDb, filePath: string) {
    this.db = db;
    this.filePath = filePath;
  }

  pragma(_sql: string): unknown {
    return [];
  }

  exec(sql: string): void {
    this.db.exec(sql);
    this.requestSave();
  }

  prepare(sql: string): StatementWrapper {
    const self = this;
    const convertedSql = sql.replace(/@(\w+)/g, '$$$1');

    function resolveBindArgs(args: unknown[]): unknown[] | Record<string, unknown> | undefined {
      if (args.length === 0) return undefined;
      if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0])) {
        return convertNamedBindParams(args[0] as Record<string, unknown>);
      }
      return args;
    }

    function runInternal(stmt: SqlJsStmt, args: unknown[]): RunResult {
      const binds = resolveBindArgs(args);
      try {
        if (binds !== undefined) {
          stmt.bind(binds as any);
        }
        stmt.step();
      } catch (e) {
        stmt.free();
        throw e;
      }

      const changes = self.db.getRowsModified();
      let lastInsertRowid: number | bigint = 0;
      try {
        const res = self.db.exec('SELECT last_insert_rowid() AS lid');
        const raw = res[0]?.values?.[0]?.[0];
        if (typeof raw === 'number' || typeof raw === 'bigint') {
          lastInsertRowid = raw;
        } else if (typeof raw === 'string') {
          lastInsertRowid = Number(raw);
        }
      } catch {}

      stmt.free();
      self.requestSave();
      return { changes, lastInsertRowid };
    }

    function allInternal(stmt: SqlJsStmt, args: unknown[]): unknown[] {
      const binds = resolveBindArgs(args);
      try {
        if (binds !== undefined) {
          stmt.bind(binds as any);
        }
        const cols = stmt.getColumnNames();
        const rows = rowsToObjects(stmt, cols);
        return rows;
      } finally {
        stmt.free();
      }
    }

    function getInternal(stmt: SqlJsStmt, args: unknown[]): unknown {
      const binds = resolveBindArgs(args);
      try {
        if (binds !== undefined) {
          stmt.bind(binds as any);
        }
        if (!stmt.step()) {
          return undefined;
        }
        const cols = stmt.getColumnNames();
        const values = stmt.get();
        const row: Record<string, unknown> = {};
        for (let i = 0; i < cols.length; i++) {
          row[cols[i]!] = values[i];
        }
        return row;
      } finally {
        stmt.free();
      }
    }

    return {
      run(...args: unknown[]): RunResult {
        const stmt = self.db.prepare(convertedSql);
        return runInternal(stmt, args);
      },
      all(...args: unknown[]): unknown[] {
        const stmt = self.db.prepare(convertedSql);
        return allInternal(stmt, args);
      },
      get(...args: unknown[]): unknown {
        const stmt = self.db.prepare(convertedSql);
        return getInternal(stmt, args);
      },
    };
  }

  transaction<T extends (...args: any[]) => any>(fn: T): T {
    const self = this;
    const wrapped = function (this: unknown, ...args: Parameters<T>): ReturnType<T> {
      self.db.exec('BEGIN');
      try {
        const result = fn.apply(this, args);
        self.db.exec('COMMIT');
        self.requestSave();
        return result;
      } catch (e) {
        try {
          self.db.exec('ROLLBACK');
        } catch {}
        throw e;
      }
    } as T;
    return wrapped;
  }

  private requestSave(): void {
    this.pendingSave = true;
    if (this.saveTimer) {
      return;
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (this.pendingSave) {
        this.flushSave();
      }
    }, 50);
  }

  private flushSave(): void {
    this.pendingSave = false;
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, buffer);
      fs.renameSync(tmp, this.filePath);
    } catch (e: any) {
      logger.error({ error: e?.message }, 'Lỗi lưu database sql.js vào đĩa');
    }
  }

  close(): void {
    this.flushSave();
    try {
      this.db.close();
    } catch {}
  }
}

function loadExistingDbBytes(): Uint8Array | undefined {
  try {
    if (fs.existsSync(dbPath)) {
      const buf = fs.readFileSync(dbPath);
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
  } catch (e: any) {
    logger.warn({ error: e?.message }, 'Không thể đọc file database cũ, sẽ tạo mới.');
  }
  return undefined;
}

SQL = await initSqlJs();

const existingBytes = loadExistingDbBytes();
const rawDb: SqlJsDb = existingBytes ? new SQL.Database(existingBytes) : new SQL.Database();

export const db: Database.Database = new SqlJsCompatibleDatabase(rawDb, dbPath);

try {
  db.exec('PRAGMA journal_mode = WAL');
} catch {}
try {
  db.exec('PRAGMA synchronous = NORMAL');
} catch {}
try {
  db.exec('PRAGMA busy_timeout = 10000');
} catch {}

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

function migrateFromJsonIfNecessary() {
  try {
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

    const historyPath = path.join(PATHS.data, 'history.json');
    if (fs.existsSync(historyPath)) {
      const raw = fs.readFileSync(historyPath, 'utf-8').trim();
      if (raw && raw !== '[]' && raw !== '{}') {
        const history = JSON.parse(raw);
        if (Array.isArray(history) && history.length > 0) {
          const insertHistory = db.prepare(`
            INSERT OR REPLACE INTO news_history (id, url, title, sent_at)
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
