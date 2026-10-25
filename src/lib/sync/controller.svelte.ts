// 설정 화면·공유가 쓰는 동기화 상태. 로그인(Firebase) → 기기 세션(sync-worker) → 동기화 엔진을 묶는다.
// 로그인·세션이 없거나 실패해도 로컬 사용은 그대로다. 동기화 설정이 없는 빌드에서는 configured=false로 아무것도 하지 않는다.
import type { App } from '../state/app.svelte';
import type { SafeStorage } from '../state/storage';
import type { ShareKind, ShareSnapshot } from '../share/snapshot';
import { createSyncApi, type ApiFail, type DeviceSession, type IndexRow, type ShareRow, type SyncApi } from './api';
import { firebaseAuth, type AuthClient, type AuthUser } from './auth';
import type { SyncConfig } from './config';
import { createSyncEngine, type Resolution, type SyncEngine, type SyncStatus } from './engine';
import { appProfiles } from './local';
import { openSyncStore, type SyncStore } from './store';

/** 포커스로 다시 받는 최소 간격(할당량 절약). */
export const FOCUS_PULL_INTERVAL = 5 * 60 * 1000;

export interface SyncControllerDeps {
  config: SyncConfig | null;
  storage: SafeStorage;
  now?: () => number;
  auth?: AuthClient;
  store?: () => Promise<SyncStore>;
  fetchImpl?: typeof fetch;
  lock?: <T>(fn: () => Promise<T>) => Promise<T>;
  /** 기기 이름 기본값 */
  deviceLabel?: () => string;
}

export interface SyncController {
  readonly configured: boolean;
  /** 로그인·세션까지 된 계정. */
  readonly account: { email: string } | null;
  readonly status: SyncStatus;
  readonly busy: boolean;
  /** 사용자에게 보여 줄 마지막 오류. */
  readonly error: string | null;
  readonly api: SyncApi | null;
  /** 앱이 만들어진 뒤 한 번 연결한다. */
  attach(app: App): Promise<void>;
  /** createApp의 onSyncableChange에 넘긴다. */
  onSyncableChange(e: { kind: 'changed' | 'deleted'; profileId: string }): void;
  signIn(label?: string): Promise<void>;
  signOut(): Promise<void>;
  preview(): Promise<{ upload: string[]; download: number } | null>;
  setEnabled(on: boolean): Promise<void>;
  syncNow(): Promise<void>;
  resolve(profileId: string, choice: Resolution): Promise<void>;
  remoteProfiles(): Promise<IndexRow[] | null>;
  restoreDeleted(profileId: string): Promise<boolean>;
  revisions(profileId: string): Promise<{ revision: number; createdAt: number; deleted: boolean }[] | null>;
  restoreRevision(profileId: string, revision: number): Promise<string | null>;
  sessions(): Promise<DeviceSession[] | null>;
  revokeSession(id: string | 'others'): Promise<boolean>;
  shares(): Promise<ShareRow[] | null>;
  createShare(profileId: string, kind: ShareKind, snapshot: ShareSnapshot, ttlDays: number): Promise<{ url: string; expiresAt: number } | null>;
  revokeShare(id: string): Promise<boolean>;
  clearError(): void;
  clearNotices(): void;
  destroy(): void;
}

const ERRORS: Record<string, string> = {
  offline: '서버에 연결할 수 없어요. 연결되면 다시 보내요.',
  'not-allowed': '이 Google 계정은 허용 목록에 없어요.',
  auth: '로그인이 끝났어요. 다시 로그인해 주세요.',
  limit: '서버 한도에 걸렸어요. 잠시 뒤 다시 시도해요.',
  'share-limit': '활성 공유는 50개까지예요. 쓰지 않는 공유를 철회해 주세요.',
  invalid: '서버가 이 데이터를 받지 않았어요.',
  'too-large': '프로필이 너무 커요(256 KiB). 전략·그룹을 줄여 주세요.',
  'not-found': '서버에서 찾을 수 없어요. 먼저 동기화해 주세요.',
  server: '서버 오류예요. 잠시 뒤 다시 시도해요.',
  conflict: '다른 기기가 먼저 바꿨어요. 다시 받아 주세요.',
  gone: '이미 지워졌어요.',
  'sync-off': '공유하려면 먼저 설정 › 동기화·공유에서 동기화를 켜 주세요.',
};

export const describeFail = (f: ApiFail): string =>
  f.kind === 'limit' && f.code === 'share-limit' ? ERRORS['share-limit'] : f.kind === 'invalid' && f.code === 'too-large' ? ERRORS['too-large'] : ERRORS[f.kind] ?? ERRORS.server;

