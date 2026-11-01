// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, KeyLockedElsewhereError, SecretsChangedError, StoredKeysNotRemovedError, type App } from '../state/app.svelte';
import { createSafeStorage } from '../state/storage';
import { memoryBacking } from '../state/testStorage';
import { createMemoryOrderCache } from '../perf/orderCache';
import { ME, OTHER } from '../../../sync-worker/test/harness';
import { SYNC_BASE, testServer, type TestServer } from '../../../sync-worker/test/server';
import type { AuthClient } from './auth';
import { createSyncController, KEY_CHANNEL, type SyncController } from './controller.svelte';
import { createMemoryKeyStore, type KeyStore } from './keyStore';
import { createMemorySyncStore, type SyncStore } from './store';

vi.setConfig({ testTimeout: 60_000 });

const CONFIG = { apiUrl: SYNC_BASE, social: null, firebase: { apiKey: 'k', authDomain: 'gazua-test.firebaseapp.com', projectId: 'gazua-test', appId: 'a' } };
type Options = { keyDebounceMs?: number; lock?: <T>(fn: () => Promise<T>) => Promise<T> };
const PASS = 'FAKE-sync-pass-0001';
const KIS = { appKey: 'FAKE-kis-key-0001', appSecret: 'FAKE-kis-secret-0001' };
const KIS2 = { appKey: 'FAKE-kis-key-0002', appSecret: 'FAKE-kis-secret-0002' };

function fakeAuth(s: TestServer) {
  const a = {
    user: { uid: 'uid-me', email: ME },
    signedIn: false,
    ready: async () => (a.signedIn ? { ...a.user } : null),
    signIn: async () => {
      a.signedIn = true;
      return { user: { ...a.user }, idToken: await s.h.token({ email: a.user.email, sub: a.user.uid }) };
    },
    redirectResult: async () => null,
    signOut: async () => {
      a.signedIn = false;
    },
    idToken: async () => (a.signedIn ? s.h.token({ email: a.user.email, sub: a.user.uid }) : null),
  };
  return a satisfies AuthClient & { signedIn: boolean };
}

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

interface D {
  sync: SyncController;
  app: App;
  store: SyncStore;
  keyStore: KeyStore;
  auth: ReturnType<typeof fakeAuth>;
}
async function setup(s: TestServer, o: Options = {}): Promise<D> {
  const storage = createSafeStorage(memoryBacking());
  const store = createMemorySyncStore();
  const keyStore = createMemoryKeyStore();
  const auth = fakeAuth(s);
  const sync = createSyncController({
    config: CONFIG,
    storage,
    auth,
    store: async () => store,
    keyStore: async () => keyStore,
    fetchImpl: s.fetch,
    now: () => s.h.clock.now,
    deviceLabel: () => '테스트',
    keyDebounceMs: o.keyDebounceMs ?? 10,
    lock: o.lock,
  });
  const app = createApp({
    storage,
    now: () => s.h.clock.now,
    orderCache: createMemoryOrderCache(),
    onSyncableChange: (e) => sync.onSyncableChange(e),
    onSecretsChange: (e) => sync.onSecretsChange(e),
    onLock: () => sync.onLock(),
  });
  await sync.attach(app);
  cleanups.push(() => {
    sync.destroy();
    app.destroy();
  });
  await sync.signIn();
  await sync.setEnabled(true);
  return { sync, app, store, keyStore, auth };
}
/** 키 동기화를 켠 기기(금고를 만들고 KIS 키를 리비전 1로 올림) */
async function on(s: TestServer, o: Options = {}): Promise<D> {
  const d = await setup(s, o);
  await d.app.setSecrets({ kis: KIS });
  expect(await d.sync.keys.createVault(PASS)).toEqual({ ok: true, notes: [] });
  expect(await d.sync.keys.enable(d.app.meta.activeProfileId, ['kis'])).toEqual({ ok: true, notes: [] });
  expect(d.sync.keys.view.remembered).toBe(true);
  expect(d.sync.keys.view.support).toBe(true);
  return d;
}
const serverRevision = (s: TestServer, id: string) =>
  (s.h.env.DB.raw.prepare('SELECT revision FROM key_blobs WHERE profile_id = ?').get(id) as { revision: number } | undefined)?.revision;

