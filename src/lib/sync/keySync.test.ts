import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ApiFail, SyncApi } from './api';
import { deriveVaultKey, makeVerifier, openKeys, randomId, sealKeys } from './keyCrypto';
import { createMemoryKeyStore } from './keyStore';
import { createKeySync, KEY_TEXT, type KeySyncApp, type VaultKey } from './keySync';
import { checkBlob, KEY_ITER, type KeyPlainV1, type KeyVaultHead } from './keyWire';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const VID = randomId();
const SALT = randomId();
const KIS_A = { appKey: 'FAKE-kis-key-A', appSecret: 'FAKE-kis-secret-A' };
const KIS_B = { appKey: 'FAKE-kis-key-B', appSecret: 'FAKE-kis-secret-B' };
const KIS_C = { appKey: 'FAKE-kis-key-C', appSecret: 'FAKE-kis-secret-C' };
const TOSS_A = { clientId: 'FAKE-toss-client-A', clientSecret: 'FAKE-toss-secret-A' };
let vault: VaultKey;
let nextKey: CryptoKey;
let head: KeyVaultHead;

beforeAll(async () => {
  const key = await deriveVaultKey('FAKE-sync-pass-0001', SALT, KEY_ITER);
  vault = { key, vaultId: VID, salt: SALT, vaultRevision: 1 };
  nextKey = await deriveVaultKey('FAKE-sync-pass-0002', SALT, KEY_ITER);
  head = { vaultId: VID, kdf: 'PBKDF2-SHA256', iter: KEY_ITER, salt: SALT, verifier: await makeVerifier(key, VID, 1), vaultRevision: 1, updatedAt: 1 };
});

type Row = { revision: number; vaultRevision: number; contentId: string | null; nonce: string | null; ciphertext: string | null };
const OFF: ApiFail = { ok: false, kind: 'offline' };

/** 키 API만 흉내 내는 서버. 리비전 조건·삭제 표시는 Worker와 같게 한다 */
function fakeServer() {
  const srv = {
    head: null as KeyVaultHead | null,
    rows: new Map<string, Row>(),
    online: true,
    loseNextPut: false,
    holdPut: null as Promise<void> | null,
    bad: null as unknown,
    calls: [] as string[],
  };
  const listData = () => ({
    keyVault: srv.head,
    keyBlobs: [...srv.rows]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([profileId, r]) => ({ profileId, revision: r.revision, vaultRevision: r.vaultRevision, contentId: r.contentId, deleted: r.ciphertext === null, updatedAt: 1 })),
  });
  const api = {
    listKeys: vi.fn<SyncApi['listKeys']>(async () => {
      srv.calls.push('list');
      if (!srv.online) return OFF;
      return { ok: true, data: (srv.bad ?? listData()) as { keyVault: unknown; keyBlobs: unknown } };
    }),
    getKeyBlob: vi.fn<SyncApi['getKeyBlob']>(async (id) => {
      srv.calls.push(`get ${id}`);
      if (!srv.online) return OFF;
      const r = srv.rows.get(id);
      if (!r || r.ciphertext === null) return { ok: false, kind: 'not-found' };
      return { ok: true, data: { revision: r.revision, contentId: r.contentId, vaultRevision: r.vaultRevision, nonce: r.nonce, ciphertext: r.ciphertext, updatedAt: 1 } };
    }),
    putKeyBlob: vi.fn<SyncApi['putKeyBlob']>(async (id, body) => {
      srv.calls.push(`put ${id}`);
      if (srv.holdPut) await srv.holdPut;
      if (!srv.online) return OFF;
      if (!srv.head) return { ok: false, kind: 'conflict', revision: 0, doc: null, code: 'no-vault', vaultRevision: null };
      if (body.vaultId !== srv.head.vaultId || body.vaultRevision !== srv.head.vaultRevision)
        return { ok: false, kind: 'conflict', revision: 0, doc: null, code: 'vault-changed', vaultRevision: srv.head.vaultRevision };
      const cur = srv.rows.get(id);
      if ((cur?.revision ?? 0) !== body.expectedRevision)
        return { ok: false, kind: 'conflict', revision: cur?.revision ?? 0, doc: null, code: 'conflict', vaultRevision: srv.head.vaultRevision, deleted: cur ? cur.ciphertext === null : false };
      srv.rows.set(id, { revision: body.newRevision, vaultRevision: body.vaultRevision, contentId: body.contentId, nonce: body.nonce, ciphertext: body.ciphertext });
      if (srv.loseNextPut) {
        srv.loseNextPut = false;
        return OFF;
      }
      return { ok: true, data: { revision: body.newRevision, updatedAt: 1 } };
    }),
    deleteKeyBlob: vi.fn<SyncApi['deleteKeyBlob']>(async (id) => {
      srv.calls.push(`delete ${id}`);
      if (!srv.online) return OFF;
      const r = srv.rows.get(id);
      if (r && r.ciphertext !== null) {
        srv.rows.set(id, { ...r, revision: r.revision + 1, contentId: null, nonce: null, ciphertext: null });
        return { ok: true, data: { deleted: true, revision: r.revision + 1 } };
      }
      return { ok: true, data: { deleted: false, revision: r?.revision ?? 0 } };
    }),
    createKeyVault: vi.fn<SyncApi['createKeyVault']>(async () => ({ ok: true, data: { vaultRevision: 1, updatedAt: 1 } })),
    rekey: vi.fn<SyncApi['rekey']>(),
    wipeKeys: vi.fn<SyncApi['wipeKeys']>(async () => ({ ok: true, data: { deleted: { vault: true, blobs: srv.rows.size } } })),
  };
  return { srv, raw: api, api: api as unknown as SyncApi };
}

/** 서버 행을 이 금고 키로 봉해 둔다 */
async function serverBlob(srv: ReturnType<typeof fakeServer>['srv'], id: string, revision: number, plain: KeyPlainV1, o: { contentId?: string; key?: CryptoKey; vaultRevision?: number } = {}) {
  const contentId = o.contentId ?? randomId();
  const vaultRevision = o.vaultRevision ?? 1;
  const s = await sealKeys(o.key ?? vault.key, { vaultId: VID, profileId: id, revision, contentId, vaultRevision }, plain);
  srv.rows.set(id, { revision, vaultRevision, contentId, ...s });
  return contentId;
}
async function openServer(srv: ReturnType<typeof fakeServer>['srv'], id: string) {
  const r = srv.rows.get(id)!;
  return openKeys(vault.key, { vaultId: VID, profileId: id, revision: r.revision, contentId: r.contentId!, vaultRevision: r.vaultRevision }, { nonce: r.nonce!, ciphertext: r.ciphertext! });
}

function setup(o: { active?: string; keyLock?: boolean; provider?: string } = {}) {
  const { srv, raw, api } = fakeServer();
  srv.head = head;
  const secrets = new Map<string, { kis?: typeof KIS_A; toss?: typeof TOSS_A }>();
  const app = {
    meta: { activeProfileId: o.active ?? 'p1', profiles: [{ id: 'p1' }, { id: 'p2' }] },
    settings: { provider: o.provider ?? 'kis', keyLock: o.keyLock ?? false },
    locked: false,
    syncableSecrets: (id: string) => (id === app.meta.activeProfileId && !app.locked ? structuredClone(secrets.get(id) ?? {}) : null),
    applySyncedSecrets: vi.fn(async (id: string, keys: { kis?: typeof KIS_A; toss?: typeof TOSS_A }) => {
      const cur = secrets.get(id) ?? {};
      const changed = (['kis', 'toss'] as const).filter((p) => keys[p] && JSON.stringify(keys[p]) !== JSON.stringify(cur[p]));
      secrets.set(id, { ...cur, ...keys });
      return [...changed];
    }),
  };
  const store = createMemoryKeyStore();
  let key: VaultKey | null = null;
  const sessionOk = vi.fn(async () => true);
  const onAuthFailure = vi.fn();
  const uploaded = new Set(['p1', 'p2']);
  const ks = createKeySync({
    store,
    api,
    app: app as KeySyncApp,
    profileState: async (id) => ({ uploaded: uploaded.has(id) }),
    vaultKey: () => key,
    setVaultKey: (k) => (key = k),
    sessionOk,
    onAuthFailure,
  });
  return { srv, raw, app, secrets, store, ks, sessionOk, onAuthFailure, uploaded, remember: () => (key = vault), forgetKey: () => (key = null), key: () => key };
}
type T = ReturnType<typeof setup>;
/** 켜고 맞춘 행: p1에 KIS_A를 리비전 1로 올린 상태 */
async function enabled(t: T) {
  t.secrets.set('p1', { kis: KIS_A });
  t.remember();
  await t.ks.step();
  expect(await t.ks.enable('p1', ['kis'])).toEqual({ ok: true, notes: [] });
  return (await t.store.state('p1'))!;
}
async function receive(t: T, id = 'p1', lockPass?: string) {
  const p = await t.ks.prepareReceive(id);
  if (!p.ok) return p;
  return t.ks.commitReceive(p.prepared, lockPass);
}

