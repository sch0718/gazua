import { describe, expect, it } from 'vitest';
import { createDemoProvider } from '../providers/demo';
import type { MarketDataProvider } from '../providers/types';
import { kstEpoch } from '../time/kst';
import { createDailyMemo, loadIndexSeries, loadSeries } from './candleService';
import { RANK_METRICS, orderRanked, rankCandidates, type RankRow } from './rankCandidates';
import { metricPoints } from './seriesMetrics';
import { memoryCache } from './testCache';

const NOW = kstEpoch('2026-10-16', '20:30:00');
const M1 = { unit: 'M' as const, n: 1 };

function deps(provider: MarketDataProvider = createDemoProvider({ seed: 1, now: () => NOW })) {
  return { provider, cache: memoryCache(), memo: createDailyMemo(), now: NOW, venueMode: 'AUTO' as const, benchmark: 'AUTO' as const };
}

const lastValue = (points: { v: number | null }[]) => [...points].reverse().find((p) => p.v !== null)?.v ?? null;

describe('orderRanked', () => {
  const rows: RankRow[] = [
    { symbol: 'A', value: 1 },
    { symbol: 'B', value: null, reason: '값 없음' },
    { symbol: 'C', value: 5 },
    { symbol: 'D', value: -2 },
    { symbol: 'E', value: 5 },
  ];

  it('큰 순: largest first, ties keep the candidate order, rows without a value last', () => {
    expect(orderRanked(rows, 'desc').map((r) => r.symbol)).toEqual(['C', 'E', 'A', 'D', 'B']);
  });

  it('작은 순: smallest first, rows without a value still last', () => {
    expect(orderRanked(rows, 'asc').map((r) => r.symbol)).toEqual(['D', 'A', 'C', 'E', 'B']);
  });
});

describe('rankCandidates', () => {
  it('offers the metrics that work from daily candles of the chosen period', () => {
    expect(RANK_METRICS).toEqual(['excess', 'change', 'drawdown', 'rvol', 'mcap']);
  });

  it('change: each value is the last point of the same series the compare screen draws', async () => {
    const d = deps();
    const symbols = ['005930', '000660', '042700'];
    const rows = await rankCandidates({ ...d, symbols, metric: 'change', period: M1 });
    expect(rows.map((r) => r.symbol)).toEqual(symbols);
    const metas = await d.provider.getStockMeta(symbols);
    for (const meta of metas) {
      const series = await loadSeries({ ...d, cache: memoryCache(), memo: createDailyMemo(), meta, period: M1 });
      const expected = lastValue(metricPoints(series, 'change', { period: M1 }));
      expect(rows.find((r) => r.symbol === meta.symbol)!.value).toBeCloseTo(expected!, 9);
    }
  });

  it('excess: uses the stock market index (KOSPI/KOSDAQ) like the compare screen with 자동 benchmark', async () => {
    // 데모 공급자는 종목 목록 없이 돌면 시장을 KOSPI로 주므로 247540을 KOSDAQ으로 바꿔 준다.
    const demo = createDemoProvider({ seed: 1, now: () => NOW });
    const provider: MarketDataProvider = {
      ...demo,
      getStockMeta: async (s) => (await demo.getStockMeta(s)).map((m) => (m.symbol === '247540' ? { ...m, market: 'KOSDAQ' } : m)),
    };
    const d = deps(provider);
    const rows = await rankCandidates({ ...d, symbols: ['005930', '247540'], metric: 'excess', period: M1 });
    const [samsung, ecopro] = await provider.getStockMeta(['005930', '247540']);
    expect(ecopro.market).toBe('KOSDAQ');
    for (const [meta, index] of [[samsung, 'KOSPI'], [ecopro, 'KOSDAQ']] as const) {
      const series = await loadSeries({ ...d, cache: memoryCache(), memo: createDailyMemo(), meta, period: M1 });
      const idx = await loadIndexSeries({ provider: d.provider, cache: memoryCache(), index, period: M1, now: NOW });
      const expected = lastValue(metricPoints(series, 'excess', { period: M1, index: idx }));
      expect(rows.find((r) => r.symbol === meta.symbol)!.value).toBeCloseTo(expected!, 9);
    }
  });

  it('a symbol the provider does not know gets no value and a reason, and does not fail the rest', async () => {
    const d = deps();
    const base = d.provider;
    const provider: MarketDataProvider = {
      ...base,
      getStockMeta: async (s) => (await base.getStockMeta(s)).filter((m) => m.symbol !== '999999'),
    };
    const rows = await rankCandidates({ ...d, provider, symbols: ['005930', '999999'], metric: 'change', period: M1 });
    expect(rows[0].value).not.toBeNull();
    expect(rows[1]).toEqual({ symbol: '999999', value: null, reason: '종목 정보를 받지 못했어요' });
  });

  it('a failed candle request becomes a row without a value', async () => {
    const d = deps();
    const base = d.provider;
    const provider: MarketDataProvider = {
      ...base,
      getCandles: async (q) => {
        if (q.symbol === '000660') throw new Error('boom');
        return base.getCandles(q);
      },
    };
    const rows = await rankCandidates({ ...d, provider, symbols: ['005930', '000660'], metric: 'change', period: M1 });
    expect(rows[1]).toEqual({ symbol: '000660', value: null, reason: '불러오지 못했어요' });
  });

  it('reports progress as candidates finish', async () => {
    const d = deps();
    const seen: number[] = [];
    await rankCandidates({ ...d, symbols: ['005930', '000660', '042700'], metric: 'change', period: M1, onProgress: (done) => seen.push(done) });
    expect(seen.at(-1)).toBe(3);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });
});
