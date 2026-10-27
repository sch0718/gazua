import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { FinSeries, MarketDataFile, MarketDataFileV2, MarketDataFileV3, MarketDataFileV4 } from '../marketData/format';
import { newStrategy } from '../sim/defaults';
import { precompute, rebalanceDates, tradingAxis } from './precompute';
import { addDays } from '../time/kst';
import type { Basket } from './baskets';
import { macroKnownFrom } from './macro';
import { finMissingAt, flowMissingAt, PrecomputeMismatchError, selectAt } from './select';
import {
  betaOn,
  cutFin,
  DATES,
  FIN_BASE,
  finStock as mkFinStock,
  lcg,
  mkFile,
  mkFileV2,
  mkFileV3,
  mkFileV4,
  mkStock,
  NOW,
  obsBefore,
  offCriteria,
  offCriteriaLike,
  olsSlope,
  reboundAt,
  reboundEntry,
  sampleStdPct,
  symbols,
  usWeekdays,
  withFin,
  withFlow,
  ymd,
  type FinPatch,
  type FinStock,
  type FlowStock,
  type Stock,
} from './testData';
import type { FinMetric, FlowWho, MacroSeriesKey, RankBy, SelectionCriteria } from './types';

// 기본 데이터: 30거래일, 재선정일 d = DATES[25], 전 거래일 p = 24번 봉
const N = 30;
const D = DATES[25];
const P = 24;
const flat = (v = 100, n = N): number[] => Array(n).fill(v);
const withAt = (arr: number[], at: Record<number, number>): number[] => arr.map((v, i) => at[i] ?? v);
const nulls = (arr: (number | null)[], before: number): (number | null)[] => arr.map((v, i) => (i < before ? null : v));

const run = (stocks: Stock[], c: SelectionCriteria, opts: { n?: number; d?: string; entry?: ReturnType<typeof reboundEntry> | null } = {}) =>
  selectAt(opts.d ?? D, precompute(mkFile(stocks, opts.n ?? N), c, opts.entry ?? null), c);

describe('selectAt: 조건 계산(전 거래일 p까지)', () => {
  it('시가총액 = c[p] × shares', () => {
    const c = offCriteria();
    c.conditions.marketCap = { on: true, minEok: 10 };
    const r = run([mkStock('A', flat(100), { shares: 2e7 }), mkStock('B', flat(100), { shares: 5e6 })], c);
    expect(r).toEqual({ date: D, passed: 1, picked: [{ symbol: 'A', values: { marketCap: 2e9 } }] });
  });

  it('거래대금 = p까지 최근 days개 tv 평균, 봉이 모자라면 탈락', () => {
    const c = offCriteria();
    c.conditions.tradingValue = { on: true, days: 3, minEok: 20 };
    const tvA = withAt(flat(0), { 22: 1e9, 23: 2e9, 24: 3e9 });
    const tvB = withAt(flat(0), { 22: 1e9, 23: 2e9, 24: 2.97e9 });
    const r = run(
      [
        mkStock('A', flat(), { tv: tvA }),
        mkStock('B', flat(), { tv: tvB }),
        mkStock('C', nulls(flat(), 23), { tv: flat(9e9) }),
      ],
      c,
    );
    expect(r.passed).toBe(1);
    expect(r.picked).toEqual([{ symbol: 'A', values: { tradingValue: 2e9, marketCap: 100 } }]);
  });

  it('수익률 = c[p] / c[p − days] − 1, 봉이 모자라면 탈락', () => {
    const c = offCriteria();
    c.conditions.returnRange = { on: true, days: 5, minPct: -30, maxPct: 0 };
    const r = run(
      [
        mkStock('A', withAt(flat(), { 24: 90 })),
        mkStock('B', withAt(flat(), { 24: 110 })),
        mkStock('C', nulls(withAt(flat(), { 24: 90 }), 20)),
      ],
      c,
    );
    expect(symbols(r)).toEqual(['A']);
    expect(r.picked[0].values.return).toBeCloseTo(-10, 10);
  });

  it('이동평균: c[p]와 p까지 period일 단순이동평균 비교', () => {
    const c = offCriteria();
    c.conditions.vsMa = { on: true, period: 3, side: 'above' };
    const stocks = [mkStock('A', withAt(flat(10), { 22: 10, 23: 20, 24: 30 })), mkStock('B', withAt(flat(10), { 22: 30, 23: 20, 24: 10 }))];
    const above = run(stocks, c);
    expect(symbols(above)).toEqual(['A']);
    expect(above.picked[0].values.ma).toBe(20);
    c.conditions.vsMa.side = 'below';
    expect(symbols(run(stocks, c))).toEqual(['B']);
    c.conditions.vsMa.period = 26; // p까지 봉 25개
    expect(run(stocks, c).passed).toBe(0);
  });

  it('52주 고점 대비 = 1 − c[p] / max(c[p−249..p]); 120개 미만 탈락, 120~249개는 있는 만큼', () => {
    const n = 261; // p = 259
    const p = 259;
    const c = offCriteria();
    c.conditions.fromHigh = { on: true, minPct: 0, maxPct: 100 };
    const x = withAt(flat(100, n), { [p - 250]: 300, [p - 249]: 200, [p]: 150 }); // 창 안 고점 200
    const y = nulls(withAt(flat(100, n), { [p - 118]: 200 }), p - 118); // 119개
    const z = nulls(withAt(flat(100, n), { [p - 119]: 200 }), p - 119); // 120개
    const r = run([mkStock('X', x), mkStock('Y', y), mkStock('Z', z)], c, { n, d: DATES[p + 1] });
    expect(symbols(r)).toEqual(['X', 'Z']);
    expect(r.picked[0].values.fromHigh).toBeCloseTo(25, 10);
    expect(r.picked[1].values.fromHigh).toBeCloseTo(50, 10);

    c.conditions.fromHigh = { on: true, minPct: 20, maxPct: 30 };
    expect(symbols(run([mkStock('X', x), mkStock('Z', z)], c, { n, d: DATES[p + 1] }))).toEqual(['X']);
  });

  it('변동성 = p까지 days개 일간 수익률의 표본 표준편차, 봉이 모자라면 탈락', () => {
    const c = offCriteria();
    c.conditions.volatility = { on: true, days: 2, maxPct: 15 };
    const stocks = [
      mkStock('A', withAt(flat(), { 22: 100, 23: 110, 24: 99 })),
      mkStock('B', flat(90)),
      mkStock('C', nulls(flat(), 23)),
    ];
    const r = run(stocks, c);
    expect(symbols(r)).toEqual(['A', 'B']); // 시가총액 99 > 90
    expect(r.picked[0].values.volatility).toBeCloseTo(Math.sqrt(0.02) * 100, 10);
    expect(r.picked[1].values.volatility).toBe(0);
    c.conditions.volatility.maxPct = 14;
    expect(symbols(run(stocks, c))).toEqual(['B']);
  });

  it('반등 신호: 신호일이 [p − withinDays + 1, p] 안이면 통과, d의 신호는 쓰지 않는다', () => {
    const c = offCriteria();
    c.conditions.rebound = { on: true, withinDays: 3, pattern: { from: 'custom', entry: reboundEntry() } };
    const stocks = [21, 22, 24, 25].map((k) => mkStock(`R${k}`, reboundAt(k, N)));
    const r = run(stocks, c, { entry: reboundEntry() });
    expect(symbols(r)).toEqual(['R24', 'R22']); // 시가총액 90 > 70
    expect(r.picked.map((x) => x.values.rebound)).toEqual([true, true]);
  });
});

describe('selectAt: 봉 유무', () => {
  it('p에 봉이 없는 종목은 조건이 모두 꺼져 있어도 탈락한다', () => {
    const c = offCriteria();
    const r = run(
      [
        mkStock('A', withAt(flat(), {}).map((v, i) => (i === P ? null : v))), // 거래정지: 23번 봉 뒤 d에 재개
        mkStock('B', flat()),
        mkStock('C', nulls(flat(), 25)), // d에 상장
      ],
      c,
    );
    expect(symbols(r)).toEqual(['B']);
    expect(r.passed).toBe(1);
  });

  it('p에 봉이 있고 d부터 거래정지인 종목은 고를 수 있다(d의 상태를 보지 않는다)', () => {
    const c = offCriteria();
    c.conditions.marketCap = { on: true, minEok: 0 };
    const r = run([mkStock('A', flat().map((v, i) => (i >= 25 ? null : v)), { shares: 2 }), mkStock('B', flat())], c);
    expect(symbols(r)).toEqual(['A', 'B']);
    expect(r.picked[0].values.marketCap).toBe(200);
  });
});

