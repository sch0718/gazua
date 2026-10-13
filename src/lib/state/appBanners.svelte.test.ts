// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import price005930 from '../providers/fixtures/kis/inquire-price-005930.json';
import tokenFixture from '../providers/fixtures/kis/token.json';
import { kstEpoch } from '../time/kst';
import { STORAGE_BANNER, createApp, type App } from './app.svelte';
import type { Meta } from './schema';
import { lockSecrets, type Secrets } from './secrets';
import { createSafeStorage } from './storage';
import { memoryBacking, seed } from './testStorage';

const NOW = kstEpoch('2026-10-12', '17:42:00');
const SECRETS: Secrets = {
  kis: { appKey: 'PSkisAppKey-0123456789', appSecret: 'kisSecret/ABCDEFGHIJKLMNOP' },
  proxyToken: 'proxy-token-xyz-424242',
};
const META_ONE: Meta = {
  schemaVersion: 1,
  activeProfileId: 'p1',
  profiles: [{ id: 'p1', name: '내 프로필', createdAt: 1 }],
};

function fakeKisFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes('/oauth2/tokenP') ? tokenFixture : price005930;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
}

/** key 조각이 들어간 키만 setItem이 용량 초과로 실패하는 저장소. */
function failingFor(part: string) {
  const backing = memoryBacking();
  const ctl = { armed: false };
  const setItem = backing.setItem.bind(backing);
  backing.setItem = (k: string, v: string) => {
    if (ctl.armed && k.includes(part)) throw new DOMException('quota', 'QuotaExceededError');
    setItem(k, v);
  };
  return { backing, ctl };
}

let apps: App[] = [];
let stopEffect: (() => void) | null = null;
beforeEach(() => {
  location.hash = '';
});
afterEach(() => {
  stopEffect?.();
  stopEffect = null;
  for (const a of apps) a.destroy();
  apps = [];
});

/** app.banners를 $effect로 관찰해 바뀔 때마다 기록한다. */
function observeBanners(app: App): string[][] {
  const seen: string[][] = [];
  stopEffect = $effect.root(() => {
    $effect(() => {
      seen.push(app.banners.map((b) => b.id));
    });
  });
  flushSync();
  return seen;
}

describe('createApp — storage banner is reactive to token-related writes', () => {
  it('a failed tokenIssuedAt write (locked profile) raises the storage banner reactively', async () => {
    const { backing, ctl } = failingFor(':tokenIssuedAt:');
    seed(backing, 'meta', META_ONE);
    seed(backing, 'p:p1:settings', { onboarded: true, provider: 'kis', proxyUrl: 'https://proxy.test', keyLock: true });
    seed(backing, 'p:p1:secrets', await lockSecrets(SECRETS, 'correct horse'));
    const storage = createSafeStorage(backing);
    const app = createApp({ storage, now: () => NOW, fetchImpl: fakeKisFetch() });
    apps.push(app);
    await app.unlock('correct horse');
    const seen = observeBanners(app);
    expect(seen.at(-1)).not.toContain('storage');

    ctl.armed = true;
    await app.provider.getQuotes(['005930'], 'KRX');
    flushSync();
    // 저장소는 실제로 저장 불가 상태가 되었다. 배너가 반응형으로 따라와야 한다.
    expect(storage.persistent).toBe(false);
    expect(seen.at(-1)).toContain('storage');
    expect(app.banners.find((b) => b.id === 'storage')?.text).toBe(STORAGE_BANNER);
  });

  it('a failed plaintext token write raises the storage banner reactively', async () => {
    const { backing, ctl } = failingFor(':token:');
    seed(backing, 'meta', META_ONE);
    seed(backing, 'p:p1:settings', { onboarded: true, provider: 'kis', proxyUrl: 'https://proxy.test' });
    seed(backing, 'p:p1:secrets', SECRETS);
    const storage = createSafeStorage(backing);
    const app = createApp({ storage, now: () => NOW, fetchImpl: fakeKisFetch() });
    apps.push(app);
    const seen = observeBanners(app);
    expect(seen.at(-1)).not.toContain('storage');

    ctl.armed = true;
    await app.provider.getQuotes(['005930'], 'KRX');
    flushSync();
    // 저장소는 실제로 저장 불가 상태가 되었다. 배너가 반응형으로 따라와야 한다.
    expect(storage.persistent).toBe(false);
    expect(seen.at(-1)).toContain('storage');
  });
});
