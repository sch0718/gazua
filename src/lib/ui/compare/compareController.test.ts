// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDailyMemo,
  createSeriesSnapshots,
  loadIndexSeries,
  type LoadedSeries,
  type LoadSeriesArgs,
} from '../../data/candleService';
import { sessionsForDay } from '../../market/sessions';
import { createDemoProvider } from '../../providers/demo';
import { ApiError } from '../../providers/errors';
import { memoryCache } from '../../data/testCache';
import type { MarketDataProvider, Quote } from '../../providers/types';
import type { AppData } from '../../state/app.svelte';
import { kstEpoch } from '../../time/kst';
import {
  RELOAD_IN_SESSION_MS,
  META_ERROR,
  RELOAD_OUTSIDE_MS,
  createCompareController,
  type CompareController,
  type CompareQuery,
  type SnapshotSeries,
} from './compareController.svelte';
import { indexLoadOf, staleIndexAt } from './compareView';
import { buildRows } from './rows';
import { metricPoints } from '../../data/seriesMetrics';

// 지수 로딩만 테스트마다 바꿀 수 있게 감싼다(기본은 실제 구현).
vi.mock('../../data/candleService', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../data/candleService')>();
  return { ...real, loadIndexSeries: vi.fn(real.loadIndexSeries) };
});

const DAY = '2026-10-12';
const NOW = kstEpoch(DAY, '10:00:00');
const sessions = sessionsForDay({ date: DAY, isOpen: true });

function fakeDoc() {
  const listeners = new Set<() => void>();
  return {
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    set(state: DocumentVisibilityState) {
      this.visibilityState = state;
      for (const fn of listeners) fn();
    },
  };
}

const snap = (symbol: string, over: Partial<SnapshotSeries> = {}): SnapshotSeries => ({
  symbol,
  tradingDate: DAY,
  base: 100,
  avgDailyVolume: null,
  candles: [{ t: NOW - 60_000, o: 110, h: 110, l: 110, c: 110, v: 1 }],
  daily: [],
  segments: [],
  intervals: [],
  computedAt: NOW,
  stale: false,
  ...over,
});

type Deferred = { resolve(v: SnapshotSeries): void; reject(e: unknown): void };

function setup(opts: { inSession?: boolean; provider?: MarketDataProvider } = {}) {
  let now = NOW;
  let inSession = opts.inSession ?? true;
  const doc = fakeDoc();
  const provider = opts.provider ?? createDemoProvider({ seed: 1, now: () => now });
  const getQuotes = vi.spyOn(provider, 'getQuotes');
  const pending = new Map<string, Deferred>();
  const load = vi.fn(
    (args: LoadSeriesArgs) =>
      new Promise<SnapshotSeries>((resolve, reject) => pending.set(args.meta.symbol, { resolve, reject })),
  );
  const data: AppData = { cache: memoryCache(), memo: createDailyMemo(), snapshots: { load } };
  const ctl = createCompareController({
    now: () => now,
    inSession: () => inSession,
    sessions: () => sessions,
    doc: doc as unknown as Document,
  });
  const query = (over: Partial<CompareQuery> = {}): CompareQuery => ({
    provider,
    data,
    symbols: ['005930', '000660', '042700'],
    period: { unit: 'D', n: 1 },
    venueMode: 'AUTO',
    excess: false,
    benchmark: 'AUTO',
    ...over,
  });
  return {
    ctl,
    doc,
    provider,
    data,
    load,
    pending,
    getQuotes,
    query,
    setNow: (t: number) => (now = t),
    setInSession: (v: boolean) => (inSession = v),
    /** 대기 중인 모든 로드를 성공시킨다. */
    resolveAll(over: Partial<SnapshotSeries> = {}) {
      for (const [s, d] of pending) d.resolve(snap(s, over));
      pending.clear();
    },
  };
}

let ctls: CompareController[] = [];
const track = <T extends { ctl: CompareController }>(x: T) => {
  ctls.push(x.ctl);
  return x;
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  for (const c of ctls) c.destroy();
  ctls = [];
  vi.useRealTimers();
});

