// 키 동기화 단계와 사용자 동작(docs/superpowers/specs/2026-10-31-key-sync-design.md 5절). Svelte·Firebase 없음.
// step()은 엔진이 직렬화 안에서 부르고, 동작 메서드는 컨트롤러가 engine.exclusive 안에서 부른다. KDF는 여기서 돌지 않는다.
// 비밀값(평문 키·암호)은 반환값의 notes·message·상태·로그에 넣지 않는다. 평문은 한 동작이 끝날 때까지만 지역 변수에 둔다
// (받기의 PreparedReceive만 확인 단계까지 컨트롤러 메모리에 머문다).
import type { Secrets } from '../state/secrets';
import type { ApiFail, SyncApi } from './api';
import type { SyncPhase } from './engine';
import { KeyOpenError, makeVerifier, openKeys, openRaw, randomId, sealKeys, sealRaw, type BlobContext } from './keyCrypto';
import type { KeyStore, KeySyncState } from './keyStore';
import {
  checkBlob,
  checkBlobRows,
  checkKeyPlain,
  checkVaultHead,
  KEY_ITER,
  KEY_KDF,
  KEY_PROVIDERS,
  keyPlainProviders,
  NEW_REVISION_MAX,
  REVISION_LIMIT,
  type BlobRows,
  type KeyPlainV1,
  type KeyProvider,
  type KeyVaultHead,
  type RekeyBlob,
  type Sealed,
} from './keyWire';

export interface VaultKey {
  key: CryptoKey;
  vaultId: string;
  salt: string;
  vaultRevision: number;
}
export interface SavedVault {
  vaultId: string;
  vaultRevision: number;
  salt: string;
}
export type KeyAccountNotice = null | 'vault-changed' | 'vault-gone';
export type KeyResult =
  | { ok: true; notes: string[] }
  | {
      ok: false;
      /** 보일 문구. null이면 조용히 */
      message: string | null;
      /** 암호 입력 시트를 연다 */
      needsPass?: boolean;
      /** 「서버 키 지우기(이 프로필)」를 보인다(8절) */
      offerDelete?: boolean;
      /** 판정이 바뀌었을 수 있다: 컨트롤러가 keysNow로 다시 본다 */
      recheck?: boolean;
      /** 화면이 문구로 바꿔 보일 앱 저장 오류(KeyLockNotSavedError·StoredKeysNotRemovedError) */
      error?: Error;
    };
export type KeyFail = Extract<KeyResult, { ok: false }>;
export interface PreparedReceive {
  profileId: string;
  revision: number;
  contentId: string;
  plain: KeyPlainV1;
  /** 받기를 시작할 때 읽은 localSeq(5.7-4-1) */
  seq: number;
  /** 이 기기의 다른 값을 덮어쓸 공급자 */
  overwrite: KeyProvider[];
  /** 받기 전 선택 */
  before: KeyProvider[];
}
export interface KeySyncApp {
  readonly meta: { readonly activeProfileId: string; readonly profiles: readonly { id: string }[] };
  readonly settings: { readonly provider: string; readonly keyLock: boolean };
  syncableSecrets(profileId: string): Pick<Secrets, 'kis' | 'toss'> | null;
  applySyncedSecrets(profileId: string, keys: Pick<Secrets, 'kis' | 'toss'>, passphrase?: string): Promise<KeyProvider[]>;
}
export interface KeySyncDeps {
  store: KeyStore;
  api: SyncApi;
  app: KeySyncApp;
  now: () => number;
  /** 동기화 엔진이 이 프로필을 서버에 올렸다고 확인했는가(syncedRevision > 0, 삭제 아님) */
  profileState(profileId: string): Promise<{ uploaded: boolean }>;
  vaultKey(): VaultKey | null;
  /** null이면 마스터 키를 잊는다 */
  setVaultKey(k: VaultKey | null): void;
  /** 저장된 세션·소유자가 이 탭 메모리 값과 같은가(5.12 #5) */
  sessionOk(): Promise<boolean>;
  onAuthFailure?: (code: string, session?: string) => void;
}
export interface KeySync {
  step(): Promise<SyncPhase>;
  reset(): Promise<void>;
  /** 마지막 키 단계의 키 영역 문구(없으면 null) */
  problem(): string | null;
  createVault(v: { key: CryptoKey; vaultId: string; salt: string; verifier: Sealed }): Promise<KeyResult>;
  enable(profileId: string, providers: KeyProvider[]): Promise<KeyResult>;
  setProviders(profileId: string, providers: KeyProvider[]): Promise<KeyResult>;
  prepareReceive(profileId: string): Promise<{ ok: true; prepared: PreparedReceive } | KeyFail>;
  commitReceive(p: PreparedReceive, lockPass?: string): Promise<KeyResult>;
  uploadLocal(profileId: string): Promise<KeyResult>;
  disable(profileId: string): Promise<KeyResult>;
  rekey(next: { key: CryptoKey; salt: string }): Promise<KeyResult>;
  wipe(): Promise<KeyResult>;
  dismiss(profileId: string): Promise<void>;
  dismissAccount(): Promise<void>;
}

export const PROVIDER_LABEL: Record<KeyProvider, string> = { kis: 'KIS', toss: '토스' };

