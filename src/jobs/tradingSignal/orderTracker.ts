import type { Bot } from 'grammy';
import { logger } from '../../core/logger.js';
import { db } from '../../core/database.js';
import { twelveDataClient, type TwelveDataGoldQuote } from '../goldPrice/twelveDataClient.js';
import type { ParsedTradeOrder } from './parser.js';

export interface TrackedOrder extends ParsedTradeOrder {
  id: string;
  chatId: number | string;
  status: 'PENDING' | 'FILLED' | 'CLOSED_TP' | 'CLOSED_SL' | 'CANCELLED';
  createdAt: string;
  initialMarketPrice?: number;
  lastCheckedPrice?: number;
  filledAt?: string;
  closedAt?: string;
  fillPrice?: number;
  closePrice?: number;
}

interface OrderRow {
  id: string;
  chat_id: string;
  symbol: string;
  order_type: string;
  entry: number;
  tp: number | null;
  sl: number | null;
  reward: number | null;
  risk: number | null;
  risk_reward_ratio: number | null;
  tp_percent: number | null;
  sl_percent: number | null;
  status: 'PENDING' | 'FILLED' | 'CLOSED_TP' | 'CLOSED_SL' | 'CANCELLED';
  initial_market_price: number | null;
  last_checked_price: number | null;
  fill_price: number | null;
  close_price: number | null;
  created_at: string;
  filled_at: string | null;
  closed_at: string | null;
}

function rowToOrder(row: OrderRow): TrackedOrder {
  return {
    id: row.id,
    chatId: row.chat_id,
    symbol: row.symbol,
    orderType: row.order_type as any,
    entry: row.entry,
    tp: row.tp !== null ? row.tp : undefined,
    sl: row.sl !== null ? row.sl : undefined,
    reward: row.reward !== null ? row.reward : undefined,
    risk: row.risk !== null ? row.risk : undefined,
    riskRewardRatio: row.risk_reward_ratio !== null ? row.risk_reward_ratio : undefined,
    tpPercent: row.tp_percent !== null ? row.tp_percent : undefined,
    slPercent: row.sl_percent !== null ? row.sl_percent : undefined,
    status: row.status,
    initialMarketPrice: row.initial_market_price !== null ? row.initial_market_price : undefined,
    lastCheckedPrice: row.last_checked_price !== null ? row.last_checked_price : undefined,
    fillPrice: row.fill_price !== null ? row.fill_price : undefined,
    closePrice: row.close_price !== null ? row.close_price : undefined,
    createdAt: row.created_at,
    filledAt: row.filled_at !== null ? row.filled_at : undefined,
    closedAt: row.closed_at !== null ? row.closed_at : undefined,
  };
}

class OrderTracker {
  private bot: Bot | null = null;
  private isInitialized: boolean = false;
  private pollingIntervalId: NodeJS.Timeout | null = null;

