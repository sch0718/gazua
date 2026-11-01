// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../state/app.svelte';
import { createSafeStorage } from '../state/storage';
import { memoryBacking } from '../state/testStorage';
import { createMemoryOrderCache } from '../perf/orderCache';
import { saveStrategies } from '../sim/strategyStore';
import { profileKeys } from '../state/profileStore';
import { deviceApi, testServer, type TestServer } from '../../../sync-worker/test/server';
import { doc } from '../../../sync-worker/test/docs';
import { APP_OUTDATED_CODE } from './dto';
import { APP_OUTDATED_TEXT, createSyncEngine, type SyncEngineDeps, type SyncPhase } from './engine';
import { docHash } from './hash';
import { appProfiles } from './local';
import { createMemorySyncStore } from './store';

async function device(keys: SyncEngineDeps['keys'], timers: Pick<SyncEngineDeps, 'setTimer' | 'clearTimer'> = {}) {
  const s = testServer();
  const storage = createSafeStorage(memoryBacking());
  const { api } = await deviceApi(s);
  const app = createApp({ storage, now: () => s.h.clock.now, orderCache: createMemoryOrderCache() });
  const local = appProfiles(app, storage);
  const store = createMemorySyncStore();
  const engine = createSyncEngine({ local, store, api, now: () => s.h.clock.now, setTimer: () => 0, clearTimer: () => {}, ...timers, keys });
  await engine.init();
  return { s, app, engine, api, local, store, storage };
}
const calls = (s: TestServer, from = 0, to?: number) => s.requests.slice(from, to).map((r) => `${r.method} ${r.path}`);

