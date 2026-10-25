// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import price005930 from '../providers/fixtures/kis/inquire-price-005930.json';
import tokenFixture from '../providers/fixtures/kis/token.json';
import { newStrategy } from '../sim/defaults';
import { newCriteria } from '../screen/defaults';
import { newBasket } from '../screen/baskets';
import { kstEpoch } from '../time/kst';
import { stepPeriod } from '../market/periods';
import { createMemoryOrderCache } from '../perf/orderCache';
import { KeyLockNotSavedError, KeyLockedElsewhereError, StoredKeysNotRemovedError, createApp, type App } from './app.svelte';
import { DEFAULT_SETTINGS, type Meta, type Settings, type Watchlists } from './schema';
import { WrongPassphraseError, isLocked, lockSecrets, type Secrets } from './secrets';
import { createSafeStorage } from './storage';
import { memoryBacking, seed, totalQuotaBacking } from './testStorage';

const NOW = kstEpoch('2026-10-12', '17:42:00');
const now = () => NOW;

const SECRETS: Secrets = {
  kis: { appKey: 'PSkisAppKey-0123456789', appSecret: 'kisSecret/ABCDEFGHIJKLMNOP' },
  proxyToken: 'proxy-token-xyz-424242',
};

const META_ONE: Meta = {
  schemaVersion: 1,
  activeProfileId: 'p1',
  profiles: [{ id: 'p1', name: '내 프로필', createdAt: 1 }],
};
const META_TWO: Meta = {
  schemaVersion: 1,
  activeProfileId: 'p1',
  profiles: [
    { id: 'p1', name: '내 프로필', createdAt: 1 },
    { id: 'p2', name: '회사', createdAt: 2 },
  ],
};
const lists = (...ids: string[]): Watchlists => ({
  groups: ids.map((id) => ({ id, name: `그룹 ${id}`, items: [] })),
});

/** KIS 프록시 흉내: 토큰 발급과 현재가만 답한다. */
function fakeKisFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes('/oauth2/tokenP') ? tokenFixture : price005930;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
}

let apps: App[] = [];
function make(backing: Storage | null, extra: { fetchImpl?: typeof fetch } = {}): App {
  const app = createApp({ storage: createSafeStorage(backing), now, ...extra });
  apps.push(app);
  return app;
}

beforeEach(() => {
  location.hash = '';
});
afterEach(() => {
  for (const a of apps) a.destroy();
  apps = [];
});

function fireHash(hash: string) {
  location.hash = hash;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

describe('createApp — start', () => {
  it('first run (one profile, demo, not onboarded) routes to onboarding with a default group', () => {
    const backing = memoryBacking();
    const app = make(backing);
    expect(app.route.name).toBe('onboarding');
    expect(location.hash).toBe('#/onboarding');
    expect(app.meta.profiles).toHaveLength(1);
    expect(app.provider.id).toBe('demo');
    expect(app.watchlists.groups.map((g) => g.name)).toEqual(['내 관심']);
    expect(app.secrets).toBeNull();
    expect(app.banners).toEqual([]);
  });

  it('keeps the default group id across restarts', () => {
    const backing = memoryBacking();
    const first = make(backing).watchlists.groups[0].id;
    expect(make(backing).watchlists.groups[0].id).toBe(first);
  });

  it('fills missing settings fields from defaults', () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_ONE);
    seed(backing, 'p:p1:settings', { metric: 'drawdown' });
    const app = make(backing);
    expect(app.settings).toEqual({ ...DEFAULT_SETTINGS, metric: 'drawdown' });
  });

  it('an onboarded profile starts on compare with the last or first group', () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_ONE);
    seed(backing, 'p:p1:settings', { onboarded: true });
    seed(backing, 'p:p1:watchlists', lists('g1', 'g2'));
    expect(make(backing).route).toEqual({ name: 'compare', groupId: 'g1' });
    expect(location.hash).toBe('#/compare/g1');

    seed(backing, 'p:p1:settings', { onboarded: true, lastGroupId: 'g2' });
    location.hash = '#/compare/unknown';
    expect(make(backing).route).toEqual({ name: 'compare', groupId: 'g2' });
    expect(location.hash).toBe('#/compare/g2');
  });

  it('two or more profiles start on the profile picker; switchProfile loads that profile', () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_TWO);
    seed(backing, 'p:p2:settings', { onboarded: true, metric: 'excess' });
    seed(backing, 'p:p2:watchlists', lists('g9'));
    const app = make(backing);
    expect(app.route.name).toBe('profiles');

    app.switchProfile('p2');
    expect(app.meta.activeProfileId).toBe('p2');
    expect(app.settings.metric).toBe('excess');
    expect(app.route).toEqual({ name: 'compare', groupId: 'g9' });
    expect(JSON.parse(backing.getItem('gazua:v1:meta')!).activeProfileId).toBe('p2');
  });

  it('addProfile appends a profile without switching', () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_ONE);
    const app = make(backing);
    const p = app.addProfile('  회사  ');
    expect(p.name).toBe('회사');
    expect(app.meta.profiles.map((x) => x.id)).toEqual(['p1', p.id]);
    expect(app.meta.activeProfileId).toBe('p1');
    expect(JSON.parse(backing.getItem('gazua:v1:meta')!).profiles).toHaveLength(2);
    // 이미 이 세션에서 쓰던 프로필이 있으므로 다시 들어가도 프로필 선택으로 돌아가지 않는다.
    app.clearSecrets();
    expect(app.route.name).not.toBe('profiles');
  });
});

