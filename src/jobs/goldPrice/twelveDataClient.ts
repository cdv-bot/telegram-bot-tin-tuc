import axios from 'axios';
import { getConfig } from '../../core/env.js';
import { logger } from '../../core/logger.js';

export interface TwelveDataGoldQuote {
  symbol: string;
  name: string;
  price: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  previousClose?: number;
  change?: number;
  percentChange?: number;
  timestamp: number;
  updatedAt: string;
  source: 'WEBSOCKET_REALTIME' | 'REST_API' | 'FALLBACK';
}

class TwelveDataClient {
  private ws: any = null;
  private isConnecting: boolean = false;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private latestQuote: TwelveDataGoldQuote | null = null;
  private symbols: string[] = ['XAU/USD'];
  private priceListeners: ((quote: TwelveDataGoldQuote) => void)[] = [];
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private lastRestCallTime: number = 0;

  constructor() {
    this.initWebSocket();
  }

  public getLatestCachedQuote(): TwelveDataGoldQuote | null {
    return this.latestQuote;
  }

  public onPriceTick(listener: (quote: TwelveDataGoldQuote) => void) {
    this.priceListeners.push(listener);
  }

  private notifyPriceListeners(quote: TwelveDataGoldQuote) {
    for (const listener of this.priceListeners) {
      try {
        listener(quote);
      } catch (err: any) {
        logger.error({ error: err.message }, 'Lỗi trong price listener callback');
      }
    }
  }

  public initWebSocket() {
    const config = getConfig();
    const apiKey = config.TWELVE_DATA_API_KEY;
    if (!apiKey) {
      logger.warn('⚠️ TWELVE_DATA_API_KEY chưa được cấu hình, bỏ qua kết nối Twelve Data WebSocket.');
      return;
    }

    if (typeof WebSocket === 'undefined') {
      logger.warn('Global WebSocket không khả dụng trên môi trường hiện tại.');
      return;
    }

    if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    this.isConnecting = true;
    const wsUrl = `${config.TWELVE_DATA_WS_URL}?apikey=${apiKey}`;

    logger.info({ wsUrl: config.TWELVE_DATA_WS_URL }, '📡 Đang kết nối tới Twelve Data WebSocket...');

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnecting = false;
        logger.info('✅ Đã kết nối thành công Twelve Data WebSocket (Realtime Ticks)!');
        
        // Subscribe symbols
        const subscribeMsg = JSON.stringify({
          action: 'subscribe',
          params: {
            symbols: this.symbols.join(','),
          },
        });
        this.ws.send(subscribeMsg);

        // Duy trì kết nối bằng Heartbeat Ping mỗi 10s
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
              this.ws.send(JSON.stringify({ action: 'heartbeat' }));
            } catch (_) {}
          }
        }, 10000);
      };

      this.ws.onmessage = (event: any) => {
        try {
          const rawData = typeof event.data === 'string' ? event.data : event.data.toString();
          const parsed = JSON.parse(rawData);

          if (parsed.event === 'price' && parsed.symbol === 'XAU/USD') {
            const price = parseFloat(parsed.price);
            const ts = parsed.timestamp ? parsed.timestamp * 1000 : Date.now();

            this.latestQuote = {
              symbol: 'XAU/USD',
              name: 'Gold Spot / US Dollar',
              price,
              open: this.latestQuote?.open,
              high: this.latestQuote?.high ? Math.max(this.latestQuote.high, price) : price,
              low: this.latestQuote?.low ? Math.min(this.latestQuote.low, price) : price,
              change: this.latestQuote?.previousClose ? Number((price - this.latestQuote.previousClose).toFixed(2)) : undefined,
              percentChange: this.latestQuote?.previousClose ? Number((((price - this.latestQuote.previousClose) / this.latestQuote.previousClose) * 100).toFixed(2)) : undefined,
              timestamp: ts,
              updatedAt: new Date(ts).toISOString(),
              source: 'WEBSOCKET_REALTIME',
            };

            this.notifyPriceListeners(this.latestQuote);
            logger.info({ price, symbol: parsed.symbol }, `⚡ [WEBSOCKET TICK] ${parsed.symbol}: ${price}`);
          } else if (parsed.event === 'subscribe-status') {
            logger.info({ status: parsed.status, success: parsed.success }, '📡 [WS SUBSCRIBE] Trạng thái đăng ký Twelve Data');
          } else if (parsed.event === 'heartbeat') {
            logger.info('💓 [WEBSOCKET HEARTBEAT] Kết nối Twelve Data WebSocket đang sống');
          } else {
            logger.info({ event: parsed.event, raw: parsed }, '📥 [WEBSOCKET MSG] Nhận gói tin từ WebSocket');
          }
        } catch (e: any) {
          logger.warn({ error: e.message }, '⚠️ Lỗi phân tích gói tin Twelve Data WS');
        }
      };

      this.ws.onerror = (err: any) => {
        logger.error({ error: err.message || 'Unknown WS error' }, '❌ Lỗi Twelve Data WebSocket');
      };

      this.ws.onclose = (event: any) => {
        this.isConnecting = false;
        this.ws = null;
        if (this.heartbeatInterval) {
          clearInterval(this.heartbeatInterval);
          this.heartbeatInterval = null;
        }
        logger.warn({ code: event.code, reason: event.reason }, 'Twelve Data WebSocket đã đóng kết nối. Đang lập lịch kết nối lại...');
        this.scheduleReconnect();
      };
    } catch (error: any) {
      this.isConnecting = false;
      logger.error({ error: error.message }, 'Lỗi khi khởi tạo Twelve Data WebSocket');
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    this.reconnectTimeout = setTimeout(() => {
      this.initWebSocket();
    }, 5000);
  }

  /**
   * Lấy giá vàng Realtime (100% Pure WebSocket -> Fallback Gold-API miễn phí)
   * Tuyệt đối KHÔNG gọi Twelve Data REST API để tránh bị giới hạn Rate Limit
   */
  public async getGoldQuote(): Promise<TwelveDataGoldQuote> {
    // 1. Lấy trực tiếp từ luồng WebSocket Realtime
    if (this.latestQuote) {
      return this.latestQuote;
    }

    // 2. Chỉ khi vừa khởi động bot mà WebSocket chưa kịp nhận tick đầu tiên: lấy tạm từ Gold-API (hoàn toàn miễn phí)
    try {
      logger.debug('WebSocket đang kết nối, lấy giá khởi tạo từ gold-api.com...');
      const fallbackRes = await axios.get('https://api.gold-api.com/price/XAU', { timeout: 6000 });
      const fb = fallbackRes.data;
      const initialQuote: TwelveDataGoldQuote = {
        symbol: 'XAU/USD',
        name: 'Gold Spot',
        price: fb.price,
        timestamp: Date.now(),
        updatedAt: fb.updatedAt || new Date().toISOString(),
        source: 'FALLBACK',
      };
      return initialQuote;
    } catch (fbErr: any) {
      if (this.latestQuote) {
        return this.latestQuote;
      }
      throw new Error(`Không thể lấy giá vàng: ${fbErr.message}`);
    }
  }

  public close() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export const twelveDataClient = new TwelveDataClient();
