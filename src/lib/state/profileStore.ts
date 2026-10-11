// 프로필별 저장 키와 읽기 도우미. 앱 상태(app.svelte.ts)가 이 함수들로 저장소를 읽고 쓴다.
import type { TokenInfo, TokenStore } from '../providers/types';
import { DEFAULT_SETTINGS, type Settings, type Watchlists } from './schema';
import { isLocked, type LockedSecrets, type Secrets } from './secrets';
import type { SafeStorage } from './storage';

export const DEFAULT_GROUP_NAME = '내 관심';

export const profileKeys = {
  settings: (id: string) => `p:${id}:settings`,
  watchlists: (id: string) => `p:${id}:watchlists`,
  secrets: (id: string) => `p:${id}:secrets`,
  token: (id: string, provider: 'kis' | 'toss') => `p:${id}:token:${provider}`,
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** 저장된 설정에 빠진 필드는 기본값으로 채운다. 깨졌거나 객체가 아니면 기본값. */
export function loadSettings(st: SafeStorage, id: string): Settings {
  const raw = st.get<unknown>(profileKeys.settings(id), null);
  return isRecord(raw) ? { ...DEFAULT_SETTINGS, ...(raw as Partial<Settings>) } : { ...DEFAULT_SETTINGS };
}

/** 없거나 깨졌으면 빈 그룹 '내 관심' 하나를 만들어 저장한다(그룹 id가 재시작해도 같도록). */
export function loadWatchlists(st: SafeStorage, id: string): Watchlists {
  const raw = st.get<unknown>(profileKeys.watchlists(id), null);
  if (isRecord(raw) && Array.isArray(raw.groups)) return raw as unknown as Watchlists;
  const w: Watchlists = { groups: [{ id: crypto.randomUUID(), name: DEFAULT_GROUP_NAME, items: [] }] };
  st.set(profileKeys.watchlists(id), w);
  return w;
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

export function storageTokenStore(st: SafeStorage, key: string): TokenStore {
  return {
    load: () => {
      const t = st.get<unknown>(key, null);
      return isToken(t) ? t : null;
    },
    save: (t) => st.set(key, t),
  };
}

/** 잠금 모드용. 토큰은 이 맵(메모리)에만 있다. */
export function memoryTokenStore(map: Map<string, TokenInfo>, key: string): TokenStore {
  return {
    load: () => map.get(key) ?? null,
    save: (t) => {
      map.set(key, t);
    },
  };
}
