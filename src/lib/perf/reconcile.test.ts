import { describe, expect, it } from 'vitest';
import { reconcile } from './reconcile';
import type { Trade } from './types';

const t = (symbol: string, side: 'BUY' | 'SELL', qty: number): Trade => ({
  orderId: `${symbol}${side}${qty}`,
  symbol,
  side,
  date: '2026-03-02',
  orderedAt: '2026-03-02T09:00:00+09:00',
  qty,
  price: 1,
  amount: qty,
  commission: 0,
  tax: 0,
});

describe('reconcile', () => {
  it('compares the summed orders with holdings and explains the gap', () => {
    const r = reconcile(
      [t('A', 'BUY', 10), t('A', 'SELL', 4), t('B', 'BUY', 5), t('C', 'BUY', 3), t('D', 'BUY', 2), t('D', 'SELL', 2)],
      [
        { symbol: 'A', name: '에이', quantity: 6 },
        { symbol: 'B', name: '비', quantity: 7 },
        { symbol: 'C', name: '씨', quantity: 1 },
        { symbol: 'E', name: '이', quantity: 4 },
      ],
    );
    expect(r.bySymbol.get('A')).toEqual({ status: 'ok', computed: 6, held: 6 });
    expect(r.bySymbol.get('B')).toEqual({ status: 'more', computed: 5, held: 7 });
    expect(r.bySymbol.get('C')).toEqual({ status: 'less', computed: 3, held: 1 });
    expect(r.bySymbol.get('D')).toEqual({ status: 'ok', computed: 0, held: 0 });
    expect(r.unrecorded).toEqual([{ symbol: 'E', name: '이', quantity: 4 }]);
    expect(r.mismatches).toBe(3);
  });

  it('cannot check without holdings', () => {
    const r = reconcile([t('A', 'BUY', 10)], null);
    expect(r.bySymbol.get('A')).toEqual({ status: 'unknown', computed: 10, held: null });
    expect(r.unrecorded).toEqual([]);
    expect(r.mismatches).toBe(0);
  });

  it('counts in post-split shares when given split factors', () => {
    // 분할 전 10주(배율 2) 매수, 분할 뒤 5주 매도 → 지금 15주
    const trades = [t('A', 'BUY', 10), t('A', 'SELL', 5)];
    const factors = new Map([[trades[0].orderId, 2], [trades[1].orderId, 1]]);
    const r = reconcile(trades, [{ symbol: 'A', name: '에이', quantity: 15 }], factors);
    expect(r.bySymbol.get('A')).toEqual({ status: 'ok', computed: 15, held: 15 });
    expect(r.mismatches).toBe(0);
  });
});
