import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { FORBIDDEN_KEYS } from '../../src/lib/sync/forbidden';
import { APP_OUTDATED_CODE } from '../../src/lib/sync/dto';
import { sanitizeStrategiesV2 } from '../../src/lib/sim/strategyV2';
import { DAY } from './env';
import { harness, OTHER } from '../test/harness';
import { doc, docV2 } from '../test/docs';

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

  // Codex 리뷰(PR #39) 10차 3: 같은 opId 요청 둘이 겹쳐 둘 다 재시도 확인을 지나도(앞 요청이 아직 커밋 전), 뒤 요청은 500이 아니라 같은 결과다.
  it('겹친 같은 opId 요청도 같은 결과를 돌려준다(이력 넣기가 겹쳐도 500이 아니다)', async () => {
    const h = harness();
    const me = await h.login();
    const put = { opId: 'op-1', expectedRevision: 0, doc: doc() };
    expect((await me.as('PUT', '/v1/profiles/p1', put)).status).toBe(200);
    // 뒤 요청이 재시도 확인을 앞 요청 커밋 전에 했다고 친다
    const prepare = h.env.DB.prepare.bind(h.env.DB);
    h.env.DB.prepare = ((sql: string) => {
      const st = prepare(sql);
      if (sql.startsWith('SELECT profile_id AS profileId, revision FROM revisions')) return { bind: () => ({ first: async () => null }) } as unknown as typeof st;
      return st;
    }) as typeof h.env.DB.prepare;
    expect(await j(await me.as('PUT', '/v1/profiles/p1', put))).toEqual({ status: 200, body: { revision: 1 } });
    const del = { opId: 'op-2', expectedRevision: 1 };
    h.env.DB.prepare = prepare;
    expect((await me.as('DELETE', '/v1/profiles/p1', del)).status).toBe(200);
    h.env.DB.prepare = ((sql: string) => {
      const st = prepare(sql);
      if (sql.startsWith('SELECT profile_id AS profileId, revision FROM revisions')) return { bind: () => ({ first: async () => null }) } as unknown as typeof st;
      return st;
    }) as typeof h.env.DB.prepare;
    expect((await me.as('DELETE', '/v1/profiles/p1', del)).status).toBe(200);
    expect(count(h, 'SELECT count(*) AS n FROM revisions')).toBe(2);
  });

  // Codex 리뷰(PR #39) 12차 2: 리비전과 본문을 한 번에 읽는다(사이에 다른 기기가 바꿔도 짝이 어긋나지 않게).
  it('GET은 리비전과 본문을 같은 시점으로 돌려준다', async () => {
    const h = harness();
    const me = await h.login();
    await me.as('PUT', '/v1/profiles/p1', { opId: 'op-1', expectedRevision: 0, doc: doc('A') });
    const prepare = h.env.DB.prepare.bind(h.env.DB);
    h.env.DB.prepare = ((sql: string) => {
      // 본문만 따로 읽는 순간에 다른 기기가 리비전 2로 바꿨다고 친다
      if (sql.startsWith('SELECT body FROM profiles')) {
        h.env.DB.raw.prepare("UPDATE profile_index SET revision = 2 WHERE profile_id = 'p1'").run();
        h.env.DB.raw.prepare('UPDATE profiles SET body = ? WHERE profile_id = ?').run(JSON.stringify(doc('B')), 'p1');
      }
      return prepare(sql);
    }) as typeof h.env.DB.prepare;
    const got = await j(await me.as('GET', '/v1/profiles/p1'));
    h.env.DB.prepare = prepare;
    expect(got.body).toEqual({ revision: 1, doc: doc('A') });
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

describe('프로필 삭제·복구와 키 행(설계 2.6)', () => {
  const A = (n: number, c: string) => c.repeat(n);
  const vault = { vaultId: A(24, 'V'), kdf: 'PBKDF2-SHA256', iter: 600000, salt: A(24, 'S'), verifier: { nonce: A(16, 'N'), ciphertext: A(56, 'C') } };
  const blob = { expectedRevision: 0, newRevision: 1, contentId: A(24, 'I'), vaultId: A(24, 'V'), vaultRevision: 1, nonce: A(16, 'N'), ciphertext: A(64, 'X') };
  const keyRow = (h: ReturnType<typeof harness>) => h.env.DB.raw.prepare("SELECT revision, content_id, nonce, ciphertext FROM key_blobs WHERE profile_id = 'p1'").get();
  async function withKey() {
    const h = harness();
    const me = await h.login();
    await me.as('PUT', '/v1/profiles/p1', { opId: 'op-1', expectedRevision: 0, doc: doc() });
    await me.as('PUT', '/v1/keys/vault', vault);
    expect((await me.as('PUT', '/v1/keys/p1', blob)).status).toBe(200);
    return { h, me };
  }

  it('tombstone이 반영되면 같은 batch에서 키 행이 삭제 표시가 된다', async () => {
    const { h, me } = await withKey();
    expect((await me.as('DELETE', '/v1/profiles/p1', { opId: 'd1', expectedRevision: 1 })).status).toBe(200);
    expect(keyRow(h)).toEqual({ revision: 2, content_id: null, nonce: null, ciphertext: null });
    // 같은 opId 재전송은 다시 바꾸지 않는다
    expect((await me.as('DELETE', '/v1/profiles/p1', { opId: 'd1', expectedRevision: 1 })).status).toBe(200);
    expect(keyRow(h)).toMatchObject({ revision: 2 });
  });

  it('409로 끝난 삭제는 키 행을 바꾸지 않는다', async () => {
    const { h, me } = await withKey();
    await me.as('PUT', '/v1/profiles/p1', { opId: 'op-2', expectedRevision: 1, doc: doc('B') });
    expect((await me.as('DELETE', '/v1/profiles/p1', { opId: 'd1', expectedRevision: 1 })).status).toBe(409);
    expect(keyRow(h)).toEqual({ revision: 1, content_id: A(24, 'I'), nonce: A(16, 'N'), ciphertext: A(64, 'X') });
  });

  it('복원해도 살아 있는 블롭은 없다(고아 행이 있었어도 삭제 표시가 된다)', async () => {
    const { h, me } = await withKey();
    await me.as('DELETE', '/v1/profiles/p1', { opId: 'd1', expectedRevision: 1 });
    // 되돌린 Worker 기간에 tombstone이 키 행을 바꾸지 못했다고 친다
    h.env.DB.raw.prepare("UPDATE key_blobs SET revision = 1, content_id = ?, nonce = ?, ciphertext = ? WHERE profile_id = 'p1'").run(A(24, 'I'), A(16, 'N'), A(64, 'X'));
    expect((await me.as('POST', '/v1/profiles/p1/restore', { opId: 'r1' })).status).toBe(200);
    expect(keyRow(h)).toEqual({ revision: 2, content_id: null, nonce: null, ciphertext: null });
    expect((await me.as('GET', '/v1/keys/p1')).status).toBe(404);
  });
});

describe('문서 버전(전략 빌더 §8.3, PR①)', () => {
  const docV = (h: ReturnType<typeof harness>) => (h.env.DB.raw.prepare("SELECT doc_v AS n FROM profile_index WHERE profile_id = 'p1'").get() as { n: number }).n;

  it('docVersion 없이 v2 문서를 PUT하면 422 invalid이고 아무것도 저장하지 않는다', async () => {
    const h = harness();
    const me = await h.login();
    expect(await j(await me.as('PUT', '/v1/profiles/p1', { opId: 'op-1', expectedRevision: 0, doc: docV2() }))).toEqual({
      status: 422,
      body: { error: 'invalid', path: 'docVersion' },
    });
    expect(count(h, 'SELECT count(*) AS n FROM profile_index')).toBe(0);
    expect(count(h, 'SELECT count(*) AS n FROM profiles')).toBe(0);
    expect(count(h, 'SELECT count(*) AS n FROM revisions')).toBe(0);
  });

  it.each([docV2(), doc()])('docVersion=2는 v$v 문서 PUT을 허용한다', async (sent) => {
    const h = harness();
    const me = await h.login();
    expect(await j(await me.as('PUT', '/v1/profiles/p1?docVersion=2', { opId: 'op-1', expectedRevision: 0, doc: sent }))).toEqual({
      status: 200,
      body: { revision: 1 },
    });
    expect(docV(h)).toBe(sent.v);
    expect(await j(await me.as('GET', '/v1/profiles/p1?docVersion=2'))).toEqual({ status: 200, body: { revision: 1, doc: sent } });
  });

  it('반영된 opId라도 요청 버전보다 높은 문서는 재시도 확인 전에 거절한다', async () => {
    const h = harness();
    const me = await h.login();
    const put = { opId: 'op-1', expectedRevision: 0, doc: docV2() };
    expect((await me.as('PUT', '/v1/profiles/p1?docVersion=2', put)).status).toBe(200);
    expect(await j(await me.as('PUT', '/v1/profiles/p1', put))).toEqual({ status: 422, body: { error: 'invalid', path: 'docVersion' } });
    expect(count(h, 'SELECT count(*) AS n FROM revisions')).toBe(1);
  });

  function injectV2BeforeBodyRead(h: ReturnType<typeof harness>) {
    const prepare = h.env.DB.prepare.bind(h.env.DB);
    let headRead = false;
    let injected = false;
    h.env.DB.prepare = (sql: string) => {
      if (sql.startsWith('SELECT profile_id AS profileId') && sql.includes('FROM profile_index')) headRead = true;
      if (headRead && !injected && sql.startsWith('SELECT body FROM profiles')) {
        // 머리를 읽은 뒤 다른 요청이 v2 본문을 저장한 상황을 만든다.
        h.env.DB.raw.prepare("UPDATE profiles SET body = ? WHERE profile_id = 'p1'").run(JSON.stringify(docV2('경합')));
        h.env.DB.raw.prepare("UPDATE profile_index SET doc_v = 2 WHERE profile_id = 'p1'").run();
        injected = true;
      }
      return prepare(sql);
    };
    return () => {
      h.env.DB.prepare = prepare;
      return injected;
    };
  }

  it.each([
    { method: 'PUT', opId: 'op-conflict', expectedRevision: 0 },
    { method: 'DELETE', opId: 'op-conflict', expectedRevision: 2 },
    { method: 'DELETE', opId: 'op-1', expectedRevision: 1 },
  ])('본문 읽기 경합: $method 충돌(opId=$opId)은 옛 앱에 v2를 주지 않는다', async ({ method, opId, expectedRevision }) => {
    const h = harness();
    const me = await h.login();
    await me.as('PUT', '/v1/profiles/p1', { opId: 'op-1', expectedRevision: 0, doc: doc() });
    const finishRace = injectV2BeforeBodyRead(h);
    const r = await j(await me.as(method, '/v1/profiles/p1', { opId, expectedRevision, ...(method === 'PUT' ? { doc: doc('수정') } : {}) }));
    expect(finishRace()).toBe(true);
    expect(r).toEqual({ status: 409, body: { error: 'conflict', revision: 1, doc: null } });
  });

  it.each([false, true])('본문 읽기 경합: 복구(재시도=%s)는 옛 앱에 422를 돌려준다', async (retry) => {
    const h = harness();
    const me = await h.login();
    await me.as('PUT', '/v1/profiles/p1', { opId: 'op-1', expectedRevision: 0, doc: doc() });
    await me.as('DELETE', '/v1/profiles/p1', { opId: 'op-2', expectedRevision: 1 });
    if (retry) expect((await me.as('POST', '/v1/profiles/p1/restore', { opId: 'op-3' })).status).toBe(200);
    const finishRace = injectV2BeforeBodyRead(h);
    const r = await j(await me.as('POST', '/v1/profiles/p1/restore', { opId: 'op-3' }));
    expect(finishRace()).toBe(true);
    expect(r).toEqual({ status: 422, body: { error: APP_OUTDATED_CODE } });
  });

  it('옛 앱(쿼리 없음)은 v2 문서를 받지 못한다: GET·리비전 422', async () => {
    const h = harness();
    const me = await h.login();
    await me.as('PUT', '/v1/profiles/p1?docVersion=2', { opId: 'op-1', expectedRevision: 0, doc: docV2() });
    expect(await j(await me.as('GET', '/v1/profiles/p1'))).toEqual({ status: 422, body: { error: APP_OUTDATED_CODE } });
    expect((await me.as('GET', '/v1/profiles/p1/revisions/1')).status).toBe(422);
    expect(await j(await me.as('GET', '/v1/profiles/p1?docVersion=2'))).toEqual({ status: 200, body: { revision: 1, doc: docV2() } });
    expect((await j(await me.as('GET', '/v1/profiles/p1/revisions/1?docVersion=2'))).body).toEqual({ revision: 1, doc: docV2() });
  });

  it('docVersion 없으면 버전 1로 동작하고, 현재 v2여도 과거 v1 리비전은 돌려준다', async () => {
    const h = harness();
    const me = await h.login();
    const oldDoc = doc('과거');
    expect((await me.as('PUT', '/v1/profiles/p1', { opId: 'op-1', expectedRevision: 0, doc: oldDoc })).status).toBe(200);
    expect(await j(await me.as('GET', '/v1/profiles/p1'))).toEqual({ status: 200, body: { revision: 1, doc: oldDoc } });
    expect((await me.as('PUT', '/v1/profiles/p1?docVersion=2', { opId: 'op-2', expectedRevision: 1, doc: docV2() })).status).toBe(200);
    expect(docV(h)).toBe(2);
    expect(await j(await me.as('GET', '/v1/profiles/p1'))).toEqual({ status: 422, body: { error: APP_OUTDATED_CODE } });
    // §8.3의 저장 버전은 현재 색인이 아니라 요청한 리비전 본문의 v를 뜻한다.
    expect(await j(await me.as('GET', '/v1/profiles/p1/revisions/1'))).toEqual({ status: 200, body: { revision: 1, doc: oldDoc } });
    expect(await j(await me.as('GET', '/v1/profiles/p1/revisions/2'))).toEqual({ status: 422, body: { error: APP_OUTDATED_CODE } });
  });

  it('요청 버전보다 높은 PUT은 충돌보다 먼저 거절한다', async () => {
    const h = harness();
    const me = await h.login();
    await me.as('PUT', '/v1/profiles/p1?docVersion=2', { opId: 'op-1', expectedRevision: 0, doc: docV2() });
    await me.as('PUT', '/v1/profiles/p1?docVersion=2', { opId: 'op-2', expectedRevision: 1, doc: docV2('A') });
    const stale = await j(await me.as('PUT', '/v1/profiles/p1', { opId: 'op-3', expectedRevision: 1, doc: docV2('B') }));
    expect(stale).toEqual({ status: 422, body: { error: 'invalid', path: 'docVersion' } });
    const fresh = await j(await me.as('PUT', '/v1/profiles/p1?docVersion=2', { opId: 'op-4', expectedRevision: 1, doc: docV2('B') }));
    expect(fresh).toEqual({ status: 409, body: { error: 'conflict', revision: 2, doc: docV2('A') } });
  });

  it('deleteProfile의 409도 doc을 뺀다', async () => {
    const h = harness();
    const me = await h.login();
    await me.as('PUT', '/v1/profiles/p1?docVersion=2', { opId: 'op-1', expectedRevision: 0, doc: docV2() });
    // 같은 opId가 이미 PUT으로 반영된 경우(h.lastOpId === opId, 삭제 아님) → 409
    const r = await j(await me.as('DELETE', '/v1/profiles/p1', { opId: 'op-1', expectedRevision: 1 }));
    expect(r.status).toBe(409);
    expect(r.body.doc).toBeNull();
  });

  it('삭제된 v2 프로필: GET은 410(버전 검사 전), 옛 앱의 복원은 바꾸기 전에 422', async () => {
    const h = harness();
    const me = await h.login();
    await me.as('PUT', '/v1/profiles/p1?docVersion=2', { opId: 'op-1', expectedRevision: 0, doc: docV2() });
    await me.as('DELETE', '/v1/profiles/p1', { opId: 'op-2', expectedRevision: 1 });
    expect((await me.as('GET', '/v1/profiles/p1')).status).toBe(410);
    expect(await j(await me.as('POST', '/v1/profiles/p1/restore', { opId: 'op-3' }))).toEqual({ status: 422, body: { error: APP_OUTDATED_CODE } });
    expect((h.env.DB.raw.prepare("SELECT deleted_at AS d FROM profile_index WHERE profile_id = 'p1'").get() as { d: number | null }).d).not.toBeNull();
    const ok = await j(await me.as('POST', '/v1/profiles/p1/restore?docVersion=2', { opId: 'op-3' }));
    expect(ok).toEqual({ status: 200, body: { revision: 3, doc: docV2() } });
  });

  it.each([0, 1, 2])('삭제된 v2에 옛 앱이 v1 PUT(expectedRevision=%s)을 보내면 422보다 410 gone이 우선한다', async (expectedRevision) => {
    const h = harness();
    const me = await h.login();
    expect((await me.as('PUT', '/v1/profiles/p1?docVersion=2', { opId: 'op-1', expectedRevision: 0, doc: docV2() })).status).toBe(200);
    expect((await me.as('DELETE', '/v1/profiles/p1', { opId: 'op-2', expectedRevision: 1 })).status).toBe(200);
    const before = h.env.DB.raw.prepare("SELECT * FROM profile_index WHERE profile_id = 'p1'").get();
    expect(before).toMatchObject({ doc_v: 2, deleted_at: h.clock.now, revision: 2 });
    expect(await j(await me.as('PUT', '/v1/profiles/p1', { opId: 'op-3', expectedRevision, doc: doc() }))).toEqual({
      status: 410,
      body: { error: 'gone', deletedAt: h.clock.now, purgeAt: h.clock.now + 30 * DAY, revision: 2 },
    });
    expect(h.env.DB.raw.prepare("SELECT * FROM profile_index WHERE profile_id = 'p1'").get()).toEqual(before);
    expect(count(h, 'SELECT count(*) AS n FROM revisions')).toBe(2);
  });

  it('v2 복원 뒤 옛 앱이 같은 opId로 재시도하면 422이고 상태는 그대로다', async () => {
    const h = harness();
    const me = await h.login();
    expect((await me.as('PUT', '/v1/profiles/p1?docVersion=2', { opId: 'op-1', expectedRevision: 0, doc: docV2() })).status).toBe(200);
    expect((await me.as('DELETE', '/v1/profiles/p1', { opId: 'op-2', expectedRevision: 1 })).status).toBe(200);
    const restore = { opId: 'op-3' };
    expect(await j(await me.as('POST', '/v1/profiles/p1/restore?docVersion=2', restore))).toEqual({ status: 200, body: { revision: 3, doc: docV2() } });
    const before = h.env.DB.raw.prepare("SELECT * FROM profile_index WHERE profile_id = 'p1'").get();
    expect(before).toMatchObject({ doc_v: 2, deleted_at: null, last_op_id: restore.opId });
    expect(await j(await me.as('POST', '/v1/profiles/p1/restore', restore))).toEqual({ status: 422, body: { error: APP_OUTDATED_CODE } });
    expect(h.env.DB.raw.prepare("SELECT * FROM profile_index WHERE profile_id = 'p1'").get()).toEqual(before);
    expect(count(h, 'SELECT count(*) AS n FROM revisions')).toBe(3);
  });

  it.each(['two', '0', '01', '1000', ''])('docVersion=%s는 422 invalid(path docVersion)다', async (value) => {
    const h = harness();
    const me = await h.login();
    expect(await j(await me.as('GET', `/v1/profiles/p1?docVersion=${value}`))).toEqual({ status: 422, body: { error: 'invalid', path: 'docVersion' } });
  });

  it('새로 만들기·갱신이 doc_v를 기록한다', async () => {
    const h = harness();
    const me = await h.login();
    await me.as('PUT', '/v1/profiles/p1', { opId: 'op-1', expectedRevision: 0, doc: doc() });
    expect(docV(h)).toBe(1);
    expect((await me.as('PUT', '/v1/profiles/p1?docVersion=2', { opId: 'op-2', expectedRevision: 1, doc: docV2() })).status).toBe(200);
    expect(docV(h)).toBe(2);
  });

  it('0003까지 적용한 DB의 기존 행은 0004 마이그레이션 뒤 doc_v = 1이다', () => {
    const db = new DatabaseSync(':memory:');
    const migration = (file: string) => readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
    try {
      db.exec('PRAGMA foreign_keys = ON');
      for (const file of ['0001_init.sql', '0002_social_sessions.sql', '0003_key_vault.sql']) db.exec(migration(file));
      expect((db.prepare('PRAGMA table_info(profile_index)').all() as { name: string }[]).map((column) => column.name)).not.toContain('doc_v');
      db.prepare("INSERT INTO users (id, firebase_sub, email, created_at, last_seen_at) VALUES ('u1', 's1', 'a@example.test', 0, 0)").run();
      db.prepare("INSERT INTO profile_index (user_id, profile_id, revision, last_op_id, updated_at) VALUES ('u1', 'old', 1, 'op-old', 0)").run();
      db.exec(migration('0004_doc_version.sql'));
      expect(db.prepare("SELECT profile_id, revision, last_op_id, doc_v FROM profile_index WHERE profile_id = 'old'").get()).toEqual({
        profile_id: 'old',
        revision: 1,
        last_op_id: 'op-old',
        doc_v: 1,
      });
    } finally {
      db.close();
    }
  });

  it('v2 위에 v1을 올리면 422로 거절하고 서버는 그대로다', async () => {
    const h = harness();
    const me = await h.login();
    await me.as('PUT', '/v1/profiles/p1?docVersion=2', { opId: 'op-1', expectedRevision: 0, doc: docV2() });
    expect(await j(await me.as('PUT', '/v1/profiles/p1', { opId: 'op-2', expectedRevision: 1, doc: doc('옛') }))).toEqual({
      status: 422,
      body: { error: APP_OUTDATED_CODE },
    });
    expect(docV(h)).toBe(2);
    expect(count(h, 'SELECT count(*) AS n FROM revisions')).toBe(1);
  });

  it('이미 있는 v2 프로필에 v1 새로 만들기도 422', async () => {
    const h = harness();
    const me = await h.login();
    await me.as('PUT', '/v1/profiles/p1?docVersion=2', { opId: 'op-1', expectedRevision: 0, doc: docV2() });
    expect((await j(await me.as('PUT', '/v1/profiles/p1', { opId: 'op-2', expectedRevision: 0, doc: doc() }))).status).toBe(422);
  });

  it('검사와 갱신 사이에 다른 기기가 v2를 올려도 조건부 UPDATE가 막는다', async () => {
    // 아래 startsWith 문자열은 putProfile의 UPDATE SQL 첫 줄과 같아야 한다.
    const h = harness();
    const me = await h.login();
    await me.as('PUT', '/v1/profiles/p1', { opId: 'op-1', expectedRevision: 0, doc: doc() });
    const prepare = h.env.DB.prepare.bind(h.env.DB);
    h.env.DB.prepare = ((sql: string) => {
      if (sql.startsWith('UPDATE profile_index SET revision = ?, last_op_id = ?, updated_at = ?, doc_v')) h.env.DB.raw.prepare("UPDATE profile_index SET doc_v = 2 WHERE profile_id = 'p1'").run();
      return prepare(sql);
    }) as typeof h.env.DB.prepare;
    const r = await j(await me.as('PUT', '/v1/profiles/p1', { opId: 'op-2', expectedRevision: 1, doc: doc('A') }));
    h.env.DB.prepare = prepare;
    expect(r).toEqual({ status: 422, body: { error: APP_OUTDATED_CODE } });
  });

  it('반영된 같은 opId를 다시 보내면 버전 검사 전에 처음 결과를 돌려준다', async () => {
    const h = harness();
    const me = await h.login();
    const put = { opId: 'op-1', expectedRevision: 0, doc: doc() };
    await me.as('PUT', '/v1/profiles/p1', put);
    h.env.DB.raw.prepare("UPDATE profile_index SET doc_v = 2 WHERE profile_id = 'p1'").run();
    expect(await j(await me.as('PUT', '/v1/profiles/p1', put))).toEqual({ status: 200, body: { revision: 1 } });
  });
});

describe('PR①만 배포: 옛 앱(쿼리 없음 + v1 문서) 경로 무변화(§8.7)', () => {
  it('만들기·읽기·갱신·충돌·삭제·복원 응답 모양이 지금과 같다', async () => {
    const h = harness();
    const me = await h.login();
    expect(await j(await me.as('PUT', '/v1/profiles/p1', { opId: 'op-1', expectedRevision: 0, doc: doc() }))).toEqual({ status: 200, body: { revision: 1 } });
    expect(await j(await me.as('GET', '/v1/profiles/p1'))).toEqual({ status: 200, body: { revision: 1, doc: doc() } });
    expect((await j(await me.as('PUT', '/v1/profiles/p1', { opId: 'op-2', expectedRevision: 1, doc: doc('A') }))).body).toEqual({ revision: 2 });
    expect(await j(await me.as('PUT', '/v1/profiles/p1', { opId: 'op-3', expectedRevision: 1, doc: doc('B') }))).toEqual({
      status: 409,
      body: { error: 'conflict', revision: 2, doc: doc('A') },
    });
    expect((await j(await me.as('GET', '/v1/profiles/p1/revisions/2'))).body).toEqual({ revision: 2, doc: doc('A') });
    expect((await me.as('DELETE', '/v1/profiles/p1', { opId: 'op-4', expectedRevision: 2 })).status).toBe(200);
    expect(await j(await me.as('POST', '/v1/profiles/p1/restore', { opId: 'op-5' }))).toEqual({ status: 200, body: { revision: 4, doc: doc('A') } });
  });

  it('저장소에는 받은 원본 그대로 들어간다', async () => {
    const h = harness();
    const me = await h.login();
    const snapshot = docV2();
    const { id, ...strategy } = snapshot.strategies[0];
    const sent = { ...snapshot, strategies: [{ ...strategy, id }] };
    const cleaned = sanitizeStrategiesV2({ strategies: sent.strategies }, h.clock.now).strategies;
    expect(sent.strategies).toEqual(cleaned);
    expect(JSON.stringify(sent.strategies)).not.toBe(JSON.stringify(cleaned));
    expect((await me.as('PUT', '/v1/profiles/p1?docVersion=2', { opId: 'op-1', expectedRevision: 0, doc: sent })).status).toBe(200);
    const body = (h.env.DB.raw.prepare("SELECT body FROM profiles WHERE profile_id = 'p1'").get() as { body: string }).body;
    expect(body).toBe(JSON.stringify(sent));
  });
});
