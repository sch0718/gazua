import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../state/schema';
import type { Secrets } from '../state/secrets';
import { createProvider } from './factory';
import type { TokenStore } from './types';

const KIS: Secrets = { kis: { appKey: 'k', appSecret: 's' } };
const TOSS: Secrets = { toss: { clientId: 'c', clientSecret: 's' } };
const settings = (p: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...p });
const memoryStore = (): TokenStore => {
  let t: ReturnType<TokenStore['load']> = null;
  return { load: () => t, save: (v) => (t = v) };
};
const deps = () => ({ now: () => 0, fetchImpl: vi.fn() as unknown as typeof fetch, tokenStore: vi.fn(memoryStore) });

describe('createProvider', () => {
  it('returns the demo provider for provider demo', () => {
    expect(createProvider(settings({ provider: 'demo' }), KIS, deps()).id).toBe('demo');
  });

  it('falls back to demo when the required secrets are missing', () => {
    const s = settings({ provider: 'kis', proxyUrl: 'https://proxy.test' });
    expect(createProvider(s, null, deps()).id).toBe('demo');
    expect(createProvider(s, TOSS, deps()).id).toBe('demo');
    expect(createProvider(s, { kis: { appKey: 'k', appSecret: '' } }, deps()).id).toBe('demo');
    expect(createProvider(settings({ provider: 'toss', proxyUrl: 'https://p' }), KIS, deps()).id).toBe('toss');
  });

  it('falls back to demo when the proxy URL is empty', () => {
    expect(createProvider(settings({ provider: 'kis', proxyUrl: '  ' }), KIS, deps()).id).toBe('demo');
  });

  it('builds KIS and Toss providers with a token store for that provider', () => {
    const d = deps();
    expect(createProvider(settings({ provider: 'kis', proxyUrl: 'https://p' }), KIS, d).id).toBe('kis');
    expect(d.tokenStore).toHaveBeenLastCalledWith('kis');
    const toss = createProvider(settings({ provider: 'toss', proxyUrl: 'https://p' }), TOSS, d);
    expect(toss.id).toBe('toss');
    expect(d.tokenStore).toHaveBeenLastCalledWith('toss');
  });
});


describe('토스 프록시 인증 선택', () => {
  it.each([{}, { proxyToken: 'test-proxy-token' }])('키가 없어도 프록시가 있으면 토스 조회를 한다: %j', async (secrets) => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url) => String(url).endsWith('/health')
      ? Response.json({ ok: true, tossToken: true })
      : Response.json({ result: [{ symbol: '005930', lastPrice: '100' }] }));
    const provider = createProvider(settings({ provider: 'toss', proxyUrl: ' https://proxy.example/ ' }), secrets, { ...deps(), fetchImpl });
    expect(provider.id).toBe('toss');
    expect(await provider.getQuotes(['005930'], 'UNIFIED')).toHaveLength(1);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://proxy.example/health');
    expect(String(fetchImpl.mock.calls[1][0])).toContain('/toss/api/v1/prices');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(new Headers(fetchImpl.mock.calls[0][1]?.headers).has('x-proxy-token')).toBe(false);
    expect(new Headers(fetchImpl.mock.calls[1][1]?.headers).has('authorization')).toBe(false);
  });
  it('비밀값이 없으면(잠금 중) 프록시가 있어도 데모다', () => {
    expect(createProvider(settings({ provider: 'toss', proxyUrl: 'https://proxy.example' }), null, deps()).id).toBe('demo');
  });
  it('프록시 주소가 없으면 토스 키가 있어도 데모다', () => {
    expect(createProvider(settings({ provider: 'toss', proxyUrl: '  ' }), TOSS, deps()).id).toBe('demo');
  });
});