describe('createApp — banners', () => {
  it('non-persistent storage shows the storage banner', () => {
    const app = make(null);
    expect(app.banners.map((b) => b.text)).toContain('이 브라우저에선 설정이 저장되지 않아요');
  });

  it('a corrupt stored key gives exactly one banner and default settings', () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_ONE);
    seed(backing, 'p:p1:settings', '{broken');
    const app = make(backing);
    expect(app.banners).toHaveLength(1);
    expect(app.banners[0].text).toBe('저장된 설정 일부를 읽지 못해 기본값으로 되돌렸어요');
    expect(app.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('stored settings are validated on load: period W9 falls back (no [ ] crash) and the corrupt banner shows', () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_ONE);
    seed(backing, 'p:p1:settings', { ...DEFAULT_SETTINGS, onboarded: true, metric: 'excess', period: { unit: 'W', n: 9 }, theme: 'neon' });
    const app = make(backing);
    expect(app.settings.period).toEqual(DEFAULT_SETTINGS.period);
    expect(app.settings.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(app.settings.metric).toBe('excess'); // 맞는 값은 그대로
    expect(() => stepPeriod(app.settings.period, 1)).not.toThrow();
    expect(() => stepPeriod(app.settings.period, -1)).not.toThrow();
    expect(app.banners.map((b) => b.id)).toContain('corrupt:p:p1:settings');
  });

  it('older settings missing fields are filled with defaults without a banner', () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_ONE);
    seed(backing, 'p:p1:settings', { provider: 'demo', period: { unit: 'M', n: 3 } });
    const app = make(backing);
    expect(app.settings).toEqual({ ...DEFAULT_SETTINGS, provider: 'demo', period: { unit: 'M', n: 3 } });
    expect(app.banners.filter((b) => b.id.startsWith('corrupt'))).toEqual([]);
  });

  it('stored watchlists are validated on load: bad items/groups are dropped with the corrupt banner', () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_ONE);
    seed(backing, 'p:p1:settings', { ...DEFAULT_SETTINGS, onboarded: true });
    seed(backing, 'p:p1:watchlists', {
      groups: [
        {
          id: 'g1',
          name: '반도체',
          items: [
            { symbol: '005930', colorSlot: 1, hidden: false, addedAt: 1 },
            { symbol: '000660', colorSlot: 11, hidden: false, addedAt: 1 },
            { symbol: '005930', colorSlot: 2, hidden: false, addedAt: 1 },
          ],
        },
        { id: 'g2', name: 7, items: [] },
        null,
      ],
    });
    const app = make(backing);
    expect(app.watchlists).toEqual({
      groups: [{ id: 'g1', name: '반도체', items: [{ symbol: '005930', colorSlot: 1, hidden: false, addedAt: 1 }] }],
    });
    expect(app.banners.map((b) => b.id)).toContain('corrupt:p:p1:watchlists');
  });

  describe('cleared proxy address', () => {
    afterEach(() => vi.unstubAllEnvs());
    const start = (settings: Record<string, unknown>) => {
      vi.stubEnv('DEV', false);
      const backing = memoryBacking();
      seed(backing, 'meta', META_ONE);
      seed(backing, 'p:p1:settings', { onboarded: true, provider: 'kis', ...settings });
      return make(backing);
    };

    it('a stored localhost proxy names the origin and offers 연결 설정', () => {
      const app = start({ proxyUrl: 'http://localhost:8787' });
      expect(app.settings.proxyUrl).toBe('');
      const b = app.banners.find((x) => x.id === 'proxy-cleared:p:p1:settings');
      expect(b?.text).toBe('저장된 프록시 주소(http://localhost:8787)는 개발 서버에서만 쓸 수 있어서 지웠어요');
      expect(b?.action?.label).toBe('연결 설정');
      expect(app.banners.some((x) => x.id.startsWith('corrupt'))).toBe(false);
      b!.action!.run();
      expect(app.route).toMatchObject({ name: 'settings', section: 'connection' });
    });

    it('shows only the origin: no userinfo, path or query', () => {
      const app = start({ proxyUrl: 'http://user:pw@localhost:8787/x?k=v' });
      const text = app.banners.find((x) => x.id.startsWith('proxy-cleared'))!.text;
      expect(text).toBe('저장된 프록시 주소(http://localhost:8787)는 개발 서버에서만 쓸 수 있어서 지웠어요');
      expect(text).not.toMatch(/user|pw|k=v|\/x/);
    });

    it('a value that is not a local http address gets the generic text without any of the value', () => {
      const app = start({ proxyUrl: 'ftp://secret-host.example/key' });
      const text = app.banners.find((x) => x.id.startsWith('proxy-cleared'))!.text;
      expect(text).toBe('저장된 프록시 주소가 올바르지 않아 지웠어요');
    });

    it('other wrong fields still show the corrupt banner next to it', () => {
      const app = start({ proxyUrl: 'http://localhost:8787', theme: 'neon' });
      const ids = app.banners.map((x) => x.id);
      expect(ids).toContain('proxy-cleared:p:p1:settings');
      expect(ids).toContain('corrupt:p:p1:settings');
    });

    it('DEV: an address cleared for its query or userinfo is "not valid", not "dev server only"', () => {
      vi.stubEnv('DEV', true);
      const backing = memoryBacking();
      seed(backing, 'meta', META_ONE);
      seed(backing, 'p:p1:settings', { onboarded: true, provider: 'kis', proxyUrl: 'http://localhost:8787/?k=v' });
      seed(backing, 'p:p2:settings', { onboarded: true });
      const app = make(backing);
      expect(app.settings.proxyUrl).toBe('');
      expect(app.banners.find((x) => x.id.startsWith('proxy-cleared'))!.text).toBe(
        '저장된 프록시 주소가 올바르지 않아 지웠어요',
      );
    });

    it('DEV: a plain local http address is kept and shows nothing', () => {
      vi.stubEnv('DEV', true);
      const backing = memoryBacking();
      seed(backing, 'meta', META_ONE);
      seed(backing, 'p:p1:settings', { onboarded: true, provider: 'kis', proxyUrl: 'http://localhost:8787' });
      const app = make(backing);
      expect(app.settings.proxyUrl).toBe('http://localhost:8787');
      expect(app.banners.filter((x) => x.id.startsWith('proxy-cleared'))).toEqual([]);
    });

    it('writes the cleaned settings back: the first load has the banner, the second does not', () => {
      const backing = memoryBacking();
      seed(backing, 'meta', META_ONE);
      seed(backing, 'p:p1:settings', {
        onboarded: true,
        provider: 'kis',
        proxyUrl: 'http://localhost:8787',
        theme: 'dark',
        venueMode: 'KRX',
        extra: 'kept',
      });
      vi.stubEnv('DEV', false);
      const first = make(backing);
      expect(first.banners.some((x) => x.id.startsWith('proxy-cleared'))).toBe(true);
      // 저장소에서 프록시 주소만 비고 나머지 값은 그대로다.
      expect(JSON.parse(backing.getItem('gazua:v1:p:p1:settings')!)).toEqual({
        onboarded: true,
        provider: 'kis',
        proxyUrl: '',
        theme: 'dark',
        venueMode: 'KRX',
        extra: 'kept',
      });
      const second = make(backing);
      expect(second.banners.filter((x) => x.id.startsWith('proxy-cleared'))).toEqual([]);
      expect(second.settings).toMatchObject({ theme: 'dark', venueMode: 'KRX', proxyUrl: '' });
    });

    it('second load with another wrong field: proxy-cleared is gone, corrupt stays (only proxyUrl was written back)', () => {
      vi.stubEnv('DEV', false);
      const backing = memoryBacking();
      seed(backing, 'meta', META_ONE);
      seed(backing, 'p:p1:settings', { onboarded: true, provider: 'kis', proxyUrl: 'http://localhost:8787', theme: 'neon' });
      const first = make(backing).banners.map((x) => x.id);
      expect(first).toContain('proxy-cleared:p:p1:settings');
      expect(first).toContain('corrupt:p:p1:settings');
      // 쓰기에서는 프록시 주소만 비고 잘못된 theme은 그대로 남는다
      expect(JSON.parse(backing.getItem('gazua:v1:p:p1:settings')!)).toMatchObject({ proxyUrl: '', theme: 'neon' });
      const second = make(backing).banners.map((x) => x.id);
      expect(second.filter((id) => id.startsWith('proxy-cleared'))).toEqual([]);
      expect(second).toContain('corrupt:p:p1:settings');
    });

    it('a failed write-back keeps the app persistent and still shows the banner', () => {
      vi.stubEnv('DEV', false);
      const backing = memoryBacking();
      seed(backing, 'meta', META_ONE);
      seed(backing, 'p:p1:settings', { onboarded: true, provider: 'kis', proxyUrl: 'http://localhost:8787' });
      const setItem = backing.setItem.bind(backing);
      backing.setItem = (k: string, v: string) => {
        if (k === 'gazua:v1:p:p1:settings') throw new DOMException('quota', 'QuotaExceededError');
        setItem(k, v);
      };
      const storage = createSafeStorage(backing);
      const app = createApp({ storage, now });
      apps.push(app);
      expect(storage.persistent).toBe(true);
      const ids = app.banners.map((x) => x.id);
      expect(ids).toContain('proxy-cleared:p:p1:settings');
      expect(ids).not.toContain('storage');
      // 저장소에는 낡은 값이 남아 있다(다음 로드에 다시 알린다).
      expect(JSON.parse(backing.getItem('gazua:v1:p:p1:settings')!).proxyUrl).toBe('http://localhost:8787');
    });

    it('saving a proxy address clears the banner for this session; other wrong fields keep theirs', () => {
      const app = start({ proxyUrl: 'http://localhost:8787', theme: 'neon' });
      expect(app.banners.map((x) => x.id)).toContain('proxy-cleared:p:p1:settings');
      app.updateSettings({ metric: 'drawdown' });
      expect(app.banners.map((x) => x.id)).toContain('proxy-cleared:p:p1:settings');
      app.updateSettings({ proxyUrl: 'https://proxy.example.com' });
      const ids = app.banners.map((x) => x.id);
      expect(ids).not.toContain('proxy-cleared:p:p1:settings');
      expect(ids).toContain('corrupt:p:p1:settings');
    });

    it('a valid https proxy shows nothing', () => {
      const app = start({ proxyUrl: 'https://proxy.example.com' });
      expect(app.settings.proxyUrl).toBe('https://proxy.example.com');
      expect(app.banners.filter((x) => x.id.startsWith('proxy-cleared'))).toEqual([]);
    });
  });

  it('every stored group broken: one 내 관심 group is saved with the corrupt banner', () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_ONE);
    seed(backing, 'p:p1:settings', { ...DEFAULT_SETTINGS, onboarded: true });
    seed(backing, 'p:p1:watchlists', { groups: [{ id: 'g2', name: 7, items: [] }, null] });
    const app = make(backing);
    expect(app.watchlists.groups).toHaveLength(1);
    expect(app.watchlists.groups[0]).toMatchObject({ name: '내 관심', items: [] });
    expect(JSON.parse(backing.getItem('gazua:v1:p:p1:watchlists')!).groups).toHaveLength(1);
    expect(app.banners.map((b) => b.id)).toContain('corrupt:p:p1:watchlists');
  });

  it('stored {groups: []} falls back to the default group', () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_ONE);
    seed(backing, 'p:p1:settings', { ...DEFAULT_SETTINGS, onboarded: true });
    seed(backing, 'p:p1:watchlists', { groups: [] });
    const app = make(backing);
    expect(app.watchlists.groups.map((g) => g.name)).toEqual(['내 관심']);
    expect(JSON.parse(backing.getItem('gazua:v1:p:p1:watchlists')!).groups).toHaveLength(1);
    expect(app.banners.map((b) => b.id)).toContain('corrupt:p:p1:watchlists');
  });

  it('demo provider while onboarded shows the demo banner whose action opens settings', () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_ONE);
    seed(backing, 'p:p1:settings', { onboarded: true });
    const app = make(backing);
    const demo = app.banners.find((b) => b.id === 'demo');
    expect(demo?.text).toBe('데모 데이터를 보고 있어요');
    expect(demo?.action?.label).toBe('연결하기');
    demo!.action!.run();
    expect(app.route.name).toBe('settings');
    expect(location.hash).toBe('#/settings');
  });
});