describe('계정 단위 판정(5.4)', () => {
  it('옛 Worker(404)면 keySupport false, 200이면 true', async () => {
    const t = setup();
    t.raw.listKeys.mockResolvedValueOnce({ ok: false, kind: 'not-found' });
    expect(await t.ks.step()).toBe('idle');
    expect(await t.store.getMeta('keySupport')).toBe(false);
    await t.ks.step();
    expect(await t.store.getMeta('keySupport')).toBe(true);
  });

  it('금고 머리 모양이 틀리면(iter 1000) 멈추고 아무것도 쓰지 않는다', async () => {
    const t = setup();
    t.srv.bad = { keyVault: { ...head, iter: 1000 }, keyBlobs: [] };
    expect(await t.ks.step()).toBe('idle');
    expect(t.ks.problem()).toBe(KEY_TEXT.badResponse);
    expect(await t.store.getMeta('keyVault')).toBeUndefined();
    expect(await t.store.getMeta('keySupport')).toBeUndefined();
  });

  it('서버 금고가 사라지면 마스터 키를 잊고 상태를 비운 뒤 vault-gone', async () => {
    const t = setup();
    await enabled(t);
    t.srv.head = null;
    t.srv.rows.clear();
    await t.ks.step();
    expect(t.key()).toBeNull();
    expect(await t.store.states()).toEqual([]);
    expect(await t.store.getMeta('keyNotice')).toBe('vault-gone');
    expect(await t.store.getMeta('keyVault')).toBeNull();
  });

  it('vaultId가 바뀌면 상태가 비고 vault-gone, 마스터 키를 잊는다', async () => {
    const t = setup();
    await enabled(t);
    t.srv.head = { ...head, vaultId: randomId() };
    t.srv.rows.clear();
    await t.ks.step();
    expect(t.key()).toBeNull();
    expect(await t.store.state('p1')).toBeUndefined();
    expect(await t.store.getMeta('keyNotice')).toBe('vault-gone');
  });

  it('같은 금고에서 salt·금고 리비전이 바뀌면 vault-changed, 상태 행은 그대로이고 newer가 뜨지 않는다', async () => {
    const t = setup();
    const before = await enabled(t);
    const row = t.srv.rows.get('p1')!;
    // 다른 기기의 rekey: 내용 ID·리비전은 그대로, 금고 리비전만 오른다
    await serverBlob(t.srv, 'p1', row.revision, { v: 1, kis: KIS_A }, { contentId: row.contentId!, vaultRevision: 2 });
    t.srv.head = { ...head, salt: randomId(), vaultRevision: 2 };
    await t.ks.step();
    expect(t.key()).toBeNull();
    expect(await t.store.getMeta('keyNotice')).toBe('vault-changed');
    expect(await t.store.state('p1')).toEqual(before);
  });

  it('세션·소유자 비교가 어긋나면 요청 없이 마스터 키를 잊고 멈춘다', async () => {
    const t = setup();
    t.remember();
    t.sessionOk.mockResolvedValueOnce(false);
    expect(await t.ks.step()).toBe('idle');
    expect(t.srv.calls).toEqual([]);
    expect(t.key()).toBeNull();
  });

  it('auth 실패는 onAuthFailure를 부르고 auth를 돌려준다, offline은 문구만 남기고 idle', async () => {
    const t = setup();
    t.raw.listKeys.mockResolvedValueOnce({ ok: false, kind: 'auth', code: 'session-revoked', session: 's1' });
    expect(await t.ks.step()).toBe('auth');
    expect(t.onAuthFailure).toHaveBeenCalledWith('session-revoked', 's1');
    t.srv.online = false;
    expect(await t.ks.step()).toBe('idle');
    expect(t.ks.problem()).toBe(KEY_TEXT.offline);
  });
});

describe('프로필 단위 판정(5.4)', () => {
  it('꺼짐 + 살아 있음 → available, 켜짐 revision 0 + 삭제 표시 → 조용히 꺼짐', async () => {
    const t = setup();
    await serverBlob(t.srv, 'p1', 3, { v: 1, kis: KIS_A });
    await t.ks.step();
    expect(await t.store.state('p1')).toMatchObject({ active: true, revision: 0, providers: [], notice: 'available', remoteRevision: 3, seenRevision: 3 });
    t.srv.rows.set('p1', { revision: 4, vaultRevision: 1, contentId: null, nonce: null, ciphertext: null });
    await t.ks.step();
    expect(await t.store.state('p1')).toMatchObject({ active: false, notice: null, seenRevision: 4 });
  });

  it('켜짐 + 삭제 표시: 내 끄기가 아니면 removed이고 dirty여도 올리지 않는다, offPending이면 조용히 꺼진다', async () => {
    const t = setup();
    await enabled(t);
    await t.store.bumpSeq('p1');
    const r = t.srv.rows.get('p1')!;
    t.srv.rows.set('p1', { ...r, revision: r.revision + 1, contentId: null, nonce: null, ciphertext: null });
    await t.ks.step();
    expect(await t.store.state('p1')).toMatchObject({ active: false, notice: 'removed' });
    expect(t.srv.calls.filter((c) => c.startsWith('put')).length).toBe(1);

    const u = setup();
    await enabled(u);
    await u.store.setActive('p1', { active: true, offPending: true });
    const ur = u.srv.rows.get('p1')!;
    u.srv.rows.set('p1', { ...ur, revision: ur.revision + 1, contentId: null, nonce: null, ciphertext: null });
    await u.ks.step();
    expect(await u.store.state('p1')).toMatchObject({ active: false, offPending: false, notice: null });
  });

  it('목록에 없으면 알리지 않고 켜진 행만 끈다(본 리비전은 남는다), 로컬에 없는 프로필의 켜진 행도 끈다', async () => {
    const t = setup();
    await enabled(t);
    t.srv.rows.delete('p1');
    await t.ks.step();
    expect(await t.store.state('p1')).toMatchObject({ active: false, seenRevision: 1, notice: null });
    await t.store.activate('gone', { providers: ['kis'], notice: null });
    await t.ks.step();
    expect((await t.store.state('gone'))?.active).toBe(false);
  });

  it('맞춘 상태 + dirty 아님이면 newer·conflict·rollback 알림을 지운다', async () => {
    const t = setup();
    await enabled(t);
    await t.store.setNotice('p1', 'newer', 1);
    await t.ks.step();
    expect((await t.store.state('p1'))?.notice).toBeNull();
  });

  it('맞춘 상태 + dirty면 자동으로 올린다(이 금고 키가 있고 지금 프로필일 때만)', async () => {
    const t = setup();
    await enabled(t);
    t.secrets.set('p1', { kis: KIS_B });
    await t.store.bumpSeq('p1', ['kis']);
    await t.ks.step();
    expect(await t.store.state('p1')).toMatchObject({ revision: 2, notice: null });
    expect(await openServer(t.srv, 'p1')).toEqual({ v: 1, kis: KIS_B });
    expect((await t.store.state('p1'))!.localSeq).toBe((await t.store.state('p1'))!.uploadedSeq);

    const noKey = setup();
    await enabled(noKey);
    noKey.forgetKey();
    noKey.secrets.set('p1', { kis: KIS_B });
    await noKey.store.bumpSeq('p1');
    await noKey.ks.step();
    expect(noKey.srv.calls.filter((c) => c.startsWith('put')).length).toBe(1);

    const other = setup({ active: 'p2' });
    await other.store.activate('p1', { providers: ['kis'], notice: null });
    await serverBlob(other.srv, 'p1', 1, { v: 1, kis: KIS_A });
    const cid = other.srv.rows.get('p1')!.contentId!;
    await other.store.markSynced('p1', { revision: 1, contentId: cid, uploadedSeq: 0, notice: null });
    await other.store.bumpSeq('p1');
    other.remember();
    await other.ks.step();
    expect(other.srv.calls.some((c) => c.startsWith('put'))).toBe(false);
  });

  it('맞춘 상태가 아니고 dirty 아님 → newer(리비전 0이면 available), remoteRevision은 지금 r로', async () => {
    const t = setup();
    await enabled(t);
    await serverBlob(t.srv, 'p1', 2, { v: 1, kis: KIS_B });
    await t.ks.step();
    expect(await t.store.state('p1')).toMatchObject({ notice: 'newer', remoteRevision: 2 });
    await serverBlob(t.srv, 'p1', 3, { v: 1, kis: KIS_B });
    await t.ks.step();
    expect((await t.store.state('p1'))?.remoteRevision).toBe(3);
  });

  it('syncedContentId: 리비전이 같아도 내용 ID가 다르면 newer, dirty면 conflict이고 자동으로 올리지 않는다', async () => {
    const t = setup();
    await enabled(t);
    await serverBlob(t.srv, 'p1', 1, { v: 1, kis: KIS_B });
    await t.ks.step();
    expect((await t.store.state('p1'))?.notice).toBe('newer');
    t.secrets.set('p1', { kis: KIS_C });
    await t.store.bumpSeq('p1');
    await t.ks.step();
    expect((await t.store.state('p1'))?.notice).toBe('conflict');
    expect(t.srv.calls.filter((c) => c.startsWith('put')).length).toBe(1);
  });

  it('5.6-4: 맞춘 상태가 아닌 dirty라도 서버 평문이 이 기기 키와 같으면 conflict 없이 맞춘다', async () => {
    const t = setup();
    await enabled(t);
    await serverBlob(t.srv, 'p1', 2, { v: 1, kis: KIS_B });
    t.secrets.set('p1', { kis: KIS_B });
    await t.store.bumpSeq('p1');
    await t.ks.step();
    const st = (await t.store.state('p1'))!;
    expect(st).toMatchObject({ revision: 2, notice: null });
    expect(st.localSeq).toBe(st.uploadedSeq);
  });

  it('5.6-4 미루기: 마스터 키 없음·지금 프로필 아님·잠김이면 conflict로 떨어지지 않는다', async () => {
    for (const block of ['no-key', 'other-profile', 'locked'] as const) {
      const t = setup();
      await enabled(t);
      await serverBlob(t.srv, 'p1', 2, { v: 1, kis: KIS_B });
      t.secrets.set('p1', { kis: KIS_C });
      await t.store.bumpSeq('p1');
      if (block === 'no-key') t.forgetKey();
      if (block === 'other-profile') t.app.meta.activeProfileId = 'p2';
      if (block === 'locked') t.app.locked = true;
      t.raw.getKeyBlob.mockClear();
      await t.ks.step();
      expect((await t.store.state('p1'))?.notice, block).not.toBe('conflict');
      expect(t.raw.getKeyBlob, block).not.toHaveBeenCalled();
    }
  });

  it('걸러낸 행은 그 프로필 상태(active 포함)를 바꾸지 않고 서버 응답이 맞지 않아요만 보인다', async () => {
    const t = setup();
    const before = await enabled(t);
    t.srv.bad = { keyVault: head, keyBlobs: [{ profileId: 'p1', revision: -1, vaultRevision: 1, contentId: null, deleted: true, updatedAt: 1 }] };
    await t.ks.step();
    expect(await t.store.state('p1')).toEqual(before);
    expect(t.ks.problem()).toBe(KEY_TEXT.badRow);
  });
});

