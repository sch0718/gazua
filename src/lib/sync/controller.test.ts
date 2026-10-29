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
import type { SocialReturn } from './social';
import { takeSocialCallback } from './socialFlow';
import type { AuthClient } from './auth';
import { createSyncController, type SyncController } from './controller.svelte';
import { createMemorySyncStore, type SyncStore } from './store';

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

describe('카카오·네이버 로그인', () => {
  // 같은 프로세스의 Worker fetch는 Node Request와 같은 AbortSignal을 쓴다.
  beforeEach(() => vi.stubGlobal('AbortSignal', transferableAbortController().signal.constructor));
  afterEach(() => vi.unstubAllGlobals());
  const socialConfig: SyncConfig = { ...CONFIG, social: { kakao: { clientId: 'kakao-test-client' }, naver: { clientId: 'naver-test-client' } } };

  async function socialSetup(s: TestServer, o: { store?: SyncStore; config?: SyncConfig | null; auth?: AuthClient; socialStorage?: Storage } = {}) {
    const storage = createSafeStorage(memoryBacking());
    const socialStorage = o.socialStorage ?? memoryBacking();
    const store = o.store ?? createMemorySyncStore();
    const auth = o.auth ?? { ...fakeAuth(s), ready: vi.fn(async () => { throw new Error('Firebase를 부르면 안 돼요'); }), signOut: vi.fn(async () => {}), idToken: vi.fn(async () => { throw new Error('토큰을 부르면 안 돼요'); }) };
    const navigate = vi.fn();
    const received: Headers[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      received.push(new Headers(init?.headers));
      return s.fetch(input, init);
    }) as typeof fetch;
    const sync = createSyncController({ config: o.config === undefined ? socialConfig : o.config, storage, auth, socialStorage, navigate, origin: 'https://app.example.test', random: (n) => crypto.getRandomValues(new Uint8Array(n)), store: async () => store, fetchImpl, now: () => s.h.clock.now, deviceLabel: () => '기본 기기' });
    const app = createApp({ storage, now: () => s.h.clock.now, orderCache: createMemoryOrderCache(), onSyncableChange: (e) => sync.onSyncableChange(e) });
    await sync.attach(app);
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