describe('selectAt: 미리 계산과 다른 기준', () => {
  const stocks = () => [mkStock('A', withAt(flat(10), { 22: 10, 23: 20, 24: 30 }))];
  const pre = (patch: (c: SelectionCriteria) => void = () => {}, entry: ReturnType<typeof reboundEntry> | null = null) => {
    const c = offCriteria();
    patch(c);
    return precompute(mkFile(stocks(), N), c, entry);
  };
  const sel = (p: ReturnType<typeof pre>, patch: (c: SelectionCriteria) => void) => {
    const c = offCriteria();
    patch(c);
    return () => selectAt(D, p, c);
  };

  it('이동평균: 꺼진 채 계산했는데 켜거나, 기간이 다르면 거부한다', () => {
    const on3 = (c: SelectionCriteria) => (c.conditions.vsMa = { on: true, period: 3, side: 'above' });
    expect(sel(pre(), on3)).toThrow(PrecomputeMismatchError);
    expect(sel(pre(on3), (c) => (c.conditions.vsMa = { on: true, period: 5, side: 'above' }))).toThrow(PrecomputeMismatchError);
    expect(symbols(sel(pre(on3), on3)())).toEqual(['A']);
    expect(sel(pre(on3), () => {})).not.toThrow(); // 켜서 계산하고 꺼서 고르는 것은 괜찮다
  });

  it('거래대금 일수가 다르면 조건·정렬에서 쓸 때 거부한다', () => {
    const p = pre((c) => (c.conditions.tradingValue.days = 5));
    expect(sel(p, (c) => (c.conditions.tradingValue = { on: true, days: 20, minEok: 0 }))).toThrow(PrecomputeMismatchError);
    expect(sel(p, (c) => (c.rank.by = 'tradingValue'))).toThrow(PrecomputeMismatchError);
    expect(sel(p, (c) => (c.conditions.tradingValue = { on: true, days: 5, minEok: 0 }))).not.toThrow();
  });

  it('변동성 일수(꺼져 있으면 20)가 다르면 조건·정렬에서 쓸 때 거부한다', () => {
    const p = pre(); // 20일
    expect(sel(p, (c) => (c.conditions.volatility = { on: true, days: 10, maxPct: 100 }))).toThrow(PrecomputeMismatchError);
    expect(sel(p, (c) => (c.conditions.volatility = { on: true, days: 20, maxPct: 100 }))).not.toThrow();
    expect(sel(p, (c) => (c.rank.by = 'lowVolatility'))).not.toThrow();
    const p10 = pre((c) => (c.conditions.volatility = { on: true, days: 10, maxPct: 100 }));
    expect(sel(p10, (c) => (c.rank.by = 'lowVolatility'))).toThrow(PrecomputeMismatchError);
  });

  it('반등: 패턴 없이 계산했거나 다른 패턴이면 거부한다', () => {
    const custom = (e: ReturnType<typeof reboundEntry>) => (c: SelectionCriteria) =>
      (c.conditions.rebound = { on: true, withinDays: 3, pattern: { from: 'custom', entry: e } });
    expect(sel(pre(), custom(reboundEntry()))).toThrow(PrecomputeMismatchError);
    const other = reboundEntry();
    other.triggers.reboundDays.value = 3;
    expect(sel(pre(() => {}, reboundEntry()), custom(other))).toThrow(PrecomputeMismatchError);
    expect(sel(pre(() => {}, reboundEntry()), custom(reboundEntry()))).not.toThrow();
  });

  it('poolOverride는 미리 계산과 무관하다', () => {
    const c = offCriteria();
    c.conditions.vsMa = { on: true, period: 3, side: 'above' };
    const p = precompute(mkFile(stocks(), N), c, null);
    expect(symbols(selectAt(D, p, c, { markets: ['KOSPI'], types: ['STOCK'] }))).toEqual(['A']);
    expect(symbols(selectAt(D, p, c, { markets: ['KOSDAQ'], types: ['ETF'] }))).toEqual([]);
  });
});

describe('selectAt: 대장주(후보 범위·조건 적용 전 전체 종목 기준)', () => {
  // 시가총액 = 100 × shares
  const leaders = (): Stock[] => [
    mkStock('A', flat(), { sec: ['00013', '00027', ''], shares: 3 }),
    mkStock('B', flat(), { sec: ['00013', '00028', ''], shares: 2 }),
    mkStock('C', flat(), { sec: ['00013', '00027', ''], shares: 1 }),
    mkStock('D', flat(), { sec: ['00016', '00029', ''], shares: 0.5 }),
    mkStock('E', flat(), { sec: ['', '', ''], shares: 10 }), // 업종 코드 없음
  ];

  it('업종 레벨 1·2', () => {
    const c = offCriteria();
    c.conditions.leader = { on: true, level: 1, maxRank: 1 };
    const r1 = run(leaders(), c);
    expect(symbols(r1)).toEqual(['A', 'D']);
    expect(r1.picked.map((x) => x.values.leaderRank)).toEqual([1, 1]);

    c.conditions.leader = { on: true, level: 1, maxRank: 2 };
    expect(symbols(run(leaders(), c))).toEqual(['A', 'B', 'D']);

    c.conditions.leader = { on: true, level: 2, maxRank: 1 };
    expect(symbols(run(leaders(), c))).toEqual(['A', 'B', 'D']);
    c.conditions.leader = { on: true, level: 2, maxRank: 2 };
    expect(symbols(run(leaders(), c))).toEqual(['A', 'B', 'C', 'D']);
  });

  it('업종 코드가 없으면 통과하지 않는다', () => {
    const c = offCriteria();
    c.conditions.leader = { on: true, level: 1, maxRank: 100 };
    expect(symbols(run(leaders(), c))).not.toContain('E');
  });

  it('후보 범위 밖·다른 조건 탈락 종목도 순위에 들어가고, p에 봉이 없는 종목은 빠진다', () => {
    const c = offCriteria();
    c.conditions.leader = { on: true, level: 1, maxRank: 2 };
    c.conditions.marketCap = { on: true, minEok: 0.000002 }; // 200원 이상
    const stocks = [
      ...leaders(),
      mkStock('M', flat(), { sec: ['00013', '', ''], shares: 4, managed: true }), // 1위, 후보 범위 밖
      mkStock('G', flat().map((v, i) => (i === P ? null : v)), { sec: ['00013', '', ''], shares: 9 }), // p에 봉 없음
    ];
    const r = run(stocks, c);
    expect(symbols(r)).toEqual(['A']); // A 2위(통과), B 3위, C 4위·시가총액 미달, D 1위·시가총액 미달
    expect(r.picked[0].values.leaderRank).toBe(2);
  });

  it('시가총액이 같으면 종목코드 오름차순으로 순위를 매긴다', () => {
    const c = offCriteria();
    c.conditions.leader = { on: true, level: 1, maxRank: 1 };
    const r = run([mkStock('300001', flat(), { shares: 5 }), mkStock('300000', flat(), { shares: 5 })], c);
    expect(symbols(r)).toEqual(['300000']);
  });
});

describe('selectAt: 정렬·상위 N', () => {
  // 70거래일, d = DATES[69], p = 68. 코드 오름차순은 W, X, Y, Z와 반대가 되게 붙인다.
  const n = 70;
  const d = DATES[69];
  const alt = (a: number, b: number) => Array.from({ length: n }, (_, i) => (i >= 48 ? (i % 2 === 0 ? a : b) : a));
  const sorted = (): Stock[] => [
    mkStock('000004', withAt(flat(100, n), { 8: 50 }), { shares: 1, tv: flat(4e9, n) }), // W: 60일 +100%, 변동성 0
    mkStock('000003', flat(100, n), { shares: 4, tv: flat(1e9, n) }), // X: 0%, 변동성 0
    mkStock('000002', alt(100, 110), { shares: 3, tv: flat(3e9, n) }), // Y: 0%, 변동성 큼
    mkStock('000001', withAt(alt(100, 101), { 8: 200 }), { shares: 2, tv: flat(2e9, n) }), // Z: −50%, 변동성 작음
  ];
  const by = (rankBy: RankBy, patch: (c: SelectionCriteria) => void = () => {}) => {
    const c = offCriteria();
    c.rank.by = rankBy;
    patch(c);
    return run(sorted(), c, { n, d });
  };

  it('시가총액 내림차순', () => {
    const r = by('marketCap');
    expect(symbols(r)).toEqual(['000003', '000002', '000001', '000004']);
    expect(r.picked[0].values).toEqual({ marketCap: 400 });
  });

  it('거래대금 내림차순(tradingValue.days)', () => {
    const r = by('tradingValue');
    expect(symbols(r)).toEqual(['000004', '000002', '000001', '000003']);
    expect(r.picked[0].values).toEqual({ tradingValue: 4e9 });
  });

  it('수익률 내림차순: 조건이 꺼져 있으면 60일, 켜져 있으면 returnRange.days. 동률은 코드순', () => {
    const r = by('return');
    expect(symbols(r)).toEqual(['000004', '000002', '000003', '000001']);
    expect(r.picked[0].values.return).toBeCloseTo(100, 10);
    const on = by('return', (c) => (c.conditions.returnRange = { on: true, days: 10, minPct: -100, maxPct: 1000 }));
    expect(symbols(on)).toEqual(['000001', '000002', '000003', '000004']); // 10일은 모두 0%
  });

  it('낮은 변동성 오름차순: 꺼져 있으면 20일, 켜져 있으면 volatility.days', () => {
    const r = by('lowVolatility');
    expect(symbols(r)).toEqual(['000003', '000004', '000001', '000002']);
    const z = Array.from({ length: 21 }, (_, k) => ((48 + k) % 2 === 0 ? 100 : 101));
    expect(r.picked[2].values.volatility).toBeCloseTo(sampleStdPct(z), 10);
    const on = by('lowVolatility', (c) => (c.conditions.volatility = { on: true, days: 30, maxPct: 100 }));
    const z30 = Array.from({ length: 31 }, (_, k) => (38 + k >= 48 && (38 + k) % 2 === 1 ? 101 : 100));
    expect(on.picked[2].values.volatility).toBeCloseTo(sampleStdPct(z30), 10);
  });

  it('동률은 종목코드 오름차순', () => {
    const stocks = sorted().map((s) => ({ ...s, shares: 1 }));
    const c = offCriteria();
    expect(symbols(selectAt(d, precompute(mkFile(stocks, n), c, null), c))).toEqual(['000001', '000002', '000003', '000004']);
  });

  it('상위 take개만 고르고 passed는 통과 수 전체', () => {
    const r = by('marketCap', (c) => (c.rank.take = 2));
    expect(r.passed).toBe(4);
    expect(symbols(r)).toEqual(['000003', '000002']);
  });

  it('통과 0개', () => {
    const r = by('marketCap', (c) => (c.conditions.marketCap = { on: true, minEok: 1 }));
    expect(r).toEqual({ date: d, passed: 0, picked: [] });
  });
});

