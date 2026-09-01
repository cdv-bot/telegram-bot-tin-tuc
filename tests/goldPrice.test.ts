import { describe, it, expect } from 'vitest';
import { fetchRealtimeGoldPrice, fetchAllMetalsPrice } from '../src/jobs/goldPrice/fetcher.js';
import { formatGoldPriceToHtml } from '../src/jobs/goldPrice/formatter.js';
import { jobRegistry } from '../src/core/jobRegistry.js';
import '../src/jobs/index.js';

describe('Gold Price Job & API', () => {
  it('should format gold & silver price correctly to HTML', () => {
    const mockMetals = {
      gold: {
        symbol: 'XAU',
        name: 'Gold',
        price: 2900.5,
        currency: 'USD',
        currencySymbol: '$',
        updatedAt: '2026-09-01T04:00:00Z',
      },
      silver: {
        symbol: 'XAG',
        name: 'Silver',
        price: 33.25,
        currency: 'USD',
        currencySymbol: '$',
        updatedAt: '2026-09-01T04:00:00Z',
      },
    };

    const html = formatGoldPriceToHtml(mockMetals);
    expect(html).toContain('GIÁ VÀNG & KIM LOẠI QUÝ REALTIME');
    expect(html).toContain('VÀNG THẾ GIỚI (XAU/USD)');
    expect(html).toContain('2,900.50');
    expect(html).toContain('BẠC THẾ GIỚI (XAG/USD)');
    expect(html).toContain('33.25');
  });

  it('should be registered in jobRegistry with command /gold', () => {
    const job = jobRegistry.get('gold-price');
    expect(job).toBeDefined();
    expect(job?.command).toBe('gold');
  });

  it('should fetch live realtime gold price from Gold Price API', async () => {
    const data = await fetchRealtimeGoldPrice('XAU');
    expect(data).toBeDefined();
    expect(data.symbol).toMatch(/^XAU/);
    expect(typeof data.price).toBe('number');
    expect(data.price).toBeGreaterThan(0);
  }, 15000);

  it('should fetch all metals (Gold + Silver)', async () => {
    const metals = await fetchAllMetalsPrice();
    expect(metals.gold).toBeDefined();
    expect(metals.gold.price).toBeGreaterThan(0);
  }, 15000);
});
