import { escapeHtml } from '../../core/deliveryService.js';
import type { ParsedTradeOrder } from './parser.js';

function formatNumber(num: number): string {
  return String(num);
}

export function formatTradeOrderToHtml(order: ParsedTradeOrder & { id?: string }): string {
  const isBuy = order.orderType.startsWith('BUY');
  const typeIcon = isBuy ? '🟢' : '🔴';
  const typeText = order.orderType.replace('_', ' ');
  const symbolText = order.symbol ? ` [${escapeHtml(order.symbol)}]` : '';

  const entryStr = formatNumber(order.entry);

  let tpLine = `🎯 <b>Chốt lời (TP):</b> <i>Không đặt</i>`;
  if (order.tp !== undefined && order.reward !== undefined && order.tpPercent !== undefined) {
    const tpStr = formatNumber(order.tp);
    const tpPts = order.reward >= 0 ? `+${formatNumber(order.reward)}` : `${formatNumber(order.reward)}`;
    const tpSign = order.tpPercent >= 0 ? `+${order.tpPercent}%` : `${order.tpPercent}%`;
    tpLine = `🎯 <b>Chốt lời (TP):</b> <code>${tpStr}</code> (<i>${tpPts} pts | ${tpSign}</i>)`;
  }

  let slLine = `🛑 <b>Cắt lỗ (SL):</b> <i>Không đặt</i>`;
  if (order.sl !== undefined && order.risk !== undefined && order.slPercent !== undefined) {
    const slStr = formatNumber(order.sl);
    const slPts = order.risk >= 0 ? `-${formatNumber(order.risk)}` : `+${formatNumber(Math.abs(order.risk))}`;
    const slSign = order.slPercent >= 0 ? `-${order.slPercent}%` : `+${Math.abs(order.slPercent)}%`;
    slLine = `🛑 <b>Cắt lỗ (SL):</b> <code>${slStr}</code> (<i>${slPts} pts | ${slSign}</i>)`;
  }

  let rrLine = '';
  if (order.riskRewardRatio !== undefined) {
    let rrEvaluation = '';
    if (order.riskRewardRatio >= 3) {
      rrEvaluation = ' (🌟 Kèo R:R rất tốt)';
    } else if (order.riskRewardRatio >= 2) {
      rrEvaluation = ' (✅ Kèo chuẩn)';
    } else if (order.riskRewardRatio >= 1) {
      rrEvaluation = ' (⚠️ R:R bình thường)';
    } else {
      rrEvaluation = ' (🚨 Rủi ro cao hơn lợi nhuận)';
    }
    rrLine = `⚖️ <b>Tỷ lệ R:R:</b> <code>1 : ${order.riskRewardRatio}</code>${rrEvaluation}\n`;
  }

  const now = new Date();
  const timeStr = now.toLocaleTimeString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const dateStr = now.toLocaleDateString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  const orderIdText = order.id ? ` <code>#${order.id}</code>` : '';

  let msg = `${typeIcon} <b>THÔNG BÁO TÍN HIỆU: ${typeText}${symbolText}</b>${orderIdText}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `📍 <b>Giá vào (Entry):</b> <code>${entryStr}</code>\n`;
  msg += `${tpLine}\n`;
  msg += `${slLine}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n`;
  if (rrLine) msg += rrLine;
  msg += `⏰ <b>Thời gian:</b> <i>${timeStr} - ${dateStr}</i>\n`;
  msg += `📡 <i>Hệ thống tự động theo dõi giá realtime và bắn thông báo khi khớp!</i>`;

  return msg;
}
