import { describe, expect, it } from 'vitest';
import { exportData, exportFileName, importData } from './exportImport';
import { kstEpoch } from '../time/kst';
import { loadRecent, loadSettings, loadStoredSecrets, loadWatchlists, profileKeys } from './profileStore';
import { DEFAULT_SETTINGS, META_KEY, type Meta, type Watchlists } from './schema';
import { lockSecrets, type Secrets } from './secrets';
import { createSafeStorage, type SafeStorage } from './storage';
import { memoryBacking, seed } from './testStorage';

const SECRETS: Secrets = {
  kis: { appKey: 'PSkisAppKey-0123456789', appSecret: 'kisSecret/ABCDEFGHIJKLMNOP' },
  proxyToken: 'proxy-token-xyz-424242',
};
const LISTS: Watchlists = {
  groups: [
    {
      id: 'g1',
      name: '반도체',
      items: [
        { symbol: '005930', colorSlot: 1, hidden: false, addedAt: 10 },
        { symbol: '000660', colorSlot: 2, hidden: true, addedAt: 11 },
      ],
    },
  ],
};
const META: Meta = { schemaVersion: 1, activeProfileId: 'p1', profiles: [{ id: 'p1', name: '내 프로필', createdAt: 1 }] };
const TOKEN = { accessToken: 'secret-access-token-777', expiresAt: 9e12 };

function source(secrets: unknown = SECRETS): { st: SafeStorage; backing: ReturnType<typeof memoryBacking> } {
  const backing = memoryBacking();
  seed(backing, META_KEY, META);
  seed(backing, profileKeys.settings('p1'), { ...DEFAULT_SETTINGS, provider: 'kis', proxyUrl: 'https://p.example', onboarded: true });
  seed(backing, profileKeys.watchlists('p1'), LISTS);
  seed(backing, profileKeys.recent('p1'), ['000660', '005930']);
  seed(backing, profileKeys.secrets('p1'), secrets);
  seed(backing, profileKeys.token('p1', 'kis'), TOKEN);
  return { st: createSafeStorage(backing), backing };
}

describe('exportData', () => {
  it('leaves out secrets by default and never includes tokens', () => {
    const { st } = source();
    const out = exportData(st, 'p1', false);
    const parsed = JSON.parse(out);
    expect(parsed).toMatchObject({ format: 'gazua-export', schemaVersion: 1, profile: { name: '내 프로필' } });
    expect(parsed.settings.provider).toBe('kis');
    expect(parsed.watchlists).toEqual(LISTS);
    expect(parsed.recent).toEqual(['000660', '005930']);
    expect('secrets' in parsed).toBe(false);
    expect(out).not.toContain(SECRETS.kis!.appKey);
    expect(out).not.toContain(SECRETS.proxyToken!);
    expect(out).not.toContain(TOKEN.accessToken);
  });

  it('includes the stored secrets only when asked, still without tokens', () => {
    const { st } = source();
    const out = exportData(st, 'p1', true);
    expect(JSON.parse(out).secrets).toEqual(SECRETS);
    expect(out).not.toContain(TOKEN.accessToken);
  });

  it('exports a locked secrets blob as-is', async () => {
    const locked = await lockSecrets(SECRETS, 'pass1234');
    const { st } = source(locked);
    const parsed = JSON.parse(exportData(st, 'p1', true));
    expect(parsed.secrets).toEqual(locked);
    expect(JSON.stringify(parsed)).not.toContain(SECRETS.kis!.appKey);
  });
});