/** 키 영역 문구(설계 5.5~5.16, 8절). 설계에 없는 것은 계획 「스펙 빈틈」에 적은 것만 */
export const KEY_TEXT = {
  badResponse: '서버 응답이 맞지 않아요. 앱을 새로 고쳐 주세요',
  badRow: '서버 응답이 맞지 않아요',
  oldWorker: '서버를 새로 배포해야 키 동기화를 쓸 수 있어요',
  offline: '서버에 연결할 수 없어요. 연결되면 다시 확인해요',
  limit: '서버 한도에 걸렸어요. 잠시 뒤 다시 시도해요.',
  server: '서버 오류예요. 잠시 뒤 다시 시도해요.',
  auth: '로그인이 끝났어요. 다시 로그인해 주세요.',
  rejected: '서버가 이 데이터를 받지 않았어요.',
  keyLimit: '서버에 키를 올린 프로필이 50개라 더 켤 수 없어요',
  conflict: '다른 기기가 먼저 바꿨어요. 다시 받아 주세요.',
  gone: '이미 지워졌어요.',
  wrongPass: '동기화 암호가 맞지 않아요',
  wrongLockPass: '이 기기 잠금 암호가 맞지 않아요',
  noBlob: '서버에 키가 없어요',
  unopenable: '서버의 키를 풀 수 없어요. 서버 자료가 손상됐을 수 있어요',
  passChanged: '동기화 암호가 바뀌었어요. 새 암호를 입력해 주세요',
  shape: '서버의 키 형식이 맞지 않아요. 앱을 새로 고쳐 주세요',
  rollback: '서버 키가 예전 것으로 돌아갔어요(서버 복구 등). 받지 않았어요',
  secretsChanged: '그사이 이 기기 키가 바뀌었어요. 다시 받아 주세요',
  lockedElsewhere: '다른 탭에서 키를 잠갔어요. 잠금 암호로 다시 받아 주세요',
  badValue: '키 값이 맞지 않아요(영문·숫자·기호 256자까지). 연결 설정에서 다시 붙여 넣어 주세요',
  notUploaded: '먼저 동기화가 끝나야 켤 수 있어요',
  noKeys: '이 기기에 올릴 키가 없어요',
  vaultExists: '다른 기기에서 먼저 암호를 정했어요. 그 암호를 입력해 주세요',
  vaultChanged: '다른 기기에서 동기화 암호를 바꿨어요. 새 암호를 입력해 주세요',
  noVault: '서버의 키가 모두 지워졌어요(다른 기기). 이 기기의 키는 그대로예요',
  offFailed: '서버에서 키를 지우지 못했어요. 연결을 확인하고 다시 꺼 주세요',
  wipeFailed: '서버에서 키를 지우지 못했어요. 연결을 확인하고 다시 시도해 주세요',
  rekeyBusy: '다른 기기에서 키를 바꾸는 중이에요. 잠시 뒤 다시 해 주세요',
  rekeyUnopenable: '풀 수 없는 키가 있어 암호를 바꾸지 못했어요',
  samePass: '지금 암호와 같아요',
  passChangedDone: '동기화 암호를 바꿨어요',
  received: '키를 받았어요',
  sameKeys: '이미 같은 키예요',
  checkProvider: '연결 설정에서 공급자를 확인해 주세요',
  otherProfile: '그 프로필로 바꾸면 받을 수 있어요',
  pendingUpload: '올릴 키 변경이 있어요. 동기화 암호를 넣으면 올려요',
  keepOne: '그만 올리려면 위 토글을 꺼 주세요',
  noKeyHere: '이 기기에 키가 없어요',
  tossWarning: '토스 키는 키마다 토큰이 하나라 동시에 한 기기에서만 잘 돼요. 다른 기기에서 쓰면 이 기기의 토큰이 끊길 수 있어요',
  available: '키를 받을 수 있어요',
  newer: '다른 기기에서 키가 바뀌었어요',
  conflictNotice: '이 기기에도 올리지 않은 키 변경이 있어요',
  removed: '다른 기기에서 키 동기화를 껐어요. 이 기기의 키는 그대로예요',
  rollbackReceive: '이 기기 키가 서버의 예전 키로 바뀌어요',
  conflictReceive: '이 기기에서 바꾼 키는 서버 키로 바뀌어요',
  uploadConfirm: '다른 기기에서 바꾼 서버 키를 이 기기 키로 바꿔요',
  offConfirm: '서버에서 이 프로필의 키를 지울까요? 이미 받은 다른 기기의 키는 그대로 남아요.',
  offConfirmKnown: ' 다른 기기에서 켠 키 동기화도 꺼져요',
  wipeConfirm: '서버에 올린 모든 프로필의 키와 동기화 암호 정보를 지울까요? 되돌릴 수 없어요. 이미 받은 기기의 키는 남아요.',
  missingKey: (p: KeyProvider) => `${PROVIDER_LABEL[p]} 키가 이 기기에 없어 올리지 못했어요. 키를 넣거나 선택을 바꿔 주세요`,
  dropped: (p: KeyProvider) => `${PROVIDER_LABEL[p]} 키는 더 이상 동기화하지 않아요. 이 기기의 ${PROVIDER_LABEL[p]} 키는 그대로예요`,
  overwrite: (ps: KeyProvider[]) => `이 기기의 ${ps.map((p) => PROVIDER_LABEL[p]).join('·')} 키가 서버 키로 바뀌어요`,
} as const;

