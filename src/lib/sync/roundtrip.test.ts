// @vitest-environment jsdom
// 제안서 7절 1단계 「완료 기준」을 실제 앱(createApp)·동기화 엔진·sync-worker 핸들러(테스트용 D1)로 확인한다.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, type App } from '../state/app.svelte';
import { createSafeStorage, type SafeStorage } from '../state/storage';
import { memoryBacking } from '../state/testStorage';
import { createMemoryOrderCache } from '../perf/orderCache';
import { newStrategy } from '../sim/defaults';
import { groupSnapshot } from '../share/snapshot';
import { deviceApi, testServer, type TestServer } from '../../../sync-worker/test/server';
import { OTHER } from '../../../sync-worker/test/harness';
import { purge } from '../../../sync-worker/src/purge';
import type { SyncApi } from './api';
import { CONFLICT_COPY_SUFFIX, createSyncEngine, type SyncEngine } from './engine';
import { FORBIDDEN_KEYS } from './forbidden';
import { appProfiles } from './local';
import { createMemorySyncStore, openSyncStore, type SyncStore } from './store';

const NOW = Date.UTC(2026, 9, 25, 3);
const FAKE_SECRET = 'FAKE-TOSS-SECRET-424242';
const FAKE_PROXY_TOKEN = 'FAKE-PROXY-TOKEN-424242';

interface Device {
  app: App;
  storage: SafeStorage;
  engine: SyncEngine;
  store: SyncStore;
  api: SyncApi;
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
  location.hash = '';
});

async function device(server: TestServer, opts: { store?: SyncStore; storage?: SafeStorage; email?: string; sub?: string } = {}): Promise<Device> {
  const storage = opts.storage ?? createSafeStorage(memoryBacking());
  const store = opts.store ?? createMemorySyncStore();
  const { api } = await deviceApi(server, opts.email, opts.sub);
  let engine: SyncEngine | null = null;
  const app = createApp({
    storage,
    now: () => server.h.clock.now,
    orderCache: createMemoryOrderCache(),
    onSyncableChange: (e) => {
      if (e.kind === 'deleted') void engine?.profileDeleted(e.profileId);
      else engine?.profileChanged(e.profileId);
    },
  });
  engine = createSyncEngine({ local: appProfiles(app, storage), store, api, now: () => server.h.clock.now, setTimer: () => 0, clearTimer: () => {} });
  await engine.init();
  cleanups.push(() => {
    engine!.destroy();
    app.destroy();
  });
  return { app, storage, engine, store, api };
}

async function enabled(server: TestServer, opts: Parameters<typeof device>[1] = {}): Promise<Device> {
  const d = await device(server, opts);
  await d.engine.setEnabled(true);
  return d;
}

