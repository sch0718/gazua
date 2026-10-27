import { describe, expect, it } from 'vitest';
import { newStrategy } from '../sim/defaults';
import { kstEpoch } from '../time/kst';
import { MAX_BASKETS } from './baskets';
import { newCriteria, POOL_THEMES_MAX } from './defaults';
import type { SelectionCriteria } from './types';
import { criteriaIssues, finOn, flowOn, sanitizeCriteria, usesFin, usesFlow } from './validate';

const NOW = kstEpoch('2026-10-16', '12:00:00');
const RANGE = { from: '2021-03-02', to: '2026-10-15' };
const base = (id = 'c1'): SelectionCriteria => ({ ...newCriteria(NOW, RANGE), id });
const run = (patch: (c: Record<string, any>) => void) => {
  const c: Record<string, any> = structuredClone(base());
  patch(c);
  return sanitizeCriteria({ criteria: [c] }, NOW);
};

describe('sanitizeCriteria', () => {
  it('정상 값은 그대로이고 repaired false', () => {
    const c = base();
    expect(sanitizeCriteria({ criteria: [c] }, NOW)).toEqual({ criteria: [c], repaired: false });
  });

  it('루트가 없으면 조용히 빈 목록, 모양이 틀리면 repaired', () => {
    expect(sanitizeCriteria(null, NOW)).toEqual({ criteria: [], repaired: false });
    expect(sanitizeCriteria({}, NOW)).toEqual({ criteria: [], repaired: false });
    expect(sanitizeCriteria({ criteria: 'x' }, NOW)).toEqual({ criteria: [], repaired: true });
    expect(sanitizeCriteria([], NOW)).toEqual({ criteria: [], repaired: true });
  });

  it.each([0, 31, 2.5, NaN, '5'])('take: %s는 기본값 10으로 되돌린다', (take) => {
    const r = run((c) => (c.rank.take = take));
    expect(r.criteria[0].rank.take).toBe(10);
    expect(r.repaired).toBe(true);
  });

  it.each([1, 30])('take: %s는 그대로 둔다', (take) => {
    const r = run((c) => (c.rank.take = take));
    expect(r.criteria[0].rank.take).toBe(take);
    expect(r.repaired).toBe(false);
  });

  it('markets: []는 기본값(둘 다)으로 되돌린다', () => {
    const r = run((c) => (c.pool.markets = []));
    expect(r.criteria[0].pool.markets).toEqual(['KOSPI', 'KOSDAQ']);
    expect(r.repaired).toBe(true);
  });

  it('types: []와 잘못된 열거값은 기본값', () => {
    const r = run((c) => (c.pool.types = []));
    expect(r.criteria[0].pool.types).toEqual(['STOCK']);
    expect(r.repaired).toBe(true);
    const r2 = run((c) => (c.pool.types = ['ETN']));
    expect(r2.criteria[0].pool.types).toEqual(['STOCK']);
    expect(r2.repaired).toBe(true);
  });

  it('잘못된 열거값(rank.by, rebalance, vsMa.side, leader.level)은 기본값', () => {
    const r = run((c) => {
      c.rank.by = 'x';
      c.rebalance = 'daily';
      c.conditions.vsMa.side = 'up';
      c.conditions.leader.level = 3;
    });
    const k = r.criteria[0];
    expect([k.rank.by, k.rebalance, k.conditions.vsMa.side, k.conditions.leader.level]).toEqual(['marketCap', 'monthly', 'above', 1]);
    expect(r.repaired).toBe(true);
  });

  it('benchmarks.symbols 4개는 3개로 자르고 repaired', () => {
    const r = run((c) => (c.benchmarks.symbols = ['1', '2', '3', '4']));
    expect(r.criteria[0].benchmarks.symbols).toEqual(['1', '2', '3']);
    expect(r.repaired).toBe(true);
  });

  it('benchmarks.symbols 3개는 그대로, indices는 빈 배열도 허용', () => {
    const r = run((c) => {
      c.benchmarks.symbols = ['1', '2', '3'];
      c.benchmarks.indices = [];
    });
    expect(r.criteria[0].benchmarks).toEqual({ indices: [], symbols: ['1', '2', '3'] });
    expect(r.repaired).toBe(false);
  });

  it('빈 id·id 없음·이름 없음 항목은 버린다', () => {
    const ok = base('ok');
    const r = sanitizeCriteria({ criteria: [{ ...ok, id: '' }, { ...ok, id: '  ' }, { ...ok, id: undefined }, { ...ok, name: 3 }, ok, 'x'] }, NOW);
    expect(r.criteria.map((c) => c.id)).toEqual(['ok']);
    expect(r.repaired).toBe(true);
  });

  it('id가 겹치면 뒤 항목을 버리고, 20개까지만 남긴다', () => {
    const dup = sanitizeCriteria({ criteria: [base('a'), base('a')] }, NOW);
    expect(dup.criteria).toHaveLength(1);
    expect(dup.repaired).toBe(true);
    const many = Array.from({ length: 21 }, (_, i) => base(`c${i}`));
    const r = sanitizeCriteria({ criteria: many }, NOW);
    expect(r.criteria).toHaveLength(20);
    expect(r.repaired).toBe(true);
  });

  it('정수 필드는 소수를 받지 않는다', () => {
    const r = run((c) => {
      c.conditions.tradingValue.days = 2.5;
      c.conditions.vsMa.period = 60.5;
      c.conditions.rebound.withinDays = 1.5;
      c.capital = 1000.5;
    });
    const k = r.criteria[0];
    expect([k.conditions.tradingValue.days, k.conditions.vsMa.period, k.conditions.rebound.withinDays, k.capital]).toEqual([20, 60, 10, 10_000_000]);
    expect(r.repaired).toBe(true);
  });

  it('범위 밖 숫자는 기본값', () => {
    const r = run((c) => {
      c.conditions.marketCap.minEok = -1;
      c.conditions.volatility.maxPct = 101;
      c.costs.feePct = 2;
      c.conditions.fromHigh.minPct = Infinity;
    });
    const k = r.criteria[0];
    expect([k.conditions.marketCap.minEok, k.conditions.volatility.maxPct, k.costs.feePct, k.conditions.fromHigh.minPct]).toEqual([1000, 3, 0.015, 20]);
    expect(r.repaired).toBe(true);
  });

  it('이름은 30자로 자르고 repaired', () => {
    const r = run((c) => (c.name = '가'.repeat(31)));
    expect(r.criteria[0].name).toHaveLength(30);
    expect(r.repaired).toBe(true);
  });

  it('없는 필드는 조용히 기본값(repaired false)', () => {
    const r = sanitizeCriteria({ criteria: [{ id: 'a', name: '최소' }] }, NOW);
    expect(r.repaired).toBe(false);
    expect(r.criteria[0]).toMatchObject({ id: 'a', name: '최소', rank: { by: 'marketCap', take: 10 }, trading: { strategyId: null } });
  });

  it('잘못된 날짜 기간은 기본 기간(최근 3년)으로 되돌린다', () => {
    const r = run((c) => (c.period = { from: '2026-02-30', to: 'x' }));
    expect(r.criteria[0].period).toEqual({ from: '2023-10-15', to: '2026-10-15' });
    expect(r.repaired).toBe(true);
  });

  it('반등 패턴: strategy·custom은 유지하고, custom의 소수 기간은 고친다', () => {
    const s = run((c) => (c.conditions.rebound.pattern = { from: 'strategy', strategyId: 's1' }));
    expect(s.criteria[0].conditions.rebound.pattern).toEqual({ from: 'strategy', strategyId: 's1' });
    expect(s.repaired).toBe(false);
    const bad = run((c) => (c.conditions.rebound.pattern.entry.filter.aboveMa = { on: true, period: 2.5 }));
    const p = bad.criteria[0].conditions.rebound.pattern;
    expect(p.from === 'custom' && p.entry.filter.aboveMa.period).toBe(60);
    expect(bad.repaired).toBe(true);
    const wrong = run((c) => (c.conditions.rebound.pattern = { from: 'strategy' }));
    expect(wrong.criteria[0].conditions.rebound.pattern.from).toBe('custom');
    expect(wrong.repaired).toBe(true);
  });

  it('trading.strategyId는 null 또는 비어 있지 않은 문자열만', () => {
    expect(run((c) => (c.trading.strategyId = 's9')).criteria[0].trading.strategyId).toBe('s9');
    const r = run((c) => (c.trading.strategyId = 5));
    expect(r.criteria[0].trading.strategyId).toBeNull();
    expect(r.repaired).toBe(true);
  });
});

