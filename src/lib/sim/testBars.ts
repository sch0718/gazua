// 테스트 전용 봉 생성 도우미
import type { Candle } from '../data/metrics';
import { addDays, kstEpoch, kstWeekday } from '../time/kst';

/** start부터 주말을 건너뛴 n개의 날짜 (start가 평일이면 포함) */
export function tradingDates(start: string, n: number): string[] {
  const out: string[] = [];
  let d = start;
  while (out.length < n) {
    const w = kstWeekday(d);
    if (w !== 0 && w !== 6) out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

export function bar(date: string, o: number, h: number, l: number, c: number): Candle {
  return { t: kstEpoch(date, '00:00:00'), o, h, l, c, v: 0 };
}

/** o=h=l=c인 일봉, t = KST 자정 */
export function barsFromCloses(closes: number[], start = '2026-01-05'): Candle[] {
  const dates = tradingDates(start, closes.length);
  return closes.map((c, i) => bar(dates[i], c, c, c, c));
}