describe('전략 문서 버전과 옮기기(§8.3)', () => {
  async function receiving() {
    const d = await device(undefined);
    expect((await d.api.putProfile('p1', { opId: 'remote-1', expectedRevision: 0, doc: doc() })).ok).toBe(true);
    await d.store.setMeta('enabled', true);
    await d.engine.init();
    return d;
  }

  it('받은 v1을 옮긴 뒤 서버 리비전이 올라가도 충돌 사본을 만들지 않는다', async () => {
    const d = await receiving();
    const create = vi.spyOn(d.local, 'create');
    await d.engine.pull();
    const remote = doc('다른 기기에서 고침');
    expect(await d.api.putProfile('p1', { opId: 'remote-2', expectedRevision: 1, doc: remote })).toEqual({ ok: true, data: { revision: 2 } });
    await d.engine.syncNow();
    expect(d.engine.status().conflicts).toEqual([]);
    expect(create).not.toHaveBeenCalled();
    expect(d.local.read('p1')).toMatchObject({ v: 2, name: remote.name });
    expect(await d.store.state('p1')).toEqual({ profileId: 'p1', syncedRevision: 2, syncedHash: await docHash(d.local.read('p1')) });
    expect(await d.api.getProfile('p1')).toEqual({ ok: true, data: { revision: 2, doc: remote } });
  });

  it('받은 v1은 서버에 그대로 두고 실제 로컬 수정이 있을 때 v2를 PUT한다', async () => {
    const d = await receiving();
    const put = vi.spyOn(d.api, 'putProfile');
    await d.engine.pull();
    await d.engine.syncNow();
    expect(put.mock.calls.filter(([id]) => id === 'p1')).toEqual([]);
    expect(await d.api.getProfile('p1')).toEqual({ ok: true, data: { revision: 1, doc: doc() } });
    d.app.renameProfile('p1', '이 기기에서 고침');
    await d.engine.syncNow();
    expect(put.mock.calls.filter(([id]) => id === 'p1')).toEqual([
      ['p1', { opId: expect.any(String), expectedRevision: 1, doc: d.local.read('p1') }],
    ]);
    expect(await d.api.getProfile('p1')).toEqual({ ok: true, data: { revision: 2, doc: d.local.read('p1') } });
  });

  it('take-remote로 받은 v1도 적용한 로컬 v2 해시를 확인 해시로 저장한다', async () => {
    const d = await receiving();
    d.local.write('p1', doc('내 수정'));
    await d.store.putConflict({ profileId: 'p1', kind: 'edit', local: d.local.read('p1'), remote: doc(), remoteRevision: 1, detectedAt: d.s.h.clock.now });
    await d.engine.resolve('p1', 'take-remote');
    expect(await d.store.state('p1')).toEqual({ profileId: 'p1', syncedRevision: 1, syncedHash: await docHash(d.local.read('p1')) });
    await d.engine.syncNow();
    expect(d.engine.status().conflicts).toEqual([]);
    expect(await d.api.getProfile('p1')).toEqual({ ok: true, data: { revision: 1, doc: doc() } });
  });

  it.each([false, true])('sent로 확인한 v1은 옮긴 v2 해시를 저장한다(실제 수정: %s)', async (edited) => {
    const d = await receiving();
    const remote = doc();
    d.local.write('p1', remote);
    const syncedHash = await docHash(d.local.read('p1'));
    await d.store.putOp({ opId: 'remote-1', profileId: 'p1', kind: 'put', doc: remote, hash: await docHash(remote), createdAt: d.s.h.clock.now, sentAt: d.s.h.clock.now, baseRevision: 0 });
    if (edited) d.app.renameProfile('p1', '응답 대기 중 실제 수정');
    const put = vi.spyOn(d.api, 'putProfile');
    await d.engine.pull();
    expect(await d.store.state('p1')).toEqual({ profileId: 'p1', syncedRevision: 1, syncedHash });
    expect(await d.store.ops()).toEqual([]);
    await d.engine.syncNow();
    expect(put.mock.calls.filter(([id]) => id === 'p1')).toHaveLength(edited ? 1 : 0);
    expect(await d.api.getProfile('p1')).toEqual({ ok: true, data: { revision: edited ? 2 : 1, doc: edited ? d.local.read('p1') : remote } });
    expect((await d.api.putProfile('p1', { opId: 'remote-next', expectedRevision: edited ? 2 : 1, doc: { ...d.local.read('p1'), name: '다음 원격 수정' } })).ok).toBe(true);
    await d.engine.syncNow();
    expect(d.engine.status().conflicts).toEqual([]);
    expect(d.local.read('p1').name).toBe('다음 원격 수정');
    expect(put.mock.calls.filter(([id]) => id === 'p1')).toHaveLength(edited ? 2 : 1);
  });

  it.each([false, true])('restore로 복구한 v1은 옮긴 v2 해시를 저장한다(실제 수정: %s)', async (edited) => {
    const d = await receiving();
    await d.engine.pull();
    const syncedHash = await docHash(d.local.read('p1'));
    expect((await d.api.deleteProfile('p1', { opId: 'remote-delete', expectedRevision: 1 })).ok).toBe(true);
    if (edited) d.app.renameProfile('p1', '삭제를 알기 전 실제 수정');
    await d.store.putConflict({ profileId: 'p1', kind: 'deleted', local: d.local.read('p1'), deletedAt: d.s.h.clock.now, purgeAt: d.s.h.clock.now + 30 * 86400000, remoteRevision: 2, detectedAt: d.s.h.clock.now });
    const put = vi.spyOn(d.api, 'putProfile');
    await d.engine.resolve('p1', 'restore');
    expect(await d.store.state('p1')).toEqual({ profileId: 'p1', syncedRevision: edited ? 4 : 3, syncedHash: edited ? await docHash(d.local.read('p1')) : syncedHash });
    await d.engine.syncNow();
    expect(put.mock.calls.filter(([id]) => id === 'p1')).toHaveLength(edited ? 1 : 0);
    expect(await d.api.getProfile('p1')).toEqual({ ok: true, data: { revision: edited ? 4 : 3, doc: edited ? d.local.read('p1') : doc() } });
    expect((await d.api.putProfile('p1', { opId: 'remote-next', expectedRevision: edited ? 4 : 3, doc: { ...d.local.read('p1'), name: '다음 원격 수정' } })).ok).toBe(true);
    await d.engine.syncNow();
    expect(d.engine.status().conflicts).toEqual([]);
    expect(d.local.read('p1').name).toBe('다음 원격 수정');
    expect(put.mock.calls.filter(([id]) => id === 'p1')).toHaveLength(edited ? 2 : 1);
  });

  it('옛 탭이 확인 해시를 옛 키의 v1 해시로 바꾼 뒤 새 키에서 실제로 고친 전략을 v2로 PUT한다', async () => {
    const d = await receiving();
    await d.engine.pull();
    const before = d.local.read('p1');
    const remote = doc();
    remote.strategies[0].name = '다른 기기에서 고친 전략';
    expect(await d.api.putProfile('p1', { opId: 'remote-2', expectedRevision: 1, doc: remote })).toEqual({ ok: true, data: { revision: 2 } });
    // 옛 탭은 받은 전략을 옛 키에만 쓰고 v1 해시를 확인한다.
    d.storage.set(profileKeys.strategies('p1'), { strategies: remote.strategies });
    const state = { profileId: 'p1', syncedRevision: 2, syncedHash: await docHash(remote) };
    await d.store.putState(state);
    expect(d.local.read('p1')).toEqual(before);
    expect(await docHash(before)).not.toBe(state.syncedHash);

    expect(before.v).toBe(2);
    if (before.v !== 2) throw new Error('v2 문서가 필요하다');
    saveStrategies(d.storage, 'p1', [{ ...before.strategies[0], name: '새 탭에서 실제로 고친 전략' }]);
    const edited = d.local.read('p1');
    expect(edited).toMatchObject({ v: 2, strategies: [{ name: '새 탭에서 실제로 고친 전략' }] });
    expect(d.storage.get(profileKeys.strategies('p1'), null)).toEqual({ strategies: remote.strategies });

    const put = vi.spyOn(d.api, 'putProfile');
    await d.engine.syncNow();
    expect(put.mock.calls.filter(([id]) => id === 'p1')).toEqual([
      ['p1', { opId: expect.any(String), expectedRevision: 2, doc: edited }],
    ]);
    expect(await d.store.state('p1')).toEqual({ profileId: 'p1', syncedRevision: 3, syncedHash: await docHash(edited) });
    expect(await d.api.getProfile('p1')).toEqual({ ok: true, data: { revision: 3, doc: edited } });
  });

  it('새 키에서 실제로 고친 전략은 옛 키가 남아 있어도 v2로 PUT한다', async () => {
    const d = await receiving();
    await d.engine.pull();
    const before = d.local.read('p1');
    expect(before.v).toBe(2);
    if (before.v !== 2) throw new Error('v2 문서가 필요하다');
    saveStrategies(d.storage, 'p1', [{ ...before.strategies[0], name: '이 기기에서 고친 전략' }]);
    expect(d.storage.get(profileKeys.strategies('p1'), null)).toEqual({ strategies: doc().strategies });

    const put = vi.spyOn(d.api, 'putProfile');
    await d.engine.syncNow();
    expect(put.mock.calls.filter(([id]) => id === 'p1')).toEqual([
      ['p1', { opId: expect.any(String), expectedRevision: 1, doc: d.local.read('p1') }],
    ]);
    expect(await d.api.getProfile('p1')).toEqual({ ok: true, data: { revision: 2, doc: d.local.read('p1') } });
  });

  it('v1 적용 뒤 대기 작업을 정리하는 동안 한 실제 수정은 확인 해시에 섞이지 않는다', async () => {
    const d = await receiving();
    await d.engine.pull();
    expect((await d.api.putProfile('p1', { opId: 'remote-2', expectedRevision: 1, doc: doc('서버 수정') })).ok).toBe(true);
    const ops = d.store.ops;
    vi.spyOn(d.store, 'ops')
      .mockImplementationOnce(ops) // pull 시작 시 대기 작업 조회
      .mockImplementationOnce(async () => {
        d.app.renameProfile('p1', '정리 중 실제 수정'); // dropOps의 IndexedDB 대기 중 사용자 저장
        return ops();
      });
    await d.engine.pull();
    expect(d.local.read('p1').name).toBe('정리 중 실제 수정');
    expect((await d.store.state('p1'))!.syncedHash).not.toBe(await docHash(d.local.read('p1')));
    await d.engine.flush();
    expect(await d.api.getProfile('p1')).toEqual({ ok: true, data: { revision: 3, doc: d.local.read('p1') } });
  });

  it('422 APP_OUTDATED_CODE는 안내만 남기고 다음 프로필을 정상으로 받는다', async () => {
    const d = await receiving();
    const second = doc('두 번째');
    expect((await d.api.putProfile('p2', { opId: 'remote-p2', expectedRevision: 0, doc: second })).ok).toBe(true);
    const getProfile = d.api.getProfile;
    vi.spyOn(d.api, 'getProfile').mockImplementation((id) => id === 'p1' ? Promise.resolve({ ok: false, kind: 'invalid', code: APP_OUTDATED_CODE }) : getProfile(id));
    const write = vi.spyOn(d.local, 'write');
    await d.engine.pull();
    expect(d.engine.status().phase).toBe('idle');
    expect(write).not.toHaveBeenCalledWith('p1', expect.anything());
    expect(write).toHaveBeenCalledExactlyOnceWith('p2', second);
    expect(d.local.read('p2')).toMatchObject({ v: 2, name: second.name });
    expect(d.engine.status().notices).toContain(APP_OUTDATED_TEXT);
  });

  it.each([3, '3'])('지원하지 않는 문서 버전 %s는 로컬에 쓰지 않고 안내한다', async (v) => {
    const d = await receiving();
    vi.spyOn(d.api, 'getProfile').mockResolvedValue({ ok: true, data: { revision: 2, doc: { ...doc(), v } as never } });
    const write = vi.spyOn(d.local, 'write');
    await d.engine.pull();
    expect(write).not.toHaveBeenCalled();
    expect(d.engine.status().phase).toBe('idle');
    expect(d.engine.status().notices).toContain(APP_OUTDATED_TEXT);
  });

  it('올리기가 APP_OUTDATED_CODE로 거절되면 같은 안내를 중복 없이 남긴다', async () => {
    const d = await device(undefined);
    vi.spyOn(d.api, 'putProfile').mockResolvedValue({ ok: false, kind: 'invalid', code: APP_OUTDATED_CODE });
    await d.engine.setEnabled(true);
    d.app.renameProfile(d.app.meta.activeProfileId, '다시 수정');
    await d.engine.flush();
    expect(d.engine.status().notices).toEqual([APP_OUTDATED_TEXT]);
    expect(d.engine.status().rejected).toContainEqual({ profileId: d.app.meta.activeProfileId, code: APP_OUTDATED_CODE });
  });
});