describe('되감기(5.4·5.8)', () => {
  it('켜진 행에 본 것보다 옛 리비전의 살아 있는 행이 오면 rollback이고 받기·올리기를 하지 않는다', async () => {
    const t = setup();
    await enabled(t);
    await serverBlob(t.srv, 'p1', 5, { v: 1, kis: KIS_B });
    await t.ks.step(); // newer, seen 5
    const old = await serverBlob(t.srv, 'p1', 3, { v: 1, kis: KIS_A });
    t.srv.calls.length = 0;
    await t.ks.step();
    expect(await t.store.state('p1')).toMatchObject({ notice: 'rollback', remoteRevision: 3, seenRevision: 5 });
    expect(t.srv.calls.filter((c) => c.startsWith('get') || c.startsWith('put'))).toEqual([]);
    // 「서버 키 받기」 뒤 같은 r은 다시 되감기가 아니다
    t.secrets.set('p1', { kis: KIS_B });
    expect((await receive(t)).ok).toBe(true);
    expect(await t.store.state('p1')).toMatchObject({ revision: 3, syncedContentId: old, notice: null, seenRevision: 5 });
    await t.ks.step();
    expect((await t.store.state('p1'))?.notice).toBeNull();
  });

  it('「이 기기 키 올리기」와 켜기는 newRevision = max(seenRevision, r) + 1을 보낸다', async () => {
    const t = setup();
    await enabled(t);
    await serverBlob(t.srv, 'p1', 5, { v: 1, kis: KIS_B });
    await t.ks.step();
    await serverBlob(t.srv, 'p1', 3, { v: 1, kis: KIS_B });
    await t.ks.step();
    t.raw.putKeyBlob.mockClear();
    expect((await t.ks.uploadLocal('p1')).ok).toBe(true);
    expect(t.raw.putKeyBlob.mock.calls[0][1]).toMatchObject({ expectedRevision: 3, newRevision: 6 });
    expect(await t.store.state('p1')).toMatchObject({ revision: 6, notice: null });
  });

  it('삭제 표시의 옛 리비전은 되감기가 아니라 removed, 꺼진 행에 옛 살아 있는 행은 알림 없이 꺼진 채', async () => {
    const t = setup();
    await enabled(t);
    await serverBlob(t.srv, 'p1', 5, { v: 1, kis: KIS_A });
    await t.ks.step();
    t.srv.rows.set('p1', { revision: 4, vaultRevision: 1, contentId: null, nonce: null, ciphertext: null });
    await t.ks.step();
    expect(await t.store.state('p1')).toMatchObject({ active: false, notice: 'removed' });
    await t.ks.dismiss('p1');
    await serverBlob(t.srv, 'p1', 3, { v: 1, kis: KIS_A });
    await t.ks.step();
    expect(await t.store.state('p1')).toMatchObject({ active: false, notice: null });
  });
});

