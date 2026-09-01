import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PATHS } from '../../core/env.js';
import { logger } from '../../core/logger.js';
import type { RawArticle } from './fetcher.js';

interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  sentAt: string;
}

const historyFilePath = path.join(PATHS.data, 'history.json');
const HISTORY_RETENTION_HOURS = 48;

export function loadHistory(): HistoryEntry[] {
  try {
    if (!fs.existsSync(historyFilePath)) {
      return [];
    }
    const data = fs.readFileSync(historyFilePath, 'utf-8');
    const list: HistoryEntry[] = JSON.parse(data);
    const cutoff = Date.now() - HISTORY_RETENTION_HOURS * 60 * 60 * 1000;
    return list.filter((item) => new Date(item.sentAt).getTime() > cutoff);
  } catch (error) {
    logger.error({ error }, 'Lỗi đọc history.json, khởi tạo danh sách trống.');
    return [];
  }
}

export function saveHistory(entries: HistoryEntry[]) {
  try {
    fs.writeFileSync(historyFilePath, JSON.stringify(entries, null, 2), 'utf-8');
  } catch (error) {
    logger.error({ error }, 'Lỗi lưu history.json');
  }
}

export function recordSentArticles(articles: { link: string; title: string }[]) {
  const current = loadHistory();
  const now = new Date().toISOString();
  for (const a of articles) {
    const id = generateArticleId(a.link, a.title);
    current.push({
      id,
      url: a.link,
      title: a.title,
      sentAt: now,
    });
  }
  saveHistory(current);
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
