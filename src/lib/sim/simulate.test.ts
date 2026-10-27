import { describe, expect, it } from 'vitest';
import type { Candle } from '../data/metrics';
import { kstDate } from '../time/kst';
import { newStrategy } from './defaults';
import { costOf, openPosition } from './position';
import { simulate, simulateCore, walkBar, type WalkCtx } from './simulate';
import { bar, tradingDates } from './testBars';
import type { SimInput, Skip, Strategy, Trade } from './types';

type O = [number, number, number, number]; // 시가/고가/저가/종가

const N = 40;
const DATES = tradingDates('2026-01-05', N);
const d = (i: number) => DATES[i];
// 인덱스 8 종가에서 '3일 연속 상승' 신호 (A=100, L=80)
const BASE = [90, 100, 92, 95, 88, 80, 82, 84, 86];

/** 앞부분은 o=h=l=c 종가, 뒤는 [o,h,l,c] 봉. 날짜는 인덱스 순서 그대로 */
function candles(closes: number[], rest: O[] = [], skip: number[] = []): Candle[] {
  const all: O[] = [...closes.map((c): O => [c, c, c, c]), ...rest];
  return all.flatMap(([o, h, l, c], i) => (skip.includes(i) ? [] : [bar(d(i), o, h, l, c)]));
}

function strat(over: (s: Strategy) => void = () => {}): Strategy {
  const s = newStrategy(0, null);
  s.capital = { initial: 10_000_000, perBuyPct: 10 };
  s.costs.feePct = 0;
  s.entry.triggers.breakout.on = false;
  s.exit.stopLoss = { pct: 5, basis: 'avgAlways' };
  over(s);
  return s;
}

function input(s: Strategy, stocks: Candle[][], days?: string[]): SimInput {
  const n = Math.max(...stocks.map((c) => c.length), 0);
  return {
    strategy: s,
    days: days ?? DATES.slice(0, n),
    stocks: stocks.map((c, k) => ({ symbol: `S${k}`, name: `종목${k}`, market: 'KOSPI', isEtf: false, candles: c })),
    index: null,
    benchmarkStock: null,
  };
}

const one = (s: Strategy, rest: O[], closes = BASE) => simulateCore(input(s, [candles(closes, rest)]));
const kinds = (ts: Trade[]) => ts.map((t) => `${t.kind}@${+t.price.toFixed(2)}x${t.qty}`);

