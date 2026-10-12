import type { DaySession, ExchangeVenue, SecurityType } from './sessions';

export type Venue = 'KRX' | 'NXT' | 'UNIFIED';
export type VenueMode = 'AUTO' | Venue;

export interface TradableMeta {
  securityType: SecurityType;
  nxtSupported: boolean;
  krxSuspended: boolean;
  nxtSuspended: boolean | null;
}

export interface TradeInterval {
  start: number;
  end: number;
  venue: Venue;
  kind: 'continuous' | 'auction';
  fallback?: boolean;
}

const inSession = (s: DaySession, t: number) => s.start <= t && t < s.end;

function krxApplies(meta: TradableMeta): boolean {
  return !meta.krxSuspended;
}

function nxtApplies(meta: TradableMeta): boolean {
  return meta.nxtSupported && meta.nxtSuspended !== true;
}

/** 종목 유형·거래정지·NXT 지원 여부를 반영해 이 종목에 적용되는 세션만 남긴다. */
function applicable(sessions: DaySession[], meta: TradableMeta, venues: ExchangeVenue[]): DaySession[] {
  return sessions.filter(
    (s) =>
      venues.includes(s.venue) &&
      (s.venue === 'KRX' ? krxApplies(meta) : nxtApplies(meta)) &&
      !s.excludes?.includes(meta.securityType),
  );
}

/**
 * 같은 시각에 겹치는 세션 중 하나를 고른다.
 * 우선순위: KRX 접속매매 > NXT 접속매매 > KRX 단일가 > NXT 단일가.
 */
function pickByPriority(active: DaySession[]): DaySession | undefined {
  const find = (venue: ExchangeVenue, kind: DaySession['kind']) =>
    active.find((s) => s.venue === venue && s.kind === kind);
  return (
    find('KRX', 'continuous') ??
    find('NXT', 'continuous') ??
    find('KRX', 'auction') ??
    find('NXT', 'auction')
  );
}

/** 자동 선택: KRX 접속매매 중이면 KRX, 아니면 NXT 접속매매 중이면 NXT, 아니면 null. */
export function autoVenueAt(sessions: DaySession[], meta: TradableMeta, t: number): 'KRX' | 'NXT' | null {
  const active = applicable(sessions, meta, ['KRX', 'NXT']).filter(
    (s) => s.kind === 'continuous' && inSession(s, t),
  );
  return pickByPriority(active)?.venue ?? null;
}

type Resolve = (active: DaySession[]) => Omit<TradeInterval, 'start' | 'end'> | null;

/** 세션 경계로 시간축을 잘라 구간마다 resolve로 평가하고, 인접한 동일 구간은 합친다. */
function sweep(pool: DaySession[], resolve: Resolve): TradeInterval[] {
  const bounds = [...new Set(pool.flatMap((s) => [s.start, s.end]))].sort((a, b) => a - b);
  const result: TradeInterval[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const start = bounds[i];
    const end = bounds[i + 1];
    const picked = resolve(pool.filter((s) => inSession(s, start)));
    if (!picked) continue;
    const last = result.at(-1);
    if (
      last &&
      last.end === start &&
      last.venue === picked.venue &&
      last.kind === picked.kind &&
      last.fallback === picked.fallback
    ) {
      last.end = end;
    } else {
      result.push({ start, end, ...picked });
    }
  }
  return result;
}

const byPriority: Resolve = (active) => {
  const s = pickByPriority(active);
  return s ? { venue: s.venue, kind: s.kind } : null;
};

/** 모드별 거래 가능 구간. 거래할 수 없는 구간은 포함하지 않고, 시간순으로 정렬한다. */
export function tradableIntervals(sessions: DaySession[], meta: TradableMeta, mode: VenueMode): TradeInterval[] {
  switch (mode) {
    case 'AUTO':
      return sweep(applicable(sessions, meta, ['KRX', 'NXT']), byPriority);
    case 'KRX':
      return sweep(applicable(sessions, meta, ['KRX']), byPriority);
    case 'NXT': {
      if (meta.nxtSupported) return sweep(applicable(sessions, meta, ['NXT']), byPriority);
      // NXT 미지원 종목: KRX 구간으로 대체하고 표시한다.
      return sweep(applicable(sessions, meta, ['KRX']), (active) => {
        const picked = byPriority(active);
        return picked ? { ...picked, fallback: true } : null;
      });
    }
    case 'UNIFIED':
      return sweep(applicable(sessions, meta, ['KRX', 'NXT']), (active) =>
        active.length === 0
          ? null
          : {
              venue: 'UNIFIED',
              kind: active.some((s) => s.kind === 'continuous') ? 'continuous' : 'auction',
            },
      );
  }
}

const LABELS: Record<string, string> = {
  'NXT:pre': 'NXT 프리',
  'KRX:opening-auction': 'KRX 시가 단일가',
  'KRX:regular': 'KRX 정규',
  'KRX:closing-auction': 'KRX 종가 단일가',
  'NXT:after-auction': 'NXT 종가 단일가',
  'NXT:after': 'NXT 애프터',
  'KRX:after': 'KRX 애프터',
  'NXT:regular': 'NXT 정규',
};

/** 상태 칩용 시장 전체 기준 라벨. 종목 유형·거래정지는 보지 않는다. */
export function sessionLabelAt(
  sessions: DaySession[],
  t: number,
): { label: string; venue: 'KRX' | 'NXT' | null } | null {
  const s = pickByPriority(sessions.filter((x) => inSession(x, t)));
  if (!s) return null;
  return { label: LABELS[`${s.venue}:${s.label}`] ?? `${s.venue} ${s.label}`, venue: s.venue };
}