describe('criteriaIssues', () => {
  const strat = { ...newStrategy(NOW, null), id: 's1' };
  const withRef = (patch: (c: SelectionCriteria) => void) => {
    const c = base();
    patch(c);
    return c;
  };

  it('기본 기준은 이슈가 없다', () => {
    expect(criteriaIssues(base(), [])).toEqual([]);
  });

  it('참조 전략이 있으면 이슈 없고, 지워지면 blocking', () => {
    const c = withRef((x) => {
      x.conditions.rebound.pattern = { from: 'strategy', strategyId: 's1' };
      x.trading.strategyId = 's1';
    });
    expect(criteriaIssues(c, [strat])).toEqual([]);
    const gone = criteriaIssues(c, []);
    expect(gone).toHaveLength(2);
    expect(gone.every((i) => i.blocking)).toBe(true);
    expect(gone.map((i) => i.section).sort()).toEqual(['conditions', 'trading']);
  });

  it('반등 조건을 껐으면 지워진 전략을 참조해도 막지 않는다', () => {
    const c = withRef((x) => {
      x.conditions.rebound.on = false;
      x.conditions.rebound.pattern = { from: 'strategy', strategyId: 'gone' };
    });
    expect(criteriaIssues(c, []).filter((i) => i.section === 'conditions' && i.blocking)).toEqual([]);
  });

  it('반등 조건을 켰는데 전략이 지워졌으면 blocking', () => {
    const c = withRef((x) => {
      x.conditions.rebound.on = true;
      x.conditions.rebound.pattern = { from: 'strategy', strategyId: 'gone' };
    });
    expect(criteriaIssues(c, []).filter((i) => i.section === 'conditions' && i.blocking)).toHaveLength(1);
  });

  it('반등만 켜져 있고 전략이 없으면 blocking만 나오고 조건 없음 경고는 없다', () => {
    const c = withRef((x) => {
      x.conditions.tradingValue.on = false;
      x.conditions.rebound.pattern = { from: 'strategy', strategyId: 'gone' };
    });
    const out = criteriaIssues(c, []);
    expect(out).toHaveLength(1);
    expect(out[0].blocking).toBe(true);
  });

  it('매매 규칙 전략만 지워져도 blocking', () => {
    const c = withRef((x) => (x.trading.strategyId = 'gone'));
    expect(criteriaIssues(c, [strat]).filter((i) => i.blocking)).toHaveLength(1);
  });

  it('켠 조건이 0개면 경고(막지 않음)', () => {
    const c = withRef((x) => {
      x.conditions.tradingValue.on = false;
      x.conditions.rebound.on = false;
    });
    expect(criteriaIssues(c, [])).toEqual([
      { section: 'conditions', text: '조건이 없으면 후보 범위의 모든 종목에서 정렬 순으로 골라요', blocking: false },
    ]);
  });

  it('시작일이 종료일 이상이면 blocking', () => {
    const c = withRef((x) => (x.period = { from: '2026-01-01', to: '2026-01-01' }));
    expect(criteriaIssues(c, []).some((i) => i.section === 'period' && i.blocking)).toBe(true);
  });

  // PR #11 리뷰 W2: 전략 편집 화면이 실행을 막는 오류 전략은 ②·반등 패턴에서도 막는다
  const noSignals = () => {
    const s = { ...newStrategy(NOW, null), id: 's1' };
    for (const t of Object.values(s.entry.triggers)) t.on = false;
    return s;
  };
  const badTakeProfit = () => ({
    ...newStrategy(NOW, null),
    id: 's1',
    exit: { ...newStrategy(NOW, null).exit, takeProfit: [{ pct: 10, sellPct: 50 }, { pct: 5, sellPct: 100 }] },
  });

  it('② 전략의 매수 신호가 모두 꺼져 있으면 blocking(전략 편집 문구를 붙여서)', () => {
    const c = withRef((x) => (x.trading.strategyId = 's1'));
    const out = criteriaIssues(c, [noSignals()]).filter((i) => i.blocking);
    expect(out).toEqual([
      { section: 'trading', text: '매매 규칙 전략에 고칠 곳이 있어요: 사는 신호가 하나도 켜져 있지 않아요. 전략 편집에서 하나 이상 켜 주세요', blocking: true },
    ]);
  });

  it('② 전략의 익절 단계가 역순이면 blocking', () => {
    const c = withRef((x) => (x.trading.strategyId = 's1'));
    expect(criteriaIssues(c, [badTakeProfit()]).filter((i) => i.blocking)).toEqual([
      { section: 'trading', text: '매매 규칙 전략에 고칠 곳이 있어요: 익절 단계는 낮은 %부터 차례로 적어 주세요', blocking: true },
    ]);
  });

  it('반등 패턴 전략은 매수(entry) 오류만 막는다', () => {
    const c = withRef((x) => (x.conditions.rebound = { on: true, withinDays: 10, pattern: { from: 'strategy', strategyId: 's1' } }));
    expect(criteriaIssues(c, [noSignals()]).filter((i) => i.blocking)).toEqual([
      { section: 'conditions', text: '반등 패턴 전략에 고칠 곳이 있어요: 사는 신호가 하나도 켜져 있지 않아요. 전략 편집에서 하나 이상 켜 주세요', blocking: true },
    ]);
    expect(criteriaIssues(c, [badTakeProfit()]).filter((i) => i.blocking)).toEqual([]);
    // 반등 조건을 끄면 보지 않는다
    c.conditions.rebound.on = false;
    expect(criteriaIssues(c, [noSignals()]).filter((i) => i.blocking)).toEqual([]);
  });

  it('전략의 종목 범위가 비어 있거나 기간이 틀려도 막지 않는다(선정 기준 값으로 대체)', () => {
    const s = { ...newStrategy(NOW, null), id: 's1', period: { from: '2026-01-01', to: '2025-01-01' } };
    expect(s.universe).toEqual({ kind: 'symbols', symbols: [] });
    const c = withRef((x) => (x.trading.strategyId = 's1'));
    expect(criteriaIssues(c, [s]).filter((i) => i.blocking)).toEqual([]);
  });

  it('범위가 뒤집힌 수익률·고점 대비는 blocking', () => {
    const c = withRef((x) => {
      x.conditions.returnRange = { on: true, days: 60, minPct: 10, maxPct: -10 };
      x.conditions.fromHigh = { on: true, minPct: 50, maxPct: 20 };
    });
    expect(criteriaIssues(c, []).filter((i) => i.blocking)).toHaveLength(2);
  });
});

