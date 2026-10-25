// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, type App } from '../state/app.svelte';
import { createSafeStorage } from '../state/storage';
import { memoryBacking } from '../state/testStorage';
import { createMemoryOrderCache } from '../perf/orderCache';
import { groupSnapshot } from '../share/snapshot';
import { testServer, SYNC_BASE, type TestServer } from '../../../sync-worker/test/server';
import { ME } from '../../../sync-worker/test/harness';
import type { AuthClient } from './auth';
import { createSyncController, type SyncController } from './controller.svelte';
import { createMemorySyncStore, type SyncStore } from './store';

const CONFIG = { apiUrl: SYNC_BASE, firebase: { apiKey: 'k', authDomain: 'gazua-test.firebaseapp.com', projectId: 'gazua-test', appId: 'a' } };

function fakeAuth(s: TestServer, email = ME): AuthClient & { signedIn: boolean } {
  const a = {
    signedIn: false,
    ready: async () => (a.signedIn ? { uid: 'uid-me', email } : null),
    signIn: async () => {
      a.signedIn = true;
      return { user: { uid: 'uid-me', email }, idToken: await s.h.token({ email, sub: 'uid-me' }) };
    },
    redirectResult: async () => null,
    signOut: async () => {
      a.signedIn = false;
    },
    idToken: async () => (a.signedIn ? s.h.token({ email, sub: 'uid-me' }) : null),
  };
  return a;
}

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

async function setup(s: TestServer, opts: { auth?: AuthClient & { signedIn: boolean }; store?: SyncStore } = {}) {
  const storage = createSafeStorage(memoryBacking());
  const auth = opts.auth ?? fakeAuth(s);
  const store = opts.store ?? createMemorySyncStore();
  const sync = createSyncController({ config: CONFIG, storage, auth, store: async () => store, fetchImpl: s.fetch, now: () => s.h.clock.now, deviceLabel: () => '테스트' });
  const app: App = createApp({ storage, now: () => s.h.clock.now, orderCache: createMemoryOrderCache(), onSyncableChange: (e) => sync.onSyncableChange(e) });
  await sync.attach(app);
  cleanups.push(() => {
    sync.destroy();
    app.destroy();
  });
  return { sync, app, auth, store };
}

describe('SyncController', () => {
  it('설정이 없으면 아무것도 하지 않는다', async () => {
    const sync: SyncController = createSyncController({ config: null, storage: createSafeStorage(memoryBacking()) });
    expect(sync.configured).toBe(false);
    expect(sync.api).toBeNull();
  });

  it('로그인하면 기기 세션을 만들고, 켜면 동기화한다', async () => {
    const s = testServer();
    const { sync, app } = await setup(s);
    expect(sync.account).toBeNull();
    await sync.signIn('내 노트북');
    expect(sync.account).toEqual({ email: ME });
    expect(s.h.env.DB.raw.prepare('SELECT label FROM sessions').all()).toEqual([{ label: '내 노트북' }]);
    expect(await sync.preview()).toEqual({ upload: ['내 프로필'], download: 0 });
    await sync.setEnabled(true);
    expect(sync.status).toMatchObject({ enabled: true, phase: 'idle', pending: 0 });
    const remote = await sync.remoteProfiles();
    expect(remote?.map((r) => r.profileId)).toEqual([app.meta.activeProfileId]);
  });

  it('허용 목록 밖 계정은 세션 없이 로그아웃시킨다', async () => {
    const s = testServer();
    const auth = fakeAuth(s, 'stranger@example.test');
    const { sync } = await setup(s, { auth });
    await sync.signIn();
    expect(sync.account).toBeNull();
    expect(sync.error).toContain('허용 목록');
    expect(auth.signedIn).toBe(false);
  });

  it('다시 열면 저장된 세션으로 이어 가고, SDK에 로그인 상태가 없으면 세션을 버린다', async () => {
    const s = testServer();
    const store = createMemorySyncStore();
    const auth = fakeAuth(s);
    const first = await setup(s, { store, auth });
    await first.sync.signIn();
    const again = await setup(s, { store, auth });
    expect(again.sync.account).toEqual({ email: ME });
    auth.signedIn = false;
    const third = await setup(s, { store, auth });
    expect(third.sync.account).toBeNull();
    expect(await store.getMeta('session')).toBeUndefined();
  });

  it('오프라인이라 SDK를 불러오지 못해도 저장된 세션을 버리지 않는다', async () => {
    const s = testServer();
    const store = createMemorySyncStore();
    const auth = fakeAuth(s);
    await (await setup(s, { store, auth })).sync.signIn();
    const offline = { ...auth, ready: async () => Promise.reject(new TypeError('Failed to fetch dynamically imported module')) };
    const again = await setup(s, { store, auth: offline as typeof auth });
    expect(again.sync.account).toEqual({ email: ME });
    expect(await store.getMeta('session')).toBeTruthy();
  });

  it('다른 기기에서 철회되면 로그인 필요 상태로 돌아가고 안내한다', async () => {
    const s = testServer();
    const a = await setup(s);
    await a.sync.signIn();
    await a.sync.setEnabled(true);
    const b = await setup(s);
    await b.sync.signIn();
    expect(await b.sync.revokeSession('others')).toBe(true);
    await a.sync.syncNow();
    expect(a.sync.account).toBeNull();
    expect(a.sync.error).toContain('다시 로그인');
  });

  it('로그아웃하면 서버 세션도 철회한다', async () => {
    const s = testServer();
    const { sync, auth } = await setup(s);
    await sync.signIn();
    await sync.signOut();
    expect(sync.account).toBeNull();
    expect(auth.signedIn).toBe(false);
    expect(s.h.env.DB.raw.prepare('SELECT revoked_at IS NOT NULL AS r FROM sessions').all()).toEqual([{ r: 1 }]);
  });

  it('공유 링크는 capability를 fragment에 담고, 원본 프로필을 먼저 올린다', async () => {
    const s = testServer();
    const { sync, app } = await setup(s);
    await sync.signIn();
    await sync.setEnabled(true);
    app.setWatchlists({ groups: [{ id: 'g', name: '공유', items: [{ symbol: '005930', colorSlot: 1, hidden: false, addedAt: 1 }] }] });
    const made = await sync.createShare(app.meta.activeProfileId, 'group', groupSnapshot(app.watchlists.groups[0]), 7);
    expect(made?.url).toMatch(new RegExp(`^${location.origin}/#/s/[A-Za-z0-9_-]{43}$`));
    expect(s.requests.some((r) => r.path.includes('?') || /[A-Za-z0-9_-]{43}/.test(r.path))).toBe(false);
    expect((await sync.shares())?.length).toBe(1);
    expect(await sync.createShare(app.meta.activeProfileId, 'group', groupSnapshot(app.watchlists.groups[0]), 31)).toBeNull();
    expect(sync.error).toBeTruthy();
  });

  it('기기 목록·과거 버전·새 프로필로 복원', async () => {
    const s = testServer();
    const { sync, app } = await setup(s);
    await sync.signIn();
    await sync.setEnabled(true);
    expect((await sync.sessions())?.map((d) => d.current)).toEqual([true]);
    const revs = await sync.revisions(app.meta.activeProfileId);
    expect(revs?.map((r) => r.revision)).toEqual([1]);
    const id = await sync.restoreRevision(app.meta.activeProfileId, 1);
    expect(app.meta.profiles.find((p) => p.id === id)?.name).toBe('내 프로필 (복원)');
  });
});