describe('simulateCore', () => {
  it('next-day open buy: 신호 인덱스 8 → 인덱스 9 시가에 매수', () => {
    const core = one(strat(), [[87, 88, 86, 87]]);
    expect(core.trades).toHaveLength(1);
    expect(core.trades[0]).toMatchObject({ date: d(9), kind: 'buy', price: 87, qty: 11494, reason: '3일 연속 상승', fee: 0, tax: 0 });
    expect(core.trades[0].pattern).toEqual({ a: 100, aDate: d(1), b: 95, l: 80, lDate: d(5) });
    expect(core.equity).toHaveLength(10);
    expect(core.equity[9]).toEqual({ date: d(9), value: 10_000_000, cash: 10_000_000 - 11494 * 87 });
    expect(core.perSymbolFirstDate).toEqual({ S0: d(0) });
  });

  it('gap stop: 다음 날 시가 80(손절선 82.65 아래) → gapStop @80', () => {
    const core = one(strat(), [[87, 88, 86, 87], [80, 81, 79, 80]]);
    expect(core.trades[1]).toMatchObject({ date: d(10), kind: 'gapStop', price: 80, qty: 11494, reason: '손절' });
    expect(core.trades[1].pnlPct).toBeCloseTo((80 / 87 - 1) * 100, 10);
    // 수수료 0이어도 KOSPI 2026 매도세 0.2%
    expect(core.roundTrips).toEqual([
      { symbol: 'S0', open: d(9), close: d(10), cost: 11494 * 87, pnl: expect.closeTo(11494 * 80 * 0.998 - 11494 * 87, 6), holdDays: 2 },
    ]);
  });

  it('intraday stop and take on the same day → stop wins', () => {
    const core = one(strat(), [[87, 88, 86, 87], [87, 101, 82, 95]]);
    expect(kinds(core.trades)).toEqual(['buy@87x11494', 'stop@82.65x11494']);
  });

  it('two take stages in one day', () => {
    const s = strat((x) => (x.exit.takeProfit = [{ pct: 10, sellPct: 50 }, { pct: 15, sellPct: 100 }]));
    const core = one(s, [[87, 88, 86, 87], [88, 101, 88, 100]]);
    expect(kinds(core.trades)).toEqual(['buy@87x11494', 'take@95.7x5747', 'take@100.05x5747']);
    expect(core.trades[1]).toMatchObject({ date: d(10), stage: 1, reason: '1단계 익절 50%' });
    expect(core.trades[2]).toMatchObject({ date: d(10), stage: 2, reason: '2단계 익절 100%' });
  });

  it('gap take: 시가가 2단계 가격 위 → 남은 단계 모두 gapTake @시가', () => {
    const s = strat((x) => (x.exit.takeProfit = [{ pct: 10, sellPct: 50 }, { pct: 15, sellPct: 100 }]));
    const core = one(s, [[87, 88, 86, 87], [101, 102, 100, 101]]);
    expect(kinds(core.trades)).toEqual(['buy@87x11494', 'gapTake@101x5747', 'gapTake@101x5747']);
  });

  it('gap take: 시가 == 익절가면 take, 시가 > 익절가일 때만 gapTake', () => {
    // 매수 87 → 익절가 87 × 1.15 = 100.05
    const eq = one(strat(), [[87, 88, 86, 87], [100.05, 101, 99, 100]]);
    expect(kinds(eq.trades)).toEqual(['buy@87x11494', 'take@100.05x11494']);
    const gap = one(strat(), [[87, 88, 86, 87], [100.06, 101, 99, 100]]);
    expect(kinds(gap.trades)).toEqual(['buy@87x11494', 'gapTake@100.06x11494']);
  });

  it('시가 매수: 현금이 정확히 비용이면 사고 현금 0, 수수료 = 비용 − 수량 × 가격', () => {
    // 101주 × 87원 × 1.00015를 0.0001원 단위로 맞춘 값. 따로 계산한 수수료는 1e-12만큼 어긋난다
    const initial = costOf(101, 87, 0.015);
    const s = strat((x) => {
      x.costs.feePct = 0.015;
      x.capital = { initial, perBuyPct: 100 };
    });
    const core = one(s, [[87, 88, 86, 87]]);
    const [buy] = core.trades;
    expect(buy).toMatchObject({ kind: 'buy', price: 87, qty: 101 });
    expect(core.equity[9].cash).toBe(0);
    expect(buy.price * buy.qty + buy.fee).toBe(initial);
    expect(core.roundTrips[0].cost).toBe(initial);
  });

  it('단일 100% 익절의 reason은 익절', () => {
    const core = one(strat(), [[87, 88, 86, 87], [90, 101, 90, 100]]);
    expect(core.trades[1]).toMatchObject({ kind: 'take', stage: 1, reason: '익절' });
  });

  it('bought today still trades intraday', () => {
    const core = one(strat(), [[87, 87, 82, 83]]);
    expect(kinds(core.trades)).toEqual(['buy@87x11494', 'stop@82.65x11494']);
    expect(core.trades.every((t) => t.date === d(9))).toBe(true);
  });

  it('scale-in chain in one day', () => {
    const s = strat((x) => {
      x.scaleIn = { on: true, stepPct: 3, maxAdds: 2 };
      x.exit.stopLoss.basis = 'avgAfterScaleIn';
    });
    const core = one(s, [[100, 100, 93, 94]]);
    expect(kinds(core.trades)).toEqual(['buy@100x10000', 'add@97x10309', 'add@94.09x10628']);
    expect(core.trades[1]).toMatchObject({ date: d(9), reason: '추가 매수' });
    expect(core.trades[2].date).toBe(d(9));
  });

  it('stop basis avgAfterScaleIn: 추가 매수 전 −6% 하락에도 손절 없음', () => {
    const s = strat((x) => {
      x.scaleIn = { on: true, stepPct: 10, maxAdds: 2 };
      x.exit.stopLoss.basis = 'avgAfterScaleIn';
    });
    expect(kinds(one(s, [[100, 100, 94, 95]]).trades)).toEqual(['buy@100x10000']);
  });

  it('partial sell stops further adds', () => {
    const s = strat((x) => {
      x.scaleIn = { on: true, stepPct: 3, maxAdds: 2 };
      x.exit.stopLoss.basis = 'avgAfterScaleIn';
      x.exit.takeProfit = [{ pct: 5, sellPct: 50 }, { pct: 15, sellPct: 100 }];
    });
    const core = one(s, [[100, 106, 100, 106], [106, 106, 90, 95]]);
    expect(kinds(core.trades)).toEqual(['buy@100x10000', 'take@105x5000', 'stop@95x5000']);
  });

  it('cash shortfall skip recorded once per level', () => {
    const s = strat((x) => (x.capital.perBuyPct = 60));
    const core = simulateCore(input(s, [candles(BASE, [[87, 88, 86, 87]]), candles(BASE, [[87, 88, 86, 87]])]));
    expect(core.trades.map((t) => t.symbol)).toEqual(['S0']);
    expect(core.skipped).toEqual([{ date: d(9), symbol: 'S1', reason: '현금 부족' }]);

    // 추가 매수 가격이 여러 날 닿아도 현금 부족 기록은 한 번
    const s2 = strat((x) => {
      x.capital.perBuyPct = 60;
      x.scaleIn = { on: true, stepPct: 3, maxAdds: 1 };
    });
    const core2 = one(s2, [[100, 100, 96, 98], [98, 99, 96, 97], [97, 97, 96, 96]]);
    expect(kinds(core2.trades)).toEqual(['buy@100x60000']);
    expect(core2.skipped).toEqual([{ date: d(9), symbol: 'S0', reason: '현금 부족' }]);
  });

  it("zero shares: 1회 금액 < 1주 가격 → '1주가 1회 금액보다 비쌈'", () => {
    const s = strat((x) => (x.capital.initial = 500));
    const core = one(s, [[87, 88, 86, 87]]);
    expect(core.trades).toEqual([]);
    expect(core.skipped).toEqual([{ date: d(9), symbol: 'S0', reason: '1주가 1회 금액보다 비쌈' }]);
  });

  it('a stock with no bars in days never trades and equity stays cash', () => {
    const core = simulateCore(input(strat(), [[]], DATES.slice(0, 5)));
    expect(core.trades).toEqual([]);
    expect(core.equity.map((e) => e.value)).toEqual(Array(5).fill(10_000_000));
    expect(core.perSymbolFirstDate).toEqual({ S0: null });
  });

  it('halted days keep the position at last close and resume with gap rules', () => {
    // 인덱스 10, 11 봉 없음 → 12 시가 80 < 손절선 82.65
    const c = candles(BASE, [[87, 88, 86, 87], [0, 0, 0, 0], [0, 0, 0, 0], [80, 81, 79, 80]], [10, 11]);
    const core = simulateCore(input(strat(), [c], DATES.slice(0, 13)));
    const cash = 10_000_000 - 11494 * 87;
    expect(core.equity[10].value).toBe(cash + 11494 * 87);
    expect(core.equity[11].value).toBe(cash + 11494 * 87);
    expect(core.trades[1]).toMatchObject({ date: d(12), kind: 'gapStop', price: 80 });
  });

  it("pending buy cancelled when next day has no bar → '거래 없음'", () => {
    const c = candles(BASE, [[0, 0, 0, 0], [80, 80, 80, 80]], [9]);
    const core = simulateCore(input(strat(), [c], DATES.slice(0, 11)));
    expect(core.skipped).toEqual<Skip[]>([{ date: d(9), symbol: 'S0', reason: '거래 없음' }]);
    expect(core.trades).toEqual([]);
  });

  it('fees and tax: feePct 0.015, KOSPI 2026 매도세 0.2%', () => {
    const s = strat((x) => (x.costs.feePct = 0.015));
    const core = one(s, [[87, 88, 86, 87], [80, 81, 79, 80]]);
    const q = Math.floor(1_000_000 / (87 * 1.00015));
    const [buy, sell] = core.trades;
    expect(buy).toMatchObject({ qty: q, tax: 0 });
    expect(buy.fee).toBeCloseTo(q * 87 * 0.00015, 6);
    expect(sell).toMatchObject({ kind: 'gapStop', qty: q });
    expect(sell.fee).toBeCloseTo(q * 80 * 0.00015, 6);
    expect(sell.tax).toBeCloseTo(q * 80 * 0.002, 6);
    const cash = 10_000_000 - q * 87 * 1.00015 + q * 80 * (1 - 0.00015 - 0.002);
    expect(core.equity[10].cash).toBeCloseTo(cash, 4);
    const rt = core.roundTrips[0];
    expect(rt.cost).toBeCloseTo(q * 87 * 1.00015, 6);
    expect(rt.pnl).toBeCloseTo(q * 80 * (1 - 0.00015 - 0.002) - q * 87 * 1.00015, 6);
  });

  it('reset after full exit: 같은 하락으로 재매수 없음, 새 고점 → 새 하락 → 새 반등에서만 재매수', () => {
    // 10: 시가 101 갭 익절 뒤 종가 95, 연속 상승은 이어지지만 리셋으로 신호 없음
    // 11: 96 새 고점, 13: 85(−11.5%), 14·15·16 상승 → 16 신호 → 17 매수
    const flat = (xs: number[]) => xs.map((c): O => [c, c, c, c]);
    const rest: O[] = [[87, 87, 87, 87], [101, 101, 95, 95], ...flat([96, 90, 85, 86, 87, 88, 88])];
    const core = simulateCore(input(strat(), [candles(BASE, rest)]));
    expect(core.trades.map((t) => `${t.kind}@${t.date}`)).toEqual([`buy@${d(9)}`, `gapTake@${d(10)}`, `buy@${d(17)}`]);
  });

  it('warmup bars before days[0] feed the pattern but never trade', () => {
    // 인덱스 8(워밍업) 신호는 버리고, days[0]=인덱스 9 종가 신호로 인덱스 10 시가 매수
    const c = candles(BASE, [[87, 88, 86, 87], [90, 90, 90, 90], [91, 91, 91, 91]]);
    const core = simulateCore(input(strat(), [c], DATES.slice(9, 12)));
    expect(core.trades.map((t) => `${t.kind}@${t.date}@${t.price}`)).toEqual([`buy@${d(10)}@90`]);
    expect(core.equity.map((e) => e.date)).toEqual(DATES.slice(9, 12));
    expect(core.perSymbolFirstDate).toEqual({ S0: d(9) });
    // 통계는 거래 기간만: 9·10·11일 하락 조건 만족
    expect(core.patternStats.declineDays).toBe(3);
  });

  it('open position at end: roundTrips 마지막 항목 close null, 매도 비용 없음', () => {
    const core = one(strat(), [[87, 88, 86, 87], [88, 90, 86, 89]]);
    expect(core.roundTrips).toEqual([{ symbol: 'S0', open: d(9), close: null, cost: 11494 * 87, pnl: 11494 * 2, holdDays: 2 }]);
  });

  it('dates outside days are ignored', () => {
    const c = candles(BASE, [[87, 88, 86, 87], [10, 10, 10, 10]]);
    const core = simulateCore(input(strat(), [c], DATES.slice(0, 10)));
    expect(kinds(core.trades)).toEqual(['buy@87x11494']);
    expect(core.equity).toHaveLength(10);
  });

  it('end-to-end cursor path: 신호 매수 뒤 추가 매수로 생긴 손절선을 커서에 체결', () => {
    const s = strat((x) => {
      x.capital = { initial: 1000, perBuyPct: 50 };
      x.scaleIn = { on: true, stepPct: 50, maxAdds: 1 };
      x.exit.stopLoss.basis = 'avgAfterScaleIn';
    });
    const core = one(s, [[100, 100, 100, 100], [100, 100, 40, 40]]);
    expect(kinds(core.trades)).toEqual(['buy@100x5', 'add@50x10', 'gapStop@50x15']);
    expect(core.equity[10].cash).toBeCloseTo(750 * 0.998, 9); // 매도세 0.2%
  });

  it('sell on 2025-12-29 uses the 2026 rate via settlement date', () => {
    // 2025-12-31·2026-01-01은 휴장 → 12-29 체결의 결제일은 2026-01-02
    const off = new Set(['2025-12-25', '2025-12-31', '2026-01-01']);
    const ds = tradingDates('2025-12-12', 16).filter((x) => !off.has(x));
    expect(ds[10]).toBe('2025-12-29');
    const all: O[] = [...BASE.map((c): O => [c, c, c, c]), [87, 88, 86, 87], [80, 81, 79, 80]];
    const c = all.map(([o, h, l, cl], i) => bar(ds[i], o, h, l, cl));
    const core = simulateCore(input(strat(), [c], ds));
    const sell = core.trades[1];
    expect(sell).toMatchObject({ date: '2025-12-29', kind: 'gapStop', price: 80 });
    expect(sell.tax).toBeCloseTo(sell.qty * 80 * 0.002, 6); // 0.15%가 아님
  });
});

