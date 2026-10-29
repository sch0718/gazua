// 설정 화면·공유가 쓰는 동기화 상태. 공급자 로그인 → 기기 세션 → 동기화 엔진을 묶는다.
// 로그인·세션이 없거나 실패해도 로컬 사용은 그대로다. 동기화 설정이 없는 빌드에서는 configured=false로 아무것도 하지 않는다.
import { showSnackbar } from '@sch0718/ui-svelte';
import type { App } from '../state/app.svelte';
import type { SafeStorage } from '../state/storage';
import type { ShareKind, ShareSnapshot } from '../share/snapshot';
import { createSyncApi, type ApiFail, type DeviceSession, type IndexRow, type ShareRow, type SyncApi } from './api';
import { firebaseAuth, type AuthClient, type AuthUser } from './auth';
import type { SyncConfig } from './config';
import { createSyncEngine, type Resolution, type SyncEngine, type SyncStatus } from './engine';
import { appProfiles } from './local';
import { openSyncStore, type SyncStore } from './store';
import { PROVIDER_NAMES, type LoginProvider, type SocialOutcome, type SocialReturn } from './social';
import type { SocialProvider } from '@sch0718/firebase-session/client';

/** 포커스로 다시 받는 최소 간격(할당량 절약). */
export const FOCUS_PULL_INTERVAL = 5 * 60 * 1000;

/** 세션 요청은 계속 두고 기다림만 끝내요. */
export const SOCIAL_SESSION_TIMEOUT = 20_000;
/** 저장한 재인증 플래그를 읽기 위해 연결을 기다리는 상한이에요. */
export const REAUTH_READ_WAIT = 1500;

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
  socialStorage?: Storage;
  navigate?: (url: string) => void;
  random?: (n: number) => Uint8Array;
  origin?: string;
  socialTimeout?: number;
  reauthReadWait?: number;
  notify?: (message: string) => void;
}

export interface SyncAccount {
  provider: LoginProvider;
  /** Google 이메일, 소셜은 공급자 계정(kakao:<sub>) */
  id: string;
  /** Google 이메일, 소셜은 확인 안 된 이메일이나 계정 ID */
  display: string;
}

export interface SyncController {
  readonly configured: boolean;
  readonly providers: { google: boolean; kakao: boolean; naver: boolean };
  /** 로그인·세션까지 된 계정. */
  readonly account: SyncAccount | null;
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
  signInWith(provider: SocialProvider, label?: string, returnHash?: string, opts?: { reauth?: boolean }): Promise<void>;
  completeSocialSignIn(ret: SocialReturn, opts?: { onLate?: (outcome: SocialOutcome) => void }): Promise<SocialOutcome>;
  abandonSocialSignIn(): void;
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
type SessionMeta = { id: string; email: string; provider?: SocialProvider; account?: string; display?: string };
/** 이 기기의 동기화 상태가 속한 계정. 다른 계정으로 로그인하면 상태를 버린다. */
const OWNER_KEY = 'owner';
/** 리다이렉트 로그인을 시작했다. 있을 때만 시작 시 결과를 읽는다(그 밖에는 Firebase를 불러오지 않는다). */
const REDIRECT_KEY = 'redirect-pending';
// 로그아웃 뒤 재인증 요청은 로그인 성공까지 남긴다.
const SOCIAL_REAUTH_KEY = 'social-reauth';

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
  const providers = { google: !!config?.firebase, kakao: !!config?.social?.kakao, naver: !!config?.social?.naver };
  let account = $state<SyncAccount | null>(null);
  let status = $state<SyncStatus>({ enabled: false, phase: 'off', pending: 0, conflicts: [], rejected: [], lastSyncAt: null, notices: [], volatile: false });
  let busy = $state(false);
  let error = $state<string | null>(null);

  let store: SyncStore | null = null;
  let engine: SyncEngine | null = null;
  let session: SessionMeta | null = null;
  let socialReauth = false;
  // 사용자 동작이 시작할 때 올려요. 기다림을 끝낸 소셜 응답이 새 선택을 덮어쓰지 않게 해요.
  let authGeneration = 0;
  let socialAttempt: { escape: () => void } | null = null;
  const notify = deps.notify ?? showSnackbar;
  let didAttach!: () => void;
  const attached = new Promise<void>((resolve) => didAttach = resolve);
  let lastFocusPull = 0;
  const auth: AuthClient | null = deps.auth ?? (config?.firebase ? firebaseAuth(config.firebase) : null);
  const api: SyncApi | null = config
    ? createSyncApi(
        config.apiUrl,
        { idToken: async (force) => (session && !session.provider && auth ? auth.idToken(force) : null), sessionId: async () => session?.id ?? null },
        deps.fetchImpl,
      )
    : null;
  const cleanups: (() => void)[] = [];

