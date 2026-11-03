import { describe, expect, it } from 'vitest';
import { harness, ME, type Harness } from '../test/harness';
import { ATTEMPT_LIMIT, ATTEMPT_WINDOW, codeMatches, INVITE_MIN } from './members';
import { purge } from './purge';

const CODE = 'A'.repeat(INVITE_MIN - 4) + 'b_-9';
const FRIEND = 'friend@example.test';
const j = async (r: Response) => ({ status: r.status, body: (await r.json()) as Record<string, any> });
const rows = (h: Harness, sql: string) => h.env.DB.raw.prepare(sql).all() as Record<string, any>[];

function setup(o: { limit?: string; social?: boolean } = {}) {
  const h = harness(o.social ? { social: true } : {});
  h.env.INVITE_CODE = CODE;
  if (o.limit !== undefined) h.env.MEMBER_LIMIT = o.limit;
  return h;
}

/** Google 계정으로 세션 만들기를 시도한다(invite가 있으면 본문에 싣는다) */
async function join(h: Harness, email: string, invite?: string, sub = `uid-${email}`) {
  const token = await h.token({ email, sub });
  const res = await h.call('POST', '/v1/session', { token, body: { label: '폰', ...(invite !== undefined && { invite }) } });
  const r = await j(res);
  const session = r.body.sessionId as string | undefined;
  const as = async (method: string, path: string, body?: unknown) =>
    h.call(method, path, { token: await h.token({ email, sub }), session: session ?? null, body });
  return { ...r, session, as };
}

describe('codeMatches', () => {
  it('같으면 참, 한 글자라도·길이가 다르면 거짓', async () => {
    expect(await codeMatches(CODE, CODE)).toBe(true);
    expect(await codeMatches(CODE, CODE.slice(0, -1) + 'x')).toBe(false);
    expect(await codeMatches(CODE, CODE + 'x')).toBe(false);
    expect(await codeMatches(CODE, '')).toBe(false);
  });
});

describe('초대 가입(Google)', () => {
  it('목록에 없는 새 계정이 맞는 코드로 가입되고, 다음 요청부터는 코드 없이 통과한다', async () => {
    const h = setup();
    const r = await join(h, FRIEND, CODE);
    expect(r.status).toBe(200);
    expect(rows(h, 'SELECT identity, joined_at AS joinedAt, removed_at AS removedAt FROM members')).toEqual([{ identity: FRIEND, joinedAt: h.clock.now, removedAt: null }]);
    expect((await r.as('GET', '/v1/profiles')).status).toBe(200);
    // 다른 기기에서 코드 없이 로그인해도 된다
    expect((await join(h, FRIEND)).status).toBe(200);
  });

  it('이메일은 소문자로 저장한다', async () => {
    const h = setup();
    expect((await join(h, 'Friend@Example.TEST', CODE)).status).toBe(200);
    expect(rows(h, 'SELECT identity FROM members')).toEqual([{ identity: FRIEND }]);
  });

  it('초대 없이 로그인하면 403 not-allowed', async () => {
    const h = setup();
    expect(await join(h, FRIEND)).toMatchObject({ status: 403, body: { error: 'not-allowed' } });
    expect(rows(h, 'SELECT * FROM members')).toEqual([]);
  });

  it('틀린 코드는 403 invite-invalid', async () => {
    const h = setup();
    expect(await join(h, FRIEND, CODE.slice(0, -1) + 'x')).toMatchObject({ status: 403, body: { error: 'invite-invalid' } });
    expect(rows(h, 'SELECT * FROM members')).toEqual([]);
  });

  it.each([
    ['없음', undefined],
    ['빈 값', ''],
    ['짧음', 'x'.repeat(INVITE_MIN - 1)],
  ])('INVITE_CODE가 %s이면 그 값을 보내도 가입할 수 없다', async (_, code) => {
    const h = setup();
    h.env.INVITE_CODE = code;
    expect(await join(h, FRIEND, code ?? '')).toMatchObject({ status: 403, body: { error: 'invite-invalid' } });
    expect(rows(h, 'SELECT * FROM members')).toEqual([]);
  });

  it('문자열이 아닌 invite는 초대 없음과 같다', async () => {
    const h = setup();
    const token = await h.token({ email: FRIEND, sub: 'uid-f' });
    const r = await j(await h.call('POST', '/v1/session', { token, body: { invite: 123 } }));
    expect(r).toMatchObject({ status: 403, body: { error: 'not-allowed' } });
  });

  it('고정 목록 관리자는 멤버 표에 들어가지 않는다', async () => {
    const h = setup();
    expect((await join(h, ME, CODE, 'uid-me')).status).toBe(200);
    expect(rows(h, 'SELECT * FROM members')).toEqual([]);
  });

  it('코드를 바꾸면 새 가입만 막히고 기존 멤버는 그대로다', async () => {
    const h = setup();
    const friend = await join(h, FRIEND, CODE);
    h.env.INVITE_CODE = 'Z'.repeat(INVITE_MIN);
    expect((await join(h, 'new@example.test', CODE)).status).toBe(403);
    expect((await friend.as('GET', '/v1/profiles')).status).toBe(200);
  });
});