describe('walkBar (스펙 5.2 예시 표)', () => {
  function ctx(cash: number, amount: number, s: Strategy, feePct = 0) {
    const trades: Trade[] = [];
    const skips: { reason: Skip['reason']; price: number }[] = [];
    const c: WalkCtx = {
      date: '2026-01-05',
      symbol: 'X',
      wallet: { cash },
      amount,
      feePct,
      taxPct: 0,
      takeProfit: s.exit.takeProfit,
      excluded: new Set(),
      trade: (t) => trades.push(t),
      skip: (reason, price) => skips.push({ reason, price }),
    };
    return { c, trades, skips };
  }
  const k = (o: number, h: number, l: number, c: number) => bar('2026-01-05', o, h, l, c);

  it('add skipped for cash still lets the stop below fire', () => {
    const s = strat((x) => (x.scaleIn = { on: true, stepPct: 3, maxAdds: 2 }));
    const pos = openPosition(100, 10, s.scaleIn, s.exit);
    const { c, trades, skips } = ctx(0, 1000, s);
    walkBar(pos, k(100, 105, 90, 100), c);
    expect(skips).toEqual([{ reason: '현금 부족', price: 97 }]);
    expect(kinds(trades)).toEqual(['stop@95x10']);
    expect(c.wallet.cash).toBe(950);
  });

  it('a stop activated by an add above the cursor fills at the cursor', () => {
    const s = strat((x) => {
      x.scaleIn = { on: true, stepPct: 50, maxAdds: 1 };
      x.exit.stopLoss.basis = 'avgAfterScaleIn';
    });
    const pos = openPosition(100, 5, s.scaleIn, s.exit);
    const { c, trades } = ctx(500, 500, s);
    walkBar(pos, k(100, 100, 40, 40), c);
    expect(kinds(trades)).toEqual(['add@50x10', 'gapStop@50x15']);
    expect(c.wallet.cash).toBe(750);
  });

  it('breakeven stop fires on the high-to-close leg', () => {
    const s = strat((x) => {
      x.exit.stopLoss = { pct: 5, basis: 'firstBuy' };
      x.exit.takeProfit = [{ pct: 10, sellPct: 50 }, { pct: 50, sellPct: 100 }];
      x.exit.afterFirstTake = 'breakeven';
    });
    const pos = openPosition(100, 10, s.scaleIn, s.exit);
    const { c, trades } = ctx(0, 1000, s);
    walkBar(pos, k(100, 112, 98, 99), c);
    expect(kinds(trades)).toEqual(['take@110x5', 'stop@100x5']);
    expect(c.wallet.cash).toBeCloseTo(1050, 9);
  });

  it('매수 비용은 한 번만 계산해 현금이 정확히 0이 된다', () => {
    const s = strat((x) => (x.scaleIn = { on: true, stepPct: 3, maxAdds: 1 }));
    const pos = openPosition(100, 10, s.scaleIn, s.exit);
    const cost = 9 * 97 * (1 + 10 / 100); // 1000 / (97 × 1.1) → 9주
    const { c, trades } = ctx(cost, 1000, s, 10);
    walkBar(pos, k(100, 100, 97, 98), c);
    expect(kinds(trades)).toEqual(['add@97x9']);
    expect(c.wallet.cash).toBe(0);
  });

  it('시가 == 손절선이면 stop, 시가 < 손절선이면 gapStop', () => {
    const s = strat();
    const eq = ctx(0, 1000, s);
    walkBar(openPosition(100, 10, s.scaleIn, s.exit), k(95, 96, 94, 95), eq.c);
    expect(eq.trades.map((t) => t.kind)).toEqual(['stop']);
    expect(eq.trades[0].price).toBe(95);

    const gap = ctx(0, 1000, s);
    walkBar(openPosition(100, 10, s.scaleIn, s.exit), k(94, 96, 93, 95), gap.c);
    expect(gap.trades.map((t) => t.kind)).toEqual(['gapStop']);
  });
});

