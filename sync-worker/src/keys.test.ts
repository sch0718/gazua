import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { harness, OTHER, type Caller } from '../test/harness';
import { doc } from '../test/docs';

// 서버는 암호문을 풀지 않으므로 모양만 맞는 지어낸 base64를 쓴다
const A = (n: number, c: string) => c.repeat(n);
const VID = A(24, 'V');
const VID2 = A(24, 'W');
const SALT = A(24, 'S');
const SALT2 = A(24, 'T');
const vaultBody = (o: Record<string, unknown> = {}) => ({
  vaultId: VID,
  kdf: 'PBKDF2-SHA256',
  iter: 600000,
  salt: SALT,
  verifier: { nonce: A(16, 'N'), ciphertext: A(56, 'C') },
  ...o,
});
const blobBody = (o: Record<string, unknown> = {}) => ({
  expectedRevision: 0,
  newRevision: 1,
  contentId: A(24, 'I'),
  vaultId: VID,
  vaultRevision: 1,
  nonce: A(16, 'N'),
  ciphertext: A(64, 'X'),
  ...o,
});
const rekeyBody = (blobs: { profileId: string; revision: number; contentId?: string }[], o: Record<string, unknown> = {}) => ({
  expectedVaultId: VID,
  expectedVaultRevision: 1,
  salt: SALT2,
  verifier: { nonce: A(16, 'M'), ciphertext: A(56, 'D') },
  keyBlobs: blobs.map((b) => ({ profileId: b.profileId, revision: b.revision, contentId: b.contentId ?? A(24, 'I'), nonce: A(16, 'M'), ciphertext: A(64, 'R') })),
  ...o,
});

type H = ReturnType<typeof harness>;
const j = async (r: Response) => ({ status: r.status, body: (await r.json()) as Record<string, any> });
const rows = (h: H, sql: string) => h.env.DB.raw.prepare(sql).all() as Record<string, unknown>[];
const state = (h: H) => JSON.stringify([rows(h, 'SELECT * FROM key_vault ORDER BY user_id'), rows(h, 'SELECT * FROM key_blobs ORDER BY user_id, profile_id')]);
const blobRow = (h: H, p: string) => h.env.DB.raw.prepare('SELECT * FROM key_blobs WHERE profile_id = ?').get(p) as Record<string, unknown> | undefined;

async function setup(profiles = ['p1']) {
  const h = harness();
  const me = await h.login();
  for (const p of profiles) expect((await me.as('PUT', `/v1/profiles/${p}`, { opId: `op-${p}`, expectedRevision: 0, doc: doc() })).status).toBe(200);
  expect((await me.as('PUT', '/v1/keys/vault', vaultBody())).status).toBe(200);
  return { h, me };
}
const put = (me: { as: Caller }, p: string, o: Record<string, unknown> = {}) => me.as('PUT', `/v1/keys/${p}`, blobBody(o));

describe('키 API 라우팅', () => {
  it('vault·rekey는 :id보다 먼저, 다른 메서드는 404이고 로그 패턴은 /v1/keys/:id, 두 DELETE는 본문 없이 200', async () => {
    const { h, me } = await setup();
    expect((await me.as('GET', '/v1/keys/vault')).status).toBe(404);
    expect((await me.as('PUT', '/v1/keys/rekey', blobBody())).status).toBe(404);
    expect(h.logs.some((l) => l.startsWith('GET /v1/keys/:id 404'))).toBe(true);
    expect(h.logs.some((l) => l.startsWith('PUT /v1/keys/:id 404'))).toBe(true);
    expect(await j(await me.as('DELETE', '/v1/keys/p1'))).toEqual({ status: 200, body: { deleted: false, revision: 0 } });
    expect(await j(await me.as('DELETE', '/v1/keys'))).toEqual({ status: 200, body: { deleted: { vault: true, blobs: 0 } } });
    expect((await h.call('GET', '/v1/keys')).status).toBe(401);
  });
});

