export type OrderType = 'BUY_LIMIT' | 'SELL_LIMIT' | 'BUY_STOP' | 'SELL_STOP' | 'BUY' | 'SELL';

export interface ParsedTradeOrder {
  orderType: OrderType;
  symbol?: string;
  entry: number;
  tp?: number;
  sl?: number;
  note?: string;
  reward?: number;
  risk?: number;
  riskRewardRatio?: number;
  tpPercent?: number;
  slPercent?: number;
}

/**
 * Phân tích chuỗi lệnh từ người dùng thành cấu trúc Trade Order
 * Hỗ trợ các định dạng:
 * 1. /bl 4420 (Chỉ Entry)
 * 2. /bl 4420 4430 (Entry + TP)
 * 3. /bl 4420 4430 4410 (Entry + TP + SL)
 * 4. /bl XAUUSD 4420
 * 5. /selllimit 4430
 */
export function parseTradeOrder(rawText: string): { success: true; order: ParsedTradeOrder } | { success: false; error: string; hint?: string } {
  const text = rawText.trim();
  const parts = text.split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return {
      success: false,
      error: 'Vui lòng cung cấp thông số lệnh.',
      hint: '/bl 4420 (hoặc kèm TP SL: /bl 4420 4430 4410)',
    };
  }

  const firstToken = (parts[0] || '').toLowerCase().replace(/^\//, '');
  let orderType: OrderType = 'BUY_LIMIT';

  if (firstToken === 'bl' || firstToken === 'buylimit' || firstToken === 'buy_limit') {
    orderType = 'BUY_LIMIT';
  } else if (firstToken === 'sl' || firstToken === 'selllimit' || firstToken === 'sell_limit' || firstToken === 'sl_limit' || firstToken === 'slimit') {
    orderType = 'SELL_LIMIT';
  } else if (firstToken === 'buy') {
    orderType = 'BUY';
  } else if (firstToken === 'sell') {
    orderType = 'SELL';
  }

  const remainingTokens = parts.slice(1);

  if (remainingTokens.length === 0) {
    return {
      success: false,
      error: 'Thiếu mức giá Entry.',
      hint: orderType === 'BUY_LIMIT' ? '/bl 4420' : '/sl 4430',
    };
  }

  let symbol: string | undefined = undefined;
  const numbers: number[] = [];

  for (const token of remainingTokens) {
    const cleanToken = token.replace(/,/g, '');
    const num = parseFloat(cleanToken);

    if (!isNaN(num) && /^-?\d+(\.\d+)?$/.test(cleanToken)) {
      numbers.push(num);
    } else if (!symbol && /^[A-Za-z0-9_\-\/]{2,12}$/.test(token)) {
      symbol = token.toUpperCase();
    }
  }

  if (numbers.length === 0 || numbers[0] === undefined) {
    return {
      success: false,
      error: 'Không tìm thấy mức giá Entry hợp lệ.',
      hint: orderType === 'BUY_LIMIT' ? '/bl 4420' : '/selllimit 4430',
    };
  }

  const entry = numbers[0];
  const tp = numbers[1];
  const sl = numbers[2];

  if (entry <= 0 || (tp !== undefined && tp <= 0) || (sl !== undefined && sl <= 0)) {
    return {
      success: false,
      error: 'Các mức giá Entry, TP, SL phải lớn hơn 0.',
    };
  }

  const isBuy = orderType.startsWith('BUY');

  // Kiểm tra tính hợp lệ logic của TP và SL theo chuẩn Forex
  if (isBuy) {
    if (tp !== undefined && tp <= entry) {
      return {
        success: false,
        error: `Với lệnh ${orderType.replace('_', ' ')}, mức Chốt lời (TP: ${tp}) phải LỚN HƠN giá Entry (${entry}).`,
        hint: `Ví dụ: /bl ${entry} ${entry + 20} ${sl !== undefined ? sl : entry - 10}`,
      };
    }
    if (sl !== undefined && sl >= entry) {
      return {
        success: false,
        error: `Với lệnh ${orderType.replace('_', ' ')}, mức Cắt lỗ (SL: ${sl}) phải NHỎ HƠN giá Entry (${entry}).`,
        hint: `Ví dụ: /bl ${entry} ${tp !== undefined ? tp : entry + 20} ${entry - 10}`,
      };
    }
  } else {
    if (tp !== undefined && tp >= entry) {
      return {
        success: false,
        error: `Với lệnh ${orderType.replace('_', ' ')}, mức Chốt lời (TP: ${tp}) phải NHỎ HƠN giá Entry (${entry}).`,
        hint: `Ví dụ: /sl ${entry} ${entry - 20} ${sl !== undefined ? sl : entry + 10}`,
      };
    }
    if (sl !== undefined && sl <= entry) {
      return {
        success: false,
        error: `Với lệnh ${orderType.replace('_', ' ')}, mức Cắt lỗ (SL: ${sl}) phải LỚN HƠN giá Entry (${entry}).`,
        hint: `Ví dụ: /sl ${entry} ${tp !== undefined ? tp : entry - 20} ${entry + 10}`,
      };
    }
  }

  let reward: number | undefined = undefined;
  let risk: number | undefined = undefined;
  let riskRewardRatio: number | undefined = undefined;
  let tpPercent: number | undefined = undefined;
  let slPercent: number | undefined = undefined;

  if (tp !== undefined) {
    reward = isBuy ? tp - entry : entry - tp;
    reward = Number(reward.toFixed(4));
    tpPercent = Number(((reward / entry) * 100).toFixed(2));
  }

  if (sl !== undefined) {
    risk = isBuy ? entry - sl : sl - entry;
    risk = Number(risk.toFixed(4));
    slPercent = Number(((risk / entry) * 100).toFixed(2));
  }

  if (reward !== undefined && risk !== undefined && risk > 0) {
    riskRewardRatio = Number((reward / risk).toFixed(2));
  }

  return {
    success: true,
    order: {
      orderType,
      symbol,
      entry,
      tp,
      sl,
      reward,
      risk,
      riskRewardRatio,
      tpPercent,
      slPercent,
    },
  };
}
