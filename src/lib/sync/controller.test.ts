// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, type App } from '../state/app.svelte';
import { createSafeStorage } from '../state/storage';
import { memoryBacking } from '../state/testStorage';
import { createMemoryOrderCache } from '../perf/orderCache';
import { groupSnapshot } from '../share/snapshot';
import { testServer, SYNC_BASE, type TestServer } from '../../../sync-worker/test/server';
import { ME, OTHER } from '../../../sync-worker/test/harness';
import { transferableAbortController } from 'node:util';
import type { SocialProvider } from '@sch0718/firebase-session/client';
import type { SyncConfig } from './config';
import { SOCIAL_RETURN_KEY, type SocialReturn } from './social';
import { takeSocialCallback } from './socialFlow';
import type { AuthClient } from './auth';
import { createSyncController, describeFail, SHARE_TOO_LARGE_TEXT, type SyncController } from './controller.svelte';
import { createMemorySyncStore, type SyncStore } from './store';
import { SESSION_HEADER } from './api';

const CONFIG = { apiUrl: SYNC_BASE, social: null, firebase: { apiKey: 'k', authDomain: 'gazua-test.firebaseapp.com', projectId: 'gazua-test', appId: 'a' } };

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
    expect(sync.account).toEqual({ provider: 'google', id: ME, display: ME });
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
    expect(again.sync.account).toEqual({ provider: 'google', id: ME, display: ME });
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
    expect(again.sync.account).toEqual({ provider: 'google', id: ME, display: ME });
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

  it('100 KiB를 넘는 공유 스냅샷은 null과 공유 용량 초과 문구를 반환한다', async () => {
    const s = testServer();
    const { sync, app } = await setup(s);
    await sync.signIn();
    await sync.setEnabled(true);
    const snapshot = { ...groupSnapshot({ id: 'g', name: '공유', items: [] }), pad: 'a'.repeat(101 * 1024) };

    expect(await sync.createShare(app.meta.activeProfileId, 'group', snapshot, 7)).toBeNull();
    expect(sync.error).toBe(SHARE_TOO_LARGE_TEXT);
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

  // Codex 리뷰(PR #39) 1: 동기화 상태(켜짐·대기 작업·리비전)는 로그인한 계정에 묶인다.
  it('다른 계정으로 로그인하면 이전 계정의 동기화 상태를 버리고 다시 켜야 올린다', async () => {
    const s = testServer();
    const who = { email: ME, uid: 'uid-me' };
    const auth = {
      signedIn: false,
      ready: async () => (auth.signedIn ? { uid: who.uid, email: who.email } : null),
      signIn: async () => {
        auth.signedIn = true;
        return { user: { uid: who.uid, email: who.email }, idToken: await s.h.token({ email: who.email, sub: who.uid }) };
      },
      redirectResult: async () => null,
      signOut: async () => {
        auth.signedIn = false;
      },
      idToken: async () => (auth.signedIn ? s.h.token({ email: who.email, sub: who.uid }) : null),
    };
    const { sync, app } = await setup(s, { auth });
    await sync.signIn();
    await sync.setEnabled(true);
    app.addProfile('A 계정에서 만든 것');
    await sync.signOut();
    who.email = OTHER;
    who.uid = 'uid-other';
    await sync.signIn();
    expect(sync.account).toEqual({ provider: 'google', id: OTHER, display: OTHER });
    expect(sync.status).toMatchObject({ enabled: false, pending: 0 });
    expect(await sync.remoteProfiles()).toEqual([]);
  });

  // Codex 리뷰(PR #39) 6: 동기화를 켜지 않았으면 공유 원본이 서버에 없으니 먼저 켜 달라고 알린다.
  it('동기화가 꺼져 있으면 공유를 만들지 않고 켜 달라고 알린다', async () => {
    const s = testServer();
    const { sync, app } = await setup(s);
    await sync.signIn();
    app.setWatchlists({ groups: [{ id: 'g', name: '공유', items: [{ symbol: '005930', colorSlot: 1, hidden: false, addedAt: 1 }] }] });
    expect(await sync.createShare(app.meta.activeProfileId, 'group', groupSnapshot(app.watchlists.groups[0]), 7)).toBeNull();
    expect(sync.error).toContain('동기화를 켜');
    expect(s.requests.some((r) => r.path === '/v1/shares')).toBe(false);
  });

  // Codex 리뷰(PR #39) 2차 4: 리다이렉트 로그인을 시작한 적이 없으면 시작할 때 Firebase를 불러오지 않는다.
  it('리다이렉트 로그인을 시작한 적이 없으면 리다이렉트 결과를 읽지 않는다', async () => {
    const s = testServer();
    const auth = fakeAuth(s);
    let reads = 0;
    auth.redirectResult = async () => {
      reads++;
      return null;
    };
    const store = createMemorySyncStore();
    await setup(s, { auth, store });
    expect(reads).toBe(0);
    await store.setMeta('redirect-pending', true);
    await setup(s, { auth, store });
    expect(reads).toBe(1);
    expect(await store.getMeta('redirect-pending')).toBeUndefined();
  });

  // Codex 리뷰(PR #39) 5차 3: 동기화가 꺼진 채 다른 기기에서 철회되면, 관리 목록을 열 때도 로그아웃 상태로 돌아간다.
  it('관리 요청이 세션 철회로 실패하면 로그인 필요 상태로 돌아간다', async () => {
    const s = testServer();
    const a = await setup(s);
    await a.sync.signIn();
    const b = await setup(s);
    await b.sync.signIn();
    expect(await b.sync.revokeSession('others')).toBe(true);
    expect(await a.sync.sessions()).toBeNull();
    expect(a.sync.account).toBeNull();
    expect(a.sync.error).toContain('다시 로그인');
  });

  // Codex 리뷰(PR #39) 11차 2: 오래된 탭이 철회된 세션을 정리하면서 다른 탭이 새로 만든 세션을 지우지 않는다.
  it('오래된 탭의 로그아웃 정리가 다른 탭의 새 세션을 지우지 않는다', async () => {
    const s = testServer();
    const store = createMemorySyncStore();
    const auth = fakeAuth(s);
    const tab1 = await setup(s, { store, auth });
    await tab1.sync.signIn();
    const tab2 = await setup(s, { store, auth });
    expect(tab2.sync.account).toEqual({ provider: 'google', id: ME, display: ME });
    await tab1.sync.signOut();
    await tab1.sync.signIn();
    const fresh = await store.getMeta<{ id: string }>('session');
    expect(await tab2.sync.sessions()).toBeNull(); // 이 탭의 세션은 철회됐다
    expect(tab2.sync.account).toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect((await store.getMeta<{ id: string }>('session'))?.id).toBe(fresh?.id);
  });

  // Codex 리뷰(PR #39) 12차 1: 로그아웃 뒤 다시 로그인하는 사이 늦게 온 이전 세션의 철회 응답이 새 로그인을 지우지 않는다.
  it('늦게 온 이전 세션의 인증 실패는 새 세션을 지우지 않는다', async () => {
    const s = testServer();
    const store = createMemorySyncStore();
    const storage = createSafeStorage(memoryBacking());
    let release: (() => void) | null = null;
    let hold = false;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (hold) {
        hold = false;
        await new Promise<void>((r) => (release = r));
      }
      return s.fetch(input, init);
    }) as typeof fetch;
    const auth = fakeAuth(s);
    const sync = createSyncController({ config: CONFIG, storage, auth, store: async () => store, fetchImpl, now: () => s.h.clock.now, deviceLabel: () => '테스트' });
    const app: App = createApp({ storage, now: () => s.h.clock.now, orderCache: createMemoryOrderCache(), onSyncableChange: (e) => sync.onSyncableChange(e) });
    await sync.attach(app);
    cleanups.push(() => {
      sync.destroy();
      app.destroy();
    });
    await sync.signIn();
    await sync.setEnabled(true);
    hold = true;
    const late = sync.syncNow(); // 이 요청은 이전 세션으로 나가 늦게 돌아온다
    await new Promise((r) => setTimeout(r, 0));
    await sync.signOut();
    const again = sync.signIn(); // 새 세션을 만든 뒤 동기화는 앞 요청을 기다린다
    let fresh: { id: string } | undefined;
    while (!(fresh = await store.getMeta<{ id: string }>('session'))) await new Promise((r) => setTimeout(r, 0));
    release!();
    await late;
    await again;
    expect(sync.account).toEqual({ provider: 'google', id: ME, display: ME });
    expect((await store.getMeta<{ id: string }>('session'))?.id).toBe(fresh?.id);
  });
});