describe('컨트롤러의 키 동기화', () => {
  it('이 기기에서 키를 고치면 디바운스 뒤 키 단계만 돌아 자동으로 올린다', async () => {
    const s = testServer();
    const d = await on(s);
    const id = d.app.meta.activeProfileId;
    expect(serverRevision(s, id)).toBe(1);
    await d.app.setSecrets({ kis: KIS2 });
    await vi.waitFor(() => expect(serverRevision(s, id)).toBe(2), { timeout: 5000 });
  });

  it.each(['destroy', 'reset'] as const)('키 타이머는 %s 때 clearTimeout으로 지운다', async (how) => {
    const s = testServer();
    const d = await on(s, { keyDebounceMs: 60_000 });
    // 다른 경로(setSecrets → rebuild 등)의 타이머와 섞이지 않게, 키 디바운스 지연(60000ms)으로 건 타이머 핸들만 골라 센다
    const setSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    try {
      await d.app.setSecrets({ kis: KIS2 });
      await vi.waitFor(() => expect(setSpy.mock.calls.some(([, ms]) => ms === 60_000)).toBe(true)); // onSecretsChange → scheduleKeys
      const i = setSpy.mock.calls.findIndex(([, ms]) => ms === 60_000);
      const handle = setSpy.mock.results[i].value;
      expect(clearSpy.mock.calls.some(([h]) => h === handle)).toBe(false);
      if (how === 'destroy') d.sync.destroy();
      else {
        // 이 탭의 계정 전환: 로그아웃 없이 다른 계정으로 로그인 → engine.reset → 키 타이머를 지운다(5.3·5.12 #6)
        d.auth.user = { uid: 'uid-other', email: OTHER };
        await d.sync.signIn();
        expect(await d.keyStore.states()).toEqual([]);
      }
      expect(clearSpy.mock.calls.some(([h]) => h === handle)).toBe(true);
    } finally {
      setSpy.mockRestore();
      clearSpy.mockRestore();
    }
  });

  it('다른 탭의 채널 forget을 받으면 마스터 키를 잊는다', async () => {
    const s = testServer();
    const d = await on(s);
    const ch = new BroadcastChannel(KEY_CHANNEL);
    ch.postMessage({ type: 'forget' });
    await vi.waitFor(() => expect(d.sync.keys.view.remembered).toBe(false));
    ch.close();
  });

  it('로그아웃하면 잊고 채널에 forget을 보낸다', async () => {
    const s = testServer();
    const d = await on(s);
    const got: unknown[] = [];
    const ch = new BroadcastChannel(KEY_CHANNEL);
    ch.onmessage = (e) => got.push(e.data);
    await d.sync.signOut();
    expect(d.sync.keys.view.remembered).toBe(false);
    await vi.waitFor(() => expect(got).toContainEqual({ type: 'forget' }));
    ch.close();
  });

  it.each(['lock', 'sync-off', 'pagehide', 'forget'] as const)('%s이면 마스터 키를 잊는다', async (how) => {
    const s = testServer();
    const d = await on(s);
    if (how === 'lock') {
      await d.app.setSecrets(d.app.secrets!, 'correct horse');
      d.app.lock();
    } else if (how === 'sync-off') await d.sync.setEnabled(false);
    else if (how === 'pagehide') window.dispatchEvent(new Event('pagehide'));
    else d.sync.keys.forget();
    await vi.waitFor(() => expect(d.sync.keys.view.remembered).toBe(false));
  });

  it('저장된 세션이 메모리와 다르면 키 단계가 키 요청 없이 마스터 키를 잊는다', async () => {
    const s = testServer();
    const d = await on(s);
    await d.store.setMeta('session', { id: 'other-session', email: ME });
    s.requests.length = 0;
    await d.sync.syncNow();
    expect(s.requests.some((r) => r.path.startsWith('/v1/keys'))).toBe(false);
    await vi.waitFor(() => expect(d.sync.keys.view.remembered).toBe(false));
  });

  it('다른 계정으로 로그인하면 키 상태를 비우고 마스터 키를 잊는다', async () => {
    const s = testServer();
    const d = await on(s);
    expect((await d.keyStore.states()).length).toBe(1);
    await d.sync.signOut();
    d.auth.user = { uid: 'uid-other', email: OTHER };
    await d.sync.signIn();
    expect(await d.keyStore.states()).toEqual([]);
    expect(await d.keyStore.getMeta('keyVault')).toBeUndefined();
    expect(d.sync.keys.view.remembered).toBe(false);
  });

  it('암호 바꾸기는 현재 암호를 다시 묻고, 같은 암호는 막고, 성공하면 새 키를 기억한다', async () => {
    const s = testServer();
    const d = await on(s);
    expect(await d.sync.keys.changePassphrase(PASS, PASS.normalize('NFD'))).toEqual({ ok: false, message: '지금 암호와 같아요' });
    expect(await d.sync.keys.changePassphrase(`${PASS}x`, 'FAKE-sync-pass-0002')).toEqual({ ok: false, message: '동기화 암호가 맞지 않아요' });
    expect(await d.sync.keys.changePassphrase(PASS, 'FAKE-sync-pass-0002')).toEqual({ ok: true, notes: ['동기화 암호를 바꿨어요'] });
    expect(d.sync.keys.view.remembered).toBe(true);
    expect(d.sync.keys.view.vault?.vaultRevision).toBe(2);
    d.sync.keys.forget();
    expect(await d.sync.keys.unlockVault(PASS)).toEqual({ ok: false, message: '동기화 암호가 맞지 않아요' });
    expect(await d.sync.keys.unlockVault('FAKE-sync-pass-0002')).toEqual({ ok: true, notes: [] });
  });

  it('받기 확정은 잠금 밖에서 기기 암호를 확인하고 틀리면 저장하지 않으며 같은 암호를 유지한다', async () => {
    const s = testServer();
    const sender = await on(s);
    let inLock = false;
    const d = await setup(s, { keyDebounceMs: 60_000, lock: async (fn) => {
      inLock = true;
      try { return await fn(); } finally { inLock = false; }
    } });
    const id = sender.app.meta.activeProfileId;
    d.app.switchProfile(id);
    const lockPass = 'FAKE-device-lock-0001';
    await d.app.setSecrets({ kis: KIS2 }, lockPass);
    expect(await d.sync.keys.unlockVault(PASS)).toEqual({ ok: true, notes: [] });
    expect(await d.sync.keys.prepareReceive(id)).toEqual({ ok: true, overwrite: ['kis'] });
    const verify = d.app.verifyPassphrase.bind(d.app);
    const verifySpy = vi.spyOn(d.app, 'verifyPassphrase').mockImplementation(async (pass) => {
      expect(inLock).toBe(false);
      return verify(pass);
    });
    const applySpy = vi.spyOn(d.app, 'applySyncedSecrets');
    expect(await d.sync.keys.commitReceive('FAKE-wrong-lock-0001')).toEqual({ ok: false, message: '이 기기 잠금 암호가 맞지 않아요' });
    expect(verifySpy).toHaveBeenCalledWith('FAKE-wrong-lock-0001');
    expect(applySpy).not.toHaveBeenCalled();
    expect(d.app.secrets?.kis).toEqual(KIS2);
    expect(await d.sync.keys.commitReceive(lockPass)).toEqual({ ok: true, notes: ['키를 받았어요'] });
    expect(applySpy).toHaveBeenCalledWith(id, { kis: KIS }, lockPass);
    expect(d.app.secrets?.kis).toEqual(KIS);
    expect(await d.sync.keys.commitReceive(lockPass)).toEqual({ ok: false, message: null, recheck: true });
    d.app.lock();
    await vi.waitFor(() => expect(d.sync.keys.view.remembered).toBe(false));
    await d.app.unlock(lockPass);
    expect(d.app.secrets?.kis).toEqual(KIS);
    expect(await d.app.verifyPassphrase('FAKE-wrong-lock-0001')).toBe(false);
  });

  it.each([
    [new SecretsChangedError(), '그사이 이 기기 키가 바뀌었어요. 다시 받아 주세요'],
    [new KeyLockedElsewhereError(), '다른 탭에서 키를 잠갔어요. 잠금 암호로 다시 받아 주세요'],
    [new StoredKeysNotRemovedError(), null],
  ] as const)('받기 저장 오류 %s를 보존하고 리비전을 올리지 않는다', async (error, message) => {
    const s = testServer();
    const sender = await on(s);
    const d = await setup(s);
    const id = sender.app.meta.activeProfileId;
    d.app.switchProfile(id);
    await d.sync.keys.unlockVault(PASS);
    expect(await d.sync.keys.prepareReceive(id)).toEqual({ ok: true, overwrite: [] });
    const before = await d.keyStore.state(id);
    vi.spyOn(d.app, 'applySyncedSecrets').mockRejectedValueOnce(error);
    expect(await d.sync.keys.commitReceive()).toEqual({ ok: false, message, ...(message === null ? { error } : {}) });
    expect(await d.keyStore.state(id)).toEqual(before);
    expect(d.app.secrets?.kis).toBeUndefined();
  });


  it('destroy 전에 시작한 비밀 변경 알림이 늦게 끝나도 키 타이머를 다시 걸지 않는다', async () => {
    const s = testServer();
    const d = await on(s, { keyDebounceMs: 60_000 });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const bump = d.keyStore.bumpSeq.bind(d.keyStore);
    const bumpSpy = vi.spyOn(d.keyStore, 'bumpSeq').mockImplementationOnce(async (...args) => {
      await bump(...args);
      await gate;
    });
    await d.app.setSecrets({ kis: KIS2 });
    expect(bumpSpy).toHaveBeenCalled();
    const setSpy = vi.spyOn(globalThis, 'setTimeout');
    try {
      d.sync.destroy();
      release();
      await vi.waitFor(() => expect(d.sync.keys.view.states[0]?.localSeq).toBeGreaterThan(0));
      expect(setSpy.mock.calls.some(([, ms]) => ms === 60_000)).toBe(false);
    } finally {
      release();
      setSpy.mockRestore();
    }
  });

  it('금고 풀기 KDF를 기다리는 동안 잊으면 늦게 끝난 요청이 마스터 키를 되살리지 않는다', async () => {
    const s = testServer();
    const d = await on(s);
    d.sync.keys.forget();
    const unlock = d.sync.keys.unlockVault(PASS);
    d.sync.keys.forget();
    await unlock;
    expect(d.sync.keys.view.remembered).toBe(false);
  });

  it('받기 잠금 암호 확인 중 취소하면 풀어 둔 키를 저장하지 않는다', async () => {
    const s = testServer();
    const sender = await on(s);
    const d = await setup(s);
    const id = sender.app.meta.activeProfileId;
    d.app.switchProfile(id);
    await d.app.setSecrets({ kis: KIS2 }, 'FAKE-device-lock-0001');
    await d.sync.keys.unlockVault(PASS);
    expect(await d.sync.keys.prepareReceive(id)).toEqual({ ok: true, overwrite: ['kis'] });
    let release!: (ok: boolean) => void;
    vi.spyOn(d.app, 'verifyPassphrase').mockImplementationOnce(() => new Promise<boolean>((resolve) => { release = resolve; }));
    const applySpy = vi.spyOn(d.app, 'applySyncedSecrets');
    const commit = d.sync.keys.commitReceive('FAKE-device-lock-0001');
    d.sync.keys.cancelReceive();
    release(true);
    expect(await commit).toMatchObject({ ok: false });
    expect(applySpy).not.toHaveBeenCalled();
    expect(d.app.secrets?.kis).toEqual(KIS2);
  });


  it('금고 풀기가 세션 철회를 확인해도 마스터 키를 잊고 로그아웃한다', async () => {
    const s = testServer();
    const d = await on(s);
    s.h.env.DB.raw.prepare('UPDATE sessions SET revoked_at = ?').run(s.h.clock.now);
    expect(await d.sync.keys.unlockVault(PASS)).toEqual({ ok: false, message: '로그인이 끝났어요. 다시 로그인해 주세요.' });
    expect(d.sync.keys.view.remembered).toBe(false);
    expect(d.sync.account).toBeNull();
  });

});
