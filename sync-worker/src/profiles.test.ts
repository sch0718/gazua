import { describe, expect, it } from 'vitest';
import { FORBIDDEN_KEYS } from '../../src/lib/sync/forbidden';
import { DAY } from './env';
import { harness, OTHER } from '../test/harness';
import { doc } from '../test/docs';

const j = async (r: Response) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> });
const count = (h: ReturnType<typeof harness>, sql: string) => (h.env.DB.raw.prepare(sql).get() as { n: number }).n;

describe('프로필 API', () => {
  it('새로 만들고(expectedRevision 0) 읽는다', async () => {
    const h = harness();
    const me = await h.login();
    expect(await j(await me.as('PUT', '/v1/profiles/p1', { opId: 'op-1', expectedRevision: 0, doc: doc() }))).toEqual({ status: 200, body: { revision: 1 } });
    expect(await j(await me.as('GET', '/v1/profiles/p1'))).toEqual({ status: 200, body: { revision: 1, doc: doc() } });
    const list = await j(await me.as('GET', '/v1/profiles'));
    expect(list.body.profiles).toEqual([{ profileId: 'p1', revision: 1, updatedAt: h.clock.now, deletedAt: null, purgeAt: null }]);
  });

  it('기준 리비전이 맞을 때만 갱신하고, 다르면 409와 현재 본문을 돌려준다', async () => {
    const h = harness();
    const me = await h.login();
    await me.as('PUT', '/v1/profiles/p1', { opId: 'op-1', expectedRevision: 0, doc: doc() });
    expect((await j(await me.as('PUT', '/v1/profiles/p1', { opId: 'op-2', expectedRevision: 1, doc: doc('A') }))).body).toEqual({ revision: 2 });
    const stale = await j(await me.as('PUT', '/v1/profiles/p1', { opId: 'op-3', expectedRevision: 1, doc: doc('B') }));
    expect(stale).toEqual({ status: 409, body: { error: 'conflict', revision: 2, doc: doc('A') } });
    // 이미 있는 프로필을 새로 만들기로 보내도 충돌
    expect((await me.as('PUT', '/v1/profiles/p1', { opId: 'op-4', expectedRevision: 0, doc: doc('C') })).status).toBe(409);
    expect(count(h, 'SELECT count(*) AS n FROM revisions')).toBe(2);
  });

  it('같은 opId로 다시 보내면 처음 결과를 돌려주고 리비전은 하나만 생긴다', async () => {
    const h = harness();
    const me = await h.login();
    const put = { opId: 'op-1', expectedRevision: 0, doc: doc() };
    expect((await j(await me.as('PUT', '/v1/profiles/p1', put))).body).toEqual({ revision: 1 });
    expect((await j(await me.as('PUT', '/v1/profiles/p1', put))).body).toEqual({ revision: 1 });
    const upd = { opId: 'op-2', expectedRevision: 1, doc: doc('A') };
    await me.as('PUT', '/v1/profiles/p1', upd);
    expect((await j(await me.as('PUT', '/v1/profiles/p1', upd))).body).toEqual({ revision: 2 });
    expect(count(h, 'SELECT count(*) AS n FROM revisions')).toBe(2);
    // 다른 프로필에 같은 opId를 쓰면 거절
    expect((await me.as('PUT', '/v1/profiles/p2', { ...upd, expectedRevision: 0 })).status).toBe(422);
  });

  it('같은 기준으로 두 기기가 동시에 보내면 하나만 성공한다', async () => {
    const h = harness();
    const me = await h.login();
    await me.as('PUT', '/v1/profiles/p1', { opId: 'op-1', expectedRevision: 0, doc: doc() });
    const [a, b] = await Promise.all([
      me.as('PUT', '/v1/profiles/p1', { opId: 'op-a', expectedRevision: 1, doc: doc('A') }),
      me.as('PUT', '/v1/profiles/p1', { opId: 'op-b', expectedRevision: 1, doc: doc('B') }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  it('현재와 과거 10개만 남긴다', async () => {
    const h = harness();
    const me = await h.login();
    await me.as('PUT', '/v1/profiles/p1', { opId: 'op-0', expectedRevision: 0, doc: doc('v1') });
    for (let r = 1; r <= 14; r++) await me.as('PUT', '/v1/profiles/p1', { opId: `op-${r}`, expectedRevision: r, doc: doc(`v${r + 1}`) });
    const revs = (await j(await me.as('GET', '/v1/profiles/p1/revisions'))).body.revisions as { revision: number }[];
    expect(revs.map((r) => r.revision)).toEqual([15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5]);
    expect((await j(await me.as('GET', '/v1/profiles/p1/revisions/5'))).body).toEqual({ revision: 5, doc: doc('v5') });
    expect((await me.as('GET', '/v1/profiles/p1/revisions/4')).status).toBe(404);
  });

  it('삭제는 tombstone이고, 이후 쓰기·읽기는 410이며, 30일 안에는 복구된다', async () => {
    const h = harness();
    const me = await h.login();
    await me.as('PUT', '/v1/profiles/p1', { opId: 'op-1', expectedRevision: 0, doc: doc('원본') });
    const del = await j(await me.as('DELETE', '/v1/profiles/p1', { opId: 'op-2', expectedRevision: 1 }));
    expect(del).toEqual({ status: 200, body: { revision: 2, deletedAt: h.clock.now, purgeAt: h.clock.now + 30 * DAY } });
    // 같은 삭제를 다시 보내도 성공
    expect((await me.as('DELETE', '/v1/profiles/p1', { opId: 'op-2', expectedRevision: 1 })).status).toBe(200);
    // 오래 오프라인이던 기기의 수정은 되살리지 못한다
    const late = await j(await me.as('PUT', '/v1/profiles/p1', { opId: 'op-3', expectedRevision: 1, doc: doc('늦은 수정') }));
    expect(late).toMatchObject({ status: 410, body: { error: 'gone', deletedAt: h.clock.now } });
    expect((await me.as('PUT', '/v1/profiles/p1', { opId: 'op-4', expectedRevision: 0, doc: doc('새로') })).status).toBe(410);
    expect((await me.as('GET', '/v1/profiles/p1')).status).toBe(410);
    expect(((await j(await me.as('GET', '/v1/profiles'))).body.profiles as { deletedAt: number }[])[0].deletedAt).toBe(h.clock.now);

    h.clock.now += 29 * DAY;
    const restored = await j(await me.as('POST', '/v1/profiles/p1/restore', { opId: 'op-5' }));
    expect(restored).toEqual({ status: 200, body: { revision: 3, doc: doc('원본') } });
    expect((await j(await me.as('GET', '/v1/profiles/p1'))).body).toEqual({ revision: 3, doc: doc('원본') });
    expect((await me.as('POST', '/v1/profiles/p1/restore', { opId: 'op-6' })).status).toBe(409);
  });

  it('삭제 기준이 다르면 409(다른 기기가 먼저 고쳤다)', async () => {
    const h = harness();
    const me = await h.login();
    await me.as('PUT', '/v1/profiles/p1', { opId: 'op-1', expectedRevision: 0, doc: doc() });
    await me.as('PUT', '/v1/profiles/p1', { opId: 'op-2', expectedRevision: 1, doc: doc('A') });
    expect(await j(await me.as('DELETE', '/v1/profiles/p1', { opId: 'op-3', expectedRevision: 1 }))).toEqual({
      status: 409,
      body: { error: 'conflict', revision: 2, doc: doc('A') },
    });
  });

  it('30일이 지나면 복구할 수 없다', async () => {
    const h = harness();
    const me = await h.login();
    await me.as('PUT', '/v1/profiles/p1', { opId: 'op-1', expectedRevision: 0, doc: doc() });
    await me.as('DELETE', '/v1/profiles/p1', { opId: 'op-2', expectedRevision: 1 });
    h.clock.now += 15 * DAY;
    await me.as('GET', '/v1/profiles'); // 세션 연장
    h.clock.now += 15 * DAY;
    expect((await me.as('POST', '/v1/profiles/p1/restore', { opId: 'op-3' })).status).toBe(410);
  });

  it('정리된 뒤 expectedRevision > 0으로 보내면 410(부활 금지)', async () => {
    const h = harness();
    const me = await h.login();
    expect((await me.as('PUT', '/v1/profiles/p9', { opId: 'op-1', expectedRevision: 3, doc: doc() })).status).toBe(410);
    expect(count(h, 'SELECT count(*) AS n FROM profile_index')).toBe(0);
  });

  it('다른 사용자는 같은 profileId라도 읽기·쓰기·삭제·복구·이력 조회를 할 수 없다', async () => {
    const h = harness();
    const me = await h.login();
    const other = await h.login(OTHER, 'uid-other');
    await me.as('PUT', '/v1/profiles/p1', { opId: 'op-1', expectedRevision: 0, doc: doc('내 것') });
    expect((await other.as('GET', '/v1/profiles/p1')).status).toBe(404);
    expect((await other.as('GET', '/v1/profiles/p1/revisions')).status).toBe(404);
    expect((await other.as('GET', '/v1/profiles/p1/revisions/1')).status).toBe(404);
    expect((await other.as('PUT', '/v1/profiles/p1', { opId: 'op-x', expectedRevision: 1, doc: doc('남의 것') })).status).toBe(410);
    expect((await other.as('DELETE', '/v1/profiles/p1', { opId: 'op-y', expectedRevision: 1 })).status).toBe(410);
    expect((await other.as('POST', '/v1/profiles/p1/restore', { opId: 'op-z' })).status).toBe(404);
    expect((await j(await other.as('GET', '/v1/profiles'))).body.profiles).toEqual([]);
    // 같은 ID로 만들어도 서로 다른 공간이다
    expect((await other.as('PUT', '/v1/profiles/p1', { opId: 'op-o', expectedRevision: 0, doc: doc('남의 것') })).status).toBe(200);
    expect((await j(await me.as('GET', '/v1/profiles/p1'))).body.doc).toEqual(doc('내 것'));
    // 다른 사용자가 내 opId를 알아도 내 결과를 받지 못한다
    expect((await other.as('PUT', '/v1/profiles/p2', { opId: 'op-1', expectedRevision: 0, doc: doc() })).status).toBe(200);
  });

  it('클라이언트가 보낸 ownerId는 받지 않는다', async () => {
    const h = harness();
    const me = await h.login();
    const r = await j(await me.as('PUT', '/v1/profiles/p1', { opId: 'op-1', expectedRevision: 0, doc: { ...doc(), ownerId: 'uid-other' } }));
    expect(r).toEqual({ status: 422, body: { error: 'forbidden-field', path: 'ownerId' } });
  });

  it.each(FORBIDDEN_KEYS)('금지 키 %s를 넣으면 422이고 아무것도 저장하지 않는다', async (key) => {
    const h = harness();
    const me = await h.login();
    const d = doc() as unknown as { watchlists: { groups: Record<string, unknown>[] } };
    d.watchlists.groups[0][key] = 'FAKE';
    const r = await j(await me.as('PUT', '/v1/profiles/p1', { opId: 'op-1', expectedRevision: 0, doc: d }));
    expect(r).toEqual({ status: 422, body: { error: 'forbidden-field', path: `watchlists.groups[0].${key}` } });
    expect(count(h, 'SELECT count(*) AS n FROM profile_index') + count(h, 'SELECT count(*) AS n FROM profiles') + count(h, 'SELECT count(*) AS n FROM revisions')).toBe(0);
  });

  it('계좌·키 모양 객체(secrets, orders)를 통째로 넣어도 거절한다', async () => {
    const h = harness();
    const me = await h.login();
    for (const extra of [
      { secrets: { kis: { appKey: 'FAKE', appSecret: 'FAKE' } } },
      { orders: [{ accountId: 'FAKE', price: 1 }] },
      { settings: { ...doc().settings, proxyUrl: 'https://fake.example.test' } },
    ]) {
      const r = await me.as('PUT', '/v1/profiles/p1', { opId: crypto.randomUUID(), expectedRevision: 0, doc: { ...doc(), ...extra } });
      expect(r.status).toBe(422);
    }
    expect(count(h, 'SELECT count(*) AS n FROM profiles')).toBe(0);
  });

  it('알 수 없는 필드·틀린 값·opId 형식 오류는 422', async () => {
    const h = harness();
    const me = await h.login();
    expect((await j(await me.as('PUT', '/v1/profiles/p1', { opId: 'op-1', expectedRevision: 0, doc: { ...doc(), note: 'x' } }))).body).toEqual({
      error: 'unknown-field',
      path: 'note',
    });
    expect((await me.as('PUT', '/v1/profiles/p1', { opId: 'op 1', expectedRevision: 0, doc: doc() })).status).toBe(422);
    expect((await me.as('PUT', '/v1/profiles/p1', { opId: 'op-1', expectedRevision: -1, doc: doc() })).status).toBe(422);
    expect((await me.as('PUT', '/v1/profiles/p1', { opId: 'op-1', expectedRevision: 0.5, doc: doc() })).status).toBe(422);
    expect((await me.as('PUT', '/v1/profiles/bad%20id', { opId: 'op-1', expectedRevision: 0, doc: doc() })).status).toBe(404);
  });

  it('batch 중간에 실패하면 아무것도 바뀌지 않는다', async () => {
    const h = harness();
    const me = await h.login();
    await me.as('PUT', '/v1/profiles/p1', { opId: 'op-1', expectedRevision: 0, doc: doc('원본') });
    h.env.DB.failNextBatchAt(2);
    expect((await me.as('PUT', '/v1/profiles/p1', { opId: 'op-2', expectedRevision: 1, doc: doc('A') })).status).toBe(500);
    expect((await j(await me.as('GET', '/v1/profiles/p1'))).body).toEqual({ revision: 1, doc: doc('원본') });
    // 같은 opId로 재시도하면 성공
    expect((await j(await me.as('PUT', '/v1/profiles/p1', { opId: 'op-2', expectedRevision: 1, doc: doc('A') }))).body).toEqual({ revision: 2 });
  });
});