describe('describeFail', () => {
  it('too-large는 공유 요청이면 공유 문구, 프로필 동기화면 프로필 문구', () => {
    const f = { ok: false, kind: 'invalid', code: 'too-large' } as const;
    expect(describeFail(f, 'share')).toBe('공유 내용이 너무 커요(100 KB). 기간이나 종목을 줄여 주세요');
    expect(describeFail(f)).toBe('프로필이 너무 커요(256 KiB). 전략·그룹을 줄여 주세요.');
    expect(describeFail({ ok: false, kind: 'invalid', code: 'unsupported' }, 'share')).toBe('서버가 이 데이터를 받지 않았어요.');
  });
});

describe('카카오·네이버 로그인', () => {
  // 같은 프로세스의 Worker fetch는 Node Request와 같은 AbortSignal을 쓴다.
  beforeEach(() => vi.stubGlobal('AbortSignal', transferableAbortController().signal.constructor));
  afterEach(() => vi.unstubAllGlobals());
  const socialConfig: SyncConfig = { ...CONFIG, social: { kakao: { clientId: 'kakao-test-client' }, naver: { clientId: 'naver-test-client' } } };

  async function socialSetup(s: TestServer, o: { store?: SyncStore; config?: SyncConfig | null; auth?: AuthClient; socialStorage?: Storage; fetchImpl?: typeof fetch; socialTimeout?: number; notify?: (message: string) => void; reauthReadWait?: number; attach?: boolean; storeFactory?: () => Promise<SyncStore> } = {}) {
    const storage = createSafeStorage(memoryBacking());
    const socialStorage = o.socialStorage ?? memoryBacking();
    const store = o.store ?? createMemorySyncStore();
    const auth = o.auth ?? { ...fakeAuth(s), ready: vi.fn(async () => { throw new Error('Firebase를 부르면 안 돼요'); }), signOut: vi.fn(async () => {}), idToken: vi.fn(async () => { throw new Error('토큰을 부르면 안 돼요'); }) };
    const navigate = vi.fn();
    const received: Headers[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      received.push(new Headers(init?.headers));
      return (o.fetchImpl ?? s.fetch)(input, init);
    }) as typeof fetch;
    const sync = createSyncController({ socialTimeout: o.socialTimeout, notify: o.notify, reauthReadWait: o.reauthReadWait, config: o.config === undefined ? socialConfig : o.config, storage, auth, socialStorage, navigate, origin: 'https://app.example.test', random: (n) => crypto.getRandomValues(new Uint8Array(n)), store: o.storeFactory ?? (async () => store), fetchImpl, now: () => s.h.clock.now, deviceLabel: () => '기본 기기' });
    const app = createApp({ storage, now: () => s.h.clock.now, orderCache: createMemoryOrderCache(), onSyncableChange: (e) => sync.onSyncableChange(e) });
    if (o.attach !== false) await sync.attach(app);
    cleanups.push(() => { sync.destroy(); app.destroy(); });
    async function callback(provider: SocialProvider = 'kakao', sub = 'kakao-me', query?: string): Promise<SocialReturn> {
      await sync.signInWith(provider, ' 내 폰 ');
      const params = new URL(navigate.mock.lastCall![0]).searchParams;
      const { code } = s.h.fake.authorize(provider, params, sub);
      const href = `https://app.example.test/auth/callback/?${query ?? `code=${code}`}&state=${params.get('state')}`;
      const ret = takeSocialCallback({ location: { href, pathname: '/auth/callback/' }, history: { state: null, replaceState: vi.fn() }, storage: socialStorage, now: () => s.h.clock.now })!;
      expect(ret).not.toBeNull();
      return ret;
    }
    return { sync, app, store, auth, received, callback, navigate };
  }

  function heldFetch(s: TestServer) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let sessionId: string | undefined;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const social = String(input).endsWith('/session/social');
      if (social) await gate;
      const response = await s.fetch(input, init);
      if (social && response.ok) sessionId = (await response.clone().json()).sessionId;
      return response;
    }) as typeof fetch;
    return { fetchImpl, release, get sessionId() { return sessionId; } };
  }

  it('응답이 없으면 제한 시간 뒤 timeout으로 끝나고 busy를 풀어요', async () => {
    const s = testServer({ social: true });
    const held = heldFetch(s);
    const a = await socialSetup(s, { ...held, socialTimeout: 20 });
    const ret = await a.callback();
    vi.useFakeTimers();
    try {
      const done = vi.fn();
      const pending = a.sync.completeSocialSignIn(ret).then(done);
      await vi.advanceTimersByTimeAsync(20);
      expect(done).toHaveBeenCalledWith({ ok: false, provider: 'kakao', reason: 'timeout' });
      expect(a.sync.busy).toBe(false);
      await pending;
    } finally { vi.useRealTimers(); }
  });

  it('기다림을 버리면 곧바로 끝나고 타이머와 busy를 풀어요', async () => {
    const s = testServer({ social: true });
    const a = await socialSetup(s, heldFetch(s));
    const pending = a.sync.completeSocialSignIn(await a.callback());
    await vi.waitFor(() => expect(a.sync.busy).toBe(true), { interval: 1 });
    a.sync.abandonSocialSignIn();
    expect(await pending).toMatchObject({ ok: false, reason: 'timeout' });
    expect(a.sync.busy).toBe(false);
  });

  it.each(['timeout', 'abandon'] as const)('기다림을 끝낸 뒤 성공하면 세션을 보관하고 한 번 알려 줘요: %s', async (escape) => {
    const s = testServer({ social: true });
    const held = heldFetch(s);
    const notify = vi.fn();
    const a = await socialSetup(s, { ...held, notify, socialTimeout: 100 });
    const onLate = vi.fn();
    const pending = a.sync.completeSocialSignIn(await a.callback(), { onLate });
    await vi.waitFor(() => expect(a.sync.busy).toBe(true), { interval: 1 });
    if (escape === 'abandon') a.sync.abandonSocialSignIn();
    expect(await pending).toMatchObject({ reason: 'timeout' });
    held.release();
    await vi.waitFor(() => expect(notify).toHaveBeenCalledExactlyOnceWith('카카오 계정으로 로그인했어요'));
    expect(onLate).toHaveBeenCalledExactlyOnceWith({ ok: true, provider: 'kakao' });
    expect(a.sync.account?.id).toBe('kakao:kakao-me');
    const again = await socialSetup(s, { store: a.store });
    expect(again.sync.account).toEqual(a.sync.account);
    expect((await again.sync.sessions())?.[0]).toMatchObject({ current: true });
  });

  async function expectLateRevoked(s: TestServer, held: ReturnType<typeof heldFetch>) {
    await vi.waitFor(() => expect(s.h.env.DB.raw.prepare("SELECT revoked_at IS NOT NULL AS r FROM sessions WHERE identity = 'kakao:kakao-me'").all()).toEqual([{ r: 1 }]));
    const deletes = vi.mocked(held.fetchImpl).mock.calls.filter(([url, init]) => String(url).endsWith('/v1/session') && init?.method === 'DELETE');
    expect(deletes.some(([, init]) => {
      const headers = new Headers(init?.headers);
      return headers.get(SESSION_HEADER) === held.sessionId && !headers.has('Authorization');
    })).toBe(true);
  }

  it('기다림을 끝내고 로그아웃하면 늦은 성공을 철회하고 재인증을 유지해요', async () => {
    const s = testServer({ social: true });
    const held = heldFetch(s);
    const notify = vi.fn();
    const onLate = vi.fn();
    const a = await socialSetup(s, { ...held, notify });
    const pending = a.sync.completeSocialSignIn(await a.callback(), { onLate });
    a.sync.abandonSocialSignIn();
    await pending;
    await a.sync.signOut();
    held.release();
    await expectLateRevoked(s, held);
    expect(a.sync.account).toBeNull();
    expect(await a.store.getMeta('session')).toBeUndefined();
    expect(await a.store.getMeta('social-reauth')).toBe(true);
    expect(a.sync.error).toBeNull();
    expect(notify).not.toHaveBeenCalled();
    expect(onLate).not.toHaveBeenCalled();
    await a.sync.signInWith('kakao');
    expect(new URL(a.navigate.mock.lastCall![0]).searchParams.get('prompt')).toBe('login');
  });

  it('기다림을 끝내고 Google로 로그인하면 늦은 성공이 Google 세션을 건드리지 않아요', async () => {
    const s = testServer({ social: true });
    const held = heldFetch(s);
    const auth = fakeAuth(s);
    const signOut = vi.spyOn(auth, 'signOut');
    const notify = vi.fn();
    const onLate = vi.fn();
    const a = await socialSetup(s, { ...held, auth, notify });
    const pending = a.sync.completeSocialSignIn(await a.callback(), { onLate });
    a.sync.abandonSocialSignIn();
    await pending;
    await a.sync.signIn();
    const googleSession = await a.store.getMeta('session');
    held.release();
    await expectLateRevoked(s, held);
    expect(a.sync.account).toEqual({ provider: 'google', id: ME, display: ME });
    expect(await a.store.getMeta('session')).toEqual(googleSession);
    expect(await a.store.getMeta('owner')).toBe('uid-me');
    expect(await a.sync.remoteProfiles()).toEqual([]);
    expect((await a.sync.sessions())?.some((session) => session.current)).toBe(true);
    expect(signOut).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(onLate).not.toHaveBeenCalled();
    expect(a.sync.error).toBeNull();
  });

  it('늦은 accept가 이전 세션 철회를 기다릴 때 Google로 다시 로그인해도 새 세션을 지켜요', async () => {
    const s = testServer({ social: true });
    const held = heldFetch(s);
    const auth = fakeAuth(s);
    const signOut = vi.spyOn(auth, 'signOut');
    const notify = vi.fn();
    const onLate = vi.fn();
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const entering = new Promise<void>((resolve) => { entered = resolve; });
    let hold = false;
    const a = await socialSetup(s, { auth, notify, fetchImpl: async (input, init) => {
      const response = await held.fetchImpl(input, init);
      if (hold && init?.method === 'DELETE') {
        hold = false;
        entered();
        await gate;
      }
      return response;
    } });
    await a.sync.signIn();
    const pending = a.sync.completeSocialSignIn(await a.callback(), { onLate });
    a.sync.abandonSocialSignIn();
    await pending;
    hold = true;
    held.release();
    await entering;
    await a.sync.signIn();
    const fresh = await a.store.getMeta('session');
    release();
    await expectLateRevoked(s, held);
    expect(a.sync.account).toEqual({ provider: 'google', id: ME, display: ME });
    expect(await a.store.getMeta('session')).toEqual(fresh);
    expect(await a.store.getMeta('owner')).toBe('uid-me');
    expect(await a.sync.remoteProfiles()).toEqual([]);
    expect(signOut).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(onLate).not.toHaveBeenCalled();
    expect(a.sync.error).toBeNull();
  });

  it.each(['failure', 'exception'])('늦은 세션을 철회하지 못해도 새 로그아웃 상태를 지켜요: %s', async (failure) => {
    const s = testServer({ social: true });
    const held = heldFetch(s);
    const notify = vi.fn();
    const onLate = vi.fn();
    const a = await socialSetup(s, { ...held, notify });
    const revoke = vi.spyOn(a.sync.api!, 'endSessionById');
    if (failure === 'exception') revoke.mockRejectedValueOnce(new Error('철회 실패'));
    else revoke.mockResolvedValueOnce({ ok: false, kind: 'server', status: 500 });
    const pending = a.sync.completeSocialSignIn(await a.callback(), { onLate });
    a.sync.abandonSocialSignIn();
    await pending;
    await a.sync.signOut();
    held.release();
    await vi.waitFor(() => expect(revoke).toHaveBeenCalledExactlyOnceWith(held.sessionId));
    expect(a.sync.account).toBeNull();
    expect(await a.store.getMeta('social-reauth')).toBe(true);
    expect(a.sync.error).toBeNull();
    expect(notify).not.toHaveBeenCalled();
    expect(onLate).not.toHaveBeenCalled();
  });

  it.each(['stranger', 'server', 'exception'])('Google 팝업을 닫아도 오래된 실패는 오류와 알림을 남기지 않아요: %s', async (failure) => {
    const s = testServer({ social: true });
    const held = heldFetch(s);
    const auth = { ...fakeAuth(s), signIn: vi.fn(async () => null) };
    const notify = vi.fn();
    const onLate = vi.fn();
    let finished!: () => void;
    const completed = new Promise<void>((resolve) => { finished = resolve; });
    const a = await socialSetup(s, { auth, notify, fetchImpl: async (input, init) => {
      if (!String(input).endsWith('/session/social')) return held.fetchImpl(input, init);
      const response = await held.fetchImpl(input, init);
      finished();
      if (failure === 'exception') {
        Object.defineProperty(response, 'status', { get() { throw new Error('응답 처리 실패'); } });
      }
      return failure === 'server' ? new Response('{}', { status: 500 }) : response;
    } });
    const pending = a.sync.completeSocialSignIn(await a.callback('kakao', 'stranger'), { onLate });
    a.sync.abandonSocialSignIn();
    await pending;
    await a.sync.signIn();
    const error = a.sync.error;
    held.release();
    await completed;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(a.sync.error).toBe(error);
    expect(notify).not.toHaveBeenCalled();
    expect(onLate).not.toHaveBeenCalled();
  });

  it.each(['owner-read', 'owner-write', 'session-write', 'reauth-delete'] as const)('늦은 accept 중 로그아웃하면 세션과 재인증을 지켜요: %s', async (step) => {
    const s = testServer({ social: true });
    const held = heldFetch(s);
    const notify = vi.fn();
    const onLate = vi.fn();
    const a = await socialSetup(s, { ...held, notify });
    const pending = a.sync.completeSocialSignIn(await a.callback(), { onLate });
    a.sync.abandonSocialSignIn();
    await pending;
    let entered!: () => void;
    const entering = new Promise<void>((resolve) => { entered = resolve; });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let blocked = false;
    async function hold(key: string, operation: string) {
      if (blocked || step !== key + '-' + operation) return;
      blocked = true;
      entered();
      await gate;
    }
    const getMeta = a.store.getMeta.bind(a.store);
    const setMeta = a.store.setMeta.bind(a.store);
    const deleteMeta = a.store.deleteMeta.bind(a.store);
    vi.spyOn(a.store, 'getMeta').mockImplementation(async (key) => { await hold(key, 'read'); return getMeta(key); });
    vi.spyOn(a.store, 'setMeta').mockImplementation(async (key, value) => { await hold(key, 'write'); return setMeta(key, value); });
    vi.spyOn(a.store, 'deleteMeta').mockImplementation(async (key) => { await hold(key === 'social-reauth' ? 'reauth' : key, 'delete'); return deleteMeta(key); });
    held.release();
    await entering;
    await a.sync.signOut();
    release();
    await expectLateRevoked(s, held);
    expect(a.sync.account).toBeNull();
    expect(await a.store.getMeta('session')).toBeUndefined();
    expect(await a.store.getMeta('social-reauth')).toBe(true);
    expect(a.sync.error).toBeNull();
    expect(notify).not.toHaveBeenCalled();
    expect(onLate).not.toHaveBeenCalled();
    await a.sync.signInWith('kakao');
    expect(new URL(a.navigate.mock.lastCall![0]).searchParams.get('prompt')).toBe('login');
  });

  it.each(['timeout', 'abandon'] as const)('기다림을 끝낸 뒤 403이면 오류와 알림을 남겨요: %s', async (escape) => {
    const s = testServer({ social: true });
    const held = heldFetch(s);
    const notify = vi.fn();
    const a = await socialSetup(s, { ...held, notify, socialTimeout: 100 });
    const onLate = vi.fn();
    const pending = a.sync.completeSocialSignIn(await a.callback('kakao', 'stranger'), { onLate });
    await vi.waitFor(() => expect(a.sync.busy).toBe(true), { interval: 1 });
    if (escape === 'abandon') a.sync.abandonSocialSignIn();
    expect(await pending).toMatchObject({ reason: 'timeout' });
    held.release();
    await vi.waitFor(() => expect(notify).toHaveBeenCalledOnce());
    expect(a.sync.error).toContain('이 카카오 계정은 아직 허용 목록에 없어요');
    expect(notify).toHaveBeenCalledWith(a.sync.error);
    expect(onLate).toHaveBeenCalledExactlyOnceWith({ ok: false, provider: 'kakao', reason: 'not-allowed', account: 'kakao:stranger' });
    expect(a.sync.account).toBeNull();
  });

  it.each(['kakao-me', 'stranger'])('늦은 응답이 다른 작업의 busy를 풀지 않아요: %s', async (sub) => {
    const s = testServer({ social: true });
    const held = heldFetch(s);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const notify = vi.fn();
    const a = await socialSetup(s, { notify, auth: fakeAuth(s), fetchImpl: async (input, init) => {
      if (String(input).endsWith('/profiles')) await gate;
      return held.fetchImpl(input, init);
    } });
    await a.sync.signIn();
    const pending = a.sync.completeSocialSignIn(await a.callback('kakao', sub));
    await vi.waitFor(() => expect(a.sync.busy).toBe(true), { interval: 1 });
    a.sync.abandonSocialSignIn();
    await pending;
    const other = a.sync.remoteProfiles();
    expect(a.sync.busy).toBe(true);
    held.release();
    await vi.waitFor(() => expect(notify).toHaveBeenCalledOnce());
    expect(a.sync.busy).toBe(true);
    release();
    await other;
    expect(a.sync.busy).toBe(false);
  });

  it.each(['timeout', 'abandon'] as const)('앱 연결을 기다릴 때도 대기를 끝내고 늦은 성공을 알려 줘요: %s', async (escape) => {
    const s = testServer({ social: true });
    const first = await socialSetup(s);
    const ret = await first.callback();
    let release!: (store: SyncStore) => void;
    const gate = new Promise<SyncStore>((resolve) => { release = resolve; });
    const notify = vi.fn();
    const a = await socialSetup(s, { attach: false, storeFactory: () => gate, socialTimeout: 20, notify });
    const attaching = a.sync.attach(a.app);
    vi.useFakeTimers();
    try {
      const done = vi.fn();
      const pending = a.sync.completeSocialSignIn(ret).then(done);
      await vi.advanceTimersByTimeAsync(0);
      if (escape === 'abandon') a.sync.abandonSocialSignIn();
      await vi.advanceTimersByTimeAsync(20);
      expect(done).toHaveBeenCalledWith({ ok: false, provider: 'kakao', reason: 'timeout' });
      expect(a.sync.busy).toBe(false);
      expect(a.received).toHaveLength(0);
      await pending;
    } finally {
      vi.useRealTimers();
      release(a.store);
      await attaching;
    }
    await vi.waitFor(() => expect(notify).toHaveBeenCalledExactlyOnceWith('카카오 계정으로 로그인했어요'));
    expect(a.sync.account?.id).toBe('kakao:kakao-me');
  });

  it.each([undefined, '#/watchlist'])('로그인 복귀 화면은 전달한 값을 우선하고 없으면 현재 화면을 쓴다: %s', async (returnHash) => {
    const socialStorage = memoryBacking();
    const a = await socialSetup(testServer({ social: true }), { socialStorage });
    vi.stubGlobal('location', { hash: '#/groups' });
    await a.sync.signInWith('kakao', '내 폰', returnHash);
    expect(JSON.parse(socialStorage.getItem(SOCIAL_RETURN_KEY)!)).toMatchObject({ hash: returnHash ?? '#/groups', label: '내 폰' });
    expect(a.navigate).toHaveBeenCalledOnce();
  });

  it('로그인 화면 코드를 불러오지 못하면 저장소 안내 대신 연결 확인 안내를 보여요', async () => {
    const a = await socialSetup(testServer({ social: true }));
    vi.doMock('./socialFlow', () => { throw new Error('Failed to fetch dynamically imported module'); });
    try {
      await a.sync.signInWith('kakao');
    } finally {
      vi.doUnmock('./socialFlow');
    }
    expect(a.sync.error).toContain('로그인 화면을 불러오지 못했어요. 인터넷 연결을');
    expect(a.sync.error).not.toContain('저장소');
    expect(a.navigate).not.toHaveBeenCalled();
  });

  it('재인증 플래그를 읽지 못해도 안전하게 재인증으로 시작해요', async () => {
    const a = await socialSetup(testServer({ social: true }));
    const getMeta = a.store.getMeta.bind(a.store);
    vi.spyOn(a.store, 'getMeta').mockImplementation((key) => {
      if (key === 'social-reauth') return Promise.reject(new Error('저장소 읽기 실패'));
      return getMeta(key);
    });
    await a.sync.signInWith('kakao');
    expect(a.sync.error).toBeNull();
    expect(new URL(a.navigate.mock.lastCall![0]).searchParams.get('prompt')).toBe('login');
  });

  it('attach가 오래 걸리면 상한까지만 기다리고 재인증으로 시작해요', async () => {
    let release!: (store: SyncStore) => void;
    const gate = new Promise<SyncStore>((resolve) => { release = resolve; });
    const a = await socialSetup(testServer({ social: true }), { attach: false, storeFactory: () => gate, reauthReadWait: 20 });
    const attaching = a.sync.attach(a.app);
    vi.useFakeTimers();
    try {
      const pending = a.sync.signInWith('kakao');
      await vi.advanceTimersByTimeAsync(0);
      expect(a.navigate).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(20);
      await vi.waitFor(() => expect(a.navigate).toHaveBeenCalledOnce(), { timeout: 100, interval: 1 });
      await pending;
      expect(new URL(a.navigate.mock.lastCall![0]).searchParams.get('prompt')).toBe('login');
      expect(a.sync.error).toBeNull();
    } finally {
      vi.useRealTimers();
      release(a.store);
      await attaching;
    }
  });

  it.each([true, undefined])('attach 전에 시작해도 상한 안에 연결되면 저장된 플래그를 읽어요: %s', async (flag) => {
    let release!: (store: SyncStore) => void;
    const gate = new Promise<SyncStore>((resolve) => { release = resolve; });
    const a = await socialSetup(testServer({ social: true }), { attach: false, storeFactory: () => gate, reauthReadWait: 1000 });
    if (flag) await a.store.setMeta('social-reauth', flag);
    const attaching = a.sync.attach(a.app);
    vi.useFakeTimers();
    try {
      const pending = a.sync.signInWith('kakao');
      await vi.advanceTimersByTimeAsync(0);
      expect(a.navigate).not.toHaveBeenCalled();
      release(a.store);
      await attaching;
      await pending;
      expect(new URL(a.navigate.mock.lastCall![0]).searchParams.get('prompt')).toBe(flag ? 'login' : null);
      const timers = vi.getTimerCount();
      await vi.advanceTimersByTimeAsync(1000);
      expect(vi.getTimerCount()).toBe(timers);
    } finally {
      vi.useRealTimers();
      release(a.store);
      await attaching;
    }
  });

  it('메모리의 재인증 플래그가 있으면 attach를 기다리지 않아요', async () => {
    const a = await socialSetup(testServer({ social: true }), { attach: false, reauthReadWait: 1000 });
    await a.sync.signOut();
    vi.useFakeTimers();
    try {
      const pending = a.sync.signInWith('kakao');
      await vi.advanceTimersByTimeAsync(0);
      await vi.waitFor(() => expect(a.navigate).toHaveBeenCalledOnce(), { timeout: 100, interval: 1 });
      await pending;
      expect(new URL(a.navigate.mock.lastCall![0]).searchParams.get('prompt')).toBe('login');
    } finally { vi.useRealTimers(); }
  });

  it('로그아웃한 적 없으면 카카오 재인증을 요청하지 않는다', async () => {
    const a = await socialSetup(testServer({ social: true }));
    await a.sync.signInWith('kakao');
    expect(new URL(a.navigate.mock.lastCall![0]).searchParams.has('prompt')).toBe(false);
  });

  it('로그아웃 뒤에는 취소해도 카카오 재인증을 계속 요청하고 성공하면 지운다', async () => {
    const a = await socialSetup(testServer({ social: true }));
    await a.sync.completeSocialSignIn(await a.callback());
    await a.sync.signOut();
    const cancelled = await a.callback('kakao', 'kakao-me', 'error=access_denied');
    expect(new URL(a.navigate.mock.lastCall![0]).searchParams.get('prompt')).toBe('login');
    expect(await a.sync.completeSocialSignIn(cancelled)).toMatchObject({ reason: 'cancelled' });
    const ret = await a.callback();
    expect(new URL(a.navigate.mock.lastCall![0]).searchParams.get('prompt')).toBe('login');
    expect(await a.sync.completeSocialSignIn(ret)).toMatchObject({ ok: true });
    await a.sync.signInWith('kakao');
    expect(new URL(a.navigate.mock.lastCall![0]).searchParams.has('prompt')).toBe(false);
  });

  it('로그아웃하지 않아도 명시한 재인증을 요청한다', async () => {
    const a = await socialSetup(testServer({ social: true }));
    await a.sync.signInWith('kakao', '내 폰', '#/settings', { reauth: true });
    expect(new URL(a.navigate.mock.lastCall![0]).searchParams.get('prompt')).toBe('login');
  });

  it('같은 저장소로 컨트롤러를 다시 만들어도 재인증 요청이 남는다', async () => {
    const s = testServer({ social: true });
    const a = await socialSetup(s);
    await a.sync.completeSocialSignIn(await a.callback());
    await a.sync.signOut();
    const b = await socialSetup(s, { store: a.store });
    await b.sync.signInWith('kakao');
    expect(new URL(b.navigate.mock.lastCall![0]).searchParams.get('prompt')).toBe('login');
  });

  it.each([false, true])('Google 로그아웃이 실패해도 카카오 재인증을 요청한다 (컨트롤러 재생성: %s)', async (recreate) => {
    const s = testServer({ social: true });
    const auth = fakeAuth(s);
    const a = await socialSetup(s, { auth });
    await a.sync.signIn();
    expect(a.sync.account?.provider).toBe('google');
    auth.signOut = vi.fn(async () => { throw new Error('Google 로그아웃 실패'); });
    await a.sync.signOut();
    expect(auth.signOut).toHaveBeenCalledOnce();
    expect(a.sync.account).toBeNull();
    const next = recreate ? await socialSetup(s, { store: a.store }) : a;
    await next.sync.signInWith('kakao');
    expect(new URL(next.navigate.mock.lastCall![0]).searchParams.get('prompt')).toBe('login');
  });

  it('Google 로그인이 성공해도 로그아웃 뒤 재인증 요청을 지운다', async () => {
    const s = testServer({ social: true });
    const a = await socialSetup(s, { auth: fakeAuth(s) });
    await a.sync.signOut();
    await a.sync.signInWith('kakao');
    expect(new URL(a.navigate.mock.lastCall![0]).searchParams.get('prompt')).toBe('login');
    await a.sync.signIn();
    expect(a.sync.account?.provider).toBe('google');
    await a.sync.signInWith('kakao');
    expect(new URL(a.navigate.mock.lastCall![0]).searchParams.has('prompt')).toBe(false);
    const b = await socialSetup(s, { store: a.store, auth: a.auth });
    await b.sync.signInWith('kakao');
    expect(new URL(b.navigate.mock.lastCall![0]).searchParams.has('prompt')).toBe(false);
  });

  it('동기화 저장소가 없어도 메모리로 로그아웃 뒤 재인증을 기억한다', async () => {
    const navigate = vi.fn();
    const sync = createSyncController({ config: { ...socialConfig, firebase: null }, storage: createSafeStorage(memoryBacking()), socialStorage: memoryBacking(), navigate, origin: 'https://app.example.test' });
    cleanups.push(() => sync.destroy());
    await sync.signOut();
    await sync.signInWith('kakao');
    expect(new URL(navigate.mock.lastCall![0]).searchParams.get('prompt')).toBe('login');
  });

  it('카카오 로그인·동기화·복원·기기 목록·로그아웃은 Firebase 없이 세션만 쓴다', async () => {
    const s = testServer({ social: true });
    const a = await socialSetup(s);
    expect(await a.sync.completeSocialSignIn(await a.callback())).toEqual({ ok: true, provider: 'kakao' });
    expect(a.sync.account).toEqual({ provider: 'kakao', id: 'kakao:kakao-me', display: 'kakao-me@example.test' });
    expect(s.h.env.DB.raw.prepare('SELECT label FROM sessions').all()).toEqual([{ label: '내 폰' }]);
    await a.sync.setEnabled(true);
    expect((await a.sync.remoteProfiles())?.map((p) => p.profileId)).toContain(a.app.meta.activeProfileId);
    const b = await socialSetup(s, { store: a.store });
    expect(b.sync.account).toEqual(a.sync.account);
    expect(b.auth.ready).not.toHaveBeenCalled();
    expect((await b.sync.sessions())?.[0]).toMatchObject({ label: '내 폰', current: true });
    expect([...a.received, ...b.received].every((h) => !h.has('Authorization'))).toBe(true);
    await b.sync.signOut();
    expect(b.sync.account).toBeNull();
    expect(b.auth.signOut).not.toHaveBeenCalled();
    expect(s.h.env.DB.raw.prepare('SELECT revoked_at IS NOT NULL AS r FROM sessions').all()).toEqual([{ r: 1 }]);
    expect(JSON.stringify(await b.store.getMeta('session'))).toBeUndefined();
  });

  it('네이버는 이메일이 없으면 계정 ID를 보여 준다', async () => {
    const a = await socialSetup(testServer({ social: true }));
    expect(await a.sync.completeSocialSignIn(await a.callback('naver', 'naver-me'))).toEqual({ ok: true, provider: 'naver' });
    expect(a.sync.account).toEqual({ provider: 'naver', id: 'naver:naver-me', display: 'naver:naver-me' });
  });

  it.each([
    ['stranger', 'not-allowed', 'kakao:stranger'],
    ['error-503', 'limit', undefined],
    ['error-code', 'invalid-code', undefined],
    ['no-id-token', 'invalid-token', undefined],
  ] as const)('실패를 화면용 결과로 바꾼다: %s', async (sub, reason, account) => {
    const s = testServer({ social: true });
    const a = await socialSetup(s);
    const outcome = await a.sync.completeSocialSignIn(await a.callback('kakao', sub));
    expect(outcome).toMatchObject({ ok: false, provider: 'kakao', reason, ...(account && { account }) });
    expect(a.sync.account).toBeNull();
    expect(s.h.env.DB.raw.prepare('SELECT COUNT(*) AS n FROM sessions').all()).toEqual([{ n: 0 }]);
  });

  it('취소·대기 요청 없음·콜백 실패를 구분한다', async () => {
    const a = await socialSetup(testServer({ social: true }));
    expect(await a.sync.completeSocialSignIn(await a.callback('kakao', 'kakao-me', 'error=access_denied'))).toMatchObject({ reason: 'cancelled' });
    const ret: SocialReturn = { callback: null, hadParams: true, returnHash: '#/settings', label: '' };
    expect(await a.sync.completeSocialSignIn(ret)).toEqual({ ok: false, provider: null, reason: 'no-pending' });
    for (const [reason, mapped] of [['state-mismatch', 'mismatch'], ['redirect-mismatch', 'mismatch'], ['expired', 'expired'], ['provider-error', 'provider-error']] as const) {
      expect(await a.sync.completeSocialSignIn({ ...ret, callback: { ok: false, provider: 'naver', reason, error: 'invalid_request' } })).toMatchObject({ reason: mapped, provider: 'naver' });
    }
  });

  it('설정 없는 빌드는 대기 요청이 없어도 설정 안내를 먼저 한다', async () => {
    const a = await socialSetup(testServer({ social: true }), { config: null });
    expect(a.sync.providers).toEqual({ google: false, kakao: false, naver: false });
    expect(await a.sync.completeSocialSignIn({ callback: null, hadParams: true, returnHash: '#/settings', label: '' })).toEqual({ ok: false, provider: null, reason: 'not-configured' });
  });

  it('소셜 전용 빌드에서는 Google 로그인을 시작하지 않는다', async () => {
    const s = testServer({ social: true });
    const auth = fakeAuth(s);
    const a = await socialSetup(s, { config: { ...socialConfig, firebase: null }, auth });
    expect(a.sync.providers).toEqual({ google: false, kakao: true, naver: true });
    await a.sync.signIn();
    expect(auth.signedIn).toBe(false);
    expect(a.sync.account).toBeNull();
    expect(await a.sync.completeSocialSignIn(await a.callback())).toMatchObject({ ok: true });
  });

  it('다른 기기에서 철회하면 다음 요청에서 세션을 버린다', async () => {
    const s = testServer({ social: true });
    const a = await socialSetup(s);
    await a.sync.completeSocialSignIn(await a.callback());
    const b = await s.h.socialLogin('kakao', 'kakao-me');
    expect((await b.as('DELETE', '/v1/sessions?others=1')).status).toBe(200);
    expect(await a.sync.sessions()).toBeNull();
    expect(a.sync.account).toBeNull();
    expect(a.sync.error).toContain('다른 기기에서 철회');
  });

  it('허용 목록에서 빠지면 카카오 계정 안내를 하고 Firebase에는 손대지 않는다', async () => {
    const s = testServer({ social: true });
    const a = await socialSetup(s);
    await a.sync.completeSocialSignIn(await a.callback());
    s.h.env.ALLOWED_ACCOUNTS = 'naver:naver-me';
    expect(await a.sync.sessions()).toBeNull();
    expect(a.sync.account).toBeNull();
    expect(a.sync.error).toBe('이 카카오 계정은 허용 목록에 없어요.');
    expect(a.auth.signOut).not.toHaveBeenCalled();
  });

  it('저장소 오류는 로그인 시작 안내로 바꾼다', async () => {
    const storage = memoryBacking();
    storage.setItem = () => { throw new Error('저장 불가'); };
    const a = await socialSetup(testServer({ social: true }), { socialStorage: storage });
    await a.sync.signInWith('kakao');
    expect(a.sync.error).toContain('이 브라우저에서는 로그인을 시작할 수 없어요');
    expect(a.navigate).not.toHaveBeenCalled();
  });

  it.each(['offline', 'not-enabled', 'bad-request', 'server'] as const)('서버 요청 실패를 구분한다: %s', async (reason) => {
    const s = testServer({ social: true });
    const a = await socialSetup(s);
    const ret = await a.callback();
    if (reason === 'offline') s.online = false;
    if (reason === 'not-enabled') {
      delete s.h.env.KAKAO_CLIENT_ID;
      delete s.h.env.NAVER_CLIENT_ID;
    }
    if (reason === 'bad-request') s.h.env.SOCIAL_REDIRECT_URIS = '';
    if (reason === 'server') s.fetch = async () => Response.json({ error: 'server' }, { status: 500 });
    expect(await a.sync.completeSocialSignIn(ret)).toEqual({ ok: false, provider: 'kakao', reason });
  });

  it('빌드에서 꺼진 공급자는 콜백도 새 로그인도 거절한다', async () => {
    const a = await socialSetup(testServer({ social: true }), { config: { ...socialConfig, social: { naver: { clientId: 'naver-test-client' } } } });
    await a.sync.signInWith('kakao');
    expect(a.navigate).not.toHaveBeenCalled();
    expect(a.sync.error).toContain('이 빌드에는 카카오');
    expect(await a.sync.completeSocialSignIn({ callback: { ok: false, provider: 'kakao', reason: 'cancelled' }, hadParams: true, returnHash: '#/settings', label: '' })).toEqual({ ok: false, provider: 'kakao', reason: 'not-configured' });
  });

  it('Google에서 소셜로 바꾸면 이전 세션을 철회하고 동기화 상태를 초기화한다', async () => {
    const s = testServer({ social: true });
    const auth = fakeAuth(s);
    const a = await socialSetup(s, { auth });
    await a.sync.signIn('이전 Google');
    await a.sync.setEnabled(true);
    expect(auth.signedIn).toBe(true);
    expect(await a.sync.completeSocialSignIn(await a.callback())).toMatchObject({ ok: true });
    expect(auth.signedIn).toBe(false);
    expect(a.sync.status).toMatchObject({ enabled: false, pending: 0 });
    expect(await a.store.getMeta('owner')).toBe('kakao:kakao-me');
    expect(s.h.env.DB.raw.prepare('SELECT label, revoked_at IS NOT NULL AS r FROM sessions ORDER BY label').all()).toEqual([{ label: '내 폰', r: 0 }, { label: '이전 Google', r: 1 }]);
    const meta = await a.store.getMeta('session');
    expect(meta).toMatchObject({ email: '', provider: 'kakao', account: 'kakao:kakao-me' });
    expect(Object.keys(meta!)).not.toContain('code');
    expect(Object.keys(meta!)).not.toContain('codeVerifier');
  });

  it('같은 소셜 계정으로 다시 로그인하면 켜 둔 동기화를 이어 간다', async () => {
    const s = testServer({ social: true });
    const a = await socialSetup(s);
    await a.sync.completeSocialSignIn(await a.callback());
    await a.sync.setEnabled(true);
    expect(await a.sync.completeSocialSignIn(await a.callback())).toMatchObject({ ok: true });
    expect(a.sync.status).toMatchObject({ enabled: true, phase: 'idle' });
    expect(a.auth.signOut).not.toHaveBeenCalled();
    expect((await a.sync.sessions())?.filter((d) => d.current)).toHaveLength(1);
  });

  it('콜백 완료는 앱 연결이 끝날 때까지 기다린다', async () => {
    const storage = createSafeStorage(memoryBacking());
    const sync = createSyncController({ config: null, storage });
    const app = createApp({ storage, now: () => Date.now(), orderCache: createMemoryOrderCache() });
    cleanups.push(() => { sync.destroy(); app.destroy(); });
    let completed = false;
    const result = sync.completeSocialSignIn({ callback: null, hadParams: true, returnHash: '#/settings', label: '' }).then((r) => { completed = true; return r; });
    await Promise.resolve();
    expect(completed).toBe(false);
    await sync.attach(app);
    expect(await result).toMatchObject({ reason: 'not-configured' });
  });
});