describe('createApp — settings, watchlists and routing', () => {
  it('updateSettings persists to storage', () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_ONE);
    const app = make(backing);
    app.updateSettings({ metric: 'drawdown' });
    expect(app.settings.metric).toBe('drawdown');
    const stored = JSON.parse(backing.getItem('gazua:v1:p:p1:settings')!) as Settings;
    expect(stored.metric).toBe('drawdown');
  });

  it('applies theme and color convention when settings change', () => {
    const app = make(memoryBacking());
    app.updateSettings({ theme: 'dark', colorConvention: 'global' });
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.classList.contains('global-colors')).toBe(true);
    app.updateSettings({ theme: 'system', colorConvention: 'kr' });
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(document.documentElement.classList.contains('global-colors')).toBe(false);
  });

  it('setWatchlists persists to storage', () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_ONE);
    const app = make(backing);
    app.setWatchlists(lists('a', 'b'));
    expect(app.watchlists.groups.map((g) => g.id)).toEqual(['a', 'b']);
    expect(JSON.parse(backing.getItem('gazua:v1:p:p1:watchlists')!)).toEqual(lists('a', 'b'));
  });

  it('addRecent keeps the 5 most recent symbols per profile, newest first, and persists them', () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_TWO);
    seed(backing, 'p:p2:recent', ['999999']);
    const app = make(backing);
    app.switchProfile('p1');
    expect(app.recent).toEqual([]);
    for (const s of ['A', 'B', 'C', 'D', 'E', 'F']) app.addRecent(s);
    app.addRecent('C');
    expect(app.recent).toEqual(['C', 'F', 'E', 'D', 'B']);
    expect(JSON.parse(backing.getItem('gazua:v1:p:p1:recent')!)).toEqual(['C', 'F', 'E', 'D', 'B']);
    app.switchProfile('p2');
    expect(app.recent).toEqual(['999999']);
  });

  it('ignores a corrupt recent list', () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_ONE);
    seed(backing, 'p:p1:recent', { nope: 1 });
    expect(make(backing).recent).toEqual([]);
  });

  it('follows hash changes and normalises unknown groups', () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_ONE);
    seed(backing, 'p:p1:settings', { onboarded: true });
    seed(backing, 'p:p1:watchlists', lists('g1', 'g2'));
    const app = make(backing);
    fireHash('#/settings');
    expect(app.route).toEqual({ name: 'settings' });
    fireHash('#/compare/g2');
    expect(app.route).toEqual({ name: 'compare', groupId: 'g2' });
    fireHash('#/compare/nope');
    expect(app.route).toEqual({ name: 'compare', groupId: 'g1' });
    fireHash('#/onboarding');
    expect(app.route).toEqual({ name: 'onboarding' });
    fireHash('#/whatever');
    expect(app.route).toEqual({ name: 'compare', groupId: 'g1' });
  });

  it('navigate writes the hash for hash routes', () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_ONE);
    seed(backing, 'p:p1:settings', { onboarded: true });
    seed(backing, 'p:p1:watchlists', lists('g1', 'g2'));
    const app = make(backing);
    app.navigate({ name: 'compare', groupId: 'g2' });
    expect(location.hash).toBe('#/compare/g2');
    expect(app.route).toEqual({ name: 'compare', groupId: 'g2' });
  });

  it('a gate (profiles) ignores hash changes until a profile is chosen', () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_TWO);
    const app = make(backing);
    fireHash('#/settings');
    expect(app.route.name).toBe('profiles');
  });
});

describe('createApp — provider and data', () => {
  it('recreates provider, memo and snapshots on provider change but keeps the cache', () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_ONE);
    seed(backing, 'p:p1:settings', { onboarded: true });
    seed(backing, 'p:p1:secrets', SECRETS);
    const app = make(backing, { fetchImpl: fakeKisFetch() });
    const before = app.data;
    expect(app.provider.id).toBe('demo');

    app.updateSettings({ metric: 'drawdown' });
    expect(app.data.memo).toBe(before.memo);

    app.updateSettings({ provider: 'kis', proxyUrl: 'https://proxy.test' });
    expect(app.provider.id).toBe('kis');
    expect(app.data.cache).toBe(before.cache);
    expect(app.data.memo).not.toBe(before.memo);
    expect(app.data.snapshots).not.toBe(before.snapshots);
  });

  it('plain mode persists the access token per profile and provider', async () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_ONE);
    seed(backing, 'p:p1:settings', { onboarded: true, provider: 'kis', proxyUrl: 'https://proxy.test' });
    seed(backing, 'p:p1:secrets', SECRETS);
    const fetchImpl = fakeKisFetch();
    const app = make(backing, { fetchImpl });
    expect(app.secrets).toEqual(SECRETS);
    await app.provider.getQuotes(['005930'], 'KRX');
    expect(fetchImpl).toHaveBeenCalled();
    expect(JSON.parse(backing.getItem('gazua:v1:p:p1:token:kis')!).accessToken).toBe('test-access-token');
  });
});