describe('새 필드(테마·묶음·환율·유가)', () => {
  it('옛 기준(새 필드 없음)은 조용히 기본값을 받고 repaired false', () => {
    const old: Record<string, any> = structuredClone(base());
    delete old.pool.themes;
    delete old.pool.baskets;
    delete old.conditions.macro;
    delete old.rank.series;
    const r = sanitizeCriteria({ criteria: [old] }, NOW);
    expect(r.repaired).toBe(false);
    expect(r.criteria[0]).toEqual(base());
    expect(r.criteria[0].pool.themes).toEqual([]);
    expect(r.criteria[0].conditions.macro.betaDays).toBe(120);
    expect(r.criteria[0].conditions.macro.usdkrw).toEqual({
      beta: { on: false, min: 0.3, max: 5 },
      trend: { on: false, lookback: 20, thresholdPct: 3, minAbsBeta: 0.3, whenFlat: 'pass' },
    });
    expect(r.criteria[0].rank.series).toBe('usdkrw');
  });

  it.each([
    ['betaDays 29', (c: any) => (c.conditions.macro.betaDays = 29), (c: any) => c.conditions.macro.betaDays, 120],
    ['betaDays 소수', (c: any) => (c.conditions.macro.betaDays = 100.5), (c: any) => c.conditions.macro.betaDays, 120],
    ['beta.min -21', (c: any) => (c.conditions.macro.wti.beta.min = -21), (c: any) => c.conditions.macro.wti.beta.min, 0.3],
    ['beta.max 21', (c: any) => (c.conditions.macro.usdkrw.beta.max = 21), (c: any) => c.conditions.macro.usdkrw.beta.max, 5],
    ['lookback 4', (c: any) => (c.conditions.macro.usdkrw.trend.lookback = 4), (c: any) => c.conditions.macro.usdkrw.trend.lookback, 20],
    ['lookback 121', (c: any) => (c.conditions.macro.usdkrw.trend.lookback = 121), (c: any) => c.conditions.macro.usdkrw.trend.lookback, 20],
    ['thresholdPct 0.4', (c: any) => (c.conditions.macro.wti.trend.thresholdPct = 0.4), (c: any) => c.conditions.macro.wti.trend.thresholdPct, 3],
    ['thresholdPct 51', (c: any) => (c.conditions.macro.wti.trend.thresholdPct = 51), (c: any) => c.conditions.macro.wti.trend.thresholdPct, 3],
    ['minAbsBeta -1', (c: any) => (c.conditions.macro.wti.trend.minAbsBeta = -1), (c: any) => c.conditions.macro.wti.trend.minAbsBeta, 0.3],
    ['whenFlat x', (c: any) => (c.conditions.macro.wti.trend.whenFlat = 'x'), (c: any) => c.conditions.macro.wti.trend.whenFlat, 'pass'],
  ])('범위를 벗어난 macro 값(%s)은 기본값으로 고치고 repaired', (_n, patch, read, def) => {
    const r = run(patch);
    expect(read(r.criteria[0])).toBe(def);
    expect(r.repaired).toBe(true);
  });

  it('macro 경계값은 그대로 둔다', () => {
    const r = run((c) => {
      c.conditions.macro.betaDays = 30;
      c.conditions.macro.usdkrw.beta = { on: true, min: -20, max: 20 };
      c.conditions.macro.wti.trend = { on: true, lookback: 120, thresholdPct: 0.5, minAbsBeta: 0, whenFlat: 'none' };
    });
    expect(r.repaired).toBe(false);
    expect(r.criteria[0].conditions.macro.wti.trend.whenFlat).toBe('none');
  });

  it('pool.themes·baskets: 문자열만 중복 없이, 틀린 것은 repaired', () => {
    const r = run((c) => {
      c.pool.themes = ['T1', 'T1', 3];
      c.pool.baskets = ['b1'];
    });
    expect(r.criteria[0].pool.themes).toEqual(['T1']);
    expect(r.criteria[0].pool.baskets).toEqual(['b1']);
    expect(r.repaired).toBe(true);
    const r2 = run((c) => (c.pool.themes = 'x'));
    expect(r2.criteria[0].pool.themes).toEqual([]);
    expect(r2.repaired).toBe(true);
  });

  it('pool.themes는 POOL_THEMES_MAX개, pool.baskets는 MAX_BASKETS개까지 앞에서부터 남기고 repaired', () => {
    const themes = Array.from({ length: POOL_THEMES_MAX + 1 }, (_, i) => `T${i}`);
    const baskets = Array.from({ length: MAX_BASKETS + 1 }, (_, i) => `b${i}`);
    const r = run((c) => {
      c.pool.themes = themes;
      c.pool.baskets = baskets;
    });
    expect(r.criteria[0].pool.themes).toEqual(themes.slice(0, POOL_THEMES_MAX));
    expect(r.criteria[0].pool.baskets).toEqual(baskets.slice(0, MAX_BASKETS));
    expect(r.repaired).toBe(true);
    const ok = run((c) => {
      c.pool.themes = themes.slice(0, POOL_THEMES_MAX);
      c.pool.baskets = baskets.slice(0, MAX_BASKETS);
    });
    expect(ok.repaired).toBe(false);
  });

  it('rank.by macroBeta는 받고, series는 그때만 검증한다', () => {
    const ok = run((c) => {
      c.rank.by = 'macroBeta';
      c.rank.series = 'wti';
    });
    expect(ok.criteria[0].rank).toMatchObject({ by: 'macroBeta', series: 'wti' });
    expect(ok.repaired).toBe(false);
    const bad = run((c) => {
      c.rank.by = 'macroBeta';
      c.rank.series = 'gold';
    });
    expect(bad.criteria[0].rank.series).toBe('usdkrw');
    expect(bad.repaired).toBe(true);
    const other = run((c) => (c.rank.series = 'gold'));
    expect(other.repaired).toBe(false);
  });
});

