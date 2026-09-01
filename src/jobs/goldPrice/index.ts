import { defineJob } from '../../core/job.js';
import { fetchAllMetalsPrice } from './fetcher.js';
import { formatGoldPriceToHtml } from './formatter.js';

export const goldPriceJob = defineJob({
  id: 'gold-price',
  name: 'Giá Vàng & Kim Loại Quý Realtime',
  description: 'Cập nhật giá Vàng (XAU/USD) và Bạc (XAG/USD) trực tiếp thời gian thực',
  cronSchedule: '0 8,14 * * 1-5', // Tự động gửi lúc 8h và 14h các ngày giao dịch trong tuần
  command: 'gold',
  botType: 'FOREX',
  targetChatId: (config) => config.TELEGRAM_FOREX_CHAT_ID || config.TELEGRAM_GOLD_CHAT_ID || config.TELEGRAM_CHAT_ID,
  enabled: true,

  async run(ctx) {
    ctx.logger.info('Đang lấy dữ liệu giá vàng realtime...');
    const metals = await fetchAllMetalsPrice();
    const html = formatGoldPriceToHtml(metals);
    return html;
  },
});

export default goldPriceJob;
export * from './fetcher.js';
export * from './formatter.js';