  async function needsSocialReauth(): Promise<boolean> {
    if (socialReauth) return true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const ready = await Promise.race([
        attached.then(() => true),
        new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), deps.reauthReadWait ?? REAUTH_READ_WAIT); }),
      ]);
      if (!ready || !store) return true;
      return (await store.getMeta<boolean>(SOCIAL_REAUTH_KEY)) === true;
    } catch {
      return true;
    } finally {
      clearTimeout(timer);
    }
  }

  async function clearSocialReauth(isCurrent = () => true) {
    await store?.deleteMeta(SOCIAL_REAUTH_KEY);
    if (!isCurrent()) {
      // 삭제를 기다리는 사이 로그아웃이 세운 재인증 플래그는 되돌려요.
      if (socialReauth) await store?.setMeta(SOCIAL_REAUTH_KEY, true);
      return;
    }
    socialReauth = false;
  }

  async function forget(message: string | null) {
    // 세션 철회 응답 등에서도 쓰므로 사용자 동작의 세대는 여기서 올리지 않아요.
    const mine = session?.id;
    session = null;
    account = null;
    if (message) error = message;
    // 저장된 세션이 이 탭이 버리는 것과 같을 때만 지운다. 다른 탭이 그 사이 새로 로그인했으면 그 세션을 지키기 위해서다.
    const stored = await store?.getMeta<{ id: string }>(SESSION_KEY);
    if (stored && stored.id === mine) await store?.deleteMeta(SESSION_KEY);
  }

  function onAuthFailure(code: string, usedSession?: string) {
    // 그 사이 로그아웃·다시 로그인해 세션이 바뀌었으면, 이전 세션으로 나간 요청의 실패는 새 로그인과 상관없다
    if (usedSession !== undefined && session?.id !== usedSession) return;
    if (code === 'not-allowed') {
      const provider = session?.provider ?? 'google';
      void forget(`이 ${PROVIDER_NAMES[provider]} 계정은 허용 목록에 없어요.`).then(() => provider === 'google' ? auth?.signOut() : undefined);
    }
    else void forget(code === 'session-revoked' ? '이 기기는 로그아웃됐어요(다른 기기에서 철회). 다시 로그인해 주세요.' : ERRORS.auth);
  }

  /** 방금 받은 ID 토큰으로 기기 세션을 만든다. */
  async function startSession(user: AuthUser, idToken: string, label: string) {
    ++authGeneration;
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
    account = { provider: 'google', id: session.email, display: session.email };
    await clearSocialReauth();
    error = null;
    if (engine?.status().enabled) await engine.syncNow();
  }

  function socialSessionFailure(r: ApiFail, provider: SocialProvider): SocialOutcome {
    const reason = r.kind === 'not-allowed' || r.kind === 'limit' || r.kind === 'offline' ? r.kind
      : r.kind === 'auth' ? r.code === 'invalid-code' ? 'invalid-code' : 'invalid-token'
      : r.kind === 'not-found' ? 'not-enabled' : r.kind === 'server' && r.status === 400 ? 'bad-request' : 'server';
    return { ok: false, provider, reason, ...(r.kind === 'not-allowed' && r.account && { account: r.account }) };
  }

  async function discardLateSession(id: string) {
    // 이 응답이 저장한 세션만 정리해요. 그 사이 새로 로그인한 다른 세션은 지켜요.
    if (session?.id === id) {
      session = null;
      account = null;
    }
    try {
      const stored = await store?.getMeta<SessionMeta>(SESSION_KEY);
      if (stored?.id === id) await store?.deleteMeta(SESSION_KEY);
    } catch { /* 로컬 정리도 가능한 만큼 해요. */ }
    try {
      await api!.endSessionById(id);
    } catch { /* 철회하지 못한 고아 세션은 서버에서 만료로 정리돼요. */ }
  }

  async function acceptSocialSession(
    data: Extract<Awaited<ReturnType<SyncApi['createSocialSession']>>, { ok: true }>['data'],
    provider: SocialProvider,
    attempt: { generation: number; escaped: boolean },
  ) {
    // accept도 새 로그인이에요. 이후에는 자신이 올린 세대를 기준으로 확인해요.
    attempt.generation = ++authGeneration;
    const isCurrent = () => !attempt.escaped || attempt.generation === authGeneration;
    const previous = session;
    if (previous) {
      try { await api!.endSession(); } catch { /* 이전 세션 정리는 가능한 만큼 해요. */ }
      if (!isCurrent()) return;
      if (!previous.provider) {
        try { await auth?.signOut(); } catch { /* 새 로그인은 이어 가요. */ }
        if (!isCurrent()) return;
      }
    }
    const user = data.user;
    const owner = await store!.getMeta<string>(OWNER_KEY);
    if (!isCurrent()) return;
    if (owner !== user.sub) {
      if (owner !== undefined) {
        await engine?.reset();
        if (!isCurrent()) return;
      }
      await store!.setMeta(OWNER_KEY, user.sub);
      if (!isCurrent()) return;
    }
    const next: SessionMeta = { id: data.sessionId, email: '', provider, account: user.sub, display: user.unverifiedEmail ?? user.sub };
    await store!.setMeta(SESSION_KEY, next);
    if (!isCurrent()) return;
    session = next;
    account = { provider, id: user.sub, display: next.display! };
    await clearSocialReauth(isCurrent);
    if (!isCurrent()) return;
    error = null;
    if (engine?.status().enabled) await engine.syncNow();
  }

  async function notifySocialOutcome(outcome: SocialOutcome, isCurrent = () => true) {
    if (outcome.ok) {
      notify(`${PROVIDER_NAMES[outcome.provider]} 계정으로 로그인했어요`);
      return;
    }
    let message = ERRORS.server;
    try {
      const { socialFailureText } = await import('./socialText');
      message = socialFailureText(outcome).title;
    } catch { /* 안내 청크를 못 받아도 일반 오류를 알려요. */ }
    if (!isCurrent()) return;
    error = message;
    notify(message);
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
    // 관리 요청(기기·공유·과거 버전 등)이 세션 문제로 실패해도 엔진과 같은 정리로 로그인 필요 상태로 돌린다
    if (r.kind === 'auth') onAuthFailure(r.code, r.session);
    else if (r.kind === 'not-allowed') onAuthFailure('not-allowed');
    else error = describeFail(r);
    return null;
  };

  const ctl: SyncController = {
    configured: config !== null,
    providers,
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
      try {
        if (!config || !api) return;
        store = await (deps.store ?? (() => openSyncStore()))();
        engine = createSyncEngine({ local: appProfiles(app, deps.storage), store, api, now, lock: deps.lock ?? webLock, onAuthFailure });
        cleanups.push(engine.subscribe((s) => (status = s)));
        await engine.init();
        session = (await store.getMeta<SessionMeta>(SESSION_KEY)) ?? null;
        if (!session?.provider && auth && await store.getMeta<boolean>(REDIRECT_KEY)) {
          await store.deleteMeta(REDIRECT_KEY);
          try {
            const back = await auth.redirectResult();
            if (back) await startSession(back.user, back.idToken, (deps.deviceLabel ?? defaultLabel)());
          } catch {
            // 리다이렉트 결과가 없거나 읽지 못했다
          }
        }
        if (session?.provider) {
          const id = session.account ?? '';
          account = { provider: session.provider, id, display: session.display ?? id };
          if (status.enabled) await engine.syncNow();
        } else if (session && auth) {
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
            account = { provider: 'google', id: session.email, display: session.email };
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
      } finally {
        didAttach();
      }
    },

    onSyncableChange(e) {
      if (!engine) return;
      if (e.kind === 'deleted') void engine.profileDeleted(e.profileId);
      else if (session) engine.profileChanged(e.profileId);
    },

    signIn: (label) => {
      ++authGeneration;
      return guarded(async () => {
        if (!providers.google || !auth || !store) return;
        error = null;
        // 팝업이 막히면 SDK가 리다이렉트로 페이지를 떠난다. 돌아왔을 때 결과를 읽도록 먼저 적어 둔다.
        await store.setMeta(REDIRECT_KEY, true);
        const r = await auth.signIn();
        if (r === 'redirect') return;
        await store.deleteMeta(REDIRECT_KEY);
        if (r === null) return;
        await startSession(r.user, r.idToken, label?.trim() || (deps.deviceLabel ?? defaultLabel)());
      }, undefined);
    },

    signInWith: (provider, label, returnHash, opts) => {
      ++authGeneration;
      return guarded(async () => {
        if (!config || !providers[provider]) {
          error = `이 빌드에는 ${PROVIDER_NAMES[provider]} 로그인이 설정되지 않았어요.`;
          return;
        }
        error = null;
        let flow: typeof import('./socialFlow');
        try {
          flow = await import('./socialFlow');
        } catch {
          error = '로그인 화면을 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요.';
          return;
        }
        try {
          const reauth = opts?.reauth || await needsSocialReauth();
          await flow.startSocialSignIn(provider, {
            clientId: config.social![provider]!.clientId, apiUrl: config.apiUrl,
            label: label?.trim() ?? '', returnHash: returnHash ?? (globalThis.location?.hash || '#/settings'),
            storage: deps.socialStorage, navigate: deps.navigate, random: deps.random, origin: deps.origin, now,
            reauth,
          });
        } catch {
          error = '이 브라우저에서는 로그인을 시작할 수 없어요. 저장소를 쓸 수 없어요(사생활 보호 모드 등). 다른 브라우저로 열어 주세요.';
        }
      }, undefined);
    },

    async completeSocialSignIn(ret, opts) {
      const generation = ++authGeneration;
      const cb = ret.callback;
      const provider = cb?.provider ?? null;
      busy = true;
      let escape!: () => void;
      const fallback: SocialOutcome = { ok: false, provider, reason: 'timeout' };
      const escapeResult = new Promise<SocialOutcome>((resolve) => {
        escape = () => {
          if (attempt.escaped) return;
          attempt.escaped = true;
          clearTimeout(timer);
          busy = false;
          resolve(fallback);
        };
      });
      const attempt = { escape, generation, escaped: false };
      const isCurrent = () => !attempt.escaped || attempt.generation === authGeneration;
      socialAttempt = attempt;
      const timer = setTimeout(escape, deps.socialTimeout ?? SOCIAL_SESSION_TIMEOUT);
      const request = (async (): Promise<SocialOutcome> => {
        try {
          await attached;
          // 설정이 없으면 대기 요청보다 빌드 설정을 먼저 안내해요.
          if (!config || (provider && !providers[provider])) return { ok: false, provider, reason: 'not-configured' };
          if (!cb) return { ok: false, provider, reason: 'no-pending' };
          if (!cb.ok) return { ok: false, provider, reason: cb.reason === 'redirect-mismatch' || cb.reason === 'state-mismatch' ? 'mismatch' : cb.reason, ...(cb.error && { error: cb.error }) };
          const r = await api!.createSocialSession(cb, ret.label.trim() || (deps.deviceLabel ?? defaultLabel)());
          if (!r.ok) return socialSessionFailure(r, cb.provider);
          try {
            if (isCurrent()) await acceptSocialSession(r.data, cb.provider, attempt);
          } finally {
            if (!isCurrent()) await discardLateSession(r.data.sessionId);
          }
          return { ok: true, provider: cb.provider };
        } catch {
          if (!attempt.escaped) error = ERRORS.server;
          return { ok: false, provider, reason: 'server' };
        }
      })().then(async (outcome) => {
        if (attempt.escaped && isCurrent()) {
          await notifySocialOutcome(outcome, isCurrent);
          if (isCurrent()) opts?.onLate?.(outcome);
        }
        return outcome;
      });
      try {
        return await Promise.race([request, escapeResult]);
      } finally {
        clearTimeout(timer);
        if (socialAttempt === attempt) socialAttempt = null;
        // 기다림을 끝낸 시도는 다른 작업의 busy를 바꾸지 않아요.
        if (!attempt.escaped) busy = false;
      }
    },

    abandonSocialSignIn() {
      socialAttempt?.escape();
    },

    signOut: () => {
      ++authGeneration;
      return guarded(async () => {
        socialReauth = true;
        const social = !!session?.provider;
        if (session && api) await api.endSession(); // 실패해도 이 기기에서는 로그아웃한다
        await forget(null);
        await store?.setMeta(SOCIAL_REAUTH_KEY, true);
        if (!social) await auth?.signOut();
      }, undefined);
    },

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