describe('criteriaIssues: 데이터·묶음·테마', () => {
  const withMacro = () => {
    const c = base();
    c.conditions.macro.usdkrw.beta.on = true;
    return c;
  };

  it('dataInfo를 생략하면 macro가 켜져 있어도 이슈가 없다', () => {
    expect(criteriaIssues(withMacro(), [])).toEqual([]);
  });

  it('v1 데이터(hasMacro false)에서 macro 조건이 켜져 있으면 blocking', () => {
    const out = criteriaIssues(withMacro(), [], { hasMacro: false, hasFlow: true, hasFin: true });
    expect(out).toEqual([{ section: 'conditions', text: '이 데이터에는 환율·유가가 없어요', blocking: true }]);
  });

  it('v1 데이터라도 macro 조건이 꺼져 있으면 이슈가 없고, v2면 켜져 있어도 없다', () => {
    expect(criteriaIssues(base(), [], { hasMacro: false, hasFlow: true, hasFin: true })).toEqual([]);
    expect(criteriaIssues(withMacro(), [], { hasMacro: true, hasFlow: true, hasFin: true })).toEqual([]);
  });

  it('macro만 켠 기준에는 조건 없음 경고를 내지 않는다', () => {
    const c = withMacro();
    c.conditions.tradingValue.on = false;
    c.conditions.rebound.on = false;
    expect(criteriaIssues(c, [], { hasMacro: true, hasFlow: true, hasFin: true })).toEqual([]);
  });

  it('지워진 내 묶음은 경고(blocking 아님)', () => {
    const c = base();
    c.pool.baskets = ['b1', 'gone'];
    expect(criteriaIssues(c, [], undefined, [{ id: 'b1' }])).toEqual([
      { section: 'pool', text: '지워진 내 묶음이 있어요. 다시 골라 주세요', blocking: false },
    ]);
    expect(criteriaIssues(c, [], undefined, [{ id: 'b1' }, { id: 'gone' }])).toEqual([]);
  });

  it('데이터에 없는 테마는 경고(blocking 아님)', () => {
    const c = base();
    c.pool.themes = ['T1', 'T9'];
    expect(criteriaIssues(c, [], { hasMacro: true, hasFlow: true, hasFin: true, themeCodes: ['T1'] })).toEqual([
      { section: 'pool', text: '지금 데이터에 없는 테마가 있어요', blocking: false },
    ]);
    expect(criteriaIssues(c, [], { hasMacro: true, hasFlow: true, hasFin: true })).toEqual([]);
  });
});