describe('compareController', () => {
  it('loads every symbol in parallel and reports progress until all are done', async () => {
    const t = track(setup());
    t.ctl.setQuery(t.query());
    expect(t.ctl.progress).toEqual({ done: 0, total: 3 });
    await vi.advanceTimersByTimeAsync(0);
    expect(t.load).toHaveBeenCalledTimes(3);
    t.pending.get('000660')!.resolve(snap('000660'));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.ctl.progress).toEqual({ done: 1, total: 3 });
    expect(t.ctl.entries['000660'].series?.symbol).toBe('000660');
    t.resolveAll();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.ctl.progress).toBeNull();
    expect(Object.keys(t.ctl.entries).sort()).toEqual(['000660', '005930', '042700']);
    expect(t.ctl.metas['005930'].name).toBe('삼성전자');
  });

  it('one failing symbol does not block the others', async () => {
    const t = track(setup());
    t.ctl.setQuery(t.query());
    await vi.advanceTimersByTimeAsync(0);
    t.pending.get('042700')!.reject(new Error('boom'));
    t.pending.delete('042700');
    t.resolveAll();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.ctl.entries['042700']).toEqual({ series: null, error: '불러오지 못했어요' });
    expect(t.ctl.entries['005930'].series).not.toBeNull();
    expect(t.ctl.progress).toBeNull();
  });

  it('one symbol without meta errors only its own row and is retried on the next reload', async () => {
    const provider = createDemoProvider({ seed: 1, now: () => NOW });
    const base = provider.getStockMeta.bind(provider);
    let broken = true;
    const metaCalls: string[][] = [];
    // 계약: 받지 못한 종목은 빼고 나머지를 돌려준다(상장폐지·만기 ETN 등).
    provider.getStockMeta = async (symbols) => {
      metaCalls.push(symbols);
      return (await base(symbols)).filter((m) => !(broken && m.symbol === '042700'));
    };
    const t = track(setup({ provider }));
    t.ctl.setQuery(t.query({ symbols: ['005930', '000660', '042700', '069500'] }));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.load).toHaveBeenCalledTimes(3);
    t.resolveAll();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.ctl.entries['042700']).toEqual({ series: null, error: META_ERROR });
    for (const s of ['005930', '000660', '069500']) expect(t.ctl.entries[s].series?.symbol).toBe(s);
    expect(t.ctl.progress).toBeNull();

    broken = false;
    await vi.advanceTimersByTimeAsync(RELOAD_IN_SESSION_MS);
    expect(metaCalls.at(-1)).toEqual(['042700']);
    t.resolveAll();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.ctl.entries['042700'].series?.symbol).toBe('042700');
  });

  it('exposes the dominant error of the last load and whether every row failed', async () => {
    const t = track(setup());
    t.ctl.setQuery(t.query());
    await vi.advanceTimersByTimeAsync(0);
    expect(t.ctl.issue).toBeNull();
    t.pending.get('005930')!.reject(new ApiError('upstream'));
    t.pending.get('000660')!.reject(new ApiError('invalid-credentials', undefined, { status: 401 }));
    t.pending.get('042700')!.reject(new ApiError('rate-limited', undefined, { retryAfterMs: 3000 }));
    t.pending.clear();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.ctl.issue).toMatchObject({ code: 'invalid-credentials', allFailed: true, lastOkAt: null, at: NOW });

    // 다음 갱신에서 한 종목만 성공하면 allFailed가 풀리고, 모두 성공하면 문제가 사라진다.
    t.setNow(NOW + RELOAD_IN_SESSION_MS);
    await vi.advanceTimersByTimeAsync(RELOAD_IN_SESSION_MS);
    t.pending.get('005930')!.resolve(snap('005930'));
    t.pending.get('000660')!.reject(new ApiError('rate-limited', undefined, { retryAfterMs: 3000 }));
    t.pending.get('042700')!.reject(new ApiError('upstream'));
    t.pending.clear();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.ctl.issue).toMatchObject({ code: 'rate-limited', allFailed: false, retryAfterMs: 3000, lastOkAt: NOW + RELOAD_IN_SESSION_MS });

    await vi.advanceTimersByTimeAsync(RELOAD_IN_SESSION_MS);
    t.resolveAll();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.ctl.issue).toBeNull();
  });

  it('a stale row (last good result kept) still reports why the reload failed', async () => {
    const t = track(setup());
    t.ctl.setQuery(t.query({ symbols: ['005930'] }));
    await vi.advanceTimersByTimeAsync(0);
    t.resolveAll({ stale: true, staleError: new ApiError('proxy-unreachable') });
    await vi.advanceTimersByTimeAsync(0);
    expect(t.ctl.entries['005930'].series?.stale).toBe(true);
    expect(t.ctl.issue).toMatchObject({ code: 'proxy-unreachable', allFailed: true });
  });

  it('a meta call that throws reports its error code for every row', async () => {
    const provider = createDemoProvider({ seed: 1, now: () => NOW });
    provider.getStockMeta = async () => {
      throw new ApiError('proxy-unreachable');
    };
    const t = track(setup({ provider }));
    t.ctl.setQuery(t.query());
    await vi.advanceTimersByTimeAsync(0);
    expect(t.ctl.entries['005930']).toMatchObject({ series: null, error: META_ERROR });
    expect(t.ctl.issue).toMatchObject({ code: 'proxy-unreachable', allFailed: true });
  });

  it('stale rows ignore live quotes', async () => {
    const t = track(setup());
    t.ctl.setQuery(t.query({ symbols: ['005930', '000660'] }));
    await vi.advanceTimersByTimeAsync(0);
    t.pending.get('005930')!.resolve(snap('005930', { stale: true, computedAt: kstEpoch(DAY, '09:20:00') }));
    t.pending.get('000660')!.resolve(snap('000660'));
    t.pending.clear();
    await vi.advanceTimersByTimeAsync(5000);
    // 두 종목 모두 시세를 받았다.
    expect(Object.keys(t.ctl.quotes).sort()).toEqual(['000660', '005930']);
    const rows = buildRows(
      ['005930', '000660'].map((s) => ({
        item: { symbol: s, colorSlot: 1, hidden: false, addedAt: 0 },
        meta: t.ctl.metas[s],
        series: t.ctl.entries[s].series,
        points: [{ t: NOW - 60_000, v: 10 }],
        quote: t.ctl.quotes[s],
      })),
      { scrubT: null, venueMode: 'AUTO' },
    );
    expect(rows[0]).toMatchObject({ price: 110, value: 10, staleAt: kstEpoch(DAY, '09:20:00') });
    expect(rows[1].price).toBe(t.ctl.quotes['000660'].price);
  });

  it('quotes use the KRX-first venue per stock', async () => {
    const t = track(setup());
    t.setNow(kstEpoch(DAY, '08:10:00'));
    t.ctl.setQuery(t.query());
    await vi.advanceTimersByTimeAsync(0);
    t.resolveAll();
    await vi.advanceTimersByTimeAsync(5000);
    const calls = t.getQuotes.mock.calls.map(([symbols, venue]) => `${venue}:${[...symbols].sort().join(',')}`);
    // 08:10은 NXT 프리. NXT 지원 종목은 NXT, 한미반도체(NXT 미지원)는 KRX.
    expect(calls).toContain('NXT:000660,005930');
    expect(calls).toContain('KRX:042700');
  });

  it('reloads quietly every 60s in session and every 10 min outside; hidden pauses', async () => {
    const t = track(setup());
    t.ctl.setQuery(t.query({ symbols: ['005930'] }));
    await vi.advanceTimersByTimeAsync(0);
    t.resolveAll();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.load).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(RELOAD_IN_SESSION_MS);
    expect(t.load).toHaveBeenCalledTimes(2);
    expect(t.ctl.progress).toBeNull(); // 주기 갱신은 진행률을 보이지 않는다
    expect(t.ctl.entries['005930'].series).not.toBeNull(); // 다시 받는 동안 이전 결과를 지우지 않는다
    t.setInSession(false);
    t.resolveAll();
    await vi.advanceTimersByTimeAsync(RELOAD_IN_SESSION_MS);
    expect(t.load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(RELOAD_OUTSIDE_MS - RELOAD_IN_SESSION_MS);
    expect(t.load).toHaveBeenCalledTimes(3);
    t.resolveAll();
    await vi.advanceTimersByTimeAsync(0);

    t.doc.set('hidden');
    await vi.advanceTimersByTimeAsync(RELOAD_OUTSIDE_MS * 3);
    expect(t.load).toHaveBeenCalledTimes(3);
    t.setNow(NOW + RELOAD_OUTSIDE_MS * 4);
    t.doc.set('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(t.load).toHaveBeenCalledTimes(4);
  });

  it('period change clears results and loads again with progress; adding a symbol loads only it', async () => {
    const t = track(setup());
    t.ctl.setQuery(t.query({ symbols: ['005930'] }));
    await vi.advanceTimersByTimeAsync(0);
    t.resolveAll();
    await vi.advanceTimersByTimeAsync(0);

    t.ctl.setQuery(t.query({ symbols: ['005930'], period: { unit: 'W', n: 2 } }));
    expect(t.ctl.entries).toEqual({});
    expect(t.ctl.progress).toEqual({ done: 0, total: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(t.load.mock.calls.at(-1)![0].period).toEqual({ unit: 'W', n: 2 });
    t.resolveAll();
    await vi.advanceTimersByTimeAsync(0);

    const before = t.load.mock.calls.length;
    t.ctl.setQuery(t.query({ symbols: ['005930', '000660'], period: { unit: 'W', n: 2 } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.load.mock.calls.slice(before).map((c) => c[0].meta.symbol)).toEqual(['000660']);
    expect(t.ctl.entries['005930']).toBeDefined();
  });

  it('a removed symbol mid-load does not leave progress stuck', async () => {
    const t = track(setup());
    t.ctl.setQuery(t.query({ symbols: ['005930', '000660'] }));
    await vi.advanceTimersByTimeAsync(0);
    t.ctl.setQuery(t.query({ symbols: ['005930'] }));
    t.resolveAll();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.ctl.progress).toBeNull();
    expect(Object.keys(t.ctl.entries)).toEqual(['005930']);
  });

  it('late results from a previous period are dropped', async () => {
    const t = track(setup());
    t.ctl.setQuery(t.query({ symbols: ['005930'] }));
    await vi.advanceTimersByTimeAsync(0);
    const old = t.pending.get('005930')!;
    t.pending.clear();
    t.ctl.setQuery(t.query({ symbols: ['005930'], period: { unit: 'Y', n: 1 } }));
    await vi.advanceTimersByTimeAsync(0);
    old.resolve(snap('005930', { tradingDate: 'old' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.ctl.entries['005930']).toBeUndefined();
    t.resolveAll();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.ctl.entries['005930'].series?.tradingDate).toBe(DAY);
  });

  it('a failed periodic index reload keeps the last good index (excess stays available)', async () => {
    const t = track(setup());
    t.ctl.setQuery(t.query({ symbols: ['005930'], excess: true }));
    await vi.waitFor(() => {
      t.resolveAll();
      expect(t.ctl.entries['005930']).toBeDefined();
      expect(t.ctl.indexes.KOSPI?.status).toBe('ok');
    });
    const good = t.ctl.indexes.KOSPI!.series!;
    const stock = t.ctl.entries['005930'].series!;
    const before = metricPoints(stock, 'excess', { index: good, period: { unit: 'D', n: 1 } });

    vi.spyOn(t.provider, 'getTradingDays').mockRejectedValue(new Error('down'));
    await vi.advanceTimersByTimeAsync(RELOAD_IN_SESSION_MS);
    t.resolveAll();
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(t.ctl.indexes.KOSPI?.stale).toBe(true));
    expect(t.ctl.indexes.KOSPI).toMatchObject({ status: 'ok', series: good });
    expect(indexLoadOf([t.ctl.indexes.KOSPI])).toBe('ok');
    const after = metricPoints(t.ctl.entries['005930'].series!, 'excess', { index: t.ctl.indexes.KOSPI!.series, period: { unit: 'D', n: 1 } });
    expect(after).toEqual(before);
  });

  describe('excess pairs stock and index from the same moment', () => {
    const indexMock = vi.mocked(loadIndexSeries);
    const D1 = { unit: 'D', n: 1 } as const;
    const bar = (t: number, c: number) => ({ t, o: c, h: c, l: c, c, v: 1 });
    const indexSeries = (c: number, base: number, computedAt: number): LoadedSeries => ({
      symbol: 'INDEX:KOSPI',
      tradingDate: DAY,
      base,
      avgDailyVolume: null,
      candles: [bar(NOW - 60_000, c)],
      daily: [],
      segments: [],
      intervals: [],
      computedAt,
    });

    const excessOf = (t: ReturnType<typeof setup>, symbol: string) => {
      const pair = t.ctl.excessIndex(symbol, 'KOSPI');
      return metricPoints(t.ctl.entries[symbol].series!, 'excess', { index: pair.series, indexUntil: pair.until, period: D1 });
    };

    it('(a) a failed index refresh: no excess beyond the old index’s last bar, and the index entry is stale', async () => {
      const t = track(setup());
      const old = indexSeries(102, 100, NOW);
      indexMock.mockResolvedValueOnce(old);
      t.ctl.setQuery(t.query({ symbols: ['005930'], excess: true }));
      await vi.waitFor(() => {
        t.resolveAll({ candles: [bar(NOW - 60_000, 110)] });
        expect(t.ctl.entries['005930']).toBeDefined();
        expect(t.ctl.indexes.KOSPI?.status).toBe('ok');
      });

      t.setNow(NOW + 60_000);
      indexMock.mockRejectedValueOnce(new Error('down'));
      await vi.advanceTimersByTimeAsync(RELOAD_IN_SESSION_MS);
      await vi.waitFor(() => expect(t.pending.size).toBe(1));
      t.resolveAll({ candles: [bar(NOW - 60_000, 110), bar(NOW, 120)], computedAt: NOW + 60_000 });
      await vi.waitFor(() => expect(t.ctl.entries['005930'].series?.computedAt).toBe(NOW + 60_000));
      await vi.waitFor(() => expect(t.ctl.indexes.KOSPI?.stale).toBe(true));
      expect(t.ctl.entries['005930'].series?.stale).toBe(false);

      const points = excessOf(t, '005930');
      expect(points.map((p) => p.v)).toEqual([8, null]);
      expect(points.some((p) => p.v !== null && Math.abs(p.v - 18) < 1e-9)).toBe(false);
      const [row] = buildRows([{ item: { symbol: '005930', colorSlot: 1, hidden: false, addedAt: 0 }, series: t.ctl.entries['005930'].series, points }], {
        scrubT: null,
        venueMode: 'AUTO',
      });
      expect(row.value).toBe(8);
      // 화면은 초과수익을 끄지 않고, 지수가 언제 기준인지 알린다.
      expect(indexLoadOf([t.ctl.indexes.KOSPI])).toBe('ok');
      expect(staleIndexAt([t.ctl.indexes.KOSPI])).toBe(NOW);
    });

    it('(b) a stale stock snapshot keeps the excess of its own load when the index’s in-progress bar moves', async () => {
      const t = track(setup());
      indexMock.mockResolvedValueOnce(indexSeries(1010, 1000, NOW));
      t.ctl.setQuery(t.query({ symbols: ['005930'], excess: true }));
      await vi.waitFor(() => {
        t.resolveAll({ candles: [bar(NOW - 60_000, 110)] });
        expect(t.ctl.entries['005930']).toBeDefined();
        expect(t.ctl.indexes.KOSPI?.status).toBe('ok');
      });
      const before = excessOf(t, '005930');
      expect(before.map((p) => p.v)).toEqual([9]);

      // 다음 갱신: 종목은 실패해 같은 snapshot(stale)을, 지수는 같은 시각 진행 봉이 1010 → 1020으로 바뀐 새 결과를 받는다.
      t.setNow(NOW + 60_000);
      indexMock.mockResolvedValueOnce(indexSeries(1020, 1000, NOW + 60_000));
      await vi.advanceTimersByTimeAsync(RELOAD_IN_SESSION_MS);
      await vi.waitFor(() => expect(t.pending.size).toBe(1));
      t.resolveAll({ candles: [bar(NOW - 60_000, 110)], stale: true });
      await vi.waitFor(() => expect(t.ctl.entries['005930'].series?.stale).toBe(true));
      await vi.waitFor(() => expect(t.ctl.indexes.KOSPI?.series?.computedAt).toBe(NOW + 60_000));
      expect(t.ctl.entries['005930'].series?.stale).toBe(true);
      expect(excessOf(t, '005930')).toEqual(before);

      // 종목이 다시 새로 받아지면 지금 지수와 짝짓는다.
      t.setNow(NOW + 120_000);
      indexMock.mockResolvedValueOnce(indexSeries(1020, 1000, NOW + 120_000));
      await vi.advanceTimersByTimeAsync(RELOAD_IN_SESSION_MS);
      await vi.waitFor(() => expect(t.pending.size).toBe(1));
      t.resolveAll({ candles: [bar(NOW - 60_000, 110)], computedAt: NOW + 120_000 });
      await vi.waitFor(() => expect(t.ctl.entries['005930'].series?.computedAt).toBe(NOW + 120_000));
      await vi.waitFor(() => expect(t.ctl.indexes.KOSPI?.series?.computedAt).toBe(NOW + 120_000));
      expect(excessOf(t, '005930').map((p) => p.v)).toEqual([8]);
    });
  });

  it('an index that never loaded is failed', async () => {
    const t = track(setup());
    vi.spyOn(t.provider, 'getTradingDays').mockRejectedValue(new Error('down'));
    t.ctl.setQuery(t.query({ symbols: ['005930'], excess: true }));
    await vi.advanceTimersByTimeAsync(0);
    t.resolveAll();
    await vi.waitFor(() => expect(t.ctl.indexes.KOSPI?.status).toBe('failed'));
    expect(indexLoadOf([t.ctl.indexes.KOSPI])).toBe('failed');
  });

  it('a key change cancels the previous key’s reload timer', async () => {
    const t = track(setup());
    t.ctl.setQuery(t.query({ symbols: ['005930'] }));
    await vi.advanceTimersByTimeAsync(0);
    t.resolveAll();
    await vi.advanceTimersByTimeAsync(30_000);
    t.ctl.setQuery(t.query({ symbols: ['005930'], period: { unit: 'W', n: 1 } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.load).toHaveBeenCalledTimes(2);
    // 새 키의 로딩이 끝나지 않은 채 이전 키의 60초 시점을 지나도 추가 로딩이 없다.
    await vi.advanceTimersByTimeAsync(RELOAD_IN_SESSION_MS);
    expect(t.load).toHaveBeenCalledTimes(2);
  });

  it('excess loads the market index of each stock (AUTO) or the chosen benchmark', async () => {
    const provider = createDemoProvider({ seed: 1, now: () => NOW });
    const base = provider.getStockMeta.bind(provider);
    provider.getStockMeta = async (symbols) =>
      (await base(symbols)).map((m) => (m.symbol === '042700' ? { ...m, market: 'KOSDAQ' as const } : m));
    const indexCalls = vi.spyOn(provider as Required<MarketDataProvider>, 'getIndexCandles');
    const t = track(setup({ provider }));
    t.ctl.setQuery(t.query({ excess: true }));
    await vi.advanceTimersByTimeAsync(0);
    t.resolveAll();
    await vi.waitFor(() => expect(t.ctl.indexes.KOSDAQ?.status).toBe('ok'));
    expect(t.ctl.indexes.KOSPI?.status).toBe('ok');
    expect(t.ctl.indexFor('042700')).toBe('KOSDAQ');
    expect(t.ctl.indexFor('005930')).toBe('KOSPI');
    expect(indexCalls.mock.calls.map((c) => c[0]).sort()).toEqual(['KOSDAQ', 'KOSDAQ', 'KOSPI', 'KOSPI']); // 1m + 1d each

    t.ctl.setQuery(t.query({ excess: true, benchmark: 'KOSPI' }));
    expect(t.ctl.indexFor('042700')).toBe('KOSPI');
  });

  it('metric other than excess does not load indexes', async () => {
    const t = track(setup());
    const indexCalls = vi.spyOn(t.provider as Required<MarketDataProvider>, 'getIndexCandles');
    t.ctl.setQuery(t.query());
    await vi.advanceTimersByTimeAsync(0);
    t.resolveAll();
    await vi.advanceTimersByTimeAsync(0);
    expect(indexCalls).not.toHaveBeenCalled();
    expect(t.ctl.indexes).toEqual({});
  });

  it('refresh reloads series and quotes now', async () => {
    const t = track(setup());
    t.ctl.setQuery(t.query({ symbols: ['005930'] }));
    await vi.advanceTimersByTimeAsync(0);
    t.resolveAll();
    await vi.advanceTimersByTimeAsync(0);
    const quotesBefore = t.getQuotes.mock.calls.length;
    const done = t.ctl.refresh();
    await vi.advanceTimersByTimeAsync(0);
    t.resolveAll();
    await done;
    expect(t.load).toHaveBeenCalledTimes(2);
    expect(t.getQuotes.mock.calls.length).toBe(quotesBefore + 1);
  });

  it('works end to end with real snapshots (demo provider)', async () => {
    vi.useRealTimers();
    const provider = createDemoProvider({ seed: 1, now: () => NOW });
    const data: AppData = { cache: memoryCache(), memo: createDailyMemo(), snapshots: createSeriesSnapshots() };
    const ctl = createCompareController({ now: () => NOW, inSession: () => true, sessions: () => sessions, doc: fakeDoc() as unknown as Document });
    ctls.push(ctl);
    ctl.setQuery({ provider, data, symbols: ['005930', '000660'], period: { unit: 'D', n: 1 }, venueMode: 'AUTO', excess: false, benchmark: 'AUTO' });
    await vi.waitFor(() => expect(ctl.progress).toBeNull());
    expect(ctl.entries['005930'].series?.candles.length).toBeGreaterThan(0);
    expect(ctl.entries['000660'].series?.stale).toBe(false);
    const q: Quote | undefined = await vi.waitFor(() => {
      const v = ctl.quotes['005930'];
      if (!v) throw new Error('no quote yet');
      return v;
    });
    expect(q.venue).toBe('KRX');
  });
});