describe('엔진의 키 단계', () => {
  it('syncNow는 pull → keys → push 순서이고, 키 단계가 idle을 돌려주면 push가 돈다', async () => {
    let at = -1;
    let server: TestServer | null = null;
    const keys = { step: vi.fn(async (): Promise<SyncPhase> => ((at = server!.requests.length), 'idle')), reset: vi.fn(async () => {}) };
    const d = await device(keys);
    server = d.s;
    await d.engine.setEnabled(true);
    expect(keys.step).toHaveBeenCalledTimes(1);
    expect(calls(d.s, 0, at)).toContain('GET /v1/profiles');
    expect(calls(d.s, 0, at).some((c) => c.startsWith('PUT /v1/profiles/'))).toBe(false);
    expect(calls(d.s, at).some((c) => c.startsWith('PUT /v1/profiles/'))).toBe(true);
    expect(d.engine.status().phase).toBe('idle');
  });

  it('키 단계가 auth면 push를 하지 않고 그 단계 값이 남는다', async () => {
    const keys = { step: vi.fn(async (): Promise<SyncPhase> => 'auth'), reset: vi.fn(async () => {}) };
    const d = await device(keys);
    await d.engine.setEnabled(true);
    expect(calls(d.s).some((c) => c.startsWith('PUT /v1/profiles/'))).toBe(false);
    expect(d.engine.status().phase).toBe('auth');
  });

  it('keysNow는 키 단계만 돈다', async () => {
    const keys = { step: vi.fn(async (): Promise<SyncPhase> => 'idle'), reset: vi.fn(async () => {}) };
    const d = await device(keys);
    await d.engine.setEnabled(true);
    const before = d.s.requests.length;
    const status = d.engine.status();
    d.s.h.clock.now += 1000;
    await d.engine.keysNow();
    expect(keys.step).toHaveBeenCalledTimes(2);
    expect(d.s.requests.length).toBe(before);
    expect(d.engine.status()).toEqual(status);
  });

  it('push가 offline으로 실패한 뒤 keysNow는 phase·마지막 동기화 시각·대기 작업을 지킨다', async () => {
    const keys = { step: vi.fn(async (): Promise<SyncPhase> => 'idle'), reset: vi.fn(async () => {}) };
    const d = await device(keys);
    await d.engine.setEnabled(true);
    const lastSyncAt = d.engine.status().lastSyncAt;
    d.s.h.clock.now += 1000;
    d.app.renameProfile(d.app.meta.activeProfileId, '오프라인 수정');
    d.s.online = false;
    await d.engine.flush();
    expect(d.engine.status()).toMatchObject({ phase: 'offline', lastSyncAt, pending: 1 });

    const phases: SyncPhase[] = [];
    const unsubscribe = d.engine.subscribe((s) => phases.push(s.phase));
    await d.engine.keysNow();
    unsubscribe();
    expect(d.engine.status()).toMatchObject({ phase: 'offline', lastSyncAt, pending: 1 });
    expect(phases).not.toContain('idle');
  });

  it('keysNow는 프로필 재시도 타이머와 실패 횟수에 따른 백오프를 지킨다', async () => {
    const setTimer = vi.fn((_fn: () => void, _ms: number) => ({}));
    const clearTimer = vi.fn();
    const keys = { step: vi.fn(async (): Promise<SyncPhase> => 'idle'), reset: vi.fn(async () => {}) };
    const d = await device(keys, { setTimer, clearTimer });
    await d.engine.setEnabled(true);
    d.app.renameProfile(d.app.meta.activeProfileId, '오프라인 수정');
    d.s.online = false;
    await d.engine.flush();
    expect(setTimer).toHaveBeenCalledTimes(1);
    expect(setTimer.mock.calls[0][1]).toBe(5000);
    const retry = setTimer.mock.results[0].value;

    await d.engine.keysNow();
    expect(setTimer).toHaveBeenCalledTimes(1);
    expect(clearTimer).not.toHaveBeenCalled();
    await d.engine.flush();
    expect(clearTimer).toHaveBeenCalledExactlyOnceWith(retry);
    expect(setTimer).toHaveBeenCalledTimes(2);
    expect(setTimer.mock.calls[1][1]).toBe(10000);
  });

  it('keys가 없으면 키 단계를 건너뛴다', async () => {
    const d = await device(undefined);
    await d.engine.setEnabled(true);
    await d.engine.keysNow();
    expect(d.engine.status().phase).toBe('idle');
  });

  it('reset은 키 저장소도 비운다', async () => {
    const keys = { step: vi.fn(async (): Promise<SyncPhase> => 'idle'), reset: vi.fn(async () => {}) };
    const d = await device(keys);
    await d.engine.reset();
    expect(keys.reset).toHaveBeenCalledTimes(1);
  });

  it('exclusive는 키 단계와 겹치지 않고 차례로 돈다', async () => {
    const order: string[] = [];
    const keys = { step: vi.fn(async (): Promise<SyncPhase> => 'idle'), reset: vi.fn(async () => {}) };
    const d = await device(keys);
    await d.engine.setEnabled(true);
    order.length = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let started!: () => void;
    const stepStarted = new Promise<void>((r) => (started = r));
    keys.step.mockImplementationOnce(async () => {
      order.push('s1');
      started();
      await gate;
      order.push('s2');
      return 'idle';
    });
    const k = d.engine.keysNow();
    await stepStarted;
    const a = d.engine.exclusive(async () => order.push('a'));
    await new Promise((r) => setTimeout(r, 0));
    release();
    await Promise.all([k, a]);
    expect(order).toEqual(['s1', 's2', 'a']);
  });
});