describe('시도 제한', () => {
  it(`계정당 1시간 ${ATTEMPT_LIMIT}회를 넘으면 맞는 코드여도 429, 시간이 지나면 풀린다`, async () => {
    const h = setup();
    for (let i = 0; i < ATTEMPT_LIMIT; i++) expect((await join(h, FRIEND, 'w'.repeat(INVITE_MIN))).status).toBe(403);
    expect(await join(h, FRIEND, CODE)).toMatchObject({ status: 429, body: { error: 'invite-limit' } });
    // 다른 계정은 막히지 않는다
    expect((await join(h, 'other-friend@example.test', CODE)).status).toBe(200);
    h.clock.now += ATTEMPT_WINDOW;
    expect((await join(h, FRIEND, CODE)).status).toBe(200);
  });

  it('동시에 보낸 요청도 제한을 넘지 못한다', async () => {
    const h = setup();
    h.env.DB.interleave = true;
    const token = await h.token({ email: FRIEND, sub: 'uid-f' });
    const results = await Promise.all(
      Array.from({ length: ATTEMPT_LIMIT * 3 }, () => h.call('POST', '/v1/session', { token, body: { invite: 'w'.repeat(INVITE_MIN) } })),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 403)).toHaveLength(ATTEMPT_LIMIT);
    expect(statuses.filter((s) => s === 429)).toHaveLength(ATTEMPT_LIMIT * 2);
  });

  it('가입하면 그 계정의 시도 기록을 지우고, 하루 지난 기록은 purge가 지운다', async () => {
    const h = setup();
    await join(h, FRIEND, 'w'.repeat(INVITE_MIN));
    await join(h, FRIEND, CODE);
    expect(rows(h, 'SELECT * FROM invite_attempts')).toEqual([]);
    await join(h, 'x@example.test', 'w'.repeat(INVITE_MIN));
    expect(rows(h, 'SELECT * FROM invite_attempts')).toHaveLength(1);
    expect((await purge(h.env, h.clock.now + 24 * 60 * 60 * 1000)).inviteAttempts).toBe(1);
    expect(rows(h, 'SELECT * FROM invite_attempts')).toEqual([]);
  });
});

describe('멤버 수 상한', () => {
  it('상한에 차면 403 members-full, 내보내면 다시 자리가 난다', async () => {
    const h = setup({ limit: '1' });
    expect((await join(h, FRIEND, CODE)).status).toBe(200);
    expect(await join(h, 'b@example.test', CODE)).toMatchObject({ status: 403, body: { error: 'members-full' } });
    const admin = await h.login();
    expect((await admin.as('DELETE', `/v1/members/${encodeURIComponent(FRIEND)}`)).status).toBe(200);
    expect((await join(h, 'b@example.test', CODE)).status).toBe(200);
  });

  it('남은 자리 하나에 서로 다른 두 사람이 동시에 가입하면 한 명만 된다', async () => {
    const h = setup({ limit: '1' });
    h.env.DB.interleave = true;
    const [a, b] = await Promise.all([join(h, 'a@example.test', CODE), join(h, 'b@example.test', CODE)]);
    expect([a.status, b.status].sort()).toEqual([200, 403]);
    expect(rows(h, 'SELECT count(*) AS n FROM members')).toEqual([{ n: 1 }]);
  });

  it('같은 사람이 동시에 가입해도 둘 다 성공한다(500 없음)', async () => {
    const h = setup({ limit: '1' });
    h.env.DB.interleave = true;
    const [a, b] = await Promise.all([join(h, FRIEND, CODE), join(h, FRIEND, CODE)]);
    expect([a.status, b.status]).toEqual([200, 200]);
  });

  it.each([['없음', undefined, 20], ['숫자 아님', 'abc', 20], ['0', '0', 20], ['3', '3', 3]])('MEMBER_LIMIT %s → %s명', async (_, raw, expected) => {
    const h = setup();
    h.env.MEMBER_LIMIT = raw;
    const admin = await h.login();
    expect((await j(await admin.as('GET', '/v1/members'))).body.limit).toBe(expected);
  });
});

