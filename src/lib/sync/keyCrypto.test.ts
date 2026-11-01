import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  blobAad,
  checkSyncPassphrase,
  checkVerifier,
  deriveVaultKey,
  hasEdgeSpace,
  makeVerifier,
  openKeys,
  openRaw,
  randomId,
  sealKeys,
  sealRaw,
  VERIFIER_TEXT,
  verifierAad,
  type BlobContext,
} from './keyCrypto';
import { KEY_ITER, type KeyPlainV1 } from './keyWire';

// PBKDF2 600000회는 한 번에 0.5초 안팎이라 시간 한도를 늘린다
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const SALT = randomId();
const PASS = 'FAKE-sync-pass-0001';
const ctx: BlobContext = { vaultId: randomId(), profileId: 'p-a', revision: 3, contentId: randomId(), vaultRevision: 1 };
const plain: KeyPlainV1 = { v: 1, kis: { appKey: 'FAKE-kis-key-0001', appSecret: 'FAKE/secret+0001=' } };
let key: CryptoKey;
let other: CryptoKey;

beforeAll(async () => {
  key = await deriveVaultKey(PASS, SALT, KEY_ITER);
  other = await deriveVaultKey(`${PASS}x`, SALT, KEY_ITER);
});

describe('AAD 와이어 리터럴', () => {
  it('블롭 AAD의 접두사·구분자·필드 순서를 고정한다', () => {
    expect(blobAad({ vaultId: 'vault-id', profileId: 'profile-id', revision: 7, contentId: 'content-id', vaultRevision: 11 }))
      .toBe('gazua-keys/v1|blob|vault-id|profile-id|7|content-id|11');
  });

  it('확인값 AAD의 접두사·구분자·필드 순서를 고정한다', () => {
    expect(verifierAad('vault-id', 11)).toBe('gazua-keys/v1|verifier|vault-id|11');
  });
});

