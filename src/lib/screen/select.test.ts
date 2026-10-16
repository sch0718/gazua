import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { MarketDataFile } from '../marketData/format';
import { newStrategy } from '../sim/defaults';
import { precompute, rebalanceDates, tradingAxis } from './precompute';
import { selectAt } from './select';
import { DATES, mkFile, mkStock, NOW, offCriteria, reboundAt, reboundEntry, sampleStdPct, type Stock } from './testData';
import type { RankBy, SelectionCriteria } from './types';

// 기본 데이터: 30거래일, 재선정일 d = DATES[25], 전 거래일 p = 24번 봉
const N = 30;
const D = DATES[25];
const P = 24;
const flat = (v = 100, n = N): number[] => Array(n).fill(v);
const withAt = (arr: number[], at: Record<number, number>): number[] => arr.map((v, i) => at[i] ?? v);
const nulls = (arr: (number | null)[], before: number): (number | null)[] => arr.map((v, i) => (i < before ? null : v));

const run = (stocks: Stock[], c: SelectionCriteria, opts: { n?: number; d?: string; entry?: ReturnType<typeof reboundEntry> | null } = {}) =>
  selectAt(opts.d ?? D, precompute(mkFile(stocks, opts.n ?? N), c, opts.entry ?? null), c);
const symbols = (r: ReturnType<typeof selectAt>) => r.picked.map((x) => x.symbol);

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

/** 같은 후보 범위에 조건만 모두 끈 기준 */
function offCriteriaLike(c: SelectionCriteria): SelectionCriteria {
  const o = offCriteria();
  o.pool = c.pool;
  o.rank = { by: 'marketCap', take: 30 };
  return o;
}
