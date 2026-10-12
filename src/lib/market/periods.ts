import type { Period, PeriodUnit } from '../state/schema';
import { addDays } from '../time/kst';

export const PERIOD_COUNTS: Record<PeriodUnit, number[]> = {
  D: [1],
  W: [1, 2, 3, 4],
  M: [1, 2, 3, 4, 5, 6],
  Y: [1],
};

/** 날짜는 모두 `YYYY-MM-DD`(KST) */
export interface FetchPlan {
  interval: '1m' | '1d';
  from: string;
  to: string;
  /** RVOL 20거래일 평균·기준 종가 확보용으로 `from`보다 앞선 조회 시작일 */
  lookbackFrom: string;
  /** 일별 마커(점)를 그릴지 — 봉이 적은 W1~W4만 */
  markers: boolean;
}

const LOOKBACK_DAYS = 40;
const ORDER: Period[] = (['D', 'W', 'M', 'Y'] as const).flatMap((unit) =>
  PERIOD_COUNTS[unit].map((n) => ({ unit, n })),
);

/** 달력 개월 빼기. 대상 달에 해당 일이 없으면 그 달 말일로 맞춘다. */
function subtractMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const total = y * 12 + (m - 1) - months;
  const ty = Math.floor(total / 12);
  const tm = total % 12;
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const p = (v: number, w = 2) => String(v).padStart(w, '0');
  return `${p(ty, 4)}-${p(tm + 1)}-${p(Math.min(d, lastDay))}`;
}

function startOf(p: Period, last: string): string {
  switch (p.unit) {
    case 'D':
      return last;
    case 'W':
      return addDays(last, -7 * p.n + 1);
    case 'M':
      return addDays(subtractMonths(last, p.n), 1);
    case 'Y':
      return addDays(subtractMonths(last, 12 * p.n), 1);
  }
}

export function fetchPlanFor(p: Period, lastTradingDay: string): FetchPlan {
  const from = startOf(p, lastTradingDay);
  return {
    interval: p.unit === 'D' ? '1m' : '1d',
    from,
    to: lastTradingDay,
    lookbackFrom: addDays(from, -LOOKBACK_DAYS),
    markers: p.unit === 'W',
  };
}

/** 단축키 `[` `]` 순서: D1, W1..W4, M1..M6, Y1. 양 끝에서는 멈춘다. */
export function stepPeriod(p: Period, dir: -1 | 1): Period {
  const i = ORDER.findIndex((o) => o.unit === p.unit && o.n === p.n);
  if (i < 0) throw new RangeError(`unknown period: ${p.unit}${p.n}`);
  const next = ORDER[Math.min(ORDER.length - 1, Math.max(0, i + dir))];
  return { unit: next.unit, n: next.n };
}
