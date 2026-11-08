import { describe, expect, it } from 'vitest';
import { socialAuthorizeUrl, socialNonce } from '@sch0718/firebase-session/client';
import type { SocialProvider } from '@sch0718/firebase-session/worker';
import { createTestD1 } from '@sch0718/firebase-session/testing/d1';
import { FAKE_CLIENT_IDS, FAKE_CLIENT_SECRET } from '@sch0718/firebase-session/testing';
import entry from './devSocialEntry';

const ORIGIN = 'https://app.example.test';
const REDIRECT = `${ORIGIN}/auth/callback/`;
const BASE = 'http://localhost:8788';
const env = () => ({
  DB: createTestD1({ migrations: new URL('../migrations', import.meta.url) }), ALLOWED_ORIGINS: ORIGIN, FIREBASE_PROJECT_ID: 'dev-only', ALLOWED_EMAILS: '',
  ALLOWED_ACCOUNTS: 'kakao:dev-user,naver:dev-user', SOCIAL_REDIRECT_URIS: REDIRECT,
  KAKAO_CLIENT_ID: FAKE_CLIENT_IDS.kakao, KAKAO_CLIENT_SECRET: FAKE_CLIENT_SECRET,
  NAVER_CLIENT_ID: FAKE_CLIENT_IDS.naver, NAVER_CLIENT_SECRET: FAKE_CLIENT_SECRET,
});

async function authorization(provider: SocialProvider = 'kakao', state = 'test-state') {
  const verifier = 'a'.repeat(43);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const params = new URL(socialAuthorizeUrl(provider, { clientId: FAKE_CLIENT_IDS[provider], redirectUri: REDIRECT, state, nonce: await socialNonce(verifier), codeChallenge: challenge })).searchParams;
  params.set('provider', provider);
  return { verifier, params };
}

describe('개발용 가짜 소셜 진입점', () => {
  it('로컬 인가 화면과 승인을 거쳐 세션을 만든다', async () => {
    const provider = 'kakao';
    const e = env();
    const { params, verifier } = await authorization(provider);
    const page = await entry.fetch(new Request(`${BASE}/__dev/social/authorize?${params}`), e);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('action="/__dev/social/approve"');
    params.set('sub', 'dev-user');
    params.set('result', 'ok');
    const approved = await entry.fetch(new Request(`${BASE}/__dev/social/approve?${params}`), e);
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
  });

  it('비로컬 가짜 경로는 서비스 라우터로 넘긴다', async () => {
    const { params } = await authorization();
    const r = await entry.fetch(new Request(`https://sync.example.test/__dev/social/authorize?${params}`, { headers: { Origin: ORIGIN } }), env());
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: 'not-found' });
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });
});
