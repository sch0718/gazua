import type { Candle } from '../data/metrics';
import { kstDate } from '../time/kst';
import { roundMoney } from './money';
import { costOf, maxShares } from './position';
import type { SimInput } from './types';

/** days 안의 날짜별 봉 */
function barsByDate(candles: Candle[], days: string[]): Map<string, Candle> {
  const set = new Set(days);
  const m = new Map<string, Candle>();
  for (const k of candles) {
    const d = kstDate(k.t);
    if (set.has(d)) m.set(d, k);
  }
  return m;
}

/** 한 종목에 slice를 넣고 첫 봉 시가에 사서 들고 가는 곡선. 첫 봉 전과 못 산 경우는 현금 */
function buyAndHold(days: string[], candles: Candle[], slice: number, feePct: number): number[] {
  const byDate = barsByDate(candles, days);
  let cash = slice;
  let qty = 0;
  let bought = false;
  let lastClose: number | null = null;
  return days.map((day) => {
    const b = byDate.get(day);
    if (b) {
      if (!bought) {
        bought = true;
        qty = maxShares(slice, b.o, feePct);
        cash = roundMoney(slice - costOf(qty, b.o, feePct));
      }
      lastClose = b.c;
    }
    return cash + (lastClose === null ? 0 : roundMoney(qty * lastClose)); // 합친 뒤 호출자가 반올림(못 산 몫의 나머지를 잃지 않게)
  });
}

export function holdCurve(days: string[], stocks: SimInput['stocks'], initial: number, feePct: number): number[] {
  if (stocks.length === 0) return days.map(() => initial);
  const slice = initial / stocks.length; // 나머지를 잃지 않게 반올림하지 않는다. maxShares가 예산을 스스로 반올림한다
  const curves = stocks.map((s) => buyAndHold(days, s.candles, slice, feePct));
  return days.map((_, i) => roundMoney(curves.reduce((sum, c) => sum + c[i], 0)));
}

export function singleCurve(days: string[], candles: Candle[], initial: number, feePct: number): number[] {
  return buyAndHold(days, candles, initial, feePct).map(roundMoney);
}

/** 첫날·마지막 날 봉이 없으면 null (스펙 6.1). 중간에 빠진 날은 직전 값 */
export function indexCurve(days: string[], candles: Candle[], initial: number): number[] | null {
  if (days.length === 0) return null;
  const byDate = barsByDate(candles, days);
  const first = byDate.get(days[0]);
  if (!first || !byDate.has(days[days.length - 1])) return null;
  let prev = initial;
  return days.map((day) => {
    const b = byDate.get(day);
    if (b) prev = (initial * b.c) / first.o;
    return prev;
  });
}
