// 비교 화면이 불러온 상태에서 뽑아 쓰는 값들(순수 함수).
import type { LoadedSeries } from '../../data/candleService';
import { sessionsForDay, type DaySession } from '../../market/sessions';
import { autoVenueAt, type TradableMeta } from '../../market/tradable';
import { kstDate } from '../../time/kst';
import type { IndexEntry } from './compareController.svelte';

/** `예시 그룹 불러오기`: 반도체 대형주 4종 */
export const EXAMPLE_SYMBOLS = ['005930', '000660', '042700', '000990'];

/** 자동 모드 칩의 `지금 거래소`: NXT에도 상장된 일반 주식 기준(시장 전체). */
const MARKET_WIDE: TradableMeta = { securityType: 'STOCK', nxtSupported: true, krxSuspended: false, nxtSuspended: null };

export function marketAutoVenue(sessions: DaySession[], now: number): 'KRX' | 'NXT' | null {
  return autoVenueAt(sessions, MARKET_WIDE, now);
}

/** 차트가 보여 주는 날의 세션. 오늘이면 캘린더를 반영한 세션, 지난 날이면 기본 시간표. */
export function sessionsOn(date: string, today: string, todaySessions: DaySession[]): DaySession[] {
  if (date === today) return todaySessions;
  try {
    return sessionsForDay({ date, isOpen: true });
  } catch {
    return [];
  }
}

export function lastSessionEnd(sessions: DaySession[]): number | null {
  return sessions.length === 0 ? null : Math.max(...sessions.map((s) => s.end));
}

/**
 * 차트가 보여 주는 거래일. 1일(분봉)은 불러온 시리즈 중 가장 최근 거래일(갱신에 실패해 전 거래일 결과를 쓰는 종목이
 * 있어도 오늘 분봉 격자를 쓴다). 일봉은 첫 시리즈의 거래일.
 */
export function chartTradingDate(loaded: Pick<LoadedSeries, 'tradingDate'>[], mode: 'intraday' | 'daily'): string | null {
  if (loaded.length === 0) return null;
  if (mode === 'daily') return loaded[0].tradingDate;
  return loaded.reduce((latest, s) => (s.tradingDate > latest ? s.tradingDate : latest), loaded[0].tradingDate);
}

/** 일봉 차트 X축의 거래일: 불러온 종목 봉 날짜의 합집합. */
export function openDaysOf(series: LoadedSeries[]): string[] {
  return [...new Set(series.flatMap((s) => s.candles.map((c) => kstDate(c.t))))].sort();
}

/** indexAvailabilityFor의 indexLoad. 받는 중이거나 아직 요청 전이면 ok로 본다. */
export function indexLoadOf(entries: (IndexEntry | undefined)[]): 'ok' | 'failed' | 'null' {
  if (entries.some((e) => e?.status === 'failed')) return 'failed';
  if (entries.some((e) => e?.status === 'null')) return 'null';
  return 'ok';
}

/**
 * 다시 받기에 실패해 이전 지수를 쓰는 중이면 그 지수 중 가장 오래된 계산 시각. 없으면 null.
 * 초과수익은 끄지 않고(지표가 깜박이지 않게) 헤드라인 아래에 `지수는 HH:MM 기준이에요`로 알린다.
 */
export function staleIndexAt(entries: (IndexEntry | undefined)[]): number | null {
  let oldest: number | null = null;
  for (const e of entries) {
    if (!e?.stale || !e.series) continue;
    if (oldest === null || e.series.computedAt < oldest) oldest = e.series.computedAt;
  }
  return oldest;
}
