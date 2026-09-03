import { defineJob } from "../../core/job.js";
import { fetchAllMetalsPrice } from "./fetcher.js";
import { formatGoldPriceToHtml } from "./formatter.js";
import { vnAppMobClient } from "./vnAppMobClient.js";

export const goldPriceJob = defineJob({
  id: "gold-price",
  name: "Giá Vàng & Kim Loại Quý Realtime",
  description: "Cập nhật giá Vàng (XAU/USD) và Bạc (XAG/USD) trực tiếp thời gian thực",
  cronSchedule: process.env.GOLD_PRICE_CRON || "0 8,14 * * 1-5",
  autoSchedule: process.env.GOLD_PRICE_AUTO === "true",
  command: "gold",
  botType: "FOREX",
  targetChatId: (config) => config.TELEGRAM_FOREX_CHAT_ID || config.TELEGRAM_GOLD_CHAT_ID || config.TELEGRAM_CHAT_ID,
  enabled: true,

  async run(ctx) {
    ctx.logger.info("Đang lấy dữ liệu giá vàng thế giới realtime...");
    const metals = await fetchAllMetalsPrice();
    const html = formatGoldPriceToHtml(metals);
    return html;
  },
});

export const sjcGoldPriceJob = defineJob({
  id: "price-gold",
  name: "Giá Vàng SJC Việt Nam Realtime",
  description: "Cập nhật giá vàng SJC, vàng nhẫn và vàng nữ trang Việt Nam từ VNAppMob",
  cronSchedule: process.env.SJC_GOLD_CRON || "0 8,14 * * 1-6",
  autoSchedule: process.env.SJC_GOLD_AUTO === "true",
  command: "price_gold",
  botType: "FOREX",
  targetChatId: (config) => config.TELEGRAM_FOREX_CHAT_ID || config.TELEGRAM_GOLD_CHAT_ID || config.TELEGRAM_CHAT_ID,
  enabled: true,

  async run(ctx) {
    ctx.logger.info("Đang lấy dữ liệu giá vàng SJC Việt Nam từ VNAppMob...");
    const data = await vnAppMobClient.getSjcGoldPrice();
    return vnAppMobClient.formatSjcToHtml(data);
  },
});

export default goldPriceJob;
export * from "./fetcher.js";
export * from "./formatter.js";
export * from "./vnAppMobClient.js";