describe('금고', () => {
  it('만들기 200, 같은 요청 다시 200, 다른 vaultId는 409 vault-exists(머리 포함), iter 310000은 422', async () => {
    const h = harness();
    const me = await h.login();
    const first = await j(await me.as('PUT', '/v1/keys/vault', vaultBody()));
    expect(first).toEqual({ status: 200, body: { vaultRevision: 1, updatedAt: h.clock.now } });
    expect((await j(await me.as('PUT', '/v1/keys/vault', vaultBody()))).status).toBe(200);
    const other = await j(await me.as('PUT', '/v1/keys/vault', vaultBody({ vaultId: VID2 })));
    expect(other.status).toBe(409);
    expect(other.body).toEqual({
      error: 'vault-exists',
      keyVault: { vaultId: VID, kdf: 'PBKDF2-SHA256', iter: 600000, salt: SALT, verifier: { nonce: A(16, 'N'), ciphertext: A(56, 'C') }, vaultRevision: 1, updatedAt: h.clock.now },
    });
    expect(await j(await me.as('PUT', '/v1/keys/vault', vaultBody({ iter: 310000 })))).toEqual({ status: 422, body: { error: 'invalid', path: 'iter' } });
    expect(await j(await me.as('PUT', '/v1/keys/vault', { ...vaultBody(), extra: 1 }))).toEqual({ status: 422, body: { error: 'unknown-field', path: 'extra' } });
  });

  it('지우고 다시 만든 금고: 옛 vaultId로 보낸 블롭 PUT·rekey는 409 vault-changed이고 아무것도 바뀌지 않는다', async () => {
    const { h, me } = await setup();
    expect((await put(me, 'p1')).status).toBe(200);
    expect((await me.as('DELETE', '/v1/keys')).status).toBe(200);
    expect((await me.as('PUT', '/v1/keys/vault', vaultBody({ vaultId: VID2 }))).status).toBe(200);
    expect((await put(me, 'p1', { contentId: A(24, 'J'), vaultId: VID2 })).status).toBe(200);
    const before = state(h);
    const stale = await j(await put(me, 'p1', { expectedRevision: 1, newRevision: 2 }));
    expect(stale).toEqual({ status: 409, body: { error: 'vault-changed', vaultRevision: 1 } });
    const rk = await j(await me.as('POST', '/v1/keys/rekey', rekeyBody([{ profileId: 'p1', revision: 1, contentId: A(24, 'J') }])));
    expect(rk).toEqual({ status: 409, body: { error: 'vault-changed', vaultRevision: 1 } });
    expect(state(h)).toBe(before);
  });
});