describe('createApp — key lock', () => {
  async function lockedBacking() {
    const backing = memoryBacking();
    seed(backing, 'meta', META_ONE);
    seed(backing, 'p:p1:settings', {
      onboarded: true,
      provider: 'kis',
      proxyUrl: 'https://proxy.test',
      keyLock: true,
    });
    seed(backing, 'p:p1:watchlists', lists('g1'));
    seed(backing, 'p:p1:secrets', await lockSecrets(SECRETS, 'correct horse'));
    return backing;
  }

  it('starts on unlock with no secrets and the demo provider', async () => {
    const app = make(await lockedBacking());
    expect(app.route.name).toBe('unlock');
    expect(app.secrets).toBeNull();
    expect(app.provider.id).toBe('demo');
  });

  it('unlock rejects a wrong passphrase, then opens with the right one', async () => {
    const backing = await lockedBacking();
    const app = make(backing, { fetchImpl: fakeKisFetch() });
    await expect(app.unlock('wrong')).rejects.toBeInstanceOf(WrongPassphraseError);
    expect(app.route.name).toBe('unlock');

    await app.unlock('correct horse');
    expect(app.secrets).toEqual(SECRETS);
    expect(app.provider.id).toBe('kis');
    expect(app.route).toEqual({ name: 'compare', groupId: 'g1' });
  });

  it('never persists decrypted secrets or tokens while locked', async () => {
    const backing = await lockedBacking();
    const fetchImpl = fakeKisFetch();
    const app = make(backing, { fetchImpl });
    await app.unlock('correct horse');
    await app.provider.getQuotes(['005930'], 'KRX');
    expect(fetchImpl).toHaveBeenCalled();
    app.updateSettings({ metric: 'drawdown' });

    const dump = backing.dump();
    expect(dump).not.toContain('test-access-token');
    expect(dump).not.toContain(SECRETS.kis!.appKey);
    expect(dump).not.toContain(SECRETS.kis!.appSecret);
    expect(dump).not.toContain(SECRETS.proxyToken!);
    expect(dump).not.toContain(':token:');
    expect(isLocked(JSON.parse(backing.getItem('gazua:v1:p:p1:secrets')!))).toBe(true);
  });

  it('lock() drops the secrets and returns to unlock', async () => {
    const app = make(await lockedBacking(), { fetchImpl: fakeKisFetch() });
    await app.unlock('correct horse');
    app.lock();
    expect(app.secrets).toBeNull();
    expect(app.provider.id).toBe('demo');
    expect(app.route.name).toBe('unlock');
  });

  it('clearSecrets removes the stored keys and turns keyLock off', async () => {
    const backing = await lockedBacking();
    const app = make(backing);
    app.clearSecrets();
    expect(backing.getItem('gazua:v1:p:p1:secrets')).toBeNull();
    expect(app.settings.keyLock).toBe(false);
    expect(app.secrets).toBeNull();
    expect(app.route).toEqual({ name: 'compare', groupId: 'g1' });
  });

  it('setSecrets with a passphrase stores only ciphertext and turns keyLock on', async () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_ONE);
    seed(backing, 'p:p1:settings', { onboarded: true, provider: 'kis', proxyUrl: 'https://proxy.test' });
    const app = make(backing, { fetchImpl: fakeKisFetch() });
    await app.setSecrets(SECRETS, 'correct horse');
    expect(app.secrets).toEqual(SECRETS);
    expect(app.settings.keyLock).toBe(true);
    expect(app.provider.id).toBe('kis');
    await app.provider.getQuotes(['005930'], 'KRX');
    const dump = backing.dump();
    expect(dump).not.toContain(SECRETS.kis!.appKey);
    expect(dump).not.toContain('test-access-token');
    expect(isLocked(JSON.parse(backing.getItem('gazua:v1:p:p1:secrets')!))).toBe(true);
  });

  it('setSecrets without a passphrase stores plaintext only when keyLock is off', async () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_ONE);
    const app = make(backing);
    app.updateSettings({ keyLock: true }); // 저장된 키가 없으면 켤 수 있다
    await expect(app.setSecrets(SECRETS)).rejects.toThrow();
    expect(backing.getItem('gazua:v1:p:p1:secrets')).toBeNull();

    app.updateSettings({ keyLock: false });
    await app.setSecrets(SECRETS);
    expect(JSON.parse(backing.getItem('gazua:v1:p:p1:secrets')!)).toEqual(SECRETS);
  });

  it('updateSettings refuses to turn keyLock on while plaintext secrets are stored', async () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_ONE);
    seed(backing, 'p:p1:secrets', SECRETS);
    const app = make(backing);
    expect(() => app.updateSettings({ keyLock: true })).toThrow(/setSecrets/);
    expect(app.settings.keyLock).toBe(false);
    expect(backing.getItem('gazua:v1:p:p1:settings')).toBeNull();
  });

  it('updateSettings refuses to turn keyLock off while secrets are encrypted; disableKeyLock does it explicitly', async () => {
    const backing = await lockedBacking();
    const app = make(backing);
    expect(() => app.updateSettings({ keyLock: false })).toThrow(/disableKeyLock/);
    expect(() => app.disableKeyLock()).toThrow(/unlock first/);
    await app.unlock('correct horse');
    app.disableKeyLock();
    expect(app.settings.keyLock).toBe(false);
    expect(JSON.parse(backing.getItem('gazua:v1:p:p1:secrets')!)).toEqual(SECRETS);
    expect(app.secrets).toEqual(SECRETS);
  });

  /** setItem이 armed 뒤로는 QuotaExceededError를 던지는 저장소(removeItem은 된다). */
  function quotaBacking() {
    const backing = memoryBacking();
    const ctl = { full: false };
    const setItem = backing.setItem.bind(backing);
    backing.setItem = (k: string, v: string) => {
      if (ctl.full) throw new DOMException('quota', 'QuotaExceededError');
      setItem(k, v);
    };
    return { backing, ctl };
  }

  it('setSecrets with a passphrase: a failed write removes the stored plaintext, keeps the lock in memory and rejects', async () => {
    const { backing, ctl } = quotaBacking();
    seed(backing, 'meta', META_ONE);
    seed(backing, 'p:p1:settings', { onboarded: true, provider: 'kis', proxyUrl: 'https://proxy.test' });
    seed(backing, 'p:p1:secrets', SECRETS);
    const app = make(backing, { fetchImpl: fakeKisFetch() });
    ctl.full = true;
    await expect(app.setSecrets(SECRETS, 'correct horse')).rejects.toMatchObject({ name: 'KeyLockNotSavedError', kind: 'lock', reason: 'cleared' });
    const dump = backing.dump();
    expect(dump).not.toContain(SECRETS.kis!.appKey);
    expect(dump).not.toContain(SECRETS.kis!.appSecret);
    expect(dump).not.toContain(SECRETS.proxyToken!);
    expect(backing.getItem('gazua:v1:p:p1:secrets')).toBeNull();
    // 이 탭에서는 잠금이 켜진 채 키를 쓴다(복호화한 키는 메모리에만).
    expect(app.settings.keyLock).toBe(true);
    expect(app.secrets).toEqual(SECRETS);
    expect(await app.verifyPassphrase('wrong')).toBe(false);
    expect(await app.verifyPassphrase('correct horse')).toBe(true);
  });

  it('without any backing store the lock rejects as no-storage (nothing was stored, nothing to delete)', async () => {
    const app = make(null, { fetchImpl: fakeKisFetch() });
    await app.setSecrets(SECRETS).catch(() => {});
    await expect(app.setSecrets(SECRETS, 'correct horse')).rejects.toMatchObject({ kind: 'lock', reason: 'no-storage' });
    expect(app.settings.keyLock).toBe(true);
    expect(app.secrets).toEqual(SECRETS);
  });

  it('when removeItem also fails the lock rejects as not-cleared (it does not claim the old keys are gone)', async () => {
    const { backing, ctl } = quotaBacking();
    seed(backing, 'meta', META_ONE);
    seed(backing, 'p:p1:settings', { onboarded: true, provider: 'kis', proxyUrl: 'https://proxy.test' });
    seed(backing, 'p:p1:secrets', SECRETS);
    const app = make(backing, { fetchImpl: fakeKisFetch() });
    ctl.full = true;
    backing.removeItem = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    await expect(app.setSecrets(SECRETS, 'correct horse')).rejects.toMatchObject({ kind: 'lock', reason: 'not-cleared' });
  });

  it('disableKeyLock reports a plaintext write that did not persist instead of succeeding silently', async () => {
    const { backing, ctl } = quotaBacking();
    seed(backing, 'meta', META_ONE);
    seed(backing, 'p:p1:settings', { onboarded: true, provider: 'kis', proxyUrl: 'https://proxy.test', keyLock: true });
    seed(backing, 'p:p1:secrets', await lockSecrets(SECRETS, 'correct horse'));
    const app = make(backing, { fetchImpl: fakeKisFetch() });
    await app.unlock('correct horse');
    ctl.full = true;
    let thrown: unknown;
    try {
      app.disableKeyLock();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(KeyLockNotSavedError);
    expect(thrown).toMatchObject({ kind: 'unlock', reason: 'unsaved' });
    // 저장소에는 잠긴 키가 그대로 남는다(평문 없음).
    expect(isLocked(JSON.parse(backing.getItem('gazua:v1:p:p1:secrets')!))).toBe(true);
    expect(backing.dump()).not.toContain(SECRETS.kis!.appKey);
  });

  it('review 4246969974: a retried disableKeyLock re-attempts the write and fails again until it persists', async () => {
    const { backing, ctl } = quotaBacking();
    seed(backing, 'meta', META_ONE);
    seed(backing, 'p:p1:settings', { onboarded: true, provider: 'kis', proxyUrl: 'https://proxy.test', keyLock: true });
    seed(backing, 'p:p1:secrets', await lockSecrets(SECRETS, 'correct horse'));
    const app = make(backing, { fetchImpl: fakeKisFetch() });
    await app.unlock('correct horse');
    ctl.full = true;
    for (let i = 0; i < 2; i++) {
      expect(() => app.disableKeyLock()).toThrow(KeyLockNotSavedError);
      expect(isLocked(JSON.parse(backing.getItem('gazua:v1:p:p1:secrets')!))).toBe(true);
      expect(JSON.parse(backing.getItem('gazua:v1:p:p1:settings')!).keyLock).toBe(true);
      // 저장되지 않았으니 이 탭에서도 잠금은 그대로다.
      expect(app.settings.keyLock).toBe(true);
    }
    ctl.full = false;
    app.disableKeyLock();
    expect(JSON.parse(backing.getItem('gazua:v1:p:p1:secrets')!)).toEqual(SECRETS);
    expect(JSON.parse(backing.getItem('gazua:v1:p:p1:settings')!).keyLock).toBe(false);
    expect(app.settings.keyLock).toBe(false);
    expect(app.secrets).toEqual(SECRETS);
  });

  it('without any backing store disableKeyLock turns the lock off in this tab but keeps reporting no-storage', async () => {
    const app = make(null, { fetchImpl: fakeKisFetch() });
    await app.setSecrets(SECRETS, 'correct horse').catch(() => {});
    expect(app.settings.keyLock).toBe(true);
    for (let i = 0; i < 2; i++) expect(() => app.disableKeyLock()).toThrow(expect.objectContaining({ reason: 'no-storage' }));
    expect(app.settings.keyLock).toBe(false);
    expect(app.secrets).toEqual(SECRETS);
  });

  it('review 4247273929: under a total quota, a failed disableKeyLock never leaves plaintext keys in storage', async () => {
    const backing = totalQuotaBacking();
    seed(backing, 'meta', META_ONE);
    seed(backing, 'p:p1:settings', { onboarded: true, provider: 'kis', proxyUrl: 'https://proxy.test' });
    seed(backing, 'p:p1:watchlists', lists('g1'));
    seed(backing, 'p:p1:secrets', SECRETS);
    backing.limit = backing.used() + 5; // 저장 공간이 거의 찼다
    const app = make(backing, { fetchImpl: fakeKisFetch() });

    // 1) 더 긴 프록시 URL 저장이 실패한다(이후 쓰기는 메모리로).
    app.updateSettings({ proxyUrl: `https://proxy.test/${'x'.repeat(60)}` });
    expect(app.settings.proxyUrl).toContain('xxxx');
    // 2) 잠금 저장이 실패하고 저장소의 이전 평문 키는 지워진다.
    await expect(app.setSecrets(SECRETS, 'correct horse')).rejects.toMatchObject({ kind: 'lock', reason: 'cleared' });
    expect(backing.dump()).not.toContain(SECRETS.kis!.appKey);
    // 3) 잠금 끄기: 설정과 평문 키를 모두 저장할 수는 없다.
    expect(() => app.disableKeyLock()).toThrow(KeyLockNotSavedError);
    expect(app.settings.keyLock).toBe(true);
    const dump = backing.dump();
    expect(dump).not.toContain(SECRETS.kis!.appKey);
    expect(dump).not.toContain(SECRETS.kis!.appSecret);
    expect(dump).not.toContain(SECRETS.proxyToken!);
    // 새로 열어도 암호 없이 키를 읽지 못한다.
    const reopened = make(backing, { fetchImpl: fakeKisFetch() });
    expect(reopened.secrets).toBeNull();
  });

  it('under a total quota with room, disableKeyLock persists plaintext keys and keyLock=false', async () => {
    const backing = totalQuotaBacking();
    seed(backing, 'meta', META_ONE);
    seed(backing, 'p:p1:settings', { onboarded: true, provider: 'kis', proxyUrl: 'https://proxy.test', keyLock: true });
    seed(backing, 'p:p1:watchlists', lists('g1'));
    seed(backing, 'p:p1:secrets', await lockSecrets(SECRETS, 'correct horse'));
    const app = make(backing, { fetchImpl: fakeKisFetch() });
    await app.unlock('correct horse');
    // 시작할 때 쓰는 값까지 저장한 뒤 거의 가득 차게 한다(설정이 기본값으로 채워지며 조금 커진다).
    backing.limit = backing.used() + 400;
    app.disableKeyLock();
    expect(JSON.parse(backing.getItem('gazua:v1:p:p1:secrets')!)).toEqual(SECRETS);
    expect(JSON.parse(backing.getItem('gazua:v1:p:p1:settings')!).keyLock).toBe(false);
    expect(make(backing).secrets).toEqual(SECRETS);
  });

  it('a late token from the replaced plain-mode provider is not persisted after the lock turns on', async () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_ONE);
    seed(backing, 'p:p1:settings', { onboarded: true, provider: 'kis', proxyUrl: 'https://proxy.test' });
    seed(backing, 'p:p1:secrets', SECRETS);
    let releaseToken!: () => void;
    const tokenGate = new Promise<void>((r) => (releaseToken = r));
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/oauth2/tokenP')) await tokenGate;
      const body = url.includes('/oauth2/tokenP') ? tokenFixture : price005930;
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const app = make(backing, { fetchImpl });
    const pending = app.provider.getQuotes(['005930'], 'KRX');
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());

    await app.setSecrets(SECRETS, 'correct horse');
    releaseToken();
    await pending;

    const dump = backing.dump();
    expect(dump).not.toContain(':token:');
    expect(dump).not.toContain('test-access-token');
  });

  it('gated start: no demo banner, and navigate keeps the gate route', async () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_ONE);
    seed(backing, 'p:p1:settings', { onboarded: true, keyLock: true });
    seed(backing, 'p:p1:secrets', await lockSecrets(SECRETS, 'correct horse'));
    const app = make(backing);
    expect(app.route.name).toBe('unlock');
    expect(app.banners.find((b) => b.id === 'demo')).toBeUndefined();
    app.navigate({ name: 'settings' });
    expect(app.route.name).toBe('unlock');
    expect(location.hash).not.toBe('#/settings');

    const two = memoryBacking();
    seed(two, 'meta', META_TWO);
    seed(two, 'p:p1:settings', { onboarded: true });
    const picker = make(two);
    expect(picker.banners.find((b) => b.id === 'demo')).toBeUndefined();
    picker.navigate({ name: 'compare' });
    expect(picker.route.name).toBe('profiles');
  });
});

