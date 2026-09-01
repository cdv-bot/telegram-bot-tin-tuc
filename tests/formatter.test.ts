import { describe, it, expect } from 'vitest';
import { formatDigestToHtml, type DailyDigest } from '../src/jobs/dailyNews/formatter.js';
import { escapeHtml, formatAdminAlertHtml, splitMessageToSafeChunks } from '../src/core/deliveryService.js';

describe('Message Formatter & Delivery Helpers', () => {
  it('should escape HTML characters safely', () => {
    const raw = 'Tin tức: <Công nghệ & Đời sống> "Hot"';
    const escaped = escapeHtml(raw);
    expect(escaped).toBe('Tin tức: &lt;Công nghệ &amp; Đời sống&gt; "Hot"');
  });

  it('should split long messages into safe chunks', () => {
    const longText = 'A'.repeat(5000) + '\n' + 'B'.repeat(2000);
    const chunks = splitMessageToSafeChunks(longText, 3900);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(5100);
    }
  });

  it('should format a structured DailyDigest into Telegram HTML messages', () => {
    const digest: DailyDigest = {
      date: '19/08/2026',
      totalArticles: 2,
      categories: [
        {
          categoryName: '💻 Công Nghệ',
          articles: [
            {
              id: '1',
              title: 'Trí tuệ nhân tạo thế hệ mới',
              summary: 'Mô hình AI mới đạt hiệu năng vượt trội trong xử lý ngôn ngữ.',
              link: 'https://example.com/ai',
              category: '💻 Công Nghệ',
              sourceName: 'VnExpress',
              publishedAt: new Date(),
            },
          ],
        },
      ],
    };

    const parts = formatDigestToHtml(digest);
    expect(parts.length).toBeGreaterThanOrEqual(1);

    const fullMessage = parts.join('\n');
    expect(fullMessage).toContain('19/08/2026');
    expect(fullMessage).toContain('CÔNG NGHỆ');
    expect(fullMessage).toContain('Trí tuệ nhân tạo thế hệ mới');
    expect(fullMessage).toContain('https://example.com/ai');
  });

  it('should format admin alert message correctly', () => {
    const alert = formatAdminAlertHtml('daily-news', 'Telegram API timeout', 3);
    expect(alert).toContain('CẢNH BÁO HỆ THỐNG');
    expect(alert).toContain('JOB: daily-news');
    expect(alert).toContain('3');
    expect(alert).toContain('Telegram API timeout');
  });
});
