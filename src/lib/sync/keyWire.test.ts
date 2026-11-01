import { describe, expect, it } from 'vitest';
import {
  checkBlob,
  checkBlobBody,
  checkBlobRows,
  checkKeyPlain,
  checkRekeyBody,
  checkVaultBody,
  checkVaultHead,
  KEY_ITER,
  KEY_KDF,
} from './keyWire';

const A = (n: number, c = 'A') => c.repeat(n);
const verifier = { nonce: A(16, 'N'), ciphertext: A(56, 'C') };
const vault = () => ({ vaultId: A(24, 'V'), kdf: KEY_KDF, iter: KEY_ITER, salt: A(24, 'S'), verifier: { ...verifier } });
const blob = () => ({ expectedRevision: 0, newRevision: 1, contentId: A(24, 'I'), vaultId: A(24, 'V'), vaultRevision: 1, nonce: A(16, 'N'), ciphertext: A(64, 'X') });
const rekeyBlob = (profileId: string) => ({ profileId, revision: 1, contentId: A(24, 'I'), nonce: A(16, 'N'), ciphertext: A(64, 'X') });
const rekey = (n = 1) => ({
  expectedVaultId: A(24, 'V'),
  expectedVaultRevision: 1,
  salt: A(24, 'T'),
  verifier: { ...verifier },
  keyBlobs: Array.from({ length: n }, (_, i) => rekeyBlob(`p${i}`)),
});
const head = () => ({ ...vault(), vaultRevision: 1, updatedAt: 1 });
const row = (profileId: string, o: Record<string, unknown> = {}) => ({ profileId, revision: 1, vaultRevision: 1, contentId: A(24, 'I'), deleted: false, updatedAt: 1, ...o });

describe('키 와이어 본문 검사', () => {
  it('금고 본문: 정상·모르는 필드·빠진 필드·길이·회수', () => {
    expect(checkVaultBody(vault())).toEqual({ ok: true, value: vault() });
    expect(checkVaultBody({ ...vault(), extra: 1 })).toEqual({ ok: false, code: 'unknown-field', path: 'extra' });
    expect(checkVaultBody({ ...vault(), verifier: { ...verifier, x: 1 } })).toEqual({ ok: false, code: 'unknown-field', path: 'verifier.x' });
    const { salt: _salt, ...noSalt } = vault();
    expect(checkVaultBody(noSalt)).toEqual({ ok: false, code: 'invalid', path: 'salt' });
    expect(checkVaultBody({ ...vault(), vaultId: A(20) })).toEqual({ ok: false, code: 'invalid', path: 'vaultId' });
    expect(checkVaultBody({ ...vault(), salt: '!'.repeat(24) })).toEqual({ ok: false, code: 'invalid', path: 'salt' });
    expect(checkVaultBody({ ...vault(), iter: 310000 })).toEqual({ ok: false, code: 'invalid', path: 'iter' });
    expect(checkVaultBody({ ...vault(), verifier: { ...verifier, ciphertext: A(52) } })).toEqual({ ok: false, code: 'invalid', path: 'verifier.ciphertext' });
    expect(checkVaultBody(null)).toEqual({ ok: false, code: 'invalid', path: '' });
  });

  it('블롭 본문: 리비전 규칙·암호문 길이·모르는 필드', () => {
    expect(checkBlobBody(blob())).toEqual({ ok: true, value: blob() });
    expect(checkBlobBody({ ...blob(), newRevision: 0 })).toMatchObject({ ok: false, code: 'invalid', path: 'newRevision' });
    expect(checkBlobBody({ ...blob(), expectedRevision: 3, newRevision: 3 })).toMatchObject({ code: 'invalid', path: 'newRevision' });
    expect(checkBlobBody({ ...blob(), expectedRevision: 3, newRevision: 6 }).ok).toBe(true);
    expect(checkBlobBody({ ...blob(), newRevision: 2 ** 31 - 2 }).ok).toBe(true);
    expect(checkBlobBody({ ...blob(), newRevision: 2 ** 31 - 1 })).toMatchObject({ code: 'invalid', path: 'newRevision' });
    expect(checkBlobBody({ ...blob(), expectedRevision: -1 })).toMatchObject({ code: 'invalid', path: 'expectedRevision' });
    expect(checkBlobBody({ ...blob(), ciphertext: A(2048) }).ok).toBe(true);
    expect(checkBlobBody({ ...blob(), ciphertext: A(2052) })).toMatchObject({ code: 'invalid', path: 'ciphertext' });
    expect(checkBlobBody({ ...blob(), ciphertext: A(28) })).toMatchObject({ code: 'invalid', path: 'ciphertext' });
    expect(checkBlobBody({ ...blob(), nonce: A(12) })).toMatchObject({ code: 'invalid', path: 'nonce' });
    expect(checkBlobBody({ ...blob(), vaultRevision: 0 })).toMatchObject({ code: 'invalid', path: 'vaultRevision' });
    expect(checkBlobBody({ ...blob(), proxyToken: 'x' })).toEqual({ ok: false, code: 'unknown-field', path: 'proxyToken' });
  });

  it('rekey 본문: 50개까지, 중복 프로필·51개는 invalid', () => {
    expect(checkRekeyBody(rekey(50)).ok).toBe(true);
    expect(checkRekeyBody(rekey(51))).toEqual({ ok: false, code: 'invalid', path: 'keyBlobs' });
    const dup = rekey(2);
    dup.keyBlobs[1].profileId = 'p0';
    expect(checkRekeyBody(dup)).toEqual({ ok: false, code: 'invalid', path: 'keyBlobs[1].profileId' });
    const extra = rekey(1);
    (extra.keyBlobs[0] as Record<string, unknown>).extra = 1;
    expect(checkRekeyBody(extra)).toEqual({ ok: false, code: 'unknown-field', path: 'keyBlobs[0].extra' });
    expect(checkRekeyBody({ ...rekey(0), keyBlobs: [rekeyBlob('../x')] })).toEqual({ ok: false, code: 'invalid', path: 'keyBlobs[0].profileId' });
    expect(checkRekeyBody({ ...rekey(1), expectedVaultRevision: 0 })).toMatchObject({ code: 'invalid', path: 'expectedVaultRevision' });
  });
});

