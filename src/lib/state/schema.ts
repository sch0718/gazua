import type { VenueMode } from '../market/tradable';
import type { SafeStorage } from './storage';

export type PeriodUnit = 'D' | 'W' | 'M' | 'Y';
export interface Period {
  unit: PeriodUnit;
  n: number;
}

/** 리더보드 정렬: 지표 값 순, 또는 그룹 종목 순서(끌어 바꾼 순서) 그대로. */
export type BoardOrder = 'value' | 'mine';

export type MetricId = 'change' | 'drawdown' | 'excess' | 'rvol' | 'mcap' | 'volatility' | 'rsi';

export interface Settings {
  provider: 'kis' | 'toss' | 'demo';
  proxyUrl: string;
  venueMode: VenueMode;
  period: Period;
  metric: MetricId;
  benchmark: 'AUTO' | 'KOSPI' | 'KOSDAQ';
  theme: 'system' | 'light' | 'dark';
  colorConvention: 'kr' | 'global';
  boardOrder: BoardOrder;
  lastGroupId: string | null;
  keyLock: boolean;
  /** false until the first-run onboarding has been completed. */
  onboarded: boolean;
}

export interface WatchItem {
  symbol: string;
  colorSlot: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  hidden: boolean;
  addedAt: number;
}

export interface Group {
  id: string;
  name: string;
  items: WatchItem[];
}

export interface Watchlists {
  groups: Group[];
}

export interface Profile {
  id: string;
  name: string;
  createdAt: number;
}

export interface Meta {
  schemaVersion: 1;
  activeProfileId: string;
  profiles: Profile[];
}

export const DEFAULT_SETTINGS: Settings = {
  provider: 'demo',
  proxyUrl: '',
  venueMode: 'AUTO',
  period: { unit: 'D', n: 1 },
  metric: 'change',
  benchmark: 'AUTO',
  theme: 'system',
  colorConvention: 'kr',
  boardOrder: 'value',
  lastGroupId: null,
  keyLock: false,
  onboarded: false,
};

export const META_KEY = 'meta';
export const DEFAULT_PROFILE_NAME = '내 프로필';

function isValidMeta(m: Meta | null): m is Meta {
  return (
    m !== null &&
    typeof m === 'object' &&
    m.schemaVersion === 1 &&
    Array.isArray(m.profiles) &&
    m.profiles.length > 0 &&
    m.profiles.some((p) => p.id === m.activeProfileId)
  );
}

/** Loads the profile index; creates and persists a default profile when missing or invalid. */
export function loadMeta(st: SafeStorage): Meta {
  const stored = st.get<Meta | null>(META_KEY, null);
  if (isValidMeta(stored)) return stored;
  const id = crypto.randomUUID();
  const meta: Meta = {
    schemaVersion: 1,
    activeProfileId: id,
    profiles: [{ id, name: DEFAULT_PROFILE_NAME, createdAt: Date.now() }],
  };
  st.set(META_KEY, meta);
  return meta;
}