describe('selectAt: 후보 범위', () => {
  const pool = (): Stock[] => [
    mkStock('K', flat(), { m: 'KOSPI', t: 'STOCK', shares: 5 }),
    mkStock('Q', flat(), { m: 'KOSDAQ', t: 'STOCK', shares: 4 }),
    mkStock('E', flat(), { m: 'KOSPI', t: 'ETF', sec: ['', '', ''], shares: 3 }),
    mkStock('N', flat(), { m: 'KOSPI', t: 'ETN', sec: ['', '', ''], shares: 9 }),
    mkStock('R', flat(), { m: 'KOSPI', t: 'REIT', shares: 9 }),
    mkStock('M', flat(), { m: 'KOSPI', t: 'STOCK', managed: true, shares: 2 }),
    mkStock('H', flat(), { m: 'KOSPI', t: 'STOCK', halted: true, sec: ['00016', '00027', '00099'], shares: 1 }),
  ];

  it('시장·종류·관리종목 제외. ETN·REIT·OTHER는 고르지 않는다', () => {
    const c = offCriteria();
    c.pool.types = ['STOCK', 'ETF'];
    expect(symbols(run(pool(), c))).toEqual(['K', 'Q', 'E']);
    c.pool.excludeManaged = false;
    expect(symbols(run(pool(), c))).toEqual(['K', 'Q', 'E', 'M', 'H']);
  });

  it('업종: 대·중 코드 중 하나가 목록에 있으면 포함(소 코드는 보지 않음)', () => {
    const c = offCriteria();
    c.pool.excludeManaged = false;
    c.pool.sectors = ['00027'];
    expect(symbols(run(pool(), c))).toEqual(['H']);
    c.pool.sectors = ['00099'];
    expect(symbols(run(pool(), c))).toEqual([]);
    c.pool.sectors = ['00013', '00016'];
    expect(symbols(run(pool(), c))).toEqual(['K', 'Q', 'M', 'H']);
  });

  it('poolOverride로 시장·종류만 바꾼다', () => {
    const c = offCriteria();
    c.pool.markets = ['KOSPI'];
    const pre = precompute(mkFile(pool(), N), c, null);
    expect(symbols(selectAt(D, pre, c))).toEqual(['K']);
    expect(symbols(selectAt(D, pre, c, { markets: ['KOSDAQ'], types: ['STOCK'] }))).toEqual(['Q']);
    expect(symbols(selectAt(D, pre, c, { markets: ['KOSPI', 'KOSDAQ'], types: ['ETF'] }))).toEqual(['E']);
    expect(c.pool.markets).toEqual(['KOSPI']);
  });
});

describe('selectAt: 같은 이름의 업종은 시장을 넘어 하나(R10)', () => {
  // KOSPI 00013 전기·전자와 KOSDAQ 11028 전기·전자는 같은 업종이다
  const file = (stocks: Stock[]) => {
    const f = mkFile(stocks, N);
    f.sectors = [
      { code: '00013', name: '전기·전자', level: 1 },
      { code: '11028', name: '전기·전자', level: 1 },
      { code: '00016', name: '금융', level: 1 },
      { code: '00027', name: '전기·전자', level: 2 }, // 이름이 같아도 레벨이 다르면 다른 업종
    ];
    return f;
  };
  const both = (): Stock[] => [
    mkStock('K1', flat(), { m: 'KOSPI', sec: ['00013', '', ''], shares: 3 }),
    mkStock('Q1', flat(), { m: 'KOSDAQ', sec: ['11028', '', ''], shares: 5 }),
    mkStock('K2', flat(), { m: 'KOSPI', sec: ['00016', '', ''], shares: 4 }),
    mkStock('K3', flat(), { m: 'KOSPI', sec: ['00016', '00027', ''], shares: 1 }),
    mkStock('Q2', flat(), { m: 'KOSDAQ', sec: ['11028', '', ''], shares: 2 }),
  ];
  const runF = (c: SelectionCriteria) => selectAt(D, precompute(file(both()), c, null), c);

  it('어느 시장 코드를 골라도 두 시장의 같은 이름 업종 종목이 모두 후보다', () => {
    const c = offCriteria();
    c.pool.sectors = ['00013'];
    expect(symbols(runF(c))).toEqual(['Q1', 'K1', 'Q2']);
    c.pool.sectors = ['11028'];
    expect(symbols(runF(c))).toEqual(['Q1', 'K1', 'Q2']);
    // 레벨이 다른 같은 이름(중분류 전기·전자)은 따로다
    c.pool.sectors = ['00027'];
    expect(symbols(runF(c))).toEqual(['K3']);
  });

  it('대장주 순위는 같은 (레벨, 이름) 안에서 KOSPI·KOSDAQ을 합쳐 매긴다', () => {
    const c = offCriteria();
    c.conditions.leader = { on: true, level: 1, maxRank: 3 };
    const r = runF(c);
    const rank = Object.fromEntries(r.picked.map((x) => [x.symbol, x.values.leaderRank]));
    expect(rank).toEqual({ Q1: 1, K1: 2, Q2: 3, K2: 1, K3: 2 });
  });
});

describe('selectAt: 미래 정보 누설 방지', () => {
  /** d의 봉 값(o, h, l, c, v, tv)만 factor배로 바꾼다 */
  const mutateAt = (f: MarketDataFile, d: string, factor: number): MarketDataFile => {
    const g = structuredClone(f);
    const key = d.replaceAll('-', '');
    for (const s of g.stocks) {
      const i = s.d.indexOf(key);
      if (i < 0) continue;
      for (const k of ['o', 'h', 'l', 'c', 'v', 'tv'] as const) s[k][i] *= factor;
    }
    return g;
  };

  it('손으로 만든 데이터: d의 봉만 극단값으로 바꿔도 결과가 같다', () => {
    const c = offCriteria();
    c.conditions.marketCap = { on: true, minEok: 0.0000008 }; // 80원
    c.conditions.tradingValue = { on: true, days: 3, minEok: 10 };
    c.conditions.vsMa = { on: true, period: 3, side: 'above' };
    c.conditions.returnRange = { on: true, days: 5, minPct: -50, maxPct: 50 };
    c.conditions.volatility = { on: true, days: 3, maxPct: 50 };
    c.conditions.rebound = { on: true, withinDays: 5, pattern: { from: 'custom', entry: reboundEntry() } };
    const f = mkFile([22, 23, 24, 25].map((k) => mkStock(`R${k}`, reboundAt(k, N))), N);
    const entry = reboundEntry();
    const base = selectAt(D, precompute(f, c, entry), c);
    expect(base.passed).toBeGreaterThan(0);
    for (const factor of [1000, 0.001]) expect(selectAt(D, precompute(mutateAt(f, D, factor), c, entry), c)).toEqual(base);
  });

  const fixture = JSON.parse(gunzipSync(readFileSync('tests/fixtures/market-data-demo.json.gz')).toString()) as MarketDataFile;
  const dates = rebalanceDates(tradingAxis(fixture), { from: '2025-10-16', to: '2026-10-15' }, 'monthly');
  const variants: [string, (c: SelectionCriteria) => void][] = [
    ['marketCap', (c) => (c.conditions.marketCap = { on: true, minEok: 30000 })],
    ['tradingValue', (c) => (c.conditions.tradingValue = { on: true, days: 20, minEok: 250 })],
    ['leader', (c) => (c.conditions.leader = { on: true, level: 1, maxRank: 2 })],
    ['returnRange', (c) => (c.conditions.returnRange = { on: true, days: 20, minPct: -5, maxPct: 5 })],
    ['vsMa', (c) => (c.conditions.vsMa = { on: true, period: 20, side: 'above' })],
    ['fromHigh', (c) => (c.conditions.fromHigh = { on: true, minPct: 10, maxPct: 40 })],
    ['volatility', (c) => (c.conditions.volatility = { on: true, days: 20, maxPct: 2 })],
    ['rebound', (c) => (c.conditions.rebound = { on: true, withinDays: 10, pattern: { from: 'custom', entry: newStrategy(NOW, null).entry } })],
    ...(['marketCap', 'tradingValue', 'return', 'lowVolatility'] as const).map(
      (b): [string, (c: SelectionCriteria) => void] => [`rank ${b}`, (c) => ((c.rank.by = b), (c.rank.take = 5))],
    ),
  ];

  it.each(variants)('데모 데이터 %s: 재선정일마다 d의 봉만 바꿔도 결과가 같다', (name, patch) => {
    const c = offCriteria();
    c.pool.types = ['STOCK', 'ETF'];
    patch(c);
    const entry = c.conditions.rebound.on && c.conditions.rebound.pattern.from === 'custom' ? c.conditions.rebound.pattern.entry : null;
    const pre = precompute(fixture, c, entry);
    expect(dates.length).toBeGreaterThan(10);
    let passed = 0;
    let poolSize = 0;
    for (const d of dates) {
      const base = selectAt(d, pre, c);
      passed += base.passed;
      poolSize += selectAt(d, pre, offCriteriaLike(c)).passed;
      for (const factor of [1000, 0.001]) expect(selectAt(d, precompute(mutateAt(fixture, d, factor), c, entry), c)).toEqual(base);
    }
    // 조건이 실제로 일부만 걸러 냈는지(전부 통과·전부 탈락이면 검사가 무의미하다)
    expect(passed).toBeGreaterThan(0);
    if (!name.startsWith('rank')) expect(passed).toBeLessThan(poolSize);
  });
});

// ── 4단계: 환율·유가, 테마·내 묶음 ──

/** 봉마다 관측일 기준으로 짝지은 계열 값(스펙 2.3). 짝이 없으면 NaN */
const paired = (series: { d: string[]; v: number[] }, n = DATES.length): number[] =>
  DATES.slice(0, n).map((t) => {
    const k = obsBefore(series.d, ymd(t));
    return k < 0 ? NaN : series.v[k];
  });