describe('마스터 키', () => {
  it('추출 불가 AES-GCM 256, PBKDF2-SHA256 600000회, 다른 회수는 KDF 전에 거절', async () => {
    expect(key.extractable).toBe(false);
    expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
    expect([...key.usages].sort()).toEqual(['decrypt', 'encrypt']);
    const spy = vi.spyOn(globalThis.crypto.subtle, 'deriveKey');
    await deriveVaultKey(PASS, SALT, KEY_ITER);
    expect(spy.mock.calls[0][0]).toMatchObject({ name: 'PBKDF2', iterations: 600000, hash: 'SHA-256' });
    spy.mockClear();
    await expect(deriveVaultKey(PASS, SALT, 599999)).rejects.toThrow();
    await expect(deriveVaultKey(PASS, SALT, 600001)).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('NFC: 조합형과 분해형 암호가 같은 키를 만든다', async () => {
    const nfc = '한글로-된-동기화-암호';
    const nfd = nfc.normalize('NFD');
    expect(nfd).not.toBe(nfc);
    const k1 = await deriveVaultKey(nfc, SALT, KEY_ITER);
    const k2 = await deriveVaultKey(nfd, SALT, KEY_ITER);
    expect(await openKeys(k2, ctx, await sealKeys(k1, ctx, plain))).toEqual(plain);
    expect(checkSyncPassphrase(nfc, nfd)).toBeNull();
  });
});

describe('확인값', () => {
  it('맞는 암호만 true, 다른 금고·리비전·위조는 예외 없이 false', async () => {
    expect(new TextEncoder().encode(VERIFIER_TEXT).length).toBe(24);
    const v = await makeVerifier(key, ctx.vaultId, 1);
    expect(v.nonce).toHaveLength(16);
    expect(v.ciphertext).toHaveLength(56);
    expect(await checkVerifier(key, v, ctx.vaultId, 1)).toBe(true);
    expect(await checkVerifier(other, v, ctx.vaultId, 1)).toBe(false);
    expect(await checkVerifier(key, v, randomId(), 1)).toBe(false);
    expect(await checkVerifier(key, v, ctx.vaultId, 2)).toBe(false);
    const forged = { ...v, ciphertext: (v.ciphertext[0] === 'A' ? 'B' : 'A') + v.ciphertext.slice(1) };
    expect(await checkVerifier(key, forged, ctx.vaultId, 1)).toBe(false);
    expect(await checkVerifier(key, { nonce: '!!', ciphertext: '??' }, ctx.vaultId, 1)).toBe(false);
  });
});

describe('블롭', () => {
  it('AAD: 다른 프로필·금고·리비전·내용 ID·금고 리비전·키로는 auth 실패', async () => {
    const s = await sealKeys(key, ctx, plain);
    expect(await openKeys(key, ctx, s)).toEqual(plain);
    const others: BlobContext[] = [
      { ...ctx, profileId: 'p-b' },
      { ...ctx, vaultId: randomId() },
      { ...ctx, revision: 4 },
      { ...ctx, contentId: randomId() },
      { ...ctx, vaultRevision: 2 },
    ];
    for (const c of others) await expect(openKeys(key, c, s)).rejects.toMatchObject({ name: 'KeyOpenError', reason: 'auth' });
    await expect(openKeys(other, ctx, s)).rejects.toMatchObject({ name: 'KeyOpenError', reason: 'auth' });
  });

  it('평문 모양이 틀리면 shape, sealKeys도 공급자 없는 평문·proxyToken·2048자 초과를 거절', async () => {
    const raw = (v: unknown) => sealRaw(key, ctx, new TextEncoder().encode(JSON.stringify(v)));
    const bads: unknown[] = [
      { v: 1 },
      { v: 1, kis: plain.kis, extra: 1 },
      { v: 1, kis: { appKey: '', appSecret: 'FAKE' } },
      { v: 1, kis: { appKey: 'a'.repeat(257), appSecret: 'FAKE' } },
      { v: 1, kis: { appKey: 'a b', appSecret: 'FAKE' } },
      { v: 1, kis: { appKey: '한글', appSecret: 'FAKE' } },
      { v: 1, kis: plain.kis, proxyToken: 'FAKE-proxy' },
    ];
    for (const bad of bads) await expect(openKeys(key, ctx, await raw(bad))).rejects.toMatchObject({ reason: 'shape' });
    await expect(sealKeys(key, ctx, { v: 1 })).rejects.toMatchObject({ reason: 'shape' });
    // @ts-expect-error proxyToken은 KeyPlainV1에 없다
    await expect(sealKeys(key, ctx, { v: 1, kis: plain.kis, proxyToken: 'FAKE-proxy' })).rejects.toMatchObject({ reason: 'shape' });
    // 봉한 암호문이 2048자를 넘으면 거절(sealKeys·sealRaw가 같은 봉하기를 쓴다)
    await expect(sealRaw(key, ctx, new Uint8Array(new ArrayBuffer(1600)))).rejects.toMatchObject({ reason: 'shape' });
  });

  it('openRaw·sealRaw: 모르는 필드가 든 평문도 바이트 그대로 다시 봉한다', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, kis: plain.kis, future: { x: 1 } }));
    const s = await sealRaw(key, ctx, bytes);
    const opened = await openRaw(key, ctx, s);
    expect(new TextDecoder().decode(opened)).toBe(new TextDecoder().decode(bytes));
    const next = { ...ctx, vaultRevision: 2 };
    const again = await sealRaw(other, next, opened);
    expect(new TextDecoder().decode(await openRaw(other, next, again))).toBe(new TextDecoder().decode(bytes));
  });
});

describe('동기화 암호 강도', () => {
  it('12자·128자·서로 다른 글자 4개·확인 일치, 서로게이트 쌍은 한 글자', () => {
    expect(checkSyncPassphrase('abcdefghijk', 'abcdefghijk')).toBe('short');
    expect(checkSyncPassphrase('abcdefghijkl', 'abcdefghijkl')).toBeNull();
    const long = 'abcd'.repeat(32) + 'e';
    expect(checkSyncPassphrase(long, long)).toBe('long');
    expect(checkSyncPassphrase('aaaaaaaaaaaa', 'aaaaaaaaaaaa')).toBe('plain');
    expect(checkSyncPassphrase('121212121212', '121212121212')).toBe('plain');
    expect(checkSyncPassphrase('abcdefghijkl', 'abcdefghijkm')).toBe('mismatch');
    expect(checkSyncPassphrase('😀'.repeat(11), '😀'.repeat(11))).toBe('short');
    expect(checkSyncPassphrase('😀'.repeat(12), '😀'.repeat(12))).toBe('plain');
    const emoji = '😀😁😂🤣'.repeat(3);
    expect(checkSyncPassphrase(emoji, emoji)).toBeNull();
    expect(hasEdgeSpace(' abcdefghijkl')).toBe(true);
    expect(hasEdgeSpace('abcdef ghijkl')).toBe(false);
  });
});