describe('criteriaIssues: 민감도 범위와 환율·유가 정렬', () => {
  const NODATA = '이 데이터에는 환율·유가가 없어요';
  const withBeta = (key: 'usdkrw' | 'wti', min: number, max: number, on = true) => {
    const c = base();
    c.conditions.macro[key].beta = { on, min, max };
    return c;
  };

  it('min이 max보다 크면 계열별 문구로 막는다', () => {
    expect(criteriaIssues(withBeta('usdkrw', 3, 1), [])).toEqual([
      { section: 'conditions', text: '원/달러 민감도 범위의 최소가 최대보다 커요', blocking: true },
    ]);
    expect(criteriaIssues(withBeta('wti', 3, 1), [])).toEqual([
      { section: 'conditions', text: '유가 민감도 범위의 최소가 최대보다 커요', blocking: true },
    ]);
  });

  it('min과 max가 같으면 통과하고, beta가 꺼져 있으면 보지 않는다', () => {
    expect(criteriaIssues(withBeta('usdkrw', 1, 1), [])).toEqual([]);
    expect(criteriaIssues(withBeta('usdkrw', 3, 1, false), [])).toEqual([]);
  });

  it('데이터에 macro가 없는데 macroBeta 정렬이면 rank 구역에서 막는다', () => {
    const c = base();
    c.rank.by = 'macroBeta';
    expect(criteriaIssues(c, [], { hasMacro: false, hasFlow: true, hasFin: true })).toEqual([{ section: 'rank', text: NODATA, blocking: true }]);
  });

  it('macro가 있거나 dataInfo를 생략하면 macroBeta 정렬도 통과한다', () => {
    const c = base();
    c.rank.by = 'macroBeta';
    expect(criteriaIssues(c, [], { hasMacro: true, hasFlow: true, hasFin: true })).toEqual([]);
    expect(criteriaIssues(c, [])).toEqual([]);
  });

  it('macro 조건도 켜고 macroBeta 정렬이면 같은 문구는 한 번만, 첫 이슈(conditions)를 남긴다', () => {
    const c = base();
    c.conditions.macro.wti.trend.on = true;
    c.rank.by = 'macroBeta';
    const out = criteriaIssues(c, [], { hasMacro: false, hasFlow: true, hasFin: true });
    expect(out.filter((i) => i.text === NODATA)).toEqual([{ section: 'conditions', text: NODATA, blocking: true }]);
    expect(out).toHaveLength(1);
  });
});