describe('미래 데이터 미사용', () => {
  function rng(seed: number) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function walk(dates: string[], seed: number, start = 10_000): Candle[] {
    const r = rng(seed);
    let p = start;
    return dates.map((dt) => {
      const o = p * (1 + (r() - 0.5) * 0.04);
      const c = o * (1 + (r() - 0.5) * 0.08);
      const h = Math.max(o, c) * (1 + r() * 0.02);
      const l = Math.min(o, c) * (1 - r() * 0.02);
      p = c;
      return bar(dt, o, h, l, c);
    });
  }

  it('t+1 이후 봉을 바꿔도 t일까지의 trades·equity는 같다 (워밍업 20봉, 중간에 빠진 날 3일)', () => {
    const WARM = 20;
    const all = tradingDates('2019-12-09', WARM + 300);
    const days = all.slice(WARM);
    const s = strat((x) => {
      x.scaleIn = { on: true, stepPct: 3, maxAdds: 2 };
      x.exit.takeProfit = [{ pct: 5, sellPct: 50 }, { pct: 10, sellPct: 100 }];
      x.exit.afterFirstTake = 'breakeven';
      x.entry.decline.dropPct.value = 5;
      x.entry.triggers.breakout.on = true;
      x.capital.perBuyPct = 30;
    });
    // 두 번째 종목은 기간 중 3일(거래 구간 100·101·180번째)이 빠진다
    const gaps = new Set([all[WARM + 100], all[WARM + 101], all[WARM + 180]]);
    const strip = (cs: Candle[], k: number) => (k === 1 ? cs.filter((b) => !gaps.has(kstDate(b.t))) : cs);
    const full = [1, 2, 3].map((k) => walk(all, k * 101));
    const base = simulateCore(input(s, full.map(strip), days));
    expect(base.trades.length).toBeGreaterThan(10);
    expect(base.equity).toHaveLength(300);
    const r = rng(7);
    for (let n = 0; n < 10; n++) {
      const t = WARM + 5 + Math.floor(r() * 290);
      const alt = full.map((cs, k) => {
        const tail = walk(all.slice(t + 1), 9000 + n * 10 + k, cs[t].c);
        return strip([...cs.slice(0, t + 1), ...tail], k);
      });
      const got = simulateCore(input(s, alt, days));
      const cut = <T extends { date: string }>(xs: T[]) => xs.filter((x) => x.date <= all[t]);
      expect(cut(got.trades)).toEqual(cut(base.trades));
      expect(cut(got.equity)).toEqual(cut(base.equity));
    }
  });
});

