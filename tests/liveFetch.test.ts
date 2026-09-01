import { describe, it, expect } from 'vitest';
import { fetchArticlesFromSource } from '../src/jobs/dailyNews/fetcher.js';
import { extractSmartSummary } from '../src/jobs/dailyNews/summarizer.js';

describe('Live RSS Fetching Verification', () => {
  it('should fetch and parse articles from VnExpress RSS', async () => {
    const articles = await fetchArticlesFromSource({
      category: '🔥 Tin Nổi Bật',
      name: 'VnExpress Tin Nổi Bật',
      url: 'https://vnexpress.net/rss/tin-noi-bat.rss',
      enabled: true,
    });

    expect(articles.length).toBeGreaterThan(0);
    const first = articles[0]!;
    expect(first.title).toBeDefined();
    expect(first.link).toMatch(/^https?:\/\//);
    expect(first.contentSnippet).toBeDefined();

    const summary = extractSmartSummary(first.contentSnippet || '');
    expect(summary.length).toBeGreaterThan(0);
  }, 15000);
});