describe('수급 조건: sanitize', () => {
  it('flow·rank.flow가 없는 기존 프로필은 기본값으로 채우고 repaired false', () => {
    const r = run((c) => {
      delete c.conditions.flow;
      delete c.rank.flow;
    });
    expect(r.repaired).toBe(false);
    expect(r.criteria[0].conditions.flow).toEqual(base().conditions.flow);
    expect(r.criteria[0].rank.flow).toEqual({ who: 'foreign', days: 20 });
  });

  it('범위 안의 값은 그대로 둔다(경계 포함)', () => {
    const r = run((c) => {
      c.conditions.flow.amount = { on: true, who: 'both', days: 120, minPct: -100, maxPct: 100 };
      c.conditions.flow.streak = { on: true, who: 'indiv', minDays: 60 };
      c.rank.flow = { who: 'inst', days: 5 };
    });
    expect(r.repaired).toBe(false);
    expect(r.criteria[0].conditions.flow.amount).toEqual({ on: true, who: 'both', days: 120, minPct: -100, maxPct: 100 });
    expect(r.criteria[0].rank.flow).toEqual({ who: 'inst', days: 5 });
  });

  it.each([4, 121, 2.5, '20'])('flow.amount.days: %s는 기본값 20으로 고친다', (v) => {
    const r = run((c) => (c.conditions.flow.amount.days = v));
    expect(r.criteria[0].conditions.flow.amount.days).toBe(20);
    expect(r.repaired).toBe(true);
  });

  it.each([-101, 101, NaN])('flow.amount.minPct·maxPct: %s는 기본값으로 고친다', (v) => {
    const a = run((c) => (c.conditions.flow.amount.minPct = v));
    expect(a.criteria[0].conditions.flow.amount.minPct).toBe(1);
    expect(a.repaired).toBe(true);
    const b = run((c) => (c.conditions.flow.amount.maxPct = v));
    expect(b.criteria[0].conditions.flow.amount.maxPct).toBe(100);
    expect(b.repaired).toBe(true);
  });

  it.each([0, 61, 1.5])('flow.streak.minDays: %s는 기본값 5로 고친다', (v) => {
    const r = run((c) => (c.conditions.flow.streak.minDays = v));
    expect(r.criteria[0].conditions.flow.streak.minDays).toBe(5);
    expect(r.repaired).toBe(true);
  });

  it('rank.flow.days 범위 밖과 잘못된 who를 고친다', () => {
    const r = run((c) => (c.rank.flow = { who: 'x', days: 200 }));
    expect(r.criteria[0].rank.flow).toEqual({ who: 'foreign', days: 20 });
    expect(r.repaired).toBe(true);
    const a = run((c) => (c.conditions.flow.amount.who = 'bank'));
    expect(a.criteria[0].conditions.flow.amount.who).toBe('foreign');
    expect(a.repaired).toBe(true);
    const s = run((c) => (c.conditions.flow.streak.who = 1));
    expect(s.criteria[0].conditions.flow.streak.who).toBe('inst');
    expect(s.repaired).toBe(true);
  });

  it('최소가 최대보다 큰 수급 범위는 고치지 않는다(criteriaIssues가 막는다)', () => {
    const r = run((c) => {
      c.conditions.flow.amount.minPct = 10;
      c.conditions.flow.amount.maxPct = 5;
    });
    expect(r.repaired).toBe(false);
    expect(r.criteria[0].conditions.flow.amount).toMatchObject({ minPct: 10, maxPct: 5 });
  });

  it("rank.by 'flow'는 유효한 값이다", () => {
    const r = run((c) => (c.rank.by = 'flow'));
    expect(r.criteria[0].rank.by).toBe('flow');
    expect(r.repaired).toBe(false);
  });
});

