import fs from 'fs';
import path from 'path';
import type { Bot } from 'grammy';
import { logger } from '../../core/logger.js';
import { PATHS } from '../../core/env.js';
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

class OrderTracker {
  private orders: TrackedOrder[] = [];
  private bot: Bot | null = null;
  private filePath: string;
  private isInitialized: boolean = false;

  private pollingIntervalId: NodeJS.Timeout | null = null;

  constructor() {
    this.filePath = path.join(PATHS.data, 'limit_orders.json');
    this.loadOrders();
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

  private loadOrders() {
    try {
      if (!fs.existsSync(PATHS.data)) {
        fs.mkdirSync(PATHS.data, { recursive: true });
      }
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        this.orders = JSON.parse(raw);
        logger.info(`Đã nạp ${this.orders.length} lệnh từ file dữ liệu.`);
      }
    } catch (err: any) {
      logger.warn({ error: err.message }, 'Không thể nạp danh sách lệnh cũ');
      this.orders = [];
    }
  }

  private saveOrders() {
    try {
      if (!fs.existsSync(PATHS.data)) {
        fs.mkdirSync(PATHS.data, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.orders, null, 2), 'utf-8');
    } catch (err: any) {
      logger.error({ error: err.message }, 'Lỗi khi lưu danh sách lệnh');
    }
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

    const tracked: TrackedOrder = {
      ...order,
      id,
      chatId,
      symbol: order.symbol || 'XAU/USD',
      status: 'PENDING',
      initialMarketPrice,
      lastCheckedPrice: initialMarketPrice,
      createdAt: new Date().toISOString(),
    };

    this.orders.push(tracked);
    this.saveOrders();
    logger.info({ id, type: tracked.orderType, entry: tracked.entry, initialMarketPrice }, '✅ Đã ghi nhận lệnh limit mới vào hệ thống giám sát');
    return tracked;
  }

  public getActiveOrders(chatId?: number | string): TrackedOrder[] {
    return this.orders.filter(
      (o) => (o.status === 'PENDING' || o.status === 'FILLED') && (!chatId || String(o.chatId) === String(chatId))
    );
  }