/** 짝지은 계열 변화율의 m배로 움직이는 종가 */
const follow = (a: number[], m: number): number[] => {
  const c = [10000];
  // 0 이하이거나 짝이 없는 쌍에서는 움직이지 않는다
  for (let i = 1; i < a.length; i++) c.push(c[i - 1] * (1 + (a[i] > 0 && a[i - 1] > 0 ? m * (a[i] / a[i - 1] - 1) : 0)));
  return c;
};
/** obs 가운데 knownFrom ≤ p인 마지막 인덱스 */
const lastKnown = (key: MacroSeriesKey, obs: string[], p: string): number => {
  let k = -1;
  obs.forEach((o, i) => macroKnownFrom(key, o) <= p && (k = i));
  return k;
};

describe('selectAt: 환율 β는 관측일로 짝짓고 공개 시점으로 자른다(스펙 2.3·3.1)', () => {
  it('기간 맞추기(리뷰 재현): 한 주 +1%·다음 주 −1% 환율, 주가는 관측 기간 변화율의 2배 → β = +2.0', () => {
    const obs = usWeekdays('2024-11-01', 400);
    const monday0 = Date.UTC(2024, 9, 28);
    const v: number[] = [];
    obs.forEach((o, k) => {
      const week = Math.floor((Date.UTC(+o.slice(0, 4), +o.slice(4, 6) - 1, +o.slice(6, 8)) - monday0) / (7 * 86400000));
      v.push(k === 0 ? 1000 : v[k - 1] * (week % 2 === 0 ? 1.01 : 0.99));
    });
    const fx = { d: obs, v };
    const a = paired(fx);
    const close = follow(a, 2);
    const c = offCriteria();
    c.conditions.macro.betaDays = 120;
    betaOn(c, 'usdkrw');
    const j = 290;
    const r = selectAt(DATES[j], precompute(mkFileV2([mkStock('A', close)], 300, { usdkrw: fx }), c, null), c);
    expect(r.picked).toHaveLength(1);
    expect(r.picked[0].values.usdkrwBeta as number).toBeCloseTo(2, 9);

    // 공개일로 옮겨 짝지은 구현이라면 β의 부호가 뒤집힌다(이 테스트가 그 구현을 잡는지 확인)
    const p = DATES[j - 1];
    const published = DATES.map((t) => {
      let k = -1;
      obs.forEach((o, i) => macroKnownFrom('usdkrw', o) <= t && (k = i));
      return k < 0 ? NaN : v[k];
    });
    const rs: number[] = [];
    const xs: number[] = [];
    for (let i = j - 120; i < j; i++) {
      rs.push(close[i] / close[i - 1] - 1);
      xs.push(published[i] / published[i - 1] - 1);
    }
    expect(DATES[j - 1]).toBe(p);
    expect(olsSlope(rs, xs)).toBeLessThan(0);
  });

  it('i*(p): β 창의 끝은 a(t_i) 다음 관측값의 knownFrom ≤ p인 마지막 봉이다(p의 봉이 아니다)', () => {
    const r = lcg(3);
    const obs = usWeekdays('2024-11-01', 400);
    let x = 1300;
    const fx = { d: obs, v: obs.map(() => (x *= 1 + (r() - 0.5) * 0.02)) };
    let y = 50000;
    const close = DATES.map(() => (y *= 1 + (r() - 0.5) * 0.05));
    const c = offCriteria();
    c.conditions.macro.betaDays = 30;
    betaOn(c, 'usdkrw');
    const pre = precompute(mkFileV2([mkStock('A', close)], 300, { usdkrw: fx }), c, null);
    const beta = pre.stocks[0].beta.usdkrw;
    let differs = 0;
    for (let j = 120; j < 300; j += 7) {
      const p = j - 1;
      let iStar = -1;
      for (let i = 0; i <= p; i++) {
        // a(t_i)가 확정되려면 그다음 관측값까지 공개돼야 한다
        const k = obsBefore(obs, ymd(DATES[i]));
        if (k + 1 < obs.length && macroKnownFrom('usdkrw', obs[k + 1]) <= DATES[p]) iStar = i;
      }
      expect(iStar).toBeLessThan(p);
      const got = selectAt(DATES[j], pre, c).picked[0].values.usdkrwBeta;
      expect(got, `d = ${DATES[j]}`).toBe(beta[iStar]);
      if (beta[iStar] !== beta[p]) differs++;
    }
    expect(differs).toBeGreaterThan(10);
  });

  it('β가 범위 [min, max] 안이면 통과(양 끝 포함), β가 없으면 탈락', () => {
    const obs = usWeekdays('2024-11-01', 400);
    const fx = { d: obs, v: obs.map((_, i) => 1000 * (i % 2 ? 1.01 : 0.99) ** (i % 3)) };
    const a = paired(fx);
    const stocks = [mkStock('P', follow(a, 2)), mkStock('M', follow(a, -1)), mkStock('S', follow(a, 2).map((v, i) => (i < 280 ? null : v)))];
    const c = offCriteria();
    c.conditions.macro.betaDays = 30;
    const at = (min: number, max: number) => {
      betaOn(c, 'usdkrw', min, max);
      return symbols(selectAt(DATES[290], precompute(mkFileV2(stocks, 300, { usdkrw: fx }), c, null), c));
    };
    expect(at(-20, 20)).toEqual(['M', 'P']);
    expect(at(0.3, 5)).toEqual(['P']);
    // 양 끝 포함: 계산된 β 그 값으로 min = max
    const b = selectAt(DATES[290], precompute(mkFileV2(stocks, 300, { usdkrw: fx }), c, null), c).picked.find((x) => x.symbol === 'P')!.values
      .usdkrwBeta as number;
    expect(b).toBeCloseTo(2, 9);
    expect(at(b, b)).toEqual(['P']);
    expect(at(-5, -0.3)).toEqual(['M']);
    expect(at(-0.2, 0.2)).toEqual([]);
  });

  it('미리 계산의 betaDays와 다르거나 β 없이 계산했으면 거부한다', () => {
    const c = offCriteria();
    betaOn(c, 'usdkrw');
    const f = mkFileV2([mkStock('A', flat())], N);
    const pre = precompute(f, c, null);
    const other = structuredClone(c);
    other.conditions.macro.betaDays = 60;
    expect(() => selectAt(D, pre, other)).toThrow(PrecomputeMismatchError);
    const off = offCriteria();
    const preOff = precompute(f, off, null);
    expect(() => selectAt(D, preOff, c)).toThrow(PrecomputeMismatchError);
    off.rank = { by: 'macroBeta', take: 5, series: 'usdkrw' };
    expect(() => selectAt(D, preOff, off)).toThrow(PrecomputeMismatchError);
  });
});

describe('selectAt: 계열 흐름(스펙 3.2)과 흐름 따라가기(3.3)', () => {
  const obs = usWeekdays('2024-11-01', 400);
  // k < 150: ±1% 번갈아, 150~174: 매일 +0.5%, 175~199: ±0.5% 번갈아, 200~224: 매일 −0.5%, 그 뒤 ±1%
  const step = (k: number): number =>
    k < 150 || k >= 225 ? (k % 2 ? 0.01 : -0.01) : k < 175 ? 0.005 : k < 200 ? (k % 2 ? 0.005 : -0.005) : -0.005;
  const v: number[] = [];
  obs.forEach((_, k) => v.push(k === 0 ? 1000 : v[k - 1] * (1 + step(k))));
  const fx = { d: obs, v };
  const a = paired(fx);
  const stocks = [mkStock('P', follow(a, 2)), mkStock('M', follow(a, -1)), mkStock('Z', follow(a, 0.1))];
  const pre = (c: SelectionCriteria) => precompute(mkFileV2(stocks, 300, { usdkrw: fx }), c, null);
  /** 마지막 공개 관측 k가 [lo, hi) 안인 첫 재선정일 후보 */
  const dateWhere = (lo: number, hi: number): string => {
    for (let j = 31; j < 300; j++) {
      const k = lastKnown('usdkrw', obs, DATES[j - 1]);
      if (k >= lo && k < hi) return DATES[j];
    }
    throw new Error('날짜 없음');
  };
  const trendCrit = (whenFlat: 'pass' | 'none', patch: Partial<SelectionCriteria['conditions']['macro']['usdkrw']['trend']> = {}) => {
    const c = offCriteria();
    c.conditions.macro.betaDays = 30;
    c.conditions.macro.usdkrw.trend = { on: true, lookback: 20, thresholdPct: 3, minAbsBeta: 0.3, whenFlat, ...patch };
    return c;
  };

  it('흐름 = knownFrom ≤ p인 마지막 관측값 / 그보다 lookback개 앞선 관측값 − 1', () => {
    const c = trendCrit('pass', { lookback: 5, thresholdPct: 50 });
    for (const j of [60, 130, 211, 299]) {
      const k = lastKnown('usdkrw', obs, DATES[j - 1]);
      const r = selectAt(DATES[j], pre(c), c);
      expect(r.passed).toBe(3);
      expect(r.picked[0].values.usdkrwTrend as number).toBeCloseTo((v[k] / v[k - 5] - 1) * 100, 9);
    }
    // 앞선 관측값이 모자라면 흐름이 없고 통과 0개
    const long = trendCrit('pass', { lookback: 120, thresholdPct: 50 });
    const j = DATES.findIndex((t, i) => i > 0 && lastKnown('usdkrw', obs, DATES[i - 1]) >= 0 && lastKnown('usdkrw', obs, DATES[i - 1]) < 120 && t > DATES[30]);
    expect(selectAt(DATES[j], pre(long), long).passed).toBe(0);
  });

  it('오름이면 + 민감 종목만, 내림이면 − 민감 종목만', () => {
    const c = trendCrit('pass');
    const up = selectAt(dateWhere(170, 175), pre(c), c);
    expect(symbols(up)).toEqual(['P']);
    expect(up.picked[0].values.usdkrwTrend as number).toBeGreaterThan(3);
    expect(up.picked[0].values.usdkrwBeta as number).toBeCloseTo(2, 9);
    const down = selectAt(dateWhere(220, 225), pre(c), c);
    expect(symbols(down)).toEqual(['M']);
    expect(down.picked[0].values.usdkrwTrend as number).toBeLessThan(-3);
  });

  it("약함이면 'pass'는 이 조건을 건너뛰고, 'none'은 통과 0개", () => {
    const d = dateWhere(195, 200);
    const pass = trendCrit('pass');
    expect(symbols(selectAt(d, pre(pass), pass)).sort()).toEqual(['M', 'P', 'Z']);
    const none = trendCrit('none');
    expect(selectAt(d, pre(none), none).passed).toBe(0);
  });

  it('β 범위와 흐름을 같은 계열에서 켜면 둘 다 만족해야 한다', () => {
    const c = trendCrit('pass');
    betaOn(c, 'usdkrw', 0, 1);
    expect(selectAt(dateWhere(170, 175), pre(c), c).passed).toBe(0); // 오름 → P(β 2)뿐인데 범위 밖
    expect(symbols(selectAt(dateWhere(195, 200), pre(c), c))).toEqual(['Z']);
  });

  it('흐름의 끝값이 0 이하이면 흐름을 계산하지 않는다(통과 0개). WTI 음수 구간', () => {
    const r = lcg(11);
    const wobs = usWeekdays('2024-11-01', 400);
    let x = 60;
    const wv = wobs.map(() => (x *= 1 + (r() - 0.5) * 0.04));
    // 화요일 관측 하나를 −36.98로, 다음 날을 8.91로 둔다
    const t0 = wobs.findIndex((o, i) => i > 200 && new Date(`${o.slice(0, 4)}-${o.slice(4, 6)}-${o.slice(6, 8)}T00:00:00Z`).getUTCDay() === 2);
    wv[t0] = -36.98;
    wv[t0 + 1] = 8.91;
    const wti = { d: wobs, v: wv };
    const c = offCriteria();
    c.conditions.macro.betaDays = 30;
    c.conditions.macro.wti.trend = { on: true, lookback: 5, thresholdPct: 50, minAbsBeta: 0, whenFlat: 'pass' };
    const s = [mkStock('A', follow(paired(wti), 1))];
    const p0 = precompute(mkFileV2(s, 300, { wti }), c, null);
    let hit = 0;
    let ok = 0;
    for (let j = 31; j < 300; j++) {
      const k = lastKnown('wti', wobs, DATES[j - 1]);
      const sel = selectAt(DATES[j], p0, c);
      if (k === t0) {
        hit++;
        expect(sel.passed).toBe(0);
      } else if (k > t0 + 5) ok += sel.passed;
    }
    expect(hit).toBeGreaterThan(0);
    expect(ok).toBeGreaterThan(0);
    // β는 그 쌍을 빼고 유한하다
    expect(Number.isFinite(p0.stocks[0].beta.wti[299])).toBe(true);
  });
});