describe('createApp — profiles management, passphrase check, export/import', () => {
  it('renameProfile trims the name and ignores a blank one', () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_ONE);
    const app = make(backing);
    app.renameProfile('p1', '  회사  ');
    expect(app.meta.profiles[0].name).toBe('회사');
    app.renameProfile('p1', '   ');
    expect(app.meta.profiles[0].name).toBe('회사');
    expect(JSON.parse(backing.getItem('gazua:v1:meta')!).profiles[0].name).toBe('회사');
  });

  it('deleteProfile removes its keys, refuses the last profile, and switches away from the active one', () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_TWO);
    seed(backing, 'p:p1:settings', { onboarded: true });
    seed(backing, 'p:p2:settings', { onboarded: true });
    seed(backing, 'p:p2:secrets', SECRETS);
    seed(backing, 'p:p2:token:kis', { accessToken: 'tok', expiresAt: NOW + 1e6 });
    seed(backing, 'p:p2:tokenIssuedAt:kis', NOW);
    const app = make(backing);
    app.switchProfile('p2');
    app.deleteProfile('p2');
    expect(app.meta.activeProfileId).toBe('p1');
    expect(app.meta.profiles.map((p) => p.id)).toEqual(['p1']);
    expect(backing.dump()).not.toContain('p:p2:');
    expect(() => app.deleteProfile('p1')).toThrow();
    expect(app.meta.profiles).toHaveLength(1);
  });

  it('deleteProfile: a KIS token issued after the delete does not write p:<id>:tokenIssuedAt back', async () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_TWO);
    seed(backing, 'p:p1:settings', { onboarded: true });
    seed(backing, 'p:p2:settings', { onboarded: true, provider: 'kis', proxyUrl: 'https://proxy.test' });
    seed(backing, 'p:p2:secrets', SECRETS);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/oauth2/tokenP')) await gate;
      return new Response(JSON.stringify(url.includes('/oauth2/tokenP') ? tokenFixture : price005930), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    const app = make(backing, { fetchImpl });
    app.switchProfile('p2');
    const inFlight = app.provider.getQuotes(['005930'], 'KRX').catch(() => undefined);
    // 토큰 발급이 진행 중일 때 그 프로필을 지운다.
    app.deleteProfile('p2');
    release();
    await inFlight;
    await Promise.resolve();
    expect(backing.dump()).not.toContain('p:p2:');
  });

  it('switchProfile: tokenIssuedAt uses the new profile key, so the wait follows the profile', () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_TWO);
    seed(backing, 'p:p1:settings', { onboarded: true });
    seed(backing, 'p:p2:settings', { onboarded: true });
    seed(backing, 'p:p1:tokenIssuedAt:kis', 111);
    seed(backing, 'p:p2:tokenIssuedAt:kis', 222);
    const app = make(backing);
    expect(app.tokenIssuedAt('kis').load()).toBe(111);
    app.switchProfile('p2');
    const store = app.tokenIssuedAt('kis');
    expect(store.load()).toBe(222);
    store.save(NOW);
    expect(JSON.parse(backing.getItem('gazua:v1:p:p2:tokenIssuedAt:kis')!)).toBe(NOW);
    expect(JSON.parse(backing.getItem('gazua:v1:p:p1:tokenIssuedAt:kis')!)).toBe(111);
    app.switchProfile('p1');
    expect(app.tokenIssuedAt('kis').load()).toBe(111);
  });

  it('deleteProfile: tokenIssuedAt(...).save for a deleted profile is a no-op', () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_TWO);
    seed(backing, 'p:p1:settings', { onboarded: true });
    seed(backing, 'p:p2:settings', { onboarded: true });
    const app = make(backing);
    app.switchProfile('p2');
    const store = app.tokenIssuedAt('kis');
    store.save(NOW);
    expect(backing.dump()).toContain('p:p2:tokenIssuedAt:kis');
    app.deleteProfile('p2');
    store.save(NOW);
    expect(backing.dump()).not.toContain('p:p2:');
  });

  it('setStrategies persists, switchProfile swaps the list, deleteProfile removes the key', () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_TWO);
    seed(backing, 'p:p1:settings', { onboarded: true });
    seed(backing, 'p:p2:settings', { onboarded: true });
    const a = { ...newStrategy(NOW, 'g1', '가'), id: 'a' };
    const b = { ...newStrategy(NOW, 'g1', '나'), id: 'b' };
    seed(backing, 'p:p2:strategies', { strategies: [b] });
    const app = make(backing);
    expect(app.strategies).toEqual([]);
    app.setStrategies([a]);
    expect(JSON.parse(backing.getItem('gazua:v1:p:p1:strategies')!)).toEqual({ strategies: [a] });
    expect(app.strategies).toEqual([a]);
    app.switchProfile('p2');
    expect(app.strategies).toEqual([b]);
    app.deleteProfile('p2');
    expect(backing.getItem('gazua:v1:p:p2:strategies')).toBeNull();
    expect(app.strategies).toEqual([a]);
  });

  it('setCriteria persists, switchProfile swaps the list, deleteProfile removes the key', () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_TWO);
    seed(backing, 'p:p1:settings', { onboarded: true });
    seed(backing, 'p:p2:settings', { onboarded: true });
    const a = { ...newCriteria(NOW, null, '가'), id: 'a' };
    const b = { ...newCriteria(NOW, null, '나'), id: 'b' };
    seed(backing, 'p:p2:criteria', { criteria: [b] });
    const app = make(backing);
    expect(app.criteria).toEqual([]);
    app.setCriteria([a]);
    expect(JSON.parse(backing.getItem('gazua:v1:p:p1:criteria')!)).toEqual({ criteria: [a] });
    expect(app.criteria).toEqual([a]);
    app.switchProfile('p2');
    expect(app.criteria).toEqual([b]);
    app.deleteProfile('p2');
    expect(backing.getItem('gazua:v1:p:p2:criteria')).toBeNull();
    expect(app.criteria).toEqual([a]);
  });

  it('setCriteria는 20개를 넘으면 던지고 저장하지 않는다', () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_TWO);
    seed(backing, 'p:p1:settings', { onboarded: true });
    const app = make(backing);
    const many = Array.from({ length: 21 }, (_, i) => ({ ...newCriteria(NOW, null), id: `c${i}` }));
    expect(() => app.setCriteria(many)).toThrow('선정 기준은 20개까지 저장할 수 있어요');
    expect(app.criteria).toEqual([]);
    expect(backing.getItem('gazua:v1:p:p1:criteria')).toBeNull();
  });

  it('setBaskets persists, switchProfile swaps the list, deleteProfile removes the key', () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_TWO);
    seed(backing, 'p:p1:settings', { onboarded: true });
    seed(backing, 'p:p2:settings', { onboarded: true });
    const a = { ...newBasket(NOW, '가', ['005930']), id: 'a' };
    const b = { ...newBasket(NOW, '나', ['000660']), id: 'b' };
    seed(backing, 'p:p2:baskets', { baskets: [b] });
    const app = make(backing);
    expect(app.baskets).toEqual([]);
    app.setBaskets([a]);
    expect(JSON.parse(backing.getItem('gazua:v1:p:p1:baskets')!)).toEqual({ baskets: [a] });
    expect(app.baskets).toEqual([a]);
    app.switchProfile('p2');
    expect(app.baskets).toEqual([b]);
    app.deleteProfile('p2');
    expect(backing.getItem('gazua:v1:p:p2:baskets')).toBeNull();
    expect(app.baskets).toEqual([a]);
  });

  it('setBaskets는 31개면 던지고 저장하지 않는다', () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_TWO);
    seed(backing, 'p:p1:settings', { onboarded: true });
    const app = make(backing);
    const many = Array.from({ length: 31 }, (_, i) => ({ ...newBasket(NOW, '묶음', ['005930']), id: `b${i}` }));
    expect(() => app.setBaskets(many)).toThrow('내 묶음은 30개까지 저장할 수 있어요');
    expect(app.baskets).toEqual([]);
    expect(backing.getItem('gazua:v1:p:p1:baskets')).toBeNull();
  });

  it('setBaskets는 빈 묶음을 거절하고 저장하지 않는다', () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_TWO);
    seed(backing, 'p:p1:settings', { onboarded: true });
    const app = make(backing);
    expect(() => app.setBaskets([{ ...newBasket(NOW, '빈', []), id: 'e' }])).toThrow('묶음에는 종목이 1개 이상 있어야 해요');
    expect(app.baskets).toEqual([]);
    expect(backing.getItem('gazua:v1:p:p1:baskets')).toBeNull();
  });

  it('verifyPassphrase checks the stored lock without changing state', async () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_ONE);
    seed(backing, 'p:p1:settings', { onboarded: true, keyLock: true });
    seed(backing, 'p:p1:secrets', await lockSecrets(SECRETS, 'correct horse'));
    const app = make(backing);
    await app.unlock('correct horse');
    expect(await app.verifyPassphrase('wrong')).toBe(false);
    expect(await app.verifyPassphrase('correct horse')).toBe(true);
    expect(app.secrets).toEqual(SECRETS);
  });

  it('exportData/importData go through storage and the imported profile shows up in meta', () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_ONE);
    seed(backing, 'p:p1:settings', { onboarded: true });
    seed(backing, 'p:p1:watchlists', lists('g1'));
    seed(backing, 'p:p1:secrets', SECRETS);
    const app = make(backing);
    const json = app.exportData(false);
    expect(json).not.toContain(SECRETS.kis!.appKey);
    expect(app.exportData(true)).toContain(SECRETS.kis!.appKey);
    const res = app.importData(json);
    expect(res.ok).toBe(true);
    expect(app.meta.profiles.map((p) => p.name)).toEqual(['내 프로필', '내 프로필 (가져옴)']);
    expect(app.meta.activeProfileId).toBe('p1');
    // 이후 meta 쓰기가 가져온 프로필을 지우지 않는다.
    app.addProfile('셋째');
    expect(JSON.parse(backing.getItem('gazua:v1:meta')!).profiles).toHaveLength(3);
    expect(app.importData('{')).toEqual({ ok: false, reason: '파일 형식이 맞지 않아요' });
  });
});

