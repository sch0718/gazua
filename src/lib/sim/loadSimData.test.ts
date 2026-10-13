import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Candle } from '../data/metrics';
import { createDemoProvider } from '../providers/demo';
import type { CandleQuery, MarketDataProvider } from '../providers/types';
import { addDays, kstDate, kstEpoch } from '../time/kst';
import { createSimMemo, loadSimData, type LoadProgress } from './loadSimData';
import { newStrategy } from './defaults';
import type { Strategy } from './types';

const NOW = kstEpoch('2026-10-12', '14:05:00');
const demo = () => createDemoProvider({ seed: 1, now: () => NOW });

function strat(patch: (s: Strategy) => void = () => {}, from = '2026-03-02', to = '2026-03-13'): Strategy {
  const s = newStrategy(NOW, null);
  s.period = { from, to };
  s.benchmarks = { index: 'KOSPI', symbol: null };
  patch(s);
  return s;
}

type Spy = { candles: CandleQuery[]; index: unknown[][]; provider: MarketDataProvider };
function spied(over: Partial<MarketDataProvider> = {}, base = demo()): Spy {
  const candles: CandleQuery[] = [];
  const index: unknown[][] = [];
  const provider: MarketDataProvider = {
    ...base,
    capabilities: base.capabilities,
    getStockMeta: (s) => base.getStockMeta(s),
    getCandles: async (q) => {
      candles.push(q);
      return base.getCandles(q);
    },
    getIndexCandles: async (...a) => {
      index.push(a);
      return base.getIndexCandles!(...a);
    },
    ...over,
  };
  return { candles, index, provider };
}

const run = (provider: MarketDataProvider, strategy: Strategy, symbols: string[], extra: Record<string, unknown> = {}) =>
  loadSimData({
    provider,
    strategy,
    symbols,
    now: NOW,
    memo: createSimMemo(),
    onProgress: () => {},
    isCancelled: () => false,
    ...extra,
  });

afterEach(() => vi.useRealTimers());

