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