describe('수급 조건: flowOn·usesFlow·criteriaIssues', () => {
  const NOFLOW = '이 데이터에는 투자자 매매동향이 없어요';
  const withAmount = (patch: Partial<SelectionCriteria['conditions']['flow']['amount']> = {}) => {
    const c = base();
    c.conditions.flow.amount = { ...c.conditions.flow.amount, on: true, ...patch };
    return c;
  };

  it('flowOn·usesFlow', () => {
    const c = base();
    expect([flowOn(c), usesFlow(c)]).toEqual([false, false]);
    c.rank.by = 'flow';
    expect([flowOn(c), usesFlow(c)]).toEqual([false, true]);
    const a = withAmount();
    expect([flowOn(a), usesFlow(a)]).toEqual([true, true]);
    const s = base();
    s.conditions.flow.streak.on = true;
    expect(flowOn(s)).toBe(true);
  });

  it('순매수 비율의 최소가 최대보다 크면 막고, 같으면 통과하고, 꺼져 있으면 보지 않는다', () => {
    expect(criteriaIssues(withAmount({ minPct: 10, maxPct: 5 }), [])).toEqual([
      { section: 'conditions', text: '순매수 비율의 최소가 최대보다 커요', blocking: true },
    ]);
    expect(criteriaIssues(withAmount({ minPct: 5, maxPct: 5 }), [])).toEqual([]);
    expect(criteriaIssues(withAmount({ on: false, minPct: 10, maxPct: 5 }), [])).toEqual([]);
  });

  it('수급 없는 데이터에서 수급 조건을 켜면 conditions 구역에서 막는다', () => {
    expect(criteriaIssues(withAmount(), [], { hasMacro: true, hasFlow: false, hasFin: true })).toEqual([
      { section: 'conditions', text: NOFLOW, blocking: true },
    ]);
  });

  it('수급 순 정렬만 골라도 rank 구역에서 막는다', () => {
    const c = base();
    c.rank.by = 'flow';
    expect(criteriaIssues(c, [], { hasMacro: true, hasFlow: false, hasFin: true })).toEqual([{ section: 'rank', text: NOFLOW, blocking: true }]);
  });

  it('조건과 정렬을 모두 쓰면 같은 문구는 한 번만(conditions)', () => {
    const c = withAmount();
    c.rank.by = 'flow';
    const out = criteriaIssues(c, [], { hasMacro: true, hasFlow: false, hasFin: true });
    expect(out).toEqual([{ section: 'conditions', text: NOFLOW, blocking: true }]);
  });

  it('수급이 있는 데이터거나 dataInfo를 생략하면 경고가 없다', () => {
    const c = withAmount();
    c.rank.by = 'flow';
    expect(criteriaIssues(c, [], { hasMacro: true, hasFlow: true, hasFin: true })).toEqual([]);
    expect(criteriaIssues(c, [])).toEqual([]);
  });

  it('수급 조건만 켠 기준에는 조건 없음 경고를 내지 않는다', () => {
    const c = withAmount();
    c.conditions.tradingValue.on = false;
    c.conditions.rebound.on = false;
    expect(criteriaIssues(c, [], { hasMacro: true, hasFlow: true, hasFin: true })).toEqual([]);
  });
});

describe('재무 조건: sanitize', () => {
  const FIN_DEFAULT = {
    per: { on: false, min: 0, max: 15 },
    pbr: { on: false, min: 0, max: 1.5 },
    roe: { on: false, min: 10 },
    opMargin: { on: false, min: 5 },
    revGrowth: { on: false, min: 10 },
    opGrowth: { on: false, min: 20 },
    debtRatio: { on: false, max: 100 },
    profitable: { on: false },
  };

  it('기본값 표', () => {
    expect(base().conditions.fin).toEqual(FIN_DEFAULT);
    expect(base().rank.fin).toEqual({ metric: 'per' });
  });

  it('fin·rank.fin이 없는 기존 프로필은 조용히 기본값으로 채운다', () => {
    const r = run((c) => {
      delete c.conditions.fin;
      delete c.rank.fin;
    });
    expect(r.repaired).toBe(false);
    expect(r.criteria[0].conditions.fin).toEqual(FIN_DEFAULT);
    expect(r.criteria[0].rank.fin).toEqual({ metric: 'per' });
  });

  it('범위 경계 값은 그대로 둔다', () => {
    const fin = {
      per: { on: true, min: 0, max: 1000 },
      pbr: { on: true, min: 0, max: 100 },
      roe: { on: true, min: -100 },
      opMargin: { on: true, min: 100 },
      revGrowth: { on: true, min: 1000 },
      opGrowth: { on: true, min: -100 },
      debtRatio: { on: true, max: 10000 },
      profitable: { on: true },
    };
    const r = run((c) => {
      c.conditions.fin = fin;
      c.rank.by = 'fin';
      c.rank.fin = { metric: 'opGrowth' };
    });
    expect(r.repaired).toBe(false);
    expect(r.criteria[0].conditions.fin).toEqual(fin);
    expect(r.criteria[0].rank).toMatchObject({ by: 'fin', fin: { metric: 'opGrowth' } });
  });

  it.each([
    ['per', 'min', -1, 0],
    ['per', 'max', 1001, 15],
    ['pbr', 'min', -0.1, 0],
    ['pbr', 'max', 101, 1.5],
    ['roe', 'min', -101, 10],
    ['roe', 'min', 101, 10],
    ['opMargin', 'min', 101, 5],
    ['opMargin', 'min', -101, 5],
    ['revGrowth', 'min', 1001, 10],
    ['revGrowth', 'min', -101, 10],
    ['opGrowth', 'min', 1001, 20],
    ['opGrowth', 'min', -101, 20],
    ['debtRatio', 'max', 10001, 100],
    ['debtRatio', 'max', -1, 100],
    ['roe', 'min', NaN, 10],
    ['roe', 'min', '10', 10],
  ])('fin.%s.%s: %s는 기본값 %s로 고친다', (key, field, v, def) => {
    const r = run((c) => (c.conditions.fin[key][field] = v));
    expect(r.criteria[0].conditions.fin[key as 'roe'][field as 'min']).toBe(def);
    expect(r.repaired).toBe(true);
  });

  it('on이 불리언이 아니면 고친다', () => {
    const r = run((c) => (c.conditions.fin.profitable.on = 'yes'));
    expect(r.criteria[0].conditions.fin.profitable.on).toBe(false);
    expect(r.repaired).toBe(true);
  });

  it('소수 값(1.5)은 그대로 둔다', () => {
    const r = run((c) => (c.conditions.fin.pbr.max = 2.75));
    expect(r.criteria[0].conditions.fin.pbr.max).toBe(2.75);
    expect(r.repaired).toBe(false);
  });

  it('rank.fin.metric이 잘못되면 per로 고친다', () => {
    const r = run((c) => (c.rank.fin = { metric: 'eps' }));
    expect(r.criteria[0].rank.fin).toEqual({ metric: 'per' });
    expect(r.repaired).toBe(true);
  });

  it("rank.by 'fin'은 유효한 값이다", () => {
    const r = run((c) => (c.rank.by = 'fin'));
    expect(r.criteria[0].rank.by).toBe('fin');
    expect(r.repaired).toBe(false);
  });

  it('뒤집힌 PER·PBR 범위는 고치지 않는다(criteriaIssues가 막는다)', () => {
    const r = run((c) => {
      c.conditions.fin.per = { on: true, min: 20, max: 5 };
      c.conditions.fin.pbr = { on: true, min: 3, max: 1 };
    });
    expect(r.repaired).toBe(false);
    expect(r.criteria[0].conditions.fin.per).toEqual({ on: true, min: 20, max: 5 });
    expect(r.criteria[0].conditions.fin.pbr).toEqual({ on: true, min: 3, max: 1 });
  });
});

