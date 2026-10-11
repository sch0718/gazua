// 앱 전체 상태: 프로필·설정·관심종목·키·공급자·데이터 캐시·화면 경로·배너를 한곳에 묶는다.
import { createCandleCache, type CandleCache } from '../data/candleCache';
import {
  createDailyMemo,
  createSeriesSnapshots,
  type DailyMemo,
  type SeriesSnapshots,
} from '../data/candleService';
import { createProvider } from '../providers/factory';
import type { MarketDataProvider, TokenInfo } from '../providers/types';
import { applyColorConvention, applyTheme } from '../ui/theme';
import {
  RECENT_MAX,
  loadRecent,
  loadSettings,
  loadStoredSecrets,
  loadWatchlists,
  memoryTokenStore,
  profileKeys,
  removeTokens,
  storageTokenStore,
} from './profileStore';
import { exportData, importData, type ImportResult } from './exportImport';
import { hashFor, parseHash, type Route } from './routes';
import { META_KEY, loadMeta, type Meta, type Profile, type Settings, type Watchlists } from './schema';
import { WrongPassphraseError, lockSecrets, unlockSecrets, type LockedSecrets, type Secrets } from './secrets';
import type { SafeStorage } from './storage';

export type { Route, RouteName } from './routes';

export interface AppBanner {
  id: string;
  text: string;
  action?: { label: string; run(): void };
}

export interface AppData {
  cache: CandleCache;
  memo: DailyMemo;
  snapshots: SeriesSnapshots;
}

export interface App {
  readonly route: Route;
  readonly meta: Meta;
  readonly settings: Settings;
  readonly watchlists: Watchlists;
  /** 이 프로필에서 최근 추가한 종목(최신순, 최대 5개) */
  readonly recent: string[];
  /** 잠금 상태면 null. 잠금 모드에서 복호화한 값은 메모리에만 있다. */
  readonly secrets: Secrets | null;
  readonly provider: MarketDataProvider;
  readonly banners: AppBanner[];
  /** 공급자·프로필·키가 바뀌면 memo·snapshots를 새로 만든다. cache는 키에 공급자가 있어 유지한다. */
  readonly data: AppData;
  /** keyLock은 평문 키가 저장돼 있으면 켤 수 없고, 암호화된 키가 있으면 끌 수 없다(Error). */
  updateSettings(p: Partial<Settings>): void;
  setWatchlists(w: Watchlists): void;
  addRecent(symbol: string): void;
  switchProfile(id: string): void;
  addProfile(name: string): Profile;
  /** 빈 이름은 무시한다. */
  renameProfile(id: string, name: string): void;
  /** 프로필과 그 설정·관심종목·키·토큰을 지운다. 마지막 프로필은 지울 수 없다(Error). 지금 쓰는 프로필이면 다른 프로필로 바꾼다. */
  deleteProfile(id: string): void;
  /** 저장된 잠금 키를 이 암호로 열 수 있는지(상태는 바꾸지 않는다). 잠긴 키가 없으면 true. */
  verifyPassphrase(passphrase: string): Promise<boolean>;
  /** 지금 프로필을 JSON으로. 토큰은 넣지 않고, 키는 includeSecrets일 때만 저장된 형태 그대로. */
  exportData(includeSecrets: boolean): string;
  /** 새 프로필 `{이름} (가져옴)`으로 가져온다. 지금 프로필은 그대로. */
  importData(json: string): ImportResult;
  unlock(passphrase: string): Promise<void>;
  /** passphrase가 있으면 암호화해 저장하고 keyLock을 켠다. 없으면 평문 저장(keyLock이 켜져 있으면 거절). */
  setSecrets(s: Secrets, passphrase?: string): Promise<void>;
  /** 잠금 해제된 상태에서만. 키를 평문으로 다시 저장하고 keyLock을 끈다. */
  disableKeyLock(): void;
  /** 메모리의 키와 토큰을 버리고 잠금 해제 화면으로 간다. */
  lock(): void;
  /** 이 프로필의 저장된 키·토큰을 지우고 keyLock을 끈다. */
  clearSecrets(): void;
  navigate(r: Route): void;
  destroy(): void;
}