describe('createApp — tokenSourceFor (connection diagnosis shares the provider token)', () => {
  const tokenPosts = (f: ReturnType<typeof fakeKisFetch>) =>
    f.mock.calls.filter(([u]) => String(u).includes('/oauth2/tokenP')).length;

  function plainBacking() {
    const backing = memoryBacking();
    seed(backing, 'meta', META_ONE);
    seed(backing, 'p:p1:settings', { onboarded: true, provider: 'kis', proxyUrl: 'https://proxy.test' });
    seed(backing, 'p:p1:secrets', SECRETS);
    return backing;
  }

  it('shares the in-flight token with the provider: one token POST in total', async () => {
    const fetchImpl = fakeKisFetch();
    const app = make(plainBacking(), { fetchImpl });
    const source = app.tokenSourceFor('kis', { ...SECRETS }, 'https://proxy.test');
    expect(source).toBeTypeOf('function');
    const [, token] = await Promise.all([app.provider.getQuotes(['005930'], 'KRX'), source!()]);
    expect(token.accessToken).toBe('test-access-token');
    expect(tokenPosts(fetchImpl)).toBe(1);
  });

  it('returns undefined for different keys, proxy token, proxy URL or provider', () => {
    const app = make(plainBacking(), { fetchImpl: fakeKisFetch() });
    const otherKey = { ...SECRETS, kis: { ...SECRETS.kis!, appKey: 'other' } };
    expect(app.tokenSourceFor('kis', otherKey, 'https://proxy.test')).toBeUndefined();
    expect(app.tokenSourceFor('kis', { ...SECRETS, proxyToken: 'other' }, 'https://proxy.test')).toBeUndefined();
    expect(app.tokenSourceFor('kis', SECRETS, 'https://elsewhere.test')).toBeUndefined();
    expect(app.tokenSourceFor('toss', SECRETS, 'https://proxy.test')).toBeUndefined();

    const demo = memoryBacking();
    seed(demo, 'meta', META_ONE);
    seed(demo, 'p:p1:settings', { onboarded: true, provider: 'kis' });
    expect(make(demo).tokenSourceFor('kis', SECRETS, '')).toBeUndefined();
  });

  it('lock mode keeps the shared token in memory only', async () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_ONE);
    seed(backing, 'p:p1:settings', { onboarded: true, provider: 'kis', proxyUrl: 'https://proxy.test', keyLock: true });
    seed(backing, 'p:p1:secrets', await lockSecrets(SECRETS, 'correct horse'));
    const fetchImpl = fakeKisFetch();
    const app = make(backing, { fetchImpl });
    await app.unlock('correct horse');
    // (픽스처 토큰의 만료가 NOW보다 이르므로 동시에 불러 진행 중 발급을 함께 쓰는지 본다.)
    await Promise.all([app.tokenSourceFor('kis', SECRETS, 'https://proxy.test')!(), app.provider.getQuotes(['005930'], 'KRX')]);
    expect(tokenPosts(fetchImpl)).toBe(1);
    expect(backing.dump()).not.toContain(':token:');
    expect(backing.dump()).not.toContain('test-access-token');
    // 발급 시각은 비밀이 아니라 잠금 모드에서도 저장한다(새로고침 뒤 KIS 1분 제한 남은 초).
    expect(JSON.parse(backing.getItem('gazua:v1:p:p1:tokenIssuedAt:kis')!)).toBe(NOW);
    expect(app.tokenIssuedAt('kis').load()).toBe(NOW);
  });
});