describe('블롭 PUT', () => {
  it('없음 404, tombstone 410, 금고 없음 409 no-vault, 금고 리비전 다름 409 vault-changed, 리비전 다름 409 conflict', async () => {
    const { h, me } = await setup(['p1', 'p2']);
    expect((await j(await put(me, 'p9'))).status).toBe(404);
    await me.as('DELETE', '/v1/profiles/p2', { opId: 'd2', expectedRevision: 1 });
    const gone = await j(await put(me, 'p2'));
    expect(gone.status).toBe(410);
    expect(gone.body).toMatchObject({ error: 'gone', deletedAt: h.clock.now, revision: 2 });
    expect(typeof gone.body.purgeAt).toBe('number');
    expect(await j(await put(me, 'p1', { vaultRevision: 2 }))).toEqual({ status: 409, body: { error: 'vault-changed', vaultRevision: 1 } });
    expect((await put(me, 'p1')).status).toBe(200);
    expect(await j(await put(me, 'p1', { contentId: A(24, 'K'), nonce: A(16, 'O') }))).toEqual({ status: 409, body: { error: 'conflict', revision: 1, vaultRevision: 1, deleted: false } });
    await me.as('DELETE', '/v1/keys/p1');
    expect(await j(await put(me, 'p1', { expectedRevision: 1, newRevision: 2 }))).toEqual({ status: 409, body: { error: 'conflict', revision: 2, vaultRevision: 1, deleted: true } });
    await me.as('DELETE', '/v1/keys');
    expect(await j(await put(me, 'p1', { expectedRevision: 2, newRevision: 3 }))).toEqual({ status: 409, body: { error: 'no-vault', vaultRevision: null } });
  });

  it('같은 본문을 다시 보내면 200과 같은 리비전', async () => {
    const { me } = await setup();
    const a = await j(await put(me, 'p1'));
    const b = await j(await put(me, 'p1'));
    expect(a).toEqual(b);
    expect(a.body.revision).toBe(1);
  });

  it('newRevision: expectedRevision 이하·2^31 − 1 이상은 422, 되감긴 행(3)에 3→6은 받는다', async () => {
    const { h, me } = await setup();
    expect(await j(await put(me, 'p1', { newRevision: 0 }))).toEqual({ status: 422, body: { error: 'invalid', path: 'newRevision' } });
    expect((await j(await put(me, 'p1', { newRevision: 2 ** 31 - 1 }))).status).toBe(422);
    expect((await put(me, 'p1')).status).toBe(200);
    h.env.DB.raw.prepare("UPDATE key_blobs SET revision = 3 WHERE profile_id = 'p1'").run();
    expect(await j(await put(me, 'p1', { expectedRevision: 3, newRevision: 3, contentId: A(24, 'K') }))).toEqual({ status: 422, body: { error: 'invalid', path: 'newRevision' } });
    expect((await j(await put(me, 'p1', { expectedRevision: 3, newRevision: 6, contentId: A(24, 'K') }))).body.revision).toBe(6);
  });

  it('2^31 − 2인 행을 끄면 2^31 − 1이 되고 CHECK 안이다', async () => {
    const { h, me } = await setup();
    expect((await put(me, 'p1', { newRevision: 2 ** 31 - 2 })).status).toBe(200);
    expect(await j(await me.as('DELETE', '/v1/keys/p1'))).toEqual({ status: 200, body: { deleted: true, revision: 2 ** 31 - 1 } });
    expect(blobRow(h, 'p1')).toMatchObject({ revision: 2 ** 31 - 1, ciphertext: null });
  });

  it('살아 있는 블롭 51번째는 422 key-limit, 삭제 표시 행은 세지 않는다', async () => {
    const { h, me } = await setup();
    const uid = (rows(h, 'SELECT id FROM users')[0] as { id: string }).id;
    const insIndex = h.env.DB.raw.prepare("INSERT INTO profile_index (user_id, profile_id, revision, last_op_id, updated_at) VALUES (?, ?, 1, ?, 0)");
    const insBlob = h.env.DB.raw.prepare('INSERT INTO key_blobs (user_id, profile_id, revision, vault_revision, content_id, nonce, ciphertext, updated_at) VALUES (?, ?, 1, 1, ?, ?, ?, 0)');
    for (let i = 0; i < 50; i++) {
      insIndex.run(uid, `q${i}`, `op-q${i}`);
      insBlob.run(uid, `q${i}`, A(24, 'I'), A(16, 'N'), A(64, 'X'));
    }
    expect(await j(await put(me, 'p1'))).toEqual({ status: 422, body: { error: 'key-limit' } });
    expect((await me.as('DELETE', '/v1/keys/q0')).status).toBe(200);
    expect((await put(me, 'p1')).status).toBe(200);
  });

  it('암호문 2049자는 422, 8 KiB를 넘는 본문은 413', async () => {
    const { me } = await setup();
    expect((await put(me, 'p1', { ciphertext: A(2049, 'X') })).status).toBe(422);
    expect((await put(me, 'p1', { ciphertext: A(9000, 'X') })).status).toBe(413);
  });
});

