import { describe, it, expect, beforeAll } from 'vitest';
import { extractSmartSummary, buildDailyDigest, buildDailyDigestAsync } from '../src/jobs/dailyNews/summarizer.js';
import type { RawArticle } from '../src/jobs/dailyNews/fetcher.js';

describe('Summarizer Service', () => {
  beforeAll(() => {
    process.env.TELEGRAM_BOT_TOKEN = 'mock_token';
    process.env.TELEGRAM_CHAT_ID = '123456789';
  });

  it('should extract 1-2 key sentences from raw snippet', () => {
    const snippet =
      'Hôm nay Bộ Công Thương thông báo điều chỉnh giá bán lẻ xăng dầu. Giá xăng RON 95 giảm 500 đồng mỗi lít. Trong khi đó giá dầu diesel giữ nguyên. Dự kiến mức giá này áp dụng từ chiều nay.';
    const summary = extractSmartSummary(snippet, 2);
    expect(summary).toContain('Hôm nay Bộ Công Thương thông báo');
    expect(summary).toContain('Giá xăng RON 95 giảm 500 đồng mỗi lít.');
    expect(summary).not.toContain('Trong khi đó giá dầu diesel giữ nguyên.');
  });

  it('should build daily digest grouped by categories', () => {
    const raw: RawArticle[] = [
      {
        title: 'Công nghệ 1',
        link: 'https://example.com/tech1',
        category: 'Công Nghệ',
        sourceName: 'VnExpress',
        contentSnippet: 'Mô tả tóm tắt công nghệ 1. Nội dung rất chi tiết.',
      },
      {
        title: 'Kinh Tế 1',
        link: 'https://example.com/econ1',
        category: 'Kinh Tế',
        sourceName: 'Tuổi Trẻ',
        contentSnippet: 'Mô tả tóm tắt kinh tế 1. Thị trường sôi động.',
      },
    ];

    const digest = buildDailyDigest(raw);
    expect(digest.totalArticles).toBe(2);
    expect(digest.categories.length).toBe(2);
    expect(digest.date).toBeDefined();
  });

  it('should build daily digest asynchronously with AI or fallback', async () => {
    const raw: RawArticle[] = [
      {
        title: 'Công nghệ 1',
        link: 'https://example.com/tech1',
        category: 'Công Nghệ',
        sourceName: 'VnExpress',
        contentSnippet: 'Mô tả tóm tắt công nghệ 1. Nội dung rất chi tiết.',
      },
    ];

    const digest = await buildDailyDigestAsync(raw);
    expect(digest.totalArticles).toBe(1);
    expect(digest.categories[0].articles[0].title).toBe('Công nghệ 1');
  }, 15000);
});
