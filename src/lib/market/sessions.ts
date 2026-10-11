import { kstEpoch } from '../time/kst';
import { SCHEDULES } from './sessions.config';

export type ExchangeVenue = 'KRX' | 'NXT';
export type SessionKind = 'continuous' | 'auction';
export type SessionLabel =
  | 'pre'
  | 'opening-auction'
  | 'regular'
  | 'closing-auction'
  | 'after-auction'
  | 'after';
export type SecurityType = 'STOCK' | 'ETF' | 'ETN' | 'REIT' | 'OTHER';

/** 시간표상의 세션. start/end는 KST 'HH:MM:SS'. */
export interface SessionDef {
  venue: ExchangeVenue;
  kind: SessionKind;
  label: SessionLabel;
  start: string;
  end: string;
  excludes?: SecurityType[];
}

export interface SessionSchedule {
  effectiveFrom: string;
  sessions: SessionDef[];
}

/** 거래일 캘린더 항목. integrated의 값은 epoch ms. */
export interface TradingDay {
  date: string;
  isOpen: boolean;
  integrated?: { preStart?: number; regularStart?: number; afterEnd?: number };
}

/** 특정 날짜에 실제로 열리는 세션. epoch ms, [start, end). */
export interface DaySession extends Omit<SessionDef, 'start' | 'end'> {
  start: number;
  end: number;
}

const BASE_REGULAR_START = '09:00:00';

/** `effectiveFrom <= date`인 시간표 중 가장 늦은 것. 없으면 throw. */
export function scheduleFor(date: string): SessionSchedule {
  let found: SessionSchedule | undefined;
  for (const s of SCHEDULES) {
    if (s.effectiveFrom <= date && (!found || s.effectiveFrom > found.effectiveFrom)) found = s;
  }
  if (!found) throw new Error(`no session schedule in effect on ${date}`);
  return found;
}

/**
 * 날짜의 세션 목록(epoch ms). 휴장일이면 빈 배열.
 * 캘린더의 regularStart가 09:00이 아니면 모든 세션을 같은 만큼 민 뒤,
 * afterEnd가 있으면 그 시각으로 끝을 자르고 그 시각 이후에 시작하는 세션은 버린다.
 */
export function sessionsForDay(day: TradingDay): DaySession[] {
  if (!day.isOpen) return [];

  const shift =
    day.integrated?.regularStart !== undefined
      ? day.integrated.regularStart - kstEpoch(day.date, BASE_REGULAR_START)
      : 0;
  const afterEnd = day.integrated?.afterEnd;

  const result: DaySession[] = [];
  for (const def of scheduleFor(day.date).sessions) {
    const { start: startText, end: endText, ...rest } = def;
    const start = kstEpoch(day.date, startText) + shift;
    let end = kstEpoch(day.date, endText) + shift;
    if (afterEnd !== undefined) {
      if (start >= afterEnd) continue;
      end = Math.min(end, afterEnd);
    }
    result.push({ ...rest, start, end });
  }
  return result;
}