const SESSION_KEY = 'session';
/** 이 기기의 동기화 상태가 속한 계정(Firebase uid). 다른 계정으로 로그인하면 상태를 버린다. */
const OWNER_KEY = 'owner';
/** 리다이렉트 로그인을 시작했다. 있을 때만 시작 시 결과를 읽는다(그 밖에는 Firebase를 불러오지 않는다). */
const REDIRECT_KEY = 'redirect-pending';

function webLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  return locks ? (locks.request('gazua-sync', fn) as Promise<T>) : fn();
}

function defaultLabel(): string {
  const ua = globalThis.navigator?.userAgent ?? '';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : '기기';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : '';
  return [os, br].filter(Boolean).join(' · ');
}

export function createSyncController(deps: SyncControllerDeps): SyncController {
  const now = deps.now ?? Date.now;
  const config = deps.config;
  let account = $state<{ email: string } | null>(null);
  let status = $state<SyncStatus>({ enabled: false, phase: 'off', pending: 0, conflicts: [], rejected: [], lastSyncAt: null, notices: [], volatile: false });
  let busy = $state(false);
  let error = $state<string | null>(null);

  let store: SyncStore | null = null;
  let engine: SyncEngine | null = null;
  let session: { id: string; email: string } | null = null;
  let lastFocusPull = 0;
  const auth: AuthClient | null = config ? (deps.auth ?? firebaseAuth(config.firebase)) : null;
  const api: SyncApi | null = config
    ? createSyncApi(
        config.apiUrl,
        { idToken: async (force) => (session && auth ? auth.idToken(force) : null), sessionId: async () => session?.id ?? null },
        deps.fetchImpl,
      )
    : null;
  const cleanups: (() => void)[] = [];

  async function forget(message: string | null) {
    session = null;
    account = null;
    await store?.deleteMeta(SESSION_KEY);
    if (message) error = message;
  }

  function onAuthFailure(code: string) {
    if (code === 'not-allowed') void forget(ERRORS['not-allowed']).then(() => auth?.signOut());
    else void forget(code === 'session-revoked' ? '이 기기는 로그아웃됐어요(다른 기기에서 철회). 다시 로그인해 주세요.' : ERRORS.auth);
  }

  /** 방금 받은 ID 토큰으로 기기 세션을 만든다. */
  async function startSession(user: AuthUser, idToken: string, label: string) {
    const r = await api!.createSession(idToken, label);
    if (!r.ok) {
      if (r.kind === 'not-allowed') await auth!.signOut();
      error = describeFail(r);
      return;
    }
    // 동기화 상태(켜짐·대기 작업·리비전·충돌)는 계정에 묶는다. 다른 계정이면 버리고, 다시 켤 때 올릴 것을 확인받는다.
    const owner = await store!.getMeta<string>(OWNER_KEY);
    if (owner !== user.uid) {
      if (owner !== undefined) await engine?.reset();
      await store!.setMeta(OWNER_KEY, user.uid);
    }
    session = { id: r.data.sessionId, email: user.email ?? '' };
    await store!.setMeta(SESSION_KEY, session);
    account = { email: session.email };
    error = null;
    if (engine?.status().enabled) await engine.syncNow();
  }

  async function guarded<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    busy = true;
    try {
      return await fn();
    } catch {
      error = ERRORS.server;
      return fallback;
    } finally {
      busy = false;
    }
  }

  const ok = <T>(r: { ok: true; data: T } | ApiFail): T | null => {
    if (r.ok) return r.data;
    error = describeFail(r);
    return null;
  };

  const ctl: SyncController = {
    configured: config !== null,
    get account() {
      return account;
    },
    get status() {
      return status;
    },
    get busy() {
      return busy;
    },
    get error() {
      return error;
    },
    api,

    async attach(app) {
      if (!config || !api || !auth) return;
      store = await (deps.store ?? (() => openSyncStore()))();
      engine = createSyncEngine({ local: appProfiles(app, deps.storage), store, api, now, lock: deps.lock ?? webLock, onAuthFailure });
      cleanups.push(engine.subscribe((s) => (status = s)));
      await engine.init();
      session = (await store.getMeta<{ id: string; email: string }>(SESSION_KEY)) ?? null;
      if (await store.getMeta<boolean>(REDIRECT_KEY)) {
        await store.deleteMeta(REDIRECT_KEY);
        try {
          const back = await auth.redirectResult();
          if (back) await startSession(back.user, back.idToken, (deps.deviceLabel ?? defaultLabel)());
        } catch {
          // 리다이렉트 결과가 없거나 읽지 못했다
        }
      }
      if (session) {
        // 저장된 세션이 있을 때만 SDK를 불러 로그인 상태를 확인한다. 오프라인이라 SDK를 못 불러오면 세션은 그대로 두고 나중에 보낸다.
        let user: Awaited<ReturnType<AuthClient['ready']>> | 'unavailable';
        try {
          user = await auth.ready();
        } catch {
          user = 'unavailable';
        }
        const owner = await store.getMeta<string>(OWNER_KEY);
        // SDK에 남은 로그인이 없거나 다른 계정이면 저장된 세션을 쓰지 않는다(다시 로그인하면 계정을 맞춘다)
        if (user === null || (user !== 'unavailable' && owner !== undefined && user.uid !== owner)) await forget(null);
        else {
          account = { email: session.email };
          if (status.enabled && user !== 'unavailable') await engine.syncNow();
        }
      }
      if (typeof window !== 'undefined') {
        const onFocus = () => {
          if (!session || !status.enabled || document.visibilityState === 'hidden') return;
          if (now() - lastFocusPull < FOCUS_PULL_INTERVAL) return;
          lastFocusPull = now();
          void engine?.syncNow();
        };
        const onOnline = () => {
          if (session && status.enabled) void engine?.flush();
        };
        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onFocus);
        window.addEventListener('online', onOnline);
        cleanups.push(() => {
          window.removeEventListener('focus', onFocus);
          document.removeEventListener('visibilitychange', onFocus);
          window.removeEventListener('online', onOnline);
        });
      }
      lastFocusPull = now();
    },

    onSyncableChange(e) {
      if (!engine) return;
      if (e.kind === 'deleted') void engine.profileDeleted(e.profileId);
      else if (session) engine.profileChanged(e.profileId);
    },

    signIn: (label) =>
      guarded(async () => {
        if (!auth || !store) return;
        error = null;
        // 팝업이 막히면 SDK가 리다이렉트로 페이지를 떠난다. 돌아왔을 때 결과를 읽도록 먼저 적어 둔다.
        await store.setMeta(REDIRECT_KEY, true);
        const r = await auth.signIn();
        if (r === 'redirect') return;
        await store.deleteMeta(REDIRECT_KEY);
        if (r === null) return;
        await startSession(r.user, r.idToken, label?.trim() || (deps.deviceLabel ?? defaultLabel)());
      }, undefined),

    signOut: () =>
      guarded(async () => {
        if (session && api) await api.endSession(); // 실패해도 이 기기에서는 로그아웃한다
        await forget(null);
        await auth?.signOut();
      }, undefined),

    preview: () =>
      guarded(async () => {
        if (!engine) return null;
        const r = await engine.preview();
        return 'upload' in r ? r : ok(r);
      }, null),

    setEnabled: (on) => guarded(async () => void (await engine?.setEnabled(on)), undefined),
    syncNow: () =>
      guarded(async () => {
        lastFocusPull = now();
        await engine?.syncNow();
      }, undefined),
    resolve: (id, choice) => guarded(async () => void (await engine?.resolve(id, choice)), undefined),
    remoteProfiles: () => guarded(async () => (api ? (ok(await api.listProfiles())?.profiles ?? null) : null), null),
    restoreDeleted: (id) =>
      guarded(async () => {
        if (!api || !engine) return false;
        const r = ok(await api.restoreProfile(id, crypto.randomUUID()));
        if (r) await engine.syncNow();
        return r !== null;
      }, false),
    revisions: (id) => guarded(async () => (api ? (ok(await api.listRevisions(id))?.revisions ?? null) : null), null),
    restoreRevision: (id, rev) =>
      guarded(async () => {
        if (!engine) return null;
        const r = await engine.restoreRevision(id, rev);
        return r.ok ? r.profileId : (error = describeFail(r), null);
      }, null),
    sessions: () => guarded(async () => (api ? (ok(await api.listSessions())?.sessions ?? null) : null), null),
    revokeSession: (id) => guarded(async () => (api ? ok(await api.revokeSession(id)) !== null : false), false),
    shares: () => guarded(async () => (api ? (ok(await api.listShares())?.shares ?? null) : null), null),
    createShare: (profileId, kind, snapshot, ttlDays) =>
      guarded(async () => {
        if (!api || !engine) return null;
        // 공유 원본 프로필이 서버에 있어야 한다. 동기화가 꺼져 있으면 올라간 적이 없으니 먼저 켜 달라고 한다.
        if (!engine.status().enabled) {
          error = ERRORS['sync-off'];
          return null;
        }
        await engine.flush();
        const r = ok(await api.createShare({ sourceProfileId: profileId, kind, snapshot, ttlDays }));
        if (!r) return null;
        return { url: `${location.origin}${location.pathname}#/s/${r.capability}`, expiresAt: r.expiresAt };
      }, null),
    revokeShare: (id) => guarded(async () => (api ? ok(await api.revokeShare(id)) !== null : false), false),
    clearError() {
      error = null;
    },
    clearNotices() {
      engine?.clearNotices();
    },
    destroy() {
      for (const c of cleanups.splice(0)) c();
      engine?.destroy();
    },
  };
  return ctl;
}