describe('loadSimData', () => {
  it('워밍업: MA 60/250 → from-400일', async () => {
    for (const patch of [
      (s: Strategy) => void (s.entry.filter.aboveMa = { on: true, period: 60 }),
      (s: Strategy) => void (s.entry.triggers.maCross = { on: true, period: 250 }),
    ]) {
      const sp = spied();
      await run(sp.provider, strat(patch), ['005930']);
      expect(sp.candles[0].from).toBe('2025-01-26');
    }
  });

  it('MA가 더 길면 ceil(MA*1.6)일', async () => {
    const sp = spied();
    await run(sp.provider, strat((s) => void (s.entry.filter.aboveMa = { on: true, period: 300 })), ['005930']);
    expect(sp.candles[0].from).toBe(addDays('2026-03-02', -480));
  });

  it('to at or after today is clamped to yesterday', async () => {
    const sp = spied();
    const r = await run(sp.provider, strat(() => {}, '2026-10-01', '2026-10-12'), ['005930']);
    expect(sp.candles[0].to).toBe('2026-10-11');
    expect(sp.index[0][3]).toBe('2026-10-11');
    expect(r.ok && r.input.strategy.period.to).toBe('2026-10-12'); // 저장된 기간은 그대로, 받는 범위만 줄인다
  });

  it('정상: 축·종목·지수·venue·fetchedAt·우선순위', async () => {
    const sp = spied();
    const r = await run(sp.provider, strat((s) => void (s.benchmarks.symbol = '069500')), ['005930', '000660']);
    if (!r.ok) throw new Error('expected ok');
    expect(r.venueLabel).toBe('KRX 일봉');
    expect(r.fetchedAt).toBe(NOW);
    expect(r.indexFailed).toBeNull();
    expect(r.benchmarkFailed).toBe(false);
    expect(r.input.days[0]).toBe('2026-03-02');
    expect(r.input.days.at(-1)).toBe('2026-03-13');
    expect(r.input.stocks.map((s) => s.symbol)).toEqual(['005930', '000660']);
    expect(r.input.stocks[0].candles.some((c) => kstDate(c.t) < '2026-03-02')).toBe(true);
    expect(r.input.index?.id).toBe('KOSPI');
    expect(r.input.benchmarkStock?.symbol).toBe('069500');
    expect(sp.candles.map((q) => q.symbol)).toEqual(['069500', '005930', '000660']);
    expect(sp.candles.every((q) => q.priority === 2 && q.interval === '1d')).toBe(true);
    expect(sp.index[0][4]).toBe(2);
  });

  it('지수 실패 → axis from stocks, index null', async () => {
    const sp = spied({ getIndexCandles: async () => { throw new Error('x'); } });
    const r = await run(sp.provider, strat(), ['005930']);
    if (!r.ok) throw new Error('expected ok');
    expect(r.indexFailed).toBe('받지 못했어요');
    expect(r.input.index).toBeNull();
    expect(r.input.days.length).toBeGreaterThan(5);
  });

  it('getIndexCandles 없으면 던진 것과 같다', async () => {
    const sp = spied({ getIndexCandles: undefined });
    const r = await run(sp.provider, strat(), ['005930']);
    expect(r.ok && r.indexFailed).toBe('받지 못했어요');
  });

  it('index returns [] → axis still comes from stocks', async () => {
    const sp = spied({ getIndexCandles: async () => [] });
    const r = await run(sp.provider, strat(), ['005930']);
    if (!r.ok) throw new Error('expected ok');
    expect(r.indexFailed).toBe('기간 일부만 받았어요');
    expect(r.input.index).toBeNull();
    expect(r.input.days[0]).toBe('2026-03-02');
  });

  it('index covering only the tail is not used as a benchmark', async () => {
    const base = demo();
    const sp = spied({
      getIndexCandles: async (i, iv, f, t, p) =>
        (await base.getIndexCandles!(i, iv, f, t, p)).filter((c) => kstDate(c.t) >= '2026-03-10'),
    });
    const r = await run(sp.provider, strat(), ['005930']);
    if (!r.ok) throw new Error('expected ok');
    expect(r.indexFailed).toBe('기간 일부만 받았어요');
    expect(r.input.index).toBeNull();
    expect(r.input.days[0]).toBe('2026-03-02');
  });

  it('지수만 있고 종목이 모두 실패해도 축은 지수 날짜', async () => {
    const sp = spied({ getCandles: async () => [] });
    const r = await run(sp.provider, strat(), ['005930']);
    if (!r.ok) throw new Error('expected ok');
    expect(r.input.stocks).toEqual([]);
    expect(r.input.index).not.toBeNull();
  });

  it('축이 비면 noData', async () => {
    const sp = spied({ getCandles: async () => [], getIndexCandles: async () => [] });
    expect(await run(sp.provider, strat(), ['005930'])).toEqual({
      ok: false,
      noData: true,
      failed: [{ symbol: '005930', name: '삼성전자', reason: '기간 안에 데이터가 없어요' }],
    });
  });

  it('모든 종목이 실패하고 지수도 없으면 noData에 실패 목록을 싣는다', async () => {
    const sp = spied({
      getCandles: async (q) => {
        if (q.symbol === '000660') return [];
        throw new Error('boom');
      },
      getIndexCandles: async () => [],
    });
    const r = await run(sp.provider, strat(), ['005930', '000660']);
    expect(r).toEqual({
      ok: false,
      noData: true,
      failed: [
        { symbol: '005930', name: '삼성전자', reason: '받지 못했어요' },
        { symbol: '000660', name: 'SK하이닉스', reason: '기간 안에 데이터가 없어요' },
      ],
    });
  });

  it('시작일이 오늘 이후면 공급자를 부르지 않고 noData', async () => {
    const sp = spied();
    const meta = vi.spyOn(sp.provider, 'getStockMeta');
    const r = await run(sp.provider, strat(() => {}, '2026-10-12', '2026-10-20'), ['005930']);
    expect(r).toEqual({ ok: false, noData: true, failed: [] });
    expect(meta).not.toHaveBeenCalled();
    expect(sp.candles).toHaveLength(0);
    expect(sp.index).toHaveLength(0);
  });

  it('venues가 비어 있어도 KRX로 받는다', async () => {
    const base = demo();
    const sp = spied({ capabilities: { ...base.capabilities, venues: [] } });
    const r = await run(sp.provider, strat(), ['005930']);
    expect(r.ok && r.venueLabel).toBe('KRX 일봉');
    expect(sp.candles[0].venue).toBe('KRX');
  });

  it('a symbol with no candles in range is reported as failed, not thrown', async () => {
    const base = demo();
    const sp = spied({ getCandles: async (q) => (q.symbol === '000660' ? [] : base.getCandles(q)) });
    const r = await run(sp.provider, strat(), ['000660', '005930']);
    if (!r.ok) throw new Error('expected ok');
    expect(r.failed).toEqual([{ symbol: '000660', name: 'SK하이닉스', reason: '기간 안에 데이터가 없어요' }]);
    expect(r.input.stocks.map((s) => s.symbol)).toEqual(['005930']);
  });

  it('종목 요청이 던지면 failed에 넣고 계속', async () => {
    const base = demo();
    const sp = spied({
      getCandles: async (q) => {
        if (q.symbol === '000660') throw new Error('boom');
        return base.getCandles(q);
      },
    });
    const r = await run(sp.provider, strat(), ['000660', '005930']);
    if (!r.ok) throw new Error('expected ok');
    expect(r.failed).toEqual([{ symbol: '000660', name: 'SK하이닉스', reason: '받지 못했어요' }]);
    expect(r.input.stocks).toHaveLength(1);
  });

  it('지정 종목이 실패하면 benchmarkFailed', async () => {
    const base = demo();
    const sp = spied({
      getCandles: async (q) => {
        if (q.symbol === '069500') throw new Error('boom');
        return base.getCandles(q);
      },
    });
    const r = await run(sp.provider, strat((s) => void (s.benchmarks.symbol = '069500')), ['005930']);
    if (!r.ok) throw new Error('expected ok');
    expect(r.benchmarkFailed).toBe(true);
    expect(r.input.benchmarkStock).toBeNull();
  });

  it('가격이 0이거나 유효하지 않은 봉은 버린다(거래정지 = 봉 없음)', async () => {
    const base = demo();
    const bad = (c: Candle, i: number) =>
      i === 0 ? { ...c, o: 0, h: 0, l: 0 } : i === 1 ? { ...c, c: Number.NaN } : c;
    const sp = spied({
      getCandles: async (q) => {
        const cs = await base.getCandles(q);
        const k = cs.findIndex((c) => kstDate(c.t) === '2026-03-04');
        return cs.map((c, i) => bad(c, i - k));
      },
      getIndexCandles: async (...a) =>
        (await base.getIndexCandles!(...a)).map((c) => (kstDate(c.t) === '2026-03-02' ? { ...c, o: 0 } : c)),
    });
    const r = await run(sp.provider, strat(), ['005930']);
    if (!r.ok) throw new Error('expected ok');
    const dates = r.input.stocks[0].candles.map((c) => kstDate(c.t));
    expect(dates).not.toContain('2026-03-04');
    expect(dates).not.toContain('2026-03-05');
    expect(dates).toContain('2026-03-06');
    expect(r.input.days).toContain('2026-03-04');
    // 지수 첫날 봉이 빠지면 비교 기준으로 쓰지 않는다
    expect(r.input.index).toBeNull();
    expect(r.indexFailed).toBe('기간 일부만 받았어요');
  });

  it('메타가 throw → error', async () => {
    const err = new Error('meta');
    const sp = spied({ getStockMeta: async () => { throw err; } });
    expect(await run(sp.provider, strat(), ['005930'])).toEqual({ ok: false, error: err });
    expect(sp.candles).toHaveLength(0);
  });

  it('진행: total = 3 + n, done 순서대로', async () => {
    const ps: LoadProgress[] = [];
    await run(demo(), strat(), ['005930', '000660'], { onProgress: (p: LoadProgress) => ps.push(p) });
    expect(ps.every((p) => p.total === 5)).toBe(true);
    expect(ps.map((p) => p.done)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('취소: 두 번째 종목 요청 중 true → 이후 요청 없음', async () => {
    const base = demo();
    let cancelled = false;
    const calls: string[] = [];
    const sp = spied({
      getCandles: async (q) => {
        calls.push(q.symbol);
        if (q.symbol === '000660') cancelled = true;
        return base.getCandles(q);
      },
    });
    const r = await run(sp.provider, strat(), ['005930', '000660', '035720'], { isCancelled: () => cancelled });
    expect(r).toEqual({ ok: false, cancelled: true });
    expect(calls).toEqual(['005930', '000660']);
  });

  it('메모: 같은 키 두 번째 실행은 getCandles 호출 없음, 지수는 매번 호출', async () => {
    const memo = createSimMemo();
    const sp = spied();
    await run(sp.provider, strat(), ['005930'], { memo });
    expect(sp.candles).toHaveLength(1);
    await run(sp.provider, strat(), ['005930'], { memo });
    expect(sp.candles).toHaveLength(1);
    expect(sp.index).toHaveLength(2);
  });

  it('빈 결과는 메모하지 않는다', async () => {
    const memo = createSimMemo();
    let n = 0;
    const sp = spied({ getCandles: async () => { n++; return []; } });
    await run(sp.provider, strat(), ['005930'], { memo });
    await run(sp.provider, strat(), ['005930'], { memo });
    expect(n).toBe(2);
  });

  it('venue: UNIFIED만 있으면 통합 일봉', async () => {
    const base = demo();
    const sp = spied({ capabilities: { ...base.capabilities, venues: ['UNIFIED'] } });
    const r = await run(sp.provider, strat(), ['005930']);
    expect(r.ok && r.venueLabel).toBe('통합 일봉');
    expect(sp.candles[0].venue).toBe('UNIFIED');
  });

  it('ETF 여부를 메타에서 가져온다', async () => {
    const base = demo();
    const sp = spied({
      getStockMeta: async (s) => (await base.getStockMeta(s)).map((m) => ({ ...m, securityType: 'ETF' as const })),
    });
    const r = await run(sp.provider, strat(), ['005930']);
    expect(r.ok && r.input.stocks[0].isEtf).toBe(true);
  });

  it('waiting: 요청이 3초 넘게 걸리면 true, 끝나면 false', async () => {
    vi.useFakeTimers();
    const base = demo();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const sp = spied({
      getCandles: async (q) => {
        await gate;
        return base.getCandles(q);
      },
    });
    const ps: LoadProgress[] = [];
    const p = run(sp.provider, strat(), ['005930'], { onProgress: (x: LoadProgress) => ps.push(x) });
    await vi.advanceTimersByTimeAsync(2999);
    expect(ps.some((x) => x.waiting)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(ps.at(-1)?.waiting).toBe(true);
    release();
    const r = await p;
    expect(r.ok).toBe(true);
    const waits = ps.map((x) => x.waiting);
    expect(waits.lastIndexOf(false)).toBeGreaterThan(waits.indexOf(true));
  });

  describe('취소하면 이후 호출이 없고 타이머도 남지 않는다', () => {
    it('메타를 받은 뒤', async () => {
      vi.useFakeTimers();
      let cancelled = false;
      const base = demo();
      const sp = spied({
        getStockMeta: async (s) => {
          const r = await base.getStockMeta(s);
          cancelled = true;
          return r;
        },
      });
      const r = await run(sp.provider, strat(), ['005930'], { isCancelled: () => cancelled });
      expect(r).toEqual({ ok: false, cancelled: true });
      expect(sp.candles).toHaveLength(0);
      expect(sp.index).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('메모 적중 시', async () => {
      vi.useFakeTimers();
      const memo = createSimMemo();
      const sp = spied();
      await run(sp.provider, strat(), ['005930', '000660'], { memo });
      expect(sp.candles).toHaveLength(2);
      sp.candles.length = 0;
      let cancelled = false;
      const ps: LoadProgress[] = [];
      const r = await run(sp.provider, strat(), ['005930', '000660'], {
        memo,
        isCancelled: () => cancelled,
        onProgress: (p: LoadProgress) => {
          ps.push(p);
          if (p.done === 4) cancelled = true; // 첫 종목을 메모에서 읽은 직후
        },
      });
      expect(r).toEqual({ ok: false, cancelled: true });
      expect(sp.candles).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('waiting 중', async () => {
      vi.useFakeTimers();
      const base = demo();
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let cancelled = false;
      const calls: string[] = [];
      const sp = spied({
        getCandles: async (q) => {
          calls.push(q.symbol);
          await gate;
          return base.getCandles(q);
        },
      });
      const ps: LoadProgress[] = [];
      const p = run(sp.provider, strat(), ['005930', '000660'], {
        isCancelled: () => cancelled,
        onProgress: (x: LoadProgress) => ps.push(x),
      });
      await vi.advanceTimersByTimeAsync(3000);
      expect(ps.at(-1)?.waiting).toBe(true);
      cancelled = true;
      release();
      expect(await p).toEqual({ ok: false, cancelled: true });
      expect(calls).toEqual(['005930']);
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
