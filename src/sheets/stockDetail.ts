// 종목 상세(스펙 7.3, 5.2–5.3)에 보일 값. 화면과 무관한 순수 함수.
import type { DaySession } from '../lib/market/sessions';
import { autoVenueAt, sessionLabelAt, tradableIntervals, type Venue, type VenueMode } from '../lib/market/tradable';
import type { Quote, StockMeta } from '../lib/providers/types';
import { kstDate } from '../lib/time/kst';
import type { SnapshotSeries } from '../lib/ui/compare/compareController.svelte';
import { kstHHMM, staleBadge } from '../lib/ui/compare/compareText';
import { effectiveVenueMode, quoteVenue } from '../lib/ui/compare/venue';
import { fmtWon } from '../lib/ui/format';

export interface DetailInput {
  meta: StockMeta | undefined;
  series: SnapshotSeries | null;
  /** 상세를 열 때 거래소마다 받은 현재가 */
  quotes: Partial<Record<Venue, Quote>>;
  /** 공급자가 주는 거래소 */
  venues: readonly Venue[];
  /** 설정의 거래소 모드 */
  venueMode: VenueMode;
  /** 오늘 세션(캘린더 반영) */
  sessions: DaySession[];
  isOpenToday: boolean;
  now: number;
}

export interface VenueCell {
  key: string;
  label: string;
  value: string;
  /** 큰 현재가가 이 거래소 가격이다 */
  current: boolean;
}

export interface TimetableRow {
  key: string;
  label: string;
  /** `HH:MM–HH:MM` */
  range: string;
  now: boolean;
}

export interface DetailView {
  sub: string;
  price: number | null;
  /** 시리즈 기준값 대비 % */
  change: number | null;
  /** 마지막 성공 결과를 보여 주는 중이면 그 배지 */
  stale: { text: string; label: string } | null;
  cells: VenueCell[];
  timetable: TimetableRow[];
  status: string;
}

const splitsVenues = (venues: readonly Venue[]) => venues.includes('KRX') && venues.includes('NXT');
const venueName = (v: Venue) => (v === 'UNIFIED' ? '통합' : v);
const inside = (s: { start: number; end: number }, t: number) => s.start <= t && t < s.end;
const price = (q: Quote | undefined) => (q ? fmtWon(q.price) : '—');

/**
 * 상세에서 현재가를 받을 거래소: KRX·NXT를 구분하는 공급자면 KRX(+지원 시 NXT), 아니면 통합.
 * 구분하는 공급자라도 통합을 주고 지금 모드가 통합이면 통합도 받는다(큰 현재가가 통합 시세).
 */
export function quoteVenuesFor(venues: readonly Venue[], nxtSupported: boolean, venueMode: VenueMode): Venue[] {
  if (!splitsVenues(venues)) return ['UNIFIED'];
  const out: Venue[] = nxtSupported ? ['KRX', 'NXT'] : ['KRX'];
  if (venues.includes('UNIFIED') && effectiveVenueMode(venues, venueMode) === 'UNIFIED') out.push('UNIFIED');
  return out;
}

/** 상태 칩과 같은 규칙: 세션 라벨, 아니면 장 시작 전·장 마감, 휴장. */
function marketText(sessions: DaySession[], now: number, isOpenToday: boolean): string {
  if (!isOpenToday) return '휴장';
  const current = sessionLabelAt(sessions, now);
  if (current) return current.label;
  const firstStart = sessions.length > 0 ? Math.min(...sessions.map((s) => s.start)) : -Infinity;
  return now < firstStart ? '장 시작 전' : '장 마감';
}

/** 세션 이름. 상태 칩·세션 시간표와 같은 라벨 표를 쓴다. */
const sessionName = (s: DaySession) => sessionLabelAt([s], s.start)?.label ?? `${s.venue} ${s.label}`;

function timetableOf(i: DetailInput): TimetableRow[] {
  if (!i.meta || !i.isOpenToday) return [];
  return tradableIntervals(i.sessions, i.meta, 'AUTO').map((iv) => {
    const session = i.sessions.find((s) => s.venue === iv.venue && s.kind === iv.kind && inside(s, iv.start));
    const label = session ? sessionName(session) : iv.venue;
    return {
      key: `${iv.venue}:${iv.start}`,
      label,
      range: `${kstHHMM(iv.start)}–${kstHHMM(iv.end)}`,
      now: inside(iv, i.now),
    };
  });
}

/**
 * KRX 정규 종가. 오늘 정규장(종가 단일가까지) 중이면 'live', 끝났으면 오늘 KRX 일봉 종가,
 * 장 시작 전이나 휴장일이면 직전 거래일 종가. 시리즈 일봉이 KRX가 아니면 null.
 */
