// 키 동기화 암호화(설계 3절). 순수 모듈: globalThis.crypto.subtle만 쓴다. 메시지에 값을 넣지 않는다.
// 기기 키 잠금(secrets.ts, 310000회)과 다른 암호·다른 KDF 회수(600000회)를 쓴다.
import { fromBase64, randomBytes, toBase64 } from '../state/secrets';
import { BLOB_CIPHERTEXT_MAX, checkKeyPlain, KEY_ITER, type KeyPlainV1, type Sealed } from './keyWire';

/** 확인값의 고정 문구(24바이트) */
export const VERIFIER_TEXT = 'gazua-key-vault-check/v1';
const IV_BYTES = 12;
const ID_BYTES = 16;

/** auth: 복호화 실패(틀린 키·AAD·위조), shape: 평문 모양이 틀림·봉한 결과가 상한을 넘음 */
export class KeyOpenError extends Error {
  constructor(readonly reason: 'auth' | 'shape') {
    super(`key blob ${reason}`);
    this.name = 'KeyOpenError';
  }
}

export interface BlobContext {
  vaultId: string;
  profileId: string;
  revision: number;
  contentId: string;
  vaultRevision: number;
}

const encoder = new TextEncoder();
export const blobAad = (c: BlobContext): string =>
  `gazua-keys/v1|blob|${c.vaultId}|${c.profileId}|${c.revision}|${c.contentId}|${c.vaultRevision}`;
export const verifierAad = (vaultId: string, vaultRevision: number): string => `gazua-keys/v1|verifier|${vaultId}|${vaultRevision}`;

/** 금고 ID·salt·내용 ID용 무작위 16바이트(base64 24자) */
export const randomId = (): string => toBase64(randomBytes(ID_BYTES));

export async function deriveVaultKey(passphrase: string, salt: string, iter: number): Promise<CryptoKey> {
  // 서버가 회수를 낮추거나 키워서 기기를 흔들지 못하게 KDF 전에 거절한다(3.1)
  if (iter !== KEY_ITER) throw new Error('unsupported key derivation iteration count');
  const { subtle } = globalThis.crypto;
  const material = await subtle.importKey('raw', encoder.encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: fromBase64(salt), iterations: iter, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function seal(key: CryptoKey, aad: string, bytes: Uint8Array<ArrayBuffer>): Promise<Sealed> {
  const iv = randomBytes(IV_BYTES);
  const out = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(aad) }, key, bytes);
  const s = { nonce: toBase64(iv), ciphertext: toBase64(new Uint8Array(out)) };
  if (s.ciphertext.length > BLOB_CIPHERTEXT_MAX) throw new KeyOpenError('shape');
  return s;
}

async function open(key: CryptoKey, aad: string, s: Sealed): Promise<Uint8Array<ArrayBuffer>> {
  try {
    const out = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(s.nonce), additionalData: encoder.encode(aad) },
      key,
      fromBase64(s.ciphertext),
    );
    return new Uint8Array(out);
  } catch {
    throw new KeyOpenError('auth');
  }
}

export function makeVerifier(key: CryptoKey, vaultId: string, vaultRevision: number): Promise<Sealed> {
  return seal(key, verifierAad(vaultId, vaultRevision), encoder.encode(VERIFIER_TEXT));
}

/** 틀린 암호·다른 금고·위조면 false. 예외를 밖으로 던지지 않는다 */
export async function checkVerifier(key: CryptoKey, v: Sealed, vaultId: string, vaultRevision: number): Promise<boolean> {
  try {
    const bytes = await open(key, verifierAad(vaultId, vaultRevision), v);
    return new TextDecoder().decode(bytes) === VERIFIER_TEXT;
  } catch {
    return false;
  }
}

export async function sealKeys(key: CryptoKey, ctx: BlobContext, plain: KeyPlainV1): Promise<Sealed> {
  const checked = checkKeyPlain(plain);
  if (!checked) throw new KeyOpenError('shape');
  return seal(key, blobAad(ctx), encoder.encode(JSON.stringify(checked)));
}

export async function openKeys(key: CryptoKey, ctx: BlobContext, s: Sealed): Promise<KeyPlainV1> {
  const bytes = await open(key, blobAad(ctx), s);
  let v: unknown;
  try {
    v = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new KeyOpenError('shape');
  }
  const plain = checkKeyPlain(v);
  if (!plain) throw new KeyOpenError('shape');
  return plain;
}

/** rekey 전용: 평문 모양을 보지 않고 바이트만 푼다(새 버전 앱이 만든 블롭도 다시 봉할 수 있게) */
export function openRaw(key: CryptoKey, ctx: BlobContext, s: Sealed): Promise<Uint8Array<ArrayBuffer>> {
  return open(key, blobAad(ctx), s);
}

export function sealRaw(key: CryptoKey, ctx: BlobContext, bytes: Uint8Array<ArrayBuffer>): Promise<Sealed> {
  return seal(key, blobAad(ctx), bytes);
}

export type PassphraseProblem = 'short' | 'long' | 'plain' | 'mismatch';
export const PASSPHRASE_TEXT: Record<PassphraseProblem, string> = {
  short: '동기화 암호를 12자 이상 입력해 주세요',
  long: '동기화 암호는 128자까지예요',
  plain: '같은 글자를 되풀이한 암호는 쓸 수 없어요',
  mismatch: '암호가 서로 달라요',
};
/** 오류가 아닌 안내(3.4) */
export const EDGE_SPACE_TEXT = '앞이나 뒤에 공백이 있어요';

/** 3.4 표의 순서대로 본다. 앞뒤 공백은 자르지 않는다 */
export function checkSyncPassphrase(pass: string, confirm: string): PassphraseProblem | null {
  const p = pass.normalize('NFC');
  const c = confirm.normalize('NFC');
  const chars = [...p];
  if (chars.length < 12) return 'short';
  if (chars.length > 128) return 'long';
  if (new Set(chars).size < 4) return 'plain';
  if (p !== c) return 'mismatch';
  return null;
}
export const hasEdgeSpace = (pass: string): boolean => pass !== pass.trim();
export const samePassphrase = (a: string, b: string): boolean => a.normalize('NFC') === b.normalize('NFC');