describe('재무 조건: finOn·usesFin·criteriaIssues', () => {
  const NOFIN = '이 데이터에는 재무 정보가 없어요';
  const info = (hasFin: boolean) => ({ hasMacro: true, hasFlow: true, hasFin });
  const withPer = (patch: Partial<SelectionCriteria['conditions']['fin']['per']> = {}) => {
    const c = base();
    c.conditions.fin.per = { ...c.conditions.fin.per, on: true, ...patch };
    return c;
  };

  it('finOn·usesFin', () => {
    const c = base();
    expect([finOn(c), usesFin(c)]).toEqual([false, false]);
    c.rank.by = 'fin';
    expect([finOn(c), usesFin(c)]).toEqual([false, true]);
    const a = withPer();
    expect([finOn(a), usesFin(a)]).toEqual([true, true]);
    const p = base();
    p.conditions.fin.profitable.on = true;
    expect(finOn(p)).toBe(true);
    const d = base();
    d.conditions.fin.debtRatio.on = true;
    expect(finOn(d)).toBe(true);
  });

  it('PER 범위의 최소가 최대보다 크면 conditions에서 막고, 같으면 통과하고, 꺼져 있으면 보지 않는다', () => {
    expect(criteriaIssues(withPer({ min: 20, max: 5 }), [], info(true))).toEqual([
      { section: 'conditions', text: 'PER 범위의 최소가 최대보다 커요', blocking: true },
    ]);
    expect(criteriaIssues(withPer({ min: 5, max: 5 }), [], info(true))).toEqual([]);
    expect(criteriaIssues(withPer({ on: false, min: 20, max: 5 }), [], info(true))).toEqual([]);
  });

  it('PBR 범위의 최소가 최대보다 크면 막는다', () => {
    const c = base();
    c.conditions.fin.pbr = { on: true, min: 3, max: 1 };
    expect(criteriaIssues(c, [], info(true))).toEqual([
      { section: 'conditions', text: 'PBR 범위의 최소가 최대보다 커요', blocking: true },
    ]);
  });

  it('재무 없는 데이터에서 재무 조건을 켜면 conditions 구역에서 막는다', () => {
    expect(criteriaIssues(withPer(), [], info(false))).toEqual([{ section: 'conditions', text: NOFIN, blocking: true }]);
    const p = base();
    p.conditions.fin.profitable.on = true;
    expect(criteriaIssues(p, [], info(false))).toEqual([{ section: 'conditions', text: NOFIN, blocking: true }]);
  });

  it('재무 순 정렬만 골라도 rank 구역에서 막는다', () => {
    const c = base();
    c.rank.by = 'fin';
    expect(criteriaIssues(c, [], info(false))).toEqual([{ section: 'rank', text: NOFIN, blocking: true }]);
  });

  it('조건과 정렬을 모두 쓰면 같은 문구는 한 번만(conditions)', () => {
    const c = withPer();
    c.rank.by = 'fin';
    expect(criteriaIssues(c, [], info(false))).toEqual([{ section: 'conditions', text: NOFIN, blocking: true }]);
  });

  it('재무가 있는 데이터거나 dataInfo를 생략하면 재무 경고가 없다', () => {
    const c = withPer();
    c.rank.by = 'fin';
    expect(criteriaIssues(c, [], info(true))).toEqual([]);
    expect(criteriaIssues(c, [])).toEqual([]);
  });

  it('재무 조건만 켠 기준에는 조건 없음 경고를 내지 않는다', () => {
    const c = base();
    c.conditions.tradingValue.on = false;
    c.conditions.rebound.on = false;
    expect(criteriaIssues(c, [], info(true)).map((i) => i.text)).toEqual(['조건이 없으면 후보 범위의 모든 종목에서 정렬 순으로 골라요']);
    c.conditions.fin.profitable.on = true;
    expect(criteriaIssues(c, [], info(true))).toEqual([]);
  });
});