export interface AppDeps {
  storage: SafeStorage;
  now: () => number;
  fetchImpl?: typeof fetch;
  location?: Pick<Location, 'hash'>;
  /** 기본값은 IndexedDB `gazua-cache`. */
  cache?: CandleCache;
}

export const STORAGE_BANNER = '이 브라우저에선 설정이 저장되지 않아요';
export const CORRUPT_BANNER = '저장된 설정 일부를 읽지 못해 기본값으로 되돌렸어요';
export const DEMO_BANNER = '데모 데이터를 보고 있어요';
const CACHE_MAX_BYTES = 50 * 1024 * 1024;

export function createApp(deps: AppDeps): App {
  const { storage, now, fetchImpl } = deps;
  const loc = deps.location ?? globalThis.location;
  const win = typeof window === 'undefined' ? undefined : window;
  const cache = deps.cache ?? createCandleCache('gazua-cache', now);
  void cache.evict(CACHE_MAX_BYTES).catch(() => {});

  // 잠금 모드의 토큰. 키 `${profileId}:${provider}`.
  const memoryTokens = new Map<string, TokenInfo>();
  // rebuild()마다 올린다. 이전 공급자가 늦게 받은 토큰은 저장하지 않는다.
  let providerGeneration = 0;
  const initialMeta = loadMeta(storage);
  // 시작할 때 프로필이 하나뿐이면 고를 것이 없다. 이후 프로필을 추가해도 지금 쓰는 프로필이 선택된 것으로 본다.
  let profileChosen = initialMeta.profiles.length <= 1;
  let meta = $state.raw<Meta>(initialMeta);
  const first = loadProfile(initialMeta.activeProfileId);
  let settings = $state.raw<Settings>(first.settings);
  let watchlists = $state.raw<Watchlists>(first.watchlists);
  let recent = $state.raw<string[]>(first.recent);
  let locked: LockedSecrets | null = first.locked;
  let secrets = $state.raw<Secrets | null>(first.secrets);
  let provider = $state.raw<MarketDataProvider>(buildProvider());
  let data = $state.raw<AppData>(freshData());
  let route = $state.raw<Route>({ name: 'compare' });
  // 저장소의 persistent·issues는 반응형이 아니므로 쓰기마다 올려 배너를 다시 계산하게 한다.
  let storageTick = $state(0);

  function loadProfile(id: string) {
    const stored = loadStoredSecrets(storage, id);
    return {
      settings: loadSettings(storage, id),
      watchlists: loadWatchlists(storage, id),
      recent: loadRecent(storage, id),
      secrets: stored.plain,
      locked: stored.locked,
    };
  }

  function write(key: string, v: unknown) {
    storage.set(key, v);
    storageTick++;
  }

  function remove(key: string) {
    storage.remove(key);
    storageTick++;
  }

  function activeId() {
    return meta.activeProfileId;
  }

  /** 잠금 모드면 토큰을 저장소에 쓰지 않는다. */
  function lockMode() {
    return settings.keyLock || locked !== null;
  }

  function buildProvider(): MarketDataProvider {
    const id = activeId();
    const generation = providerGeneration;
    const current = () => generation === providerGeneration;
    return createProvider(settings, secrets, {
      now,
      fetchImpl,
      tokenStore: (p) =>
        lockMode()
          ? memoryTokenStore(memoryTokens, `${id}:${p}`, current)
          : // 만들 때 평문 모드였어도, 저장 시점에 잠금 모드면 쓰지 않는다.
            storageTokenStore(storage, profileKeys.token(id, p), () => current() && !lockMode()),
    });
  }

  function freshData(): AppData {
    return { cache, memo: createDailyMemo(), snapshots: createSeriesSnapshots() };
  }

  function rebuild() {
    providerGeneration++;
    provider = buildProvider();
    data = freshData();
  }

  function applyDisplay() {
    if (typeof document === 'undefined') return;
    applyTheme(settings.theme);
    applyColorConvention(settings.colorConvention);
  }

  function forgetTokens(id: string) {
    removeTokens(storage, id);
    memoryTokens.delete(`${id}:kis`);
    memoryTokens.delete(`${id}:toss`);
    storageTick++;
  }

  // ── 경로 ────────────────────────────────────────────────

  /** 프로필 선택·잠금 해제가 끝나기 전에는 다른 화면으로 가지 않는다. */
  function gate(): Route | null {
    if (meta.profiles.length > 1 && !profileChosen) return { name: 'profiles' };
    if (locked && secrets === null) return { name: 'unlock' };
    return null;
  }

  function normalize(r: Route): Route {
    if (r.name !== 'compare') return { name: r.name };
    const ids = watchlists.groups.map((g) => g.id);
    if (r.groupId && ids.includes(r.groupId)) return { name: 'compare', groupId: r.groupId };
    const fallback = settings.lastGroupId && ids.includes(settings.lastGroupId) ? settings.lastGroupId : ids[0];
    return fallback ? { name: 'compare', groupId: fallback } : { name: 'compare' };
  }

  /** 관문(프로필 선택·잠금 해제)이 열려 있으면 그 화면에 머문다. */
  function navigate(r: Route) {
    const g = gate();
    if (g) {
      route = g;
      return;
    }
    const next = normalize(r);
    route = next;
    const hash = hashFor(next);
    if (hash && loc && loc.hash !== hash) loc.hash = hash;
  }

  /** 시작·프로필 전환·잠금 해제 뒤 들어갈 화면. */
  function enter() {
    const g = gate();
    if (g) route = g;
    else if (!settings.onboarded) navigate({ name: 'onboarding' });
    else navigate(parseHash(loc?.hash ?? '') ?? { name: 'compare' });
  }

  function onHashChange() {
    if (gate()) return;
    // 알 수 없는 해시·그룹은 정규화한 해시로 다시 쓴다.
    navigate(parseHash(loc?.hash ?? '') ?? { name: 'compare' });
  }

  function switchProfile(id: string) {
    if (!meta.profiles.some((p) => p.id === id)) throw new Error(`no profile ${id}`);
    meta = { ...meta, activeProfileId: id };
    write(META_KEY, meta);
    profileChosen = true;
    const loaded = loadProfile(id);
    settings = loaded.settings;
    watchlists = loaded.watchlists;
    recent = loaded.recent;
    secrets = loaded.secrets;
    locked = loaded.locked;
    rebuild();
    applyDisplay();
    enter();
  }

  enter();
  applyDisplay();
  win?.addEventListener('hashchange', onHashChange);

  return {
    get route() {
      return route;
    },
    get meta() {
      return meta;
    },
    get settings() {
      return settings;
    },
    get watchlists() {
      return watchlists;
    },
    get recent() {
      return recent;
    },
    get secrets() {
      return secrets;
    },
    get provider() {
      return provider;
    },
    get data() {
      return data;
    },
    get banners() {
      void storageTick;
      const out: AppBanner[] = [];
      if (!storage.persistent) out.push({ id: 'storage', text: STORAGE_BANNER });
      for (const issue of storage.issues) {
        if (issue.kind === 'corrupt') out.push({ id: `corrupt:${issue.key}`, text: CORRUPT_BANNER });
      }
      if (provider.id === 'demo' && settings.onboarded && !gate()) {
        out.push({
          id: 'demo',
          text: DEMO_BANNER,
          action: { label: '연결하기', run: () => navigate({ name: 'settings' }) },
        });
      }
      return out;
    },

    updateSettings(p) {
      // 잠금은 setSecrets(s, passphrase)로만 켜고, disableKeyLock()으로만 끈다(평문이 남거나 몰래 풀리지 않게).
      if (p.keyLock === true && !settings.keyLock && locked === null && secrets !== null) {
        throw new Error('plaintext secrets are stored: use setSecrets(secrets, passphrase) to turn keyLock on');
      }
      if (p.keyLock === false && locked !== null) {
        throw new Error('secrets are encrypted: use disableKeyLock() or clearSecrets() to turn keyLock off');
      }
      const prev = settings;
      settings = { ...settings, ...p };
      write(profileKeys.settings(activeId()), settings);
      if (p.keyLock === true) forgetTokens(activeId());
      if (
        prev.provider !== settings.provider ||
        prev.proxyUrl !== settings.proxyUrl ||
        prev.keyLock !== settings.keyLock
      ) {
        rebuild();
      }
      applyDisplay();
    },

    setWatchlists(w) {
      watchlists = w;
      write(profileKeys.watchlists(activeId()), w);
    },

    addRecent(symbol) {
      recent = [symbol, ...recent.filter((s) => s !== symbol)].slice(0, RECENT_MAX);
      write(profileKeys.recent(activeId()), recent);
    },

    switchProfile,

    addProfile(name) {
      const profile: Profile = {
        id: crypto.randomUUID(),
        name: name.trim() || `프로필 ${meta.profiles.length + 1}`,
        createdAt: now(),
      };
      meta = { ...meta, profiles: [...meta.profiles, profile] };
      write(META_KEY, meta);
      return profile;
    },

    renameProfile(id, name) {
      const clean = name.trim();
      if (!clean || !meta.profiles.some((p) => p.id === id)) return;
      meta = { ...meta, profiles: meta.profiles.map((p) => (p.id === id ? { ...p, name: clean } : p)) };
      write(META_KEY, meta);
    },

    deleteProfile(id) {
      if (!meta.profiles.some((p) => p.id === id)) throw new Error(`no profile ${id}`);
      const rest = meta.profiles.filter((p) => p.id !== id);
      if (rest.length === 0) throw new Error('cannot delete the last profile');
      if (activeId() === id) switchProfile(rest[0].id);
      meta = { ...meta, profiles: rest };
      write(META_KEY, meta);
      forgetTokens(id);
      remove(profileKeys.settings(id));
      remove(profileKeys.watchlists(id));
      remove(profileKeys.secrets(id));
      remove(profileKeys.recent(id));
    },

    async verifyPassphrase(passphrase) {
      if (!locked) return true;
      try {
        await unlockSecrets(locked, passphrase);
        return true;
      } catch (e) {
        if (e instanceof WrongPassphraseError) return false;
        throw e;
      }
    },

    exportData(includeSecrets) {
      return exportData(storage, activeId(), includeSecrets);
    },

    importData(json) {
      const res = importData(storage, json, now);
      if (res.ok) {
        meta = loadMeta(storage);
        storageTick++;
      }
      return res;
    },

    async unlock(passphrase) {
      const target = locked;
      const id = activeId();
      if (!target) return;
      const opened = await unlockSecrets(target, passphrase);
      // 복호화하는 동안 프로필이 바뀌었거나 키가 교체됐으면 버린다.
      if (activeId() !== id || locked !== target) return;
      secrets = opened;
      rebuild();
      enter();
    },

    async setSecrets(s, passphrase) {
      const id = activeId();
      if (passphrase === undefined) {
        if (settings.keyLock) throw new Error('keyLock is on: a passphrase is required');
        forgetTokens(id);
        locked = null;
        write(profileKeys.secrets(id), s);
      } else {
        const sealed = await lockSecrets(s, passphrase);
        if (activeId() !== id) return;
        forgetTokens(id);
        locked = sealed;
        write(profileKeys.secrets(id), sealed);
        if (!settings.keyLock) {
          settings = { ...settings, keyLock: true };
          write(profileKeys.settings(id), settings);
        }
      }
      secrets = s;
      rebuild();
    },

    disableKeyLock() {
      if (locked !== null && secrets === null) throw new Error('unlock first');
      const id = activeId();
      if (locked !== null) {
        // 사용자가 잠금을 끄겠다고 한 경우에만 평문으로 다시 저장한다.
        locked = null;
        write(profileKeys.secrets(id), secrets);
      }
      settings = { ...settings, keyLock: false };
      write(profileKeys.settings(id), settings);
      forgetTokens(id);
      rebuild();
    },

    lock() {
      if (!locked) return;
      secrets = null;
      memoryTokens.clear();
      rebuild();
      route = { name: 'unlock' };
    },

    clearSecrets() {
      const id = activeId();
      remove(profileKeys.secrets(id));
      forgetTokens(id);
      locked = null;
      secrets = null;
      settings = { ...settings, keyLock: false };
      write(profileKeys.settings(id), settings);
      rebuild();
      enter();
    },

    navigate,

    destroy() {
      win?.removeEventListener('hashchange', onHashChange);
    },
  };
}