describe('서버 응답 검사', () => {
  it('금고 머리: 회수·길이·리비전·모르는 필드가 틀리면 null', () => {
    expect(checkVaultHead(head())).toEqual(head());
    const bads: Record<string, unknown>[] = [
      { iter: 1000 },
      { iter: 1_000_000_000 },
      { vaultId: A(20) },
      { vaultRevision: 0 },
      { vaultRevision: -1 },
      { vaultRevision: 2 ** 31 },
      { vaultRevision: 1.5 },
      { extra: 1 },
    ];
    for (const bad of bads) expect(checkVaultHead({ ...head(), ...bad }), JSON.stringify(bad)).toBeNull();
    expect(checkVaultHead(null)).toBeNull();
  });

  it('블롭 목록: 배열이 아니면 null, 틀린 행만 빠지고 나머지는 쓴다', () => {
    expect(checkBlobRows({})).toBeNull();
    const r = checkBlobRows([
      row('p1'),
      row('p2', { revision: -1 }),
      row('p3', { revision: 2 ** 31 }),
      row('p4', { revision: 1.5 }),
      row('p5', { deleted: true, contentId: null }),
      { revision: 1 },
    ]);
    expect(r).toEqual({ rows: [row('p1'), row('p5', { deleted: true, contentId: null })], skippedIds: ['p2', 'p3', 'p4'], unknownSkipped: true });
    expect(checkBlobRows([row('p1', { deleted: true })])?.skippedIds).toEqual(['p1']);
    expect(checkBlobRows([row('p1'), row('p1')])).toEqual({ rows: [], skippedIds: ['p1'], unknownSkipped: false });
  });

  it('블롭: 모양이 틀리면 null', () => {
    const b = { revision: 1, contentId: A(24, 'I'), vaultRevision: 1, nonce: A(16, 'N'), ciphertext: A(64, 'X'), updatedAt: 1 };
    expect(checkBlob(b)).toEqual(b);
    expect(checkBlob({ ...b, revision: 2 ** 31 })).toBeNull();
    expect(checkBlob({ ...b, ciphertext: A(28) })).toBeNull();
    expect(checkBlob({ ...b, extra: 1 })).toBeNull();
  });

  it('평문: 공급자 하나 이상, 정확한 필드, 출력 가능한 ASCII 256자', () => {
    const kis = { appKey: 'FAKE-kis-key-0001', appSecret: 'FAKE/secret+0001=' };
    expect(checkKeyPlain({ v: 1, kis })).toEqual({ v: 1, kis });
    const bads: unknown[] = [
      { v: 1 },
      { v: 2, kis },
      { v: 1, kis, extra: 1 },
      { v: 1, kis: { ...kis, x: 1 } },
      { v: 1, kis: { ...kis, appKey: '' } },
      { v: 1, kis: { ...kis, appKey: 'a'.repeat(257) } },
      { v: 1, kis: { ...kis, appKey: 'a b' } },
      { v: 1, kis: { ...kis, appKey: '한글' } },
      { v: 1, kis, proxyToken: 'FAKE-proxy' },
    ];
    for (const bad of bads) expect(checkKeyPlain(bad), JSON.stringify(bad)).toBeNull();
    expect(checkKeyPlain({ v: 1, kis: { ...kis, appKey: 'a'.repeat(256) } })).not.toBeNull();
  });
});