/** 키 요청 실패 문구(4.11·8절) */
export function keyFailText(f: ApiFail): string {
  if (badConflict(f)) return KEY_TEXT.badResponse;
  switch (f.kind) {
    case 'offline':
      return KEY_TEXT.offline;
    case 'limit':
      return KEY_TEXT.limit;
    case 'auth':
    case 'not-allowed':
      return KEY_TEXT.auth;
    case 'invalid':
      return f.code === 'key-limit' ? KEY_TEXT.keyLimit : KEY_TEXT.rejected;
    case 'not-found':
      return KEY_TEXT.noBlob;
    case 'gone':
      return KEY_TEXT.gone;
    case 'conflict':
      return f.code === 'vault-changed'
        ? KEY_TEXT.vaultChanged
        : f.code === 'no-vault'
          ? KEY_TEXT.noVault
          : f.code === 'vault-exists'
            ? KEY_TEXT.vaultExists
            : KEY_TEXT.conflict;
    default:
      return KEY_TEXT.server;
  }
}

/** 메모리 키가 이 금고 머리의 것인가(5.12 #8) */
export const sameVault = (k: VaultKey | null, h: { vaultId: string; salt: string; vaultRevision: number } | null): boolean =>
  !!k && !!h && k.vaultId === h.vaultId && k.salt === h.salt && k.vaultRevision === h.vaultRevision;

const REMOTE_NOTICES: ReadonlySet<KeySyncState['notice']> = new Set(['available', 'newer', 'conflict', 'rollback']);

function plainFor(providers: readonly KeyProvider[], s: Pick<Secrets, 'kis' | 'toss'>): KeyPlainV1 {
  const out: KeyPlainV1 = { v: 1 };
  if (providers.includes('kis') && s.kis) out.kis = { appKey: s.kis.appKey, appSecret: s.kis.appSecret };
  if (providers.includes('toss') && s.toss) out.toss = { clientId: s.toss.clientId, clientSecret: s.toss.clientSecret };
  return out;
}
/** 공급자 집합과 값이 모두 같은가 */
const samePlain = (a: KeyPlainV1, b: KeyPlainV1): boolean => KEY_PROVIDERS.every((p) => JSON.stringify(a[p] ?? null) === JSON.stringify(b[p] ?? null));
const ctxOf = (k: VaultKey, profileId: string, b: { revision: number; contentId: string; vaultRevision: number }): BlobContext => ({
  vaultId: k.vaultId,
  profileId,
  revision: b.revision,
  contentId: b.contentId,
  vaultRevision: b.vaultRevision,
});
const nameOf = (e: unknown) => (e instanceof Error ? e.name : '');

// keyWire.ts의 isRevision은 비공개다. 같은 상한·규칙을 성공 응답과 409에도 적용한다.
const isRevision = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v < REVISION_LIMIT;
const badConflict = (f: ApiFail): boolean =>
  f.kind === 'conflict' &&
  (!isRevision(f.revision) || (f.vaultRevision !== undefined && !(f.code === 'no-vault' && f.vaultRevision === null) && !isRevision(f.vaultRevision)));

type UploadOutcome = { kind: 'ok' } | { kind: 'deferred' } | { kind: 'missing'; provider: KeyProvider } | { kind: 'bad-value' } | { kind: 'bad-response' } | { kind: 'fail'; fail: ApiFail };
type Listed = { head: KeyVaultHead | null; rows: BlobRows };

