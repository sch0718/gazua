// 키 동기화 와이어 형식(docs/superpowers/specs/2026-10-31-key-sync-design.md 2.2·2.3). 앱과 sync-worker가 함께 쓴다.
// DOM·import.meta.env·저장소를 쓰지 않는다(dto.ts와 같은 규칙). 오류에는 경로만 담고 값은 담지 않는다.

export const KEY_KDF = 'PBKDF2-SHA256';
export const KEY_ITER = 600000;
export type KeyProvider = 'kis' | 'toss';
export const KEY_PROVIDERS: readonly KeyProvider[] = ['kis', 'toss'];
/** 사용자당 살아 있는 블롭 상한(2.3) */
export const KEY_BLOBS_MAX = 50;
export const NONCE_CHARS = 16;
/** salt·vaultId·contentId(16바이트) */
export const ID_CHARS = 24;
/** 확인값 암호문: 고정 문구 24바이트 + 태그 16바이트 */
export const VERIFIER_CIPHERTEXT_CHARS = 56;
export const BLOB_CIPHERTEXT_MIN = 32;
export const BLOB_CIPHERTEXT_MAX = 2048;
/** 리비전·금고 리비전은 이 값 미만(D1 CHECK) */
export const REVISION_LIMIT = 2 ** 31;
/** 기기가 보낼 수 있는 가장 큰 newRevision(4.5) */
export const NEW_REVISION_MAX = 2 ** 31 - 2;
/** readJson 상한(2.3). 두 DELETE는 본문을 읽지 않는다 */
export const KEY_BODY_MAX = { vault: 4 * 1024, blob: 8 * 1024, rekey: 128 * 1024 } as const;
/** 자격 값 하나: 출력 가능한 ASCII 1~256자 */
export const CREDENTIAL_RE = /^[\x21-\x7e]{1,256}$/;
/** 프로필 ID(sync-worker profiles.ts의 checkId와 같은 규칙) */
export const KEY_PROFILE_ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** AES-GCM 한 번의 결과. 모두 표준 base64(패딩 포함) */
export interface Sealed {
  nonce: string;
  ciphertext: string;
}
/** GET /v1/keys의 금고 머리 */
export interface KeyVaultHead {
  vaultId: string;
  kdf: typeof KEY_KDF;
  iter: typeof KEY_ITER;
  salt: string;
  verifier: Sealed;
  vaultRevision: number;
  updatedAt: number;
}
export interface KeyBlobRow {
  profileId: string;
  revision: number;
  vaultRevision: number;
  /** 살아 있는 행의 내용 ID(비밀 아님). 삭제 표시면 null */
  contentId: string | null;
  /** true면 삭제 표시(끄기·프로필 tombstone). 암호문이 없다 */
  deleted: boolean;
  updatedAt: number;
}
export interface KeyBlob extends Sealed {
  revision: number;
  contentId: string;
  vaultRevision: number;
  updatedAt: number;
}
/** 블롭을 풀었을 때의 평문. 서버로 가지 않는다 */
export interface KeyPlainV1 {
  v: 1;
  kis?: { appKey: string; appSecret: string };
  toss?: { clientId: string; clientSecret: string };
}
export interface VaultBody {
  vaultId: string;
  kdf: typeof KEY_KDF;
  iter: typeof KEY_ITER;
  salt: string;
  verifier: Sealed;
}
export interface BlobBody extends Sealed {
  expectedRevision: number;
  newRevision: number;
  contentId: string;
  vaultId: string;
  vaultRevision: number;
}
export interface RekeyBlob extends Sealed {
  profileId: string;
  revision: number;
  contentId: string;
}
export interface RekeyBody {
  expectedVaultId: string;
  expectedVaultRevision: number;
  salt: string;
  verifier: Sealed;
  keyBlobs: RekeyBlob[];
}
export type WireCheck<T> = { ok: true; value: T } | { ok: false; code: 'invalid' | 'unknown-field'; path: string };
/** 목록 검사 결과. 모양이 틀린 행은 빠지고, 그 프로필 ID(읽을 수 있으면)를 skippedIds에 둔다 */
export interface BlobRows {
  rows: KeyBlobRow[];
  skippedIds: string[];
  /** 프로필 ID조차 읽을 수 없는 행이 있었다 */
  unknownSkipped: boolean;
}