describe('관리자: 멤버 목록과 내보내기', () => {
  it('Google 관리자는 활성 멤버만 가입 순으로 본다', async () => {
    const h = setup();
    await join(h, 'b@example.test', CODE);
    h.clock.now += 1000;
    await join(h, 'a@example.test', CODE);
    await join(h, 'c@example.test', CODE);
    const admin = await h.login();
    await admin.as('DELETE', `/v1/members/${encodeURIComponent('c@example.test')}`);
    expect(await j(await admin.as('GET', '/v1/members'))).toEqual({
      status: 200,
      body: { limit: 20, members: [{ identity: 'b@example.test', joinedAt: h.clock.now - 1000 }, { identity: 'a@example.test', joinedAt: h.clock.now }] },
    });
  });

  it('소셜 관리자(ALLOWED_ACCOUNTS)도 관리자다', async () => {
    const h = setup({ social: true });
    const { as } = await h.socialLogin('kakao', 'kakao-me');
    expect((await as('GET', '/v1/members')).status).toBe(200);
  });

  it('멤버는 관리자가 아니다(목록·내보내기 403 not-admin)', async () => {
    const h = setup();
    const friend = await join(h, FRIEND, CODE);
    await join(h, 'b@example.test', CODE);
    expect(await j(await friend.as('GET', '/v1/members'))).toMatchObject({ status: 403, body: { error: 'not-admin' } });
    expect(await j(await friend.as('DELETE', `/v1/members/${encodeURIComponent('b@example.test')}`))).toMatchObject({ status: 403, body: { error: 'not-admin' } });
    expect(rows(h, 'SELECT count(*) AS n FROM members WHERE removed_at IS NULL')).toEqual([{ n: 2 }]);
  });

  it('소셜 멤버도 관리자가 아니다', async () => {
    const h = setup({ social: true });
    const { response, as } = await h.socialLogin('kakao', 'friend', { invite: CODE });
    expect(response.status).toBe(200);
    expect((await as('GET', '/v1/members')).status).toBe(403);
  });

  it('멤버가 아니면 404', async () => {
    const h = setup();
    const admin = await h.login();
    expect((await admin.as('DELETE', `/v1/members/${encodeURIComponent('nobody@example.test')}`)).status).toBe(404);
  });

  it('내보낸 멤버는 세션이 끊기고 코드로 다시 가입할 수 없다', async () => {
    const h = setup();
    const friend = await join(h, FRIEND, CODE);
    const other = await join(h, 'b@example.test', CODE);
    const admin = await h.login();
    expect(await j(await admin.as('DELETE', `/v1/members/${encodeURIComponent(FRIEND)}`))).toEqual({ status: 200, body: { removed: true } });
    expect(rows(h, `SELECT count(*) AS n FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = '${FRIEND}' AND s.revoked_at IS NULL`)).toEqual([{ n: 0 }]);
    expect((await friend.as('GET', '/v1/profiles')).status).toBe(403);
    expect(await join(h, FRIEND, CODE)).toMatchObject({ status: 403, body: { error: 'not-allowed' } });
    // 다른 멤버와 관리자는 그대로
    expect((await other.as('GET', '/v1/profiles')).status).toBe(200);
    expect((await admin.as('GET', '/v1/profiles')).status).toBe(200);
  });

  it('내보낸 소셜 멤버는 세션 전용 인증이 403이다', async () => {
    const h = setup({ social: true });
    const friend = await h.socialLogin('kakao', 'friend', { invite: CODE });
    expect((await friend.as('GET', '/v1/profiles')).status).toBe(200);
    const admin = await h.login();
    expect((await admin.as('DELETE', `/v1/members/${encodeURIComponent('kakao:friend')}`)).status).toBe(200);
    expect((await friend.as('GET', '/v1/profiles')).status).toBe(401);
    expect((await h.socialLogin('kakao', 'friend', { invite: CODE })).response.status).toBe(403);
  });
});
