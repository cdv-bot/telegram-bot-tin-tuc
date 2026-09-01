import crypto from 'crypto';
import { db } from '../../core/database.js';
import { logger } from '../../core/logger.js';
import type { RawArticle } from './fetcher.js';

export interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  sentAt: string;
}

interface NewsRow {
  id: string;
  url: string;
  title: string;
  sent_at: string;
}

const HISTORY_RETENTION_HOURS = 48;

export function loadHistory(): HistoryEntry[] {
  try {
    const cutoff = new Date(Date.now() - HISTORY_RETENTION_HOURS * 60 * 60 * 1000).toISOString();
    // Tự động dọn dẹp các bản ghi cũ hơn 48h
    db.prepare(`DELETE FROM news_history WHERE sent_at < ?`).run(cutoff);

    // Lấy các bài báo đã gửi còn trong thời hạn lưu trữ
    const rows = db.prepare(
      `SELECT * FROM news_history WHERE sent_at >= ? ORDER BY sent_at DESC`
    ).all(cutoff) as NewsRow[];

    return rows.map((r) => ({
      id: r.id,
      url: r.url,
      title: r.title,
      sentAt: r.sent_at,
    }));
  } catch (error) {
    logger.error({ error }, 'Lỗi đọc news_history từ SQLite, khởi tạo danh sách trống.');
    return [];
  }
}

export function saveHistory(entries: HistoryEntry[]) {
  try {
    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO news_history (id, url, title, sent_at)
      VALUES (@id, @url, @title, @sentAt)
    `);
    const insertMany = db.transaction((list: HistoryEntry[]) => {
      for (const item of list) {
        insertStmt.run({
          id: item.id,
          url: item.url,
          title: item.title,
          sentAt: item.sentAt || new Date().toISOString(),
        });
      }
    });
    insertMany(entries);
  } catch (error) {
    logger.error({ error }, 'Lỗi lưu news_history vào SQLite');
  }
}

export function recordSentArticles(articles: { link: string; title: string }[]) {
  const now = new Date().toISOString();
  const entries: HistoryEntry[] = articles.map((a) => ({
    id: generateArticleId(a.link, a.title),
    url: a.link,
    title: a.title,
    sentAt: now,
  }));
  saveHistory(entries);
}

export function generateArticleId(url: string, title: string): string {
  return crypto.createHash('md5').update(`${url}:${title}`).digest('hex');
}

export function normalizeText(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2);
}

export function calculateTitleSimilarity(titleA: string, titleB: string): number {
  const tokensA = new Set(normalizeText(titleA));
  const tokensB = new Set(normalizeText(titleB));

  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  const intersection = new Set([...tokensA].filter((x) => tokensB.has(x)));
  const union = new Set([...tokensA, ...tokensB]);

  return intersection.size / union.size;
}

export function filterAndDeduplicateArticles(
  rawArticles: RawArticle[],
  similarityThreshold: number = 0.55
): RawArticle[] {
  const history = loadHistory();
  const historyUrls = new Set(history.map((h) => h.url));
  const historyTitles = history.map((h) => h.title);

  const freshArticles: RawArticle[] = [];

  for (const article of rawArticles) {
    if (historyUrls.has(article.link)) continue;

    const isSimilarToHistory = historyTitles.some(
      (historyTitle) => calculateTitleSimilarity(article.title, historyTitle) >= similarityThreshold
    );
    if (isSimilarToHistory) continue;

    const isDuplicateInBatch = freshArticles.some(
      (chosen) =>
        calculateTitleSimilarity(article.title, chosen.title) >= similarityThreshold ||
        chosen.link === article.link
    );
    if (isDuplicateInBatch) continue;

    freshArticles.push(article);
  }

  logger.info(
    `Lọc trùng: ${rawArticles.length} bài thô -> ${freshArticles.length} bài mới duy nhất.`
  );

  return freshArticles;
}
