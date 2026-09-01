import axios from 'axios';
import { logger } from '../../core/logger.js';
import { twelveDataClient, type TwelveDataGoldQuote } from './twelveDataClient.js';

export interface GoldPriceData {
  symbol: string;
  name: string;
  price: number;
  currency: string;
  currencySymbol: string;
  updatedAt: string;
  updatedAtReadable?: string;
  open?: number;
  highPrice?: number;
  lowPrice?: number;
  previousClose?: number;
  change?: number;
  percentChange?: number;
  source?: string;
}

export interface MultiMetalPrice {
  gold: GoldPriceData;
  silver?: GoldPriceData;
}

/**
 * Lấy giá Vàng realtime từ Twelve Data (WebSocket / REST) kèm fallback
 */
export async function fetchRealtimeGoldPrice(symbol: string = 'XAU'): Promise<GoldPriceData> {
  const cleanSymbol = symbol.toUpperCase().trim();
  
  if (cleanSymbol === 'XAU' || cleanSymbol === 'XAU/USD' || cleanSymbol === 'GOLD') {
    try {
      const tdQuote: TwelveDataGoldQuote = await twelveDataClient.getGoldQuote();
      return {
        symbol: 'XAU/USD',
        name: tdQuote.name || 'Gold Spot',
        price: tdQuote.price,
        currency: 'USD',
        currencySymbol: '$',
        updatedAt: tdQuote.updatedAt,
        open: tdQuote.open,
        highPrice: tdQuote.high,
        lowPrice: tdQuote.low,
        previousClose: tdQuote.previousClose,
        change: tdQuote.change,
        percentChange: tdQuote.percentChange,
        source: tdQuote.source,
      };
    } catch (err: any) {
      logger.warn({ error: err.message }, '⚠️ Twelve Data không phản hồi, đang thử phương thức tiếp theo...');
    }
  }

  logger.info({ symbol: cleanSymbol }, 'Đang lấy giá kim loại quý realtime từ Gold Price API...');

  try {
    // Thử lấy từ gold-api.com
    const response = await axios.get(`https://api.gold-api.com/price/${cleanSymbol}`, {
      timeout: 10000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'TelegramNewsBot/1.0',
      },
    });

    const data = response.data;
    if (!data || typeof data.price !== 'number') {
      throw new Error(`Dữ liệu giá không hợp lệ nhận được cho mã ${cleanSymbol}`);
    }

    return {
      symbol: data.symbol || cleanSymbol,
      name: data.name || (cleanSymbol === 'XAU' ? 'Gold' : cleanSymbol === 'XAG' ? 'Silver' : cleanSymbol),
      price: data.price,
      currency: data.currency || 'USD',
      currencySymbol: data.currencySymbol || '$',
      updatedAt: data.updatedAt || new Date().toISOString(),
      updatedAtReadable: data.updatedAtReadable,
      source: 'GOLD_API_FALLBACK',
    };
  } catch (error: any) {
    logger.warn({ error: error.message, symbol: cleanSymbol }, '⚠️ Lỗi khi gọi Gold Price API, thử fallback...');
    
    // Fallback nếu có API Key GoldAPI.io trong env
    const goldApiKey = process.env.GOLD_API_KEY;
    if (goldApiKey) {
      try {
        const fallbackRes = await axios.get(`https://www.goldapi.io/api/${cleanSymbol}/USD`, {
          timeout: 10000,
          headers: {
            'x-access-token': goldApiKey,
            'Content-Type': 'application/json',
          },
        });
        const fbData = fallbackRes.data;
        return {
          symbol: fbData.metal || cleanSymbol,
          name: cleanSymbol === 'XAU' ? 'Gold' : cleanSymbol,
          price: fbData.price,
          currency: fbData.currency || 'USD',
          currencySymbol: '$',
          updatedAt: new Date(fbData.timestamp * 1000).toISOString(),
          highPrice: fbData.high_price,
          lowPrice: fbData.low_price,
          change: fbData.ch,
          percentChange: fbData.chp,
          source: 'GOLD_API_IO',
        };
      } catch (fbErr: any) {
        logger.error({ error: fbErr.message }, 'Fallback GoldAPI.io cũng thất bại');
      }
    }

    throw new Error(`Không thể lấy giá vàng realtime: ${error.message}`);
  }
}

/**
 * Lấy đồng thời giá Vàng (XAU) và Bạc (XAG)
 */
export async function fetchAllMetalsPrice(): Promise<MultiMetalPrice> {
  const [gold, silver] = await Promise.allSettled([
    fetchRealtimeGoldPrice('XAU'),
    fetchRealtimeGoldPrice('XAG'),
  ]);

  if (gold.status === 'rejected') {
    throw gold.reason;
  }

  return {
    gold: gold.value,
    silver: silver.status === 'fulfilled' ? silver.value : undefined,
  };
}