describe('selectAt: 정렬 macroBeta', () => {
  const obs = usWeekdays('2024-11-01', 400);
  const r = lcg(5);
  let x = 1300;
  const fx = { d: obs, v: obs.map(() => (x *= 1 + (r() - 0.5) * 0.02)) };
  const wti = { d: obs, v: fx.v.map((v) => 1e6 / v) }; // 환율의 역수: 민감도 부호가 반대
  const a = paired(fx);
  const stocks = [
    mkStock('000001', follow(a, -1), { shares: 9 }),
    mkStock('000002', follow(a, 0.5), { shares: 1 }),
    mkStock('000003', follow(a, 2), { shares: 1 }),
    mkStock('000004', follow(a, 2).map((v, i) => (i < 290 ? null : v)), { shares: 99 }), // 봉이 모자라 β 없음
  ];
  const rank = (series: MacroSeriesKey) => {
    const c = offCriteria();
    c.conditions.macro.betaDays = 30;
    c.rank = { by: 'macroBeta', take: 10, series };
    return selectAt(DATES[295], precompute(mkFileV2(stocks, 300, { usdkrw: fx, wti }), c, null), c);
  };

  it('고른 계열의 β 내림차순, β가 없으면 정렬과 통과 수에서 뺀다. values에 그 계열 β', () => {
    const u = rank('usdkrw');
    expect(symbols(u)).toEqual(['000003', '000002', '000001']);
    expect(u.passed).toBe(3);
    expect(u.picked[0].values).toEqual({ usdkrwBeta: expect.closeTo(2, 9) });
    const w = rank('wti');
    expect(symbols(w)).toEqual(['000001', '000002', '000003']);
    expect(Object.keys(w.picked[0].values)).toEqual(['wtiBeta']);
  });
});

describe('selectAt: 합집합 후보 범위(스펙 4.1)', () => {
  const stocks = (): Stock[] => [
    mkStock('K1', flat(), { m: 'KOSPI', sec: ['00013', '', ''], shares: 6 }),
    mkStock('K2', flat(), { m: 'KOSPI', sec: ['00016', '', ''], shares: 5 }),
    mkStock('Q1', flat(), { m: 'KOSDAQ', sec: ['11027', '', ''], shares: 4 }),
    mkStock('Q2', flat(), { m: 'KOSDAQ', sec: ['11027', '', ''], shares: 3 }),
    mkStock('Q3', flat(), { m: 'KOSDAQ', sec: ['11027', '', ''], shares: 2 }),
  ];
  const themes = [
    { code: 'T01', name: '테마1', symbols: ['K2', 'Q1'] },
    { code: 'T02', name: '테마2', symbols: ['Q1', 'Q3'] },
  ];
  const baskets: Basket[] = [{ id: 'b1', name: '묶음', updatedAt: NOW, symbols: ['Q2', 'K1'] }];
  const pick = (pool: Partial<SelectionCriteria['pool']>, bs: Basket[] = baskets) => {
    const c = offCriteria();
    c.pool = { ...c.pool, ...pool };
    return symbols(selectAt(D, precompute(mkFileV2(stocks(), N, {}, themes), c, null), c, undefined, bs));
  };

  it('아무것도 고르지 않으면 전체', () => {
    expect(pick({})).toEqual(['K1', 'K2', 'Q1', 'Q2', 'Q3']);
  });
  it('업종만, 테마만, 묶음만', () => {
    expect(pick({ sectors: ['00013'] })).toEqual(['K1']);
    expect(pick({ themes: ['T01'] })).toEqual(['K2', 'Q1']);
    expect(pick({ baskets: ['b1'] })).toEqual(['K1', 'Q2']);
  });
  it('섞으면 합집합이고, 시장·종류 필터는 그 위에 AND', () => {
    expect(pick({ sectors: ['00016'], themes: ['T02'], baskets: ['b1'] })).toEqual(['K1', 'K2', 'Q1', 'Q2', 'Q3']);
    expect(pick({ themes: ['T01', 'T02'] })).toEqual(['K2', 'Q1', 'Q3']);
    expect(pick({ markets: ['KOSPI'], themes: ['T02'], baskets: ['b1'] })).toEqual(['K1']);
  });
  it('지워진 묶음 id와 데이터에 없는 테마는 빈 것으로 본다(합집합이 0이면 통과 0개)', () => {
    expect(pick({ baskets: ['gone'] })).toEqual([]);
    expect(pick({ themes: ['T99'] })).toEqual([]);
    expect(pick({ baskets: ['gone'], themes: ['T01'] })).toEqual(['K2', 'Q1']);
    expect(pick({ baskets: ['b1'] }, [])).toEqual([]);
  });
  it('v1 데이터에서 테마를 고르면 빈 테마', () => {
    const c = offCriteria();
    c.pool.themes = ['T01'];
    expect(selectAt(D, precompute(mkFile(stocks(), N), c, null), c).passed).toBe(0);
  });

  // 기대값은 4단계 전 코드(fb4f0f8)로 만들었다
  it('회귀: 업종만 고른 기존 기준은 이 단계 전 결과와 같다(데모 데이터)', () => {
    const fixture = JSON.parse(gunzipSync(readFileSync('tests/fixtures/market-data-demo.json.gz')).toString()) as MarketDataFile;
    const baseline = JSON.parse(readFileSync('tests/fixtures/select-sector-baseline.json', 'utf8')) as Record<string, unknown>;
    const axis = tradingAxis(fixture);
    const dates = [...rebalanceDates(axis, { from: '2025-10-16', to: '2026-10-15' }, 'monthly'), addDays(axis[axis.length - 1], 1)];
    const cases: [string, (c: SelectionCriteria) => void][] = [
      ['sector 00013', (c) => (c.pool.sectors = ['00013'])],
      ['sectors 11028+00016 leader', (c) => ((c.pool.sectors = ['11028', '00016']), (c.conditions.leader = { on: true, level: 1, maxRank: 2 }))],
      [
        'sector 00005 return rank',
        (c) => ((c.pool.sectors = ['00005', '11027']), (c.rank.by = 'return'), (c.conditions.returnRange = { on: true, days: 20, minPct: -10, maxPct: 10 })),
      ],
      ['sectors with ETF', (c) => ((c.pool.types = ['STOCK', 'ETF']), (c.pool.sectors = ['00013', '11027']), (c.rank.by = 'tradingValue'))],
      ['sectors leader level 2', (c) => ((c.pool.sectors = ['00013', '11028']), (c.conditions.leader = { on: true, level: 2, maxRank: 3 }))],
      ['sectors keep managed', (c) => ((c.pool.sectors = ['00013', '00005', '11028']), (c.pool.excludeManaged = false))],
    ];
    const pools = [undefined, { markets: ['KOSPI'], types: ['STOCK'] }, { markets: ['KOSDAQ'], types: ['STOCK'] }, { markets: ['KOSPI', 'KOSDAQ'], types: ['ETF'] }] as const;
    expect(Object.keys(baseline)).toEqual(cases.map((x) => x[0]));
    for (const [name, patch] of cases) {
      const c = offCriteria();
      c.rank.take = 10;
      patch(c);
      const pre = precompute(fixture, c, null);
      const got = dates.map((d) => pools.map((p) => selectAt(d, pre, c, p as never, [{ id: 'x', symbols: ['100000'] }])));
      expect(JSON.parse(JSON.stringify(got)), name).toEqual(baseline[name]);
    }
  });
});