describe('끄기·목록·조회', () => {
  it('끄기: 암호문 NULL·리비전 + 1, 다시 켜면 이어지고, 다시 보내면 deleted false', async () => {
    const { h, me } = await setup();
    await put(me, 'p1');
    expect(await j(await me.as('DELETE', '/v1/keys/p1'))).toEqual({ status: 200, body: { deleted: true, revision: 2 } });
    expect(blobRow(h, 'p1')).toMatchObject({ revision: 2, content_id: null, nonce: null, ciphertext: null });
    expect(await j(await me.as('DELETE', '/v1/keys/p1'))).toEqual({ status: 200, body: { deleted: false, revision: 2 } });
    expect((await j(await put(me, 'p1', { expectedRevision: 2, newRevision: 3 }))).body.revision).toBe(3);
  });

  it('목록: 삭제된 프로필의 행은 없고, 끈 행은 deleted true·contentId null, 암호문·nonce가 없다', async () => {
    const { h, me } = await setup(['p1', 'p2', 'p3']);
    await put(me, 'p1');
    await put(me, 'p2', { contentId: A(24, 'J') });
    await put(me, 'p3', { contentId: A(24, 'K') });
    await me.as('DELETE', '/v1/keys/p2');
    await me.as('DELETE', '/v1/profiles/p3', { opId: 'd3', expectedRevision: 1 });
    const res = await me.as('GET', '/v1/keys');
    const text = await res.clone().text();
    expect(text).not.toContain(A(64, 'X'));
    expect(text).not.toContain('"ciphertext":"X');
    const { body } = await j(res);
    expect(body.keyVault).toMatchObject({ vaultId: VID, vaultRevision: 1 });
    expect(body.keyBlobs).toEqual([
      { profileId: 'p1', revision: 1, vaultRevision: 1, contentId: A(24, 'I'), deleted: false, updatedAt: h.clock.now },
      { profileId: 'p2', revision: 2, vaultRevision: 1, contentId: null, deleted: true, updatedAt: h.clock.now },
    ]);
    expect(await j(await me.as('GET', '/v1/keys/p1'))).toEqual({
      status: 200,
      body: { revision: 1, contentId: A(24, 'I'), vaultRevision: 1, nonce: A(16, 'N'), ciphertext: A(64, 'X'), updatedAt: h.clock.now },
    });
    expect((await me.as('GET', '/v1/keys/p2')).status).toBe(404);
    expect((await me.as('GET', '/v1/keys/p3')).status).toBe(404);
  });

  it('금고가 없으면 keyVault null, keyBlobs []', async () => {
    const h = harness();
    const me = await h.login();
    expect(await j(await me.as('GET', '/v1/keys'))).toEqual({ status: 200, body: { keyVault: null, keyBlobs: [] } });
  });
});

