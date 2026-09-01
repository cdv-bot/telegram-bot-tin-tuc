import { describe, it, expect } from 'vitest';
import {
  calculateTitleSimilarity,
  normalizeText,
  filterAndDeduplicateArticles,
} from '../src/jobs/dailyNews/deduplicator.js';
import type { RawArticle } from '../src/jobs/dailyNews/fetcher.js';

describe('Deduplicator & Similarity Service', () => {
  it('should normalize Vietnamese text correctly', () => {
    const tokens = normalizeText('Trí tuệ nhân tạo (AI) đang bùng nổ mạnh mẽ tại Việt Nam!');
    expect(tokens).toContain('tri');
    expect(tokens).toContain('tue');
    expect(tokens).toContain('nhan');
    expect(tokens).toContain('viet');
    expect(tokens).toContain('nam');
  });

  it('should detect high similarity for similar titles from different news sources', () => {
    const titleA = 'Giá xăng dầu hôm nay 19/8 tiếp tục giảm mạnh';
    const titleB = 'Giá xăng dầu ngày 19/8 hôm nay giảm sâu';
    const similarity = calculateTitleSimilarity(titleA, titleB);
    expect(similarity).toBeGreaterThanOrEqual(0.5);
  });

  it('should detect low similarity for unrelated titles', () => {
    const titleA = 'Apple ra mắt iPhone mới với nhiều cải tiến';
    const titleB = 'Giá vàng trong nước biến động khó lường';
    const similarity = calculateTitleSimilarity(titleA, titleB);
    expect(similarity).toBeLessThan(0.3);
  });

  it('should filter out duplicate articles from the batch', () => {
    const raw: RawArticle[] = [
      {
        title: 'Thị trường chứng khoán tăng điểm mạnh phiên đầu tuần',
        link: 'https://source1.com/chungkhoan',
        category: 'Kinh Doanh',
        sourceName: 'Nguồn 1',
      },
      {
        title: 'Thị trường chứng khoán tăng điểm mạnh trong phiên đầu tuần',
        link: 'https://source2.com/chungkhoan',
        category: 'Kinh Doanh',
        sourceName: 'Nguồn 2',
      },
      {
        title: 'Phát hiện công nghệ pin mới giúp xe điện chạy 1000km',
        link: 'https://source1.com/pin-xe-dien',
        category: 'Công Nghệ',
        sourceName: 'Nguồn 1',
      },
    ];

    const filtered = filterAndDeduplicateArticles(raw, 0.5);
    expect(filtered.length).toBe(2);
    expect(filtered[0]?.title).toBe('Thị trường chứng khoán tăng điểm mạnh phiên đầu tuần');
    expect(filtered[1]?.title).toBe('Phát hiện công nghệ pin mới giúp xe điện chạy 1000km');
  });
});
