import { defineJob } from '../../core/job.js';
import { parseTradeOrder } from './parser.js';
import { formatTradeOrderToHtml } from './formatter.js';

export const tradingSignalJob = defineJob({
  id: 'trading-signal',
  name: 'Tín Hiệu Giao Dịch & Quản Lý Lệnh Limit',
  description: 'Tính toán và phát tín hiệu lệnh Buy/Sell Limit với Entry, TP, SL, R:R',
  cronSchedule: '0 0 1 1 *', // Job chủ yếu kích hoạt theo lệnh Bot Command
  command: 'bl',
  botType: 'FOREX',
  targetChatId: (config) => config.TELEGRAM_FOREX_CHAT_ID || config.TELEGRAM_TRADING_CHAT_ID || config.TELEGRAM_CHAT_ID,
  enabled: true,

  async run(ctx) {
    // Khi gọi từ CLI hoặc Bot
    const input = ctx.customArgs?.join(' ') || '4300 4500 4200';
    const parsed = parseTradeOrder(`/bl ${input}`);
    if (!parsed.success) {
      return `❌ ${parsed.error}\n💡 Gợi ý cú pháp: <code>${parsed.hint}</code>`;
    }
    return formatTradeOrderToHtml(parsed.order);
  },
});

export default tradingSignalJob;
export * from './parser.js';
export * from './formatter.js';
export * from './orderTracker.js';