// ── 3단계: 투자자 수급 ──

// 일 순매수 비율 pct(%)가 이어지는 수급(거래대금 1e9원 = 1000백만 원 기준)
const pctFlow = (pct: number, n = N): number[] => Array(n).fill(pct * 10);
const flowStock = (s: string, net: { f?: number[]; i?: number[]; p?: number[] }, at = 0): FlowStock => withFlow(mkStock(s, flat()), at, net);
const flowRun = (stocks: FlowStock[], c: SelectionCriteria, d = D) => selectAt(d, precompute(mkFileV3(stocks, N), c, null), c);
const amount = (who: FlowWho, days: number, minPct: number, maxPct: number) => {
  const c = offCriteria();
  c.conditions.flow.amount = { on: true, who, days, minPct, maxPct };
  return c;
};
const flowRank = (who: FlowWho, days: number) => {
  const c = offCriteria();
  c.rank = { by: 'flow', take: 10, flow: { who, days } };
  return c;
};

describe('selectAt: 수급은 하루 늦게 쓴다(스펙 2.3)', () => {
  // A는 비율 2%, 기준 1~5%
  const c = amount('foreign', 5, 1, 5);
  const base = () => flowRun([flowStock('A', { f: pctFlow(2) })], c);

  it('p 당일 수급이 극단값이어도 선정이 같다', () => {
    expect(base().picked.map((x) => x.symbol)).toEqual(['A']);
    for (const v of [-1e9, 1e9, 0]) expect(flowRun([flowStock('A', { f: withAt(pctFlow(2), { [P]: v }) })], c)).toEqual(base());
  });

  it('p − 1(e) 당일 값을 바꾸면 선정이 바뀐다(쓰고 있다는 증거)', () => {
    expect(flowRun([flowStock('A', { f: withAt(pctFlow(2), { [P - 1]: -1e9 }) })], c).passed).toBe(0);
    expect(flowRun([flowStock('A', { f: withAt(pctFlow(2), { [P - 6]: -1e9 }) })], c)).toEqual(base()); // 창 밖(5일 = 19..23번 봉)
    expect(flowRun([flowStock('A', { f: withAt(pctFlow(2), { [P - 6]: -1e9 }) })], amount('foreign', 6, 1, 5)).passed).toBe(0);
  });
});

describe('selectAt: 순매수 규모 조건(스펙 3.3)', () => {
  const stocks = () => [flowStock('L', { f: pctFlow(0.5) }), flowStock('M', { f: pctFlow(2) }), flowStock('H', { f: pctFlow(6) }), flowStock('S', { f: pctFlow(-3) })];

  it('minPct ≤ 비율 ≤ maxPct이면 통과하고 values.flowRatio에 %로 둔다', () => {
    const r = flowRun(stocks(), amount('foreign', 20, 1, 5));
    expect(r.picked).toMatchObject([{ symbol: 'M', values: { flowRatio: expect.closeTo(2, 9) } }]); // 정렬(시가총액) 값도 함께 있다
    expect(symbols(flowRun(stocks(), amount('foreign', 20, 0.4, 6.1)))).toEqual(['H', 'L', 'M']);
    expect(symbols(flowRun(stocks(), amount('foreign', 20, 0.6, 5.9)))).toEqual(['M']);
  });

  it('음수 범위로 순매도 종목을 고른다', () => {
    expect(symbols(flowRun(stocks(), amount('foreign', 20, -100, -1)))).toEqual(['S']);
  });

  it('수급이 없거나 계산할 수 없는 종목은 탈락한다', () => {
    const r = flowRun([...stocks(), mkStock('N', flat()), flowStock('Z', { f: pctFlow(2, 10) }, 20)], amount('foreign', 5, -100, 100));
    expect(symbols(r)).toEqual(['H', 'L', 'M', 'S']);
  });

  it('both는 외국인 비율과 기관 비율이 둘 다 범위 안일 때만 통과한다', () => {
    const r = flowRun(
      [flowStock('X', { f: pctFlow(2), i: pctFlow(3) }), flowStock('Y', { f: pctFlow(2), i: pctFlow(0.5) }), flowStock('W', { f: pctFlow(0.5), i: pctFlow(3) })],
      amount('both', 10, 1, 5),
    );
    expect(r.picked).toMatchObject([{ symbol: 'X', values: { flowRatioForeign: expect.closeTo(2, 9), flowRatioInst: expect.closeTo(3, 9) } }]);
    expect(r.picked[0].values).not.toHaveProperty('flowRatio');
  });
});

describe('selectAt: 연속 순매수 조건(스펙 3.3)', () => {
  // e(23번 봉)부터 거꾸로 k일 이어진 기관 순매수
  const run = (k: number) => Array.from({ length: N }, (_, j) => (j > E - k && j <= E ? 1 : j === E - k ? -1 : 1));
  const E = P - 1;
  const crit = (who: FlowWho, minDays: number) => {
    const c = offCriteria();
    c.conditions.flow.streak = { on: true, who, minDays };
    return c;
  };

  it('minDays 경계: 이어진 수가 minDays 이상이면 통과, values.flowStreak', () => {
    const stocks = [flowStock('A', { i: run(4) }), flowStock('B', { i: run(5) }), flowStock('C', { i: run(6) })];
    expect(flowRun(stocks, crit('inst', 5)).picked).toMatchObject([
      { symbol: 'B', values: { flowStreak: 5 } },
      { symbol: 'C', values: { flowStreak: 6 } },
    ]);
    expect(symbols(flowRun(stocks, crit('inst', 6)))).toEqual(['C']);
    expect(symbols(flowRun(stocks, crit('foreign', 1)))).toEqual([]); // 외국인은 0
  });

  it('both는 두 주체가 함께 > 0인 날만', () => {
    const r = flowRun([flowStock('A', { f: run(3), i: run(6) })], crit('both', 3));
    expect(r.picked).toMatchObject([{ symbol: 'A', values: { flowStreak: 3 } }]);
    expect(flowRun([flowStock('A', { f: run(3), i: run(6) })], crit('both', 4)).passed).toBe(0);
  });

  it('수급 끝이 e보다 앞서거나 수급이 없으면 탈락한다', () => {
    expect(flowRun([flowStock('A', { i: Array(E).fill(1) }), mkStock('N', flat())], crit('inst', 1)).passed).toBe(0);
  });
});

describe("selectAt: 정렬 'flow'(스펙 3.3)", () => {
  it('비율이 큰 순서. values.rankFlow에 정렬에 쓴 값', () => {
    const r = flowRun([flowStock('A', { f: pctFlow(6) }), flowStock('B', { f: pctFlow(-2) }), flowStock('C', { f: pctFlow(4) })], flowRank('foreign', 20));
    expect(symbols(r)).toEqual(['A', 'C', 'B']);
    expect(r.picked.map((x) => x.values)).toEqual([{ rankFlow: expect.closeTo(6, 9) }, { rankFlow: expect.closeTo(4, 9) }, { rankFlow: expect.closeTo(-2, 9) }]);
  });

  it('both는 두 비율 중 작은 값으로 정렬한다', () => {
    const r = flowRun([flowStock('X', { f: pctFlow(6), i: pctFlow(1) }), flowStock('Y', { f: pctFlow(3), i: pctFlow(3) })], flowRank('both', 20));
    expect(symbols(r)).toEqual(['Y', 'X']);
    // 화면이 두 비율을 따로 보이도록 주체별 값도 남긴다
    expect(r.picked[1].values).toEqual({ rankFlow: expect.closeTo(1, 9), rankFlowForeign: expect.closeTo(6, 9), rankFlowInst: expect.closeTo(1, 9) });
  });

  it('계산할 수 없는 종목은 정렬에서 빠진다(수급 없음, 창이 from 앞, 수급 끝이 e 앞)', () => {
    const r = flowRun(
      [
        flowStock('A', { p: pctFlow(1) }),
        mkStock('N', flat()),
        flowStock('Z', { p: pctFlow(9, 10) }, 20),
        flowStock('T', { p: pctFlow(9, P - 1) }),
      ],
      flowRank('indiv', 5),
    );
    expect(symbols(r)).toEqual(['A']);
    expect(r.passed).toBe(1);
  });
});

