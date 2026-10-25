import { describe, expect, it } from 'vitest';
import { groupSnapshot, strategySnapshot } from '../../src/lib/share/snapshot';
import { FORBIDDEN_KEYS } from '../../src/lib/sync/forbidden';
import { DAY } from './env';
import { MAX_ACTIVE_SHARES } from './shares';
import { harness, OTHER, type Harness } from '../test/harness';
import { doc } from '../test/docs';

const j = async (r: Response) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> });
const group = () => groupSnapshot({ id: 'g0', name: '반도체', items: [{ symbol: '005930', colorSlot: 1, hidden: false, addedAt: 1 }] });

async function setup(h: Harness = harness()) {
  const me = await h.login();
  await me.as('PUT', '/v1/profiles/p1', { opId: 'op-1', expectedRevision: 0, doc: doc() });
  const read = (cap: string) => h.call('GET', '/v1/public/share', { headers: { 'X-Share-Token': cap } });
  const create = async (extra: Record<string, unknown> = {}) =>
    j(await me.as('POST', '/v1/shares', { sourceProfileId: 'p1', kind: 'group', snapshot: group(), ...extra }));
  return { h, me, read, create };
}

describe('공유 API', () => {
  it('만들면 capability를 한 번만 돌려주고 DB에는 해시만 둔다', async () => {
    const { h, create, read, me } = await setup();
    const r = await create();
    expect(r.status).toBe(200);
    const cap = r.body.capability as string;
    expect(cap).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r.body.expiresAt).toBe(h.clock.now + 7 * DAY);
    expect(JSON.stringify(h.env.DB.raw.prepare('SELECT * FROM shares').all())).not.toContain(cap);
    const list = await j(await me.as('GET', '/v1/shares'));
    expect(JSON.stringify(list.body)).not.toContain(cap);
    expect(list.body.shares).toMatchObject([{ id: r.body.id, kind: 'group', title: '반도체', sourceProfileId: 'p1', revokedAt: null }]);
    const got = await read(cap);
    expect(got.status).toBe(200);
    expect(got.headers.get('Cache-Control')).toBe('no-store');
    expect(await got.json()).toEqual({ kind: 'group', title: '반도체', snapshot: group(), createdAt: h.clock.now, expiresAt: h.clock.now + 7 * DAY });
    expect(h.logs.join('\n')).not.toContain(cap);
  });

  it('읽기는 로그인 없이 되지만 정확한 앱 출처여야 한다', async () => {
    const { h, create } = await setup();
    const cap = (await create()).body.capability as string;
    expect((await h.call('GET', '/v1/public/share', { origin: 'https://evil.example.test', headers: { 'X-Share-Token': cap } })).status).toBe(403);
  });

  it('만료는 기본 7일, 1~30일 정수만 받는다', async () => {
    const { h, create } = await setup();
    expect((await create({ ttlDays: 30 })).body.expiresAt).toBe(h.clock.now + 30 * DAY);
    expect((await create({ ttlDays: 1 })).status).toBe(200);
    for (const ttlDays of [0, 31, 1.5, '7', null]) expect((await create({ ttlDays })).status).toBe(422);
  });

  it('만료·철회·원본 삭제 뒤에는 410이다', async () => {
    const { h, create, read, me } = await setup();
    const a = (await create({ ttlDays: 1 })).body;
    const b = (await create()).body;
    const c = (await create()).body;
    expect((await read(a.capability as string)).status).toBe(200);
    h.clock.now += DAY;
    expect(await j(await read(a.capability as string))).toEqual({ status: 410, body: { error: 'share-gone' } });
    expect((await me.as('DELETE', `/v1/shares/${b.id}`)).status).toBe(200);
    expect((await me.as('DELETE', `/v1/shares/${b.id}`)).status).toBe(200);
    expect((await read(b.capability as string)).status).toBe(410);
    expect((await read(c.capability as string)).status).toBe(200);
    await me.as('DELETE', '/v1/profiles/p1', { opId: 'op-del', expectedRevision: 1 });
    expect((await read(c.capability as string)).status).toBe(410);
    // 복구하면 만료 전 공유는 다시 열린다
    await me.as('POST', '/v1/profiles/p1/restore', { opId: 'op-res' });
    expect((await read(c.capability as string)).status).toBe(200);
  });

  it('틀리거나 없는 capability는 404', async () => {
    const { read, h } = await setup();
    expect((await read('A'.repeat(43))).status).toBe(404);
    expect((await read('short')).status).toBe(404);
    expect((await h.call('GET', '/v1/public/share')).status).toBe(404);
  });

  it('다른 사용자의 공유는 철회할 수 없고, 삭제된·남의 프로필로는 만들 수 없다', async () => {
    const { h, create, read } = await setup();
    const s = (await create()).body;
    const other = await h.login(OTHER, 'uid-other');
    expect((await other.as('DELETE', `/v1/shares/${s.id}`)).status).toBe(404);
    expect((await read(s.capability as string)).status).toBe(200);
    expect((await j(await other.as('GET', '/v1/shares'))).body.shares).toEqual([]);
    expect((await other.as('POST', '/v1/shares', { sourceProfileId: 'p1', kind: 'group', snapshot: group() })).status).toBe(404);
  });

  it(`활성 공유는 ${MAX_ACTIVE_SHARES}개까지`, async () => {
    const { create, me } = await setup();
    let last = '';
    for (let i = 0; i < MAX_ACTIVE_SHARES; i++) last = (await create()).body.id as string;
    expect(await j(await me.as('POST', '/v1/shares', { sourceProfileId: 'p1', kind: 'group', snapshot: group() }))).toEqual({
      status: 429,
      body: { error: 'share-limit' },
    });
    await me.as('DELETE', `/v1/shares/${last}`);
    expect((await create()).status).toBe(200);
  });

  it('로그인 없이는 만들 수 없다', async () => {
    const { h } = await setup();
    expect((await h.call('POST', '/v1/shares', { body: { sourceProfileId: 'p1', kind: 'group', snapshot: group() } })).status).toBe(401);
  });

  it.each(FORBIDDEN_KEYS)('스냅샷에 금지 키 %s가 있으면 422', async (key) => {
    const { create, h } = await setup();
    const r = await create({ snapshot: { ...group(), [key]: 'FAKE' } });
    expect(r).toEqual({ status: 422, body: { error: 'forbidden-field', path: key } });
    expect(h.env.DB.raw.prepare('SELECT count(*) AS n FROM shares').get()).toEqual({ n: 0 });
  });

  it('원본 ID·알 수 없는 필드·kind 불일치는 거절한다', async () => {
    const { create } = await setup();
    expect((await create({ snapshot: { ...group(), symbols: ['005930'], groupId: '7f1f6a2e-1c1d-4e0b-9a55-0f0f0f0f0f0f' } })).body.error).toBe('reference');
    expect((await create({ snapshot: { ...group(), note: 'x' } })).body).toEqual({ error: 'unknown-field', path: 'note' });
    expect((await create({ kind: 'strategy' })).body).toEqual({ error: 'invalid', path: 'kind' });
    expect((await create({ extra: 1 })).body).toEqual({ error: 'unknown-field', path: 'extra' });
  });

  it('전략 스냅샷도 서버 검증을 통과한다', async () => {
    const { create, read } = await setup();
    const d = doc();
    const snap = strategySnapshot(d.strategies[0], d.watchlists, { hideCapital: true });
    const r = await create({ kind: 'strategy', snapshot: snap });
    expect(r.status).toBe(200);
    expect((await (await read(r.body.capability as string)).json()).snapshot).toEqual(snap);
  });
});
