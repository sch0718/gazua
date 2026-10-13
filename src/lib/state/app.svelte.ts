// 앱 전체 상태: 프로필·설정·관심종목·키·공급자·데이터 캐시·화면 경로·배너를 한곳에 묶는다.
import { createCandleCache, type CandleCache } from '../data/candleCache';
import {
  createDailyMemo,
  createSeriesSnapshots,
  type DailyMemo,
  type SeriesSnapshots,
} from '../data/candleService';
import { createProvider } from '../providers/factory';
import type { MarketDataProvider, TokenInfo, TokenStore } from '../providers/types';
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
import { assertStrategyCap, loadStrategies } from '../sim/strategyStore';
import type { Strategy } from '../sim/types';
import { exportData, importData, type ImportResult } from './exportImport';
import { hashFor, parseHash, type Route } from './routes';
import { META_KEY, loadMeta, type Meta, type Profile, type Settings, type Watchlists } from './schema';
import { WrongPassphraseError, isLocked, lockSecrets, unlockSecrets, type LockedSecrets, type Secrets } from './secrets';
import { STORAGE_PREFIX, type SafeStorage } from './storage';

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
  /** 이 프로필의 매매 규칙 전략(최대 20개) */
  readonly strategies: Strategy[];
  /** 경로를 바로잡았을 때 화면이 한 번 보여 줄 안내(예: 없는 전략). 보여 준 뒤 clearRouteNotice. */
  readonly routeNotice: string | null;
  clearRouteNotice(): void;
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
  /** 전략 목록 전체를 바꿔 저장한다. 20개를 넘으면 Error. */
  setStrategies(list: Strategy[]): void;
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
  /**
   * passphrase가 있으면 암호화해 저장하고 keyLock을 켠다. 없으면 평문 저장(keyLock이 켜져 있으면 거절).
   * 잠금이 저장되지 않으면 저장소의 이전 키를 지우려 하고, 이 탭에서만 잠금을 유지한 채 KeyLockNotSavedError('lock', …)로 거절한다.
   */
  setSecrets(s: Secrets, passphrase?: string): Promise<void>;
  /**
   * 잠금 해제된 상태에서만. 키를 평문으로 다시 저장하고 keyLock을 끈다. 저장된 뒤에만 잠금을 내려놓는다:
   * 저장되지 않으면 잠금을 그대로 둔 채 KeyLockNotSavedError('unlock', 'unsaved')를 던지고(다시 부르면 다시 쓴다),
   * 저장소가 아예 없으면 이 탭에서만 끄고 'no-storage'를 던진다(다시 불러도 같은 실패를 알린다).
   */
  disableKeyLock(): void;
  /**
   * 연결 진단이 따로 발급하지 않고 쓸 토큰 공급원. 지금 공급자가 이 공급자이고, 같은 키·프록시 토큰·프록시 URL로
   * 만들어졌을 때만 그 공급자의 토큰 관리자(캐시·진행 중 발급·잠금 모드 규칙 포함)를 돌려준다. 아니면 undefined.
   */
  tokenSourceFor(provider: 'kis' | 'toss', secrets: Secrets, proxyUrl: string): (() => Promise<TokenInfo>) | undefined;
  /** 메모리의 키와 토큰을 버리고 잠금 해제 화면으로 간다. */
  lock(): void;
  /** 이 프로필의 저장된 키·토큰을 지우고 keyLock을 끈다. 저장소에서 키를 지우지 못하면 StoredKeysNotRemovedError. */
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

/**
 * 키 잠금을 켜거나 끈 결과가 저장소에 남지 않았을 때(용량 부족 등). 이 탭의 상태는 바뀐 채로 두고 실패를 알린다.
 * kind 'lock'(잠긴 키를 저장하지 못함)의 reason:
 *   'cleared' 저장소의 이전 키를 지웠다 · 'not-cleared' 지우려 했지만 removeItem도 실패했다 · 'no-storage' 저장소가 아예 없다.
 * kind 'unlock'(평문 키를 저장하지 못함)의 reason:
 *   'unsaved' 저장소는 이전에 저장된 상태 그대로다 · 'no-storage' 저장소가 아예 없다.
 */
export type KeyLockNotSavedReason = 'cleared' | 'not-cleared' | 'no-storage' | 'unsaved';

export class KeyLockNotSavedError extends Error {
  constructor(
    readonly kind: 'lock' | 'unlock',
    readonly reason: KeyLockNotSavedReason,
  ) {
    super(`key lock change was not saved (${kind}, ${reason})`);
    this.name = 'KeyLockNotSavedError';
  }
}

