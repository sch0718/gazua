import { describe, expect, it } from 'vitest';
import { kstEpoch, kstMinuteOfDay } from '../time/kst';
import { runProviderContract } from './contract';
import { createDemoProvider } from './demo';
import { indexForMeta } from '../ui/compare/compareController.svelte';

const SUN = kstEpoch('2026-10-11', '12:00:00');
const make = (now = SUN, seed = 1) => createDemoProvider({ seed, now: () => now });

runProviderContract('demo', () => make(), '2026-10-08');

describe('demo provider', () => {
  it('has the expected id and capabilities', () => {
    const p = make();
    expect(p.id).toBe('demo');
    expect(p.capabilities).toEqual({
      venues: ['KRX', 'NXT', 'UNIFIED'],
      quoteBatchSize: 200,
      hasIndexCandles: true,
      indexMinutePastDays: true,
    });
  });

  it('returns known metas and deterministic metas for unknown symbols', async () => {
    const p = make();
    const metas = await p.getStockMeta(['005930', '042700', '069500', '123456', '654321']);
    const byId = Object.fromEntries(metas.map((m) => [m.symbol, m]));
    expect(byId['005930']).toMatchObject({ name: '삼성전자', market: 'KOSPI', securityType: 'STOCK', nxtSupported: true });
    expect(byId['042700']).toMatchObject({ name: '한미반도체', nxtSupported: false });
    expect(byId['069500']).toMatchObject({ name: 'KODEX 200', securityType: 'ETF', nxtSupported: false });
    expect(byId['123456']).toMatchObject({ name: '123456', market: 'KOSPI', securityType: 'STOCK' });
    expect(await p.getStockMeta(['123456', '654321'])).toEqual([byId['123456'], byId['654321']]);
    for (const m of metas) {
      expect(m.krxSuspended).toBe(false);
      expect(m.liquidationTrading).toBe(false);
    }
  });

  it('names stocks outside KNOWN from the universe (name and security type), keeping KNOWN entries as they are', async () => {
    const universe = async () => [
      { s: '009150', n: '삼성전기', m: 'KOSPI', t: 'STOCK' as const },
      { s: '069660', n: 'KODEX 레버리지', m: 'KOSPI', t: 'ETF' as const },
      { s: '005930', n: '다른 이름', m: 'KOSPI', t: 'ETF' as const },
    ];
    const p = createDemoProvider({ seed: 1, now: () => SUN, universe });
    const byId = Object.fromEntries((await p.getStockMeta(['005930', '009150', '069660', '123456'])).map((m) => [m.symbol, m]));
    expect(byId['009150']).toMatchObject({ name: '삼성전기', securityType: 'STOCK' });
    expect(byId['069660']).toMatchObject({ name: 'KODEX 레버리지', securityType: 'ETF' });
    expect(byId['005930']).toMatchObject({ name: '삼성전자', securityType: 'STOCK' });
    expect(byId['123456']).toMatchObject({ name: '123456', securityType: 'STOCK' });
    // 같은 코드의 나머지 값은 목록 유무와 상관없이 같다(결정적).
    const [plain] = await make().getStockMeta(['009150']);
    expect({ ...plain, name: '삼성전기' }).toEqual(byId['009150']);
  });

  it('takes the market from the universe, so a KOSDAQ stock gets the KOSDAQ benchmark; KNOWN keep their own market', async () => {
    const universe = async () => [
      { s: '247540', n: '에코프로비엠', m: 'KOSDAQ', t: 'STOCK' as const },
      { s: '009150', n: '삼성전기', m: 'KOSPI', t: 'STOCK' as const },
      { s: '042700', n: '한미반도체', m: 'KOSDAQ', t: 'STOCK' as const },
    ];
    const p = createDemoProvider({ seed: 1, now: () => SUN, universe });
    const byId = Object.fromEntries((await p.getStockMeta(['247540', '009150', '042700', '000660'])).map((m) => [m.symbol, m]));
    expect(byId['247540']).toMatchObject({ name: '에코프로비엠', market: 'KOSDAQ' });
    expect(indexForMeta(byId['247540'], 'AUTO')).toBe('KOSDAQ');
    expect(byId['009150'].market).toBe('KOSPI');
    // KNOWN 종목은 실제 시장(universe.json 기준 모두 KOSPI)을 그대로 쓴다.
    expect(byId['042700'].market).toBe('KOSPI');
    expect(byId['000660'].market).toBe('KOSPI');
  });

  it('falls back to the code when the universe cannot be loaded, and skips loading when every symbol is KNOWN', async () => {
    let calls = 0;
    const failing = createDemoProvider({
      seed: 1,
      now: () => SUN,
      universe: async () => {
        calls++;
        throw new Error('offline');
      },
    });
    expect((await failing.getStockMeta(['009150']))[0].name).toBe('009150');
    expect(calls).toBe(1);
    await failing.getStockMeta(['005930', '000660']);
    expect(calls).toBe(1);
  });

  it('gives every meta a positive integer sharesOutstanding, deterministically', async () => {
    const p = make();
    const symbols = ['005930', '000660', '042700', '000990', '069500', '123456', '654321', 'ABC'];
    const metas = await p.getStockMeta(symbols);
    for (const m of metas) {
      expect(Number.isInteger(m.sharesOutstanding) && m.sharesOutstanding! > 0).toBe(true);
    }
    expect(metas[0].sharesOutstanding).toBe(5919637922);
    expect(await make(SUN, 2).getStockMeta(symbols)).toEqual(metas);
  });

  it('closes weekends and demo holidays', async () => {
    const days = await make().getTradingDays('2026-09-23', '2026-10-11');
    const open = Object.fromEntries(days.map((d) => [d.date, d.isOpen]));
    expect(open['2026-09-23']).toBe(true);
    expect(open['2026-09-24']).toBe(false);
    expect(open['2026-09-25']).toBe(false);
    expect(open['2026-09-26']).toBe(false); // Sat
    expect(open['2026-10-08']).toBe(true);
    expect(open['2026-10-09']).toBe(false);
    expect(days).toHaveLength(19);
    expect(days[0].integrated).toBeUndefined();
  });

  it('produces identical data for the same seed and now, different for another seed', async () => {
    const q = { symbol: '005930', venue: 'KRX' as const, interval: '1m' as const, from: '2026-10-08', to: '2026-10-08' };
    const a = await make().getCandles(q);
    const b = await make().getCandles(q);
    const c = await make(SUN, 2).getCandles(q);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('emits 1m bars only during continuous sessions (no auctions, no gaps)', async () => {
    const q = { symbol: '005930', venue: 'KRX' as const, interval: '1m' as const, from: '2026-10-08', to: '2026-10-08' };
    const krx = await make().getCandles(q);
    const minutes = krx.map((c) => kstMinuteOfDay(c.t));
    expect(minutes[0]).toBe(9 * 60);
    expect(minutes.some((m) => m >= 15 * 60 + 20 && m < 16 * 60)).toBe(false); // closing auction + gap
    expect(minutes.some((m) => m < 9 * 60)).toBe(false);
    expect(minutes.at(-1)).toBe(19 * 60 + 59);
    // ascending, 1m apart within a session
    expect(krx.length).toBe(380 + 240);
  });

  it('uses NXT sessions for NXT, falls back to KRX for unsupported symbols, and skips ETF after-hours on KRX', async () => {
    const base = { interval: '1m' as const, from: '2026-10-08', to: '2026-10-08' };
    const p = make();
    const nxt = await p.getCandles({ ...base, symbol: '005930', venue: 'NXT' });
    expect(kstMinuteOfDay(nxt[0].t)).toBe(8 * 60);
    const fallback = await p.getCandles({ ...base, symbol: '042700', venue: 'NXT' });
    expect(kstMinuteOfDay(fallback[0].t)).toBe(9 * 60);
    const etf = await p.getCandles({ ...base, symbol: '069500', venue: 'KRX' });
    expect(etf.at(-1) && kstMinuteOfDay(etf.at(-1)!.t)).toBe(15 * 60 + 19);
    const unified = await p.getCandles({ ...base, symbol: '005930', venue: 'UNIFIED' });
    expect(kstMinuteOfDay(unified[0].t)).toBe(8 * 60);
  });

  it('prices NXT slightly differently from KRX', async () => {
    const base = { symbol: '005930', interval: '1m' as const, from: '2026-10-08', to: '2026-10-08' };
    const p = make();
    const krx = await p.getCandles({ ...base, venue: 'KRX' });
    const nxt = await p.getCandles({ ...base, venue: 'NXT' });
    const k = krx.find((c) => kstMinuteOfDay(c.t) === 10 * 60)!;
    const n = nxt.find((c) => kstMinuteOfDay(c.t) === 10 * 60)!;
    expect(n.c).not.toBe(k.c);
    expect(Math.abs(n.c / k.c - 1)).toBeLessThan(0.02);
  });

  it('keeps candle values sane', async () => {
    const p = make();
    const all = [
      ...(await p.getCandles({ symbol: '000990', venue: 'UNIFIED', interval: '1m', from: '2026-10-07', to: '2026-10-08' })),
      ...(await p.getCandles({ symbol: '000990', venue: 'KRX', interval: '1d', from: '2026-08-01', to: '2026-10-08' })),
    ];
    for (const c of all) {
      expect(c.l).toBeLessThanOrEqual(Math.min(c.o, c.c));
      expect(c.h).toBeGreaterThanOrEqual(Math.max(c.o, c.c));
      expect(c.l).toBeGreaterThan(0);
      expect(Number.isInteger(c.v) && c.v > 0).toBe(true);
    }
  });

  it('1m bars start near the previous close and the final bar matches the daily close', async () => {
    const p = make();
    const day = (d: string, interval: '1m' | '1d') =>
      p.getCandles({ symbol: '005930', venue: 'KRX', interval, from: d, to: d });
    const [prev] = await day('2026-10-07', '1d');
    const mins = await day('2026-10-08', '1m');
    const [today] = await day('2026-10-08', '1d');
    expect(Math.abs(mins[0].o / prev.c - 1)).toBeLessThan(0.01);
    expect(mins.at(-1)!.c).toBe(today.c);
  });

  it('1d returns one bar per open trading day at KST midnight', async () => {
    const candles = await make().getCandles({
      symbol: '005930',
      venue: 'KRX',
      interval: '1d',
      from: '2026-10-05',
      to: '2026-10-11',
    });
    expect(candles.map((c) => c.t)).toEqual(
      ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'].map((d) => kstEpoch(d, '00:00:00')),
    );
  });

  it('daily history does not depend on the requested range', async () => {
    const p = make();
    const wide = await p.getCandles({ symbol: '005930', venue: 'KRX', interval: '1d', from: '2026-09-01', to: '2026-10-08' });
    const narrow = await p.getCandles({ symbol: '005930', venue: 'KRX', interval: '1d', from: '2026-10-05', to: '2026-10-08' });
    expect(wide.slice(-narrow.length)).toEqual(narrow);
  });

  describe('when now is during a trading day', () => {
    const now = kstEpoch('2026-10-08', '10:30:30');
    const q = { symbol: '005930', venue: 'KRX' as const };

    it('1m only has bars that started before now', async () => {
      const mins = await make(now).getCandles({ ...q, interval: '1m', from: '2026-10-08', to: '2026-10-08' });
      expect(mins.at(-1)!.t).toBe(kstEpoch('2026-10-08', '10:30:00'));
      expect(mins).toHaveLength(91);
    });

    it('today 1m prefix equals the full-day data', async () => {
      const part = await make(now).getCandles({ ...q, interval: '1m', from: '2026-10-08', to: '2026-10-08' });
      const full = await make().getCandles({ ...q, interval: '1m', from: '2026-10-08', to: '2026-10-08' });
      expect(part).toEqual(full.slice(0, part.length));
    });

    it("today's daily bar closes at the latest 1m close", async () => {
      const p = make(now);
      const mins = await p.getCandles({ ...q, interval: '1m', from: '2026-10-08', to: '2026-10-08' });
      const [bar] = await p.getCandles({ ...q, interval: '1d', from: '2026-10-08', to: '2026-10-08' });
      expect(bar.c).toBe(mins.at(-1)!.c);
      expect(bar.t).toBe(kstEpoch('2026-10-08', '00:00:00'));
      expect(bar.h).toBeGreaterThanOrEqual(Math.max(...mins.map((m) => m.h)));
    });

    it('quotes use the latest 1m close with its bar start as ts', async () => {
      const p = make(now);
      const mins = await p.getCandles({ ...q, interval: '1m', from: '2026-10-08', to: '2026-10-08' });
      const [quote] = await p.getQuotes(['005930'], 'KRX');
      expect(quote).toEqual({ symbol: '005930', venue: 'KRX', price: mins.at(-1)!.c, ts: mins.at(-1)!.t });
    });
  });

  it("omits today's daily bar before the session starts and quotes the last daily close", async () => {
    const now = kstEpoch('2026-10-08', '07:00:00');
    const p = make(now);
    const daily = await p.getCandles({ symbol: '005930', venue: 'KRX', interval: '1d', from: '2026-10-07', to: '2026-10-08' });
    expect(daily).toHaveLength(1);
    expect(daily[0].t).toBe(kstEpoch('2026-10-07', '00:00:00'));
    const [quote] = await p.getQuotes(['005930'], 'KRX');
    expect(quote).toEqual({ symbol: '005930', venue: 'KRX', price: daily[0].c, ts: null });
  });

  it('quotes the last daily close on a closed day and handles unknown symbols', async () => {
    const p = make(); // Sunday
    const daily = await p.getCandles({ symbol: '777777', venue: 'KRX', interval: '1d', from: '2026-10-05', to: '2026-10-11' });
    const [quote] = await p.getQuotes(['777777'], 'KRX');
    expect(quote.price).toBe(daily.at(-1)!.c);
    expect(quote.ts).toBeNull();
  });

  it('serves index candles: 1m only 09:00-15:30, any past day, 1d on open days', async () => {
    const p = make();
    const mins = await p.getIndexCandles!('KOSDAQ', '1m', '2026-10-08', '2026-10-08');
    expect(kstMinuteOfDay(mins[0].t)).toBe(9 * 60);
    expect(kstMinuteOfDay(mins.at(-1)!.t)).toBe(15 * 60 + 29);
    expect(mins).toHaveLength(390);
    const daily = await p.getIndexCandles!('KOSPI', '1d', '2026-10-05', '2026-10-11');
    expect(daily).toHaveLength(4);
    expect(daily.every((c) => c.c > 0)).toBe(true);
    expect(mins.at(-1)!.c).toBe(
      (await p.getIndexCandles!('KOSDAQ', '1d', '2026-10-08', '2026-10-08'))[0].c,
    );
  });

  it('returns no 1m bars on closed days or before the first schedule', async () => {
    const p = make();
    for (const d of ['2026-10-09', '2026-10-10', '2026-01-05']) {
      expect(await p.getCandles({ symbol: '005930', venue: 'KRX', interval: '1m', from: d, to: d })).toEqual([]);
    }
  });
});