describe('createApp — key lock across tabs', () => {
  const OTHER: Secrets = { kis: { appKey: 'PSotherKey-9999999999', appSecret: 'otherSecret/ZZZZZZZZZZZZZZZZ' } };

  function plainShared() {
    const backing = memoryBacking();
    seed(backing, 'meta', META_ONE);
    seed(backing, 'p:p1:settings', { onboarded: true, provider: 'kis', proxyUrl: 'https://proxy.test' });
    seed(backing, 'p:p1:watchlists', lists('g1'));
    seed(backing, 'p:p1:secrets', SECRETS);
    return backing;
  }
  const storedSecrets = (b: Storage) => JSON.parse(b.getItem('gazua:v1:p:p1:secrets')!);
  const storedSettings = (b: Storage) => JSON.parse(b.getItem('gazua:v1:p:p1:settings')!);

  it('(a) on load the stored keys decide keyLock: plaintext + keyLock:true opens unlocked and fixes the setting', () => {
    const backing = plainShared();
    seed(backing, 'p:p1:settings', { onboarded: true, provider: 'kis', proxyUrl: 'https://proxy.test', keyLock: true });
    const app = make(backing);
    expect(app.settings.keyLock).toBe(false);
    expect(storedSettings(backing).keyLock).toBe(false);
    expect(app.secrets).toEqual(SECRETS);
  });

  it('(a) on load sealed keys + keyLock:false open locked and fix the setting', async () => {
    const backing = plainShared();
    seed(backing, 'p:p1:secrets', await lockSecrets(SECRETS, 'correct horse'));
    const app = make(backing);
    expect(app.settings.keyLock).toBe(true);
    expect(storedSettings(backing).keyLock).toBe(true);
    expect(app.route.name).toBe('unlock');
    expect(app.secrets).toBeNull();
  });

  it('(b) two tabs: after B seals the keys, A’s plaintext save is refused and storage stays sealed', async () => {
    const backing = plainShared();
    const a = make(backing, { fetchImpl: fakeKisFetch() });
    const b = make(backing, { fetchImpl: fakeKisFetch() });
    await b.setSecrets(SECRETS, 'correct horse');
    expect(isLocked(storedSecrets(backing))).toBe(true);
    // A는 storage 이벤트를 받지 못한 채(잠금 꺼짐으로 알고) 키를 저장한다.
    expect(a.settings.keyLock).toBe(false);
    await expect(a.setSecrets(OTHER)).rejects.toBeInstanceOf(KeyLockedElsewhereError);
    expect(isLocked(storedSecrets(backing))).toBe(true);
    expect(backing.dump()).not.toContain(OTHER.kis!.appKey);
    // 다시 열면 암호를 묻는다.
    const reopened = make(backing);
    expect(reopened.route.name).toBe('unlock');
    expect(reopened.secrets).toBeNull();
    expect(reopened.settings.keyLock).toBe(true);
  });

  it('(b) a plaintext save also stores keyLock:false', async () => {
    const backing = plainShared();
    seed(backing, 'p:p1:settings', { onboarded: true, provider: 'kis', proxyUrl: 'https://proxy.test', keyLock: true });
    seed(backing, 'p:p1:secrets', null);
    backing.removeItem('gazua:v1:p:p1:secrets');
    const app = make(backing);
    // 저장된 키가 없으면 잠금이 꺼진 것으로 연다(a). 평문 저장은 설정도 keyLock:false로 남긴다.
    await app.setSecrets(OTHER);
    expect(storedSecrets(backing)).toEqual(OTHER);
    expect(storedSettings(backing).keyLock).toBe(false);
  });

  it('(c) a storage event from another tab that sealed the keys locks this tab and shows the unlock gate', async () => {
    const backing = plainShared();
    const a = make(backing, { fetchImpl: fakeKisFetch() });
    const b = make(backing, { fetchImpl: fakeKisFetch() });
    expect(a.route.name).toBe('compare');
    await b.setSecrets(SECRETS, 'correct horse');
    window.dispatchEvent(new StorageEvent('storage', { key: 'gazua:v1:p:p1:secrets' }));
    expect(a.secrets).toBeNull();
    expect(a.settings.keyLock).toBe(true);
    expect(a.route.name).toBe('unlock');
    await a.unlock('correct horse');
    expect(a.secrets).toEqual(SECRETS);
    // B 자신은 같은 잠금이라 그대로다.
    expect(b.secrets).toEqual(SECRETS);
    expect(b.route.name).not.toBe('unlock');
  });

  /** setItem이 ctl.full일 때 QuotaExceededError를 던지는 공유 저장소. */
  function sharedQuota() {
    const backing = plainShared();
    const ctl = { full: false };
    const setItem = backing.setItem.bind(backing);
    backing.setItem = (k: string, v: string) => {
      if (ctl.full) throw new DOMException('quota', 'QuotaExceededError');
      setItem(k, v);
    };
    return { backing, ctl };
  }

  it('(c) a memory-only lock survives another tab’s unrelated writes; only a real removal of stored keys unlocks', async () => {
    const { backing, ctl } = sharedQuota();
    const a = make(backing, { fetchImpl: fakeKisFetch() });
    const b = make(backing, { fetchImpl: fakeKisFetch() });
    // A의 잠금 저장이 실패한다: 저장소의 키는 지워지고, 잠금과 키는 이 탭의 메모리에만 남는다.
    ctl.full = true;
    await expect(a.setSecrets(SECRETS, 'correct horse')).rejects.toMatchObject({ kind: 'lock', reason: 'cleared' });
    expect(backing.getItem('gazua:v1:p:p1:secrets')).toBeNull();
    ctl.full = false;
    // B가 다른 설정을 바꾼다.
    b.updateSettings({ theme: 'dark' });
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'gazua:v1:p:p1:settings', oldValue: '{}', newValue: backing.getItem('gazua:v1:p:p1:settings') }),
    );
    expect(a.secrets).toEqual(SECRETS);
    expect(a.settings.keyLock).toBe(true);
    // 저장된 값이 없던 키에 대한 이벤트도 이 탭의 메모리 잠금을 풀지 않는다.
    window.dispatchEvent(new StorageEvent('storage', { key: 'gazua:v1:p:p1:secrets', oldValue: null, newValue: null }));
    expect(a.secrets).toEqual(SECRETS);
    expect(a.settings.keyLock).toBe(true);
    // 다른 탭이 저장된(잠긴) 키를 지웠을 때만 이 탭도 잠금을 내려놓는다.
    window.dispatchEvent(new StorageEvent('storage', { key: 'gazua:v1:p:p1:secrets', oldValue: '{"enc":"x","iv":"y","salt":"z","kdf":"PBKDF2-SHA256","iter":310000}', newValue: null }));
    expect(a.settings.keyLock).toBe(false);
    expect(a.secrets).toBeNull();
  });

  it('(a) the load-time keyLock fix does not turn the session memory-only when the write fails', async () => {
    const { backing, ctl } = sharedQuota();
    seed(backing, 'p:p1:settings', { onboarded: true, provider: 'kis', proxyUrl: 'https://proxy.test', keyLock: true });
    ctl.full = true;
    const app = make(backing);
    expect(app.settings.keyLock).toBe(false);
    expect(app.banners.find((x) => x.id === 'storage')).toBeUndefined();
    // 다음 쓰기는 저장소에 바로 간다(메모리 전용으로 굳지 않았다).
    ctl.full = false;
    app.updateSettings({ theme: 'dark' });
    expect(JSON.parse(backing.getItem('gazua:v1:p:p1:settings')!).theme).toBe('dark');
  });

  it('a failed removal in clearSecrets is reported, and a later plaintext save is refused for that reason (not as another tab’s lock)', async () => {
    const backing = plainShared();
    seed(backing, 'p:p1:secrets', await lockSecrets(SECRETS, 'correct horse'));
    const app = make(backing, { fetchImpl: fakeKisFetch() });
    await app.unlock('correct horse');
    const removeItem = backing.removeItem.bind(backing);
    backing.removeItem = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    expect(() => app.clearSecrets()).toThrow(StoredKeysNotRemovedError);
    // 이 탭에서는 지웠지만 저장소에는 잠긴 키가 남았다.
    expect(app.secrets).toBeNull();
    expect(isLocked(storedSecrets(backing))).toBe(true);
    const err = await app.setSecrets(OTHER).catch((e) => e);
    expect(err).toBeInstanceOf(StoredKeysNotRemovedError);
    expect(err).not.toBeInstanceOf(KeyLockedElsewhereError);
    expect(isLocked(storedSecrets(backing))).toBe(true);
    expect(backing.dump()).not.toContain(OTHER.kis!.appKey);

    // 다른 탭이 새로 잠그면 그때는 다른 탭의 잠금으로 거절한다.
    backing.removeItem = removeItem;
    seed(backing, 'p:p1:secrets', await lockSecrets(OTHER, 'other pass'));
    await expect(app.setSecrets(OTHER)).rejects.toBeInstanceOf(KeyLockedElsewhereError);
  });

  it('(c) the storage listener is removed on destroy', async () => {
    const backing = plainShared();
    const a = make(backing);
    const b = make(backing);
    a.destroy();
    await b.setSecrets(SECRETS, 'correct horse');
    window.dispatchEvent(new StorageEvent('storage', { key: 'gazua:v1:p:p1:secrets' }));
    expect(a.secrets).toEqual(SECRETS);
    expect(a.route.name).not.toBe('unlock');
  });
});

describe('createApp — lock while switching profiles', () => {
  it('setSecrets with a passphrase rejects (nothing saved) when the profile changes while sealing', async () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_TWO);
    seed(backing, 'p:p1:settings', { onboarded: true });
    seed(backing, 'p:p2:settings', { onboarded: true });
    const app = make(backing);
    app.switchProfile('p1');
    const pending = app.setSecrets(SECRETS, 'correct horse');
    app.switchProfile('p2');
    await expect(pending).rejects.toThrow(/profile changed/);
    expect(backing.getItem('gazua:v1:p:p1:secrets')).toBeNull();
    expect(backing.getItem('gazua:v1:p:p2:secrets')).toBeNull();
  });
});

