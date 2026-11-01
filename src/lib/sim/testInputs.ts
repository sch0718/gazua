// 테스트 전용: 엔진 골든·timeline·성능 테스트가 같이 쓰는 대표 입력과 봉 생성 도우미.
import type { Candle } from '../data/metrics';
import { newStrategy } from './defaults';
import { bar, tradingDates } from './testBars';
import type { SimInput, Strategy } from './types';

/** [시가, 고가, 저가, 종가] */
export type Ohlc = [number, number, number, number];

/** 2026-01-05부터 평일 40일. D[9] = 2026-01-16 */
export const D = tradingDates('2026-01-05', 40);
/** 인덱스 8 종가에서 '3일 연속 상승' 신호(A=100, L=80) → 인덱스 9 시가 매수 */
export const BASE = [90, 100, 92, 95, 88, 80, 82, 84, 86];

/** 앞부분은 o=h=l=c 종가, 뒤는 [o,h,l,c] 봉. skip 인덱스는 봉을 뺀다(거래 정지일) */
export function candlesFrom(closes: number[], rest: Ohlc[] = [], skip: number[] = []): Candle[] {
  const all: Ohlc[] = [...closes.map((c): Ohlc => [c, c, c, c]), ...rest];
  return all.flatMap(([o, h, l, c], i) => (skip.includes(i) ? [] : [bar(D[i], o, h, l, c)]));
}

export const flat = (xs: number[]): Ohlc[] => xs.map((c): Ohlc => [c, c, c, c]);

/** 자금 1,000만 원, 회당 10%, 수수료 0.015%, 돌파 끔, 손절 5% 매번 평단 */
export function baseStrategy(over: (s: Strategy) => void = () => {}): Strategy {
  const s = newStrategy(0, null);
  s.capital = { initial: 10_000_000, perBuyPct: 10 };
  s.costs.feePct = 0.015;
  s.entry.triggers.breakout.on = false;
  s.exit.stopLoss = { pct: 5, basis: 'avgAlways' };
  over(s);
  return s;
}

export function stockOf(k: number, candles: Candle[]): SimInput['stocks'][number] {
  return { symbol: `S${k}`, name: `종목${k}`, market: 'KOSPI', isEtf: false, candles };
}

/** 엔진 동일성을 고정하는 대표 입력(설계 §2.3). 부를 때마다 새 객체를 만든다 */
export const goldenInputs = {
  /** (가) 분할 매수 2번 → 1·2단계 익절 → 본전 손절 */
  '분할 매수 + 3단계 익절 + 본전 손절': (): SimInput => {
    const strategy = baseStrategy((x) => {
      x.scaleIn = { on: true, stepPct: 3, maxAdds: 2 };
      x.exit.stopLoss = { pct: 5, basis: 'avgAfterScaleIn' };
      x.exit.takeProfit = [{ pct: 5, sellPct: 30 }, { pct: 10, sellPct: 30 }, { pct: 15, sellPct: 100 }];
      x.exit.afterFirstTake = 'breakeven';
    });
    const rest: Ohlc[] = [[100, 100, 96, 97], [97, 98, 94, 95], [95, 103, 95, 102], [102, 108, 101, 107], [107, 110, 96, 98], ...flat([98, 99])];
    return { strategy, days: D.slice(0, 16), stocks: [stockOf(0, candlesFrom(BASE, rest))], index: null, benchmarkStock: null };
  },
  /** (나) 회당 60%: S0 매수 → 거래 정지 2일(인덱스 11·12) → 갭 손절, S1은 현금 부족으로 계속 건너뜀 */
  '갭 손절 + 현금 부족 + 봉 없는 날': (): SimInput => {
    const strategy = baseStrategy((x) => (x.capital.perBuyPct = 60));
    const s0 = candlesFrom(BASE, [[87, 88, 86, 87], [88, 89, 87, 88], [0, 0, 0, 0], [0, 0, 0, 0], [80, 81, 79, 80], [80, 80, 80, 80]], [11, 12]);
    const s1 = candlesFrom(BASE, [[87, 88, 86, 87], [88, 89, 87, 88], [89, 90, 88, 89], [90, 91, 89, 90], ...flat([90, 90])]);
    return { strategy, days: D.slice(0, 15), stocks: [stockOf(0, s0), stockOf(1, s1)], index: null, benchmarkStock: null };
  },
  /** (다) S0은 선정 기간 밖이라 건너뛰고 S1만 사서 익절. 지수·지정 종목 곡선 포함 */
  '선정 기간 + 지수·지정 종목': (): SimInput => {
    const strategy = baseStrategy((x) => (x.exit.takeProfit = [{ pct: 5, sellPct: 100 }]));
    const rest: Ohlc[] = [[87, 88, 86, 87], [88, 95, 88, 94], ...flat([94, 95])];
    const days = D.slice(0, 13);
    const s0 = { ...stockOf(0, candlesFrom(BASE, rest)), buyWindows: [{ from: D[0], to: D[8] }] };
    const s1Candles = candlesFrom(BASE, rest);
    const s1 = { ...stockOf(1, s1Candles), buyWindows: [{ from: D[9], to: D[20] }] };
    return {
      strategy,
      days,
      stocks: [s0, s1],
      index: { id: 'KOSPI', candles: days.map((dt, i) => bar(dt, 1000, 1000, 1000, 1000 + i * 10)) },
      benchmarkStock: { symbol: 'B', name: '지정', isEtf: true, market: 'KOSPI', candles: s1Candles },
    };
  },
} satisfies Record<string, () => SimInput>;

/** 시드 고정 난수(mulberry32) */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 날짜마다 무작위 일봉(하루 ±4% 안팎) */
export function randomWalk(dates: string[], seed: number, start = 10_000): Candle[] {
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
