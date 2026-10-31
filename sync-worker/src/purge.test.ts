import { describe, expect, it } from 'vitest';
import { groupSnapshot } from '../../src/lib/share/snapshot';
import { DAY } from './env';
import { purge } from './purge';
import { harness } from '../test/harness';
import { doc } from '../test/docs';

const n = (h: ReturnType<typeof harness>, t: string) => (h.env.DB.raw.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n;
const snap = groupSnapshot({ id: 'g', name: '그룹', items: [{ symbol: '005930', colorSlot: 1, hidden: false, addedAt: 1 }] });

describe('purge', () => {
  it('삭제 30일이 지난 프로필의 본문·이력·공유·색인을 지우고, 복구된 것과 다른 프로필은 남긴다', async () => {
    const h = harness();
    const me = await h.login();
    for (const p of ['p1', 'p2', 'p3']) {
      await me.as('PUT', `/v1/profiles/${p}`, { opId: `op-${p}`, expectedRevision: 0, doc: doc() });
      await me.as('POST', '/v1/shares', { sourceProfileId: p, kind: 'group', snapshot: snap });
    }
    await me.as('DELETE', '/v1/profiles/p1', { opId: 'd1', expectedRevision: 1 });
    await me.as('DELETE', '/v1/profiles/p2', { opId: 'd2', expectedRevision: 1 });
    h.clock.now += 10 * DAY;
    await me.as('POST', '/v1/profiles/p2/restore', { opId: 'r2' });

    expect(await purge(h.env, h.clock.now + 19 * DAY)).toMatchObject({ profiles: 0 });
    expect(await purge(h.env, h.clock.now + 21 * DAY)).toMatchObject({ profiles: 1 });
    const left = h.env.DB.raw.prepare('SELECT profile_id AS p FROM profile_index ORDER BY p').all();
    expect(left).toEqual([{ p: 'p2' }, { p: 'p3' }]);
    for (const t of ['profiles', 'revisions', 'shares'])
      expect(h.env.DB.raw.prepare(`SELECT count(*) AS n FROM ${t} WHERE ${t === 'shares' ? 'source_profile_id' : 'profile_id'} = 'p1'`).get()).toEqual({ n: 0 });
    expect(n(h, 'shares')).toBe(2);
  });

  it('만료·철회 후 30일 지난 공유, 오래된·철회된 세션을 지운다', async () => {
    const h = harness();
    const me = await h.login();
    await me.as('PUT', '/v1/profiles/p1', { opId: 'op', expectedRevision: 0, doc: doc() });
    await me.as('POST', '/v1/shares', { sourceProfileId: 'p1', kind: 'group', snapshot: snap, ttlDays: 1 });
    const keep = await me.as('POST', '/v1/shares', { sourceProfileId: 'p1', kind: 'group', snapshot: snap, ttlDays: 30 });
    void keep;
    await h.login(); // 두 번째 세션
    expect(await purge(h.env, h.clock.now + 30 * DAY)).toEqual({ profiles: 0, shares: 0, sessions: 0 });
    expect(await purge(h.env, h.clock.now + 31 * DAY + 1)).toMatchObject({ shares: 1 });
    expect(n(h, 'shares')).toBe(1);
    expect(n(h, 'sessions')).toBe(2);
    expect(await purge(h.env, h.clock.now + 61 * DAY)).toMatchObject({ shares: 1, sessions: 2 });
  });

  it('한 번에 지우는 프로필 수를 제한한다', async () => {
    const h = harness();
    const me = await h.login();
    for (let i = 0; i < 55; i++) {
      await me.as('PUT', `/v1/profiles/p${i}`, { opId: `o${i}`, expectedRevision: 0, doc: doc() });
      await me.as('DELETE', `/v1/profiles/p${i}`, { opId: `d${i}`, expectedRevision: 1 });
    }
    expect((await purge(h.env, h.clock.now + 31 * DAY)).profiles).toBe(50);
    expect((await purge(h.env, h.clock.now + 31 * DAY)).profiles).toBe(5);
    expect(n(h, 'profile_index')).toBe(0);
  });

  it('정리 batch는 키 행을 지우지 않고 남은 암호문만 삭제 표시로 바꾼다(profile_index 삭제 앞이어야 통과)', async () => {
    const A = (n: number, c: string) => c.repeat(n);
    const h = harness();
    const me = await h.login();
    await me.as('PUT', '/v1/profiles/p1', { opId: 'op-1', expectedRevision: 0, doc: doc() });
    await me.as('PUT', '/v1/keys/vault', { vaultId: A(24, 'V'), kdf: 'PBKDF2-SHA256', iter: 600000, salt: A(24, 'S'), verifier: { nonce: A(16, 'N'), ciphertext: A(56, 'C') } });
    const blob = (o: Record<string, unknown> = {}) => ({ expectedRevision: 0, newRevision: 1, contentId: A(24, 'I'), vaultId: A(24, 'V'), vaultRevision: 1, nonce: A(16, 'N'), ciphertext: A(64, 'X'), ...o });
    await me.as('PUT', '/v1/keys/p1', blob());
    await me.as('DELETE', '/v1/profiles/p1', { opId: 'd1', expectedRevision: 1 });
    // 고아: 되돌린 Worker 기간에 암호문이 남았다고 친다
    h.env.DB.raw.prepare("UPDATE key_blobs SET revision = 2, content_id = ?, nonce = ?, ciphertext = ? WHERE profile_id = 'p1'").run(A(24, 'I'), A(16, 'N'), A(64, 'X'));
    expect((await purge(h.env, h.clock.now + 31 * DAY)).profiles).toBe(1);
    expect(h.env.DB.raw.prepare("SELECT revision, ciphertext FROM key_blobs WHERE profile_id = 'p1'").get()).toEqual({ revision: 3, ciphertext: null });
    // 정리된 프로필을 같은 ID로 다시 올려 키를 켜면 리비전이 이어진다(1로 돌아가지 않는다)
    expect((await me.as('PUT', '/v1/profiles/p1', { opId: 'op-again', expectedRevision: 0, doc: doc() })).status).toBe(200);
    expect(await (await me.as('GET', '/v1/keys')).json()).toMatchObject({ keyBlobs: [{ profileId: 'p1', revision: 3, deleted: true, contentId: null }] });
    expect((await me.as('PUT', '/v1/keys/p1', blob({ expectedRevision: 3, newRevision: 4, contentId: A(24, 'J') }))).status).toBe(200);
    expect(h.env.DB.raw.prepare("SELECT revision FROM key_blobs WHERE profile_id = 'p1'").get()).toEqual({ revision: 4 });
  });
});
