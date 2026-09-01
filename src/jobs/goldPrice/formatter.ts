import type { MultiMetalPrice } from './fetcher.js';

export function formatGoldPriceToHtml(metals: MultiMetalPrice): string {
  const gold = metals.gold;
  const silver = metals.silver;

  const goldPriceUsd = gold.price;
  const goldPriceFormatted = goldPriceUsd.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  // Quy đổi ước tính sang VNĐ: 1 Troy Ounce = 0.829426 lượng (hoặc 1 lượng vàng = 1.20565 oz)
  // Ước tính tỷ giá USD/VND khoảng 25,450
  const usdRate = 25450;
  const vndPerLuong = Math.round(goldPriceUsd * 1.20565 * usdRate);
  const vndPerLuongFormatted = (vndPerLuong / 1000000).toFixed(2);

  const updatedDate = new Date(gold.updatedAt);
  const timeStr = updatedDate.toLocaleTimeString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const dateStr = updatedDate.toLocaleDateString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  let msg = `🟡 <b>GIÁ VÀNG & KIM LOẠI QUÝ REALTIME</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

  let changeText = '';
  if (gold.change !== undefined && gold.percentChange !== undefined) {
    const sign = gold.change >= 0 ? '+' : '';
    const icon = gold.change >= 0 ? '📈' : '📉';
    changeText = ` (${icon} ${sign}${gold.change} | ${sign}${gold.percentChange}%)`;
  }

  msg += `🏆 <b>VÀNG THẾ GIỚI (XAU/USD):</b>\n`;
  msg += `• Giá Live: <b>$${goldPriceFormatted}</b> / oz${changeText}\n`;
  msg += `• Quy đổi tham khảo: ~<b>${vndPerLuongFormatted} triệu VNĐ</b> / lượng\n`;

  if (gold.highPrice && gold.lowPrice) {
    const highStr = gold.highPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const lowStr = gold.lowPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    msg += `• Biên độ 24h: <code>${lowStr} - ${highStr}</code>\n\n`;
  } else {
    msg += `\n`;
  }

  if (silver) {
    const silverPriceFormatted = silver.price.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    msg += `⚪ <b>BẠC THẾ GIỚI (XAG/USD):</b>\n`;
    msg += `• Giá Spot: <b>$${silverPriceFormatted}</b> / oz\n\n`;
  }

  const sourceName = gold.source === 'WEBSOCKET_REALTIME'
    ? 'Twelve Data WebSocket (Live Stream)'
    : gold.source === 'REST_API'
    ? 'Twelve Data API'
    : 'Gold Price Realtime API';

  msg += `━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `⏰ <b>Cập nhật:</b> <i>${timeStr} (${dateStr})</i>\n`;
  msg += `📡 <i>Nguồn: ${sourceName}</i>`;

  return msg;
}