export function isBase64(v: unknown, len: { exact?: number; min?: number; max?: number } = {}): v is string {
  if (typeof v !== 'string' || v.length % 4 !== 0 || !BASE64_RE.test(v)) return false;
  if (len.exact !== undefined && v.length !== len.exact) return false;
  if (len.min !== undefined && v.length < len.min) return false;
  if (len.max !== undefined && v.length > len.max) return false;
  return true;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isRevision = (v: unknown, min = 0): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v < REVISION_LIMIT;
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const join = (path: string, k: string) => (path ? `${path}.${k}` : k);

class Bad {
  constructor(
    readonly code: 'invalid' | 'unknown-field',
    readonly path: string,
  ) {}
}
function fields(o: unknown, allowed: readonly string[], path: string): Record<string, unknown> {
  if (!isRecord(o)) throw new Bad('invalid', path);
  for (const k of Object.keys(o)) if (!allowed.includes(k)) throw new Bad('unknown-field', join(path, k));
  return o;
}
function need(ok: boolean, path: string): void {
  if (!ok) throw new Bad('invalid', path);
}
function sealed(o: Record<string, unknown>, path: string, ct: { exact?: number; min?: number; max?: number }): Sealed {
  need(isBase64(o.nonce, { exact: NONCE_CHARS }), join(path, 'nonce'));
  need(isBase64(o.ciphertext, ct), join(path, 'ciphertext'));
  return { nonce: o.nonce as string, ciphertext: o.ciphertext as string };
}
function verifierOf(v: unknown, path: string): Sealed {
  return sealed(fields(v, ['nonce', 'ciphertext'], path), path, { exact: VERIFIER_CIPHERTEXT_CHARS });
}
const BLOB_CT = { min: BLOB_CIPHERTEXT_MIN, max: BLOB_CIPHERTEXT_MAX };
function run<T>(f: () => T): WireCheck<T> {
  try {
    return { ok: true, value: f() };
  } catch (e) {
    if (e instanceof Bad) return { ok: false, code: e.code, path: e.path };
    throw e;
  }
}

/** PUT /v1/keys/vault 본문(4.4) */
export function checkVaultBody(raw: unknown): WireCheck<VaultBody> {
  return run(() => {
    const o = fields(raw, ['vaultId', 'kdf', 'iter', 'salt', 'verifier'], '');
    need(isBase64(o.vaultId, { exact: ID_CHARS }), 'vaultId');
    need(o.kdf === KEY_KDF, 'kdf');
    need(o.iter === KEY_ITER, 'iter');
    need(isBase64(o.salt, { exact: ID_CHARS }), 'salt');
    const verifier = verifierOf(o.verifier, 'verifier');
    return { vaultId: o.vaultId as string, kdf: KEY_KDF, iter: KEY_ITER, salt: o.salt as string, verifier };
  });
}

/** PUT /v1/keys/:profileId 본문(4.5) */
export function checkBlobBody(raw: unknown): WireCheck<BlobBody> {
  return run(() => {
    const o = fields(raw, ['expectedRevision', 'newRevision', 'contentId', 'vaultId', 'vaultRevision', 'nonce', 'ciphertext'], '');
    need(isRevision(o.expectedRevision), 'expectedRevision');
    const expected = o.expectedRevision as number;
    need(isRevision(o.newRevision, 1) && (o.newRevision as number) > expected && (o.newRevision as number) <= NEW_REVISION_MAX, 'newRevision');
    need(isBase64(o.contentId, { exact: ID_CHARS }), 'contentId');
    need(isBase64(o.vaultId, { exact: ID_CHARS }), 'vaultId');
    need(isRevision(o.vaultRevision, 1), 'vaultRevision');
    const s = sealed(o, '', BLOB_CT);
    return {
      expectedRevision: expected,
      newRevision: o.newRevision as number,
      contentId: o.contentId as string,
      vaultId: o.vaultId as string,
      vaultRevision: o.vaultRevision as number,
      ...s,
    };
  });
}

/** POST /v1/keys/rekey 본문(4.7) */
export function checkRekeyBody(raw: unknown): WireCheck<RekeyBody> {
  return run(() => {
    const o = fields(raw, ['expectedVaultId', 'expectedVaultRevision', 'salt', 'verifier', 'keyBlobs'], '');
    need(isBase64(o.expectedVaultId, { exact: ID_CHARS }), 'expectedVaultId');
    need(isRevision(o.expectedVaultRevision, 1), 'expectedVaultRevision');
    need(isBase64(o.salt, { exact: ID_CHARS }), 'salt');
    const verifier = verifierOf(o.verifier, 'verifier');
    need(Array.isArray(o.keyBlobs) && o.keyBlobs.length <= KEY_BLOBS_MAX, 'keyBlobs');
    const seen = new Set<string>();
    const keyBlobs = (o.keyBlobs as unknown[]).map((b, i): RekeyBlob => {
      const p = `keyBlobs[${i}]`;
      const x = fields(b, ['profileId', 'revision', 'contentId', 'nonce', 'ciphertext'], p);
      need(typeof x.profileId === 'string' && KEY_PROFILE_ID_RE.test(x.profileId) && !seen.has(x.profileId), `${p}.profileId`);
      seen.add(x.profileId as string);
      need(isRevision(x.revision, 1), `${p}.revision`);
      need(isBase64(x.contentId, { exact: ID_CHARS }), `${p}.contentId`);
      const s = sealed(x, p, BLOB_CT);
      return { profileId: x.profileId as string, revision: x.revision as number, contentId: x.contentId as string, ...s };
    });
    return {
      expectedVaultId: o.expectedVaultId as string,
      expectedVaultRevision: o.expectedVaultRevision as number,
      salt: o.salt as string,
      verifier,
      keyBlobs,
    };
  });
}

/** 앱이 받은 금고 머리. 모양이 틀리거나 iter가 600000이 아니면 null(키 단계 전체를 멈춘다, 2.2) */
export function checkVaultHead(raw: unknown): KeyVaultHead | null {
  const r = run((): KeyVaultHead => {
    const o = fields(raw, ['vaultId', 'kdf', 'iter', 'salt', 'verifier', 'vaultRevision', 'updatedAt'], '');
    need(isBase64(o.vaultId, { exact: ID_CHARS }), 'vaultId');
    need(o.kdf === KEY_KDF, 'kdf');
    need(o.iter === KEY_ITER, 'iter');
    need(isBase64(o.salt, { exact: ID_CHARS }), 'salt');
    const verifier = verifierOf(o.verifier, 'verifier');
    need(isRevision(o.vaultRevision, 1), 'vaultRevision');
    need(isTime(o.updatedAt), 'updatedAt');
    return { vaultId: o.vaultId as string, kdf: KEY_KDF, iter: KEY_ITER, salt: o.salt as string, verifier, vaultRevision: o.vaultRevision as number, updatedAt: o.updatedAt as number };
  });
  return r.ok ? r.value : null;
}

function checkBlobRow(raw: unknown): KeyBlobRow | null {
  const r = run((): KeyBlobRow => {
    const o = fields(raw, ['profileId', 'revision', 'vaultRevision', 'contentId', 'deleted', 'updatedAt'], '');
    need(typeof o.profileId === 'string' && KEY_PROFILE_ID_RE.test(o.profileId), 'profileId');
    need(isRevision(o.revision, 1), 'revision');
    need(isRevision(o.vaultRevision, 1), 'vaultRevision');
    need(typeof o.deleted === 'boolean', 'deleted');
    need(o.deleted ? o.contentId === null : isBase64(o.contentId, { exact: ID_CHARS }), 'contentId');
    need(isTime(o.updatedAt), 'updatedAt');
    return {
      profileId: o.profileId as string,
      revision: o.revision as number,
      vaultRevision: o.vaultRevision as number,
      contentId: (o.contentId as string | null) ?? null,
      deleted: o.deleted as boolean,
      updatedAt: o.updatedAt as number,
    };
  });
  return r.ok ? r.value : null;
}

/** 앱이 받은 블롭 목록. 배열이 아니면 null. 행 하나가 틀리면 그 행만 뺀다. 같은 프로필이 두 번 나오면 둘 다 뺀다 */
export function checkBlobRows(raw: unknown): BlobRows | null {
  if (!Array.isArray(raw)) return null;
  const out: BlobRows = { rows: [], skippedIds: [], unknownSkipped: false };
  const count = new Map<string, number>();
  for (const v of raw) if (isRecord(v) && typeof v.profileId === 'string') count.set(v.profileId, (count.get(v.profileId) ?? 0) + 1);
  for (const v of raw) {
    const id = isRecord(v) && typeof v.profileId === 'string' ? v.profileId : null;
    if (id === null) {
      out.unknownSkipped = true;
      continue;
    }
    const r = count.get(id) === 1 ? checkBlobRow(v) : null;
    if (r) out.rows.push(r);
    else if (!out.skippedIds.includes(id)) out.skippedIds.push(id);
  }
  return out;
}

/** 앱이 받은 블롭(GET /v1/keys/:id). 틀리면 null */
export function checkBlob(raw: unknown): KeyBlob | null {
  const r = run((): KeyBlob => {
    const o = fields(raw, ['revision', 'contentId', 'vaultRevision', 'nonce', 'ciphertext', 'updatedAt'], '');
    need(isRevision(o.revision, 1), 'revision');
    need(isBase64(o.contentId, { exact: ID_CHARS }), 'contentId');
    need(isRevision(o.vaultRevision, 1), 'vaultRevision');
    need(isTime(o.updatedAt), 'updatedAt');
    const s = sealed(o, '', BLOB_CT);
    return { revision: o.revision as number, contentId: o.contentId as string, vaultRevision: o.vaultRevision as number, updatedAt: o.updatedAt as number, ...s };
  });
  return r.ok ? r.value : null;
}

const isCredential = (v: unknown): v is string => typeof v === 'string' && CREDENTIAL_RE.test(v);

/** 평문 모양(2.2): 정확한 키 집합, 공급자 하나 이상, 자격 값 규칙(2.3). 아니면 null */
export function checkKeyPlain(raw: unknown): KeyPlainV1 | null {
  if (!isRecord(raw) || raw.v !== 1) return null;
  if (Object.keys(raw).some((k) => k !== 'v' && k !== 'kis' && k !== 'toss')) return null;
  const out: KeyPlainV1 = { v: 1 };
  if (raw.kis !== undefined) {
    const k = raw.kis;
    if (!isRecord(k) || Object.keys(k).some((x) => x !== 'appKey' && x !== 'appSecret')) return null;
    if (!isCredential(k.appKey) || !isCredential(k.appSecret)) return null;
    out.kis = { appKey: k.appKey, appSecret: k.appSecret };
  }
  if (raw.toss !== undefined) {
    const t = raw.toss;
    if (!isRecord(t) || Object.keys(t).some((x) => x !== 'clientId' && x !== 'clientSecret')) return null;
    if (!isCredential(t.clientId) || !isCredential(t.clientSecret)) return null;
    out.toss = { clientId: t.clientId, clientSecret: t.clientSecret };
  }
  return out.kis || out.toss ? out : null;
}

/** 평문에 든 공급자 집합(= 선택, 결정 9) */
export const keyPlainProviders = (p: KeyPlainV1): KeyProvider[] => KEY_PROVIDERS.filter((x) => p[x] !== undefined);