  // Prepared statements để tối ưu tốc độ truy vấn SQLite
  private insertOrderStmt = db.prepare(`
    INSERT INTO tracked_orders (
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

  private updateLastCheckedPriceStmt = db.prepare(`
    UPDATE tracked_orders SET last_checked_price = ? WHERE id = ?
  `);

  private updateFillStatusStmt = db.prepare(`
    UPDATE tracked_orders
    SET status = 'FILLED',
        filled_at = @filledAt,
        fill_price = @fillPrice,
        last_checked_price = @lastCheckedPrice
    WHERE id = @id
  `);

  private updateCloseStatusStmt = db.prepare(`
    UPDATE tracked_orders
    SET status = @status,
        closed_at = @closedAt,
        close_price = @closePrice,
        last_checked_price = @lastCheckedPrice
    WHERE id = @id
  `);

  constructor() {
    this.initPriceListener();
    this.startPollingWatchdog();
  }

  public setBot(bot: Bot) {
    this.bot = bot;
  }

  private startPollingWatchdog() {
    if (this.pollingIntervalId) return;

    // Quét liên tục mỗi 1 giây (1000ms): Ưu tiên WebSocket Ticks -> Fallback Gold-API siêu tốc
    this.pollingIntervalId = setInterval(async () => {
      const active = this.getActiveOrders();
      if (active.length === 0) return;

      try {
        // 1. Nếu WebSocket đang nhận tick tươi (dưới 5s)
        const cached = twelveDataClient.getLatestCachedQuote();
        if (cached && typeof cached.price === 'number' && Date.now() - cached.timestamp < 5000) {
          await this.checkOrdersAgainstPrice(cached.price, cached.symbol);
          return;
        }

        // 2. Nếu WebSocket tạm thời im lặng, gọi Gold-API siêu tốc (timeout 2500ms)
        const axios = (await import('axios')).default;
        const res = await axios.get('https://api.gold-api.com/price/XAU', { timeout: 2500 });
        if (res.data && typeof res.data.price === 'number') {
          await this.checkOrdersAgainstPrice(res.data.price, 'XAU/USD');
        }
      } catch (err: any) {
        logger.debug({ error: err.message }, 'Lỗi trong polling watchdog');
      }
    }, 1000);
  }

  private initPriceListener() {
    if (this.isInitialized) return;
    this.isInitialized = true;

    twelveDataClient.onPriceTick((quote: TwelveDataGoldQuote) => {
      logger.info({ price: quote.price, symbol: quote.symbol, source: quote.source }, `⚡ [LIVE TICK] ${quote.symbol}: ${quote.price}`);
      this.checkOrdersAgainstPrice(quote.price, quote.symbol);
    });
  }

  public addOrder(order: ParsedTradeOrder, chatId: number | string): TrackedOrder {
    const id = `ORD-${Date.now().toString().slice(-6)}`;
    const currentCached = twelveDataClient.getLatestCachedQuote();
    const initialMarketPrice = currentCached?.price;
    const createdAt = new Date().toISOString();

    const tracked: TrackedOrder = {
      ...order,
      id,
      chatId,
      symbol: order.symbol || 'XAU/USD',
      status: 'PENDING',
      initialMarketPrice,
      lastCheckedPrice: initialMarketPrice,
      createdAt,
    };

    this.insertOrderStmt.run({
      id: tracked.id,
      chatId: String(tracked.chatId),
      symbol: tracked.symbol,
      orderType: tracked.orderType,
      entry: tracked.entry,
      tp: tracked.tp ?? null,
      sl: tracked.sl ?? null,
      reward: tracked.reward ?? null,
      risk: tracked.risk ?? null,
      riskRewardRatio: tracked.riskRewardRatio ?? null,
      tpPercent: tracked.tpPercent ?? null,
      slPercent: tracked.slPercent ?? null,
      status: tracked.status,
      initialMarketPrice: tracked.initialMarketPrice ?? null,
      lastCheckedPrice: tracked.lastCheckedPrice ?? null,
      fillPrice: null,
      closePrice: null,
      createdAt: tracked.createdAt,
      filledAt: null,
      closedAt: null,
    });

    logger.info({ id, type: tracked.orderType, entry: tracked.entry, initialMarketPrice }, '✅ Đã ghi nhận lệnh limit mới vào SQLite');
    return tracked;
  }

  public getActiveOrders(chatId?: number | string): TrackedOrder[] {
    let rows: OrderRow[];
    if (chatId) {
      rows = db.prepare(
        `SELECT * FROM tracked_orders WHERE (status = 'PENDING' OR status = 'FILLED') AND chat_id = ? ORDER BY created_at ASC`
      ).all(String(chatId)) as OrderRow[];
    } else {
      rows = db.prepare(
        `SELECT * FROM tracked_orders WHERE status = 'PENDING' OR status = 'FILLED' ORDER BY created_at ASC`
      ).all() as OrderRow[];
    }
    return rows.map(rowToOrder);
  }

  public cancelOrder(id: string, chatId?: number | string): boolean {
    const cleanId = id.trim().replace(/^[#]/, '').toLowerCase();
    const row = (chatId
      ? db.prepare(
          `SELECT * FROM tracked_orders WHERE (LOWER(id) = ? OR LOWER(id) = ? OR LOWER(id) LIKE ?) AND chat_id = ?`
        ).get(cleanId, `ord-${cleanId}`, `%${cleanId}`, String(chatId))
      : db.prepare(
          `SELECT * FROM tracked_orders WHERE (LOWER(id) = ? OR LOWER(id) = ? OR LOWER(id) LIKE ?)`
        ).get(cleanId, `ord-${cleanId}`, `%${cleanId}`)) as OrderRow | undefined;

    if (!row || row.status === 'CLOSED_TP' || row.status === 'CLOSED_SL' || row.status === 'CANCELLED') {
      return false;
    }

    db.prepare(`UPDATE tracked_orders SET status = 'CANCELLED', closed_at = ? WHERE id = ?`).run(
      new Date().toISOString(),
      row.id
    );
    return true;
  }

  public deleteOrder(id: string, chatId?: number | string): boolean {
    const cleanId = id.trim().replace(/^[#]/, '').toLowerCase();
    const result = chatId
      ? db.prepare(
          `DELETE FROM tracked_orders WHERE (LOWER(id) = ? OR LOWER(id) = ? OR LOWER(id) LIKE ?) AND chat_id = ?`
        ).run(cleanId, `ord-${cleanId}`, `%${cleanId}`, String(chatId))
      : db.prepare(
          `DELETE FROM tracked_orders WHERE (LOWER(id) = ? OR LOWER(id) = ? OR LOWER(id) LIKE ?)`
        ).run(cleanId, `ord-${cleanId}`, `%${cleanId}`);

    return result.changes > 0;
  }

  public cancelAllOrders(chatId?: number | string): number {
    const now = new Date().toISOString();
    const result = chatId
      ? db.prepare(
          `UPDATE tracked_orders SET status = 'CANCELLED', closed_at = ? WHERE (status = 'PENDING' OR status = 'FILLED') AND chat_id = ?`
        ).run(now, String(chatId))
      : db.prepare(
          `UPDATE tracked_orders SET status = 'CANCELLED', closed_at = ? WHERE status = 'PENDING' OR status = 'FILLED'`
        ).run(now);

    return result.changes;
  }

  public deleteAllOrders(chatId?: number | string): number {
    const result = chatId
      ? db.prepare(`DELETE FROM tracked_orders WHERE chat_id = ?`).run(String(chatId))
      : db.prepare(`DELETE FROM tracked_orders`).run();

    return result.changes;
  }

  /**
   * Kiểm tra giá thị trường theo thời gian thực chuẩn cơ chế Forex đa chiều & siêu nhạy
   */
  public async checkOrdersAgainstPrice(currentPrice: number, symbol: string = 'XAU/USD') {
    if (!this.bot) return;

    const activeOrders = this.getActiveOrders();
    if (activeOrders.length === 0) return;

    const curP = Number(currentPrice.toFixed(2));
    const EPSILON = 0.05; // Dung sai 5 cents chuẩn cho XAU/USD để bắt nhạy mọi biến động tick

    logger.info(
      { currentPrice: curP, rawPrice: currentPrice, symbol, activeCount: activeOrders.length },
      `📊 [PRICE CHECK] Giá Live: ${curP} | Kiểm tra ${activeOrders.length} lệnh (${activeOrders.map((o) => `#${o.id}:${o.orderType}@${o.entry}`).join(', ')})`
    );

    for (const order of activeOrders) {
      const entry = Number(order.entry.toFixed(2));

      // 1. Kiểm tra khớp Entry cho lệnh PENDING (Bắt trọn cả Limit, Stop, Quét qua và Dung sai)
      if (order.status === 'PENDING') {
        let isFilled = false;
        const prevPrice =
          order.lastCheckedPrice !== undefined
            ? Number(order.lastCheckedPrice.toFixed(2))
            : order.initialMarketPrice !== undefined
            ? Number(order.initialMarketPrice.toFixed(2))
            : curP;
        const initPrice =
          order.initialMarketPrice !== undefined
            ? Number(order.initialMarketPrice.toFixed(2))
            : prevPrice;

        // Cơ chế 1: Giá chạm đúng điểm Entry (trong phạm vi dung sai 0.05$)
        if (Math.abs(curP - entry) <= EPSILON) {
          isFilled = true;
        }

        // Cơ chế 2: Giá nhảy xuyên qua Entry giữa 2 nhịp tick (Cross detection)
        if (!isFilled) {
          const minP = Math.min(prevPrice, curP) - EPSILON;
          const maxP = Math.max(prevPrice, curP) + EPSILON;
          if (minP <= entry && entry <= maxP) {
            isFilled = true;
          }
        }

        // Cơ chế 3: Xử lý theo chiều đặt lệnh ban đầu
        if (!isFilled) {
          if (initPrice > entry) {
            // Giá ban đầu ở trên Entry (vd Buy Limit): Khớp khi giá rơi xuống chạm/dưới Entry
            if (curP <= entry + EPSILON) {
              isFilled = true;
            }
          } else if (initPrice < entry) {
            // Giá ban đầu ở dưới Entry (vd Sell Limit): Khớp khi giá tăng lên chạm/vượt Entry
            if (curP >= entry - EPSILON) {
              isFilled = true;
            }
          }
        }

        if (isFilled) {
          const filledAt = new Date().toISOString();
          this.updateFillStatusStmt.run({
            id: order.id,
            filledAt,
            fillPrice: curP,
            lastCheckedPrice: curP,
          });

          order.status = 'FILLED';
          order.filledAt = filledAt;
          order.fillPrice = curP;
          order.lastCheckedPrice = curP;

          logger.info(
            { orderId: order.id, type: order.orderType, entry, currentPrice: curP, chatId: order.chatId },
            '🎯 [ENTRY HIT] Khớp lệnh Entry thành công! Đang gửi thông báo Telegram...'
          );

          await this.sendNotification(order.chatId, this.formatFillNotification(order, curP));
        } else {
          this.updateLastCheckedPriceStmt.run(curP, order.id);
          order.lastCheckedPrice = curP;
        }
      }
      // 2. Kiểm tra TP / SL cho lệnh đã FILLED
      else if (order.status === 'FILLED') {
        const isBuy = order.orderType.startsWith('BUY');
        const prevPrice =
          order.lastCheckedPrice !== undefined ? Number(order.lastCheckedPrice.toFixed(2)) : curP;
        let isTpHit = false;
        let isSlHit = false;

        if (order.tp !== undefined) {
          const tp = Number(order.tp.toFixed(2));
          if (isBuy) {
            isTpHit =
              curP >= tp - EPSILON ||
              (Math.min(prevPrice, curP) <= tp && tp <= Math.max(prevPrice, curP));
          } else {
            isTpHit =
              curP <= tp + EPSILON ||
              (Math.min(prevPrice, curP) <= tp && tp <= Math.max(prevPrice, curP));
          }
        }

        if (order.sl !== undefined && !isTpHit) {
          const sl = Number(order.sl.toFixed(2));
          if (isBuy) {
            isSlHit =
              curP <= sl + EPSILON ||
              (Math.min(prevPrice, curP) <= sl && sl <= Math.max(prevPrice, curP));
          } else {
            isSlHit =
              curP >= sl - EPSILON ||
              (Math.min(prevPrice, curP) <= sl && sl <= Math.max(prevPrice, curP));
          }
        }

        if (isTpHit) {
          const closedAt = new Date().toISOString();
          this.updateCloseStatusStmt.run({
            id: order.id,
            status: 'CLOSED_TP',
            closedAt,
            closePrice: curP,
            lastCheckedPrice: curP,
          });

          order.status = 'CLOSED_TP';
          order.closedAt = closedAt;
          order.closePrice = curP;
          order.lastCheckedPrice = curP;

          logger.info(
            { orderId: order.id, tp: order.tp, currentPrice: curP, chatId: order.chatId },
            '🎉 [TP HIT] Chốt lời thành công! Đang gửi thông báo Telegram...'
          );

          await this.sendNotification(order.chatId, this.formatTpNotification(order, curP));
        } else if (isSlHit) {
          const closedAt = new Date().toISOString();
          this.updateCloseStatusStmt.run({
            id: order.id,
            status: 'CLOSED_SL',
            closedAt,
            closePrice: curP,
            lastCheckedPrice: curP,
          });

          order.status = 'CLOSED_SL';
          order.closedAt = closedAt;
          order.closePrice = curP;
          order.lastCheckedPrice = curP;

          logger.info(
            { orderId: order.id, sl: order.sl, currentPrice: curP, chatId: order.chatId },
            '🛑 [SL HIT] Cắt lỗ bảo toàn vốn! Đang gửi thông báo Telegram...'
          );

          await this.sendNotification(order.chatId, this.formatSlNotification(order, curP));
        } else {
          this.updateLastCheckedPriceStmt.run(curP, order.id);
          order.lastCheckedPrice = curP;
        }
      }
    }
  }

  private async sendNotification(chatId: number | string, text: string) {
    if (!this.bot) return;
    try {
      await this.bot.api.sendMessage(chatId, text, { parse_mode: 'HTML' });
      logger.info({ chatId }, '📣 Đã gửi thông báo khớp lệnh tới Telegram');
    } catch (err: any) {
      logger.error({ error: err.message, chatId }, '❌ Không thể gửi thông báo khớp lệnh qua Telegram');
    }
  }

  private formatFillNotification(order: TrackedOrder, currentPrice: number): string {
    const isBuy = order.orderType.startsWith('BUY');
    const icon = isBuy ? '🟢' : '🔴';
    const type = order.orderType.replace('_', ' ');

    let msg = `🔔 <b>[KHỚP LỆNH ENTRY] ${icon} ${type} [${order.symbol}]</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `⚡ <b>Mã lệnh:</b> <code>#${order.id}</code>\n`;
    msg += `🎯 <b>Lệnh đã khớp tại giá Live:</b> <code>${currentPrice}</code>\n`;
    msg += `📍 <b>Giá đặt Entry:</b> <code>${order.entry}</code>\n`;
    if (order.tp !== undefined) {
      msg += `🎯 <b>Mục tiêu TP:</b> <code>${order.tp}</code> (+${order.reward} pts)\n`;
    }
    if (order.sl !== undefined) {
      msg += `🛑 <b>Mức cắt lỗ SL:</b> <code>${order.sl}</code> (-${order.risk} pts)\n`;
    }
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    if (order.tp !== undefined || order.sl !== undefined) {
      msg += `📡 <i>Hệ thống tiếp tục theo dõi TP & SL tự động...</i>`;
    } else {
      msg += `✅ <i>Lệnh đã khớp Entry thành công!</i>`;
    }
    return msg;
  }

