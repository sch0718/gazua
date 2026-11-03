import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { marketOwnerTag, OWNER_TAG_RE } from './owner';

describe('marketOwnerTag', () => {
  it('접두어를 붙인 SHA-256 hex 앞 32자다', async () => {
    const want = createHash('sha256').update('gazua-market-owner/v1\nkakao:12345').digest('hex').slice(0, 32);
    expect(await marketOwnerTag('kakao:12345')).toBe(want);
  });

  it('OWNER_TAG_RE는 32자 소문자 hex만 받는다', () => {
    expect(OWNER_TAG_RE.test('0123456789abcdef0123456789abcdef')).toBe(true);
    expect(OWNER_TAG_RE.test('0123456789ABCDEF0123456789abcdef')).toBe(false);
    expect(OWNER_TAG_RE.test('0123456789abcdef0123456789abcde')).toBe(false);
  });
});
