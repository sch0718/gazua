import type { Candle } from '../data/metrics';
import type { MarketDataFile } from '../marketData/format';
import { sma } from '../sim/indicators';
import { createPatternTracker } from '../sim/pattern';
import type { Strategy } from '../sim/types';
import { kstEpoch } from '../time/kst';
import type { Rebalance, SelectionCriteria } from './types';

type FileStock = MarketDataFile['stocks'][number];

/** 52주 고점 창(거래일)과 최소 봉 수(스펙 5.1) */
export const HIGH_WINDOW = 250;
export const HIGH_MIN = 120;
/** 정렬에 쓰는 기본 일수: 조건이 꺼져 있을 때(스펙 5.1) */
export const RANK_RETURN_DAYS = 60;
export const RANK_VOL_DAYS = 20;

/** 종목 하나의 지표. 모든 배열은 그 종목 봉 인덱스 i 기준이고, i번 값은 i번 봉까지만 쓴다. */
export interface StockSeries {
  s: string;
  m: FileStock['m'];
  t: FileStock['t'];
  sec: FileStock['sec'];
  shares: number;
  managed: boolean;
  halted: boolean;
  d: string[]; // YYYY-MM-DD 오름차순
  close: number[];
  tvAvg: (number | null)[]; // 최근 tradingValue.days개 tv 평균
  ma: (number | null)[]; // vsMa.period일 단순이동평균. 조건이 꺼져 있으면 빈 배열
  high: (number | null)[]; // 최근 250개 종가 최대(최소 120개)
  vol: (number | null)[]; // 최근 volDays개 일간 수익률의 표본 표준편차(%)
  signalDays: string[]; // 반등 신호일(오름차순)
  lastSignal: number[]; // i번 봉까지 마지막 신호 봉 인덱스, 없으면 -1
}

export interface Precomputed {
  axis: string[];
  stocks: StockSeries[];
}

export class MissingStrategyError extends Error {
  constructor() {
    super('반등 패턴에 쓸 전략이 지워졌어요');
    this.name = 'MissingStrategyError';
  }
}

const isoDate = (ymd: string): string => `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;

/** 거래일 축: 지수 날짜 ∪ 종목 날짜(YYYY-MM-DD, 오름차순) */
export function tradingAxis(data: MarketDataFile): string[] {
  const set = new Set<string>();
  for (const x of data.indices) for (const d of x.d) set.add(d);
  for (const x of data.stocks) for (const d of x.d) set.add(d);
  return [...set].sort().map(isoDate);
}

const bucket = (date: string, every: Rebalance): string => {
  const m = Number(date.slice(5, 7)) - 1;
  const span = every === 'monthly' ? 1 : every === 'quarterly' ? 3 : 6;
  return `${date.slice(0, 4)}-${Math.floor(m / span)}`;
};

/** 기간 안의 첫 거래일과, 그 뒤 매월·분기(1·4·7·10월)·반기(1·7월) 첫 거래일 */
export function rebalanceDates(axis: string[], period: { from: string; to: string }, every: Rebalance): string[] {
  const out: string[] = [];
  for (let i = 0; i < axis.length; i++) {
    const d = axis[i];
    if (d < period.from) continue;
    if (d > period.to) break;
    if (out.length === 0 || bucket(d, every) !== bucket(axis[i - 1], every)) out.push(d);
  }
  return out;
}

/** 반등 조건의 패턴을 실제 entry로 해석한다. 꺼져 있으면 null */
export function resolveReboundEntry(criteria: SelectionCriteria, strategies: Strategy[]): Strategy['entry'] | null {
  const rb = criteria.conditions.rebound;
  if (!rb.on) return null;
  if (rb.pattern.from === 'custom') return rb.pattern.entry;
  const id = rb.pattern.strategyId;
  const s = strategies.find((x) => x.id === id);
  if (!s) throw new MissingStrategyError();
  return s.entry;
}

// 최근 window개 최대. 개수가 min 미만이면 null. 단조 덱으로 O(n)
function rollingMax(c: number[], window: number, min: number): (number | null)[] {
  const out: (number | null)[] = new Array(c.length);
  const dq: number[] = [];
  let head = 0;
  for (let i = 0; i < c.length; i++) {
    while (dq.length > head && c[dq[dq.length - 1]] <= c[i]) dq.pop();
    dq.push(i);
    if (dq[head] <= i - window) head++;
    out[i] = Math.min(i + 1, window) < min ? null : c[dq[head]];
  }
  return out;
}

// 최근 days개 일간 수익률(c[k]/c[k-1]−1)의 표본 표준편차(%). 창마다 새로 계산해 오차가 쌓이지 않게 한다
function rollingVol(c: number[], days: number): (number | null)[] {
  const r = c.map((x, k) => (k === 0 ? 0 : x / c[k - 1] - 1));
  return c.map((_, i) => {
    if (days < 2 || i < days) return null;
    let mean = 0;
    for (let k = i - days + 1; k <= i; k++) mean += r[k];
    mean /= days;
    let ss = 0;
    for (let k = i - days + 1; k <= i; k++) ss += (r[k] - mean) ** 2;
    return Math.sqrt(ss / (days - 1)) * 100;
  });
}

function signals(d: string[], st: FileStock, entry: Strategy['entry'] | null): { days: string[]; last: number[] } {
  const last = new Array<number>(d.length).fill(-1);
  if (!entry) return { days: [], last };
  const candles: Candle[] = d.map((x, i) => ({ t: kstEpoch(x, '00:00:00'), o: st.o[i], h: st.h[i], l: st.l[i], c: st.c[i], v: st.v[i] }));
  const tr = createPatternTracker(candles, entry);
  const days: string[] = [];
  let prev = -1;
  for (let i = 0; i < d.length; i++) {
    // 신호 발생만 본다. 매수 뒤 reset은 하지 않는다
    if (tr.signal(i)) {
      days.push(d[i]);
      prev = i;
    }
    tr.update(i);
    last[i] = prev;
  }
  return { days, last };
}

/** 종목마다 날짜순으로 지표를 한 번 계산한다(스펙 6.1). */
export function precompute(data: MarketDataFile, criteria: SelectionCriteria, reboundEntry: Strategy['entry'] | null): Precomputed {
  const k = criteria.conditions;
  const volDays = k.volatility.on ? k.volatility.days : RANK_VOL_DAYS;
  const stocks = data.stocks.map((st): StockSeries => {
    const d = st.d.map(isoDate);
    const close = st.c.slice();
    const sig = signals(d, st, reboundEntry);
    return {
      s: st.s,
      m: st.m,
      t: st.t,
      sec: st.sec,
      shares: st.shares,
      managed: st.managed,
      halted: st.halted,
      d,
      close,
      tvAvg: sma(st.tv, k.tradingValue.days),
      ma: k.vsMa.on ? sma(close, k.vsMa.period) : [],
      high: rollingMax(close, HIGH_WINDOW, HIGH_MIN),
      vol: rollingVol(close, volDays),
      signalDays: sig.days,
      lastSignal: sig.last,
    };
  });
  return { axis: tradingAxis(data), stocks };
}
