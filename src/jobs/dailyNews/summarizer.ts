import axios from 'axios';
import { getConfig } from '../../core/env.js';
import { logger } from '../../core/logger.js';
import { generateArticleId } from './deduplicator.js';
import type { RawArticle } from './fetcher.js';
import type { DailyDigest, ProcessedArticle } from './formatter.js';

export function extractSmartSummary(snippet: string, maxSentences: number = 2): string {
  if (!snippet) return '';

  const sentences = snippet
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15 && !s.toLowerCase().includes('ảnh:') && !s.toLowerCase().includes('video:'));

  if (sentences.length === 0) {
    return snippet.length > 160 ? snippet.slice(0, 157) + '...' : snippet;
  }

  const selected = sentences.slice(0, maxSentences).join(' ');
  return selected.length > 200 ? selected.slice(0, 197) + '...' : selected;
}

interface AiSummaryResult {
  overview?: string;
  articleSummaries: Map<number, string>;
}

export async function summarizeWith9Router(
  articles: { id: number; category: string; title: string; snippet: string }[]
): Promise<AiSummaryResult | null> {
  const config = getConfig();
  const apiKey = config.NINE_ROUTER_API_KEY || config.OPENAI_API_KEY;

  if (!apiKey || articles.length === 0) {
    return null;
  }

  const baseUrl = config.NINE_ROUTER_BASE_URL.replace(/\/+$/, '');
  const model = config.NINE_ROUTER_MODEL || 'ag/gemini-3.7-flash-medium';

  logger.info(`🤖 Đang gửi ${articles.length} bài viết tới 9Router AI (${model})...`);

  try {
    const promptPayload = articles.map((a) => ({
      id: a.id,
      category: a.category,
      title: a.title,
      content: a.snippet || a.title,
    }));

    const response = await axios.post(
      `${baseUrl}/chat/completions`,
      {
        model,
        messages: [
          {
            role: 'system',
            content:
              'Bạn là hệ thống trích xuất và tổng hợp tin tức trọng tâm cho Telegram Bot.\n' +
              'QUY TẮC BẮT BUỘC:\n' +
              '- TUYỆT ĐỐI KHÔNG viết lời chào, lời dẫn nhập, không mào đầu ("Theo thông tin...", "Bài viết cho biết...").\n' +
              '- Đi THẲNG vào thông tin chính, sự kiện thực tế, số liệu cụ thể (giá, %, lượng tiền, thông số kỹ thuật, tên công cụ/mô hình/đối tượng).\n' +
              '- Bỏ qua mọi câu từ xã giao hay kết luận chung chung vô thưởng vô phạt.\n\n' +
              'Nhiệm vụ:\n' +
              '1. "overview": 3-4 câu tổng quan trực diện các diễn biến chính (vàng, chứng khoán, AI/tech, thời sự) bằng văn phong báo chí khách quan, sắc bén.\n' +
              '2. "articles": Tóm tắt 1-2 câu ngắn gọn, cung cấp trực tiếp bản chất sự việc, giải pháp hoặc số liệu then chốt. Nguồn tiếng Anh dịch chuẩn nghĩa kỹ thuật sang tiếng Việt.\n\n' +
              'Trả về kết quả ĐÚNG định dạng JSON sau:\n' +
              '{\n' +
              '  "overview": "...",\n' +
              '  "articles": [\n' +
              '    { "id": 1, "summary": "..." }\n' +
              '  ]\n' +
              '}',
          },
          {
            role: 'user',
            content: JSON.stringify(promptPayload),
          },
        ],
        stream: false,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    const rawContent = response.data?.choices?.[0]?.message?.content?.trim() || '';
    if (!rawContent) {
      logger.warn('9Router AI trả về nội dung rỗng.');
      return null;
    }

    // Loại bỏ markdown format json nếu có
    const cleaned = rawContent
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    const parsed = JSON.parse(cleaned);
    const articleSummaries = new Map<number, string>();

    if (Array.isArray(parsed.articles)) {
      for (const item of parsed.articles) {
        if (item && typeof item.id === 'number' && item.summary) {
          articleSummaries.set(item.id, String(item.summary).trim());
        }
      }
    }

    logger.info(`✅ 9Router AI đã tóm tắt thành công ${articleSummaries.size} bài viết.`);

    return {
      overview: typeof parsed.overview === 'string' ? parsed.overview.trim() : undefined,
      articleSummaries,
    };
  } catch (error: any) {
    logger.warn({ err: error.message }, '⚠️ Không thể gọi 9Router AI, chuyển sang dùng bộ tóm tắt RSS mặc định.');
    return null;
  }
}

export function buildDailyDigest(rawArticles: RawArticle[]): DailyDigest {
  const config = getConfig();
  const maxArticles = config.MAX_ARTICLES_PER_DIGEST;

  const categoryMap = new Map<string, RawArticle[]>();
  for (const article of rawArticles) {
    const list = categoryMap.get(article.category) || [];
    list.push(article);
    categoryMap.set(article.category, list);
  }

  const processedCategories: DailyDigest['categories'] = [];
  let totalCount = 0;

  for (const [categoryName, articles] of categoryMap.entries()) {
    if (totalCount >= maxArticles) break;

    const limitForCategory = Math.min(articles.length, Math.max(2, Math.floor(maxArticles / categoryMap.size)));
    const selectedArticles = articles.slice(0, limitForCategory);

    const processedList: ProcessedArticle[] = selectedArticles.map((raw) => {
      const summary = extractSmartSummary(raw.contentSnippet || '');
      return {
        id: generateArticleId(raw.link, raw.title),
        title: raw.title,
        summary: summary || raw.title,
        link: raw.link,
        category: raw.category,
        sourceName: raw.sourceName,
        publishedAt: raw.pubDate ? new Date(raw.pubDate) : new Date(),
      };
    });

    processedCategories.push({
      categoryName,
      articles: processedList,
    });

    totalCount += processedList.length;
  }

  const today = new Intl.DateTimeFormat('vi-VN', {
    timeZone: config.TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date());

  return {
    date: today,
    categories: processedCategories,
    totalArticles: totalCount,
  };
}

export async function buildDailyDigestAsync(rawArticles: RawArticle[]): Promise<DailyDigest> {
  const config = getConfig();
  const maxArticles = config.MAX_ARTICLES_PER_DIGEST;

  const categoryMap = new Map<string, RawArticle[]>();
  for (const article of rawArticles) {
    const list = categoryMap.get(article.category) || [];
    list.push(article);
    categoryMap.set(article.category, list);
  }

  const selectedRawArticles: { id: number; raw: RawArticle }[] = [];
  let currentId = 1;
  let totalCount = 0;

  for (const [, articles] of categoryMap.entries()) {
    if (totalCount >= maxArticles) break;
    const limitForCategory = Math.min(articles.length, Math.max(2, Math.floor(maxArticles / categoryMap.size)));
    const chosen = articles.slice(0, limitForCategory);
    for (const raw of chosen) {
      selectedRawArticles.push({ id: currentId++, raw });
    }
    totalCount += chosen.length;
  }

  // Gọi 9Router AI để tóm tắt thông minh
  const aiResult = await summarizeWith9Router(
    selectedRawArticles.map((item) => ({
      id: item.id,
      category: item.raw.category,
      title: item.raw.title,
      snippet: item.raw.contentSnippet || '',
    }))
  );

  const processedCategories: DailyDigest['categories'] = [];
  const processedByCat = new Map<string, ProcessedArticle[]>();

  for (const item of selectedRawArticles) {
    const raw = item.raw;
    const aiSummary = aiResult?.articleSummaries.get(item.id);
    const fallbackSummary = extractSmartSummary(raw.contentSnippet || '');
    const finalSummary = aiSummary || fallbackSummary || raw.title;

    const processedArt: ProcessedArticle = {
      id: generateArticleId(raw.link, raw.title),
      title: raw.title,
      summary: finalSummary,
      link: raw.link,
      category: raw.category,
      sourceName: raw.sourceName,
      publishedAt: raw.pubDate ? new Date(raw.pubDate) : new Date(),
    };

    const list = processedByCat.get(raw.category) || [];
    list.push(processedArt);
    processedByCat.set(raw.category, list);
  }

  for (const [categoryName, articles] of processedByCat.entries()) {
    processedCategories.push({
      categoryName,
      articles,
    });
  }

  const today = new Intl.DateTimeFormat('vi-VN', {
    timeZone: config.TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date());

  return {
    date: today,
    overview: aiResult?.overview,
    categories: processedCategories,
    totalArticles: selectedRawArticles.length,
  };
}