describe('criteria route', () => {
  function withCriteria() {
    const backing = memoryBacking();
    seed(backing, 'meta', META_ONE);
    seed(backing, 'p:p1:settings', { onboarded: true });
    seed(backing, 'p:p1:watchlists', lists('g1'));
    const app = make(backing);
    app.setCriteria([{ ...newCriteria(1, null), id: 'c1' }]);
    return app;
  }

  it('keeps the list, an existing criteria and its result', () => {
    const app = withCriteria();
    app.navigate({ name: 'simulate', tab: 'criteria' });
    expect(app.route).toEqual({ name: 'simulate', tab: 'criteria' });
    expect(location.hash).toBe('#/simulate/criteria');
    fireHash('#/simulate/criteria/c1');
    expect(app.route).toEqual({ name: 'simulate', tab: 'criteria', criteriaId: 'c1' });
    fireHash('#/simulate/criteria/c1/result');
    expect(app.route).toEqual({ name: 'simulate', tab: 'criteria', criteriaId: 'c1', view: 'result' });
    expect(location.hash).toBe('#/simulate/criteria/c1/result');
  });

  it('an unknown criteria becomes the criteria list with a notice', () => {
    const app = withCriteria();
    fireHash('#/simulate/criteria/nope');
    expect(app.route).toEqual({ name: 'simulate', tab: 'criteria' });
    expect(location.hash).toBe('#/simulate/criteria');
    expect(app.routeNotice).toBe('선정 기준을 찾을 수 없어요');
  });
});

describe('simulate route', () => {
  function withStrategy() {
    const backing = memoryBacking();
    seed(backing, 'meta', META_ONE);
    seed(backing, 'p:p1:settings', { onboarded: true });
    seed(backing, 'p:p1:watchlists', lists('g1'));
    const app = make(backing);
    app.setStrategies([newStrategy(1, 'g1', '전략')].map((x) => ({ ...x, id: 'abc' })));
    return app;
  }

  it('navigate keeps strategyId for simulate', () => {
    const app = withStrategy();
    app.navigate({ name: 'simulate', strategyId: 'abc' });
    expect(app.route).toEqual({ name: 'simulate', strategyId: 'abc' });
    expect(location.hash).toBe('#/simulate/abc');
  });

  it('hashchange keeps it too', () => {
    const app = withStrategy();
    fireHash('#/simulate/abc');
    expect(app.route).toEqual({ name: 'simulate', strategyId: 'abc' });
  });

  it('an unknown strategy becomes the list, rewrites the hash and leaves a notice', () => {
    const app = withStrategy();
    fireHash('#/simulate/nope');
    expect(app.route).toEqual({ name: 'simulate' });
    expect(location.hash).toBe('#/simulate');
    expect(app.routeNotice).toBe('전략을 찾을 수 없어요');
    app.clearRouteNotice();
    expect(app.routeNotice).toBeNull();
  });
});

describe('help route', () => {
  it('keeps the help page id, and an unknown page becomes the help list with a notice', () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_ONE);
    seed(backing, 'p:p1:settings', { onboarded: true });
    seed(backing, 'p:p1:watchlists', lists('g1'));
    const app = make(backing);
    app.navigate({ name: 'help', helpId: 'performance' });
    expect(app.route).toEqual({ name: 'help', helpId: 'performance' });
    expect(location.hash).toBe('#/help/performance');
    fireHash('#/help/nope');
    expect(app.route).toEqual({ name: 'help' });
    expect(location.hash).toBe('#/help');
    expect(app.routeNotice).toBe('도움말을 찾을 수 없어요');
  });
});

describe('cross-tab profile removal', () => {
  // Codex 리뷰(PR #39) 5: 다른 탭이 지금 프로필을 지우면(원격 삭제 적용) 이 탭도 남은 프로필로 옮긴다.
  it('another tab removing the active profile switches this tab to a remaining one', () => {
    const backing = memoryBacking();
    seed(backing, 'meta', { ...META_TWO, activeProfileId: 'p2' });
    seed(backing, 'p:p1:settings', { onboarded: true });
    seed(backing, 'p:p2:settings', { onboarded: true });
    seed(backing, 'p:p1:watchlists', lists('g1'));
    seed(backing, 'p:p2:watchlists', lists('g2'));
    const app = make(backing);
    app.switchProfile('p2');
    expect(app.meta.activeProfileId).toBe('p2');
    const fresh = { ...META_ONE, activeProfileId: 'p1' };
    backing.setItem('gazua:v1:meta', JSON.stringify(fresh));
    window.dispatchEvent(new StorageEvent('storage', { key: 'gazua:v1:meta', newValue: JSON.stringify(fresh) }));
    expect(app.meta.profiles.map((p) => p.id)).toEqual(['p1']);
    expect(app.meta.activeProfileId).toBe('p1');
    expect(app.watchlists.groups.map((g) => g.id)).toEqual(['g1']);
  });
});

describe('order cache (내 성과)', () => {
  const entry = { orders: [], syncedAt: 1, syncedThrough: '2026-10-01' };
  function makeWith(backing: Storage | null) {
    const stored = createMemoryOrderCache();
    const app = createApp({ storage: createSafeStorage(backing), now, orderCache: stored });
    apps.push(app);
    return { app, stored };
  }

  it('uses the stored cache without a key lock, and a tab-only cache with one', async () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_ONE);
    const { app, stored } = makeWith(backing);
    await app.orderCache.put('p1|toss|3', entry);
    expect(await stored.get('p1|toss|3')).toEqual(entry);
    await app.setSecrets(SECRETS, 'correct horse');
    await app.orderCache.put('p1|toss|4', entry);
    expect(await app.orderCache.get('p1|toss|4')).toEqual(entry);
    expect(await stored.get('p1|toss|4')).toBeUndefined();
  });

  it('turning the key lock on, clearing keys, and deleting a profile remove that profile’s orders', async () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_TWO);
    const { app, stored } = makeWith(backing);
    await stored.put('p1|toss|3', entry);
    await stored.put('p2|toss|3', entry);
    app.deleteProfile('p2');
    await vi.waitFor(async () => expect(await stored.get('p2|toss|3')).toBeUndefined());
    expect(await stored.get('p1|toss|3')).toEqual(entry);
    await app.setSecrets(SECRETS, 'correct horse');
    await vi.waitFor(async () => expect(await stored.get('p1|toss|3')).toBeUndefined());
    await stored.put('p1|toss|3', entry);
    app.clearSecrets();
    await vi.waitFor(async () => expect(await stored.get('p1|toss|3')).toBeUndefined());
  });

  it('remembers the performance benchmark and rejects unknown values', () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_ONE);
    const { app } = makeWith(backing);
    expect(app.settings.perfBenchmark).toBeNull();
    app.updateSettings({ perfBenchmark: '069500' });
    expect(make(backing).settings.perfBenchmark).toBe('069500');
    seed(backing, 'p:p1:settings', { ...DEFAULT_SETTINGS, perfBenchmark: 'NASDAQ' });
    expect(make(backing).settings.perfBenchmark).toBeNull();
  });

  // PR 리뷰: 키를 지우거나 잠금을 켠 뒤에는, 그 전에 시작한 주문 받기가 끝나도 다시 저장하지 않는다
  it('a cache handed out before the keys were cleared or locked no longer saves', async () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_ONE);
    const { app, stored } = makeWith(backing);
    await app.setSecrets(SECRETS);
    const before = app.orderCache;
    app.clearSecrets();
    await before.put('p1|toss|3', entry);
    expect(await stored.get('p1|toss|3')).toBeUndefined();

    const again = app.orderCache;
    await app.setSecrets(SECRETS, 'correct horse');
    await again.put('p1|toss|3', entry);
    expect(await stored.get('p1|toss|3')).toBeUndefined();
    // 새로 받은 캐시(잠금 중이라 탭 메모리)는 그대로 쓴다
    await app.orderCache.put('p1|toss|3', entry);
    expect(await app.orderCache.get('p1|toss|3')).toEqual(entry);
    expect(await stored.get('p1|toss|3')).toBeUndefined();
  });

  // PR 리뷰: 다른 탭에서 키를 지우거나(storage 이벤트) 캐시를 비워도(BroadcastChannel) 이 탭의 진행 중인 받기가 다시 저장하지 않는다
  it('keys cleared in another tab stop this tab from saving', async () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_ONE);
    seed(backing, 'p:p1:secrets', SECRETS);
    const { app, stored } = makeWith(backing);
    const inFlight = app.orderCache;
    backing.removeItem('gazua:v1:p:p1:secrets');
    window.dispatchEvent(new StorageEvent('storage', { key: 'gazua:v1:p:p1:secrets', oldValue: JSON.stringify(SECRETS), newValue: null }));
    await inFlight.put('p1|toss|3', entry);
    expect(await stored.get('p1|toss|3')).toBeUndefined();
  });

  it('orders forgotten in another tab stop this tab from saving', async () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_ONE);
    const a = makeWith(backing);
    const b = createApp({ storage: createSafeStorage(backing), now, orderCache: a.stored });
    apps.push(b);
    const inFlight = b.orderCache;
    await a.app.orderCache.removeProfile('p1');
    // 채널 메시지는 비동기로 닿는다
    await new Promise((r) => setTimeout(r, 30));
    await inFlight.put('p1|toss|3', entry);
    expect(await a.stored.get('p1|toss|3')).toBeUndefined();
  });
});