  private formatTpNotification(order: TrackedOrder, currentPrice: number): string {
    const isBuy = order.orderType.startsWith('BUY');
    const icon = isBuy ? '🟢' : '🔴';
    const type = order.orderType.replace('_', ' ');

    let msg = `🎉 <b>[CHỐT LỜI THÀNH CÔNG - TP HIT] ${icon} ${type}</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `⚡ <b>Mã lệnh:</b> <code>#${order.id}</code>\n`;
    msg += `💰 <b>Giá chạm TP:</b> <code>${currentPrice}</code> (Mục tiêu: <code>${order.tp}</code>)\n`;
    msg += `📈 <b>Lợi nhuận đạt:</b> +<b>${order.reward} pts</b> (+${order.tpPercent}%)\n`;
    msg += `⚖️ <b>Tỷ lệ R:R:</b> <code>1 : ${order.riskRewardRatio}</code>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `✅ <i>Lệnh đã hoàn thành và đóng vị thế thành công!</i>`;
    return msg;
  }

  private formatSlNotification(order: TrackedOrder, currentPrice: number): string {
    const isBuy = order.orderType.startsWith('BUY');
    const icon = isBuy ? '🟢' : '🔴';
    const type = order.orderType.replace('_', ' ');

    let msg = `🛑 <b>[CẮT LỖ - SL HIT] ${icon} ${type}</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `⚡ <b>Mã lệnh:</b> <code>#${order.id}</code>\n`;
    msg += `⚠️ <b>Giá chạm SL:</b> <code>${currentPrice}</code> (Mức SL: <code>${order.sl}</code>)\n`;
    msg += `📉 <b>Rủi ro cắt lỗ:</b> -<b>${order.risk} pts</b> (-${order.slPercent}%)\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `⚠️ <i>Lệnh đã được đóng để bảo toàn vốn.</i>`;
    return msg;
  }
}

export const orderTracker = new OrderTracker();
