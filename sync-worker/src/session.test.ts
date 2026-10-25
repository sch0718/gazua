import { describe, expect, it } from 'vitest';
import { ALLOWED_HEADERS, ALLOWED_METHODS } from './cors';
import { DAY } from './env';
import { REAUTH_WINDOW, SESSION_TTL } from './session';
import { harness, ME, ORIGIN, OTHER } from '../test/harness';

const body = async (r: Response) => (await r.json()) as Record<string, unknown>;

describe('CORS', () => {
  it('허용 출처의 preflight는 목록과 정확히 같은 메서드·헤더만 허용한다', async () => {
    const h = harness();
    const r = await h.call('OPTIONS', '/v1/profiles', { headers: { 'Access-Control-Request-Method': 'PUT' } });
    expect(r.status).toBe(204);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(r.headers.get('Vary')).toBe('Origin');
    expect(r.headers.get('Access-Control-Allow-Methods')).toBe(ALLOWED_METHODS);
    expect(r.headers.get('Access-Control-Allow-Headers')).toBe(ALLOWED_HEADERS);
    expect(ALLOWED_HEADERS).toBe('Authorization, Content-Type, X-Gazua-Session, X-Share-Token');
    expect(r.headers.get('Access-Control-Allow-Credentials')).toBeNull();
  });

  it('두 번째 허용 출처도 그 출처만 돌려준다(* 없음)', async () => {
    const h = harness();
    const r = await h.call('OPTIONS', '/v1/profiles', { origin: 'https://second.example.test' });
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe('https://second.example.test');
  });

  it.each([
    ['다른 출처', 'https://evil.example.test'],
    ['비슷한 출처', 'https://app.example.test.evil.test'],
    ['http', 'http://app.example.test'],
    ['null', 'null'],
  ])('%s의 preflight·요청은 403이고 CORS 헤더가 없다', async (_, origin) => {
    const h = harness();
    const pre = await h.call('OPTIONS', '/v1/profiles', { origin });
    expect(pre.status).toBe(403);
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBeNull();
    const { session, token } = await h.login();
    const r = await h.call('GET', '/v1/profiles', { origin, token, session });
    expect(r.status).toBe(403);
  });

  it('Origin이 없으면 403', async () => {
    const h = harness();
    expect((await h.call('GET', '/v1/profiles', { origin: null })).status).toBe(403);
  });

  it('모든 응답은 no-store다', async () => {
    const h = harness();
    expect((await h.call('GET', '/v1/profiles')).headers.get('Cache-Control')).toBe('no-store');
    expect((await h.call('OPTIONS', '/v1/profiles')).headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('세션', () => {
  it('로그인하면 사용자와 세션을 만들고, 세션 원문은 DB에 없다', async () => {
    const h = harness();
    const { session } = await h.login();
    expect(session).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const dump = JSON.stringify(h.env.DB.raw.prepare('SELECT * FROM sessions').all());
    expect(dump).not.toContain(session);
    expect(h.env.DB.raw.prepare('SELECT firebase_sub, email FROM users').all()).toEqual([{ firebase_sub: 'uid-me', email: ME }]);
  });

  it('토큰 없이, 틀린 토큰, 허용 밖 사용자는 세션을 만들 수 없다', async () => {
    const h = harness();
    expect((await h.call('POST', '/v1/session', { body: {} })).status).toBe(401);
    expect(await body(await h.call('POST', '/v1/session', { token: 'abc.def.ghi', body: {} }))).toMatchObject({ error: 'invalid-token' });
    const stranger = await h.token({ email: 'stranger@example.test' });
    const r = await h.call('POST', '/v1/session', { token: stranger, body: {} });
    expect(r.status).toBe(403);
    expect(await body(r)).toEqual({ error: 'not-allowed' });
    expect(h.env.DB.raw.prepare('SELECT count(*) AS n FROM users').get()).toEqual({ n: 0 });
  });

  it('auth_time이 5분보다 오래됐으면 다시 로그인해야 한다', async () => {
    const h = harness();
    const old = await h.token({ auth_time: Math.floor((h.clock.now - REAUTH_WINDOW - 1000) / 1000) });
    const r = await h.call('POST', '/v1/session', { token: old, body: {} });
    expect(r.status).toBe(401);
    expect(await body(r)).toEqual({ error: 'reauth-required' });
  });

  it('기기 이름은 40자, 제어 문자를 지운다', async () => {
    const h = harness();
    await h.login(ME, 'uid-me', `노트북\u0000${'가'.repeat(60)}`);
    const row = h.env.DB.raw.prepare('SELECT label FROM sessions').get() as { label: string };
    expect([...row.label]).toHaveLength(40);
    expect(row.label.startsWith('노트북가')).toBe(true);
  });

  it('세션 없이, 틀린 세션, 다른 사용자의 세션으로는 개인 API에 못 들어간다', async () => {
    const h = harness();
    const me = await h.login();
    const other = await h.login(OTHER, 'uid-other');
    expect(await body(await h.call('GET', '/v1/profiles', { token: me.token }))).toEqual({ error: 'no-session' });
    expect((await h.call('GET', '/v1/profiles', { token: me.token, session: 'x'.repeat(43) })).status).toBe(401);
    const cross = await h.call('GET', '/v1/profiles', { token: me.token, session: other.session });
    expect(cross.status).toBe(401);
    expect((await h.call('GET', '/v1/profiles', { token: me.token, session: me.session })).status).toBe(200);
  });

  it('토큰이 유효해도 허용 목록에서 빠지면 거절한다', async () => {
    const h = harness();
    const me = await h.login();
    h.env.ALLOWED_EMAILS = OTHER;
    expect((await h.call('GET', '/v1/profiles', { token: me.token, session: me.session })).status).toBe(403);
  });

  it('마지막 사용 후 30일이 지나면 만료되고, 쓰면 연장된다', async () => {
    const h = harness();
    const me = await h.login();
    h.clock.now += 20 * DAY;
    expect((await me.as('GET', '/v1/profiles')).status).toBe(200);
    h.clock.now += 20 * DAY; // 마지막 사용 후 20일
    expect((await me.as('GET', '/v1/profiles')).status).toBe(200);
    h.clock.now += SESSION_TTL;
    const r = await me.as('GET', '/v1/profiles');
    expect(r.status).toBe(401);
    expect(await body(r)).toEqual({ error: 'session-expired' });
  });

  it('last_used_at은 1시간에 한 번만 쓴다', async () => {
    const h = harness();
    const me = await h.login();
    const used = () => (h.env.DB.raw.prepare('SELECT last_used_at AS t FROM sessions').get() as { t: number }).t;
    const t0 = used();
    h.clock.now += 30 * 60 * 1000;
    await me.as('GET', '/v1/profiles');
    expect(used()).toBe(t0);
    h.clock.now += 31 * 60 * 1000;
    await me.as('GET', '/v1/profiles');
    expect(used()).toBe(h.clock.now);
  });

  it('기기 목록, 기기 하나 철회, 다른 기기 모두 철회', async () => {
    const h = harness();
    const a = await h.login(ME, 'uid-me', '노트북');
    const b = await h.login(ME, 'uid-me', '휴대폰');
    const c = await h.login(ME, 'uid-me', '태블릿');
    const list = (await body(await a.as('GET', '/v1/sessions'))).sessions as { id: string; label: string; current: boolean }[];
    expect(list.map((s) => [s.label, s.current]).sort()).toEqual([
      ['노트북', true],
      ['태블릿', false],
      ['휴대폰', false],
    ]);
    const phone = list.find((s) => s.label === '휴대폰')!;
    expect((await a.as('DELETE', `/v1/sessions/${phone.id}`)).status).toBe(200);
    const r = await b.as('GET', '/v1/profiles');
    expect(r.status).toBe(401);
    expect(await body(r)).toEqual({ error: 'session-revoked' });
    expect((await c.as('GET', '/v1/profiles')).status).toBe(200);
    expect(await body(await a.as('DELETE', '/v1/sessions?others=1'))).toEqual({ revoked: 1 });
    expect((await c.as('GET', '/v1/profiles')).status).toBe(401);
    expect((await a.as('GET', '/v1/profiles')).status).toBe(200);
  });

  it('다른 사용자의 기기는 철회할 수 없다', async () => {
    const h = harness();
    const a = await h.login();
    const o = await h.login(OTHER, 'uid-other');
    const id = ((await body(await o.as('GET', '/v1/sessions'))).sessions as { id: string }[])[0].id;
    expect((await a.as('DELETE', `/v1/sessions/${id}`)).status).toBe(404);
    expect((await o.as('GET', '/v1/profiles')).status).toBe(200);
  });

  it('로그아웃은 이 기기 세션을 철회하고, 철회된 기기는 다시 로그인해야 한다', async () => {
    const h = harness();
    const a = await h.login();
    expect((await a.as('DELETE', '/v1/session')).status).toBe(200);
    expect((await a.as('GET', '/v1/profiles')).status).toBe(401);
    // 갱신 토큰으로 받은 새 ID 토큰(auth_time 오래됨)으로는 새 세션을 못 만든다
    h.clock.now += 10 * 60 * 1000;
    const refreshed = await h.token({ auth_time: Math.floor((h.clock.now - 10 * 60 * 1000) / 1000) });
    expect((await h.call('POST', '/v1/session', { token: refreshed, body: {} })).status).toBe(401);
  });
});

describe('라우터', () => {
  it('없는 경로 404, 다른 메서드 405, 큰 본문 413', async () => {
    const h = harness();
    const me = await h.login();
    expect((await me.as('GET', '/v1/nope')).status).toBe(404);
    expect((await me.as('PATCH', '/v1/profiles')).status).toBe(405);
    const big = await me.as('PUT', '/v1/profiles/p1', { opId: 'o1', expectedRevision: 0, doc: { x: 'y'.repeat(310 * 1024) } });
    expect(big.status).toBe(413);
  });

  it('로그에는 토큰·세션·이메일·본문이 없다', async () => {
    const h = harness();
    const me = await h.login();
    await me.as('PUT', '/v1/profiles/p1', { opId: 'o1', expectedRevision: 0, doc: { secret: 'FAKE-SECRET' } });
    const all = h.logs.join('\n');
    expect(all).not.toContain(me.session);
    expect(all).not.toContain(me.token);
    expect(all).not.toContain(ME);
    expect(all).not.toContain('FAKE-SECRET');
    expect(h.logs.at(-1)).toMatch(/^PUT \/v1\/profiles\/:id 422 \d+ms$/);
  });
});