  public cancelOrder(id: string, chatId?: number | string): boolean {
    const cleanId = id.trim().replace(/^[#]/, '').toLowerCase();
    const order = this.orders.find(
      (o) =>
        (o.id.toLowerCase() === cleanId ||
          o.id.toLowerCase() === `ord-${cleanId}` ||
          o.id.toLowerCase().endsWith(cleanId)) &&
        (!chatId || String(o.chatId) === String(chatId))
    );
    if (!order || order.status === 'CLOSED_TP' || order.status === 'CLOSED_SL' || order.status === 'CANCELLED') {
      return false;
    }
    order.status = 'CANCELLED';
    order.closedAt = new Date().toISOString();
    this.saveOrders();
    return true;
  }

  public deleteOrder(id: string, chatId?: number | string): boolean {
    const cleanId = id.trim().replace(/^[#]/, '').toLowerCase();
    const initialLen = this.orders.length;
    this.orders = this.orders.filter(
      (o) =>
        !(
          (o.id.toLowerCase() === cleanId ||
            o.id.toLowerCase() === `ord-${cleanId}` ||
            o.id.toLowerCase().endsWith(cleanId)) &&
          (!chatId || String(o.chatId) === String(chatId))
        )
    );
    if (this.orders.length !== initialLen) {
      this.saveOrders();
      return true;
    }
    return false;
  }

  public cancelAllOrders(chatId?: number | string): number {
    const active = this.getActiveOrders(chatId);
    active.forEach((o) => {
      o.status = 'CANCELLED';
      o.closedAt = new Date().toISOString();
    });
    this.saveOrders();
    return active.length;
  }

  public deleteAllOrders(chatId?: number | string): number {
    const initialLen = this.orders.length;
    if (!chatId) {
      this.orders = [];
    } else {
      this.orders = this.orders.filter((o) => String(o.chatId) !== String(chatId));
    }
    this.saveOrders();
    return initialLen - this.orders.length;
  }

  /**
   * Kiểm tra giá thị trường theo thời gian thực chuẩn cơ chế Forex đa chiều & siêu nhạy
   */
  public async checkOrdersAgainstPrice(currentPrice: number, symbol: string = 'XAU/USD') {
    if (!this.bot || this.orders.length === 0) return;

    const activeOrders = this.orders.filter((o) => o.status === 'PENDING' || o.status === 'FILLED');
    if (activeOrders.length === 0) return;

    const curP = Number(currentPrice.toFixed(2));
    const EPSILON = 0.05; // Dung sai 5 cents chuẩn cho XAU/USD để bắt nhạy mọi biến động tick

    logger.info(
      { currentPrice: curP, rawPrice: currentPrice, symbol, activeCount: activeOrders.length },
      `📊 [PRICE CHECK] Giá Live: ${curP} | Kiểm tra ${activeOrders.length} lệnh (${activeOrders.map(o => `#${o.id}:${o.orderType}@${o.entry}`).join(', ')})`
    );

    for (const order of activeOrders) {
      const entry = Number(order.entry.toFixed(2));

      // 1. Kiểm tra khớp Entry cho lệnh PENDING (Bắt trọn cả Limit, Stop, Quét qua và Dung sai)
      if (order.status === 'PENDING') {
        let isFilled = false;
        const prevPrice = order.lastCheckedPrice !== undefined ? Number(order.lastCheckedPrice.toFixed(2)) : (order.initialMarketPrice !== undefined ? Number(order.initialMarketPrice.toFixed(2)) : curP);
        const initPrice = order.initialMarketPrice !== undefined ? Number(order.initialMarketPrice.toFixed(2)) : prevPrice;

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

        order.lastCheckedPrice = curP;

        if (isFilled) {
          order.status = 'FILLED';
          order.filledAt = new Date().toISOString();
          order.fillPrice = curP;
          this.saveOrders();

          logger.info(
            { orderId: order.id, type: order.orderType, entry, currentPrice: curP, chatId: order.chatId },
            '🎯 [ENTRY HIT] Khớp lệnh Entry thành công! Đang gửi thông báo Telegram...'
          );

          await this.sendNotification(order.chatId, this.formatFillNotification(order, curP));
        }
      }
      // 2. Kiểm tra TP / SL cho lệnh đã FILLED
      else if (order.status === 'FILLED') {
        const isBuy = order.orderType.startsWith('BUY');
        const prevPrice = order.lastCheckedPrice !== undefined ? Number(order.lastCheckedPrice.toFixed(2)) : curP;
        let isTpHit = false;
        let isSlHit = false;

        if (order.tp !== undefined) {
          const tp = Number(order.tp.toFixed(2));
          if (isBuy) {
            isTpHit = curP >= tp - EPSILON || (Math.min(prevPrice, curP) <= tp && tp <= Math.max(prevPrice, curP));
          } else {
            isTpHit = curP <= tp + EPSILON || (Math.min(prevPrice, curP) <= tp && tp <= Math.max(prevPrice, curP));
          }
        }

        if (order.sl !== undefined && !isTpHit) {
          const sl = Number(order.sl.toFixed(2));
          if (isBuy) {
            isSlHit = curP <= sl + EPSILON || (Math.min(prevPrice, curP) <= sl && sl <= Math.max(prevPrice, curP));
          } else {
            isSlHit = curP >= sl - EPSILON || (Math.min(prevPrice, curP) <= sl && sl <= Math.max(prevPrice, curP));
          }
        }

        order.lastCheckedPrice = curP;

        if (isTpHit) {
          order.status = 'CLOSED_TP';
          order.closedAt = new Date().toISOString();
          order.closePrice = curP;
          this.saveOrders();

          logger.info(
            { orderId: order.id, tp: order.tp, currentPrice: curP, chatId: order.chatId },
            '🎉 [TP HIT] Chốt lời thành công! Đang gửi thông báo Telegram...'
          );

          await this.sendNotification(order.chatId, this.formatTpNotification(order, curP));
        } else if (isSlHit) {
          order.status = 'CLOSED_SL';
          order.closedAt = new Date().toISOString();
          order.closePrice = curP;
          this.saveOrders();

          logger.info(
            { orderId: order.id, sl: order.sl, currentPrice: curP, chatId: order.chatId },
            '🛑 [SL HIT] Cắt lỗ bảo toàn vốn! Đang gửi thông báo Telegram...'
          );

          await this.sendNotification(order.chatId, this.formatSlNotification(order, curP));
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