it('candle t는 KST 자정', () => {
  expect(kstDate(candles(BASE)[0].t)).toBe(d(0));
});

// 창 밖 사유 (스펙 6.3)
const OUT = '선정 기간이 아니에요';
const withWindows = (s: Strategy, stocks: Candle[][], windows: { from: string; to: string }[]) => {
  const inp = input(s, stocks);
  inp.stocks.forEach((st) => (st.buyWindows = windows));
  return simulateCore(inp);
};
const noPattern = (ts: Trade[]) => ts.map(({ pattern: _p, ...t }) => t);

describe('buyWindows 없이 결과가 그대로 (리터럴 기대값, 도입 전 엔진 출력)', () => {
  it('익절 시나리오', () => {
    const s = strat((x) => (x.exit.takeProfit = [{ pct: 5, sellPct: 100 }]));
    const core = one(s, [[87, 88, 86, 87], [88, 95, 88, 94]]);
    expect(noPattern(core.trades)).toEqual([
      { date: '2026-01-16', symbol: 'S0', kind: 'buy', price: 87, qty: 11494, fee: 0, tax: 0, reason: '3일 연속 상승' },
      { date: '2026-01-19', symbol: 'S0', kind: 'take', stage: 1, price: 91.35000000000001, qty: 11494, fee: 0, tax: 2099.9538, reason: '익절', pnlPct: 5.000000000000004 },
    ]);
    expect(core.skipped).toEqual([]);
    expect(core.equity.slice(-3)).toEqual([
      { date: '2026-01-15', value: 10000000, cash: 10000000 },
      { date: '2026-01-16', value: 10000000, cash: 9000022 },
      { date: '2026-01-19', value: 10047898.9462, cash: 10047898.9462 },
    ]);
    expect(core.roundTrips).toEqual([{ symbol: 'S0', open: '2026-01-16', close: '2026-01-19', cost: 999978, pnl: 47898.9462, holdDays: 2 }]);
  });

  it('분할 매수 시나리오', () => {
    const s = strat((x) => {
      x.scaleIn = { on: true, stepPct: 3, maxAdds: 2 };
      x.exit.stopLoss.basis = 'avgAfterScaleIn';
    });
    const core = one(s, [[100, 100, 93, 94], [94, 95, 93, 95], [95, 99, 94, 98]]);
    expect(noPattern(core.trades)).toEqual([
      { date: '2026-01-16', symbol: 'S0', kind: 'buy', price: 100, qty: 10000, fee: 0, tax: 0, reason: '3일 연속 상승' },
      { date: '2026-01-16', symbol: 'S0', kind: 'add', price: 97, qty: 10309, fee: 0, tax: 0, reason: '추가 매수' },
      { date: '2026-01-16', symbol: 'S0', kind: 'add', price: 94.09, qty: 10628, fee: 0, tax: 0, reason: '추가 매수' },
    ]);
    expect(core.skipped).toEqual([]);
    expect(core.equity.slice(-3)).toEqual([
      { date: '2026-01-16', value: 9908116.48, cash: 7000038.48 },
      { date: '2026-01-19', value: 9939053.48, cash: 7000038.48 },
      { date: '2026-01-20', value: 10031864.48, cash: 7000038.48 },
    ]);
    expect(core.roundTrips).toEqual([{ symbol: 'S0', open: '2026-01-16', close: null, cost: 2999961.52, pnl: 31864.48, holdDays: 3 }]);
  });

  it('현금 부족 건너뜀 + 손절 시나리오(두 종목)', () => {
    const s = strat((x) => (x.capital.perBuyPct = 60));
    const core = simulateCore(
      input(s, [candles(BASE, [[87, 88, 86, 87], [87, 88, 80, 81]]), candles(BASE, [[87, 88, 86, 87], [87, 88, 86, 87]])]),
    );
    expect(noPattern(core.trades)).toEqual([
      { date: '2026-01-16', symbol: 'S0', kind: 'buy', price: 87, qty: 68965, fee: 0, tax: 0, reason: '3일 연속 상승' },
      { date: '2026-01-19', symbol: 'S0', kind: 'stop', price: 82.64999999999999, qty: 68965, fee: 0, tax: 11399.9145, reason: '손절', pnlPct: -5.000000000000004 },
    ]);
    expect(core.skipped).toEqual([
      { date: '2026-01-16', symbol: 'S1', reason: '현금 부족' },
      { date: '2026-01-19', symbol: 'S1', reason: '현금 부족' },
    ]);
    expect(core.equity.slice(-3)).toEqual([
      { date: '2026-01-15', value: 10000000, cash: 10000000 },
      { date: '2026-01-16', value: 10000000, cash: 4000045 },
      { date: '2026-01-19', value: 9688602.3355, cash: 9688602.3355 },
    ]);
  });
});

