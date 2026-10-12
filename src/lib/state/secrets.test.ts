import { describe, expect, it } from 'vitest';
import {
  WrongPassphraseError,
  isLocked,
  lockSecrets,
  trimCredential,
  unlockSecrets,
  type Secrets,
} from './secrets';

const secrets: Secrets = {
  kis: { appKey: 'PSkisAppKey-0123456789', appSecret: 'kisSecret/ABCDEFGHIJKLMNOP' },
  toss: { clientId: 'toss-client-id-777', clientSecret: 'toss-client-secret-999' },
  proxyToken: 'proxy-token-xyz-424242',
};

function b64ToBinary(b64: string): string {
  return atob(b64);
}

describe('secrets', () => {
  it('round-trips, hides plaintext, rejects wrong passphrase, uses fresh iv/salt', async () => {
    const a = await lockSecrets(secrets, 'correct horse');
    expect(a.kdf).toBe('PBKDF2-SHA256');
    expect(a.iter).toBe(310000);
    expect(isLocked(a)).toBe(true);
    expect(b64ToBinary(a.salt)).toHaveLength(16);
    expect(b64ToBinary(a.iv)).toHaveLength(12);

    expect(await unlockSecrets(a, 'correct horse')).toEqual(secrets);

    const bytes = b64ToBinary(a.enc);
    for (const plain of [
      'PSkisAppKey-0123456789',
      'kisSecret/ABCDEFGHIJKLMNOP',
      'toss-client-id-777',
      'toss-client-secret-999',
      'proxy-token-xyz-424242',
    ]) {
      expect(bytes).not.toContain(plain);
    }

    const err = await unlockSecrets(a, 'zz-bad-secret-zz').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WrongPassphraseError);
    expect((err as Error).name).toBe('WrongPassphraseError');
    expect((err as Error).message).not.toContain('zz-bad-secret-zz');

    const b = await lockSecrets(secrets, 'correct horse');
    expect(b.iv).not.toBe(a.iv);
    expect(b.salt).not.toBe(a.salt);
  });

  it('isLocked checks shape', () => {
    const ok = { enc: 'a', iv: 'b', salt: 'c', kdf: 'PBKDF2-SHA256', iter: 310000 };
    expect(isLocked(ok)).toBe(true);
    expect(isLocked(null)).toBe(false);
    expect(isLocked('x')).toBe(false);
    expect(isLocked({ ...ok, iter: 1000 })).toBe(false);
    expect(isLocked({ ...ok, kdf: 'other' })).toBe(false);
    expect(isLocked({ ...ok, enc: 1 })).toBe(false);
    expect(isLocked({ enc: 'a' })).toBe(false);
    expect(isLocked({ kis: { appKey: 'a', appSecret: 'b' } })).toBe(false);
  });

  it('trimCredential strips surrounding whitespace and newlines', () => {
    expect(trimCredential(' ab\n')).toBe('ab');
    expect(trimCredential('\r\n\tkey value \n')).toBe('key value');
  });
});
