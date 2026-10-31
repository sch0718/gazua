// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../state/app.svelte';
import { createSafeStorage } from '../state/storage';
import { memoryBacking } from '../state/testStorage';
import { createMemoryOrderCache } from '../perf/orderCache';
import { deviceApi, testServer, type TestServer } from '../../../sync-worker/test/server';
import { createSyncEngine, type SyncEngineDeps, type SyncPhase } from './engine';
import { appProfiles } from './local';
import { createMemorySyncStore } from './store';

async function device(keys: SyncEngineDeps['keys']) {
  const s = testServer();
  const storage = createSafeStorage(memoryBacking());
  const { api } = await deviceApi(s);
  const app = createApp({ storage, now: () => s.h.clock.now, orderCache: createMemoryOrderCache() });
  const engine = createSyncEngine({ local: appProfiles(app, storage), store: createMemorySyncStore(), api, now: () => s.h.clock.now, setTimer: () => 0, clearTimer: () => {}, keys });
  await engine.init();
  return { s, app, engine };
}
const calls = (s: TestServer, from = 0, to?: number) => s.requests.slice(from, to).map((r) => `${r.method} ${r.path}`);

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
    await d.engine.keysNow();
    expect(keys.step).toHaveBeenCalledTimes(2);
    expect(d.s.requests.length).toBe(before);
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
    const keys = { step: vi.fn(async (): Promise<SyncPhase> => (order.push('step'), 'idle')), reset: vi.fn(async () => {}) };
    const d = await device(keys);
    await d.engine.setEnabled(true);
    order.length = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const a = d.engine.exclusive(async () => {
      order.push('a1');
      await gate;
      order.push('a2');
      return 7;
    });
    const k = d.engine.keysNow();
    await Promise.resolve();
    release();
    expect(await a).toBe(7);
    await k;
    expect(order).toEqual(['a1', 'a2', 'step']);
  });
});
