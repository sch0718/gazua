import { describe, expect, it } from 'vitest';
import type { AccountOrder } from '../providers/types';
import { normalizeOrders } from './ledger';

const o = (over: Partial<AccountOrder>): AccountOrder => ({
  orderId: 'x',
  symbol: '005930',
  side: 'BUY',
  status: 'FILLED',
  currency: 'KRW',
  orderedAt: '2026-03-02T09:00:00+09:00',
  filledAt: '2026-03-02T09:01:00+09:00',
  quantity: 1,
  price: 100,
  amount: 100,
  commission: 0,
  tax: 0,
  ...over,
});

describe('normalizeOrders', () => {
  it('keeps KRW only, counts the rest, dates by fill time in KST, sorts by date then buys first then order time', () => {
    const { trades, foreign } = normalizeOrders([
      o({ orderId: 's1', side: 'SELL', orderedAt: '2026-03-02T09:00:00+09:00' }),
      o({ orderId: 'b1', orderedAt: '2026-03-02T10:00:00+09:00', filledAt: '2026-03-02T10:00:00+09:00' }),
      o({ orderId: 'us', currency: 'USD', symbol: 'AAPL' }),
      // 밤늦게 주문해 다음 날 체결: 체결일로 센다(UTC로 읽으면 전날이 된다)
      o({ orderId: 'b0', orderedAt: '2026-02-27T23:00:00+09:00', filledAt: '2026-03-01T00:30:00+09:00' }),
      o({ orderId: 'nofill', orderedAt: '2026-02-20T09:00:00+09:00', filledAt: null }),
    ]);
    expect(foreign).toBe(1);
    expect(trades.map((t) => [t.orderId, t.date])).toEqual([
      ['nofill', '2026-02-20'],
      ['b0', '2026-03-01'],
      ['b1', '2026-03-02'],
      ['s1', '2026-03-02'],
    ]);
  });

  it('drops duplicate order ids and rows with a bad date', () => {
    const { trades, dropped } = normalizeOrders([o({ orderId: 'a' }), o({ orderId: 'a' }), o({ orderId: 'b', orderedAt: 'x', filledAt: null })]);
    expect(trades.map((t) => t.orderId)).toEqual(['a']);
    expect(dropped).toBe(1);
  });
});
