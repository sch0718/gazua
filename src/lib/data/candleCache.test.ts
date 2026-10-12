import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { createCandleCache } from './candleCache';
import type { Candle } from './metrics';

const bar = (t: number, c = 100): Candle => ({ t, o: c, h: c, l: c, c, v: 10 });

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('candle cache', () => {
  it('stores and returns candles; permanent entries never expire', async () => {
    const clock = { now: 1_000 };
    const cache = createCandleCache('gazua-cache', () => clock.now);
    await cache.put('kis|005930|KRX|1m|2026-10-08', [bar(1)], null);
    clock.now += 365 * 86_400_000;
    expect(await cache.get('kis|005930|KRX|1m|2026-10-08')).toEqual([bar(1)]);
    expect(await cache.get('kis|005930|KRX|1m|2026-10-07')).toBeUndefined();
  });

  it('expires entries after their TTL and deletes them', async () => {
    const clock = { now: 1_000 };
    const cache = createCandleCache('gazua-cache', () => clock.now);
    await cache.put('kis|005930|KRX|1m|2026-10-08', [bar(1)], 60_000);
    clock.now += 59_000;
    expect(await cache.get('kis|005930|KRX|1m|2026-10-08')).toEqual([bar(1)]);
    clock.now += 2_000;
    expect(await cache.get('kis|005930|KRX|1m|2026-10-08')).toBeUndefined();
    expect(await cache.estimateBytes()).toBe(0);
  });

  it('estimates bytes from the stored JSON and clears everything', async () => {
    const cache = createCandleCache();
    const v = [bar(1), bar(2)];
    await cache.put('demo|A|KRX|1m|2026-10-08', v, null);
    expect(await cache.estimateBytes()).toBe(JSON.stringify(v).length);
    await cache.clear();
    expect(await cache.estimateBytes()).toBe(0);
    expect(await cache.get('demo|A|KRX|1m|2026-10-08')).toBeUndefined();
  });

  it('evict removes whole symbols', async () => {
    const clock = { now: 1_000 };
    const cache = createCandleCache('gazua-cache', () => clock.now);
    const big = Array.from({ length: 50 }, (_, i) => bar(i));
    await cache.put('kis|AAA|KRX|1m|2026-10-07', big, null);
    clock.now += 1;
    await cache.put('kis|AAA|NXT|1m|2026-10-08', big, null);
    clock.now += 1;
    await cache.put('kis|BBB|KRX|1m|2026-10-08', big, null);
    clock.now += 1;
    await cache.put('kis|INDEX:KOSPI|1d|2026-08-29|2026-10-11', big, null);
    clock.now += 1;
    // BBB is touched last, AAA's newest access (NXT key) is older than everything else.
    await cache.get('kis|BBB|KRX|1m|2026-10-08');

    const one = JSON.stringify(big).length;
    expect(await cache.estimateBytes()).toBe(4 * one);
    await cache.evict(3 * one);

    expect(await cache.get('kis|AAA|KRX|1m|2026-10-07')).toBeUndefined();
    expect(await cache.get('kis|AAA|NXT|1m|2026-10-08')).toBeUndefined();
    expect(await cache.get('kis|BBB|KRX|1m|2026-10-08')).toEqual(big);
    expect(await cache.get('kis|INDEX:KOSPI|1d|2026-08-29|2026-10-11')).toEqual(big);
    expect(await cache.estimateBytes()).toBe(2 * one);
  });

  it('evict keeps going symbol by symbol until under the limit, oldest access first', async () => {
    const clock = { now: 1_000 };
    const cache = createCandleCache('gazua-cache', () => clock.now);
    const v = [bar(1)];
    for (const s of ['A', 'B', 'C']) {
      await cache.put(`kis|${s}|KRX|1m|2026-10-08`, v, null);
      clock.now += 1;
    }
    await cache.get('kis|A|KRX|1m|2026-10-08'); // A becomes most recent
    await cache.evict(JSON.stringify(v).length);
    expect(await cache.get('kis|A|KRX|1m|2026-10-08')).toEqual(v);
    expect(await cache.get('kis|B|KRX|1m|2026-10-08')).toBeUndefined();
    expect(await cache.get('kis|C|KRX|1m|2026-10-08')).toBeUndefined();
  });

  it('reclaims expired records in estimateBytes and evict', async () => {
    const clock = { now: 1_000 };
    const cache = createCandleCache('gazua-cache', () => clock.now);
    const v = [bar(1)];
    const one = JSON.stringify(v).length;
    await cache.put('kis|A|KRX|1m|2026-10-08', v, 60_000);
    await cache.put('kis|B|KRX|1m|2026-10-07', v, null);
    expect(await cache.estimateBytes()).toBe(2 * one);
    clock.now += 61_000;
    expect(await cache.estimateBytes()).toBe(one);

    await cache.put('kis|C|KRX|1m|2026-10-08', v, 60_000);
    clock.now += 61_000;
    // 만료된 C만 지우면 한도 안이므로 영구 항목 B는 남는다
    await cache.evict(one);
    expect(await cache.get('kis|B|KRX|1m|2026-10-07')).toEqual(v);
    expect(await cache.estimateBytes()).toBe(one);
  });

  it('retries opening the database after a failed open', async () => {
    const factory = globalThis.indexedDB;
    const realOpen = factory.open.bind(factory);
    let failures = 1;
    factory.open = (...a: Parameters<IDBFactory['open']>) => {
      if (failures-- > 0) throw new DOMException('open blocked', 'InvalidStateError');
      return realOpen(...a);
    };
    const cache = createCandleCache();
    await expect(cache.get('kis|A|KRX|1m|2026-10-08')).rejects.toThrow('open blocked');
    await cache.put('kis|A|KRX|1m|2026-10-08', [bar(1)], null);
    expect(await cache.get('kis|A|KRX|1m|2026-10-08')).toEqual([bar(1)]);
  });
});
