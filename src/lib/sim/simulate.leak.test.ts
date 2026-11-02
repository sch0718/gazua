// v2 조건·조건 매도·기간 청산·트레일링·분할 매수를 켠 전략의 미래 정보 누출 검사(점검표 4절, 설계 T1).
// 1) t+1 이후 봉을 바꿔도 t까지 같다. 2) 신호 주문은 신호일보다 뒤인 체결일 봉 시가에 체결한다.
import { describe, expect, it } from 'vitest';
import type { Candle } from '../data/metrics';
import { kstDate } from '../time/kst';
import { newStrategy } from './defaults';
import { condReason } from './rules';
import { simulate, simulateCore } from './simulate';
import type { Cond } from './strategyV2';
import { tradingDates } from './testBars';
import { randomWalk, rng, stockOf } from './testInputs';
import type { DayFrame, SimInput, Strategy, Trade } from './types';

// RSI는 기간 첫날 앞 251봉이 필요하다(rules.ts RSI_START_BARS + 1)
const WARM = 260;
const N = 300;
const ALL = tradingDates('2018-01-02', WARM + N);
const DAYS = ALL.slice(WARM);

// 묶음 사이는 OR라 조건 종류마다 묶음을 하나씩 둔다. 묶음 한도 4라서 매수 4개, 조건 매도 3개로 나눈다
const BUY: Cond[] = [
  { kind: 'maPrice', period: 20, side: 'above' },
  { kind: 'rsi', period: 14, level: 50, op: 'crossUp' },
  { kind: 'volume', days: 20, ratio: 1.8 },
  { kind: 'change', days: 5, pct: -6, op: 'below' },
];
const SELL: Cond[] = [
  { kind: 'maCross', short: 5, long: 20, dir: 'dead' },
  { kind: 'fromHigh', days: 20, pct: 8 },
  { kind: 'newHigh', days: 20 },
];

function strategy(): Strategy {
  const s = newStrategy(0, null);
  s.capital = { initial: 10_000_000 };
  s.sizing = { mode: 'fixed', pct: 20 };
  s.costs = { feePct: 0.015 };
  s.rules.buy = BUY.map((c) => ({ conds: [c] }));
  s.rules.sell = {
    takeProfit: { on: true, stages: [{ pct: 8, sellPct: 50 }, { pct: 15, sellPct: 100 }], afterFirstTake: 'keep' },
    stopLoss: { on: true, pct: 7, basis: 'avgAlways' },
    trailing: { on: true, pct: 6 },
    timeExit: { on: true, days: 4 },
    signal: { on: true, groups: SELL.map((c) => ({ conds: [c] })) },
  };
  s.scaleIn = { on: true, stepPct: 3, maxAdds: 2 };
  return s;
}

/** 봉마다 양수 거래량을 채운다(testBars.bar는 v = 0이라 volume 조건이 늘 거짓이 된다). 가끔 큰 값이 나오게 세제곱 */
function withVolume(cs: Candle[], seed: number): Candle[] {
  const r = rng(seed);
  return cs.map((k) => ({ ...k, v: Math.round(100_000 * (0.5 + 3 * r() ** 3)) }));
}

const walks = (dates: string[], seedBase: number, starts?: number[]) =>
  [0, 1, 2].map((k) => withVolume(randomWalk(dates, seedBase + k * 101, starts?.[k]), seedBase + 7 + k));

function input(stocks: Candle[][]): SimInput {
  return { strategy: strategy(), days: DAYS, stocks: stocks.map((c, k) => stockOf(k, c)), index: null, benchmarkStock: null };
}

const FULL = walks(ALL, 1);
// 빠진 봉: 빼지 않은 실행에서 S1의 첫 예약 매도 체결일을 골라 뺀다. 그 예약이 다음 봉까지 미뤄진다
const gapDates = (() => {
  const t = simulateCore(input(FULL)).trades.find((x) => x.symbol === 'S1' && (x.kind === 'signalSell' || x.kind === 'time'));
  if (!t) throw new Error('S1에 예약 매도가 없어요. 전략 값이나 시드를 바꿔 주세요');
  return new Set([t.date]);
})();
const strip = (cs: Candle[], k: number) => (k === 1 ? cs.filter((b) => !gapDates.has(kstDate(b.t))) : cs);