describe('selectAt: 수급 미리 계산과 다른 기준', () => {
  const stocks = [flowStock('A', { f: pctFlow(2), i: pctFlow(2) })];
  const preOf = (c: SelectionCriteria) => precompute(mkFileV3(stocks, N), c, null);
  const streak = (who: FlowWho) => {
    const c = offCriteria();
    c.conditions.flow.streak = { on: true, who, minDays: 1 };
    return c;
  };

  it('수급 없이 계산했거나 주체·연속 주체가 다르면 거부한다', () => {
    const fx = amount('foreign', 5, 1, 5);
    expect(() => selectAt(D, preOf(offCriteria()), fx)).toThrow(PrecomputeMismatchError);
    expect(() => selectAt(D, preOf(fx), amount('inst', 5, 1, 5))).toThrow(PrecomputeMismatchError);
    expect(() => selectAt(D, preOf(fx), flowRank('both', 5))).toThrow(PrecomputeMismatchError);
    expect(() => selectAt(D, preOf(streak('inst')), streak('foreign'))).toThrow(PrecomputeMismatchError);
    expect(() => selectAt(D, preOf(fx), amount('foreign', 30, 1, 5))).not.toThrow(); // 일수는 누적합으로 아무 값이나 된다
  });

  it('flowMissingAt: 후보가 있는데 모두 수급 계산 불가일 때만 참', () => {
    const late = flowStock('Z', { f: pctFlow(2, 10) }, 20);
    const c = amount('foreign', 5, 1, 5);
    const pre = precompute(mkFileV3([late, mkStock('N', flat())], N), c, null);
    expect(flowMissingAt(D, pre, c)).toBe(true);
    expect(flowMissingAt(DATES[29], pre, c)).toBe(false);
    const both = precompute(mkFileV3([late, ...stocks], N), c, null);
    expect(flowMissingAt(D, both, c)).toBe(false);
    expect(flowMissingAt(D, pre, offCriteria())).toBe(false); // 수급을 쓰지 않는 기준
  });

  // 늦게 시작한 종목(20번 봉부터)만 후보. 수급이 처음부터 있는 A는 후보 범위 밖
  const lateOnly = (c: SelectionCriteria) => {
    c.pool.baskets = ['late'];
    const pre = precompute(mkFileV3([flowStock('Z', { f: pctFlow(2, 10), i: pctFlow(2, 10) }, 20), ...stocks], N), c, null);
    return (d: string) => flowMissingAt(d, pre, c, [{ id: 'late', symbols: ['Z'] }]);
  };

  it('flowMissingAt: 연속 순매수만 켠 기준은 e가 from 앞인 재선정일에 참', () => {
    const c = offCriteria();
    c.conditions.flow.streak = { on: true, who: 'inst', minDays: 1 };
    const missing = lateOnly(c);
    expect(missing(DATES[20])).toBe(true); // e = 18번 봉 < from(20)
    expect(missing(DATES[21])).toBe(true); // e = 19번 봉
    expect(missing(DATES[22])).toBe(false); // e = 20번 봉 = from
  });

  it("flowMissingAt: 정렬 'flow'만 쓰는 기준은 정렬 창이 from 앞으로 나가는 재선정일에 참", () => {
    const missing = lateOnly(flowRank('foreign', 5));
    expect(missing(D)).toBe(true); // 창 19..23번 봉, from 20
    expect(missing(DATES[26])).toBe(false); // 창 20..24번 봉
  });
});

// ── 2단계: 재무·가치 ──

// FIN_BASE(testData) 종목: D의 p(2025-02-05)에 202409까지 알려지고, 시가총액 10억 원이면
// PER 5 · PBR 1.25 · ROE 20 · 영업이익률 10 · 매출 +25 · 영업이익 +50 · 부채비율 50
const finStock = (s: string, patch: FinPatch = {}, meta: Partial<Stock> = {}): FinStock => mkFinStock(s, N, patch, meta);
const finRun = (stocks: FinStock[], c: SelectionCriteria, d = D) => selectAt(d, precompute(mkFileV4(stocks, N), c, null), c);
const finCond = (patch: (f: SelectionCriteria['conditions']['fin']) => void): SelectionCriteria => {
  const c = offCriteria();
  patch(c.conditions.fin);
  return c;
};
const finRank = (metric: FinMetric, take = 10): SelectionCriteria => {
  const c = offCriteria();
  c.rank = { by: 'fin', take, fin: { metric } };
  return c;
};
const scaled = (k: number): number[] => FIN_BASE.ni.map((x) => x * k);

describe('selectAt: 재무 조건(스펙 3.2)', () => {
  const A = finStock('A');
  const passes = (patch: (f: SelectionCriteria['conditions']['fin']) => void) => finRun([A], finCond(patch)).passed === 1;

  it.each<[string, (f: SelectionCriteria['conditions']['fin']) => void, (f: SelectionCriteria['conditions']['fin']) => void]>([
    ['PER 5', (f) => (f.per = { on: true, min: 5, max: 5 }), (f) => (f.per = { on: true, min: 5.01, max: 15 })],
    ['PER 최대', (f) => (f.per = { on: true, min: 0, max: 5 }), (f) => (f.per = { on: true, min: 0, max: 4.99 })],
    ['PBR 1.25', (f) => (f.pbr = { on: true, min: 1.25, max: 1.25 }), (f) => (f.pbr = { on: true, min: 0, max: 1.24 })],
    ['PBR 최소', (f) => (f.pbr = { on: true, min: 1.25, max: 100 }), (f) => (f.pbr = { on: true, min: 1.26, max: 100 })],
    ['ROE 20', (f) => (f.roe = { on: true, min: 20 }), (f) => (f.roe = { on: true, min: 20.01 })],
    ['영업이익률 10', (f) => (f.opMargin = { on: true, min: 10 }), (f) => (f.opMargin = { on: true, min: 10.01 })],
    ['매출 증가율 25', (f) => (f.revGrowth = { on: true, min: 25 }), (f) => (f.revGrowth = { on: true, min: 25.01 })],
    ['영업이익 증가율 50', (f) => (f.opGrowth = { on: true, min: 50 }), (f) => (f.opGrowth = { on: true, min: 50.01 })],
    ['부채비율 50', (f) => (f.debtRatio = { on: true, max: 50 }), (f) => (f.debtRatio = { on: true, max: 49.99 })],
  ])('%s: 경계는 포함하고 넘으면 탈락한다', (_, ok, ng) => {
    expect(passes(ok)).toBe(true);
    expect(passes(ng)).toBe(false);
  });

  it('경계는 부동소수 오차에 흔들리지 않는다: 영업이익이 정확히 20% 늘면 증가율 최소 20을 통과한다', () => {
    const grown = finStock('G', { op: [5, 5, 5, 5, 6, 6, 6, 6] });
    const c = finCond((f) => (f.opGrowth = { on: true, min: 20 }));
    expect(finRun([grown], c).passed).toBe(1);
  });

  it('values에는 켠 지표와 쓴 분기(YYYYMM 숫자)만 넣는다', () => {
    const r = finRun([A], finCond((f) => ((f.per = { on: true, min: 0, max: 15 }), (f.roe = { on: true, min: 10 }))));
    expect(r.picked).toEqual([{ symbol: 'A', values: { finPer: 5, finRoe: 20, finQuarter: 202409, marketCap: 1e9 } }]); // marketCap은 기본 정렬 값
    const all = finRun(
      [A],
      finCond((f) => {
        f.pbr.on = f.opMargin.on = f.revGrowth.on = f.opGrowth.on = f.debtRatio.on = f.profitable.on = true;
        f.pbr.max = 2;
      }),
    );
    expect(all.picked[0].values).toEqual({ marketCap: 1e9, finPbr: 1.25, finOpMargin: 10, finRevGrowth: 25, finOpGrowth: 50, finDebtRatio: 50, finQuarter: 202409 });
  });

  it('흑자: TTM 순이익 > 0만 통과. 적자·TTM 계산 불가(3분기)는 탈락', () => {
    const three = cutFin((a) => a.slice(-3));
    const zero = finStock('Z', { ni: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5, -0.5] }); // TTM 0
    const r = finRun([A, finStock('L', { ni: scaled(-1) }), finStock('T', three), zero, mkStock('N', flat())], finCond((f) => (f.profitable.on = true)));
    expect(symbols(r)).toEqual(['A']);
  });

  it('상장주식수 0이면 PER·PBR 조건에서 탈락하고(D9) 다른 지표 조건은 통과한다', () => {
    const z = finStock('Z', {}, { shares: 0 });
    expect(symbols(finRun([A, z], finCond((f) => (f.per = { on: true, min: 0, max: 1000 }))))).toEqual(['A']);
    expect(symbols(finRun([A, z], finCond((f) => (f.pbr = { on: true, min: 0, max: 100 }))))).toEqual(['A']);
    expect(symbols(finRun([A, z], finCond((f) => (f.roe = { on: true, min: 0 })))).sort()).toEqual(['A', 'Z']);
  });

  it('재무가 없는 종목은 어떤 재무 조건에서도 탈락한다', () => {
    expect(finRun([mkStock('N', flat())], finCond((f) => (f.debtRatio = { on: true, max: 10000 }))).passed).toBe(0);
  });
});

describe("selectAt: 정렬 'fin'(스펙 3.2)", () => {
  // B: 순이익 2배(PER 2.5, ROE 40), C: 절반(PER 10, ROE 10), X: 적자(PER 계산 불가, ROE −20), Z: 주식 수 0
  const stocks = [
    finStock('C', { ni: scaled(0.5) }),
    finStock('A'),
    finStock('X', { ni: scaled(-1) }),
    finStock('B', { ni: scaled(2) }),
    finStock('Z', { ni: scaled(3) }, { shares: 0 }),
    mkStock('N', flat()),
  ];

  it('PER은 낮은 순, 계산 불가(적자·주식 수 0·재무 없음)는 정렬과 통과 수에서 뺀다. values.rankFin', () => {
    const r = finRun(stocks, finRank('per'));
    expect(r.picked).toEqual([
      { symbol: 'B', values: { rankFin: 2.5, finQuarter: 202409 } },
      { symbol: 'A', values: { rankFin: 5, finQuarter: 202409 } },
      { symbol: 'C', values: { rankFin: 10, finQuarter: 202409 } },
    ]);
    expect(r.passed).toBe(3);
  });

  it('ROE는 높은 순. 주식 수 0인 종목도 들어가고, 음수 ROE도 계산 가능하다', () => {
    const r = finRun(stocks, finRank('roe'));
    expect(symbols(r)).toEqual(['Z', 'B', 'A', 'C', 'X']);
    expect(r.picked.map((x) => x.values.rankFin)).toEqual([60, 40, 20, 10, -20]);
    expect(r.passed).toBe(5);
  });

  it.each<[FinMetric, 'asc' | 'desc']>([
    ['per', 'asc'],
    ['pbr', 'asc'],
    ['roe', 'desc'],
    ['opMargin', 'desc'],
    ['revGrowth', 'desc'],
    ['opGrowth', 'desc'],
  ])('%s: %s 정렬, 동률은 종목코드 오름차순', (metric, dir) => {
    const rng = lcg(7);
    const many = Array.from({ length: 12 }, (_, i) =>
      finStock(`S${String(i).padStart(2, '0')}`, {
        rev: FIN_BASE.rev.map((x) => x * (0.5 + rng())),
        op: FIN_BASE.op.map((x) => x * (0.5 + rng())),
        ni: FIN_BASE.ni.map((x) => x * (i % 4 === 0 ? 1 : 0.5 + rng())),
        eq: FIN_BASE.eq.map((x) => x * (i % 4 === 0 ? 1 : 0.5 + rng())),
      }),
    );
    const r = finRun(many, finRank(metric, 30));
    const v = r.picked.map((x) => x.values.rankFin as number);
    expect(v.length).toBe(12);
    for (let i = 1; i < v.length; i++) {
      expect(dir === 'asc' ? v[i] >= v[i - 1] : v[i] <= v[i - 1]).toBe(true);
      if (v[i] === v[i - 1]) expect(r.picked[i].symbol > r.picked[i - 1].symbol).toBe(true);
    }
  });

  it('재무 정렬 값이 없는 rank.fin은 PER로 본다(기존 프로필)', () => {
    const c = finRank('per');
    delete c.rank.fin;
    expect(symbols(finRun(stocks, c))).toEqual(['B', 'A', 'C']);
  });
});

