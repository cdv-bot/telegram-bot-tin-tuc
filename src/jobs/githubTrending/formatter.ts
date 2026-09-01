import { escapeHtml } from '../../core/deliveryService.js';
import type { TrendingRepo } from './fetcher.js';

/**
 * Định dạng danh sách GitHub Trending repositories sang tin nhắn HTML Telegram
 */
export function formatGitHubTrendingToHtml(
  repos: TrendingRepo[],
  options: { language?: string; since?: string } = {}
): string[] {
  const parts: string[] = [];
  const sinceLabel =
    options.since === 'weekly' ? 'Tuần này' : options.since === 'monthly' ? 'Tháng này' : 'Hôm nay';
  const langLabel = options.language ? ` (${options.language})` : '';

  let header = `🔥 <b>TOP GITHUB TRENDING ${langLabel.toUpperCase()} - ${sinceLabel.toUpperCase()}</b>\n`;
  header += `━━━━━━━━━━━━━━━━━━━━\n\n`;

  if (repos.length === 0) {
    return [`${header}<i>Hiện không tìm thấy repository thịnh hành nào.</i>`];
  }

  let currentMsg = header;

  repos.forEach((repo, index) => {
    const rank = index + 1;
    const name = escapeHtml(repo.name);
    const desc = repo.description ? escapeHtml(repo.description) : '<i>Không có mô tả</i>';
    const lang = escapeHtml(repo.language);
    const stars = Number(repo.stars).toLocaleString('en-US') || repo.stars;
    const forks = Number(repo.forks).toLocaleString('en-US') || repo.forks;
    const starsToday = repo.starsToday ? ` | 📈 <i>${escapeHtml(repo.starsToday)}</i>` : '';

    let repoBlock = `<b>${rank}.</b> <a href="${repo.url}"><b>${name}</b></a>\n`;
    repoBlock += `📝 ${desc}\n`;
    repoBlock += `🏷️ <code>${lang}</code> | ⭐ <b>${stars}</b> | 🍴 ${forks}${starsToday}\n\n`;

    if (currentMsg.length + repoBlock.length > 3800) {
      parts.push(currentMsg.trim());
      currentMsg = `🔥 <b>TOP GITHUB TRENDING (Tiếp)</b>\n━━━━━━━━━━━━━━━━━━━━\n\n` + repoBlock;
    } else {
      currentMsg += repoBlock;
    }
  });

  if (currentMsg.trim().length > 0) {
    parts.push(currentMsg.trim());
  }

  return parts;
}
