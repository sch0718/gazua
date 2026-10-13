import { addDays, kstWeekday } from '../time/kst';

export type TaxMarket = 'KOSPI' | 'KOSDAQ' | 'KR_ETC';

// [시작일(KST), KOSPI, KOSDAQ] — 위에서부터 첫 일치.
// 양도일(결제일) 기준. 증권거래세법 시행령 제5조·농어촌특별세법 제5조 연혁으로 2026-10-13 확인
const TAX_TABLE: readonly (readonly [string, number, number])[] = [
  ['2026-01-01', 0.2, 0.2],
  ['2025-01-01', 0.15, 0.15],
  ['2024-01-01', 0.18, 0.18],
  ['2023-01-01', 0.2, 0.2],
  ['2021-01-01', 0.23, 0.23],
  ['2019-06-03', 0.25, 0.25],
  ['0000-01-01', 0.3, 0.3],
];

export function sellTaxPct(date: string, market: TaxMarket, isEtf: boolean): number {
  if (isEtf || market === 'KR_ETC') return 0;
  const row = TAX_TABLE.find(([start]) => date >= start) ?? TAX_TABLE[TAX_TABLE.length - 1];
  return market === 'KOSPI' ? row[1] : row[2];
}

// KRX가 해마다 쉬는 날(연말 휴장일·신정). 그 밖의 공휴일은 모른다.
const KRX_FIXED_CLOSURES = new Set(['12-31', '01-01']);

/** 근사용 거래일: 토·일과 12-31·01-01이 아닌 날 */
function approxTradingDay(d: string): boolean {
  const w = kstWeekday(d);
  return w !== 0 && w !== 6 && !KRX_FIXED_CLOSURES.has(d.slice(5));
}

/** 근사 거래일 n일 뒤(토·일·12-31·01-01만 건너뜀, 다른 공휴일은 모름) */
function addWeekdays(date: string, n: number): string {
  let d = date;
  for (let left = n; left > 0; ) {
    d = addDays(d, 1);
    if (approxTradingDay(d)) left--;
  }
  return d;
}

/** 체결일 다음 2번째 거래일(T+2 결제일). 축 끝을 넘으면 남은 만큼을 근사 거래일(평일, 12-31·01-01 제외)로 더한다. */
export function settlementDate(tradeDate: string, days: string[]): string {
  // tradeDate 이상인 첫 거래일 위치 (이분 탐색)
  let lo = 0;
  let hi = days.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (days[mid] < tradeDate) lo = mid + 1;
    else hi = mid;
  }
  const target = lo + 2;
  if (target < days.length) return days[target];
  if (days.length === 0 || lo >= days.length) {
    // 축 밖이면 날짜 자체를 근사 거래일로 맞춘 뒤 +2
    let base = tradeDate;
    while (!approxTradingDay(base)) base = addDays(base, 1);
    return addWeekdays(base, 2);
  }
  return addWeekdays(days[days.length - 1], target - (days.length - 1));
}
