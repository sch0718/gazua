// 설정 화면·공유가 쓰는 동기화 상태. 공급자 로그인 → 기기 세션 → 동기화 엔진을 묶는다.
// 로그인·세션이 없거나 실패해도 로컬 사용은 그대로다. 동기화 설정이 없는 빌드에서는 configured=false로 아무것도 하지 않는다.
import { showSnackbar } from '@sch0718/ui-svelte';
import type { App } from '../state/app.svelte';
import type { SafeStorage } from '../state/storage';
import type { ShareKind, ShareSnapshot } from '../share/snapshot';
import { createSyncApi, type ApiFail, type CliTokenRow, type DeviceSession, type IndexRow, type MemberRow, type ShareRow, type SyncApi } from './api';
import { clearInvite, readInvite } from './invite';
import { firebaseAuth, type AuthClient, type AuthUser } from './auth';
import type { SyncConfig } from './config';
import { APP_OUTDATED_TEXT, createSyncEngine, type Resolution, type SyncEngine, type SyncStatus } from './engine';
import { APP_OUTDATED_CODE } from './dto';
import { appProfiles } from './local';
import { migrateStrategies } from './migrate';
import { openSyncStore, type ProfileSyncState, type SyncStore } from './store';
import { checkVerifier, deriveVaultKey, makeVerifier, randomId, samePassphrase } from './keyCrypto';
import { openKeyStore, type KeyStore, type KeySyncState } from './keyStore';
import {
  createKeySync,
  KEY_TEXT,
  keyFailText,
  type KeyAccountNotice,
  type KeyFail,
  type KeyResult,
  type KeySync,
  type PreparedReceive,
  type SavedVault,
  type VaultKey,
} from './keySync';
import { checkMarketFiles, type MarketFileRow } from '../marketData/manifest';
import { marketOwnerTag } from '../marketData/owner';
import { checkVaultHead, KEY_ITER, type KeyProvider } from './keyWire';
import { PROVIDER_NAMES, type LoginProvider, type SocialOutcome, type SocialReturn } from './social';
import type { SocialProvider } from '@sch0718/firebase-session/client';

/** 포커스로 다시 받는 최소 간격(할당량 절약). */
export const FOCUS_PULL_INTERVAL = 5 * 60 * 1000;

/** 세션 요청은 계속 두고 기다림만 끝내요. */
export const SOCIAL_SESSION_TIMEOUT = 20_000;
/** 저장한 재인증 플래그를 읽기 위해 연결을 기다리는 상한이에요. */
export const REAUTH_READ_WAIT = 1500;

/** 이 기기 키 변경 뒤 키 단계를 돌리기까지(설계 5.6-2). 엔진의 프로필 디바운스와 따로 둔다(5.3) */
export const KEY_DEBOUNCE_MS = 3000;
/** 탭 사이 마스터 키 잊기 알림(설계 5.12) */
export const KEY_CHANNEL = 'gazua-keys';

/** 설정 화면이 그리는 키 동기화 상태. 비밀값은 없다 */
export interface KeyView {
  /** 서버가 /v1/keys를 아는가(마지막 키 단계). 아직 모르면 null */
  support: boolean | null;
  vault: SavedVault | null;
  accountNotice: KeyAccountNotice;
  states: KeySyncState[];
  /** 키 영역 문구(서버 응답이 맞지 않아요 등) */
  problem: string | null;
  /** 이 탭이 지금 금고의 마스터 키를 기억하는가 */
  remembered: boolean;
  /** 키 상태가 IndexedDB에 남는가 */
  persistent: boolean;
  /** 동기화 엔진이 서버에 올렸다고 확인한 프로필(켤 수 있는 조건, 설계 1.4) */
  uploaded: string[];
}

