import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountOrder, AccountSource } from '../providers/types';
import { kstEpoch } from '../time/kst';
import { createMemoryOrderCache, createOrderCache, orderCacheKey, syncOrders, type OrderCache } from './orderCache';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

const order = (id: string, date: string, status = 'FILLED'): AccountOrder => ({
  orderId: id,
  symbol: '005930',
  side: 'BUY',
  status,
  currency: 'KRW',
  orderedAt: `${date}T09:00:00+09:00`,
  filledAt: `${date}T09:01:00+09:00`,
  quantity: 1,
  price: 100,
  amount: 100,
  commission: 0,
  tax: 0,
});

function fakeSource(pages: AccountOrder[][]) {
  const calls: Array<{ from?: string }> = [];
  let n = 0;
  const source: AccountSource = {
    accountId: async () => '3',
    holdings: async () => [],
    closedOrders: async (opts = {}) => {
      calls.push({ from: opts.from });
      const rows = pages[Math.min(n++, pages.length - 1)];
      opts.onPage?.(rows.length);
      return rows;
    },
  };
  return { source, calls };
}

describe('order cache', () => {
  for (const [name, make] of [
    ['IndexedDB', () => createOrderCache('gazua-account')],
    ['memory', () => createMemoryOrderCache()],
  ] as const) {
    it(`${name}: stores entries and removes a profile's entries only`, async () => {
      const cache: OrderCache = make();
      const entry = { orders: [order('a', '2026-03-02')], syncedAt: 1, syncedThrough: '2026-03-02' };
      await cache.put(orderCacheKey('p1', 'toss', '3'), entry);
      await cache.put(orderCacheKey('p2', 'toss', '3'), entry);
      expect(await cache.get(orderCacheKey('p1', 'toss', '3'))).toEqual(entry);
      await cache.removeProfile('p1');
      expect(await cache.get(orderCacheKey('p1', 'toss', '3'))).toBeUndefined();
      expect(await cache.get(orderCacheKey('p2', 'toss', '3'))).toEqual(entry);
    });
  }

  it('falls back to memory when IndexedDB cannot open', async () => {
    vi.stubGlobal('indexedDB', {
      open() {
        throw new Error('blocked');
      },
    });
    try {
      const cache = createOrderCache('gazua-account');
      const entry = { orders: [], syncedAt: 1, syncedThrough: '2026-03-02' };
      await cache.put('p|toss|3', entry);
      expect(await cache.get('p|toss|3')).toEqual(entry);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('syncOrders', () => {
  const NOW = kstEpoch('2026-10-16', '10:00:00');

  it('fetches everything the first time, then from a week before the last sync, overwriting by order id', async () => {
    const cache = createMemoryOrderCache();
    const { source, calls } = fakeSource([
      [order('a', '2026-03-02'), order('b', '2026-10-10', 'PARTIAL_FILLED')],
      [order('b', '2026-10-10'), order('c', '2026-10-20')],
    ]);
    const first = await syncOrders({ source, cache, key: 'k', now: NOW });
    expect(first.orders.map((o) => o.orderId)).toEqual(['a', 'b']);
    expect(first.syncedAt).toBe(NOW);
    const later = NOW + 5 * 86_400_000;
    const second = await syncOrders({ source, cache, key: 'k', now: later });
    expect(calls).toEqual([{ from: undefined }, { from: '2026-10-09' }]);
    expect(second.orders.map((o) => [o.orderId, o.status])).toEqual([
      ['a', 'FILLED'],
      ['b', 'FILLED'],
      ['c', 'FILLED'],
    ]);
    expect(await cache.get('k')).toMatchObject({ syncedAt: later, syncedThrough: '2026-10-21' });
  });

  it('starts over when asked, and reports rows as pages arrive', async () => {
    const cache = createMemoryOrderCache();
    await cache.put('k', { orders: [order('old', '2026-01-02')], syncedAt: 1, syncedThrough: '2026-10-01' });
    const { source, calls } = fakeSource([[order('a', '2026-03-02')]]);
    const pages: number[] = [];
    const r = await syncOrders({ source, cache, key: 'k', now: NOW, full: true, onPage: (n) => pages.push(n) });
    expect(calls).toEqual([{ from: undefined }]);
    expect(r.orders.map((o) => o.orderId)).toEqual(['a']);
    expect(pages).toEqual([1]);
  });

  it('keeps going when the cache fails', async () => {
    const broken: OrderCache = {
      get: async () => {
        throw new Error('x');
      },
      put: async () => {
        throw new Error('x');
      },
      removeProfile: async () => {},
    };
    const { source } = fakeSource([[order('a', '2026-03-02')]]);
    const r = await syncOrders({ source, cache: broken, key: 'k', now: NOW });
    expect(r.orders.map((o) => o.orderId)).toEqual(['a']);
  });
});