const base = simulate(input(FULL.map(strip)), { timeline: true });
const tl = base.timeline!;
const barDates = FULL.map((cs, k) => new Set(strip(cs, k).map((b) => kstDate(b.t))));
const openOf = (symbol: string, date: string) => {
  const k = Number(symbol.slice(1));
  return strip(FULL[k], k).find((b) => kstDate(b.t) === date)!.o;
};

/** 신호일 인덱스. 매수는 체결 전 거래일, 매도는 체결 전에 이어진 pendingSells 구간의 첫날. 없으면 −1 */
function signalDay(t: Trade): number {
  const di = tl.findIndex((f) => f.date === t.date);
  const list = (f: DayFrame) => (t.kind === 'buy' ? f.pending : f.pendingSells);
  const has = (i: number) => i >= 0 && list(tl[i]).some((p) => p.symbol === t.symbol);
  let s = di - 1;
  if (!has(s)) return -1;
  if (t.kind !== 'buy') while (has(s - 1)) s--;
  return s;
}
const ordered = base.trades.filter((t) => t.kind === 'buy' || t.kind === 'signalSell' || t.kind === 'time');

describe('미래 정보 누출: v2 조건·조건 매도·기간 청산·트레일링', () => {
  it('헛돌지 않는다: 거래 수, 체결 종류, 조건 종류별 사유, 미룬 매도', () => {
    expect(base.trades.length).toBeGreaterThan(10);
    for (const kind of ['buy', 'add', 'trail', 'time', 'signalSell'] as const) expect(base.trades.some((t) => t.kind === kind), kind).toBe(true);
    const reasons = base.trades.filter((t) => t.kind === 'buy' || t.kind === 'signalSell').map((t) => t.reason);
    for (const c of [...BUY, ...SELL]) expect(reasons.some((r) => r.includes(condReason(c))), condReason(c)).toBe(true);
    const deferred = ordered.filter((t) => t.kind !== 'buy' && tl.findIndex((f) => f.date === t.date) - signalDay(t) > 1);
    expect(deferred.length).toBeGreaterThan(0);
  });

  it('신호 주문은 신호일보다 뒤인 체결일 봉 시가에, 사이에 그 종목 봉이 없을 때만 미뤄 체결한다', () => {
    for (const t of ordered) {
      const di = tl.findIndex((f) => f.date === t.date);
      const s = signalDay(t);
      const where = `${t.kind} ${t.symbol} ${t.date}`;
      expect(s, where).toBeGreaterThanOrEqual(0);
      expect(di, where).toBeGreaterThan(s);
      expect(t.price, where).toBe(openOf(t.symbol, t.date));
      const k = Number(t.symbol.slice(1));
      for (let i = s + 1; i < di; i++) expect(barDates[k].has(DAYS[i]), `${where} 사이 ${DAYS[i]}`).toBe(false);
    }
  });

  it('t+1 이후 봉을 바꿔도 t일까지의 trades·equity는 같다', () => {
    const core = simulateCore(input(FULL.map(strip)));
    const r = rng(11);
    for (let n = 0; n < 10; n++) {
      const t = WARM + 5 + Math.floor(r() * (N - 10));
      const tails = walks(ALL.slice(t + 1), 9000 + n * 10, FULL.map((cs) => cs[t].c));
      const alt = FULL.map((cs, k) => strip([...cs.slice(0, t + 1), ...tails[k]], k));
      const got = simulateCore(input(alt));
      const cut = <T extends { date: string }>(xs: T[]) => xs.filter((x) => x.date <= ALL[t]);
      expect(cut(got.trades)).toEqual(cut(core.trades));
      expect(cut(got.equity)).toEqual(cut(core.equity));
    }
  });
});
