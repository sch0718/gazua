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

  // PR 리뷰: 거래마다 반올림하면 1:3 병합 전 1주씩 30번 산 계좌가 9.99999주가 된다
  it('does not round each step: thirty 1/3 shares add up to exactly 10', () => {
    const trades = Array.from({ length: 30 }, (_, i) => ({ ...t('A', 'BUY', 1), orderId: `b${i}` }));
    const factors = new Map(trades.map((x) => [x.orderId, 1 / 3]));
    expect(reconcile(trades, [{ symbol: 'A', name: '에이', quantity: 10 }], factors).bySymbol.get('A')).toEqual({ status: 'ok', computed: 10, held: 10 });
  });
});
