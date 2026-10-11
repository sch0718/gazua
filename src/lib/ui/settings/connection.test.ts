import { describe, expect, it } from 'vitest';
import { maskTail, mergeKeys, normalizeProxyUrl } from './connection';

describe('maskTail', () => {
  it('shows only the last 4 characters', () => {
    expect(maskTail('PSabcdef1234')).toBe('••••••1234');
    expect(maskTail('key')).toBe('••••••');
    expect(maskTail('')).toBe('');
  });
});

describe('normalizeProxyUrl', () => {
  it('trims, drops trailing slashes and requires https (http only for localhost)', () => {
    expect(normalizeProxyUrl('  https://p.example.net/ \n')).toEqual({ ok: true, url: 'https://p.example.net' });
    expect(normalizeProxyUrl('https://p.example.net/base//')).toEqual({ ok: true, url: 'https://p.example.net/base' });
    expect(normalizeProxyUrl('http://localhost:8787')).toEqual({ ok: true, url: 'http://localhost:8787' });
    expect(normalizeProxyUrl('')).toEqual({ ok: true, url: '' });
    expect(normalizeProxyUrl('http://p.example.net')).toEqual({ ok: false, reason: '프록시 URL은 https://로 시작해야 해요' });
    expect(normalizeProxyUrl('p.example.net')).toEqual({ ok: false, reason: '프록시 URL은 https://로 시작해야 해요' });
    expect(normalizeProxyUrl('https://p.example.net/?q=1')).toEqual({ ok: false, reason: '프록시 URL에는 주소만 넣어 주세요' });
  });
});

describe('mergeKeys', () => {
  it('trims and keeps the other saved value when only one is changed', () => {
    const cur = { kis: { appKey: 'oldKey', appSecret: 'oldSecret' }, proxyToken: 't' };
    expect(mergeKeys(cur, 'kis', ' newKey\n', '')).toEqual({
      ok: true,
      secrets: { kis: { appKey: 'newKey', appSecret: 'oldSecret' }, proxyToken: 't' },
    });
    expect(mergeKeys(null, 'toss', ' id ', ' secret ')).toEqual({
      ok: true,
      secrets: { toss: { clientId: 'id', clientSecret: 'secret' } },
    });
  });

  it('needs both values for a provider that has none saved', () => {
    expect(mergeKeys(null, 'kis', 'k', '  ')).toEqual({ ok: false, reason: '두 값을 모두 입력해 주세요' });
  });

  it('reports nothing changed when both inputs are blank', () => {
    expect(mergeKeys({ proxyToken: 't' }, 'kis', ' ', '')).toEqual({ ok: true, secrets: null });
  });
});