describe('켜기·받기·끄기·공급자(5.5~5.9)', () => {
  describe.each(['목록', 'PUT 409'] as const)('켜기 비교 불가: %s 경로', (path) => {
    it.each(['offline', 'auth', 'not-allowed', 'revision-changed'] as const)('%s이면 충돌 성공으로 끝내지 않고 행을 끈다', async (reason) => {
      const t = setup();
      t.remember();
      t.secrets.set('p1', { kis: KIS_A });
      await serverBlob(t.srv, 'p1', 1, { v: 1, kis: KIS_B });
      const before = structuredClone(t.srv.rows.get('p1'));
      if (path === 'PUT 409') t.raw.listKeys.mockResolvedValueOnce({ ok: true, data: { keyVault: head, keyBlobs: [] } });
      if (reason === 'revision-changed') {
        const get = t.raw.getKeyBlob.getMockImplementation()!;
        t.raw.getKeyBlob.mockImplementationOnce(async (id) => {
          const r = await get(id);
          return r.ok ? { ...r, data: { ...checkBlob(r.data)!, revision: 2 } } : r;
        });
      } else {
        t.raw.getKeyBlob.mockResolvedValueOnce(reason === 'auth'
          ? { ok: false, kind: reason, code: 'session-revoked', session: 'FAKE-session' }
          : { ok: false, kind: reason });
      }
      expect(await t.ks.enable('p1', ['kis'])).toEqual({
        ok: false,
        message: reason === 'offline' ? KEY_TEXT.offline : reason === 'revision-changed' ? KEY_TEXT.conflict : KEY_TEXT.auth,
      });
      expect(await t.store.state('p1')).toMatchObject({ active: false, notice: null, revision: 0, localSeq: 0, uploadedSeq: 0 });
      expect(t.srv.rows.get('p1')).toEqual(before);
      if (reason === 'auth') expect(t.onAuthFailure).toHaveBeenCalledWith('session-revoked', 'FAKE-session');
      else if (reason === 'not-allowed') expect(t.onAuthFailure).toHaveBeenCalledWith('not-allowed');
      else expect(t.onAuthFailure).not.toHaveBeenCalled();
    });
  });

  it('켜기 409(다른 기기가 그사이 켬)는 conflict로 남고 다음 단계에서도 conflict', async () => {
    const t = setup();
    t.secrets.set('p1', { kis: KIS_A });
    t.remember();
    await t.ks.step();
    // 목록을 받은 뒤 PUT 전에 다른 기기가 켰다
    await serverBlob(t.srv, 'p1', 1, { v: 1, kis: KIS_B });
    t.raw.listKeys.mockResolvedValueOnce({ ok: true, data: { keyVault: head, keyBlobs: [] } });
    expect((await t.ks.enable('p1', ['kis'])).ok).toBe(true);
    expect(await t.store.state('p1')).toMatchObject({ active: true, revision: 0, notice: 'conflict', remoteRevision: 1 });
    await t.ks.step();
    expect((await t.store.state('p1'))?.notice).toBe('conflict');
  });

  it('켜기 409인데 서버 행이 삭제 표시(그사이 다른 기기가 끔)면 그 리비전 기준으로 한 번 더 올린다', async () => {
    const t = setup();
    t.secrets.set('p1', { kis: KIS_A });
    t.remember();
    await t.ks.step();
    t.srv.rows.set('p1', { revision: 4, vaultRevision: 1, contentId: null, nonce: null, ciphertext: null });
    t.raw.listKeys.mockResolvedValueOnce({ ok: true, data: { keyVault: head, keyBlobs: [] } });
    expect(await t.ks.enable('p1', ['kis'])).toEqual({ ok: true, notes: [] });
    expect(await t.store.state('p1')).toMatchObject({ active: true, revision: 5, notice: null });
    expect(t.raw.putKeyBlob.mock.calls.map(([, b]) => [b.expectedRevision, b.newRevision])).toEqual([[0, 1], [4, 5]]);
  });

  it('켜기 404는 먼저 동기화 문구로 꺼진 채, 올라가지 않은 프로필은 서버를 부르지 않는다', async () => {
    const t = setup();
    t.secrets.set('p1', { kis: KIS_A });
    t.remember();
    await t.ks.step();
    t.raw.putKeyBlob.mockResolvedValueOnce({ ok: false, kind: 'not-found' });
    expect(await t.ks.enable('p1', ['kis'])).toEqual({ ok: false, message: KEY_TEXT.notUploaded });
    expect((await t.store.state('p1'))?.active).toBe(false);
    t.uploaded.delete('p1');
    t.raw.putKeyBlob.mockClear();
    expect(await t.ks.enable('p1', ['kis'])).toEqual({ ok: false, message: KEY_TEXT.notUploaded });
    expect(t.raw.putKeyBlob).not.toHaveBeenCalled();
  });

  it('켜기의 응답을 잃으면 꺼진 채이고, 다음 단계에서 자기 업로드가 available로 보인다', async () => {
    const t = setup();
    t.secrets.set('p1', { kis: KIS_A });
    t.remember();
    await t.ks.step();
    t.srv.loseNextPut = true;
    expect(await t.ks.enable('p1', ['kis'])).toEqual({ ok: false, message: KEY_TEXT.offline });
    expect((await t.store.state('p1'))?.active).toBe(false);
    await t.ks.step();
    expect((await t.store.state('p1'))?.notice).toBe('available');
  });

  it('받기: 블롭에 있는 공급자만 병합하고 선택을 맞추며, 선택이 줄면 안내한다', async () => {
    const t = setup();
    t.secrets.set('p1', { kis: KIS_A, toss: TOSS_A });
    t.remember();
    await serverBlob(t.srv, 'p1', 1, { v: 1, kis: KIS_B, toss: TOSS_A });
    await t.ks.step();
    expect(await receive(t)).toEqual({ ok: true, notes: [KEY_TEXT.received] });
    expect(await t.store.state('p1')).toMatchObject({ providers: ['kis', 'toss'], revision: 1, notice: null });
    await serverBlob(t.srv, 'p1', 2, { v: 1, kis: KIS_B });
    await t.ks.step();
    expect(await receive(t)).toEqual({ ok: true, notes: [KEY_TEXT.sameKeys, KEY_TEXT.dropped('toss')] });
    expect(t.secrets.get('p1')?.toss).toEqual(TOSS_A);
    expect((await t.store.state('p1'))?.providers).toEqual(['kis']);
  });

  it('받기: 덮어쓸 공급자를 알려 주고, 공급자에 맞는 키가 없으면 연결 설정 안내를 더한다', async () => {
    const t = setup({ provider: 'toss' });
    t.secrets.set('p1', { kis: KIS_A });
    t.remember();
    await serverBlob(t.srv, 'p1', 1, { v: 1, kis: KIS_B });
    await t.ks.step();
    const p = await t.ks.prepareReceive('p1');
    expect(p.ok && p.prepared.overwrite).toEqual(['kis']);
    if (!p.ok) throw new Error('prepare');
    expect(await t.ks.commitReceive(p.prepared)).toEqual({ ok: true, notes: [KEY_TEXT.received, KEY_TEXT.checkProvider] });
  });

  it('받는 중에 bumpSeq가 와도 받은 뒤 dirty로 남는다, 그사이 서버가 바뀌면 다시 판정', async () => {
    const t = setup();
    t.secrets.set('p1', { kis: KIS_A });
    t.remember();
    await serverBlob(t.srv, 'p1', 1, { v: 1, kis: KIS_B });
    await t.ks.step();
    const p = await t.ks.prepareReceive('p1');
    if (!p.ok) throw new Error('prepare');
    await t.store.bumpSeq('p1');
    expect((await t.ks.commitReceive(p.prepared)).ok).toBe(true);
    const st = (await t.store.state('p1'))!;
    expect(st.localSeq).toBeGreaterThan(st.uploadedSeq);

    await serverBlob(t.srv, 'p1', 2, { v: 1, kis: KIS_A });
    await t.ks.step();
    const q = await t.ks.prepareReceive('p1');
    await serverBlob(t.srv, 'p1', 3, { v: 1, kis: KIS_A });
    await t.ks.step();
    if (!q.ok) throw new Error('prepare');
    expect(await t.ks.commitReceive(q.prepared)).toEqual({ ok: false, message: null, recheck: true });

    // 로컬 알림은 그대로인데 서버 블롭만 바뀐 경우도 쓰지 않는다(잠금을 다시 잡은 뒤 서버를 다시 본다)
    const r = await t.ks.prepareReceive('p1');
    if (!r.ok) throw new Error('prepare');
    await serverBlob(t.srv, 'p1', 3, { v: 1, kis: KIS_B });
    t.app.applySyncedSecrets.mockClear();
    expect(await t.ks.commitReceive(r.prepared)).toEqual({ ok: false, message: null, recheck: true });
    expect(t.app.applySyncedSecrets).not.toHaveBeenCalled();
  });

  it('받기 실패 문구: 블롭이 풀리지 않으면 머리를 다시 보고 낡은 키면 암호를 다시 묻고, 아니면 손상 안내', async () => {
    const t = setup();
    t.remember();
    await serverBlob(t.srv, 'p1', 1, { v: 1, kis: KIS_A }, { key: nextKey });
    await t.ks.step();
    expect(await t.ks.prepareReceive('p1')).toEqual({ ok: false, message: KEY_TEXT.unopenable, offerDelete: true });
    t.srv.head = { ...head, salt: randomId(), vaultRevision: 2 };
    expect(await t.ks.prepareReceive('p1')).toEqual({ ok: false, message: KEY_TEXT.passChanged, needsPass: true });
    expect(t.key()).toBeNull();
  });

  it('받기: 알려진 저장 오류의 문구·오류 객체를 보존하고 리비전을 올리지 않는다', async () => {
    const t = setup();
    t.remember();
    await serverBlob(t.srv, 'p1', 1, { v: 1, kis: KIS_A });
    await t.ks.step();
    const named = (name: string) => Object.assign(new Error(name), { name });
    t.app.applySyncedSecrets.mockRejectedValueOnce(named('SecretsChangedError'));
    expect(await receive(t)).toEqual({ ok: false, message: KEY_TEXT.secretsChanged });
    t.app.applySyncedSecrets.mockRejectedValueOnce(named('KeyLockedElsewhereError'));
    expect(await receive(t)).toEqual({ ok: false, message: KEY_TEXT.lockedElsewhere });
    const e = named('KeyLockNotSavedError');
    t.app.applySyncedSecrets.mockRejectedValueOnce(e);
    expect(await receive(t)).toEqual({ ok: false, message: null, error: e });
    expect((await t.store.state('p1'))?.revision).toBe(0);
  });

  it.each([new Error('FAKE-save-error'), 'FAKE-non-error'])('받기의 알 수 없는 저장 실패는 기존 서버 문구로 알리고 상태를 유지한다: %s', async (error) => {
    const t = setup();
    t.remember();
    await serverBlob(t.srv, 'p1', 1, { v: 1, kis: KIS_A });
    await t.ks.step();
    const before = await t.store.state('p1');
    t.app.applySyncedSecrets.mockRejectedValueOnce(error);
    expect(await receive(t)).toEqual({ ok: false, message: KEY_TEXT.server });
    expect(await t.store.state('p1')).toEqual(before);
    expect(t.secrets.get('p1')).toBeUndefined();
  });

  it('공급자: 고르지 않은 공급자만 바뀌면 dirty가 아니고, setProviders는 dirty를 만들어 고른 공급자만 올린다, 값이 없으면 missing-key', async () => {
    const t = setup();
    await enabled(t);
    t.secrets.set('p1', { kis: KIS_A, toss: TOSS_A });
    await t.store.bumpSeq('p1', ['toss']);
    let st = (await t.store.state('p1'))!;
    expect(st.localSeq).toBe(st.uploadedSeq);
    expect(await t.ks.setProviders('p1', [])).toEqual({ ok: false, message: KEY_TEXT.keepOne });
    expect((await t.ks.setProviders('p1', ['kis', 'toss'])).ok).toBe(true);
    await t.ks.step();
    expect(await openServer(t.srv, 'p1')).toEqual({ v: 1, kis: KIS_A, toss: TOSS_A });
    t.secrets.set('p1', { toss: TOSS_A });
    await t.store.bumpSeq('p1', ['kis']);
    const puts = t.srv.calls.filter((c) => c.startsWith('put')).length;
    await t.ks.step();
    st = (await t.store.state('p1'))!;
    expect(st.notice).toBe('missing-key');
    expect(st.localSeq).toBeGreaterThan(st.uploadedSeq);
    expect(t.srv.calls.filter((c) => c.startsWith('put')).length).toBe(puts);
  });

  it('올리는 중에 bumpSeq가 오면 끝난 뒤에도 dirty, 다음 단계에서 다시 올린다', async () => {
    const t = setup();
    await enabled(t);
    t.secrets.set('p1', { kis: KIS_B });
    await t.store.bumpSeq('p1');
    let release!: () => void;
    t.srv.holdPut = new Promise((r) => (release = r));
    // enabled()의 이전 PUT을 이번 요청으로 오인하지 않는다.
    t.srv.calls.length = 0;
    const running = t.ks.step();
    await vi.waitFor(() => expect(t.srv.calls.at(-1)).toBe('put p1'));
    await t.store.bumpSeq('p1');
    t.srv.holdPut = null;
    release();
    await running;
    const st = (await t.store.state('p1'))!;
    expect(st.localSeq).toBeGreaterThan(st.uploadedSeq);
    await t.ks.step();
    expect((await t.store.state('p1'))?.revision).toBe(3);
  });

  it('응답 유실: 다음 단계가 PUT 없이 서버 평문을 비교해 같으면 맞추고, 다르면 conflict', async () => {
    const t = setup();
    await enabled(t);
    t.secrets.set('p1', { kis: KIS_B });
    await t.store.bumpSeq('p1');
    t.srv.loseNextPut = true;
    await t.ks.step();
    expect((await t.store.state('p1'))?.revision).toBe(1);
    t.raw.putKeyBlob.mockClear();
    await t.ks.step();
    const st = (await t.store.state('p1'))!;
    expect(st).toMatchObject({ revision: 2, notice: null });
    expect(st.localSeq).toBe(st.uploadedSeq);
    expect(t.raw.putKeyBlob).not.toHaveBeenCalled();

    const u = setup();
    await enabled(u);
    u.secrets.set('p1', { kis: KIS_B });
    await u.store.bumpSeq('p1');
    u.srv.loseNextPut = true;
    await u.ks.step();
    u.secrets.set('p1', { kis: KIS_C });
    await u.ks.step();
    expect((await u.store.state('p1'))?.notice).toBe('conflict');
  });

  it('끄기: 실패면 켜진 채 오류 문구, 서버 행이 살아 있으면 다음 단계가 offPending을 내린다, 성공이면 본 리비전을 남기고 꺼진다', async () => {
    const t = setup();
    await enabled(t);
    t.srv.online = false;
    expect(await t.ks.disable('p1')).toEqual({ ok: false, message: KEY_TEXT.offFailed });
    expect(await t.store.state('p1')).toMatchObject({ active: true, offPending: true });
    t.srv.online = true;
    await t.store.bumpSeq('p1');
    await serverBlob(t.srv, 'p1', 2, { v: 1, kis: KIS_A });
    await t.ks.step();
    expect((await t.store.state('p1'))?.offPending).toBe(false);
    expect(await t.ks.disable('p1')).toEqual({ ok: true, notes: [] });
    expect(await t.store.state('p1')).toMatchObject({ active: false, offPending: false, seenRevision: 3 });
    // 꺼진 프로필: 이 기기에서 키를 고쳐도 dirty가 생기지 않고, 다른 기기가 켜면 available
    await t.store.bumpSeq('p1', ['kis']);
    expect((await t.store.state('p1'))?.localSeq).toBe((await t.store.state('p1'))?.uploadedSeq);
    await serverBlob(t.srv, 'p1', 4, { v: 1, kis: KIS_B });
    await t.ks.step();
    expect((await t.store.state('p1'))?.notice).toBe('available');
  });

  it('자동 올리기의 409 vault-changed는 키를 잊고, no-vault는 vault-gone, 410은 조용히 꺼진다', async () => {
    const t = setup();
    await enabled(t);
    t.secrets.set('p1', { kis: KIS_B });
    await t.store.bumpSeq('p1');
    t.raw.putKeyBlob.mockResolvedValueOnce({ ok: false, kind: 'conflict', revision: 0, doc: null, code: 'vault-changed', vaultRevision: 2 });
    await t.ks.step();
    expect(t.key()).toBeNull();
    t.remember();
    t.raw.putKeyBlob.mockResolvedValueOnce({ ok: false, kind: 'conflict', revision: 0, doc: null, code: 'no-vault', vaultRevision: null });
    await t.ks.step();
    expect(t.key()).toBeNull();
    expect(await t.store.getMeta('keyNotice')).toBe('vault-gone');
    t.remember();
    t.raw.putKeyBlob.mockResolvedValueOnce({ ok: false, kind: 'gone', deletedAt: 1, purgeAt: 2 });
    await t.ks.step();
    expect((await t.store.state('p1'))?.active).toBe(false);
  });
});

