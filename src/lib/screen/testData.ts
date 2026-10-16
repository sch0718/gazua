// 테스트 전용: 손으로 만든 시장 데이터
import type { MarketDataFile } from '../marketData/format';
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
