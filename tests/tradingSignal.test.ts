import { describe, it, expect } from 'vitest';
import { parseTradeOrder } from '../src/jobs/tradingSignal/parser.js';
import { formatTradeOrderToHtml } from '../src/jobs/tradingSignal/formatter.js';
import { orderTracker } from '../src/jobs/tradingSignal/orderTracker.js';

describe('Trading Signal Parser, Formatter & Order Tracker (Forex Standard)', () => {
  it('should parse Buy Limit order with exact numbers and not round', () => {
    const res = parseTradeOrder('/bl 4426 4427 4425');
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.order.orderType).toBe('BUY_LIMIT');
      expect(res.order.entry).toBe(4426);
      expect(res.order.tp).toBe(4427);
      expect(res.order.sl).toBe(4425);
      expect(res.order.reward).toBe(1);
      expect(res.order.risk).toBe(1);
      expect(res.order.riskRewardRatio).toBe(1);
    }
  });

  it('should parse Sell Limit with /sl command', () => {
    const res = parseTradeOrder('/sl 4430 4425 4435');
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.order.orderType).toBe('SELL_LIMIT');
      expect(res.order.entry).toBe(4430);
      expect(res.order.tp).toBe(4425);
      expect(res.order.sl).toBe(4435);
      expect(res.order.reward).toBe(5);
      expect(res.order.risk).toBe(5);
      expect(res.order.riskRewardRatio).toBe(1);
    }
  });

  it('should parse Sell Limit with Entry only using /sl 4430', () => {
    const res = parseTradeOrder('/sl 4430');
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.order.orderType).toBe('SELL_LIMIT');
      expect(res.order.entry).toBe(4430);
      expect(res.order.tp).toBeUndefined();
      expect(res.order.sl).toBeUndefined();
    }
  });

  it('should validate Buy Limit TP > Entry and SL < Entry', () => {
    // TP lower than entry -> invalid for Buy Limit
    const res1 = parseTradeOrder('/bl 3480 3460 3450');
    expect(res1.success).toBe(false);

    // SL higher than entry -> invalid for Buy Limit
    const res2 = parseTradeOrder('/bl 3480 3520 3490');
    expect(res2.success).toBe(false);

    // Standard Buy Limit: Entry 3480, TP 3520, SL 3460 -> valid
    const res3 = parseTradeOrder('/bl 3480 3520 3460');
    expect(res3.success).toBe(true);
  });

  it('should validate Sell Limit TP < Entry and SL > Entry', () => {
    // TP higher than entry -> invalid for Sell Limit
    const res1 = parseTradeOrder('/sl 3530 3550 3560');
    expect(res1.success).toBe(false);

    // SL lower than entry -> invalid for Sell Limit
    const res2 = parseTradeOrder('/sl 3530 3500 3520');
    expect(res2.success).toBe(false);

    // Standard Sell Limit: Entry 3530, TP 3500, SL 3550 -> valid
    const res3 = parseTradeOrder('/sl 3530 3500 3550');
    expect(res3.success).toBe(true);
  });

  it('should support Entry only without required TP or SL (/bl 4420)', () => {
    const res = parseTradeOrder('/bl 4420');
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.order.orderType).toBe('BUY_LIMIT');
      expect(res.order.entry).toBe(4420);
      expect(res.order.tp).toBeUndefined();
      expect(res.order.sl).toBeUndefined();
      expect(res.order.reward).toBeUndefined();
      expect(res.order.riskRewardRatio).toBeUndefined();

      const html = formatTradeOrderToHtml(res.order);
      expect(html).toContain('4420');
      expect(html).toContain('Không đặt');
    }
  });

  it('should format trading card to HTML with exact unrounded numbers', () => {
    const parsed = parseTradeOrder('/bl 4426 4427 4425');
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const html = formatTradeOrderToHtml(parsed.order);
      expect(html).toContain('4426');
      expect(html).toContain('4427');
      expect(html).toContain('4425');
      expect(html).not.toContain('4,426');
    }
  });

  it('should manage and track limit orders in orderTracker', () => {
    const parsed = parseTradeOrder('/sl 4430');
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const order = orderTracker.addOrder(parsed.order, 'test-chat-123');
      expect(order.id).toBeDefined();
      expect(order.status).toBe('PENDING');

      const active = orderTracker.getActiveOrders('test-chat-123');
      expect(active.some((o) => o.id === order.id)).toBe(true);

      const deleted = orderTracker.deleteOrder(order.id, 'test-chat-123');
      expect(deleted).toBe(true);
    }
  });
});