describe('rekey', () => {
  async function two() {
    const s = await setup(['p1', 'p2', 'p3']);
    await put(s.me, 'p1');
    await put(s.me, 'p2', { contentId: A(24, 'J') });
    return s;
  }
  const both = [{ profileId: 'p1', revision: 1 }, { profileId: 'p2', revision: 1, contentId: A(24, 'J') }];

  it('성공: 살아 있는 블롭의 vault_revision만 새 값, revision·content_id·vault_id 그대로, key_guard는 비고, 다시 보내도 200', async () => {
    const { h, me } = await two();
    const r = await j(await me.as('POST', '/v1/keys/rekey', rekeyBody(both)));
    expect(r).toEqual({ status: 200, body: { vaultRevision: 2, updatedAt: h.clock.now } });
    expect(rows(h, 'SELECT profile_id, revision, vault_revision, content_id, ciphertext FROM key_blobs ORDER BY profile_id')).toEqual([
      { profile_id: 'p1', revision: 1, vault_revision: 2, content_id: A(24, 'I'), ciphertext: A(64, 'R') },
      { profile_id: 'p2', revision: 1, vault_revision: 2, content_id: A(24, 'J'), ciphertext: A(64, 'R') },
    ]);
    expect(rows(h, 'SELECT vault_id, vault_revision, salt FROM key_vault')).toEqual([{ vault_id: VID, vault_revision: 2, salt: SALT2 }]);
    expect(rows(h, 'SELECT count(*) AS n FROM key_guard')).toEqual([{ n: 0 }]);
    expect((await j(await me.as('POST', '/v1/keys/rekey', rekeyBody(both)))).status).toBe(200);
  });

  it.each([
    ['그사이 블롭이 고쳐짐', async (me: { as: Caller }) => void (await put(me, 'p1', { expectedRevision: 1, newRevision: 2, contentId: A(24, 'L') }))],
    ['요청에 하나가 빠짐', async () => {}],
    ['그사이 새 블롭이 켜짐', async (me: { as: Caller }) => void (await put(me, 'p3', { contentId: A(24, 'M') }))],
    ['리비전은 같고 content_id가 다름', async () => {}],
  ])('경합 — %s: 409 conflict이고 금고·블롭이 하나도 바뀌지 않는다', async (name, race) => {
    const { h, me } = await two();
    await race(me);
    const before = state(h);
    const req =
      name === '요청에 하나가 빠짐'
        ? rekeyBody([both[0]])
        : name === '리비전은 같고 content_id가 다름'
          ? rekeyBody([both[0], { ...both[1], contentId: A(24, 'Z') }])
          : rekeyBody(both);
    const r = await j(await me.as('POST', '/v1/keys/rekey', req));
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('conflict');
    expect(r.body.keyVault).toMatchObject({ vaultId: VID, vaultRevision: 1 });
    expect(Array.isArray(r.body.keyBlobs)).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain(A(64, 'X'));
    expect(state(h)).toBe(before);
    expect(rows(h, 'SELECT count(*) AS n FROM key_guard')).toEqual([{ n: 0 }]);
  });

  it('삭제된 프로필에 암호문이 남은 고아 행이 있어도 성공하고, 고아는 삭제 표시가 된다', async () => {
    const { h, me } = await two();
    await me.as('DELETE', '/v1/profiles/p2', { opId: 'd2', expectedRevision: 1 });
    // 되돌린 Worker 기간의 고아: tombstone이 키 행을 바꾸지 못했다고 친다
    h.env.DB.raw.prepare("UPDATE key_blobs SET revision = 1, content_id = ?, nonce = ?, ciphertext = ? WHERE profile_id = 'p2'").run(A(24, 'J'), A(16, 'N'), A(64, 'X'));
    expect((await me.as('POST', '/v1/keys/rekey', rekeyBody([both[0]]))).status).toBe(200);
    expect(blobRow(h, 'p2')).toMatchObject({ revision: 2, ciphertext: null, content_id: null, nonce: null });
  });

  it('블롭 50개 rekey가 통과한다(128 KiB 안)', async () => {
    const { h, me } = await setup();
    const uid = (rows(h, 'SELECT id FROM users')[0] as { id: string }).id;
    const insIndex = h.env.DB.raw.prepare("INSERT INTO profile_index (user_id, profile_id, revision, last_op_id, updated_at) VALUES (?, ?, 1, ?, 0)");
    const insBlob = h.env.DB.raw.prepare('INSERT INTO key_blobs (user_id, profile_id, revision, vault_revision, content_id, nonce, ciphertext, updated_at) VALUES (?, ?, 1, 1, ?, ?, ?, 0)');
    const list = Array.from({ length: 50 }, (_, i) => ({ profileId: `q${i}`, revision: 1 }));
    for (const b of list) {
      insIndex.run(uid, b.profileId, `op-${b.profileId}`);
      insBlob.run(uid, b.profileId, A(24, 'I'), A(16, 'N'), A(64, 'X'));
    }
    const big = rekeyBody(list);
    for (const k of big.keyBlobs) k.ciphertext = A(2048, 'R');
    expect((await me.as('POST', '/v1/keys/rekey', big)).status).toBe(200);
    expect(rows(h, 'SELECT count(*) AS n FROM key_blobs WHERE vault_revision = 2')).toEqual([{ n: 50 }]);
  });

  it('금고가 없으면 409 no-vault, 본문 검사 실패는 422', async () => {
    const h = harness();
    const me = await h.login();
    expect((await j(await me.as('POST', '/v1/keys/rekey', rekeyBody([])))).body).toEqual({ error: 'no-vault' });
    expect((await j(await me.as('POST', '/v1/keys/rekey', { ...rekeyBody([]), extra: 1 }))).status).toBe(422);
  });
});