const profileNamed = (d: Device, name: string) => d.app.meta.profiles.find((p) => p.name === name);
const serverCount = (s: TestServer, table: string) => (s.h.env.DB.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

describe('1단계 완료 기준', () => {
  it('두 기기 왕복: A의 프로필이 B에 같은 ID로 오고, B의 수정이 A에 돌아온다', async () => {
    const s = testServer();
    const a = await enabled(s);
    a.app.renameProfile(a.app.meta.activeProfileId, '투자');
    a.app.setWatchlists({ groups: [...a.app.watchlists.groups, { id: 'g-semi', name: '반도체', items: [] }] });
    a.app.updateSettings({ metric: 'rsi', theme: 'dark' });
    await a.engine.flush();
    expect(a.engine.status()).toMatchObject({ phase: 'idle', pending: 0, conflicts: [] });

    const b = await enabled(s);
    const shared = profileNamed(b, '투자')!;
    expect(shared.id).toBe(a.app.meta.activeProfileId);
    expect(b.app.meta.profiles).toHaveLength(2); // B의 기본 프로필은 덮어쓰지 않았다
    b.app.switchProfile(shared.id);
    expect(b.app.watchlists.groups.map((g) => g.name)).toContain('반도체');
    expect(b.app.settings.metric).toBe('rsi');
    expect(b.app.settings.theme).toBe('system'); // 테마는 기기 설정이라 따라오지 않는다

    b.app.setStrategies([{ ...newStrategy(NOW, 'g-semi', 'B에서 만든 전략'), id: 's-b' }]);
    await b.engine.flush();
    await a.engine.syncNow();
    expect(a.app.strategies.map((x) => x.name)).toEqual(['B에서 만든 전략']); // 지금 프로필이라 화면 상태도 다시 읽었다
    // B의 기본 프로필도 A에 왔다
    expect(a.app.meta.profiles).toHaveLength(2);
  });

  it('오프라인 수정 후 재접속: 앱을 다시 열어도 outbox가 남아 있다가 올라간다', async () => {
    const s = testServer();
    const backing = memoryBacking();
    const storage = createSafeStorage(backing);
    const store1 = await openSyncStore('gazua-sync-offline');
    const a = await enabled(s, { store: store1, storage });
    s.online = false;
    a.app.setWatchlists({ groups: [...a.app.watchlists.groups, { id: 'g-off', name: '오프라인 그룹', items: [] }] });
    await a.engine.flush();
    expect(a.engine.status()).toMatchObject({ phase: 'offline', pending: 1 });
    a.engine.destroy();
    a.app.destroy();

    s.online = true;
    const reopened = await device(s, { store: await openSyncStore('gazua-sync-offline'), storage: createSafeStorage(backing) });
    expect(reopened.engine.status()).toMatchObject({ enabled: true, pending: 1 });
    await reopened.engine.syncNow();
    expect(reopened.engine.status()).toMatchObject({ phase: 'idle', pending: 0 });
    const b = await enabled(s);
    b.app.switchProfile(reopened.app.meta.activeProfileId);
    expect(b.app.watchlists.groups.map((g) => g.name)).toContain('오프라인 그룹');
  });

  it('앱 시작 때 마지막 확인 해시와 다르면 큐에 없던 변경도 올린다', async () => {
    const s = testServer();
    const backing = memoryBacking();
    const a = await enabled(s, { storage: createSafeStorage(backing), store: await openSyncStore('gazua-sync-recover') });
    const id = a.app.meta.activeProfileId;
    a.engine.destroy();
    // 엔진이 알기 전에 탭이 닫혔다: 저장소에는 바뀐 값이 있고 outbox는 비었다
    const st = createSafeStorage(backing);
    st.set(`p:${id}:watchlists`, { groups: [{ id: 'g-x', name: '닫히기 직전', items: [] }] });
    const again = await device(s, { storage: createSafeStorage(backing), store: await openSyncStore('gazua-sync-recover') });
    expect(again.engine.status().pending).toBe(0);
    await again.engine.syncNow();
    const r = await again.api.getProfile(id);
    expect(r.ok && r.data.doc.watchlists.groups[0].name).toBe('닫히기 직전');
  });

  it('동시 수정 충돌: 덮어쓰지 않고 충돌 사본을 남기며, 둘 다 남기기를 고를 수 있다', async () => {
    const s = testServer();
    const a = await enabled(s);
    const id = a.app.meta.activeProfileId;
    const b = await enabled(s);
    b.app.switchProfile(id);

    a.app.setWatchlists({ groups: [{ id: 'g1', name: 'A의 그룹', items: [] }] });
    await a.engine.flush();
    b.app.setWatchlists({ groups: [{ id: 'g1', name: 'B의 그룹', items: [] }] });
    await b.engine.flush();
    const c = b.engine.status().conflicts;
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ profileId: id, kind: 'edit' });
    // 아직 아무것도 덮어쓰지 않았다
    expect(b.app.watchlists.groups[0].name).toBe('B의 그룹');
    const server = await a.api.getProfile(id);
    expect(server.ok && server.data.doc.watchlists.groups[0].name).toBe('A의 그룹');

    await b.engine.resolve(id, 'keep-both');
    expect(b.engine.status().conflicts).toEqual([]);
    expect(b.app.watchlists.groups[0].name).toBe('A의 그룹');
    const copy = b.app.meta.profiles.find((p) => p.name.endsWith(CONFLICT_COPY_SUFFIX))!;
    expect(copy).toBeTruthy();
    expect(copy.id).not.toBe(id);
    b.app.switchProfile(copy.id);
    expect(b.app.watchlists.groups[0].name).toBe('B의 그룹');
    await b.engine.syncNow();
    await a.engine.syncNow();
    expect(a.app.meta.profiles.some((p) => p.id === copy.id)).toBe(true);
  });

  it('충돌에서 이 기기 것 유지·서버 것 받기', async () => {
    const s = testServer();
    const a = await enabled(s);
    const id = a.app.meta.activeProfileId;
    const b = await enabled(s);
    b.app.switchProfile(id);
    const clash = async (an: string, bn: string) => {
      a.app.setWatchlists({ groups: [{ id: 'g1', name: an, items: [] }] });
      await a.engine.flush();
      b.app.setWatchlists({ groups: [{ id: 'g1', name: bn, items: [] }] });
      await b.engine.flush();
      expect(b.engine.status().conflicts).toHaveLength(1);
    };
    await clash('A1', 'B1');
    await b.engine.resolve(id, 'keep-local');
    await a.engine.syncNow();
    expect(a.app.watchlists.groups[0].name).toBe('B1');
    await clash('A2', 'B2');
    await b.engine.resolve(id, 'take-remote');
    expect(b.app.watchlists.groups[0].name).toBe('A2');
    expect(b.engine.status()).toMatchObject({ conflicts: [], pending: 0 });
  });

  it('삭제 충돌: 지운 프로필을 늦은 수정이 되살리지 못하고, 사용자가 복구 또는 삭제를 고른다', async () => {
    const s = testServer();
    const a = await enabled(s);
    const keep = a.app.meta.activeProfileId;
    const extra = a.app.addProfile('지울 프로필');
    await a.engine.flush();
    const b = await enabled(s);
    b.app.switchProfile(extra.id);

    a.app.deleteProfile(extra.id);
    await a.engine.flush();
    expect(serverCount(s, 'profile_index WHERE deleted_at IS NOT NULL')).toBe(1);

    // B는 지워진 줄 모르고 고친다
    b.app.setWatchlists({ groups: [{ id: 'g1', name: '늦은 수정', items: [] }] });
    await b.engine.flush();
    expect(b.engine.status().conflicts[0]).toMatchObject({ profileId: extra.id, kind: 'deleted' });
    expect(serverCount(s, 'profile_index WHERE deleted_at IS NOT NULL')).toBe(1); // 되살아나지 않았다

    await b.engine.resolve(extra.id, 'restore');
    expect(serverCount(s, 'profile_index WHERE deleted_at IS NOT NULL')).toBe(0);
    await a.engine.syncNow();
    a.app.switchProfile(extra.id);
    expect(a.app.watchlists.groups[0].name).toBe('늦은 수정');
    void keep;
  });

  // Codex 리뷰(PR #39) 2차 2: 삭제 충돌을 고르기 전에 서버가 30일 정리로 지웠으면(404) 복구는 이 기기 것을 다시 올린다.
  it('서버에서 정리된 뒤 고른 복구는 이 기기의 프로필을 다시 올린다', async () => {
    const s = testServer();
    const a = await enabled(s);
    const extra = a.app.addProfile('오래 둔 것');
    await a.engine.flush();
    const b = await enabled(s);
    b.app.switchProfile(extra.id);
    a.app.deleteProfile(extra.id);
    await a.engine.flush();
    b.app.setWatchlists({ groups: [{ id: 'g1', name: '살릴 것', items: [] }] });
    await b.engine.flush();
    expect(b.engine.status().conflicts[0]).toMatchObject({ profileId: extra.id, kind: 'deleted' });
    // 정리 작업만 31일 뒤로 돌린다(기기 세션은 그대로 살아 있게)
    expect((await purge(s.h.env as never, s.h.clock.now + 31 * 24 * 3600 * 1000)).profiles).toBe(1);
    await b.engine.resolve(extra.id, 'restore');
    expect(b.engine.status()).toMatchObject({ conflicts: [], phase: 'idle' });
    const list = await b.api.listProfiles();
    expect(list.ok && list.data.profiles.find((r) => r.profileId === extra.id)?.deletedAt).toBeNull();
  });

  // Codex 리뷰(PR #39) 3차 3: 복구 기간이 지났지만 아직 정리 전(tombstone 남음)이면, 같은 ID로는 못 살리니 새 프로필로 남겨 올린다.
  it('복구 기간이 지난 삭제 충돌의 복구는 이 기기 것을 새 프로필로 올린다', async () => {
    const s = testServer();
    const a = await enabled(s);
    const extra = a.app.addProfile('기간 지남');
    await a.engine.flush();
    const b = await enabled(s);
    b.app.switchProfile(extra.id);
    a.app.deleteProfile(extra.id);
    await a.engine.flush();
    b.app.setWatchlists({ groups: [{ id: 'g1', name: '살릴 것', items: [] }] });
    await b.engine.flush();
    expect(b.engine.status().conflicts[0]).toMatchObject({ profileId: extra.id, kind: 'deleted' });
    s.h.env.DB.raw.prepare('UPDATE profile_index SET purge_at = ? WHERE profile_id = ?').run(s.h.clock.now - 1, extra.id);
    await b.engine.resolve(extra.id, 'restore');
    await b.engine.syncNow();
    expect(b.engine.status()).toMatchObject({ conflicts: [], phase: 'idle' });
    const copy = b.app.meta.profiles.find((p) => p.name === '기간 지남');
    expect(copy && copy.id).not.toBe(extra.id);
    b.app.switchProfile(copy!.id);
    expect(b.app.watchlists.groups[0].name).toBe('살릴 것');
    const list = await b.api.listProfiles();
    expect(list.ok && list.data.profiles.find((r) => r.profileId === copy!.id)?.deletedAt).toBeNull();
  });

  // Codex 리뷰(PR #39) 3차 1: 받는 중에 동기화를 끄면 이어서 보내지 않는다.
  it('받는 도중 동기화를 끄면 그 뒤로 보내지 않는다', async () => {
    const s = testServer();
    const a = await enabled(s);
    a.app.setWatchlists({ groups: [{ id: 'g', name: '보내면 안 됨', items: [] }] });
    const orig = a.api.listProfiles.bind(a.api);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    a.api.listProfiles = async () => {
      await gate;
      return orig();
    };
    const running = a.engine.syncNow();
    await new Promise((r) => setTimeout(r, 0));
    await a.engine.setEnabled(false);
    const before = s.requests.filter((r) => r.method === 'PUT').length;
    release();
    await running;
    expect(s.requests.filter((r) => r.method === 'PUT').length).toBe(before);
    expect(a.engine.status()).toMatchObject({ enabled: false, phase: 'off' });
  });

  // Codex 리뷰(PR #39) 4차 1: 응답을 잃은 업로드(A→B) 뒤 이 기기에서 A로 되돌린 변경을 서버의 B로 덮어쓰지 않는다.
  it('응답을 잃은 업로드 뒤 되돌린 변경을 지키고 서버로 올린다', async () => {
    const s = testServer();
    const a = await enabled(s);
    a.app.setWatchlists({ groups: [{ id: 'g', name: 'A', items: [] }] });
    await a.engine.flush();
    a.app.setWatchlists({ groups: [{ id: 'g', name: 'B', items: [] }] });
    s.dropNextResponse = true;
    await a.engine.flush();
    expect(a.engine.status()).toMatchObject({ phase: 'offline', pending: 1 });
    a.app.setWatchlists({ groups: [{ id: 'g', name: 'A', items: [] }] });
    await a.engine.syncNow();
    expect(a.app.watchlists.groups[0].name).toBe('A');
    expect(a.engine.status()).toMatchObject({ phase: 'idle', pending: 0, conflicts: [] });
    const got = await a.api.getProfile(a.app.meta.activeProfileId);
    expect(got.ok && got.data.doc.watchlists.groups[0].name).toBe('A');
  });

  // Codex 리뷰(PR #39) 4차 2: 여러 작업을 보내는 도중 다른 탭이 끄면 나머지는 보내지 않는다.
  it('여러 작업을 보내는 도중 다른 탭이 끄면 나머지는 보내지 않는다', async () => {
    const s = testServer();
    const a = await enabled(s);
    a.app.addProfile('둘째');
    a.app.addProfile('셋째');
    const orig = a.api.putProfile.bind(a.api);
    let puts = 0;
    a.api.putProfile = async (...args) => {
      puts++;
      const r = await orig(...args);
      await a.store.setMeta('enabled', false); // 첫 업로드가 끝날 즈음 다른 탭이 끈다
      return r;
    };
    await a.engine.flush();
    expect(puts).toBe(1);
  });

  // Codex 리뷰(PR #39) 5차 1: 원격 삭제를 적용하는 도중(비동기 대기 중) 이 기기에서 고친 내용은 지우지 않고 충돌로 남긴다.
  it('원격 삭제를 적용하는 도중 고친 프로필은 지우지 않고 충돌로 남긴다', async () => {
    const s = testServer();
    const a = await enabled(s);
    const extra = a.app.addProfile('겹친 수정');
    await a.engine.flush();
    const b = await enabled(s);
    b.app.switchProfile(extra.id);
    a.app.deleteProfile(extra.id);
    await a.engine.flush();
    const orig = b.store.ops.bind(b.store);
    let calls = 0;
    b.store.ops = async () => {
      calls++;
      if (calls === 2) b.app.setWatchlists({ groups: [{ id: 'g', name: '도중에 고침', items: [] }] });
      return orig();
    };
    await b.engine.pull();
    b.store.ops = orig;
    expect(b.app.meta.profiles.some((p) => p.id === extra.id)).toBe(true);
    expect(b.engine.status().conflicts[0]).toMatchObject({ profileId: extra.id, kind: 'deleted' });
  });

  // Codex 리뷰(PR #39) 5차 2: 응답을 잃은 업로드(B) 뒤 A로 되돌렸으면, B를 다시 보낸 뒤 A도 올린다(보내기만으로도).
  it('응답을 잃은 업로드 뒤 되돌린 변경은 보내기만 해도 뒤이어 올린다', async () => {
    const s = testServer();
    const a = await enabled(s);
    a.app.setWatchlists({ groups: [{ id: 'g', name: 'A', items: [] }] });
    await a.engine.flush();
    a.app.setWatchlists({ groups: [{ id: 'g', name: 'B', items: [] }] });
    s.dropNextResponse = true;
    await a.engine.flush();
    a.app.setWatchlists({ groups: [{ id: 'g', name: 'A', items: [] }] });
    await a.engine.flush(); // 한 번의 보내기로 B를 확인하고 A까지 올린다
    expect(a.engine.status()).toMatchObject({ phase: 'idle', pending: 0 });
    const got = await a.api.getProfile(a.app.meta.activeProfileId);
    expect(got.ok && got.data.doc.watchlists.groups[0].name).toBe('A');
  });

  // Codex 리뷰(PR #39) 6차: 동기화가 응답을 기다리는 동안 지우고 바로 닫아도, 다시 열면 지운 프로필이 되살아나지 않는다.
  it('동기화 대기 중에 지우고 닫아도 다시 열면 되살아나지 않는다', async () => {
    const s = testServer();
    const store = createMemorySyncStore();
    const storage = createSafeStorage(memoryBacking());
    const a = await enabled(s, { store, storage });
    const extra = a.app.addProfile('지우고 닫음');
    await a.engine.flush();
    a.api.listProfiles = () => new Promise(() => {}); // 응답이 오지 않는 받기(그 사이 탭을 닫는다)
    void a.engine.syncNow();
    await new Promise((r) => setTimeout(r, 0));
    a.app.deleteProfile(extra.id);
    await new Promise((r) => setTimeout(r, 0));
    a.engine.destroy();
    const again = await device(s, { store, storage });
    await again.engine.syncNow();
    expect(again.app.meta.profiles.some((p) => p.id === extra.id)).toBe(false);
    const list = await again.api.listProfiles();
    expect(list.ok && list.data.profiles.find((r) => r.profileId === extra.id)?.deletedAt).not.toBeNull();
  });

  // Codex 리뷰(PR #39) 8차 1: 응답을 잃은 업로드(A→B) 뒤 A로 되돌렸는데 다른 기기가 C로 바꿨으면, 덮어쓰지 않고 충돌로 남긴다.
  it('응답 잃은 업로드 뒤 되돌린 문서는 다른 기기의 새 변경과 충돌로 남긴다', async () => {
    const s = testServer();
    const a = await enabled(s);
    a.app.setWatchlists({ groups: [{ id: 'g', name: 'A', items: [] }] });
    await a.engine.flush();
    const b = await enabled(s);
    a.app.setWatchlists({ groups: [{ id: 'g', name: 'B', items: [] }] });
    s.dropNextResponse = true;
    await a.engine.flush();
    a.app.setWatchlists({ groups: [{ id: 'g', name: 'A', items: [] }] });
    await b.engine.syncNow();
    b.app.switchProfile(a.app.meta.activeProfileId);
    b.app.setWatchlists({ groups: [{ id: 'g', name: 'C', items: [] }] });
    await b.engine.flush();
    await a.engine.syncNow();
    expect(a.app.watchlists.groups[0].name).toBe('A');
    expect(a.engine.status().conflicts[0]).toMatchObject({ kind: 'edit' });
  });

  // Codex 리뷰(PR #39) 8차 2: 이 기기 저장소에 쓰지 못하면(메모리로만 반영) 확인 지점을 올리지 않는다. 다시 열었을 때 오래된 것을 올려 서버를 되돌리지 않게.
  it('로컬 저장이 실패하면 동기화를 멈추고, 다시 열어도 서버를 되돌리지 않는다', async () => {
    const s = testServer();
    const a = await enabled(s);
    const backing = memoryBacking();
    const store = createMemorySyncStore();
    const b = await enabled(s, { storage: createSafeStorage(backing), store });
    a.app.setWatchlists({ groups: [{ id: 'g', name: '서버 최신', items: [] }] });
    await a.engine.flush();
    const setItem = backing.setItem;
    backing.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    await b.engine.syncNow();
    expect(b.engine.status().phase).toBe('error');
    backing.setItem = setItem;
    const again = await device(s, { storage: createSafeStorage(backing), store });
    await again.engine.syncNow();
    const got = await again.api.getProfile(a.app.meta.activeProfileId);
    expect(got.ok && got.data.doc.watchlists.groups[0].name).toBe('서버 최신');
  });

  // Codex 리뷰(PR #39) 9차 1: 충돌 해결 중 이 기기 저장이 실패하면 해결을 완료로 치지 않는다(다시 열었을 때 고른 서버 것을 덮어쓰지 않게).
  it('충돌 해결 중 로컬 저장이 실패하면 충돌을 지우지 않고 멈춘다', async () => {
    const s = testServer();
    const a = await enabled(s);
    const backing = memoryBacking();
    const b = await enabled(s, { storage: createSafeStorage(backing) });
    b.app.switchProfile(a.app.meta.activeProfileId);
    a.app.setWatchlists({ groups: [{ id: 'g', name: 'A의 수정', items: [] }] });
    await a.engine.flush();
    b.app.setWatchlists({ groups: [{ id: 'g', name: 'B의 수정', items: [] }] });
    await b.engine.syncNow();
    expect(b.engine.status().conflicts[0]).toMatchObject({ kind: 'edit' });
    backing.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    await b.engine.resolve(a.app.meta.activeProfileId, 'take-remote');
    expect(b.engine.status().conflicts).toHaveLength(1);
    expect(b.engine.status().phase).toBe('error');
  });

  // Codex 리뷰(PR #39) 9차 2: 대기 작업의 시각이 같아도 올리기가 지우기보다 먼저 나간다.
  it.each([
    ['memory', async () => createMemorySyncStore()],
    ['IndexedDB', async () => openSyncStore(`order-${Math.random()}`)],
  ])('%s: 시각이 같으면 보낸 올리기 → 새 올리기 → 지우기 순서로 꺼낸다', async (_n, open) => {
    const store = await open();
    await store.putOp({ opId: 'zz-delete', profileId: 'p', kind: 'delete', createdAt: 5 });
    await store.putOp({ opId: 'mm-put', profileId: 'p', kind: 'put', createdAt: 5 });
    await store.putOp({ opId: 'aa-sent', profileId: 'p', kind: 'put', createdAt: 5, sentAt: 6, baseRevision: 0 });
    expect((await store.ops()).map((o) => o.opId)).toEqual(['aa-sent', 'mm-put', 'zz-delete']);
    await store.putOp({ opId: '00-delete', profileId: 'q', kind: 'delete', createdAt: 5 });
    await store.putOp({ opId: 'ff-put', profileId: 'q', kind: 'put', createdAt: 5 });
    const q = (await store.ops()).filter((o) => o.profileId === 'q').map((o) => o.opId);
    expect(q).toEqual(['ff-put', '00-delete']);
  });

  // Codex 리뷰(PR #39) 10차 1: 오프라인에서 B, C를 차례로 보내지 못한 뒤 B로 되돌리면, 묵은 C를 보내지 않는다.
  it('보내지 못한 C 뒤에 B로 되돌리면 서버는 B로 끝난다', async () => {
    const s = testServer();
    const a = await enabled(s);
    a.app.setWatchlists({ groups: [{ id: 'g', name: 'B', items: [] }] });
    s.online = false;
    await a.engine.flush();
    a.app.setWatchlists({ groups: [{ id: 'g', name: 'C', items: [] }] });
    await a.engine.flush();
    a.app.setWatchlists({ groups: [{ id: 'g', name: 'B', items: [] }] });
    await a.engine.flush();
    s.online = true;
    await a.engine.flush();
    expect(a.engine.status()).toMatchObject({ phase: 'idle', pending: 0 });
    const got = await a.api.getProfile(a.app.meta.activeProfileId);
    expect(got.ok && got.data.doc.watchlists.groups[0].name).toBe('B');
  });

  // Codex 리뷰(PR #39) 10차 2: 원격 삭제를 적용했는데 이 기기 저장에 실패하면 tombstone을 확인한 것으로 치지 않는다.
  it('원격 삭제를 이 기기에 저장하지 못하면 확인 지점을 올리지 않는다', async () => {
    const s = testServer();
    const a = await enabled(s);
    const extra = a.app.addProfile('지워질 것');
    await a.engine.flush();
    const backing = memoryBacking();
    const store = createMemorySyncStore();
    const b = await enabled(s, { storage: createSafeStorage(backing), store });
    a.app.deleteProfile(extra.id);
    await a.engine.flush();
    backing.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    await b.engine.syncNow();
    expect(b.engine.status().phase).toBe('error');
    expect((await store.state(extra.id))?.deleted).not.toBe(true);
  });

  // Codex 리뷰(PR #39) 2차 1: 다른 탭이 동기화를 끄면(같은 IndexedDB) 이 탭도 더 보내거나 받지 않는다.
  it('다른 탭이 동기화를 끄면 이 탭도 보내지 않는다', async () => {
    const s = testServer();
    const a = await enabled(s);
    await a.store.setMeta('enabled', false); // 다른 탭의 끄기
    const before = s.requests.length;
    a.app.setWatchlists({ groups: [{ id: 'g', name: '보내면 안 됨', items: [] }] });
    await a.engine.syncNow();
    expect(s.requests.length).toBe(before);
    expect(a.engine.status()).toMatchObject({ enabled: false, phase: 'off' });
  });

  it('바뀐 것이 없는 기기는 다른 기기의 삭제를 그대로 따르고, 고른 삭제는 서버 상태를 지킨다', async () => {
    const s = testServer();
    const a = await enabled(s);
    const extra = a.app.addProfile('함께 지울 것');
    await a.engine.flush();
    const b = await enabled(s);
    expect(profileNamed(b, '함께 지울 것')).toBeTruthy();
    a.app.deleteProfile(extra.id);
    await a.engine.flush();
    await b.engine.syncNow();
    expect(profileNamed(b, '함께 지울 것')).toBeUndefined();
    expect(b.engine.status().conflicts).toEqual([]);

    // 삭제 충돌에서 이 기기에서도 지우기
    const other = a.app.addProfile('두 번째');
    await a.engine.flush();
    await b.engine.syncNow();
    b.app.switchProfile(other.id);
    a.app.deleteProfile(other.id);
    await a.engine.flush();
    b.app.setWatchlists({ groups: [{ id: 'g', name: '수정', items: [] }] });
    await b.engine.syncNow();
    expect(b.engine.status().conflicts[0]).toMatchObject({ kind: 'deleted' });
    await b.engine.resolve(other.id, 'delete-local');
    expect(profileNamed(b, '두 번째')).toBeUndefined();
    expect(serverCount(s, 'profile_index WHERE deleted_at IS NOT NULL')).toBe(2);
  });

  it('재시도 중복 방지: 응답을 잃은 저장을 다시 보내도 리비전은 하나만 생긴다', async () => {
    const s = testServer();
    const a = await enabled(s);
    const before = serverCount(s, 'revisions');
    a.app.setWatchlists({ groups: [{ id: 'g', name: '한 번만', items: [] }] });
    s.dropNextResponse = true;
    await a.engine.flush();
    expect(a.engine.status()).toMatchObject({ phase: 'offline', pending: 1 });
    expect(serverCount(s, 'revisions')).toBe(before + 1); // 서버는 이미 처리했다
    await a.engine.flush();
    expect(a.engine.status()).toMatchObject({ phase: 'idle', pending: 0, conflicts: [] });
    expect(serverCount(s, 'revisions')).toBe(before + 1);
    const puts = s.requests.filter((r) => r.method === 'PUT');
    expect(puts.at(-1)).toEqual(puts.at(-2)); // 같은 경로로 한 번 더 보냈다
  });

  // Codex 리뷰(PR #39) 2: 첫 업로드의 응답을 잃은 뒤 그 프로필을 지우면, 서버에 만들어졌을 수 있는 것도 지운다(다음 받기에서 되살아나지 않게).
  it('응답을 잃은 첫 업로드 뒤 지운 프로필은 서버에서도 지우고 되살리지 않는다', async () => {
    const s = testServer();
    const a = await enabled(s);
    const id = a.app.addProfile('곧 지울 것').id;
    s.dropNextResponse = true;
    await a.engine.flush();
    expect(a.engine.status()).toMatchObject({ phase: 'offline', pending: 1 });
    a.app.deleteProfile(id);
    await a.engine.syncNow();
    await a.engine.syncNow();
    expect(a.app.meta.profiles.some((p) => p.id === id)).toBe(false);
    expect(a.engine.status()).toMatchObject({ phase: 'idle', pending: 0, conflicts: [] });
    const list = await a.api.listProfiles();
    expect(list.ok && list.data.profiles.find((r) => r.profileId === id)?.deletedAt).not.toBeNull();
  });

  it('계정 소유권: 다른 사용자는 내 프로필을 보지도 쓰지도 못한다', async () => {
    const s = testServer();
    const a = await enabled(s);
    const id = a.app.meta.activeProfileId;
    const other = await enabled(s, { email: OTHER, sub: 'uid-other' });
    expect(other.app.meta.profiles.some((p) => p.id === id)).toBe(false);
    expect((await other.api.getProfile(id)).ok).toBe(false);
    const r = await other.api.putProfile(id, { opId: crypto.randomUUID(), expectedRevision: 1, doc: appProfiles(a.app, a.storage).read(id) });
    expect(r.ok).toBe(false);
    const mine = await a.api.getProfile(id);
    expect(mine.ok && mine.data.revision).toBe(1);
  });

  it('키·계좌·토큰은 서버에 가지 않고, 주입하면 서버가 거절한다', async () => {
    const s = testServer();
    const storage = createSafeStorage(memoryBacking());
    const a = await device(s, { storage });
    const id = a.app.meta.activeProfileId;
    await a.app.setSecrets({ toss: { clientId: 'FAKE-TOSS-ID', clientSecret: FAKE_SECRET }, proxyToken: FAKE_PROXY_TOKEN });
    a.app.updateSettings({ proxyUrl: 'https://fake-proxy.example.test', provider: 'toss' });
    storage.set(`p:${id}:token:toss`, { accessToken: 'FAKE-ACCESS-424242', expiresAt: NOW + 1 });
    await a.engine.setEnabled(true);
    const dump = JSON.stringify(s.h.env.DB.raw.prepare('SELECT * FROM profiles').all()) + JSON.stringify(s.h.env.DB.raw.prepare('SELECT * FROM revisions').all());
    for (const secret of [FAKE_SECRET, FAKE_PROXY_TOKEN, 'FAKE-ACCESS-424242', 'fake-proxy.example.test', 'FAKE-TOSS-ID']) expect(dump).not.toContain(secret);
    const doc = appProfiles(a.app, storage).read(id);
    for (const key of FORBIDDEN_KEYS) {
      const r = await a.api.putProfile(id, { opId: crypto.randomUUID(), expectedRevision: 1, doc: { ...doc, [key]: 'FAKE' } as typeof doc });
      expect(r).toMatchObject({ ok: false, kind: 'invalid', code: 'forbidden-field' });
    }
    expect(serverCount(s, 'revisions')).toBe(1);
  });

  it('공유: 만료·철회되고, 스냅샷에 원본 ID·프로필 이름이 없다', async () => {
    const s = testServer();
    const a = await enabled(s);
    a.app.renameProfile(a.app.meta.activeProfileId, '아주 사적인 이름');
    a.app.setWatchlists({ groups: [{ id: crypto.randomUUID(), name: '공유 그룹', items: [{ symbol: '005930', colorSlot: 1, hidden: false, addedAt: 1 }] }] });
    await a.engine.flush();
    const snap = groupSnapshot(a.app.watchlists.groups[0]);
    const made = await a.api.createShare({ sourceProfileId: a.app.meta.activeProfileId, kind: 'group', snapshot: snap, ttlDays: 7 });
    if (!made.ok) throw new Error(made.kind);
    const read = await a.api.readShare(made.data.capability);
    expect(read.ok && read.data.snapshot).toEqual(snap);
    const json = JSON.stringify(read);
    expect(json).not.toContain('아주 사적인 이름');
    expect(json).not.toContain(a.app.watchlists.groups[0].id);
    expect(json).not.toContain(a.app.meta.activeProfileId);
    s.h.clock.now += 7 * 24 * 3600 * 1000;
    expect(await a.api.readShare(made.data.capability)).toMatchObject({ ok: false, kind: 'gone' });
    const second = await a.api.createShare({ sourceProfileId: a.app.meta.activeProfileId, kind: 'group', snapshot: snap, ttlDays: 30 });
    if (!second.ok) throw new Error(second.kind);
    await a.api.revokeShare(second.data.id);
    expect(await a.api.readShare(second.data.capability)).toMatchObject({ ok: false, kind: 'gone' });
    expect(await a.api.createShare({ sourceProfileId: a.app.meta.activeProfileId, kind: 'group', snapshot: snap, ttlDays: 31 })).toMatchObject({ ok: false, kind: 'invalid' });
  });

  it('백업을 새 로컬 프로필로 복원: 과거 리비전과 JSON 내보내기 파일 모두 새 UUID가 된다', async () => {
    const s = testServer();
    const a = await enabled(s);
    const id = a.app.meta.activeProfileId;
    a.app.setWatchlists({ groups: [{ id: 'g', name: '예전 그룹', items: [] }] });
    await a.engine.flush();
    a.app.setWatchlists({ groups: [{ id: 'g', name: '지금 그룹', items: [] }] });
    await a.engine.flush();
    const revs = await a.api.listRevisions(id);
    expect(revs.ok && revs.data.revisions.map((r) => r.revision)).toEqual([3, 2, 1]);
    const restored = await a.engine.restoreRevision(id, 2);
    if (!restored.ok) throw new Error(restored.kind);
    expect(restored.profileId).not.toBe(id);
    a.app.switchProfile(restored.profileId);
    expect(a.app.watchlists.groups[0].name).toBe('예전 그룹');
    expect(a.app.meta.profiles.find((p) => p.id === restored.profileId)!.name).toMatch(/ \(복원\)$/);
    // 원래 프로필은 그대로
    a.app.switchProfile(id);
    expect(a.app.watchlists.groups[0].name).toBe('지금 그룹');
    // JSON 백업 파일도 새 프로필로 가져온다(기존 경로 유지)
    const file = a.app.exportData(false);
    const imported = a.app.importData(file);
    expect(imported.ok && imported.profileId).not.toBe(id);
    await a.engine.flush();
    expect(serverCount(s, 'profile_index')).toBe(3);
  });

  it('세션이 철회되면 로그인 필요 상태가 되고 로컬 데이터는 그대로다', async () => {
    const s = testServer();
    const a = await enabled(s);
    const b = await enabled(s);
    const sessions = await b.api.listSessions();
    if (!sessions.ok) throw new Error('list');
    const aId = sessions.data.sessions.find((x) => !x.current)!.id;
    await b.api.revokeSession(aId);
    a.app.setWatchlists({ groups: [{ id: 'g', name: '로컬은 남는다', items: [] }] });
    await a.engine.flush();
    expect(a.engine.status()).toMatchObject({ phase: 'auth', pending: 1 });
    expect(a.app.watchlists.groups[0].name).toBe('로컬은 남는다');
  });
});
