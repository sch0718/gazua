import { describe, expect, it } from 'vitest';
import { socialAuthorizeUrl, socialNonce } from '@sch0718/firebase-session/client';
import type { SocialProvider } from '@sch0718/firebase-session/worker';
import { createTestD1 } from './d1';
import entry from './devSocialEntry';

const ORIGIN = 'https://app.example.test';
const REDIRECT = `${ORIGIN}/auth/callback/`;
const BASE = 'https://dev.example.test';
const env = () => ({
  DB: createTestD1(), ALLOWED_ORIGINS: ORIGIN, FIREBASE_PROJECT_ID: 'dev-only', ALLOWED_EMAILS: '',
  ALLOWED_ACCOUNTS: 'kakao:dev-user,naver:dev-user', SOCIAL_REDIRECT_URIS: REDIRECT,
  KAKAO_CLIENT_ID: 'dev-kakao', KAKAO_CLIENT_SECRET: 'dev-kakao-secret',
  NAVER_CLIENT_ID: 'dev-naver', NAVER_CLIENT_SECRET: 'dev-naver-secret',
});

async function authorization(provider: SocialProvider = 'kakao', state = '테스트 상태') {
  const verifier = 'a'.repeat(43);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const params = new URL(socialAuthorizeUrl(provider, { clientId: `dev-${provider}`, redirectUri: REDIRECT, state, nonce: await socialNonce(verifier), codeChallenge: challenge })).searchParams;
  return { verifier, params };
}

describe('개발용 가짜 소셜 진입점', () => {
  it('인가 화면은 개발용임을 알리고 입력값을 이스케이프하며 외부 자원을 막는다', async () => {
    const { params } = await authorization('kakao', '\"><script>위험</script>&\'');
    const r = await entry.fetch(new Request(`${BASE}/__dev/social/kakao/authorize?${params}`), env());
    expect(r.status).toBe(200);
    // 승인 뒤 콜백으로 가는 리다이렉트도 form-action 검사를 받는다(Chromium에서 확인). 검사한 콜백 출처만 허용한다.
    expect(r.headers.get('Content-Security-Policy')).toBe("default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://app.example.test");
    expect(r.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    const html = await r.text();
    expect(html).toContain('가짜 카카오 로그인(개발용)');
    expect(html).toContain('name="sub"');
    expect(html).toContain('value="dev-user"');
    expect(html).toContain('error-503');
    expect(html).toContain('error-code');
    expect(html).toContain('no-id-token');
    expect(html).toContain('403');
    expect(html).toContain('로그인');
    expect(html).toContain('취소');
    expect(html).toContain('&quot;&gt;&lt;script&gt;위험&lt;/script&gt;&amp;&#39;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('method="get"');
    expect(html).toContain('action="/__dev/social/kakao/approve"');
  });

  it.each(['authorize', 'approve'])('%s에서 허용하지 않은 콜백과 클라이언트는 이동하지 않는다', async (path) => {
    const { params } = await authorization();
    params.set('redirect_uri', 'https://evil.example.test/auth/callback/');
    const r = await entry.fetch(new Request(`${BASE}/__dev/social/kakao/${path}?${params}`), env());
    expect(r.status).toBe(400);
    expect(r.headers.get('Location')).toBeNull();
    params.set('redirect_uri', REDIRECT);
    params.set('client_id', '다른 클라이언트');
    expect((await entry.fetch(new Request(`${BASE}/__dev/social/kakao/${path}?${params}`), env())).status).toBe(400);
  });

  it.each(['kakao', 'naver'] as const)('%s 승인 코드를 세션으로 교환하고 세션만으로 인증한다', async (provider) => {
    const e = env();
    const { params, verifier } = await authorization(provider);
    params.set('sub', 'dev-user');
    params.set('action', 'login');
    const approved = await entry.fetch(new Request(`${BASE}/__dev/social/${provider}/approve?${params}`), e);
    expect(approved.status).toBe(302);
    const callback = new URL(approved.headers.get('Location')!);
    expect(callback.origin + callback.pathname).toBe(REDIRECT);
    expect(callback.searchParams.get('state')).toBe(params.get('state'));
    const code = callback.searchParams.get('code');
    expect(code).toBeTruthy();
    const login = await entry.fetch(new Request(`${BASE}/v1/session/social`, {
      method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, code, codeVerifier: verifier, redirectUri: REDIRECT }),
    }), e);
    expect(login.status).toBe(200);
    const body = await login.json() as { sessionId: string; user: { sub: string; provider: string } };
    expect(body.user).toMatchObject({ sub: `${provider}:dev-user`, provider, email: '' });
    const profiles = await entry.fetch(new Request(`${BASE}/v1/profiles`, { headers: { Origin: ORIGIN, 'X-Gazua-Session': body.sessionId } }), e);
    expect(profiles.status).toBe(200);
  });

  it('취소하면 원래 상태와 취소 오류를 콜백으로 보낸다', async () => {
    const { params } = await authorization();
    params.set('action', 'cancel');
    const r = await entry.fetch(new Request(`${BASE}/__dev/social/kakao/approve?${params}`), env());
    expect(r.status).toBe(302);
    const callback = new URL(r.headers.get('Location')!);
    expect(callback.origin + callback.pathname).toBe(REDIRECT);
    expect(callback.searchParams.get('error')).toBe('access_denied');
    expect(callback.searchParams.get('error_description')).toBeTruthy();
    expect(callback.searchParams.get('state')).toBe(params.get('state'));
    expect(callback.searchParams.has('code')).toBe(false);
  });

  it('인가 조건이 틀리면 콜백으로 요청 오류와 상태를 보낸다', async () => {
    const { params } = await authorization();
    params.set('code_challenge_method', 'plain');
    const r = await entry.fetch(new Request(`${BASE}/__dev/social/kakao/approve?${params}`), env());
    expect(r.status).toBe(302);
    const callback = new URL(r.headers.get('Location')!);
    expect(callback.searchParams.get('error')).toBe('invalid_request');
    expect(callback.searchParams.get('state')).toBe(params.get('state'));
  });
});
