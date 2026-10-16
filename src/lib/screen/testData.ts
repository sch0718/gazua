// 테스트 전용: 손으로 만든 시장 데이터
import type { FlowSeries, MarketDataFile, MarketDataFileV2, MarketDataFileV3 } from '../marketData/format';
import { newStrategy } from '../sim/defaults';
import { tradingDates } from '../sim/testBars';
import type { Strategy } from '../sim/types';
import { kstEpoch } from '../time/kst';
import { newCriteria } from './defaults';
import type { SelectionCriteria } from './types';

export type Stock = MarketDataFile['stocks'][number];

export const NOW = kstEpoch('2026-10-16', '12:00:00');
/** 2025-01-02부터 평일 300개 */
export const DATES = tradingDates('2025-01-02', 300);
export const ymd = (d: string): string => d.replaceAll('-', '');

/** closes[i]가 null이면 DATES[i]에 봉이 없다. tv도 closes와 같은 길이로 준다. */
export function mkStock(
  s: string,
  closes: (number | null)[],
  o: Partial<Omit<Stock, 'd' | 'o' | 'h' | 'l' | 'c' | 'v' | 'tv'>> & { tv?: number[] } = {},
): Stock {
  const idx = closes.flatMap((c, i) => (c == null ? [] : [i]));
  const c = idx.map((i) => closes[i] as number);
  const { tv, ...meta } = o;
  return {
    s,
    n: s,
    m: 'KOSPI',
    t: 'STOCK',
    sec: ['00013', '', ''],
    shares: 1,
    managed: false,
    halted: false,
    ...meta,
    d: idx.map((i) => ymd(DATES[i])),
    o: [...c],
    h: [...c],
    l: [...c],
    c,
    v: c.map(() => 1),
    tv: tv ? idx.map((i) => tv[i]) : c.map(() => 1e9),
  };
}

/** 지수는 DATES 앞 n개 전부에 봉이 있다. */
export function mkFile(stocks: Stock[], n: number): MarketDataFile {
  const d = DATES.slice(0, n).map(ymd);
  return {
    format: 'gazua-market-data',
    version: 1,
    collectedAt: '2026-10-16T00:00:00+09:00',
    source: 'kis',
    adjusted: true,
    range: { from: DATES[0], to: DATES[n - 1] },
    sectors: [],
    stocks,
    indices: [{ id: 'KOSPI', d, o: d.map(() => 100), c: d.map(() => 100) }],
  };
}

/** 모든 조건을 끈 기준. 후보 범위는 두 시장의 주식, 관리종목 제외 */
export function offCriteria(): SelectionCriteria {
  const c = newCriteria(NOW, null);
  c.conditions.tradingValue.on = false;
  c.conditions.rebound.on = false;
  return c;
}

/** 하락 10% + 2일 연속 상승만 켠 패턴 */
export function reboundEntry(): Strategy['entry'] {
  const e = newStrategy(NOW, null).entry;
  e.decline = { dropPct: { on: true, value: 10 }, days: { on: false, value: 10 } };
  e.triggers.reboundDays = { on: true, value: 2 };
  e.triggers.breakout.on = false;
  e.triggers.maCross.on = false;
  e.triggers.goldenCross.on = false;
  e.filter.aboveMa.on = false;
  return e;
}

/** reboundEntry로 k번째 봉에서만 신호가 나는 종가(길이 n): 100…, 90, 80, 85, 90(k), 70… */
export function reboundAt(k: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => (i < k - 3 ? 100 : i > k ? 70 : [90, 80, 85, 90][i - (k - 3)]));
}

export function sampleStdPct(closes: number[]): number {
  const r = closes.slice(1).map((c, i) => c / closes[i] - 1);
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  return Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1)) * 100;
}

/** v1 파일에 macro·themes를 더한 v2 파일 */
export function mkFileV2(
  stocks: Stock[],
  n: number,
  macro: Partial<MarketDataFileV2['macro']> = {},
  themes: MarketDataFileV2['themes'] = [],
): MarketDataFileV2 {
  const empty = { d: [], v: [] };
  return { ...mkFile(stocks, n), version: 2, macro: { usdkrw: macro.usdkrw ?? empty, wti: macro.wti ?? empty }, themes };
}

export type FlowStock = Stock & { flow?: FlowSeries };

/** 종목에 수급을 붙인다. at은 그 종목 봉 인덱스(수급 시작), 세 배열은 같은 길이. 빠진 주체는 0 */
export function withFlow(st: Stock, at: number, net: { f?: number[]; i?: number[]; p?: number[] }): FlowStock {
  const len = (net.f ?? net.i ?? net.p)!.length;
  const z = () => Array<number>(len).fill(0);
  return { ...st, flow: { from: st.d[at], f: net.f ?? z(), i: net.i ?? z(), p: net.p ?? z() } };
}

/** v2 파일을 v3로: 종목마다 flow가 붙을 수 있다 */
export function mkFileV3(stocks: FlowStock[], n: number): MarketDataFileV3 {
  return { ...mkFileV2(stocks, n), version: 3, stocks };
}

/** from부터 미국 평일(토·일 제외) count개, YYYYMMDD */
export function usWeekdays(from: string, count: number): string[] {
  return tradingDates(from, count).map(ymd);
}

/** 재현 가능한 의사 난수 [0, 1) */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** 관측일 기준 짝짓기(스펙 2.3): 봉 날짜보다 앞선 마지막 관측값의 인덱스, 없으면 -1 */
export function obsBefore(obs: string[], barYmd: string): number {
  let k = -1;
  for (let i = 0; i < obs.length && obs[i] < barYmd; i++) k = i;
  return k;
}

/** 직접 계산한 OLS 기울기 cov(r, x) / var(x). 두 번 훑는 방식 */
export function olsSlope(r: number[], x: number[]): number {
  const n = r.length;
  const mr = r.reduce((a, b) => a + b, 0) / n;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let vx = 0;
  for (let i = 0; i < n; i++) {
    cov += (r[i] - mr) * (x[i] - mx);
    vx += (x[i] - mx) ** 2;
  }
  return cov / vx;
}