describe('buyWindows', () => {
  it('창 밖 신호는 체결일에 건너뛰고 사유를 남긴다 (신호 다음 날이 창 밖이면 마지막 날 신호도 건너뜀)', () => {
    // 신호는 d(8) 종가, 체결은 d(9) 시가. 창이 d(8)까지면 체결일이 창 밖
    const core = withWindows(strat(), [candles(BASE, [[87, 88, 86, 87]])], [{ from: d(0), to: d(8) }]);
    expect(core.trades).toEqual([]);
    expect(core.skipped).toEqual([{ date: d(9), symbol: 'S0', reason: OUT }]);
  });

  it('창 안이면 그대로 체결하고, 양끝 날짜를 포함한다', () => {
    const rest: O[] = [[87, 88, 86, 87]];
    const inside = withWindows(strat(), [candles(BASE, rest)], [{ from: d(9), to: d(9) }]);
    expect(kinds(inside.trades)).toEqual(['buy@87x11494']);
    expect(inside.skipped).toEqual([]);
    const second = withWindows(strat(), [candles(BASE, rest)], [{ from: d(0), to: d(3) }, { from: d(9), to: d(12) }]);
    expect(kinds(second.trades)).toEqual(['buy@87x11494']);
  });

  it('창 밖이어도 현금 부족 등 다른 사유로 못 사면 원래 사유를 남긴다', () => {
    const s = strat((x) => (x.capital.initial = 500));
    const core = withWindows(s, [candles(BASE, [[87, 88, 86, 87]])], [{ from: d(0), to: d(8) }]);
    expect(core.skipped).toEqual([{ date: d(9), symbol: 'S0', reason: '1주가 1회 금액보다 비쌈' }]);
  });

  it('창이 끝난 뒤에도 손절·익절은 계속 체결한다', () => {
    const stopped = withWindows(strat(), [candles(BASE, [[87, 88, 86, 87], [80, 81, 79, 80]])], [{ from: d(0), to: d(9) }]);
    expect(kinds(stopped.trades)).toEqual(['buy@87x11494', 'gapStop@80x11494']);
    expect(stopped.trades[1].date).toBe(d(10));

    const s = strat((x) => (x.exit.takeProfit = [{ pct: 5, sellPct: 100 }]));
    const taken = withWindows(s, [candles(BASE, [[87, 88, 86, 87], [88, 95, 88, 94]])], [{ from: d(0), to: d(9) }]);
    expect(kinds(taken.trades)).toEqual(['buy@87x11494', 'take@91.35x11494']);
    expect(taken.trades[1].date).toBe(d(10));
  });

  it('분할 매수도 창 밖에서는 건너뛰고, 같은 날·종목·사유는 한 번만 남긴다', () => {
    const s = strat((x) => {
      x.scaleIn = { on: true, stepPct: 3, maxAdds: 2 };
      x.exit.stopLoss.basis = 'avgAfterScaleIn';
    });
    const rest: O[] = [[100, 100, 100, 100], [100, 100, 93, 94]];
    const out = withWindows(s, [candles(BASE, rest)], [{ from: d(0), to: d(9) }]);
    expect(kinds(out.trades)).toEqual(['buy@100x10000']);
    expect(out.skipped).toEqual([{ date: d(10), symbol: 'S0', reason: OUT }]);

    const inside = withWindows(s, [candles(BASE, rest)], [{ from: d(0), to: d(10) }]);
    expect(kinds(inside.trades)).toEqual(['buy@100x10000', 'add@97x10309', 'add@94.09x10628']);
    expect(inside.skipped).toEqual([]);
  });

  it('창 밖에서 막힌 추가 매수는 창이 다시 열린 뒤 같은 가격에 오면 그 가격에 체결한다', () => {
    const s = strat((x) => {
      x.scaleIn = { on: true, stepPct: 3, maxAdds: 2 };
      x.exit.stopLoss.basis = 'avgAfterScaleIn';
    });
    // d(10)은 창 밖이라 97에서 막히고, d(11)에 창이 열린 뒤 99에서 96.5로 내려오며 다시 97을 지난다
    const rest: O[] = [[100, 100, 100, 100], [100, 100, 96, 98], [99, 99, 96.5, 98]];
    const core = withWindows(s, [candles(BASE, rest)], [{ from: d(0), to: d(9) }, { from: d(11), to: d(20) }]);
    expect(kinds(core.trades)).toEqual(['buy@100x10000', 'add@97x10309']);
    expect(core.trades[1].date).toBe(d(11));
    expect(core.skipped).toEqual([{ date: d(10), symbol: 'S0', reason: OUT }]);
  });

  it('패턴 추적기는 창과 무관하게 돌아, 창 밖에서 건너뛴 뒤 창이 열리면 다음 신호에서 산다', () => {
    // 같은 하락·반등 신호가 d(9)에 건너뛴 뒤에도 매일 새로 나므로 창이 열린 d(10) 체결이 된다
    const core = withWindows(strat(), [candles(BASE, [[87, 88, 86, 87], [87, 88, 86, 88]])], [{ from: d(10), to: d(20) }]);
    expect(core.skipped[0]).toEqual({ date: d(9), symbol: 'S0', reason: OUT });
    expect(kinds(core.trades)).toEqual(['buy@87x11494']);
    expect(core.trades[0].date).toBe(d(10));
  });
});

