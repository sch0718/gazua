// 공급자가 지원하는 거래소에 맞춘 실제 모드와, 현재가를 조회할 거래소.
import type { DaySession } from '../../market/sessions';
import { autoVenueAt, type Venue, type VenueMode } from '../../market/tradable';
import type { StockMeta } from '../../providers/types';

/** candleService와 같은 규칙: 자동은 KRX·NXT를 둘 다 줄 때만, 지원하지 않는 거래소는 통합으로. */
export function effectiveVenueMode(venues: readonly Venue[], requested: VenueMode): VenueMode {
  if (requested === 'AUTO') return venues.includes('KRX') && venues.includes('NXT') ? 'AUTO' : 'UNIFIED';
  return venues.includes(requested) ? requested : 'UNIFIED';
}

/**
 * 종목의 현재가 거래소. 자동이면 지금 시각에 KRX 우선 규칙이 고른 거래소(세션 밖이면 KRX),
 * NXT 미지원 종목의 NXT 모드는 KRX.
 */
export function quoteVenue(
  venues: readonly Venue[],
  requested: VenueMode,
  meta: StockMeta | undefined,
  sessions: DaySession[],
  now: number,
): Venue {
  const mode = effectiveVenueMode(venues, requested);
  if (mode === 'AUTO') return (meta && autoVenueAt(sessions, meta, now)) ?? 'KRX';
  if (mode === 'NXT' && meta && !meta.nxtSupported) return 'KRX';
  return mode;
}

const CYCLE: VenueMode[] = ['AUTO', 'KRX', 'NXT', 'UNIFIED'];

/** 단축키 `v`: 자동 → KRX → NXT → 통합 순으로, 공급자가 지원하지 않는 모드는 건너뛴다(토스는 통합에 머문다). */
export function nextVenueMode(venues: readonly Venue[], current: VenueMode): VenueMode {
  const supported = (m: VenueMode) => effectiveVenueMode(venues, m) === m;
  const from = CYCLE.indexOf(effectiveVenueMode(venues, current));
  for (let step = 1; step <= CYCLE.length; step++) {
    const m = CYCLE[(from + step) % CYCLE.length];
    if (supported(m)) return m;
  }
  return current;
}
