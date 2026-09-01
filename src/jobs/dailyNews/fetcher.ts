import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import fs from 'fs';
import { PATHS } from '../../core/env.js';
import { logger } from '../../core/logger.js';

export interface NewsSource {
  category: string;
  name: string;
  url: string;
  enabled: boolean;
}

export interface RawArticle {
  title: string;
  link: string;
  pubDate?: string;
  contentSnippet?: string;
  content?: string;
  category: string;
  sourceName: string;
}

const parser = new Parser({
  timeout: 10000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 TelegramNewsBot/2.0',
    Accept: 'application/rss+xml, application/xml, text/xml, */*',
  },
});

export function loadNewsSources(): NewsSource[] {
  try {
    if (!fs.existsSync(PATHS.sourcesConfig)) {
      return [
        {
          category: '🔥 Tin Nổi Bật',
          name: 'VnExpress Tin Nổi Bật',
          url: 'https://vnexpress.net/rss/tin-noi-bat.rss',
          enabled: true,
        },
      ];
    }
    const data = fs.readFileSync(PATHS.sourcesConfig, 'utf-8');
    const sources: NewsSource[] = JSON.parse(data);
    return sources.filter((s) => s.enabled);
  } catch (error) {
    logger.error({ error }, 'Lỗi đọc cấu hình sources.json');
    return [];
  }
}

export function cleanHtmlText(rawText: string | undefined): string {
  if (!rawText) return '';
  try {
    const $ = cheerio.load(rawText);
    $('img, script, style, a').remove();
    let text = $.text().trim();
    return text.replace(/\s+/g, ' ');
  } catch {
    return rawText.replace(/<[^>]*>?/gm, '').trim();
  }
}

export async function fetchArticlesFromSource(source: NewsSource): Promise<RawArticle[]> {
  try {
    const feed = await parser.parseURL(source.url);
    const articles: RawArticle[] = [];

    for (const item of feed.items || []) {
      if (!item.title || !item.link) continue;

      const snippet = cleanHtmlText(item.contentSnippet || item.content || item.summary);

      articles.push({
        title: item.title.trim(),
        link: item.link.trim(),
        pubDate: item.pubDate || item.isoDate,
        contentSnippet: snippet,
        content: item.content,
        category: source.category,
        sourceName: source.name,
      });
    }

    return articles;
  } catch (error: any) {
    logger.warn({ err: error.message, source: source.name }, `Không thể lấy RSS từ [${source.name}]`);
    return [];
  }
}

export async function fetchAllSources(): Promise<RawArticle[]> {
  const sources = loadNewsSources();
  logger.info(`Đang thu thập tin tức từ ${sources.length} nguồn RSS...`);

  const results = await Promise.allSettled(sources.map((source) => fetchArticlesFromSource(source)));
  const allArticles: RawArticle[] = [];
  for (const res of results) {
    if (res.status === 'fulfilled') {
      allArticles.push(...res.value);
    }
  }

  logger.info(`Tổng cộng đã thu thập được ${allArticles.length} bài viết.`);
  return allArticles;
}