function regularCloseOf(i: DetailInput, dailyIsKrx: boolean): number | 'live' | null {
  const today = kstDate(i.now);
  const regular = i.sessions.filter((s) => s.venue === 'KRX' && (s.label === 'regular' || s.label === 'closing-auction'));
  if (i.isOpenToday && regular.length > 0) {
    const start = Math.min(...regular.map((s) => s.start));
    const end = Math.max(...regular.map((s) => s.end));
    if (start <= i.now && i.now < end) return 'live';
    if (i.now >= end) {
      if (!dailyIsKrx) return null;
      return i.series?.daily.find((c) => kstDate(c.t) === today)?.c ?? null;
    }
  }
  if (!dailyIsKrx) return null;
  return i.series?.daily.filter((c) => kstDate(c.t) < today).at(-1)?.c ?? null;
}

/** 오늘 이 종목의 KRX 애프터마켓이 시작됐는지(ETF·ETN은 KRX 애프터가 없다). */
function krxAfterStarted(i: DetailInput): boolean {
  if (!i.isOpenToday || !i.meta) return false;
  const type = i.meta.securityType;
  const after = i.sessions.find((s) => s.venue === 'KRX' && s.label === 'after' && !s.excludes?.includes(type));
  return after !== undefined && i.now >= after.start;
}

function statusOf(meta: StockMeta | undefined): string {
  if (!meta) return '—';
  const parts: string[] = [];
  if (meta.krxSuspended) parts.push('KRX 거래정지');
  if (meta.nxtSuspended === true) parts.push('NXT 거래정지');
  if (meta.liquidationTrading) parts.push('정리매매');
  return parts.length > 0 ? parts.join(' · ') : '정상 거래';
}

export function detailView(i: DetailInput): DetailView {
  const { meta, series } = i;
  const mode = effectiveVenueMode(i.venues, i.venueMode);
  const priceVenue = quoteVenue(i.venues, i.venueMode, meta, i.sessions, i.now);
  // 자동 모드에서 지금 접속매매 중인 거래소가 없으면 `지금 … 가격`을 쓰지 않는다.
  const nowVenue = mode === 'AUTO' ? (meta && i.isOpenToday ? autoVenueAt(i.sessions, meta, i.now) : null) : priceVenue;
  const sub = [
    marketText(i.sessions, i.now, i.isOpenToday),
    nowVenue ? `지금 ${venueName(nowVenue)} 가격` : null,
    mode === 'AUTO' ? '자동(KRX 우선)' : null,
  ]
    .filter((x) => x !== null)
    .join(' · ');

  const lastClose = series?.candles.at(-1)?.c ?? null;
  // 마지막 성공 결과에는 새 시세를 섞지 않는다(리더보드와 같은 규칙).
  const big = series?.stale ? lastClose : (i.quotes[priceVenue]?.price ?? lastClose);
  const base = series?.base ?? null;
  const change = big !== null && base ? (big / base - 1) * 100 : null;

  let cells: VenueCell[];
  if (splitsVenues(i.venues)) {
    // 시리즈 일봉은 NXT 모드의 NXT 지원 종목만 NXT다.
    const dailyIsKrx = !(mode === 'NXT' && meta?.nxtSupported);
    const close = regularCloseOf(i, dailyIsKrx);
    cells = [
      { key: 'close', label: 'KRX 정규 종가', value: close === 'live' ? '장중' : close === null ? '—' : fmtWon(close), current: false },
      { key: 'KRX', label: krxAfterStarted(i) ? 'KRX 애프터' : 'KRX 현재', value: price(i.quotes.KRX), current: priceVenue === 'KRX' },
      {
        key: 'NXT',
        label: 'NXT',
        value: meta && !meta.nxtSupported ? '미지원' : meta?.nxtSuspended ? '거래정지' : price(i.quotes.NXT),
        current: priceVenue === 'NXT',
      },
    ];
    // 통합 모드면 큰 현재가가 통합 시세다. 그 칸을 더해 지금 거래소로 표시한다.
    if (priceVenue === 'UNIFIED' && i.venues.includes('UNIFIED')) {
      cells.push({ key: 'UNIFIED', label: '통합', value: price(i.quotes.UNIFIED), current: true });
    }
  } else {
    cells = [{ key: 'UNIFIED', label: '통합', value: price(i.quotes.UNIFIED), current: true }];
  }

  return {
    sub,
    price: big,
    change,
    stale: series?.stale ? staleBadge(series.computedAt, i.now) : null,
    cells,
    timetable: timetableOf(i),
    status: statusOf(meta),
  };
}