describe('simulate', () => {
  it('평가액이 유한하지 않으면 던진다(시가 0 봉에 매수)', () => {
    const inp = input(strat(), [candles(BASE, [[0, 0, 0, 97], [97, 97, 97, 97]])]);
    expect(() => simulate(inp)).toThrow();
  });

  it('SimResult 모양과 hold·index·benchmark 연결', () => {
    const stock = candles(BASE, [[87, 88, 86, 87], [87, 90, 86, 88]]);
    const days = DATES.slice(0, stock.length);
    const idx = days.map((dt, i) => bar(dt, 1000, 1000, 1000, 1000 + i * 10));
    const inp = input(strat(), [stock], days);
    inp.index = { id: 'KOSPI', candles: idx };
    inp.benchmarkStock = { symbol: 'B', name: '지정', isEtf: false, market: 'KOSPI', candles: stock };
    const r = simulate(inp);
    expect(r.equity).toHaveLength(days.length);
    expect(r.equity[0]).toMatchObject({ date: days[0], strategy: 10_000_000, cash: 10_000_000, index: 10_000_000 });
    const last = r.equity[r.equity.length - 1];
    expect(last.index).toBeCloseTo((10_000_000 * (1000 + 10 * 10)) / 1000, 4);
    expect(last.hold).toBeCloseTo((10_000_000 * 88) / 90, -1);
    expect(last.benchmark).toBeCloseTo(last.hold, 4);
    expect(r.benchmarks.indexReturnPct).toBeCloseTo(10, 6);
    expect(r.benchmarks.holdReturnPct).toBeCloseTo(((last.hold / 10_000_000) - 1) * 100, 6);
    expect(r.summary.vsHoldPp).toBeCloseTo(r.summary.totalReturnPct - r.benchmarks.holdReturnPct, 6);
    expect(r.summary.openPositions).toBe(1);
    expect(r.trades).toHaveLength(1);
    expect(r.perSymbol).toEqual([{ symbol: 'S0', name: '종목0', pnl: expect.any(Number), roundTrips: 1, firstDate: days[0] }]);
    expect(r.perSymbol[0].pnl).toBeCloseTo(last.strategy - 10_000_000, 6);
    expect(r.nearMiss).toBeNull();
  });

  it('경계: 7주 총비용이 자금과 정확히 같으면 7주를 산다(부동소수점 나눗셈이 6.999…여도)', () => {
    const s = strat((x) => {
      x.capital = { initial: 560_084, perBuyPct: 100 };
      x.costs.feePct = 0.015;
      x.exit.takeProfit = [{ pct: 500, sellPct: 100 }];
      x.exit.stopLoss = { pct: 50, basis: 'avgAlways' };
    });
    const base = BASE.map((c) => c * 1000);
    const inp = input(s, [candles(base, [[80_000, 80_000, 80_000, 80_000], [100_000, 100_000, 100_000, 100_000]])]);
    const r = simulate(inp);
    expect(r.trades[0]).toMatchObject({ kind: 'buy', price: 80_000, qty: 7 });
    expect(r.equity[r.equity.length - 1].strategy).toBeCloseTo(700_000, 6);
    expect(r.summary.totalReturnPct).toBeCloseTo((700_000 / 560_084 - 1) * 100, 6);
  });

  it('경계: 자금 1,020,153원으로 10,200원 100주(총비용 1,020,153원)를 현금 부족 없이 산다', () => {
    const s = strat((x) => {
      x.capital = { initial: 1_020_153, perBuyPct: 100 };
      x.costs.feePct = 0.015;
      x.exit.takeProfit = [{ pct: 500, sellPct: 100 }];
      x.exit.stopLoss = { pct: 50, basis: 'avgAlways' };
    });
    const base = BASE.map((c) => c * 100);
    const inp = input(s, [candles(base, [[10_200, 12_000, 10_200, 12_000]])]);
    expect(d(9)).toBe('2026-01-16');
    const r = simulate(inp);
    expect(r.skipped).toEqual([]);
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]).toMatchObject({ kind: 'buy', price: 10_200, qty: 100, fee: 153 });
    expect(r.equity[r.equity.length - 1]).toMatchObject({ strategy: 1_200_000, cash: 0 });
  });

  it('평가액의 보유 가치는 종목마다 반올림한 값의 합이다(보유 중 손익과 같은 기준)', () => {
    // 5000.00004원 1주씩 2종목: 종목별 반올림 5000 + 5000, 곱을 합친 뒤 반올림하면 10000.0001
    const s = strat((x) => {
      x.capital = { initial: 10_001, perBuyPct: 50 };
    });
    const bars = (): Candle[] => candles(BASE.map((c) => c * 100), [[5000.00004, 5000.00004, 5000.00004, 5000.00004]]);
    const core = simulateCore(input(s, [bars(), bars()]));
    expect(core.trades.map((t) => t.qty)).toEqual([1, 1]);
    const last = core.equity[core.equity.length - 1];
    expect(last.cash).toBe(1);
    expect(last.value).toBe(10_001);
  });

  describe('독립 정답: BigInt 정수로 만든 정확한 예산이면 정확히 q주를 사고 현금 0', () => {
    const FEE_U = [0, 15, 100, 250, 1000]; // 0.001% 단위 (15 = 0.015%)
    /** q·P·(100000+feeU)/100000 이 정수일 때만 그 값을 돌려준다 */
    const exactBudget = (q: number, price: number, feeU: number): number | null => {
      const num = BigInt(q) * BigInt(price) * BigInt(100_000 + feeU);
      return num % 100_000n === 0n ? Number(num / 100_000n) : null;
    };
    const run = (n: number, price: number, feeU: number) => {
      const s = strat((x) => {
        x.capital = { initial: n, perBuyPct: 100 };
        x.costs.feePct = feeU / 1000;
        x.exit.takeProfit = [{ pct: 500, sellPct: 100 }];
        x.exit.stopLoss = { pct: 50, basis: 'avgAlways' };
      });
      return simulate(input(s, [candles(BASE.map((c) => c * 1000), [[price, price, price, price]])]));
    };
    const check = (q: number, price: number, feeU: number, n: number) => {
      const r = run(n, price, feeU);
      const ok =
        r.skipped.length === 0 && r.trades.length === 1 && r.trades[0].qty === q && r.trades[0].price === price &&
        r.equity[r.equity.length - 1].cash === 0;
      return ok ? null : `P=${price} q=${q} feeU=${feeU} N=${n}: trades=${r.trades.length} qty=${r.trades[0]?.qty} skipped=${r.skipped.map((x) => x.reason)}`;
    };

    it('손으로 쓴 표 (검토자의 10,200원 × 100주, 수수료 0.015% 포함)', () => {
      const table: [number, number, number, number][] = [
        // [가격, 수량, feeU, 정확한 예산]
        [10_200, 100, 15, 1_020_153],
        [80_000, 7, 15, 560_084],
        [333, 7, 0, 2_331],
        [10_000, 10, 100, 100_100],
        [250_000, 4, 250, 1_002_500],
        [100, 1, 1000, 101],
      ];
      for (const [price, q, feeU, n] of table) {
        expect(exactBudget(q, price, feeU), `표 검산 P=${price}`).toBe(n);
        expect(check(q, price, feeU, n)).toBeNull();
      }
    });

    it('시드 고정 4000건', () => {
      let a = 20261013;
      const rnd = () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y));
      const bad: string[] = [];
      let made = 0;
      while (made < 4000) {
        const feeU = FEE_U[Math.floor(rnd() * FEE_U.length)];
        const price = 100 + Math.floor(rnd() * 499_901);
        // q·P가 g의 배수여야 N이 정수: q는 g / gcd(g, P)의 배수
        const g = 100_000 / gcd(100_000, 100_000 + feeU);
        const m = g / gcd(g, price);
        if (m > 5000) continue;
        const q = m * (1 + Math.floor(rnd() * Math.floor(5000 / m)));
        const n = exactBudget(q, price, feeU);
        if (n === null || n > 1e11) throw new Error(`예산 생성 실패 P=${price} q=${q} feeU=${feeU}`);
        made++;
        const msg = check(q, price, feeU, n);
        if (msg) bad.push(msg);
      }
      expect(bad.length, `${bad.length}/4000 실패. 예: ${bad.slice(0, 3).join(' | ')}`).toBe(0);
    });
  });
});