describe('importData', () => {
  it('round-trips into a NEW profile named "(가져옴)" and keeps the current one active', () => {
    const { st } = source();
    const json = exportData(st, 'p1', false);
    const res = importData(st, json, () => 5);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.profileId).not.toBe('p1');
    const meta = st.get<Meta>(META_KEY, META);
    expect(meta.activeProfileId).toBe('p1');
    expect(meta.profiles.map((p) => p.name)).toEqual(['내 프로필', '내 프로필 (가져옴)']);
    expect(meta.profiles[1]).toMatchObject({ id: res.profileId, createdAt: 5 });
    expect(loadWatchlists(st, res.profileId)).toEqual(LISTS);
    expect(loadRecent(st, res.profileId)).toEqual(['000660', '005930']);
    expect(loadSettings(st, res.profileId)).toMatchObject({ provider: 'kis', proxyUrl: 'https://p.example', keyLock: false });
    expect(loadStoredSecrets(st, res.profileId)).toEqual({ plain: null, locked: null });
    expect(st.get(profileKeys.token(res.profileId, 'kis'), null)).toBeNull();
  });

  it('imports plaintext secrets with keyLock off, and a locked blob with keyLock on', async () => {
    const { st } = source();
    const plain = importData(st, exportData(st, 'p1', true));
    expect(plain.ok && loadStoredSecrets(st, plain.profileId).plain).toEqual(SECRETS);
    expect(plain.ok && loadSettings(st, plain.profileId).keyLock).toBe(false);

    const locked = await lockSecrets(SECRETS, 'pass1234');
    const other = source(locked).st;
    const res = importData(st, exportData(other, 'p1', true));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(loadStoredSecrets(st, res.profileId).locked).toEqual(locked);
    expect(loadSettings(st, res.profileId).keyLock).toBe(true);
  });

  it('rejects broken JSON and foreign files with 파일 형식이 맞지 않아요', () => {
    const { st } = source();
    const before = st.get<Meta>(META_KEY, META);
    for (const bad of [
      '{not json',
      'null',
      '[]',
      JSON.stringify({ format: 'other', schemaVersion: 1 }),
      JSON.stringify({ format: 'gazua-export', schemaVersion: 1, settings: {}, watchlists: { groups: 'x' } }),
      JSON.stringify({
        format: 'gazua-export',
        schemaVersion: 1,
        profile: { name: 'x' },
        settings: {},
        watchlists: { groups: [{ id: 'g', name: 'n', items: [{ symbol: 5 }] }] },
      }),
      JSON.stringify({
        format: 'gazua-export',
        schemaVersion: 1,
        profile: { name: 'x' },
        settings: {},
        watchlists: LISTS,
        secrets: 'plain-string',
      }),
    ]) {
      expect(importData(st, bad)).toEqual({ ok: false, reason: '파일 형식이 맞지 않아요' });
    }
    expect(st.get<Meta>(META_KEY, META)).toEqual(before);
  });

  it('rejects another schemaVersion', () => {
    const { st } = source();
    const json = JSON.stringify({ ...JSON.parse(exportData(st, 'p1', false)), schemaVersion: 2 });
    expect(importData(st, json)).toEqual({ ok: false, reason: '지원하지 않는 버전이에요' });
  });

  it('falls back to defaults for unknown or invalid settings fields', () => {
    const { st } = source();
    const json = JSON.stringify({
      format: 'gazua-export',
      schemaVersion: 1,
      profile: { name: '회사' },
      settings: { provider: 'nope', theme: 'dark', period: { unit: 'X', n: 1 }, evil: true, keyLock: true },
      watchlists: LISTS,
    });
    const res = importData(st, json);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const s = loadSettings(st, res.profileId);
    expect(s.provider).toBe('demo');
    expect(s.theme).toBe('dark');
    expect(s.period).toEqual(DEFAULT_SETTINGS.period);
    expect(s.keyLock).toBe(false);
    expect('evil' in s).toBe(false);
  });
});

describe('exportFileName', () => {
  it('uses the profile name and the KST date, replacing characters files cannot have', () => {
    expect(exportFileName('내 프로필', kstEpoch('2026-10-12', '23:30:00'))).toBe('gazua-내 프로필-2026-10-12.json');
    expect(exportFileName('a/b:c', kstEpoch('2026-10-12', '00:10:00'))).toBe('gazua-a_b_c-2026-10-12.json');
  });
});
