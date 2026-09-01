import { escapeHtml } from '../../core/deliveryService.js';

export interface ProcessedArticle {
  id: string;
  title: string;
  summary: string;
  link: string;
  category: string;
  sourceName: string;
  publishedAt: Date;
}

export interface DailyDigest {
  date: string;
  overview?: string;
  categories: {
    categoryName: string;
    articles: ProcessedArticle[];
  }[];
  totalArticles: number;
}

export function formatDigestToHtml(digest: DailyDigest): string[] {
  const parts: string[] = [];
  let currentMsg = '';

  const header = `📰 <b>ĐIỂM TIN ${digest.date}</b>\n\n`;
  currentMsg += header;

  if (digest.categories.length === 0 || digest.totalArticles === 0) {
    currentMsg += `<i>Chưa có tin tức mới.</i>\n`;
    return [currentMsg];
  }

  if (digest.overview) {
    currentMsg += `💡 <b>TỔNG QUAN:</b>\n${escapeHtml(digest.overview)}\n\n`;
  }

  for (const cat of digest.categories) {
    let catBlock = `📌 <b>${escapeHtml(cat.categoryName.toUpperCase())}</b>\n`;

    for (const article of cat.articles) {
      const title = escapeHtml(article.title);
      const summary = escapeHtml(article.summary);
      const link = article.link;
      const source = escapeHtml(article.sourceName);

      catBlock += `• <a href="${link}"><b>${title}</b></a> <i>(${source})</i>\n`;
      if (summary && summary !== article.title) {
        catBlock += `  ${summary}\n\n`;
      } else {
        catBlock += `\n`;
      }
    }

    if (currentMsg.length + catBlock.length > 3800) {
      parts.push(currentMsg.trim());
      currentMsg = `📰 <b>ĐIỂM TIN (Tiếp)</b>\n\n` + catBlock;
    } else {
      currentMsg += catBlock;
    }
  }

  if (currentMsg.trim().length > 0) {
    parts.push(currentMsg.trim());
  }

  return parts;
}
