import { describe, expect, it, vi, afterEach } from 'vitest';
import { beginSocialSignIn } from '@sch0718/firebase-session/client';
import { memoryBacking } from '../state/testStorage';
import { startSocialSignIn, takeSocialCallback } from './socialFlow';
import { SOCIAL_RETURN_KEY, SOCIAL_RETURN_TTL } from './social';

const ORIGIN = 'https://app.example.test';
const NOW = 1_000_000;
const random = (n: number) => new Uint8Array(n).fill(7);
const history = () => ({ state: { keep: true }, replaceState: vi.fn() });
const loc = (query = '', path = '/auth/callback/') => ({ href: ORIGIN + path + query, pathname: path });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('소셜 로그인 왕복', () => {
  it('개발용 가짜 공급자는 개발 서버에서만 기본 이동을 바꾼다', async () => {
    vi.stubEnv('VITE_SOCIAL_DEV_MOCK', 'true');
    vi.stubEnv('DEV', true);
    const assign = vi.fn();
    vi.stubGlobal('location', { origin: ORIGIN, assign });
    await startSocialSignIn('kakao', { clientId: 'key', apiUrl: 'http://localhost:8788', label: '', returnHash: '#/settings', storage: memoryBacking(), random });
    expect(assign.mock.lastCall![0]).toMatch(/^http:\/\/localhost:8788\/__dev\/social\/kakao\/authorize\?/);
    vi.stubEnv('DEV', false);
    await startSocialSignIn('kakao', { clientId: 'key', apiUrl: 'http://localhost:8788', label: '', returnHash: '#/settings', storage: memoryBacking(), random });
    expect(assign.mock.lastCall![0]).toMatch(/^https:\/\/kauth.kakao.com\/oauth\/authorize\?/);
  });

  it('가짜 공급자를 켜도 주입한 이동 함수를 그대로 쓴다', async () => {
    vi.stubEnv('VITE_SOCIAL_DEV_MOCK', 'true');
    vi.stubEnv('DEV', true);
    const navigate = vi.fn();
    await startSocialSignIn('naver', { clientId: 'key', apiUrl: 'http://localhost:8788', label: '', returnHash: '#/settings', storage: memoryBacking(), random, origin: ORIGIN, navigate });
    expect(navigate.mock.lastCall![0]).toMatch(/^https:\/\/nid.naver.com\/oauth2\/authorize\?/);
  });

  it('돌아갈 화면과 이름을 저장하고 PKCE 로그인을 시작한다', async () => {
    const storage = memoryBacking();
    const navigate = vi.fn();
    await startSocialSignIn('kakao', { clientId: 'key', apiUrl: 'https://sync.test', label: '내 폰', returnHash: '#/settings', storage, navigate, now: () => NOW, random, origin: ORIGIN, base: '/' });
    expect(JSON.parse(storage.getItem(SOCIAL_RETURN_KEY)!)).toEqual({ hash: '#/settings', label: '내 폰', createdAt: NOW });
    const url = new URL(navigate.mock.calls[0][0]);
    expect(url.origin).toBe('https://kauth.kakao.com');
    expect(url.searchParams.get('redirect_uri')).toBe(ORIGIN + '/auth/callback/');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it.each(['#/s/secret', 'https://evil.test', '#/settings?code=secret', '#/설정'])('공유나 잘못된 해시는 저장하지 않는다: %s', async (returnHash) => {
    const storage = memoryBacking();
    await startSocialSignIn('naver', { clientId: 'key', apiUrl: 'https://sync.test', label: '', returnHash, storage, navigate: () => {}, random, origin: ORIGIN });
    expect(JSON.parse(storage.getItem(SOCIAL_RETURN_KEY)!).hash).toBe('#/settings');
    expect(storage.getItem(SOCIAL_RETURN_KEY)).not.toContain('secret');
  });

  it('저장소를 쓸 수 없으면 이동하지 않고 거절한다', async () => {
    const storage = memoryBacking();
    storage.setItem = () => { throw new Error('저장 불가'); };
    const navigate = vi.fn();
    await expect(startSocialSignIn('kakao', { clientId: 'key', apiUrl: 'https://sync.test', label: '', returnHash: '#/settings', storage, navigate, origin: ORIGIN })).rejects.toThrow();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('콜백 경로 밖에서는 아무것도 만지지 않는다', () => {
    const storage = memoryBacking();
    storage.setItem(SOCIAL_RETURN_KEY, '남겨요');
    const h = history();
    expect(takeSocialCallback({ location: loc('?code=a', '/'), history: h, storage })).toBeNull();
    expect(h.replaceState).not.toHaveBeenCalled();
    expect(storage.getItem(SOCIAL_RETURN_KEY)).toBe('남겨요');
  });

  it('패키지의 대기 요청을 읽고 주소부터 지운 뒤 돌아갈 정보를 꺼낸다', async () => {
    const storage = memoryBacking();
    let auth = '';
    await beginSocialSignIn('kakao', { clientId: 'key', redirectUri: ORIGIN + '/auth/callback/', storage, navigate: (u) => auth = u, random, now: () => NOW });
    storage.setItem(SOCIAL_RETURN_KEY, JSON.stringify({ hash: '#/compare/a', label: '내 폰', createdAt: NOW }));
    const h = history();
    const get = storage.getItem;
    storage.getItem = (key) => {
      if (key === SOCIAL_RETURN_KEY) expect(h.replaceState).toHaveBeenCalledTimes(1);
      return get(key);
    };
    const state = new URL(auth).searchParams.get('state');
    const ret = takeSocialCallback({ location: loc(`?keep=1&code=abc&state=${state}&error_description=설명`), history: h, storage, now: () => NOW });
    expect(ret).toMatchObject({ callback: { ok: true, provider: 'kakao', code: 'abc' }, hadParams: true, returnHash: '#/compare/a', label: '내 폰' });
    expect(h.replaceState).toHaveBeenCalledWith(h.state, '', ORIGIN + '/auth/callback/?keep=1');
    expect(storage.getItem(SOCIAL_RETURN_KEY)).toBeNull();
  });

  it('오류 쿼리도 즉시 지우며 저장소 오류가 밖으로 새지 않는다', () => {
    const storage = memoryBacking();
    storage.getItem = () => { throw new Error('저장 불가'); };
    const h = history();
    expect(takeSocialCallback({ location: loc('?error=access_denied&state=a&error_description=설명'), history: h, storage })).toMatchObject({ callback: null, hadParams: true });
    expect(h.replaceState).toHaveBeenCalledWith(h.state, '', ORIGIN + '/auth/callback/');
  });

  it.each([
    { hash: '#/compare', label: '옛 폰', createdAt: NOW - SOCIAL_RETURN_TTL },
    { hash: '#/s/secret', label: '공유', createdAt: NOW },
    { hash: '#/compare', label: '미래', createdAt: NOW + 1 },
  ])('유효하지 않은 돌아갈 정보는 쓰지 않는다: %j', (info) => {
    const storage = memoryBacking();
    storage.setItem(SOCIAL_RETURN_KEY, JSON.stringify(info));
    expect(takeSocialCallback({ location: loc('?code=a'), history: history(), storage, now: () => NOW })).toMatchObject({ returnHash: '#/settings', label: '' });
    expect(storage.getItem(SOCIAL_RETURN_KEY)).toBeNull();
  });

  it('매개변수 없는 콜백 재방문은 원래 해시로 돌려보낸다', () => {
    const storage = memoryBacking();
    storage.setItem(SOCIAL_RETURN_KEY, JSON.stringify({ hash: '#/compare', label: '', createdAt: NOW }));
    const h = history();
    expect(takeSocialCallback({ location: loc('', '/gazua/auth/callback/'), base: '/gazua/', history: h, storage, now: () => NOW })).toBeNull();
    expect(h.replaceState).toHaveBeenNthCalledWith(1, h.state, '', ORIGIN + '/gazua/auth/callback/');
    expect(h.replaceState).toHaveBeenNthCalledWith(2, h.state, '', '/gazua/#/compare');
  });

  it('돌아갈 정보가 잘못된 JSON이어도 지우고 설정으로 돌린다', () => {
    const storage = memoryBacking();
    storage.setItem(SOCIAL_RETURN_KEY, '{');
    expect(takeSocialCallback({ location: loc('?code=a'), history: history(), storage })).toMatchObject({ returnHash: '#/settings', label: '' });
    expect(storage.getItem(SOCIAL_RETURN_KEY)).toBeNull();
  });
});
