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
    expect(createProvider(settings({ provider: 'toss', proxyUrl: 'https://p' }), KIS, deps()).id).toBe('demo');
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