/** 평문으로 키를 저장하려 했지만, 저장소의 키는 이미 (다른 탭에서) 암호로 잠겨 있다. 아무것도 저장하지 않았다. */
export class KeyLockedElsewhereError extends Error {
  constructor() {
    super('stored keys are sealed (locked in another tab): plaintext save refused');
    this.name = 'KeyLockedElsewhereError';
  }
}

/**
 * 이 탭이 저장소의 키를 지우려 했지만 removeItem이 실패해 키가 남아 있다. clearSecrets가 이를 알리고,
 * 남은 잠긴 키 위에 평문을 저장하려 할 때도 이 이유로 거절한다(다른 탭의 잠금과 구분한다).
 */
export class StoredKeysNotRemovedError extends Error {
  constructor() {
    super('stored keys could not be removed from browser storage');
    this.name = 'StoredKeysNotRemovedError';
  }
}

export const STORAGE_BANNER = '이 브라우저에선 설정이 저장되지 않아요';
export const CORRUPT_BANNER = '저장된 설정 일부를 읽지 못해 기본값으로 되돌렸어요';
export const DEMO_BANNER = '데모 데이터를 보고 있어요';
const CACHE_MAX_BYTES = 50 * 1024 * 1024;

/** 두 키 묶음이 이 공급자에 대해 같은 키·프록시 토큰인지. */
function sameCredentials(p: 'kis' | 'toss', a: Secrets, b: Secrets | null): boolean {
  if (!b || (a.proxyToken ?? '') !== (b.proxyToken ?? '')) return false;
  if (p === 'kis') return !!a.kis && a.kis.appKey === b.kis?.appKey && a.kis.appSecret === b.kis?.appSecret;
  return !!a.toss && a.toss.clientId === b.toss?.clientId && a.toss.clientSecret === b.toss?.clientSecret;
}

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
  let strategies = $state.raw<Strategy[]>(first.strategies);
  let routeNotice = $state<string | null>(null);
  let locked: LockedSecrets | null = first.locked;
  /** 이 탭이 지우지 못하고 남긴 잠긴 키(프로필·JSON). 평문 저장을 거절할 때 다른 탭의 잠금과 구분한다. */
  let undeletedSealed: { id: string; blob: string } | null = null;
  /** 저장소가 없어 잠금 해제(평문)가 이 탭에만 적용된 상태. 다시 끄려 하면 또 저장되지 않았다고 알린다. */
  let unlockUnsaved = false;
  let secrets = $state.raw<Secrets | null>(first.secrets);
  // 지금 공급자를 만든 입력(연결 진단이 같은 토큰을 써도 되는지 판단할 때 쓴다).
  let builtFrom: { proxyUrl: string; secrets: Secrets | null } = { proxyUrl: '', secrets: null };
  let provider = $state.raw<MarketDataProvider>(buildProvider());
  let data = $state.raw<AppData>(freshData());
  let route = $state.raw<Route>({ name: 'compare' });
  // 저장소의 persistent·issues는 반응형이 아니므로 쓰기마다 올려 배너를 다시 계산하게 한다.
  let storageTick = $state(0);

  function loadProfile(id: string) {
    const stored = loadStoredSecrets(storage, id);
    // 잠금 여부는 저장된 키의 모양이 정한다(잠긴 키면 켜짐, 평문·없음이면 꺼짐). 설정이 다르면 고쳐 둔다
    // (다른 탭이 잠그는 사이 평문이 저장되었거나, 잠금 끄기 도중 실패한 상태 등).
    let loadedSettings = loadSettings(storage, id);
    const shapeLock = stored.locked !== null;
    if (loadedSettings.keyLock !== shapeLock) {
      loadedSettings = { ...loadedSettings, keyLock: shapeLock };
      // 실패해도 상관없다(다음에 열 때도 키의 모양이 정한다). set처럼 이 세션을 메모리 전용으로 바꾸지 않게 trySet을 쓴다.
      storage.trySet(profileKeys.settings(id), loadedSettings);
    }
    return {
      settings: loadedSettings,
      watchlists: loadWatchlists(storage, id),
      recent: loadRecent(storage, id),
      strategies: loadStrategies(storage, id),
      secrets: stored.plain,
      locked: stored.locked,
    };
  }

  function write(key: string, v: unknown) {
    storage.set(key, v);
    storageTick++;
  }

  function remove(key: string): boolean {
    const removed = storage.remove(key);
    storageTick++;
    return removed;
  }

  function activeId() {
    return meta.activeProfileId;
  }

  /** 잠금 모드면 토큰을 저장소에 쓰지 않는다. */
  function lockMode() {
    return settings.keyLock || locked !== null;
  }

  /** 지금 세대 공급자의 토큰 저장소. 세대가 바뀌면(공급자 교체) 저장하지 않는다. */
  function tokenStoreFor(id: string, p: 'kis' | 'toss', generation: number): TokenStore {
    const current = () => generation === providerGeneration;
    return lockMode()
      ? memoryTokenStore(memoryTokens, `${id}:${p}`, current)
      : // 만들 때 평문 모드였어도, 저장 시점에 잠금 모드면 쓰지 않는다.
        storageTokenStore(storage, profileKeys.token(id, p), () => current() && !lockMode());
  }

  function buildProvider(): MarketDataProvider {
    const id = activeId();
    const generation = providerGeneration;
    builtFrom = { proxyUrl: settings.proxyUrl.trim(), secrets };
    return createProvider(settings, secrets, {
      now,
      fetchImpl,
      tokenStore: (p) => tokenStoreFor(id, p, generation),
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
    if (r.name === 'simulate') {
      if (!r.strategyId) return { name: 'simulate' };
      if (strategies.some((s) => s.id === r.strategyId)) return { name: 'simulate', strategyId: r.strategyId };
      routeNotice = '전략을 찾을 수 없어요';
      return { name: 'simulate' };
    }
    if (r.name === 'settings' && r.section) return { name: 'settings', section: r.section };
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
    strategies = loaded.strategies;
    secrets = loaded.secrets;
    locked = loaded.locked;
    unlockUnsaved = false;
    rebuild();
    applyDisplay();
    enter();
  }

  /** storage 이벤트의 이전 값이 저장된 키(잠긴 키 또는 평문 객체)였는지. */
  function storedKeys(json: string | null): boolean {
    if (json === null) return false;
    try {
      const v: unknown = JSON.parse(json);
      return v !== null && typeof v === 'object';
    } catch {
      return false;
    }
  }

  /**
   * 다른 탭이 이 프로필의 키를 바꾸면(storage 이벤트) 잠금 상태를 저장소에 맞춘다.
   * 다른 탭이 키를 잠갔으면 이 탭도 키·토큰을 버리고 잠금 해제 화면으로, 잠금을 껐으면 저장된 평문 키를 쓴다.
   */
  function onStorage(e: StorageEvent) {
    const id = activeId();
    // 이 프로필의 키 항목 자체가 바뀐 경우에만 반응한다(다른 설정 쓰기·clear()는 잠금 상태를 바꾸지 않는다).
    if (e.key !== STORAGE_PREFIX + profileKeys.secrets(id)) return;
    const raw = storage.readBacking<unknown>(profileKeys.secrets(id), null);
    if (isLocked(raw)) {
      if (locked !== null && JSON.stringify(locked) === JSON.stringify(raw)) return;
      locked = raw;
      secrets = null;
      unlockUnsaved = false;
      settings = { ...settings, keyLock: true };
      memoryTokens.clear();
      rebuild();
      enter();
      return;
    }
    if (locked !== null) {
      // 지워진 경우에는, 지워지기 전에 저장된 키(잠긴 키·평문)가 있었을 때만 잠금을 내려놓는다. 저장된 키 없이
      // 이 탭의 메모리에만 있는 잠금(잠금 저장 실패)은 탭을 닫을 때까지 유지한다.
      if (raw === null && !storedKeys(e.oldValue)) return;
      locked = null;
      unlockUnsaved = false;
      secrets = raw !== null && typeof raw === 'object' ? (raw as Secrets) : null;
      settings = { ...settings, keyLock: false };
      rebuild();
      enter();
    }
  }

  enter();
  applyDisplay();
  win?.addEventListener('hashchange', onHashChange);
  win?.addEventListener('storage', onStorage);

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
    get strategies() {
      return strategies;
    },
    get routeNotice() {
      return routeNotice;
    },
    clearRouteNotice() {
      routeNotice = null;
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

    setStrategies(list) {
      assertStrategyCap(list);
      strategies = list;
      write(profileKeys.strategies(activeId()), { strategies: list });
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
      remove(profileKeys.strategies(id));
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
        // 저장소의 키가 잠겨 있으면 평문으로 덮어쓰지 않는다. 이 탭이 지우지 못한 키면 그 이유로,
        // 아니면 다른 탭이 그사이 잠근 것으로 알린다(이 탭은 아직 잠금 꺼짐으로 알고 있을 수 있다).
        const stored = storage.readBacking<unknown>(profileKeys.secrets(id), null);
        if (isLocked(stored)) {
          if (undeletedSealed?.id === id && undeletedSealed.blob === JSON.stringify(stored)) throw new StoredKeysNotRemovedError();
          throw new KeyLockedElsewhereError();
        }
        undeletedSealed = null;
        forgetTokens(id);
        locked = null;
        unlockUnsaved = false;
        write(profileKeys.secrets(id), s);
        // 평문 키는 언제나 잠금 꺼짐과 함께 저장한다.
        write(profileKeys.settings(id), settings);
      } else {
        const sealed = await lockSecrets(s, passphrase);
        // 암호화하는 동안 프로필이 바뀌었으면 아무것도 저장하지 않았다고 알린다(성공으로 보이지 않게).
        if (activeId() !== id) throw new Error('profile changed while locking: nothing was saved');
        forgetTokens(id);
        undeletedSealed = null;
        locked = sealed;
        unlockUnsaved = false;
        const key = profileKeys.secrets(id);
        write(key, sealed);
        if (!settings.keyLock) {
          settings = { ...settings, keyLock: true };
          write(profileKeys.settings(id), settings);
        }
        if (!storage.persistent) {
          // 잠금이 저장되지 않았다. 저장소에 남은 이전 평문 키를 지우고(removeItem은 용량과 무관),
          // 이 탭에서는 메모리의 암호문으로 잠금을 유지한다.
          const cleared = remove(key);
          write(key, sealed);
          secrets = s;
          rebuild();
          throw new KeyLockNotSavedError('lock', !storage.backed ? 'no-storage' : cleared ? 'cleared' : 'not-cleared');
        }
      }
      secrets = s;
      rebuild();
    },

    disableKeyLock() {
      if (locked !== null && secrets === null) throw new Error('unlock first');
      const id = activeId();
      if (locked === null && !unlockUnsaved) {
        // 잠긴 키가 없으면 평문으로 다시 저장할 것도 없다.
        settings = { ...settings, keyLock: false };
        write(profileKeys.settings(id), settings);
        forgetTokens(id);
        rebuild();
        return;
      }
      // 사용자가 잠금을 끄겠다고 한 경우에만 평문으로 다시 저장한다. 실제로 저장된 뒤에만 잠금을 내려놓는다:
      // 실패하면 이 탭도 잠긴 채로 두어, 다시 시도하면 다시 쓰고 또 실패하면 같은 실패를 알린다.
      // 불변식: 실패로 끝나면 저장소에 평문 키가 남지 않는다. 그래서 평문을 마지막에 쓴다.
      //   1) keyLock:false 설정을 먼저 쓴다. 실패하면 아무것도 바뀌지 않았다.
      //   2) 평문 키를 쓴다. 실패하면 저장된 잠긴 키는 그대로이고(잠금 여부는 저장된 키의 모양으로 정해진다),
      //      설정은 최선 노력으로 되돌린다(되돌리지 못해도 잠긴 키라 열 때 암호를 묻는다).
      const secretsKey = profileKeys.secrets(id);
      const settingsKey = profileKeys.settings(id);
      const nextSettings = { ...settings, keyLock: false };
      let saved = storage.trySet(settingsKey, nextSettings);
      if (saved && !storage.trySet(secretsKey, secrets)) {
        storage.trySet(settingsKey, settings);
        saved = false;
      }
      storageTick++;
      if (!saved && storage.backed) throw new KeyLockNotSavedError('unlock', 'unsaved');
      // 저장소가 아예 없으면 이 탭에서만 끄되, 저장되지 않았다는 사실은 다시 시도할 때마다 알린다.
      if (!saved) storage.set(secretsKey, secrets);
      locked = null;
      unlockUnsaved = !saved;
      settings = nextSettings;
      if (!saved) storage.set(profileKeys.settings(id), settings);
      forgetTokens(id);
      rebuild();
      if (!saved) throw new KeyLockNotSavedError('unlock', 'no-storage');
    },

    tokenSourceFor(p, s, proxyUrl) {
      const current = provider;
      if (current.id !== p || !current.getAccessToken) return undefined;
      if (proxyUrl.trim() !== builtFrom.proxyUrl || !sameCredentials(p, s, builtFrom.secrets)) return undefined;
      return () => current.getAccessToken!();
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
      const key = profileKeys.secrets(id);
      const before = storage.readBacking<unknown>(key, null);
      const removed = remove(key);
      forgetTokens(id);
      locked = null;
      unlockUnsaved = false;
      secrets = null;
      settings = { ...settings, keyLock: false };
      write(profileKeys.settings(id), settings);
      rebuild();
      enter();
      // 이 탭에서는 지웠지만 저장소에 키가 남았으면 성공으로 알리지 않는다.
      if (!removed && before !== null) {
        undeletedSealed = isLocked(before) ? { id, blob: JSON.stringify(before) } : null;
        throw new StoredKeysNotRemovedError();
      }
    },

    navigate,

    destroy() {
      win?.removeEventListener('hashchange', onHashChange);
      win?.removeEventListener('storage', onStorage);
    },
  };
}