/** 키 동기화 동작. KDF는 잠금 밖에서, 네트워크·저장은 엔진 직렬화 안에서 한다 */
export interface SyncKeys {
  readonly view: KeyView;
  createVault(pass: string): Promise<KeyResult>;
  unlockVault(pass: string): Promise<KeyResult>;
  enable(profileId: string, providers: KeyProvider[]): Promise<KeyResult>;
  setProviders(profileId: string, providers: KeyProvider[]): Promise<KeyResult>;
  /** 받을 블롭을 풀어 둔다. 화면에는 덮어쓸 공급자만 돌려준다 */
  prepareReceive(profileId: string): Promise<{ ok: true; overwrite: KeyProvider[] } | KeyFail>;
  /** 풀어 둔 키를 저장한다. 이 기기 키 잠금이면 lockPass를 먼저 확인한다 */
  commitReceive(lockPass?: string): Promise<KeyResult>;
  cancelReceive(): void;
  uploadLocal(profileId: string): Promise<KeyResult>;
  disable(profileId: string): Promise<KeyResult>;
  changePassphrase(current: string, next: string): Promise<KeyResult>;
  wipe(): Promise<KeyResult>;
  forget(): void;
  dismiss(profileId: string): Promise<void>;
  dismissAccount(): Promise<void>;
}

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
  /** 키 동기화 상태 저장소. 기본은 IndexedDB `gazua-sync-keys` */
  keyStore?: () => Promise<KeyStore>;
  /** 키 변경 뒤 키 단계까지 기다리는 시간(기본 KEY_DEBOUNCE_MS) */
  keyDebounceMs?: number;
}

export interface SyncAccount {
  provider: LoginProvider;
  /** Google 이메일, 소셜은 공급자 계정(kakao:<sub>) */
  id: string;
  /** Google 이메일, 소셜은 확인 안 된 이메일이나 계정 ID */
  display: string;
}

export type CliApproveResult =
  | { ok: true; info: { label: string; createdAt: number; geo: string | null; scope: 'read' | 'market-upload' } }
  | { ok: false; reason: 'invalid-code' | 'outdated' | 'error' };
export type MarketFilesResult = { ok: true; files: MarketFileRow[] } | { ok: false; reason: 'signed-out' | 'outdated' | 'error' };
export type CliTokensResult = { ok: true; tokens: CliTokenRow[] } | { ok: false; reason: 'outdated' | 'error' };
export type MembersResult = { ok: true; members: MemberRow[]; limit: number } | { ok: false; reason: 'not-admin' | 'error' };

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
  /** 초대 링크로 받은 코드가 있어 로그인하면 가입된다(로그인 전 안내용) */
  readonly invitePending: boolean;
  /** 앱이 만들어진 뒤 한 번 연결한다. */
  attach(app: App): Promise<void>;
  /** createApp의 onSyncableChange에 넘긴다. */
  onSyncableChange(e: { kind: 'changed' | 'deleted'; profileId: string }): void;
  /** 키 동기화(설계 5절) */
  readonly keys: SyncKeys;
  /** createApp의 onSecretsChange에 넘긴다 */
  onSecretsChange(e: { profileId: string; providers: KeyProvider[] }): void;
  /** createApp의 onLock에 넘긴다 */
  onLock(): void;
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
  /** 시장 파일 manifest(설계 2026-11-02-market-drive). 404는 옛 Worker */
  marketFiles(): Promise<MarketFilesResult>;
  wipeMarketFiles(): Promise<boolean>;
  /** 로그인한 동안 이 계정의 시장 파일 표시(marketData/owner.ts), 아니면 null. attach가 끝난 뒤 판정한다 */
  marketOwner(): Promise<string | null>;
  /** 422 invalid-code·404(옛 Worker)는 배너 없이 사유로 돌려준다 */
  cliApprove(userCode: string, approve?: boolean): Promise<CliApproveResult>;
  cliTokens(): Promise<CliTokensResult>;
  cliRevoke(id: string): Promise<boolean>;
  /** 관리자가 아니면(403) 배너 없이 not-admin */
  members(): Promise<MembersResult>;
  removeMember(identity: string): Promise<boolean>;
  clearError(): void;
  clearNotices(): void;
  destroy(): void;
}