describe('세션 비교·로그인 실패(5.12 #5, 5.3)', () => {
  it('모든 키 동작은 저장된 세션·소유자가 메모리와 다르면 요청 없이 키를 잊고 멈춘다', async () => {
    const t = setup();
    await enabled(t);
    await serverBlob(t.srv, 'p1', 2, { v: 1, kis: KIS_B });
    await t.ks.step();
    const prep = await t.ks.prepareReceive('p1');
    if (!prep.ok) throw new Error('prepare');
    const verifier = await makeVerifier(vault.key, VID, 1);
    const actions = [
      () => t.ks.createVault({ key: vault.key, vaultId: VID, salt: SALT, verifier }),
      () => t.ks.enable('p1', ['kis']),
      () => t.ks.setProviders('p1', ['kis']),
      () => t.ks.prepareReceive('p1'),
      () => t.ks.commitReceive(prep.prepared),
      () => t.ks.uploadLocal('p1'),
      () => t.ks.disable('p1'),
      () => t.ks.rekey({ key: nextKey, salt: randomId() }),
      () => t.ks.wipe(),
    ];
    const before = await t.store.state('p1');
    for (const run of actions) {
      t.remember();
      for (const m of Object.values(t.raw)) m.mockClear();
      t.app.applySyncedSecrets.mockClear();
      t.sessionOk.mockResolvedValueOnce(false);
      expect(await run()).toEqual({ ok: false, message: KEY_TEXT.auth });
      for (const m of Object.values(t.raw)) expect(m).not.toHaveBeenCalled();
      expect(t.app.applySyncedSecrets).not.toHaveBeenCalled();
      expect(t.key()).toBeNull();
    }
    expect(await t.store.state('p1')).toEqual(before);
  });

  it('키 단계 안의 블롭 요청이 auth로 실패하면 step이 auth를 돌려준다', async () => {
    const t = setup();
    await enabled(t);
    await serverBlob(t.srv, 'p1', 2, { v: 1, kis: KIS_B });
    t.secrets.set('p1', { kis: KIS_C });
    await t.store.bumpSeq('p1');
    t.raw.getKeyBlob.mockResolvedValueOnce({ ok: false, kind: 'auth', code: 'session-expired', session: 's1' });
    expect(await t.ks.step()).toBe('auth');
    expect(t.onAuthFailure).toHaveBeenCalledWith('session-expired', 's1');
    expect(await t.ks.step()).toBe('idle');
  });
});

