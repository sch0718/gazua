export interface Secrets {
  kis?: { appKey: string; appSecret: string };
  toss?: { clientId: string; clientSecret: string };
  proxyToken?: string;
}

/** 모든 바이너리 필드는 base64. */
export interface LockedSecrets {
  enc: string;
  iv: string;
  salt: string;
  kdf: 'PBKDF2-SHA256';
  iter: 310000;
}

const KDF = 'PBKDF2-SHA256';
const ITER = 310000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

/** 암호가 틀렸거나 데이터가 손상돼 복호화에 실패했을 때. 메시지에 비밀값을 넣지 않는다. */
export class WrongPassphraseError extends Error {
  constructor() {
    super('wrong passphrase');
    this.name = 'WrongPassphraseError';
  }
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)));
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const { subtle } = globalThis.crypto;
  const material = await subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function lockSecrets(s: Secrets, passphrase: string): Promise<LockedSecrets> {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveKey(passphrase, salt);
  const plain = new TextEncoder().encode(JSON.stringify(s));
  const cipher = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
  return {
    enc: toBase64(new Uint8Array(cipher)),
    iv: toBase64(iv),
    salt: toBase64(salt),
    kdf: KDF,
    iter: ITER,
  };
}

export async function unlockSecrets(l: LockedSecrets, passphrase: string): Promise<Secrets> {
  let plain: ArrayBuffer;
  try {
    const key = await deriveKey(passphrase, fromBase64(l.salt));
    plain = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(l.iv) },
      key,
      fromBase64(l.enc),
    );
  } catch {
    throw new WrongPassphraseError();
  }
  return JSON.parse(new TextDecoder().decode(plain)) as Secrets;
}

export function isLocked(v: unknown): v is LockedSecrets {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.enc === 'string' &&
    typeof o.iv === 'string' &&
    typeof o.salt === 'string' &&
    o.kdf === KDF &&
    o.iter === ITER
  );
}

/** 붙여넣기로 딸려온 앞뒤 공백·줄바꿈 제거. */
export function trimCredential(raw: string): string {
  return raw.trim();
}
