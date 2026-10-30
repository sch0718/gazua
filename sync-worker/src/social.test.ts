import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { socialAuthorizeUrl, socialNonce } from '@sch0718/firebase-session/client';
import type { SocialProvider } from '@sch0718/firebase-session/worker';
import { harness, ORIGIN, type Harness } from '../test/harness';
import { doc } from '../test/docs';
import { testServer, SYNC_BASE } from '../test/server';
import { SESSION_TTL } from './session';

const result = async (r: Response) => ({ status: r.status, body: await r.json() });
const count = (h: Harness, table: string) => h.env.DB.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get();
async function authorize(h: Harness, provider: SocialProvider = 'kakao', sub = 'kakao-me') {
  const codeVerifier = 'v'.repeat(43);
  const redirectUri = `${ORIGIN}/auth/callback/`;
  const codeChallenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier))).toString('base64url');
  const params = new URL(socialAuthorizeUrl(provider, { clientId: `${provider}-test-client`, redirectUri, state: 'state-test', nonce: await socialNonce(codeVerifier), codeChallenge })).searchParams;
  return { provider, ...h.fake.authorize(provider, params, sub), codeVerifier, redirectUri };
}

describe('소셜 세션', () => {
  it.each(['kakao', 'naver'] as const)('%s 로그인은 공급자 계정을 저장하고 원문 세션과 이메일은 저장하지 않는다', async (provider) => {
    const h = harness({ social: true });
    const { response, session } = await h.socialLogin(provider, `${provider}-me`, { label: '내 기기' });
    expect(await result(response)).toEqual({ status: 200, body: { sessionId: session, expiresAt: h.clock.now + SESSION_TTL, user: { sub: `${provider}:${provider}-me`, email: '', provider, ...(provider === 'kakao' && { unverifiedEmail: 'kakao-me@example.test' }) } } });
    expect(session).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(h.env.DB.raw.prepare('SELECT firebase_sub, email FROM users').all()).toEqual([{ firebase_sub: `${provider}:${provider}-me`, email: '' }]);
    expect(h.env.DB.raw.prepare('SELECT identity, label FROM sessions').all()).toEqual([{ identity: `${provider}:${provider}-me`, label: '내 기기' }]);
    expect(JSON.stringify(h.env.DB.raw.prepare('SELECT * FROM sessions').all())).not.toContain(session);
  });

  it.each([undefined, ''])('허용 목록 밖이면 계정을 알려 주고 사용자와 세션을 만들지 않는다(%s)', async (allowedAccounts) => {
    const h = harness({ social: { allowedAccounts } });
    const { response } = await h.socialLogin('kakao', 'stranger');
    expect(await result(response)).toEqual({ status: 403, body: { error: 'not-allowed', account: 'kakao:stranger' } });
    expect(count(h, 'users')).toEqual({ n: 0 });
    expect(count(h, 'sessions')).toEqual({ n: 0 });
  });

  it('비밀값이 없으면 경로는 404이고 다른 메서드는 405다', async () => {
    const h = harness();
    expect(await result(await h.call('POST', '/v1/session/social', { body: {} }))).toEqual({ status: 404, body: { error: 'not-found' } });
    expect((await h.call('DELETE', '/v1/session/social')).status).toBe(405);
  });

  it('카카오만 켜면 네이버를 거절한다', async () => {
    const h = harness({ social: { naver: false } });
    expect(await result((await h.socialLogin('naver', 'naver-me')).response)).toEqual({ status: 400, body: { error: 'bad-request' } });
    expect(h.fake.calls).toHaveLength(0);
  });

  it.each(['', '   ', undefined])('시크릿이 비면 해당 공급자를 끈다(%s)', async (secret) => {
    const h = harness({ social: true });
    h.env.KAKAO_CLIENT_SECRET = secret;
    expect((await h.socialLogin('kakao', 'kakao-me')).response.status).toBe(400);
    h.env.NAVER_CLIENT_SECRET = secret;
    expect((await h.socialLogin('naver', 'naver-me')).response.status).toBe(404);
    expect(h.fake.calls).toHaveLength(0);
  });

  it('클라이언트 ID와 시크릿을 다듬고 콤마 목록의 빈 항목을 뺀다', async () => {
    const h = harness({ social: { redirectUris: ` , ${ORIGIN}/auth/callback/ , ,` } });
    h.env.KAKAO_CLIENT_ID = ' kakao-test-client ';
    h.env.KAKAO_CLIENT_SECRET = ' kakao-test-secret ';
    expect((await h.socialLogin('kakao', 'kakao-me')).response.status).toBe(200);
    h.env.KAKAO_CLIENT_ID = ' ';
    expect((await h.socialLogin('kakao', 'kakao-me')).response.status).toBe(400);
  });

  it.each(['https://else.example.test/auth/callback/', '', ' , ', undefined])('리디렉션 목록에 없으면 공급자를 부르기 전에 거절한다(%s)', async (redirectUris) => {
    const h = harness({ social: true });
    h.env.SOCIAL_REDIRECT_URIS = redirectUris;
    expect(await result((await h.socialLogin('kakao', 'kakao-me')).response)).toEqual({ status: 400, body: { error: 'bad-request' } });
    expect(h.fake.calls).toHaveLength(0);
  });

  it('본문의 nonce는 값과 무관하게 거절한다', async () => {
    const h = harness({ social: true });
    const body = await authorize(h);
    expect((await h.call('POST', '/v1/session/social', { body: { ...body, nonce: null } })).status).toBe(400);
    expect(h.fake.calls).toHaveLength(0);
  });

  it('틀린 verifier와 재사용한 코드는 거절한다', async () => {
    const h = harness({ social: true });
    const body = await authorize(h);
    expect(await result(await h.call('POST', '/v1/session/social', { body: { ...body, codeVerifier: 'w'.repeat(43) } }))).toEqual({ status: 401, body: { error: 'invalid-code' } });
    expect((await h.call('POST', '/v1/session/social', { body })).status).toBe(200);
    expect(await result(await h.call('POST', '/v1/session/social', { body }))).toEqual({ status: 401, body: { error: 'invalid-code' } });
  });

  it('같은 코드를 동시에 교환해도 한 번만 세션을 만든다', async () => {
    const h = harness({ social: true });
    const body = await authorize(h);
    const responses = await Promise.all([
      h.call('POST', '/v1/session/social', { body }),
      h.call('POST', '/v1/session/social', { body }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 401]);
    expect(count(h, 'sessions')).toEqual({ n: 1 });
  });

  it.each([
    ['error-code', 401, 'invalid-code'],
    ['error-503', 503, 'provider-unavailable'],
    ['no-id-token', 401, 'invalid-token'],
  ] as const)('공급자의 %s 응답을 매핑한다', async (sub, status, error) => {
    const h = harness({ social: true });
    expect(await result((await h.socialLogin('kakao', sub)).response)).toEqual({ status, body: { error } });
  });

  it('공개키 장애는 503이다', async () => {
    const h = harness({ social: true });
    h.fake.keys.kakao.fail = true;
    expect(await result((await h.socialLogin('kakao', 'kakao-me')).response)).toEqual({ status: 503, body: { error: 'provider-unavailable' } });
  });

  it('세션 헤더만으로 프로필·기기 목록·철회를 처리한다', async () => {
    const h = harness({ social: true });
    const me = await h.socialLogin('kakao', 'kakao-me');
    expect((await me.as('GET', '/v1/profiles')).status).toBe(200);
    expect(await result(await me.as('PUT', '/v1/profiles/p1', { opId: 'op-1', expectedRevision: 0, doc: doc() }))).toEqual({ status: 200, body: { revision: 1 } });
    const listed = await (await me.as('GET', '/v1/sessions')).json() as { sessions: { current: boolean }[] };
    expect(listed.sessions).toHaveLength(1);
    expect(listed.sessions[0].current).toBe(true);
    expect(await result(await me.as('DELETE', '/v1/session'))).toEqual({ status: 200, body: { revoked: 1 } });
    expect(await result(await me.as('GET', '/v1/profiles'))).toEqual({ status: 401, body: { error: 'session-revoked' } });
  });

  it('허용 목록에서 빼면 다음 요청부터 막는다', async () => {
    const h = harness({ social: true });
    const me = await h.socialLogin('kakao', 'kakao-me');
    h.env.ALLOWED_ACCOUNTS = 'naver:naver-me';
    expect(await result(await me.as('GET', '/v1/profiles'))).toEqual({ status: 403, body: { error: 'not-allowed' } });
  });

  it('구글 세션에는 토큰이 필요하고 카카오 세션과 섞을 수 없다', async () => {
    const h = harness({ social: true });
    const google = await h.login();
    const kakao = await h.socialLogin('kakao', 'kakao-me');
    expect(await result(await h.call('GET', '/v1/profiles', { session: google.session }))).toEqual({ status: 401, body: { error: 'missing-token' } });
    expect(await result(await h.call('GET', '/v1/profiles', { token: google.token, session: kakao.session }))).toEqual({ status: 401, body: { error: 'no-session' } });
  });

  it('구글과 카카오는 사용자와 프로필을 나누어 저장한다', async () => {
    const h = harness({ social: true, allowed: 'kakao-me@example.test' });
    const google = await h.login('kakao-me@example.test', 'kakao-me');
    const kakao = await h.socialLogin('kakao', 'kakao-me');
    await google.as('PUT', '/v1/profiles/p1', { opId: 'op-g', expectedRevision: 0, doc: doc('구글') });
    expect(await result(await kakao.as('GET', '/v1/profiles'))).toEqual({ status: 200, body: { profiles: [] } });
    expect((await kakao.as('GET', '/v1/profiles/p1')).status).toBe(404);
    await kakao.as('PUT', '/v1/profiles/p1', { opId: 'op-k', expectedRevision: 0, doc: doc('카카오') });
    expect(await (await google.as('GET', '/v1/profiles/p1')).json()).toMatchObject({ doc: doc('구글') });
    expect(await (await kakao.as('GET', '/v1/profiles/p1')).json()).toMatchObject({ doc: doc('카카오') });
    const users = h.env.DB.raw.prepare('SELECT id FROM users').all();
    expect(users).toHaveLength(2);
    expect(users[0].id).not.toBe(users[1].id);
  });

  it('로그에는 경로 패턴과 상태·시간만 남는다', async () => {
    const h = harness({ social: true });
    const body = await authorize(h);
    const res = await h.call('POST', '/v1/session/social', { body });
    const { sessionId } = await res.json() as { sessionId: string };
    await h.call('POST', '/v1/session/social', { body });
    expect(h.logs).toContain('POST /v1/session/social 200 0ms');
    for (const line of h.logs) {
      expect(line).toMatch(/^[A-Z]+ \S+ \d{3} \d+ms$/);
      for (const value of ['kakao-me', body.code, body.codeVerifier, sessionId]) expect(line).not.toContain(value);
    }
  });

  it('내부 오류는 오류 이름만 남기고 요청 정보는 남기지 않는다', async () => {
    const h = harness({ social: true });
    h.env.DB.prepare = () => { throw new Error('저장소 오류 kakao-me'); };
    expect((await h.socialLogin('kakao', 'kakao-me')).response.status).toBe(500);
    expect(h.logs).toEqual([expect.stringMatching(/^POST \/v1\/session\/social internal Error$/), expect.stringMatching(/^POST \/v1\/session\/social 500 \d+ms$/)]);
  });

  it('0002 마이그레이션이 빠지면 500이고 로그에 패키지 안내가 남는다', async () => {
    const h = harness({ social: true });
    h.env.DB.raw.exec('ALTER TABLE sessions DROP COLUMN identity');
    expect((await h.socialLogin('kakao', 'kakao-me')).response.status).toBe(500);
    expect(h.logs[0]).toMatch(/^POST \/v1\/session\/social internal Error @sch0718\/firebase-session: .*firebase-session-0002_social_sessions\.sql/);
    expect(h.logs[0]).not.toContain('kakao-me');
    const google = await h.login();
    expect((await google.as('GET', '/v1/profiles')).status).toBe(200);
  });

  it('앱 테스트 서버도 토큰 없는 소셜 요청을 전달한다', async () => {
    const s = testServer({ social: true });
    const me = await s.h.socialLogin('naver', 'naver-me');
    const r = await s.fetch(`${SYNC_BASE}/v1/profiles`, { headers: { 'X-Gazua-Session': me.session } });
    expect(await result(r)).toEqual({ status: 200, body: { profiles: [] } });
  });

  it('앱 출처의 소셜 preflight를 허용한다', async () => {
    const h = harness();
    const r = await h.call('OPTIONS', '/v1/session/social', { headers: { 'Access-Control-Request-Method': 'POST' } });
    expect(r.status).toBe(204);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });
});

describe('소셜 배포 설정', () => {
  it('복사한 마이그레이션의 SQL이 패키지와 같다', () => {
    const pkg = createRequire(import.meta.url).resolve('@sch0718/firebase-session/migrations/firebase-session-0002_social_sessions.sql');
    const sql = (text: string) => text.split('\n').filter((line) => line.trim() && !line.trim().startsWith('--')).join('\n');
    expect(sql(readFileSync(new URL('../migrations/0002_social_sessions.sql', import.meta.url), 'utf8'))).toBe(sql(readFileSync(pkg, 'utf8')));
  });

  it('운영 진입점은 테스트를 가져오지 않고 로컬 콜백을 허용하지 않는다', () => {
    const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
    expect(toml).toMatch(/^main = "src\/worker.ts"$/m);
    expect(toml.match(/^SOCIAL_REDIRECT_URIS\s*=\s*"([^"]*)"/m)?.[1]).toBe('https://gazua.sch0718.dev/auth/callback/');
    expect(toml.match(/^SOCIAL_REDIRECT_URIS.*$/m)?.[0]).not.toMatch(/localhost|127\.0\.0\.1/);
    for (const file of readdirSync(new URL('.', import.meta.url), { recursive: true }).filter((f) => String(f).endsWith('.ts') && !String(f).endsWith('.test.ts'))) {
      expect(readFileSync(new URL(String(file), import.meta.url), 'utf8')).not.toMatch(/(?:from\s*|import\s*\()\s*['"](?:\.\.\/test(?:\/|['"])|test\/)/);
    }
  });
});