describe('금고·암호 바꾸기·전체 삭제(5.5·5.9·5.10)', () => {
  it('금고 만들기: 성공이면 키를 기억하고, 409 vault-exists면 암호 입력으로', async () => {
    const t = setup();
    t.srv.head = null;
    const verifier = await makeVerifier(vault.key, VID, 1);
    expect(await t.ks.createVault({ key: vault.key, vaultId: VID, salt: SALT, verifier })).toEqual({ ok: true, notes: [] });
    expect(t.key()).toMatchObject({ vaultId: VID, salt: SALT, vaultRevision: 1 });
    expect(await t.store.getMeta('keyVault')).toEqual({ vaultId: VID, vaultRevision: 1, salt: SALT });
    t.raw.createKeyVault.mockResolvedValueOnce({ ok: false, kind: 'conflict', revision: 0, doc: null, code: 'vault-exists', keyVault: head });
    expect(await t.ks.createVault({ key: vault.key, vaultId: randomId(), salt: SALT, verifier })).toEqual({ ok: false, message: KEY_TEXT.vaultExists, needsPass: true });
  });

  it('rekey: 블롭 하나가 풀리지 않으면 서버를 부르지 않는다', async () => {
    const t = setup();
    t.remember();
    await serverBlob(t.srv, 'p1', 1, { v: 1, kis: KIS_A });
    await serverBlob(t.srv, 'p2', 1, { v: 1, kis: KIS_A }, { key: nextKey });
    expect(await t.ks.rekey({ key: nextKey, salt: randomId() })).toEqual({ ok: false, message: KEY_TEXT.rekeyUnopenable });
    expect(t.raw.rekey).not.toHaveBeenCalled();
  });

  it('rekey: 첫 409 뒤 다시 받아 성공하고, 블롭 리비전·내용 ID를 그대로 보낸다', async () => {
    const t = setup();
    t.remember();
    const cid = await serverBlob(t.srv, 'p1', 4, { v: 1, kis: KIS_A });
    const salt = randomId();
    t.raw.rekey
      .mockResolvedValueOnce({ ok: false, kind: 'conflict', revision: 0, doc: null, code: 'conflict', keyVault: head, keyBlobs: [] })
      .mockResolvedValueOnce({ ok: true, data: { vaultRevision: 2, updatedAt: 1 } });
    expect(await t.ks.rekey({ key: nextKey, salt })).toEqual({ ok: true, notes: [] });
    expect(t.raw.rekey).toHaveBeenCalledTimes(2);
    expect(t.raw.rekey.mock.calls[1][0]).toMatchObject({ expectedVaultId: VID, expectedVaultRevision: 1, salt, keyBlobs: [{ profileId: 'p1', revision: 4, contentId: cid }] });
    expect(t.key()).toMatchObject({ key: nextKey, vaultId: VID, salt, vaultRevision: 2 });
    expect(await t.store.getMeta('keyVault')).toEqual({ vaultId: VID, vaultRevision: 2, salt });
  });

  it('rekey: 두 번 409면 바꾸는 중 문구, 응답을 잃었어도 머리의 salt가 새 salt면 성공', async () => {
    const t = setup();
    t.remember();
    const conflict: ApiFail = { ok: false, kind: 'conflict', revision: 0, doc: null, code: 'conflict' };
    t.raw.rekey.mockResolvedValue(conflict);
    expect(await t.ks.rekey({ key: nextKey, salt: randomId() })).toEqual({ ok: false, message: KEY_TEXT.rekeyBusy });

    const u = setup();
    u.remember();
    const salt = randomId();
    u.raw.rekey.mockImplementationOnce(async () => {
      u.srv.head = { ...head, salt, vaultRevision: 2 };
      return OFF;
    });
    expect(await u.ks.rekey({ key: nextKey, salt })).toEqual({ ok: true, notes: [] });
    expect(u.key()).toMatchObject({ salt, vaultRevision: 2 });
  });

  it('전체 삭제: 성공이면 상태를 비우고 키를 잊는다, 실패면 아무것도 지우지 않는다', async () => {
    const t = setup();
    await enabled(t);
    t.raw.wipeKeys.mockResolvedValueOnce(OFF);
    expect(await t.ks.wipe()).toEqual({ ok: false, message: KEY_TEXT.wipeFailed });
    expect(await t.store.state('p1')).toBeDefined();
    expect(await t.ks.wipe()).toEqual({ ok: true, notes: [] });
    expect(t.key()).toBeNull();
    expect(await t.store.states()).toEqual([]);
    expect(await t.store.getMeta('keyVault')).toBeNull();
  });
});

