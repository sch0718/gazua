// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import price005930 from '../providers/fixtures/kis/inquire-price-005930.json';
import tokenFixture from '../providers/fixtures/kis/token.json';
import { kstEpoch } from '../time/kst';
import { createApp, type App } from './app.svelte';
import { DEFAULT_SETTINGS, type Meta, type Settings, type Watchlists } from './schema';
import { WrongPassphraseError, isLocked, lockSecrets, type Secrets } from './secrets';
import { createSafeStorage } from './storage';
import { memoryBacking, seed } from './testStorage';

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
    const app = make(backing);
    app.switchProfile('p2');
    app.deleteProfile('p2');
    expect(app.meta.activeProfileId).toBe('p1');
    expect(app.meta.profiles.map((p) => p.id)).toEqual(['p1']);
    expect(backing.dump()).not.toContain('p:p2:');
    expect(() => app.deleteProfile('p1')).toThrow();
    expect(app.meta.profiles).toHaveLength(1);
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
