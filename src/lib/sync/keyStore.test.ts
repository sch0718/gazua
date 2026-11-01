import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { describe, expect, it } from 'vitest';
import { createMemoryKeyStore, openKeyStore, type KeyStore } from './keyStore';
import { openSyncStore } from './store';

const CID = 'I'.repeat(24);
let n = 0;
const fresh = () => `gazua-sync-keys-test-${++n}`;

describe.each([
  ['메모리', async (): Promise<KeyStore> => createMemoryKeyStore()],
  ['IndexedDB', async (): Promise<KeyStore> => openKeyStore(fresh())],
])('키 저장소(%s)', (_name, make) => {
  it('activate: 꺼진 행을 켜면 revision 0·dirty 없음, seenRevision은 그대로, 켜진 행은 알림만 바꾼다', async () => {
    const s = await make();
    await s.markSeen('p', 7);
    expect(await s.state('p')).toMatchObject({ active: false, seenRevision: 7, revision: 0 });
    await s.activate('p', { providers: ['kis'], notice: null });
    await s.bumpSeq('p');
    await s.bumpSeq('p');
    await s.markSynced('p', { revision: 8, contentId: CID, uploadedSeq: 1, notice: null });
    await s.setActive('p', { active: false });
    await s.bumpSeq('p'); // 꺼진 행은 무시
    expect((await s.state('p'))?.localSeq).toBe(2);
    await s.activate('p', { providers: ['toss'], notice: 'available', remoteRevision: 9 });
    expect(await s.state('p')).toEqual({
      profileId: 'p',
      active: true,
      revision: 0,
      syncedContentId: null,
      seenRevision: 7,
      offPending: false,
      providers: ['toss'],
      localSeq: 2,
      uploadedSeq: 2,
      notice: 'available',
      remoteRevision: 9,
    });
    await s.activate('p', { providers: ['kis'], notice: null });
    expect(await s.state('p')).toMatchObject({ providers: ['toss'], notice: null });
    expect((await s.state('p'))?.remoteRevision).toBeUndefined();
  });

  it('markSeen은 더 클 때만 올리고, setActive는 끄기 대기·알림을 함께 바꾼다', async () => {
    const s = await make();
    await s.markSeen('p', 5);
    await s.markSeen('p', 3);
    expect((await s.state('p'))?.seenRevision).toBe(5);
    await s.setActive('p', { active: true, offPending: true });
    expect(await s.state('p')).toMatchObject({ active: true, offPending: true, notice: null });
    await s.setActive('p', { active: false, offPending: false, notice: 'removed' });
    expect(await s.state('p')).toMatchObject({ active: false, offPending: false, notice: 'removed', seenRevision: 5 });
  });

  it('bumpSeq: 고르지 않은 공급자만 바뀌면 무시, 알기만 한 행(providers [])도 무시', async () => {
    const s = await make();
    await s.activate('p', { providers: ['kis'], notice: null });
    await s.bumpSeq('p', ['toss']);
    expect((await s.state('p'))?.localSeq).toBe(0);
    await s.bumpSeq('p', ['kis', 'toss']);
    expect((await s.state('p'))?.localSeq).toBe(1);
    await s.activate('q', { providers: [], notice: 'available', remoteRevision: 1 });
    await s.bumpSeq('q', ['kis']);
    expect((await s.state('q'))?.localSeq).toBe(0);
    await s.bumpSeq('none');
    expect(await s.state('none')).toBeUndefined();
  });

  it('setProviders: 빈 배열·꺼진 행은 거절, 켜진 행은 선택을 바꾸고 localSeq를 올린다', async () => {
    const s = await make();
    await expect(s.setProviders('p', ['kis'])).rejects.toThrow();
    await s.markSeen('p', 1);
    await expect(s.setProviders('p', ['kis'])).rejects.toThrow();
    await s.activate('p', { providers: ['kis'], notice: null });
    await expect(s.setProviders('p', [])).rejects.toThrow();
    await s.setProviders('p', ['kis', 'toss']);
    expect(await s.state('p')).toMatchObject({ providers: ['kis', 'toss'], localSeq: 1, uploadedSeq: 0 });
  });

  it('markSynced는 localSeq를 그대로 두고 uploadedSeq·리비전·내용 ID·알림을 쓴다', async () => {
    const s = await make();
    await s.activate('p', { providers: ['kis'], notice: 'conflict', remoteRevision: 4 });
    await s.bumpSeq('p');
    await s.bumpSeq('p');
    await s.markSynced('p', { revision: 4, contentId: CID, uploadedSeq: 1, providers: ['kis', 'toss'], notice: null });
    expect(await s.state('p')).toMatchObject({ revision: 4, syncedContentId: CID, localSeq: 2, uploadedSeq: 1, providers: ['kis', 'toss'], notice: null });
    await s.markSynced('missing', { revision: 1, contentId: CID, uploadedSeq: 0, notice: null });
    expect(await s.state('missing')).toBeUndefined();
  });

  it('meta와 clear', async () => {
    const s = await make();
    await s.setMeta('keyVault', { vaultId: 'V'.repeat(24), vaultRevision: 1, salt: 'S'.repeat(24) });
    await s.setNotice('p', 'newer', 3);
    expect(await s.getMeta('keyVault')).toEqual({ vaultId: 'V'.repeat(24), vaultRevision: 1, salt: 'S'.repeat(24) });
    expect(await s.states()).toHaveLength(1);
    await s.clear();
    expect(await s.getMeta('keyVault')).toBeUndefined();
    expect(await s.states()).toEqual([]);
  });
});

describe('IndexedDB 키 저장소', () => {
  it('두 연결에서 bumpSeq와 markSynced가 겹쳐도 localSeq를 잃지 않는다', async () => {
    const name = fresh();
    const a = await openKeyStore(name);
    const b = await openKeyStore(name);
    expect(a.persistent && b.persistent).toBe(true);
    await a.activate('p', { providers: ['kis'], notice: null });
    await Promise.all([a.bumpSeq('p'), b.markSynced('p', { revision: 1, contentId: CID, uploadedSeq: 0, notice: null }), a.bumpSeq('p')]);
    expect(await b.state('p')).toMatchObject({ localSeq: 2, uploadedSeq: 0, revision: 1 });
  });

  it('blocked가 상한을 넘으면 메모리 저장소로 계속한다', async () => {
    const name = fresh();
    const holder = await openDB(name, 1);
    const s = await openKeyStore(name, { version: 2, blockedMs: 50 });
    expect(s.persistent).toBe(false);
    await s.activate('p', { providers: ['kis'], notice: null });
    expect((await s.state('p'))?.active).toBe(true);
    holder.close();
  });

  it('기본 이름은 gazua-sync-keys 버전 1이고, gazua-sync는 버전 1 그대로다', async () => {
    const keys = await openKeyStore();
    await openSyncStore();
    expect(keys.persistent).toBe(true);
    const k = await openDB('gazua-sync-keys');
    expect(k.version).toBe(1);
    expect([...k.objectStoreNames].sort()).toEqual(['keys', 'meta']);
    k.close();
    const s = await openDB('gazua-sync');
    expect(s.version).toBe(1);
    s.close();
  });
});