describe('앞 Task 검토 회귀', () => {
  it('모든 쓰기 성공 응답의 리비전은 안전한 정수이고 0 이상 2^31 미만이어야 한다', async () => {
    for (const revision of [-1, 0.5, 2 ** 31, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '1', null, undefined] as unknown[]) {
      // HTTP 응답은 TypeScript 타입과 상관없이 검증한다.
      const invalid = revision as number;
      const t = setup();
      const verifier = await makeVerifier(vault.key, VID, 1);
      t.raw.createKeyVault.mockResolvedValueOnce({ ok: true, data: { vaultRevision: invalid, updatedAt: 1 } });
      expect(await t.ks.createVault({ key: vault.key, vaultId: VID, salt: SALT, verifier })).toEqual({ ok: false, message: KEY_TEXT.badResponse });
      expect(t.key()).toBeNull();
      expect(await t.store.getMeta('keyVault')).toBeUndefined();

      const before = await enabled(t);
      t.raw.rekey.mockResolvedValueOnce({ ok: true, data: { vaultRevision: invalid, updatedAt: 1 } });
      expect(await t.ks.rekey({ key: nextKey, salt: randomId() })).toEqual({ ok: false, message: KEY_TEXT.badResponse });
      expect(t.key()).toBe(vault);
      expect(await t.store.getMeta('keyVault')).toEqual({ vaultId: VID, salt: SALT, vaultRevision: 1 });

      t.secrets.set('p1', { kis: KIS_B });
      await t.store.bumpSeq('p1');
      t.raw.putKeyBlob.mockResolvedValueOnce({ ok: true, data: { revision: invalid, updatedAt: 1 } });
      expect(await t.ks.step()).toBe('idle');
      expect(t.ks.problem()).toBe(KEY_TEXT.badResponse);
      expect(await t.store.state('p1')).toMatchObject({ revision: before.revision, uploadedSeq: before.uploadedSeq });

      t.raw.putKeyBlob.mockResolvedValueOnce({ ok: true, data: { revision: invalid, updatedAt: 1 } });
      expect(await t.ks.uploadLocal('p1')).toEqual({ ok: false, message: KEY_TEXT.badResponse });

      t.raw.deleteKeyBlob.mockResolvedValueOnce({ ok: true, data: { deleted: true, revision: invalid } });
      expect(await t.ks.disable('p1')).toEqual({ ok: false, message: KEY_TEXT.badResponse });
      expect(await t.store.state('p1')).toMatchObject({ active: true, offPending: true, seenRevision: before.seenRevision });

      const u = setup();
      u.secrets.set('p1', { kis: KIS_A });
      u.remember();
      u.raw.putKeyBlob.mockResolvedValueOnce({ ok: true, data: { revision: invalid, updatedAt: 1 } });
      expect(await u.ks.enable('p1', ['kis'])).toEqual({ ok: false, message: KEY_TEXT.badResponse });
      expect(await u.store.state('p1')).toMatchObject({ active: false, revision: 0, seenRevision: 0 });
    }
  });

  it('409의 revision·vaultRevision이 틀리면 충돌 처리·재시도·키 망각 전에 응답 모양 오류로 멈춘다', async () => {
    for (const field of ['revision', 'vaultRevision'] as const) {
      for (const invalid of [-1, 0.5, 2 ** 31, NaN, Infinity]) {
        const conflict: ApiFail = { ok: false, kind: 'conflict', revision: 0, doc: null, code: 'vault-changed', vaultRevision: 2, [field]: invalid };
        const t = setup();
        const before = await enabled(t);
        const verifier = await makeVerifier(vault.key, VID, 1);
        t.raw.createKeyVault.mockResolvedValueOnce({ ...conflict, code: 'vault-exists' });
        expect(await t.ks.createVault({ key: nextKey, vaultId: VID, salt: SALT, verifier })).toEqual({ ok: false, message: KEY_TEXT.badResponse });
        t.raw.rekey.mockResolvedValueOnce({ ...conflict, code: 'conflict' });
        expect(await t.ks.rekey({ key: nextKey, salt: randomId() })).toEqual({ ok: false, message: KEY_TEXT.badResponse });
        expect(t.raw.rekey).toHaveBeenCalledTimes(1);
        t.raw.putKeyBlob.mockResolvedValueOnce({ ...conflict, code: 'conflict', deleted: true });
        expect(await t.ks.uploadLocal('p1')).toEqual({ ok: false, message: KEY_TEXT.badResponse });
        t.raw.deleteKeyBlob.mockResolvedValueOnce(conflict);
        expect(await t.ks.disable('p1')).toEqual({ ok: false, message: KEY_TEXT.badResponse });
        expect(t.key()).toBe(vault);
        expect(await t.store.state('p1')).toMatchObject({ active: true, revision: before.revision, seenRevision: before.seenRevision, notice: null });

        const u = setup();
        u.remember();
        u.secrets.set('p1', { kis: KIS_A });
        u.raw.putKeyBlob.mockResolvedValueOnce({ ...conflict, code: 'conflict', deleted: true });
        expect(await u.ks.enable('p1', ['kis'])).toEqual({ ok: false, message: KEY_TEXT.badResponse });
        expect(u.raw.putKeyBlob).toHaveBeenCalledTimes(1);
        expect(await u.store.state('p1')).toMatchObject({ active: false, revision: 0 });
      }
    }
  });

  it('올리는 중 다른 탭이 끄면 늦은 markSynced가 removed 알림을 지우지 않는다', async () => {
    const t = setup();
    const before = await enabled(t);
    t.secrets.set('p1', { kis: KIS_B });
    await t.store.bumpSeq('p1');
    let release!: () => void;
    t.srv.holdPut = new Promise((r) => (release = r));
    t.srv.calls.length = 0;
    const running = t.ks.step();
    await vi.waitFor(() => expect(t.srv.calls.at(-1)).toBe('put p1'));
    await t.store.setActive('p1', { active: false, notice: 'removed' });
    release();
    await running;
    expect(await t.store.state('p1')).toMatchObject({ active: false, notice: 'removed', revision: before.revision, uploadedSeq: before.uploadedSeq });
  });

  it('켜기의 PUT 중 다른 탭이 끄면 실패 정리도 removed 알림을 지우지 않는다', async () => {
    const t = setup();
    t.remember();
    t.secrets.set('p1', { kis: KIS_A });
    let release!: () => void;
    t.srv.holdPut = new Promise((r) => (release = r));
    const running = t.ks.enable('p1', ['kis']);
    await vi.waitFor(() => expect(t.srv.calls.at(-1)).toBe('put p1'));
    await t.store.setActive('p1', { active: false, notice: 'removed' });
    release();
    expect(await running).toEqual({ ok: false, message: null, recheck: true });
    expect(await t.store.state('p1')).toMatchObject({ active: false, notice: 'removed', revision: 0 });
  });

  it('켜기 409 뒤 평문을 비교하는 중 꺼진 행에도 conflict를 쓰지 않는다', async () => {
    const t = setup();
    t.remember();
    t.secrets.set('p1', { kis: KIS_A });
    await serverBlob(t.srv, 'p1', 1, { v: 1, kis: KIS_B });
    t.raw.listKeys.mockResolvedValueOnce({ ok: true, data: { keyVault: head, keyBlobs: [] } });
    const get = t.raw.getKeyBlob.getMockImplementation()!;
    t.raw.getKeyBlob.mockImplementationOnce(async (id) => {
      const result = await get(id);
      await t.store.setActive(id, { active: false, notice: 'removed' });
      return result;
    });
    expect(await t.ks.enable('p1', ['kis'])).toEqual({ ok: false, message: null, recheck: true });
    expect(await t.store.state('p1')).toMatchObject({ active: false, notice: 'removed', revision: 0, localSeq: 0 });
  });

  it.each(['auth', 'not-allowed'] as const)('받기·rekey의 재조회도 %s 실패면 로그인 정리를 부른다', async (kind) => {
    const failure: ApiFail = kind === 'auth'
      ? { ok: false, kind, code: 'session-revoked', session: 'FAKE-session' }
      : { ok: false, kind };
    for (const action of ['receive', 'rekey'] as const) {
      const t = setup();
      t.remember();
      if (action === 'receive') {
        await serverBlob(t.srv, 'p1', 1, { v: 1, kis: KIS_A }, { key: nextKey });
        await t.ks.step();
        t.raw.listKeys.mockResolvedValueOnce(failure);
        expect(await t.ks.prepareReceive('p1')).toEqual({ ok: false, message: KEY_TEXT.auth });
      } else {
        t.raw.listKeys
          .mockResolvedValueOnce({ ok: true, data: { keyVault: head, keyBlobs: [] } })
          .mockResolvedValueOnce(failure);
        t.raw.rekey.mockResolvedValueOnce(OFF);
        expect(await t.ks.rekey({ key: nextKey, salt: randomId() })).toEqual({ ok: false, message: KEY_TEXT.auth });
      }
      if (kind === 'auth') expect(t.onAuthFailure).toHaveBeenCalledWith('session-revoked', 'FAKE-session');
      else expect(t.onAuthFailure).toHaveBeenCalledWith('not-allowed');
    }
  });

  it('409 vaultRevision의 null은 no-vault에서만 허용하고 다른 충돌에서는 모양 오류다', async () => {
    const t = setup();
    const before = await enabled(t);
    t.raw.putKeyBlob.mockResolvedValueOnce({ ok: false, kind: 'conflict', code: 'vault-changed', revision: 0, vaultRevision: null, doc: null });
    expect(await t.ks.uploadLocal('p1')).toEqual({ ok: false, message: KEY_TEXT.badResponse });
    expect(t.key()).toBe(vault);
    expect(await t.store.state('p1')).toEqual(before);
    t.raw.putKeyBlob.mockResolvedValueOnce({ ok: false, kind: 'conflict', code: 'no-vault', revision: 0, vaultRevision: null, doc: null });
    expect(await t.ks.uploadLocal('p1')).toEqual({ ok: false, message: KEY_TEXT.noVault });
    expect(t.key()).toBeNull();
  });

  it('서버 평문 비교·받기 중 다른 탭이 끈 행도 markSynced로 덮어쓰지 않는다', async () => {
    const t = setup();
    const before = await enabled(t);
    await serverBlob(t.srv, 'p1', 2, { v: 1, kis: KIS_B });
    t.secrets.set('p1', { kis: KIS_B });
    await t.store.bumpSeq('p1');
    const get = t.raw.getKeyBlob.getMockImplementation()!;
    t.raw.getKeyBlob.mockImplementationOnce(async (id) => {
      const result = await get(id);
      await t.store.setActive(id, { active: false, notice: 'removed' });
      return result;
    });
    await t.ks.step();
    expect(await t.store.state('p1')).toMatchObject({ active: false, notice: 'removed', revision: before.revision, uploadedSeq: before.uploadedSeq });

    const u = setup();
    u.remember();
    await serverBlob(u.srv, 'p1', 1, { v: 1, kis: KIS_A });
    await u.ks.step();
    const apply = u.app.applySyncedSecrets.getMockImplementation()!;
    u.app.applySyncedSecrets.mockImplementationOnce(async (id, keys) => {
      const changed = await apply(id, keys);
      await u.store.setActive(id, { active: false, notice: 'removed' });
      return changed;
    });
    expect(await receive(u)).toEqual({ ok: false, message: null, recheck: true });
    expect(await u.store.state('p1')).toMatchObject({ active: false, notice: 'removed', revision: 0 });
  });

  it('꺼진 행의 공급자를 바꾸려 하면 저장소에 넘기지 않고 다시 판정한다', async () => {
    const t = setup();
    const set = vi.spyOn(t.store, 'setProviders');
    expect(await t.ks.setProviders('p1', ['kis'])).toEqual({ ok: false, message: null, recheck: true });
    await t.store.activate('p1', { providers: ['kis'], notice: null });
    await t.store.setActive('p1', { active: false, notice: 'removed' });
    expect(await t.ks.setProviders('p1', ['toss'])).toEqual({ ok: false, message: null, recheck: true });
    expect(set).not.toHaveBeenCalled();
    expect(await t.store.state('p1')).toMatchObject({ active: false, notice: 'removed', providers: ['kis'] });
  });

  it.each(['session', 'list', 'store', 'get', 'put'] as const)('step의 예상 밖 %s 예외는 키 문구만 남기고 idle을 반환하며 다음 호출은 복구된다', async (source) => {
    const t = setup();
    await enabled(t);
    const error = new Error('FAKE-unexpected-failure');
    if (source === 'session') t.sessionOk.mockRejectedValueOnce(error);
    if (source === 'list') t.raw.listKeys.mockRejectedValueOnce(error);
    if (source === 'store') vi.spyOn(t.store, 'state').mockRejectedValueOnce(error);
    if (source === 'get' || source === 'put') {
      t.secrets.set('p1', { kis: KIS_B });
      await t.store.bumpSeq('p1');
      if (source === 'get') {
        await serverBlob(t.srv, 'p1', 2, { v: 1, kis: KIS_B });
        t.raw.getKeyBlob.mockRejectedValueOnce(error);
      } else t.raw.putKeyBlob.mockRejectedValueOnce(error);
    }
    await expect(t.ks.step()).resolves.toBe('idle');
    expect(t.ks.problem()).toBe(KEY_TEXT.server);
    await expect(t.ks.step()).resolves.toBe('idle');
  });

  it('토글·공급자 선택·받기·올리기는 지금 프로필에서만 한다', async () => {
    const t = setup();
    await enabled(t);
    await serverBlob(t.srv, 'p1', 2, { v: 1, kis: KIS_B });
    await t.ks.step();
    const p = await t.ks.prepareReceive('p1');
    if (!p.ok) throw new Error('FAKE-prepare-failed');
    const before = await t.store.state('p1');
    t.app.meta.activeProfileId = 'p2';
    t.srv.calls.length = 0;
    for (const run of [
      () => t.ks.enable('p1', ['kis']),
      () => t.ks.setProviders('p1', ['toss']),
      () => t.ks.prepareReceive('p1'),
      () => t.ks.commitReceive(p.prepared),
      () => t.ks.uploadLocal('p1'),
      () => t.ks.disable('p1'),
    ]) expect(await run()).toEqual({ ok: false, message: KEY_TEXT.otherProfile });
    expect(t.srv.calls).toEqual([]);
    expect(t.app.applySyncedSecrets).not.toHaveBeenCalled();
    expect(await t.store.state('p1')).toEqual(before);
  });
});