export function createKeySync(deps: KeySyncDeps): KeySync {
  const { store, api, app } = deps;
  let problem: string | null = null;
  /** 키 단계 안에서 본 로그인 실패(블롭 요청·자동 올리기 포함). step이 끝에 돌려준다(5.3) */
  let loginPhase: SyncPhase | null = null;

  const fail = (message: string | null, extra: Omit<KeyFail, 'ok' | 'message'> = {}): KeyFail => ({ ok: false, message, ...extra });
  const done: KeyResult = { ok: true, notes: [] };
  const forget = () => deps.setVaultKey(null);
  /** 이 금고 머리의 것일 때만 메모리 키 */
  const keyFor = (h: { vaultId: string; salt: string; vaultRevision: number } | null): VaultKey | null => {
    const k = deps.vaultKey();
    return sameVault(k, h) ? k : null;
  };
  function loginFail(f: ApiFail): SyncPhase | null {
    if (f.kind === 'auth') {
      deps.onAuthFailure?.(f.code, f.session);
      return (loginPhase ??= 'auth');
    }
    if (f.kind === 'not-allowed') {
      deps.onAuthFailure?.('not-allowed');
      return (loginPhase ??= 'not-allowed');
    }
    return null;
  }
  /** 모든 키 동작의 첫 줄(5.12 #5): 저장된 세션·소유자가 이 탭 메모리 값과 다르면 요청 없이 키를 잊고 멈춘다 */
  async function sessionLost(): Promise<KeyFail | null> {
    if (await deps.sessionOk()) return null;
    forget();
    return fail(KEY_TEXT.auth);
  }

  /** 목록을 받아 검사한다(2.2). 금고 머리·목록 배열이 틀리면 'bad'(아무것도 쓰지 않는다) */
  async function list(): Promise<Listed | ApiFail | 'bad'> {
    const r = await api.listKeys();
    if (!r.ok) return badConflict(r) ? 'bad' : r;
    if (!r.data || typeof r.data !== 'object') return 'bad';
    const head = r.data.keyVault === null ? null : checkVaultHead(r.data.keyVault);
    const rows = checkBlobRows(r.data.keyBlobs);
    if ((r.data.keyVault !== null && head === null) || rows === null) return 'bad';
    return { head, rows };
  }
  const isFail = (x: Listed | ApiFail | 'bad'): x is ApiFail => x !== 'bad' && 'ok' in x;

  // ── 계정 단위(5.4 위 표) ──────────────────────────────

  async function accountStep(head: KeyVaultHead | null): Promise<void> {
    const saved = (await store.getMeta<SavedVault | null>('keyVault')) ?? null;
    const mine = sameVault(deps.vaultKey(), head);
    if (!head) {
      if (saved) {
        forget();
        // 서버 행도 모두 지워졌으므로 본 리비전도 버린다
        await store.clear();
        await store.setMeta('keyVault', null);
        await store.setMeta('keyNotice', 'vault-gone');
      } else if (deps.vaultKey()) forget();
      return;
    }
    const cur: SavedVault = { vaultId: head.vaultId, vaultRevision: head.vaultRevision, salt: head.salt };
    if (saved && saved.vaultId !== head.vaultId) {
      // 다른 금고(전체 삭제 뒤 새로 만듦). 새 vaultId라 AAD가 겹치지 않으므로 본 리비전을 버려도 된다
      await store.clear();
      if (!mine) await store.setMeta('keyNotice', 'vault-gone');
    } else if (saved && (saved.salt !== head.salt || saved.vaultRevision !== head.vaultRevision) && !mine) {
      // 암호가 바뀌었다. rekey는 블롭 리비전·내용 ID를 바꾸지 않으므로 상태 행은 그대로다
      await store.setMeta('keyNotice', 'vault-changed');
    }
    await store.setMeta('keyVault', cur);
    if (!mine && deps.vaultKey()) forget();
  }

  // ── 프로필 단위(5.4 아래 표) ─────────────────────────

  async function profilesStep(head: KeyVaultHead, rows: BlobRows): Promise<void> {
    const key = keyFor(head);
    const localIds = app.meta.profiles.map((p) => p.id);
    const local = new Set(localIds);
    const byId = new Map(rows.rows.map((r) => [r.profileId, r]));
    const skipped = new Set(rows.skippedIds);
    // 다른 기기의 삭제를 pull이 적용한 프로필: 켜진 행을 끈다(removeSyncedProfile은 삭제 알림을 내지 않는다)
    for (const st of await store.states())
      if (st.active && !local.has(st.profileId) && !skipped.has(st.profileId)) await store.setActive(st.profileId, { active: false });
    for (const id of localIds) {
      if (skipped.has(id)) continue; // 모양이 틀린 행: 이번 단계는 건드리지 않는다
      const row = byId.get(id);
      const st = await store.state(id);
      if (!row) {
        // 목록에 없음: 알리지 않고 켜진 행만 끈다. 프로필 ID를 읽지 못한 행이 있으면 그것일 수 있어 이번에는 두지 않는다
        if (st?.active && !rows.unknownSkipped) await store.setActive(id, { active: false });
        continue;
      }
      if (row.deleted) await deletedRow(id, row.revision);
      else await liveRow(id, { revision: row.revision, contentId: row.contentId! }, key);
    }
  }

  async function deletedRow(id: string, r: number): Promise<void> {
    await store.markSeen(id, r);
    const st = (await store.state(id))!;
    if (!st.active) return;
    // revision 0(알기만 함)이거나 내 끄기가 반영된 것이면 조용히, 아니면 「다른 기기에서 껐어요」. dirty여도 올리지 않는다
    if (st.revision === 0 || st.offPending) await store.setActive(id, { active: false, offPending: false, notice: null });
    else await store.setActive(id, { active: false, offPending: false, notice: 'removed' });
  }

  const matched = (s: KeySyncState | undefined, row: { revision: number; contentId: string }) =>
    !!s && s.active && s.revision === row.revision && s.syncedContentId === row.contentId;

  async function liveRow(id: string, row: { revision: number; contentId: string }, key: VaultKey | null): Promise<void> {
    let st = await store.state(id);
    // 서버 행이 살아 있으면 끄기가 실패한 것이다
    if (st?.offPending) await store.setActive(id, { active: st.active, offPending: false });
    // 되감기: 본 것보다 옛 리비전이고 맞춘 상태가 아니다. 켜진 행만 알린다
    if (st && row.revision < st.seenRevision && !matched(st, row)) {
      if (st.active) await store.setNotice(id, 'rollback', row.revision);
      return;
    }
    await store.markSeen(id, row.revision);
    st = (await store.state(id))!;
    if (!st.active) {
      await store.activate(id, { providers: [], notice: 'available', remoteRevision: row.revision });
      return;
    }
    const dirty = st.localSeq > st.uploadedSeq;
    if (matched(st, row)) {
      if (!dirty) {
        if (st.notice === 'newer' || st.notice === 'conflict' || st.notice === 'rollback') await store.setNotice(id, null);
        return;
      }
      // 자동 올리기는 이 금고의 마스터 키가 있고 지금 프로필일 때만(5.6)
      if (key && id === app.meta.activeProfileId) {
        const out = await upload(id, row.revision, key);
        if (out.kind === 'fail') await afterUploadFail(id, out.fail);
        else if (out.kind === 'bad-value') problem = KEY_TEXT.badValue;
        else if (out.kind === 'bad-response') problem = KEY_TEXT.badResponse;
      }
      return;
    }
    if (!dirty) {
      await store.setNotice(id, st.revision === 0 ? 'available' : 'newer', row.revision);
      return;
    }
    const same = await sameAsServer(id, row, key);
    if (same === 'same') return;
    // 비교 중 다른 탭이 끈 행의 알림은 그대로 둔다.
    if (!(await store.state(id))?.active) return;
    if (same === 'differs') {
      await store.setNotice(id, 'conflict', row.revision);
      return;
    }
    // 비교할 수 없으면 판정을 미룬다(conflict로 떨어뜨리지 않는다). 알림의 기준 리비전만 맞춘다
    if (REMOTE_NOTICES.has(st.notice)) await store.setNotice(id, st.notice, row.revision);
  }

  /** 5.6-4: 서버 블롭이 지금 이 기기의 고른 공급자 키와 같은가. 같으면 맞춘 상태로 쓴다 */
  async function sameAsServer(id: string, row: { revision: number }, key: VaultKey | null): Promise<'same' | 'differs' | 'unknown'> {
    if (!key || id !== app.meta.activeProfileId) return 'unknown';
    const st = await store.state(id);
    if (!st?.active) return 'unknown';
    const seq = st.localSeq;
    const got = await api.getKeyBlob(id);
    if (!got.ok) {
      loginFail(got);
      if (badConflict(got)) problem = KEY_TEXT.badResponse;
      return 'unknown';
    }
    const blob = checkBlob(got.data);
    if (!blob || blob.revision !== row.revision) return 'unknown';
    let plain: KeyPlainV1;
    try {
      plain = await openKeys(key.key, ctxOf(key, id, blob), blob);
    } catch {
      return 'unknown';
    }
    const local = app.syncableSecrets(id);
    if (!local) return 'unknown';
    if (!samePlain(plain, plainFor(st.providers, local))) return 'differs';
    if (!(await store.state(id))?.active) return 'unknown';
    await store.markSynced(id, { revision: blob.revision, contentId: blob.contentId, uploadedSeq: seq, notice: null });
    await store.markSeen(id, blob.revision);
    return 'same';
  }

  /** 올리기(5.5-3·5.6-3·5.8). seq를 먼저 읽고 평문을 나중에 읽는다(5.13) */
  async function upload(id: string, expected: number, key: VaultKey, chosen?: KeyProvider[]): Promise<UploadOutcome> {
    const st = await store.state(id);
    if (!st?.active) return { kind: 'deferred' };
    const seq = st.localSeq;
    const local = app.syncableSecrets(id);
    if (!local) return { kind: 'deferred' };
    const providers = chosen ?? st.providers;
    if (providers.length === 0) return { kind: 'deferred' };
    const missing = providers.find((p) => !local[p]);
    if (missing) {
      // 빠진 값으로 올리면 선택이 몰래 바뀐다(5.5)
      await store.setNotice(id, 'missing-key', st.remoteRevision);
      return { kind: 'missing', provider: missing };
    }
    const plain = plainFor(providers, local);
    if (!checkKeyPlain(plain)) return { kind: 'bad-value' };
    const n = Math.max(st.seenRevision, expected) + 1;
    if (n > NEW_REVISION_MAX) return { kind: 'fail', fail: { ok: false, kind: 'invalid', code: 'invalid' } };
    const contentId = randomId();
    let sealed: Sealed;
    try {
      sealed = await sealKeys(key.key, { vaultId: key.vaultId, profileId: id, revision: n, contentId, vaultRevision: key.vaultRevision }, plain);
    } catch {
      return { kind: 'bad-value' };
    }
    const r = await api.putKeyBlob(id, { expectedRevision: expected, newRevision: n, contentId, vaultId: key.vaultId, vaultRevision: key.vaultRevision, ...sealed });
    if (!r.ok) return badConflict(r) ? { kind: 'bad-response' } : { kind: 'fail', fail: r };
    if (!isRevision(r.data?.revision)) return { kind: 'bad-response' };
    // 엔진과 같은 잠금 안에서 다시 읽는다. 늦은 응답이 꺼진 행의 removed를 지우지 않게 한다.
    if (!(await store.state(id))?.active) return { kind: 'deferred' };
    await store.markSynced(id, { revision: n, contentId, uploadedSeq: seq, providers, notice: null });
    await store.markSeen(id, n);
    return { kind: 'ok' };
  }

  /** 올리기 실패의 공통 처리(4.11). 보일 문구를 돌려준다(null: 조용히) */
  async function afterUploadFail(id: string, f: ApiFail): Promise<string | null> {
    if (badConflict(f)) return (problem = KEY_TEXT.badResponse);
    if (loginFail(f)) return null;
    if (f.kind === 'gone') {
      await store.setActive(id, { active: false });
      return null;
    }
    if (f.kind === 'conflict' && f.code === 'no-vault') {
      forget();
      await store.setMeta('keyNotice', 'vault-gone');
      return KEY_TEXT.noVault;
    }
    if (f.kind === 'conflict' && f.code === 'vault-changed') {
      forget();
      return KEY_TEXT.vaultChanged;
    }
    if (f.kind === 'conflict') return null; // 판정표가 다음 단계에서 본다
    if (f.kind === 'not-found') return null; // 프로필이 아직 서버에 없다: dirty로 두고 다음 동기화에서
    const t = keyFailText(f);
    problem = t;
    return t;
  }
  const isBlobConflict = (f: ApiFail): f is Extract<ApiFail, { kind: 'conflict' }> => f.kind === 'conflict' && (f.code ?? 'conflict') === 'conflict';

  const ks: KeySync = {
    async step() {
      problem = null;
      loginPhase = null;
      try {
        if (!(await deps.sessionOk())) {
          forget();
          return 'idle';
        }
        const got = await list();
        if (got === 'bad') {
          problem = KEY_TEXT.badResponse;
          return 'idle';
        }
        if (isFail(got)) {
          if (got.kind === 'not-found') {
            await store.setMeta('keySupport', false);
            return 'idle';
          }
          const phase = loginFail(got);
          if (phase) return phase;
          problem = keyFailText(got);
          return 'idle';
        }
        await accountStep(got.head);
        await store.setMeta('keySupport', true);
        if (got.head) await profilesStep(got.head, got.rows);
        if (got.rows.skippedIds.length > 0 || got.rows.unknownSkipped) problem = KEY_TEXT.badRow;
        // 블롭 요청·자동 올리기의 로그인 실패도 돌려 엔진의 push를 멈춘다(onAuthFailure는 이미 불렀다).
        return loginPhase ?? 'idle';
      } catch {
        // 엔진 run에는 finally가 없다. 예상 밖 예외도 던지거나 정상 idle로 숨기지 않는다.
        problem = KEY_TEXT.server;
        return loginPhase ?? 'error';
      }
    },

    async reset() {
      forget();
      await store.clear();
    },

    problem: () => problem,

    async createVault(v) {
      const lost = await sessionLost();
      if (lost) return lost;
      const r = await api.createKeyVault({ vaultId: v.vaultId, kdf: KEY_KDF, iter: KEY_ITER, salt: v.salt, verifier: v.verifier });
      if (!r.ok) {
        if (badConflict(r)) return fail(KEY_TEXT.badResponse);
        loginFail(r);
        if (r.kind === 'conflict' && r.code === 'vault-exists') return fail(KEY_TEXT.vaultExists, { needsPass: true });
        return fail(keyFailText(r));
      }
      if (!isRevision(r.data?.vaultRevision)) return fail(KEY_TEXT.badResponse);
      const saved = (await store.getMeta<SavedVault | null>('keyVault')) ?? null;
      if (saved && saved.vaultId !== v.vaultId) await store.clear();
      deps.setVaultKey({ key: v.key, vaultId: v.vaultId, salt: v.salt, vaultRevision: r.data.vaultRevision });
      await store.setMeta('keyVault', { vaultId: v.vaultId, vaultRevision: r.data.vaultRevision, salt: v.salt });
      await store.setMeta('keyNotice', null);
      await store.setMeta('keySupport', true);
      return done;
    },

    async enable(id, providers) {
      const lost = await sessionLost();
      if (lost) return lost;
      if (id !== app.meta.activeProfileId) return fail(KEY_TEXT.otherProfile);
      if (providers.length === 0) return fail(KEY_TEXT.noKeys);
      if (!(await deps.profileState(id)).uploaded) return fail(KEY_TEXT.notUploaded);
      const got = await list();
      if (got === 'bad') return fail(KEY_TEXT.badResponse);
      if (isFail(got)) {
        loginFail(got);
        return fail(keyFailText(got));
      }
      const key = keyFor(got.head);
      if (!key) {
        forget();
        return fail(got.head ? KEY_TEXT.vaultChanged : KEY_TEXT.noVault, { needsPass: !!got.head });
      }
      const r = got.rows.rows.find((x) => x.profileId === id)?.revision ?? 0;
      // 상태 행을 먼저 켠다: 이때부터 다른 탭의 bumpSeq가 무시되지 않는다(5.5-3-1)
      await store.activate(id, { providers, notice: null });
      let out = await upload(id, r, key, providers);
      // 목록을 받은 뒤 다른 기기가 꺼서 삭제 표시가 됐다: 켜기는 이 기기 키를 새로 올리겠다는 뜻이라 그 리비전 기준으로 한 번 더(5.5-3)
      if (out.kind === 'fail' && isBlobConflict(out.fail) && out.fail.deleted) out = await upload(id, out.fail.revision, key, providers);
      // 올리는 사이 꺼졌으면 실패 정리나 충돌 알림도 새로 쓰지 않는다.
      if (!(await store.state(id))?.active) return fail(null, { recheck: true });
      if (out.kind === 'ok') return done;
      if (out.kind === 'fail' && isBlobConflict(out.fail) && !out.fail.deleted) {
        if ((await sameAsServer(id, { revision: out.fail.revision }, key)) === 'same') return done;
        if (!(await store.state(id))?.active) return fail(null, { recheck: true });
        // 다른 기기가 그사이 켰다: 이 기기 키를 올릴 변경으로 남기고 고르게 한다
        await store.bumpSeq(id);
        await store.setNotice(id, 'conflict', out.fail.revision);
        return done;
      }
      await store.setActive(id, { active: false, notice: null });
      if (out.kind === 'missing') return fail(KEY_TEXT.missingKey(out.provider));
      if (out.kind === 'bad-value') return fail(KEY_TEXT.badValue);
      if (out.kind === 'bad-response') return fail(KEY_TEXT.badResponse);
      if (out.kind === 'deferred') return fail(KEY_TEXT.noKeys);
      if (out.fail.kind === 'not-found') return fail(KEY_TEXT.notUploaded);
      if (out.fail.kind === 'gone') return fail(null);
      return fail((await afterUploadFail(id, out.fail)) ?? keyFailText(out.fail));
    },

    async setProviders(id, providers) {
      const lost = await sessionLost();
      if (lost) return lost;
      if (id !== app.meta.activeProfileId) return fail(KEY_TEXT.otherProfile);
      if (providers.length === 0) return fail(KEY_TEXT.keepOne);
      if (!(await store.state(id))?.active) return fail(null, { recheck: true });
      try {
        await store.setProviders(id, providers);
      } catch (e) {
        if (!(await store.state(id))?.active) return fail(null, { recheck: true });
        throw e;
      }
      return done;
    },

    async prepareReceive(id) {
      const lost = await sessionLost();
      if (lost) return lost;
      if (id !== app.meta.activeProfileId) return fail(KEY_TEXT.otherProfile);
      const key = deps.vaultKey();
      if (!key) return fail(null, { needsPass: true });
      const st = await store.state(id);
      if (!st?.active) return fail(null, { recheck: true });
      const seq = st.localSeq;
      const got = await api.getKeyBlob(id);
      if (!got.ok) {
        loginFail(got);
        return fail(keyFailText(got));
      }
      const blob = checkBlob(got.data);
      if (!blob) return fail(KEY_TEXT.badResponse);
      if (blob.revision !== st.remoteRevision) return fail(null, { recheck: true });
      if (st.notice !== 'rollback' && blob.revision < st.seenRevision) {
        await store.setNotice(id, 'rollback', blob.revision);
        return fail(KEY_TEXT.rollback);
      }
      let plain: KeyPlainV1;
      try {
        plain = await openKeys(key.key, ctxOf(key, id, blob), blob);
      } catch (e) {
        if (e instanceof KeyOpenError && e.reason === 'shape') return fail(KEY_TEXT.shape);
        // 메모리 키가 낡았는지 머리를 다시 본다(8절). 낡았으면 멀쩡한 서버 키를 지우라고 권하지 않는다
        const again = await list();
        if (again === 'bad') return fail(KEY_TEXT.badResponse);
        if (isFail(again)) {
          loginFail(again);
          return fail(keyFailText(again));
        }
        if (!sameVault(key, again.head)) {
          forget();
          return fail(KEY_TEXT.passChanged, { needsPass: true });
        }
        return fail(KEY_TEXT.unopenable, { offerDelete: true });
      }
      const local = app.syncableSecrets(id) ?? {};
      const provs = keyPlainProviders(plain);
      const overwrite = provs.filter((p) => local[p] !== undefined && JSON.stringify(local[p]) !== JSON.stringify(plain[p]));
      return { ok: true, prepared: { profileId: id, revision: blob.revision, contentId: blob.contentId, plain, seq, overwrite, before: [...st.providers] } };
    },

    async commitReceive(p, lockPass) {
      const lost = await sessionLost();
      if (lost) return lost;
      if (p.profileId !== app.meta.activeProfileId) return fail(KEY_TEXT.otherProfile);
      const st = await store.state(p.profileId);
      // 확인을 받는 사이 판정이 바뀌었으면 쓰지 않는다
      if (!st?.active || st.remoteRevision !== p.revision) return fail(null, { recheck: true });
      // 다시 잠금을 잡은 뒤 서버 블롭의 리비전·내용 ID가 그대로인지 짧게 다시 본다(5.7-4-4)
      const now = await list();
      if (now === 'bad') return fail(KEY_TEXT.badResponse);
      if (isFail(now)) {
        loginFail(now);
        return fail(keyFailText(now));
      }
      const row = now.rows.rows.find((x) => x.profileId === p.profileId);
      if (!row || row.deleted || row.revision !== p.revision || row.contentId !== p.contentId) return fail(null, { recheck: true });
      let changed: KeyProvider[];
      try {
        changed = await app.applySyncedSecrets(
          p.profileId,
          { ...(p.plain.kis && { kis: p.plain.kis }), ...(p.plain.toss && { toss: p.plain.toss }) },
          lockPass,
        );
      } catch (e) {
        if (nameOf(e) === 'SecretsChangedError') return fail(KEY_TEXT.secretsChanged);
        if (nameOf(e) === 'KeyLockedElsewhereError') return fail(KEY_TEXT.lockedElsewhere);
        // KeyLockNotSavedError·StoredKeysNotRemovedError: 화면이 KeyLock 문구로 보인다. 리비전은 올리지 않는다(다시 받을 수 있게)
        return fail(null, { error: e instanceof Error ? e : new Error('applySyncedSecrets failed') });
      }
      const providers = keyPlainProviders(p.plain);
      if (!(await store.state(p.profileId))?.active) return fail(null, { recheck: true });
      await store.markSynced(p.profileId, { revision: p.revision, contentId: p.contentId, providers, uploadedSeq: p.seq, notice: null });
      await store.markSeen(p.profileId, p.revision);
      const notes: string[] = [changed.length === 0 ? KEY_TEXT.sameKeys : KEY_TEXT.received];
      const after = app.syncableSecrets(p.profileId) ?? {};
      const prov = app.settings.provider;
      if ((prov === 'kis' || prov === 'toss') && !after[prov]) notes.push(KEY_TEXT.checkProvider);
      for (const d of p.before) if (!providers.includes(d)) notes.push(KEY_TEXT.dropped(d));
      return { ok: true, notes };
    },

    async uploadLocal(id) {
      const lost = await sessionLost();
      if (lost) return lost;
      if (id !== app.meta.activeProfileId) return fail(KEY_TEXT.otherProfile);
      const got = await list();
      if (got === 'bad') return fail(KEY_TEXT.badResponse);
      if (isFail(got)) {
        loginFail(got);
        return fail(keyFailText(got));
      }
      const key = keyFor(got.head);
      if (!key) {
        forget();
        return fail(got.head ? null : KEY_TEXT.noVault, { needsPass: !!got.head });
      }
      const st = await store.state(id);
      if (!st?.active) return fail(null, { recheck: true });
      const out = await upload(id, st.remoteRevision ?? 0, key);
      if (out.kind === 'ok') return done;
      if (out.kind === 'missing') return fail(KEY_TEXT.missingKey(out.provider));
      if (out.kind === 'bad-value') return fail(KEY_TEXT.badValue);
      if (out.kind === 'bad-response') return fail(KEY_TEXT.badResponse);
      if (out.kind === 'deferred') return fail(KEY_TEXT.noKeys);
      if (isBlobConflict(out.fail)) {
        if (!out.fail.deleted && (await sameAsServer(id, { revision: out.fail.revision }, key)) === 'same') return done;
        return fail(null, { recheck: true }); // 판정표로 돌아간다
      }
      return fail(await afterUploadFail(id, out.fail));
    },

    async disable(id) {
      const lost = await sessionLost();
      if (lost) return lost;
      if (id !== app.meta.activeProfileId) return fail(KEY_TEXT.otherProfile);
      await store.setActive(id, { active: true, offPending: true });
      const r = await api.deleteKeyBlob(id);
      if (!r.ok) {
        if (badConflict(r)) return fail(KEY_TEXT.badResponse);
        loginFail(r);
        // 꺼진 것처럼 보이는데 서버에 암호문이 남는 일을 만들지 않는다(결정 6): 켜진 채 둔다
        return fail(KEY_TEXT.offFailed);
      }
      if (!isRevision(r.data?.revision)) return fail(KEY_TEXT.badResponse);
      await store.markSeen(id, r.data.revision);
      await store.setActive(id, { active: false, offPending: false, notice: null });
      return done;
    },

    async rekey(next) {
      const lost = await sessionLost();
      if (lost) return lost;
      const cur = deps.vaultKey();
      if (!cur) return fail(null, { needsPass: true });
      const finish = async (vaultId: string, vaultRevision: number): Promise<KeyResult> => {
        deps.setVaultKey({ key: next.key, vaultId, salt: next.salt, vaultRevision });
        await store.setMeta('keyVault', { vaultId, vaultRevision, salt: next.salt });
        return done;
      };
      for (let attempt = 0; attempt < 2; attempt++) {
        const got = await list();
        if (got === 'bad') return fail(KEY_TEXT.badResponse);
        if (isFail(got)) {
          loginFail(got);
          return fail(keyFailText(got));
        }
        if (got.rows.skippedIds.length > 0 || got.rows.unknownSkipped) return fail(KEY_TEXT.badResponse);
        if (!got.head) {
          forget();
          await store.setMeta('keyNotice', 'vault-gone');
          return fail(KEY_TEXT.noVault);
        }
        if (!sameVault(cur, got.head)) {
          forget();
          return fail(KEY_TEXT.vaultChanged, { needsPass: true });
        }
        const v = got.head.vaultRevision + 1;
        const keyBlobs: RekeyBlob[] = [];
        let retry = false;
        for (const row of got.rows.rows) {
          if (row.deleted) continue;
          const b = await api.getKeyBlob(row.profileId);
          if (!b.ok) {
            if (b.kind === 'not-found') {
              retry = true;
              break;
            }
            loginFail(b);
            return fail(keyFailText(b));
          }
          const blob = checkBlob(b.data);
          if (!blob || blob.revision !== row.revision || blob.contentId !== row.contentId) {
            retry = true;
            break;
          }
          let bytes: Uint8Array<ArrayBuffer>;
          try {
            bytes = await openRaw(cur.key, ctxOf(cur, row.profileId, blob), blob);
          } catch {
            return fail(KEY_TEXT.rekeyUnopenable); // 서버에 쓰지 않는다
          }
          const s = await sealRaw(next.key, { vaultId: cur.vaultId, profileId: row.profileId, revision: blob.revision, contentId: blob.contentId, vaultRevision: v }, bytes);
          keyBlobs.push({ profileId: row.profileId, revision: blob.revision, contentId: blob.contentId, ...s });
        }
        if (retry) continue;
        const verifier = await makeVerifier(next.key, cur.vaultId, v);
        const r = await api.rekey({ expectedVaultId: cur.vaultId, expectedVaultRevision: got.head.vaultRevision, salt: next.salt, verifier, keyBlobs });
        if (r.ok) return isRevision(r.data?.vaultRevision) ? finish(cur.vaultId, r.data.vaultRevision) : fail(KEY_TEXT.badResponse);
        if (badConflict(r)) return fail(KEY_TEXT.badResponse);
        if (r.kind === 'conflict' && (r.code ?? 'conflict') === 'conflict') continue;
        if (r.kind === 'conflict' && r.code === 'vault-changed') {
          forget();
          return fail(KEY_TEXT.vaultChanged, { needsPass: true });
        }
        if (r.kind === 'conflict' && r.code === 'no-vault') {
          forget();
          await store.setMeta('keyNotice', 'vault-gone');
          return fail(KEY_TEXT.noVault);
        }
        if (r.kind === 'offline') {
          // 응답을 잃었다: 머리의 salt가 보낸 새 salt면 성공이다(5.10-6)
          const again = await list();
          if (again === 'bad') return fail(KEY_TEXT.badResponse);
          if (isFail(again)) {
            loginFail(again);
            return fail(keyFailText(again));
          }
          if (again.head?.vaultId === cur.vaultId && again.head.salt === next.salt)
            return finish(cur.vaultId, again.head.vaultRevision);
        }
        loginFail(r);
        return fail(keyFailText(r));
      }
      return fail(KEY_TEXT.rekeyBusy);
    },

    async wipe() {
      const lost = await sessionLost();
      if (lost) return lost;
      const r = await api.wipeKeys();
      if (!r.ok) {
        loginFail(r);
        return fail(KEY_TEXT.wipeFailed);
      }
      forget();
      await store.clear();
      await store.setMeta('keyVault', null);
      await store.setMeta('keySupport', true);
      return done;
    },

    async dismiss(id) {
      const st = await store.state(id);
      if (st?.notice === 'removed') await store.setNotice(id, null);
    },

    async dismissAccount() {
      await store.setMeta('keyNotice', null);
    },
  };
  return ks;
}