const ERRORS: Record<string, string> = {
  offline: '서버에 연결할 수 없어요. 연결되면 다시 보내요.',
  'not-allowed': '초대가 필요하거나 이용이 끝난 계정이에요.',
  'invite-invalid': '초대 링크가 맞지 않아요.',
  'members-full': '초대 자리가 다 찼어요. 자리가 나면 다시 로그인해 주세요.',
  'invite-limit': '잠시 뒤 다시 시도해 주세요.',
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

export const SHARE_TOO_LARGE_TEXT = '공유 내용이 너무 커요(100 KB). 기간이나 종목을 줄여 주세요';

/** ctx: 공유 요청이면 'share'. 422·413 too-large를 공유 한도(100 KB) 문구로 보인다(설계 7절) */
export const describeFail = (f: ApiFail, ctx: 'profile' | 'share' = 'profile'): string =>
  f.kind === 'invalid' && f.code === APP_OUTDATED_CODE
    ? APP_OUTDATED_TEXT
    : f.kind === 'invite'
      ? ERRORS[f.code]
    : f.kind === 'limit' && (f.code === 'share-limit' || f.code === 'invite-limit')
      ? ERRORS[f.code]
      : f.kind === 'invalid' && f.code === 'too-large'
        ? ctx === 'share'
          ? SHARE_TOO_LARGE_TEXT
          : ERRORS['too-large']
        : (ERRORS[f.kind] ?? ERRORS.server);

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

  // ── 키 동기화(설계 5.12) ─────────────────────────────
  let keyStore: KeyStore | null = null;
  let keySync: KeySync | null = null;
  let appRef: App | null = null;
  /** 탭 메모리의 마스터 키(추출 불가 CryptoKey). 저장소에 두지 않는다 */
  let vaultKey: VaultKey | null = null;
  /** 받기 확인 사이에 쥔 평문. 화면에는 넘기지 않는다 */
  let pendingReceive: PreparedReceive | null = null;
  /** 이 탭 메모리의 소유자(OWNER_KEY와 같은 값). 키 단계가 저장값과 견준다(5.12 #5) */
  let ownerId: string | null = null;
  let keyTimer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;
  // 잠금 밖 KDF·받기가 끝나기 전에 잊었으면 그 결과를 다시 기억하지 않는다.
  let keyGeneration = 0;
  let keyOperationGeneration = 0;
  let receiveGeneration = 0;
  let keyRefreshSequence = 0;
  let keyView = $state<KeyView>({ support: null, vault: null, accountNotice: null, states: [], problem: null, remembered: false, persistent: true, uploaded: [] });
  // 동기화 설정이 없는 빌드(e2e 등)에서는 채널을 열지 않는다
  const keyChannel = config && typeof BroadcastChannel === 'function' ? new BroadcastChannel(KEY_CHANNEL) : null;
  keyChannel?.addEventListener('message', (e) => {
    if ((e as MessageEvent<{ type?: string }>).data?.type === 'forget') forgetVaultKey();
  });

  function clearKeyTimer() {
    if (keyTimer !== null) clearTimeout(keyTimer);
    keyTimer = null;
  }
  /** keyOperationGeneration은 exclusive 진입점(keyAction·prepareReceive·키 단계)에서 정한다. */
  function setVaultKey(key: VaultKey | null, generation = keyOperationGeneration): boolean {
    if (!key) {
      forgetVaultKey();
      return true;
    }
    if (destroyed || generation !== keyGeneration) return false;
    vaultKey = key;
    return true;
  }
  /** 마스터 키를 잊는다. broadcast면 다른 탭에도 알린다(로그아웃·계정 전환·전체 삭제·암호 바꾸기) */
  function forgetVaultKey(broadcast = false) {
    ++keyGeneration;
    vaultKey = null;
    pendingReceive = null;
    keyView.remembered = false;
    clearKeyTimer();
    if (broadcast && !destroyed) keyChannel?.postMessage({ type: 'forget' });
    void refreshKeys();
  }
  function scheduleKeys() {
    if (destroyed || !session || !status.enabled || !engine) return;
    clearKeyTimer();
    keyTimer = setTimeout(() => {
      keyTimer = null;
      void engine?.keysNow().then(refreshKeys);
    }, deps.keyDebounceMs ?? KEY_DEBOUNCE_MS);
  }
  /** 키 변경을 이 기기에 기록하지 못했을 때의 안내(다음에 기록이 성공하면 지운다) */
  let keyRecordProblem: string | null = null;
  async function refreshKeys() {
    const sequence = ++keyRefreshSequence;
    const ks = keyStore;
    if (!ks) return;
    try {
      const [states, vault, notice, support, synced] = await Promise.all([
        ks.states(),
        ks.getMeta<SavedVault | null>('keyVault'),
        ks.getMeta<KeyAccountNotice>('keyNotice'),
        ks.getMeta<boolean>('keySupport'),
        store ? store.states() : Promise.resolve([] as ProfileSyncState[]),
      ]);
      if (sequence !== keyRefreshSequence) return;
      const v = vault ?? null;
      keyView = {
        support: support ?? null,
        vault: v,
        accountNotice: notice ?? null,
        states,
        problem: keySync?.problem() ?? keyRecordProblem,
        remembered: !!v && !!vaultKey && vaultKey.vaultId === v.vaultId && vaultKey.salt === v.salt && vaultKey.vaultRevision === v.vaultRevision,
        persistent: ks.persistent,
        uploaded: synced.filter((s) => s.syncedRevision > 0 && !s.deleted).map((s) => s.profileId),
      };
    } catch {
      // 화면 갱신의 읽기 실패가 호출한 키 동작의 결과를 덮지 않게 한다.
    }
  }
  async function sessionOk(): Promise<boolean> {
    if (destroyed || !session || !store) return false;
    const stored = await store.getMeta<SessionMeta>(SESSION_KEY);
    const owner = (await store.getMeta<string>(OWNER_KEY)) ?? null;
    return stored?.id === session.id && owner === ownerId;
  }
  /** 엔진 직렬화 안에서 키 동작을 하고, 판정이 바뀌었으면 키 단계를 다시 돈다 */
  async function keyAction(fn: (ks: KeySync) => Promise<KeyResult>, generation = keyGeneration): Promise<KeyResult> {
    const ks = keySync;
    const eng = engine;
    if (!ks || !eng) return { ok: false, message: KEY_TEXT.server };
    try {
      const r = await eng.exclusive(() => {
        if (destroyed || generation !== keyGeneration) return Promise.resolve<KeyFail>({ ok: false, message: null });
        keyOperationGeneration = generation;
        return fn(ks);
      });
      if (!r.ok && r.recheck) await eng.keysNow();
      return r;
    } catch {
      return { ok: false, message: KEY_TEXT.server };
    } finally {
      await refreshKeys();
    }
  }
  /** 금고 머리를 받아 이 암호로 만든 키가 맞는지 본다(잠금 밖 KDF) */
  async function keyFromPass(pass: string): Promise<{ key: VaultKey } | KeyFail> {
    const eng = engine;
    const keyApi = api;
    if (!keyApi || !eng || destroyed) return { ok: false, message: KEY_TEXT.server };
    const l = await eng.exclusive(async () => {
      if (!(await sessionOk())) {
        forgetVaultKey();
        return null;
      }
      return keyApi.listKeys();
    });
    if (!l) return { ok: false, message: KEY_TEXT.auth };
    if (!l.ok) {
      if (l.kind === 'auth') onAuthFailure(l.code, l.session);
      else if (l.kind === 'not-allowed') onAuthFailure('not-allowed');
      return { ok: false, message: keyFailText(l) };
    }
    if (!l.data || typeof l.data !== 'object') return { ok: false, message: KEY_TEXT.badResponse };
    const head = l.data.keyVault === null ? null : checkVaultHead(l.data.keyVault);
    if (!head) return { ok: false, message: l.data.keyVault === null ? KEY_TEXT.noVault : KEY_TEXT.badResponse };
    const key = await deriveVaultKey(pass, head.salt, head.iter);
    if (!(await checkVerifier(key, head.verifier, head.vaultId, head.vaultRevision))) return { ok: false, message: KEY_TEXT.wrongPass };
    return { key: { key, vaultId: head.vaultId, salt: head.salt, vaultRevision: head.vaultRevision } };
  }

  const keys: SyncKeys = {
    get view() {
      return keyView;
    },
    async createVault(pass) {
      const generation = keyGeneration;
      const vaultId = randomId();
      const salt = randomId();
      const key = await deriveVaultKey(pass, salt, KEY_ITER);
      const verifier = await makeVerifier(key, vaultId, 1);
      return keyAction((ks) => ks.createVault({ key, vaultId, salt, verifier }), generation);
    },
    async unlockVault(pass) {
      const generation = keyGeneration;
      const r = await keyFromPass(pass);
      if ('ok' in r) return r;
      const unlocked = await keyAction(async () => {
        if (!(await sessionOk())) {
          forgetVaultKey();
          return { ok: false, message: KEY_TEXT.auth };
        }
        if (!setVaultKey(r.key, generation)) return { ok: false, message: null };
        if ((await keyStore?.getMeta<KeyAccountNotice>('keyNotice')) === 'vault-changed') await keyStore?.setMeta('keyNotice', null);
        return { ok: true, notes: [] };
      }, generation);
      if (!unlocked.ok) return unlocked;
      // 엔진 메서드는 exclusive가 끝난 뒤에 부른다(5.6-4).
      await engine?.keysNow();
      await refreshKeys();
      return unlocked;
    },
    enable: (id, providers) => keyAction((ks) => ks.enable(id, providers)),
    async setProviders(id, providers) {
      const r = await keyAction((ks) => ks.setProviders(id, providers));
      if (r.ok) scheduleKeys();
      return r;
    },
    async prepareReceive(id) {
      const generation = keyGeneration;
      const receive = ++receiveGeneration;
      pendingReceive = null;
      const ks = keySync;
      const eng = engine;
      if (!ks || !eng) return { ok: false, message: KEY_TEXT.server };
      try {
        const r = await eng.exclusive(() => {
          if (destroyed || generation !== keyGeneration || receive !== receiveGeneration) return Promise.resolve<KeyFail>({ ok: false, message: null });
          keyOperationGeneration = generation;
          return ks.prepareReceive(id);
        });
        if (destroyed || generation !== keyGeneration || receive !== receiveGeneration) return { ok: false, message: null };
        if (!r.ok) {
          if (r.recheck) await eng.keysNow();
          return r;
        }
        pendingReceive = r.prepared;
        return { ok: true, overwrite: [...r.prepared.overwrite] };
      } catch {
        return { ok: false, message: KEY_TEXT.server };
      } finally {
        await refreshKeys();
      }
    },
    async commitReceive(lockPass) {
      const generation = keyGeneration;
      const p = pendingReceive;
      const a = appRef;
      if (!p || !a) return { ok: false, message: null, recheck: true };
      if (a.settings.keyLock) {
        // 기기 잠금 암호 확인(310000회)은 잠금 밖에서 먼저(5.7-3). 틀리면 풀어 둔 것을 그대로 두어 다시 넣을 수 있게
        if (!lockPass || !(await a.verifyPassphrase(lockPass))) return { ok: false, message: KEY_TEXT.wrongLockPass };
      }
      if (pendingReceive !== p) return { ok: false, message: null, recheck: true };
      pendingReceive = null;
      return keyAction((ks) => ks.commitReceive(p, a.settings.keyLock ? lockPass : undefined), generation);
    },
    cancelReceive() {
      ++receiveGeneration;
      pendingReceive = null;
    },
    uploadLocal: (id) => keyAction((ks) => ks.uploadLocal(id)),
    disable: (id) => keyAction((ks) => ks.disable(id)),
    async changePassphrase(current, next) {
      const generation = keyGeneration;
      if (samePassphrase(current, next)) return { ok: false, message: KEY_TEXT.samePass };
      // 기억 중이어도 현재 암호를 다시 묻는다(1.4)
      const cur = await keyFromPass(current);
      if ('ok' in cur) return cur;
      const salt = randomId();
      const key = await deriveVaultKey(next, salt, KEY_ITER);
      const r = await keyAction((ks) => {
        if (!setVaultKey(cur.key, generation)) return Promise.resolve<KeyFail>({ ok: false, message: null });
        return ks.rekey({ key, salt });
      }, generation);
      if (!r.ok) return r;
      if (!destroyed) keyChannel?.postMessage({ type: 'forget' });
      return { ok: true, notes: [KEY_TEXT.passChangedDone] };
    },
    async wipe() {
      const r = await keyAction((ks) => ks.wipe());
      if (r.ok && !destroyed) keyChannel?.postMessage({ type: 'forget' });
      return r;
    },
    forget: () => forgetVaultKey(),
    async dismiss(id) {
      await keySync?.dismiss(id);
      await refreshKeys();
    },
    async dismissAccount() {
      await keySync?.dismissAccount();
      await refreshKeys();
    },
  };

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
    forgetVaultKey(true);
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
      void forget(provider === 'google' ? ERRORS['not-allowed'] : `초대가 필요하거나 이용이 끝난 ${PROVIDER_NAMES[provider]} 계정이에요.`).then(() => provider === 'google' ? auth?.signOut() : undefined);
    }
    else void forget(code === 'session-revoked' ? '이 기기는 로그아웃됐어요(다른 기기에서 철회). 다시 로그인해 주세요.' : ERRORS.auth);
  }

  // 초대 코드는 로그인 요청에 실어 보낸다. 가입됐거나 다시 보내도 소용없는 실패(초대 없음·내보냄·코드 틀림)면 지운다.
  // 그래야 내보낸 사람의 기기가 코드를 계속 보내지 않는다. 자리 없음·시도 제한(429)·네트워크 오류는 다시 시도할 수 있게 남긴다.
  let inviteTick = $state(0);
  const inviteExtra = () => {
    const invite = readInvite();
    return invite ? { invite } : undefined;
  };
  function settleInvite(r: { ok: true } | ApiFail) {
    if (r.ok || r.kind === 'not-allowed' || (r.kind === 'invite' && r.code === 'invite-invalid')) {
      clearInvite();
      inviteTick++;
    }
  }

  /** 방금 받은 ID 토큰으로 기기 세션을 만든다. */
  async function startSession(user: AuthUser, idToken: string, label: string) {
    ++authGeneration;
    const r = await api!.createSession(idToken, label, inviteExtra());
    settleInvite(r);
    if (!r.ok) {
      if (r.kind === 'not-allowed') await auth!.signOut();
      error = describeFail(r);
      return;
    }
    // 동기화 상태(켜짐·대기 작업·리비전·충돌)는 계정에 묶는다. 다른 계정이면 버리고, 다시 켤 때 올릴 것을 확인받는다.
    const owner = await store!.getMeta<string>(OWNER_KEY);
    if (owner !== user.uid) {
      if (owner !== undefined) {
        await engine?.reset();
        forgetVaultKey(true); // 이 탭의 계정 전환(5.12 #6)
      }
      await store!.setMeta(OWNER_KEY, user.uid);
    }
    ownerId = user.uid;
    session = { id: r.data.sessionId, email: user.email ?? '' };
    await store!.setMeta(SESSION_KEY, session);
    account = { provider: 'google', id: session.email, display: session.email };
    await clearSocialReauth();
    error = null;
    if (engine?.status().enabled) await engine.syncNow();
  }

  function socialSessionFailure(r: ApiFail, provider: SocialProvider): SocialOutcome {
    const reason = r.kind === 'limit' && r.code === 'invite-limit' ? 'invite-limit'
      : r.kind === 'not-allowed' || r.kind === 'limit' || r.kind === 'offline' ? r.kind
      : r.kind === 'invite' ? r.code
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
        forgetVaultKey(true);
        if (!isCurrent()) return;
      }
      await store!.setMeta(OWNER_KEY, user.sub);
      if (!isCurrent()) return;
    }
    ownerId = user.sub;
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

  const ok = <T>(r: { ok: true; data: T } | ApiFail, ctx: 'profile' | 'share' = 'profile'): T | null => {
    if (r.ok) return r.data;
    // 관리 요청(기기·공유·과거 버전 등)이 세션 문제로 실패해도 엔진과 같은 정리로 로그인 필요 상태로 돌린다
    if (r.kind === 'auth') onAuthFailure(r.code, r.session);
    else if (r.kind === 'not-allowed') onAuthFailure('not-allowed');
    else error = describeFail(r, ctx);
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
    get invitePending() {
      void inviteTick;
      return readInvite() !== null;
    },

    async attach(app) {
      try {
        if (!config || !api) return;
        store = await (deps.store ?? (() => openSyncStore()))();
        keyStore = await (deps.keyStore ?? (() => openKeyStore()))();
        ownerId = (await store.getMeta<string>(OWNER_KEY)) ?? null;
        appRef = app;
        const syncStore = store;
        keySync = createKeySync({
          store: keyStore,
          api,
          app,
          profileState: async (id) => {
            const st = await syncStore.state(id);
            return { uploaded: !!st && st.syncedRevision > 0 && !st.deleted };
          },
          vaultKey: () => vaultKey,
          setVaultKey,
          sessionOk,
          onAuthFailure,
        });
        const ks = keySync;
        engine = createSyncEngine({
          local: appProfiles(app, deps.storage),
          store,
          api,
          now,
          lock: deps.lock ?? webLock,
          onAuthFailure,
          keys: {
            step: () => {
              keyOperationGeneration = keyGeneration;
              return ks.step();
            },
            reset: () => ks.reset(),
          },
        });
        cleanups.push(
          engine.subscribe((s) => {
            status = s;
            void refreshKeys();
          }),
        );
        await engine.init();
        // 첫 주기 전에 옮기기 단계를 돈다(가짜 충돌 막기, §8.3). 주기와 겹치지 않게 exclusive 안에서.
        await engine.exclusive(() => migrateStrategies({ storage: deps.storage, profiles: app.meta.profiles.map((p) => ({ id: p.id, name: p.name })), store: syncStore }));
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
          // bfcache로 되살아나도 마스터 키가 남지 않게
          const onPageHide = () => forgetVaultKey();
          window.addEventListener('pagehide', onPageHide);
          cleanups.push(() => {
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onFocus);
            window.removeEventListener('online', onOnline);
            window.removeEventListener('pagehide', onPageHide);
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

    keys,

    onSecretsChange(e) {
      const ks = keyStore;
      if (!ks) return;
      void (async () => {
        try {
          // 행이 없거나 꺼졌거나 고르지 않은 공급자만 바뀌었으면 bumpSeq가 무시한다(5.6-1)
          await ks.bumpSeq(e.profileId, e.providers);
          const st = await ks.state(e.profileId);
          keyRecordProblem = null;
          if (st?.active && st.localSeq > st.uploadedSeq) scheduleKeys();
        } catch {
          // 기록 실패는 업로드 대상에서 빠지므로 조용히 넘기지 않고 키 영역에 알린다.
          keyRecordProblem = '키 변경을 이 기기에 기록하지 못했어요. 새로 고친 뒤 다시 시도해 주세요';
        }
        await refreshKeys();
      })();
    },

    onLock() {
      forgetVaultKey(); // 이 탭의 lock()만(다른 탭의 lock은 이 탭 키를 잊게 하지 않는다)
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
          const r = await api!.createSocialSession(cb, ret.label.trim() || (deps.deviceLabel ?? defaultLabel)(), inviteExtra());
          settleInvite(r);
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

    setEnabled: (on) =>
      guarded(async () => {
        await engine?.setEnabled(on);
        if (!on) forgetVaultKey();
      }, undefined),
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
        const r = ok(await api.createShare({ sourceProfileId: profileId, kind, snapshot, ttlDays }), 'share');
        if (!r) return null;
        return { url: `${location.origin}${location.pathname}#/s/${r.capability}`, expiresAt: r.expiresAt };
      }, null),
    revokeShare: (id) => guarded(async () => (api ? ok(await api.revokeShare(id)) !== null : false), false),
    cliApprove: (userCode, approve) =>
      guarded<CliApproveResult>(
        async () => {
          if (!api) return { ok: false, reason: 'error' };
          const r = await api.cliApprove(userCode, approve);
          if (r.ok) return { ok: true, info: { label: r.data.label, createdAt: r.data.createdAt, geo: r.data.geo ?? null, scope: r.data.scope === 'market-upload' ? 'market-upload' : 'read' } };
          if (r.kind === 'invalid' && r.code === 'invalid-code') return { ok: false, reason: 'invalid-code' };
          if (r.kind === 'not-found') return { ok: false, reason: 'outdated' };
          ok(r); // 세션 실패·일반 오류는 기존 관리 요청과 같은 방식으로 처리한다.
          return { ok: false, reason: 'error' };
        },
        { ok: false, reason: 'error' },
      ),
    cliTokens: () =>
      guarded<CliTokensResult>(
        async () => {
          if (!api) return { ok: false, reason: 'error' };
          const r = await api.cliTokens();
          if (r.ok) return { ok: true, tokens: r.data.tokens };
          if (r.kind === 'not-found') return { ok: false, reason: 'outdated' };
          ok(r);
          return { ok: false, reason: 'error' };
        },
        { ok: false, reason: 'error' },
      ),
    marketFiles: () =>
      guarded<MarketFilesResult>(
        async () => {
          if (!api || account === null) return { ok: false, reason: 'signed-out' };
          const r = await api.marketFiles();
          if (r.ok) {
            const files = checkMarketFiles(r.data.files);
            return files ? { ok: true, files } : { ok: false, reason: 'error' };
          }
          if (r.kind === 'not-found' || (r.kind === 'server' && r.status === 500)) return { ok: false, reason: 'outdated' };
          ok(r);
          return { ok: false, reason: 'error' };
        },
        { ok: false, reason: 'error' },
      ),
    async marketOwner() {
      if (!config || !api) return null;
      await attached;
      return account !== null && ownerId ? marketOwnerTag(ownerId) : null;
    },
    wipeMarketFiles: () => guarded(async () => (api && account !== null ? ok(await api.wipeMarketFiles()) !== null : false), false),
    cliRevoke: (id) => guarded(async () => (api ? ok(await api.cliRevoke(id)) !== null : false), false),
    members: () =>
      guarded<MembersResult>(
        async () => {
          if (!api) return { ok: false, reason: 'error' };
          const r = await api.listMembers();
          if (r.ok) return { ok: true, members: r.data.members, limit: r.data.limit };
          // 패키지는 not-allowed 밖의 403을 server 403으로 준다. 멤버가 펼친 것이라 배너 없이 숨긴다
          if (r.kind === 'server' && r.status === 403) return { ok: false, reason: 'not-admin' };
          ok(r);
          return { ok: false, reason: 'error' };
        },
        { ok: false, reason: 'error' },
      ),
    removeMember: (identity) => guarded(async () => (api ? ok(await api.removeMember(identity)) !== null : false), false),
    clearError() {
      error = null;
    },
    clearNotices() {
      engine?.clearNotices();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const c of cleanups.splice(0)) c();
      forgetVaultKey();
      keyChannel?.close();
      engine?.destroy();
    },
  };
  return ctl;
}
