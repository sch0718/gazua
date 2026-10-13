// 비교 화면 문구(스펙 7.2, 4.4). 모든 시각은 KST.
import type { LoadedSeries } from '../../data/candleService';
import type { MetricId, Period } from '../../state/schema';
import { kstDate, kstMinuteOfDay, kstWeekday } from '../../time/kst';
import { fmtPct, fmtTrillion } from '../format';

export type MetricUnit = '%' | 'x' | '조' | '';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const pad = (n: number) => String(n).padStart(2, '0');

const parts = (ms: number) => {
  const m = kstMinuteOfDay(ms);
  return { h: Math.floor(m / 60), m: m % 60, s: Math.floor(ms / 1000) % 60 };
};

/** KST `HH:MM` */
export function kstHHMM(ms: number): string {
  const p = parts(ms);
  return `${pad(p.h)}:${pad(p.m)}`;
}

/** KST `HH:MM:SS` */
export function kstHHMMSS(ms: number): string {
  return `${kstHHMM(ms)}:${pad(parts(ms).s)}`;
}

/** `YYYY-MM-DD` → `M/D` */
export function monthDay(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d}`;
}

/** `YYYY-MM-DD` → `M/D(요일)` */
export function monthDayWeekday(date: string): string {
  return `${monthDay(date)}(${WEEKDAYS[kstWeekday(date)]})`;
}

/** `2주`·`3개월`·`1년`. 1일은 `오늘`이 아니라 `1일`. */
export function periodLabel(p: Period): string {
  return `${p.n}${{ D: '일', W: '주', M: '개월', Y: '년' }[p.unit]}`;
}

/** 헤드라인 첫 줄. 스크럽 중이면 그 시각(1일)이나 날짜(일봉). */
export function headlineLabel(a: {
  period: Period;
  metricLabel: string;
  scrubT: number | null;
  /** 차트가 보여 주는 거래일. 아직 모르면 null */
  tradingDate: string | null;
  today: string;
  /** 일봉 기간의 기준 종가 날짜 */
  baseDate: string | null;
}): string {
  const { period, metricLabel: metric, scrubT } = a;
  const intraday = period.unit === 'D';
  if (scrubT !== null) return `${intraday ? kstHHMM(scrubT) : monthDay(kstDate(scrubT))} · ${metric}`;
  if (intraday) {
    if (a.tradingDate !== null && a.tradingDate !== a.today) return `${monthDayWeekday(a.tradingDate)} · ${metric}`;
    return `오늘 · ${metric} · 기준 전일 종가`;
  }
  const base = a.baseDate ? ` · 기준 ${monthDay(a.baseDate)} 종가` : '';
  return `${periodLabel(period)} · ${metric}${base}`;
}

export const STALE_NOTE = '일부 종목은 이전 데이터예요';
export const FAILED_NOTE = '새로 받지 못했어요';

/** 신선도 줄. live면 앞에 ●, 아니면 ◌를 붙여 보여 준다. */
export function freshnessText(a: {
  now: number;
  inSession: boolean;
  tradingDate: string | null;
  today: string;
  /** 보여 주는 거래일의 마지막 세션 끝(epoch ms) */
  closeAt: number | null;
  anyStale: boolean;
  /** 마지막 로딩에서 새로 받은 종목이 하나도 없다. 그러면 장중이어도 ● 실시간을 보이지 않는다. */
  loadFailed?: boolean;
  /** 마지막으로 새 데이터를 받은 시각 */
  lastOkAt?: number | null;
}): { live: boolean; text: string } {
  const stale = a.anyStale ? ` · ${STALE_NOTE}` : '';
  if (a.inSession && a.loadFailed) {
    const since = a.lastOkAt == null ? '' : `${kstHHMM(a.lastOkAt)} 기준 · `;
    return { live: false, text: `${since}${FAILED_NOTE}` };
  }
  if (a.inSession) return { live: true, text: `실시간 ${kstHHMMSS(a.now)}${stale}` };
  if (a.tradingDate === null) return { live: false, text: stale.replace(/^ · /, '') };
  const until = a.closeAt === null ? a.now : Math.min(a.now, a.closeAt);
  if (a.tradingDate === a.today) return { live: false, text: `${kstHHMM(until)} 기준 (장 마감)${stale}` };
  return { live: false, text: `${monthDay(a.tradingDate)} ${kstHHMM(until)} 기준${stale}` };
}

/** 마지막 성공 결과를 보여 주는 행의 배지와 스크린리더 문구. */
export function staleBadge(computedAt: number, now: number): { text: string; label: string } {
  const date = kstDate(computedAt);
  if (date !== kstDate(now)) {
    const [, m, d] = date.split('-').map(Number);
    return { text: `${monthDay(date)} 기준`, label: `${m}월 ${d}일 기준 데이터, 새로 받지 못했어요` };
  }
  const p = parts(computedAt);
  return { text: `${kstHHMM(computedAt)} 기준`, label: `${p.h}시 ${p.m}분 기준 데이터, 새로 받지 못했어요` };
}

/** 1일 차트와 다른(이전) 거래일의 결과를 보여 주는 행의 배지. 그 종목은 차트에 그리지 않는다. */
export function prevDayBadge(tradingDate: string): { text: string; label: string } {
  const [, m, d] = tradingDate.split('-').map(Number);
  return {
    text: `${monthDay(tradingDate)} 거래일 값`,
    label: `${m}월 ${d}일 거래일 값이에요, 이번 거래일 데이터를 새로 받지 못했어요`,
  };
}

/** 지수 일봉에 종목 기준일의 종가가 없어 초과수익을 비워 둘 때 헤드라인 아래 안내. */
export const INDEX_BASE_MISSING_NOTE = '지수 기준일 값이 없어 초과수익을 계산할 수 없어요';

/** 이전 지수로 초과수익을 계산하는 중일 때 헤드라인 아래 안내. */
export function indexStaleNote(computedAt: number, now: number): string {
  const date = kstDate(computedAt);
  const day = date === kstDate(now) ? '' : `${monthDay(date)} `;
  return `지수는 ${day}${kstHHMM(computedAt)} 기준이에요`;
}

/** 1일 RVOL 분모가 분봉과 다른 거래소(KRX)의 일평균일 때 헤드라인 아래 안내. */
export const RVOL_KRX_BASE_NOTE = 'KRX 20일 평균 거래량 대비예요';

/**
 * 1일 RVOL에서 분모를 낸 거래소(avgVolumeVenue)와 다른 거래소의 분봉이 섞인 종목이 있으면 안내 문구.
 * 자동 모드(NXT 프리·애프터 + KRX)나 같은 거래소 일봉이 모자라 KRX로 대체했을 때다.
 */
export function rvolBaseNote(a: {
  metric: MetricId;
  period: Period;
  series: Pick<LoadedSeries, 'avgVolumeVenue' | 'avgDailyVolume' | 'segments'>[];
}): string | null {
  if (a.metric !== 'rvol' || a.period.unit !== 'D') return null;
  const mixed = a.series.some((s) => s.avgDailyVolume !== null && s.segments.some((seg) => seg.venue !== s.avgVolumeVenue));
  return mixed ? RVOL_KRX_BASE_NOTE : null;
}

/** 리더보드 지표 값. %는 ▲▼ 기호와 함께. */
export function formatMetricValue(v: number, unit: MetricUnit): string {
  switch (unit) {
    case '%':
      return fmtPct(v);
    case 'x':
      return `${v.toFixed(2)}x`;
    case '조':
      return fmtTrillion(v);
    default:
      return v.toFixed(2);
  }
}
