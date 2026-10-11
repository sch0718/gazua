// 프로필별 저장 키와 읽기 도우미. 앱 상태(app.svelte.ts)가 이 함수들로 저장소를 읽고 쓴다.
import type { TokenInfo, TokenStore } from '../providers/types';
import { DEFAULT_SETTINGS, type Settings, type Watchlists } from './schema';
import { isLocked, type LockedSecrets, type Secrets } from './secrets';
import { sanitizeSettings, sanitizeWatchlists } from './validate';
import type { SafeStorage } from './storage';

export const DEFAULT_GROUP_NAME = '내 관심';

export const profileKeys = {
  settings: (id: string) => `p:${id}:settings`,
  watchlists: (id: string) => `p:${id}:watchlists`,
  secrets: (id: string) => `p:${id}:secrets`,
  token: (id: string, provider: 'kis' | 'toss') => `p:${id}:token:${provider}`,
  recent: (id: string) => `p:${id}:recent`,
};

export const RECENT_MAX = 5;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 저장된 설정을 가져오기와 같은 규칙으로 검증한다. 빠진 필드는 기본값(오래된 형식, 알리지 않음),
 * 틀린 값·객체가 아닌 값은 기본값으로 바꾸고 저장소 배너로 알린다. 저장된 값은 덮어쓰지 않는다.
 */
export function loadSettings(st: SafeStorage, id: string): Settings {
  const key = profileKeys.settings(id);
  const raw = st.get<unknown>(key, null);
  if (raw === null) return { ...DEFAULT_SETTINGS };
  if (!isRecord(raw)) {
    st.reportCorrupt(key);
    return { ...DEFAULT_SETTINGS };
  }
  const keyLock = typeof raw.keyLock === 'boolean' ? raw.keyLock : DEFAULT_SETTINGS.keyLock;
  const { settings, invalid } = sanitizeSettings(raw, keyLock);
  if (invalid.length > 0) st.reportCorrupt(key);
  return settings;
}

/**
 * 맞는 그룹·종목만 남긴다(틀린 것이 있으면 저장소 배너). 없거나 모양부터 깨졌으면 빈 그룹 '내 관심' 하나를
 * 만들어 저장한다(그룹 id가 재시작해도 같도록).
 */
export function loadWatchlists(st: SafeStorage, id: string): Watchlists {
  const key = profileKeys.watchlists(id);
  const raw = st.get<unknown>(key, null);
  const checked = sanitizeWatchlists(raw);
  if (checked) {
    if (checked.repaired) st.reportCorrupt(key);
    return checked.watchlists;
  }
  if (raw !== null) st.reportCorrupt(key);
  const w: Watchlists = { groups: [{ id: crypto.randomUUID(), name: DEFAULT_GROUP_NAME, items: [] }] };
  st.set(profileKeys.watchlists(id), w);
  return w;
}

/** 최근 추가한 종목(최신순, 최대 5개). 깨졌으면 빈 목록. */
export function loadRecent(st: SafeStorage, id: string): string[] {
  const raw = st.get<unknown>(profileKeys.recent(id), null);
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is string => typeof s === 'string').slice(0, RECENT_MAX);
}

/** 저장된 키. 잠긴 형태면 `locked`, 평문이면 `plain`. */
export function loadStoredSecrets(st: SafeStorage, id: string): { plain: Secrets | null; locked: LockedSecrets | null } {
  const raw = st.get<unknown>(profileKeys.secrets(id), null);
  if (isLocked(raw)) return { plain: null, locked: raw };
  return { plain: isRecord(raw) ? (raw as Secrets) : null, locked: null };
}

export function removeTokens(st: SafeStorage, id: string): void {
  st.remove(profileKeys.token(id, 'kis'));
  st.remove(profileKeys.token(id, 'toss'));
}

const isToken = (v: unknown): v is TokenInfo =>
  isRecord(v) && typeof v.accessToken === 'string' && typeof v.expiresAt === 'number';

/** `canSave()`가 false면 저장하지 않는다(교체된 공급자의 늦은 토큰, 잠금 모드). */
export function storageTokenStore(st: SafeStorage, key: string, canSave: () => boolean = () => true): TokenStore {
  return {
    load: () => {
      const t = st.get<unknown>(key, null);
      return isToken(t) ? t : null;
    },
    save: (t) => {
      if (canSave()) st.set(key, t);
    },
  };
}

/** 잠금 모드용. 토큰은 이 맵(메모리)에만 있다. */
export function memoryTokenStore(
  map: Map<string, TokenInfo>,
  key: string,
  canSave: () => boolean = () => true,
): TokenStore {
  return {
    load: () => map.get(key) ?? null,
    save: (t) => {
      if (canSave()) map.set(key, t);
    },
  };
}