describe('전체 삭제·사용자 경계·로그', () => {
  it('전체 삭제: 금고·블롭이 모두 지워지고 다시 보내도 200, 다른 사용자 것은 남는다', async () => {
    const { h, me } = await setup();
    await put(me, 'p1');
    const other = await h.login(OTHER, 'uid-other');
    await other.as('PUT', '/v1/profiles/o1', { opId: 'op-o1', expectedRevision: 0, doc: doc() });
    await other.as('PUT', '/v1/keys/vault', vaultBody());
    await other.as('PUT', '/v1/keys/o1', blobBody());
    expect(await j(await me.as('DELETE', '/v1/keys'))).toEqual({ status: 200, body: { deleted: { vault: true, blobs: 1 } } });
    expect(await j(await me.as('DELETE', '/v1/keys'))).toEqual({ status: 200, body: { deleted: { vault: false, blobs: 0 } } });
    expect(rows(h, 'SELECT count(*) AS n FROM key_vault')).toEqual([{ n: 1 }]);
    expect(rows(h, 'SELECT profile_id FROM key_blobs')).toEqual([{ profile_id: 'o1' }]);
  });

  it('다른 계정 세션으로 GET·PUT·DELETE해도 내 블롭이 보이거나 바뀌지 않는다', async () => {
    const { h, me } = await setup();
    await put(me, 'p1');
    const before = state(h);
    const other = await h.login(OTHER, 'uid-other');
    expect(await j(await other.as('GET', '/v1/keys'))).toEqual({ status: 200, body: { keyVault: null, keyBlobs: [] } });
    expect((await other.as('GET', '/v1/keys/p1')).status).toBe(404);
    expect((await other.as('PUT', '/v1/keys/p1', blobBody({ expectedRevision: 1, newRevision: 2 }))).status).toBe(404);
    expect(await j(await other.as('DELETE', '/v1/keys/p1'))).toEqual({ status: 200, body: { deleted: false, revision: 0 } });
    expect(state(h)).toBe(before);
  });

  it('로그 어느 줄에도 ciphertext·salt·nonce·vaultId·contentId 문자열이 없다', async () => {
    const { h, me } = await setup();
    await put(me, 'p1');
    await me.as('GET', '/v1/keys');
    await me.as('GET', '/v1/keys/p1');
    await me.as('POST', '/v1/keys/rekey', rekeyBody([{ profileId: 'p1', revision: 1 }]));
    await me.as('DELETE', '/v1/keys/p1');
    await me.as('DELETE', '/v1/keys');
    const log = h.logs.join('\n');
    for (const secret of [A(64, 'X'), A(64, 'R'), SALT, SALT2, A(16, 'N'), A(16, 'M'), VID, A(24, 'I')]) expect(log).not.toContain(secret);
    expect(h.logs.some((l) => l.startsWith('POST /v1/keys/rekey 200'))).toBe(true);
  });

  it('공유 API는 key_ 표를 읽지 않는다(shares.ts 원문에 key_vault·key_blobs가 없다)', () => {
    const src = readFileSync(new URL('./shares.ts', import.meta.url), 'utf8');
    expect(src).not.toContain('key_vault');
    expect(src).not.toContain('key_blobs');
  });
});