describe('selectAt: 재무 공시 시점(스펙 2.3)', () => {
  // 202412(연간, +100일 = 2025-04-10)를 더한다. 순이익 10억이라 TTM이 2 → 11.5로 바뀐다
  const nine = finStock('A', {
    q: [...FIN_BASE.q, '202412'],
    rev: [...FIN_BASE.rev, 7.5],
    op: [...FIN_BASE.op, 0.75],
    ni: [...FIN_BASE.ni, 10],
    eq: [...FIN_BASE.eq, 8],
    debt: [...FIN_BASE.debt, 4],
  });
  const at = (prev: string) => {
    const c = finCond((f) => (f.per = { on: true, min: 0, max: 1000 }));
    const n = DATES.indexOf(prev) + 2;
    const st = mkFinStock('A', n, nine.fin!);
    return selectAt(DATES[n - 1], precompute(mkFileV4([st], n), c, null), c).picked[0].values;
  };

  it('전 거래일 p가 공시일 당일이면 그 분기를 아직 쓰지 않고, 다음 거래일부터 쓴다(< 규칙)', () => {
    expect(at('2025-04-10')).toMatchObject({ finQuarter: 202409, finPer: 5 });
    expect(at('2025-04-11')).toMatchObject({ finQuarter: 202412 });
    expect(at('2025-04-11').finPer).toBeCloseTo(10 / 11.5, 9);
  });
});

describe('selectAt: 재무 미리 계산과 finMissingAt', () => {
  const A = finStock('A');
  const seven = cutFin((a) => a.slice(1));
  const per = finCond((f) => (f.per = { on: true, min: 0, max: 100 }));

  it('재무 없이 미리 계산했으면 조건·정렬 어느 쪽이든 거부한다', () => {
    const pre = precompute(mkFileV4([A], N), offCriteria(), null);
    expect(() => selectAt(D, pre, per)).toThrow(PrecomputeMismatchError);
    expect(() => selectAt(D, pre, finRank('roe'))).toThrow(PrecomputeMismatchError);
    expect(() => selectAt(D, precompute(mkFileV4([A], N), per, null), finRank('roe'))).not.toThrow();
  });

  it('조건만 쓸 때: 후보가 있는데 모두 그 조건의 지표를 계산할 수 없을 때만 참', () => {
    const lossOnly = precompute(mkFileV4([finStock('L', { ni: scaled(-1) }), mkStock('N', flat())], N), per, null);
    expect(finMissingAt(D, lossOnly, per)).toBe(true);
    const withA = precompute(mkFileV4([finStock('L', { ni: scaled(-1) }), A], N), per, null);
    expect(finMissingAt(D, withA, per)).toBe(false);
    // 알려진 분기가 아직 없는 종목만 후보
    const early = finStock('E', { q: ['202503', '202506', '202509', '202512', '202603', '202606', '202609', '202612'] });
    expect(finMissingAt(D, precompute(mkFileV4([early], N), per, null), per)).toBe(true);
  });

  it('정렬만 쓸 때: 정렬 지표로 판단한다(7분기 종목은 PER은 되고 영업이익 증가율은 안 된다)', () => {
    const pre = precompute(mkFileV4([finStock('S', seven)], N), finRank('opGrowth'), null);
    expect(finMissingAt(D, pre, finRank('opGrowth'))).toBe(true);
    expect(finMissingAt(D, pre, finRank('per'))).toBe(false);
  });

  it('재무를 쓰지 않거나 후보가 없으면 거짓', () => {
    const pre = precompute(mkFileV4([finStock('L', { ni: scaled(-1) })], N), per, null);
    expect(finMissingAt(D, pre, offCriteria())).toBe(false);
    const empty = { ...per, pool: { ...per.pool, markets: ['KOSDAQ' as const] } };
    expect(finMissingAt(D, pre, empty)).toBe(false);
    expect(finMissingAt(DATES[0], pre, per)).toBe(false); // 전 거래일이 없다
  });
});

describe('selectAt: 재무 미래 정보 누설 방지(손으로 만든 데이터, p = 공시일 당일)', () => {
  // 데모의 p는 공시일과 겹치지 않아 `<` → `<=`를 잡지 못한다. 여기서는 p가 어떤 분기의 공시일과 같은 재선정일만 본다
  const NF = DATES.length;
  const rng = lcg(5);
  const quarters = (start: string, n: number): string[] =>
    Array.from({ length: n }, (_, i) => {
      const m = +start.slice(0, 4) * 12 + +start.slice(4, 6) - 1 + i * 3;
      return `${Math.floor(m / 12)}${String((m % 12) + 1).padStart(2, '0')}`;
    });
  // q는 종목마다 복사한다(structuredClone은 공유한 배열을 공유한 채로 복제해 잘라내기가 다른 종목에 번진다)
  const series = (q: string[], annual: (q: string) => boolean): FinSeries => ({
    q: [...q],
    a: q.map((x) => (annual(x) ? 1 : 0)),
    rev: q.map(() => 5 + rng() * 10),
    op: q.map(() => 0.2 + rng()),
    ni: q.map(() => 0.2 + rng()),
    eq: q.map(() => 5 + rng() * 10),
    debt: q.map(() => rng() * 10),
  });
  const qDec = quarters('202203', 16); // 202203 ~ 202512
  const qNov = quarters('202202', 16); // 202202 ~ 202511
  const stocks: FinStock[] = [
    ['DEC', series(qDec, (q) => q.endsWith('12'))],
    ['MAR', series(qDec, (q) => q.endsWith('03'))],
    ['NOV', series(qNov, (q) => q.endsWith('11'))],
    // 12월 결산 → 3월 결산: 202312(a = 1) 다음 202403(a = 1)인 3개월짜리 회계연도
    ['SHORT', series(qDec, (q) => (q <= '202312' ? q.endsWith('12') : q.endsWith('03')))],
  ].map(([s, fin], i) => ({ ...mkStock(s as string, DATES.map((_, k) => 80 + ((k * 7 + i * 13) % 40)), { shares: 1e7 }), fin: fin as FinSeries }));
  const file = mkFileV4(stocks, NF);
  // 검사 쪽 공시일(구현과 따로 계산)
  const known = (q: string, a: number): string => {
    const y = +q.slice(0, 4);
    const m = +q.slice(4, 6);
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    return addDays(addDays(next, -1), a ? 100 : 60);
  };
  // p가 어떤 분기의 공시일인 재선정일 d(= p 다음 거래일)
  const onKnown = DATES.slice(1, -1).flatMap((p, i) => {
    const hits = stocks.flatMap((st) => st.fin!.q.filter((q, k) => known(q, st.fin!.a[k]) === p).map((q) => `${st.s}:${q}`));
    return hits.length ? [{ p, d: DATES[i + 2], hits }] : [];
  });
  const mutated = (p: string, f: ((v: number) => number) | null): MarketDataFileV4 => {
    const g = structuredClone(file);
    for (const st of g.stocks) {
      const fin = st.fin!;
      const keep = fin.q.filter((q, k) => known(q, fin.a[k]) < p).length;
      if (f == null) {
        if (keep === 0) delete st.fin;
        else for (const k of ['q', 'a', 'rev', 'op', 'ni', 'eq', 'debt'] as const) (fin[k] as unknown[]).splice(keep);
      } else for (let k = keep; k < fin.q.length; k++) for (const key of ['rev', 'op', 'ni', 'eq', 'debt'] as const) fin[key][k] = f(fin[key][k]);
    }
    return g;
  };
  const per = finCond((f) => (f.per = { on: true, min: 0, max: 1000 }));
  const roe = finRank('roe', 30);

  it('공시일 당일이 p인 재선정일이 여럿이고, 연간 결산 분기와 짧은 회계연도 분기도 들어 있다', () => {
    const all = onKnown.flatMap((x) => x.hits);
    expect(onKnown.length).toBeGreaterThanOrEqual(6);
    for (const want of ['DEC:202412', 'MAR:202503', 'NOV:202411', 'SHORT:202503']) expect(all).toContain(want);
  });

  it.each([
    ['PER 0~1000', per],
    ['정렬 ROE', roe],
  ])('%s: 공시일 ≥ p인 분기를 ×1000·부호 반전·잘라내기로 바꿔도 선정이 같다', (_, c) => {
    const pre = precompute(file, c, null);
    for (const { p, d, hits } of onKnown) {
      const base = selectAt(d, pre, c);
      expect(base.passed, `${p} ${hits}`).toBeGreaterThan(0);
      for (const f of [(v: number) => v * 1000, (v: number) => -v, null])
        expect(selectAt(d, precompute(mutated(p, f), c, null), c), `${p} ${hits}`).toEqual(base);
    }
  });
});
