import { describe, expect, it } from 'vitest';
import { newStrategy } from '../sim/defaults';
import { kstEpoch } from '../time/kst';
import { BENCH_MAX, MAX_CRITERIA, TAKE_MAX, newCriteria } from './defaults';

const NOW = kstEpoch('2026-10-16', '12:00:00');

describe('newCriteria', () => {
  it('기본값이 스펙 5장과 같다', () => {
    const c = newCriteria(NOW, { from: '2021-03-02', to: '2026-10-15' });
    expect(c.name).toBe('새 기준');
    expect(c.updatedAt).toBe(NOW);
    expect(c.id).not.toBe('');
    expect(c.pool).toEqual({ markets: ['KOSPI', 'KOSDAQ'], types: ['STOCK'], excludeManaged: true, sectors: [], themes: [], baskets: [] });
    expect(c.conditions).toEqual({
      marketCap: { on: false, minEok: 1000 },
      tradingValue: { on: true, days: 20, minEok: 10 },
      leader: { on: false, level: 1, maxRank: 3 },
      returnRange: { on: false, days: 60, minPct: -30, maxPct: 0 },
      vsMa: { on: false, period: 60, side: 'above' },
      fromHigh: { on: false, minPct: 20, maxPct: 50 },
      volatility: { on: false, days: 20, maxPct: 3 },
      rebound: { on: true, withinDays: 10, pattern: { from: 'custom', entry: newStrategy(NOW, null).entry } },
      macro: {
        betaDays: 120,
        usdkrw: { beta: { on: false, min: 0.3, max: 5 }, trend: { on: false, lookback: 20, thresholdPct: 3, minAbsBeta: 0.3, whenFlat: 'pass' } },
        wti: { beta: { on: false, min: 0.3, max: 5 }, trend: { on: false, lookback: 20, thresholdPct: 3, minAbsBeta: 0.3, whenFlat: 'pass' } },
      },
    });
    expect(c.rank).toEqual({ by: 'marketCap', take: 10, series: 'usdkrw' });
    expect(c.rebalance).toBe('monthly');
    expect(c.benchmarks).toEqual({ indices: ['KOSPI'], symbols: ['069500'] });
    expect(c.costs).toEqual({ feePct: 0.015 });
    expect(c.capital).toBe(10_000_000);
    expect(c.trading).toEqual({ strategyId: null });
  });

  it('상수', () => {
    expect([MAX_CRITERIA, TAKE_MAX, BENCH_MAX]).toEqual([20, 30, 3]);
  });

  it('기간은 데이터 시작 + 1년 ~ 데이터 끝', () => {
    expect(newCriteria(NOW, { from: '2021-03-02', to: '2026-10-15' }).period).toEqual({ from: '2022-03-02', to: '2026-10-15' });
  });

  it('윤일 시작이면 2월 28일로 맞춘다', () => {
    expect(newCriteria(NOW, { from: '2024-02-29', to: '2026-10-15' }).period.from).toBe('2025-02-28');
  });

  it('데이터가 1년이 안 되면 시작부터 쓴다', () => {
    expect(newCriteria(NOW, { from: '2026-05-01', to: '2026-10-15' }).period).toEqual({ from: '2026-05-01', to: '2026-10-15' });
  });

  it('데이터가 없으면 최근 3년(어제까지)', () => {
    expect(newCriteria(NOW, null).period).toEqual({ from: '2023-10-15', to: '2026-10-15' });
  });

  it('이름을 줄 수 있고 id는 매번 다르다', () => {
    const a = newCriteria(NOW, null, '내 기준');
    expect(a.name).toBe('내 기준');
    expect(newCriteria(NOW, null).id).not.toBe(newCriteria(NOW, null).id);
  });
});
