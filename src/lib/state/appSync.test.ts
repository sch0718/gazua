// @vitest-environment jsdom
// 앱의 동기화 연결부: 변경 알림, 같은 ID 적용·삭제, 다른 탭 쓰기 반영, 공유 화면의 관문 우회.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryOrderCache } from '../perf/orderCache';
import { newStrategy } from '../sim/defaults';
import { buildProfileDoc } from '../sync/profileDoc';
import { createApp, type App } from './app.svelte';
import { lockSecrets } from './secrets';
import { createSafeStorage, STORAGE_PREFIX } from './storage';
import { memoryBacking, seed } from './testStorage';

const NOW = Date.UTC(2026, 9, 25, 3);
const CAP = 'c'.repeat(43);
let apps: App[] = [];
let events: { kind: string; profileId: string }[] = [];

function make(backing = memoryBacking()) {
  const storage = createSafeStorage(backing);
  const app = createApp({ storage, now: () => NOW, orderCache: createMemoryOrderCache(), onSyncableChange: (e) => events.push(e) });
  apps.push(app);
  return { app, storage, backing };
}

beforeEach(() => {
  location.hash = '';
  events = [];
});
afterEach(() => {
  for (const a of apps) a.destroy();
  apps = [];
});

describe('동기화 변경 알림', () => {
  it('동기화 대상만 알리고 기기 설정·최근 종목은 알리지 않는다', () => {
    const { app } = make();
    const id = app.meta.activeProfileId;
    app.updateSettings({ theme: 'dark', provider: 'toss' });
    app.addRecent('005930');
    expect(events).toEqual([]);
    app.updateSettings({ metric: 'rsi' });
    app.setWatchlists({ groups: [{ id: 'g', name: 'x', items: [] }] });
    app.setStrategies([{ ...newStrategy(NOW, null), id: 's' }]);
    app.setCriteria([]);
    app.setBaskets([]);
    app.renameProfile(id, '새 이름');
    expect(events).toEqual(Array(6).fill({ kind: 'changed', profileId: id }));
  });

  it('프로필 추가·가져오기·삭제를 알린다', () => {
    const { app } = make();
    const p = app.addProfile('둘째');
    const res = app.importData(app.exportData(false));
    app.deleteProfile(p.id);
    expect(events).toEqual([
      { kind: 'changed', profileId: p.id },
      { kind: 'changed', profileId: res.ok ? res.profileId : '' },
      { kind: 'deleted', profileId: p.id },
    ]);
  });
});

describe('같은 ID 적용·삭제', () => {
  it('원격 문서를 같은 ID에 쓰고 지금 프로필이면 화면 상태를 다시 읽는다(알림 없음)', () => {
    const { app, storage } = make();
    const id = app.meta.activeProfileId;
    app.updateSettings({ theme: 'dark', proxyUrl: 'https://fake-proxy.example.test' });
    events = [];
    const doc = buildProfileDoc(storage, id, '원격 이름');
    doc.watchlists = { groups: [{ id: 'g-r', name: '원격 그룹', items: [] }] };
    doc.settings.metric = 'mcap';
    app.applySyncedProfile(id, doc);
    expect(events).toEqual([]);
    expect(app.watchlists.groups[0].name).toBe('원격 그룹');
    expect(app.settings).toMatchObject({ metric: 'mcap', theme: 'dark', proxyUrl: 'https://fake-proxy.example.test' });
    expect(app.meta.profiles.find((p) => p.id === id)!.name).toBe('원격 이름');
  });

  it('없는 ID면 목록에 더한다', () => {
    const { app, storage } = make();
    const doc = buildProfileDoc(storage, app.meta.activeProfileId, '다른 기기');
    app.applySyncedProfile('remote-1', doc);
    expect(app.meta.profiles.map((p) => p.id)).toContain('remote-1');
    expect(app.meta.activeProfileId).not.toBe('remote-1');
  });

  it('원격 삭제는 알리지 않고, 마지막 프로필이면 빈 기본 프로필을 먼저 만든다', () => {
    const { app } = make();
    const only = app.meta.activeProfileId;
    app.removeSyncedProfile(only);
    expect(app.meta.profiles).toHaveLength(1);
    expect(app.meta.profiles[0].id).not.toBe(only);
    expect(app.meta.activeProfileId).toBe(app.meta.profiles[0].id);
    expect(events).toEqual([{ kind: 'changed', profileId: app.meta.profiles[0].id }]);
    app.removeSyncedProfile('none'); // 없는 ID는 무시
  });
});

describe('다른 탭의 쓰기', () => {
  it('이 프로필의 동기화 대상 키가 바뀌면 다시 읽는다', () => {
    const { app, backing } = make();
    const id = app.meta.activeProfileId;
    const key = `p:${id}:watchlists`;
    seed(backing, key, { groups: [{ id: 'g2', name: '다른 탭', items: [] }] });
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_PREFIX + key }));
    expect(app.watchlists.groups[0].name).toBe('다른 탭');
  });
});

describe('공유 화면', () => {
  it('프로필 선택·잠금 해제·온보딩 관문을 거치지 않는다', async () => {
    const backing = memoryBacking();
    seed(backing, 'meta', {
      schemaVersion: 1,
      activeProfileId: 'p1',
      profiles: [
        { id: 'p1', name: 'a', createdAt: 1 },
        { id: 'p2', name: 'b', createdAt: 2 },
      ],
    });
    seed(backing, 'p:p1:settings', { keyLock: true, onboarded: false });
    seed(backing, 'p:p1:secrets', await lockSecrets({ proxyToken: 'FAKE' }, 'pw'));
    location.hash = `#/s/${CAP}`;
    const { app } = make(backing);
    expect(app.route).toEqual({ name: 'shared', capability: CAP });
    app.navigate({ name: 'compare' });
    expect(app.route.name).toBe('profiles');
  });

  it('해시가 공유 링크로 바뀌면 그 화면으로 간다', () => {
    const { app } = make();
    location.hash = `#/s/${CAP}`;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(app.route).toEqual({ name: 'shared', capability: CAP });
  });
});
