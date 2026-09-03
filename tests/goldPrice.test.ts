import { vnAppMobClient } from '../src/jobs/goldPrice/vnAppMobClient.js';
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
  it('should be registered in jobRegistry with command /price_gold', () => {
    const job = jobRegistry.get('price-gold');
    expect(job).toBeDefined();
    expect(job?.command).toBe('price_gold');
  });

  it('should format SJC gold price correctly to HTML', () => {
    const mockSjc = {
      buy1L: 89000000,
      sell1L: 91000000,
      buyNhan1C: 88500000,
      sellNhan1C: 89500000,
      buyNuTrang9999: 88000000,
      sellNuTrang9999: 89000000,
      buyNuTrang99: 86000000,
      sellNuTrang99: 88000000,
      buyNuTrang75: 65000000,
      sellNuTrang75: 68000000,
      updatedAt: '2026-09-03T10:00:00.000Z',
    };
    const html = vnAppMobClient.formatSjcToHtml(mockSjc);
    expect(html).toContain('BẢNG GIÁ VÀNG SJC VIỆT NAM (REALTIME)');
    expect(html).toContain('VÀNG MIẾNG SJC (1 LƯỢNG)');
    expect(html).toContain('89,00');
    expect(html).toContain('91,00');
    expect(html).toContain('VÀNG NHẪN SJC');
  });

  it('should fetch live SJC gold price from VNAppMob API', async () => {
    const data = await vnAppMobClient.getSjcGoldPrice();
    expect(data).toBeDefined();
    expect(data.buy1L).toBeGreaterThan(0);
    expect(data.sell1L).toBeGreaterThan(0);
  }, 15000);
});