describe('Task 8 검토 1회차 회귀', () => {
  it.each([
    { seen: 0, same: false },
    { seen: 1, same: false },
    { seen: 0, same: true },
    { seen: 1, same: true },
  ])('켜기 목록에 살아 있는 행이 있으면 덮지 않는다(seen=$seen, same=$same)', async ({ seen, same }) => {
    const t = setup();
    t.remember();
    t.secrets.set('p1', { kis: KIS_A });
    if (seen) await t.store.markSeen('p1', seen);
    const cid = await serverBlob(t.srv, 'p1', 1, { v: 1, kis: same ? KIS_A : KIS_B });
    const serverBefore = structuredClone(t.srv.rows.get('p1'));
    expect(await t.ks.enable('p1', ['kis'])).toEqual({ ok: true, notes: [] });
    expect(t.raw.putKeyBlob).not.toHaveBeenCalled();
    expect(t.srv.rows.get('p1')).toEqual(serverBefore);
    const st = (await t.store.state('p1'))!;
    if (same) {
      expect(st).toMatchObject({ active: true, revision: 1, syncedContentId: cid, seenRevision: 1, notice: null });
      expect(st.localSeq).toBe(st.uploadedSeq);
    } else {
      expect(st).toMatchObject({ active: true, revision: 0, notice: 'conflict', remoteRevision: 1 });
      expect(st.localSeq).toBeGreaterThan(st.uploadedSeq);
    }
    await t.ks.step();
    expect(t.raw.putKeyBlob).not.toHaveBeenCalled();
    expect((await t.store.state('p1'))?.notice).toBe(same ? null : 'conflict');
    expect(t.srv.rows.get('p1')).toEqual(serverBefore);
  });

  it.each(['synced', 'dirty', 'available'] as const)('이미 켜진 $0 행의 켜기는 상태를 보존하고 다시 판정한다', async (state) => {
    const t = setup();
    if (state === 'available') {
      t.remember();
      await serverBlob(t.srv, 'p1', 1, { v: 1, kis: KIS_B });
      await t.ks.step();
    } else {
      await enabled(t);
      if (state === 'dirty') await t.store.bumpSeq('p1');
    }
    t.secrets.set('p1', { kis: KIS_C });
    const before = await t.store.state('p1');
    const serverBefore = structuredClone(t.srv.rows.get('p1'));
    t.raw.putKeyBlob.mockClear();
    expect(await t.ks.enable('p1', ['kis'])).toEqual({ ok: false, message: null, recheck: true });
    expect(t.raw.putKeyBlob).not.toHaveBeenCalled();
    expect(await t.store.state('p1')).toEqual(before);
    expect(t.srv.rows.get('p1')).toEqual(serverBefore);
  });

  it.each(['rollback', 'deleted', 'absent'] as const)('꺼진 행을 켤 때 $0은 본 번호보다 크게 올린다', async (state) => {
    const t = setup();
    t.remember();
    t.secrets.set('p1', { kis: KIS_A });
    await t.store.markSeen('p1', 5);
    if (state === 'rollback') await serverBlob(t.srv, 'p1', 3, { v: 1, kis: KIS_B });
    if (state === 'deleted') t.srv.rows.set('p1', { revision: 6, vaultRevision: 1, contentId: null, nonce: null, ciphertext: null });
    expect(await t.ks.enable('p1', ['kis'])).toEqual({ ok: true, notes: [] });
    expect(t.raw.putKeyBlob).toHaveBeenCalledTimes(1);
    expect(t.raw.putKeyBlob.mock.calls[0][1]).toMatchObject({
      expectedRevision: state === 'rollback' ? 3 : state === 'deleted' ? 6 : 0,
      newRevision: state === 'deleted' ? 7 : 6,
    });
    expect(await openServer(t.srv, 'p1')).toEqual({ v: 1, kis: KIS_A });
  });

  it.each(['absent', 'inactive'] as const)('끄기는 $0 상태를 다시 켜거나 서버 키를 지우지 않는다', async (state) => {
    const t = setup();
    await serverBlob(t.srv, 'p1', 1, { v: 1, kis: KIS_B });
    if (state === 'inactive') {
      await t.store.markSeen('p1', 1);
      await t.store.setActive('p1', { active: false, notice: 'removed' });
    }
    const before = await t.store.state('p1');
    const serverBefore = structuredClone(t.srv.rows.get('p1'));
    expect(await t.ks.disable('p1')).toEqual({ ok: false, message: null, recheck: true });
    expect(t.raw.deleteKeyBlob).not.toHaveBeenCalled();
    expect(await t.store.state('p1')).toEqual(before);
    expect(t.srv.rows.get('p1')).toEqual(serverBefore);
  });

  it.each(['local-absent', 'list-absent', 'gone'] as const)('조용히 끄는 $0 경로는 앞 알림과 remoteRevision도 지운다', async (source) => {
    const t = setup();
    await enabled(t);
    await t.store.setNotice('p1', 'conflict', 1);
    if (source === 'local-absent') t.app.meta.profiles = [{ id: 'p2' }];
    if (source === 'list-absent') t.srv.rows.delete('p1');
    if (source === 'gone') {
      await t.store.bumpSeq('p1');
      t.raw.putKeyBlob.mockResolvedValueOnce({ ok: false, kind: 'gone', deletedAt: 1, purgeAt: 2 });
    }
    expect(await t.ks.step()).toBe('idle');
    const st = (await t.store.state('p1'))!;
    expect(st).toMatchObject({ active: false, notice: null, seenRevision: 1 });
    expect(st).not.toHaveProperty('remoteRevision');
    expect(t.ks.problem()).toBeNull();
  });

  it.each(['offline', 'bad-value', 'bad-response'] as const)('걸러낸 행 문구가 앞선 $0 문구를 덮지 않는다', async (source) => {
    const t = setup();
    await enabled(t);
    await t.store.bumpSeq('p1');
    const row = t.srv.rows.get('p1')!;
    t.srv.bad = { keyVault: head, keyBlobs: [
      { profileId: 'p1', revision: row.revision, contentId: row.contentId, vaultRevision: 1, deleted: false, updatedAt: 1 },
      { profileId: 'p2', revision: -1 },
    ] };
    if (source === 'offline') t.raw.putKeyBlob.mockResolvedValueOnce(OFF);
    if (source === 'bad-value') t.secrets.set('p1', { kis: { ...KIS_A, appKey: 'FAKE invalid key' } });
    if (source === 'bad-response') t.raw.putKeyBlob.mockResolvedValueOnce({ ok: true, data: { revision: -1, updatedAt: 1 } });
    expect(await t.ks.step()).toBe('idle');
    expect(t.ks.problem()).toBe(source === 'offline' ? KEY_TEXT.offline : source === 'bad-value' ? KEY_TEXT.badValue : KEY_TEXT.badResponse);
  });
});
