import { describe, expect, it } from 'vitest';
import { newStrategy } from '../sim/defaults';
import { IMPORT_BAD_FORMAT, exportData, exportFileName, importData } from './exportImport';
import { kstEpoch } from '../time/kst';
import { loadStrategies } from '../sim/strategyStore';
import { newCriteria } from '../screen/defaults';
import { loadCriteria } from '../screen/criteriaStore';
import { loadBaskets, newBasket } from '../screen/baskets';
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

  it('a period the app cannot step through ([ ] shortcuts), e.g. W9, falls back to the default', () => {
    const { st } = source();
    const json = JSON.stringify({
      format: 'gazua-export',
      schemaVersion: 1,
      profile: { name: '회사' },
      settings: { period: { unit: 'W', n: 9 } },
      watchlists: LISTS,
    });
    const res = importData(st, json);
    if (!res.ok) throw new Error('import failed');
    expect(loadSettings(st, res.profileId).period).toEqual(DEFAULT_SETTINGS.period);
  });
});

describe('importData — hardening', () => {
  const file = (extra: Record<string, unknown>) =>
    JSON.stringify({ format: 'gazua-export', schemaVersion: 1, profile: { name: '회사' }, settings: {}, watchlists: LISTS, ...extra });

  it('normalises the proxy URL and drops an unusable one', () => {
    const { st } = source();
    const a = importData(st, file({ settings: { proxyUrl: ' https://p.example.net/ ' } }));
    expect(a.ok && loadSettings(st, a.profileId).proxyUrl).toBe('https://p.example.net');
    const b = importData(st, file({ settings: { proxyUrl: 'javascript:alert(1)' } }));
    expect(b.ok && loadSettings(st, b.profileId).proxyUrl).toBe('');
  });

  it('copies only the known fields of a locked blob', async () => {
    const { st } = source();
    const locked = await lockSecrets(SECRETS, 'pass1234');
    const res = importData(st, file({ secrets: { ...locked, extra: 'x'.repeat(10) } }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(st.get(profileKeys.secrets(res.profileId), null)).toEqual(locked);
  });

  it('caps the profile name at 30 characters', () => {
    const { st } = source();
    const res = importData(st, file({ profile: { name: '가'.repeat(50) } }));
    const meta = st.get<Meta>(META_KEY, META);
    expect(res.ok && meta.profiles.at(-1)!.name).toBe(`${'가'.repeat(30)} (가져옴)`);
  });

  it('rejects duplicate symbols or colour slots within a group', () => {
    const { st } = source();
    const item = (symbol: string, colorSlot: number) => ({ symbol, colorSlot, hidden: false, addedAt: 1 });
    const dupSymbol = { groups: [{ id: 'g', name: 'n', items: [item('005930', 1), item('005930', 2)] }] };
    const dupSlot = { groups: [{ id: 'g', name: 'n', items: [item('005930', 1), item('000660', 1)] }] };
    expect(importData(st, file({ watchlists: dupSymbol }))).toEqual({ ok: false, reason: '파일 형식이 맞지 않아요' });
    expect(importData(st, file({ watchlists: dupSlot }))).toEqual({ ok: false, reason: '파일 형식이 맞지 않아요' });
  });
});

describe('exportFileName', () => {
  it('uses the profile name and the KST date, replacing characters files cannot have', () => {
    expect(exportFileName('내 프로필', kstEpoch('2026-10-12', '23:30:00'))).toBe('gazua-내 프로필-2026-10-12.json');
    expect(exportFileName('a/b:c', kstEpoch('2026-10-12', '00:10:00'))).toBe('gazua-a_b_c-2026-10-12.json');
  });
});

describe('strategies in export files', () => {
  const strat = { ...newStrategy(1_700_000_000_000, 'g1', '전략'), id: 's1' };

  it('내보낸 JSON에 strategies가 있고 가져온 새 프로필에 같은 전략이 저장된다', () => {
    const { st, backing } = source();
    seed(backing, profileKeys.strategies('p1'), { strategies: [strat] });
    const json = exportData(st, 'p1', false);
    expect(JSON.parse(json).strategies).toEqual([strat]);
    const res = importData(st, json);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(JSON.parse(backing.getItem(`gazua:v1:${profileKeys.strategies(res.profileId)}`)!)).toEqual({ strategies: [strat] });
  });

  it('strategies가 없는 옛 파일도 가져오고 목록은 []', () => {
    const { st, backing } = source();
    const parsed = JSON.parse(exportData(st, 'p1', false));
    delete parsed.strategies;
    const res = importData(st, JSON.stringify(parsed));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const raw = backing.getItem(`gazua:v1:${profileKeys.strategies(res.profileId)}`);
    expect(JSON.parse(raw!)).toEqual({ strategies: [] });
  });

  it('전략이 20개를 넘거나 id가 겹치면 20개까지, 중복은 뺀다', () => {
    const { st, backing } = source();
    const parsed = JSON.parse(exportData(st, 'p1', false));
    const many = Array.from({ length: 21 }, (_, i) => ({ ...strat, id: `s${i}` }));
    parsed.strategies = [...many, { ...strat, id: 's0' }];
    const res = importData(st, JSON.stringify(parsed));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const saved = JSON.parse(backing.getItem(`gazua:v1:${profileKeys.strategies(res.profileId)}`)!).strategies;
    expect(saved).toHaveLength(20);
    expect(new Set(saved.map((x: { id: string }) => x.id)).size).toBe(20);
    parsed.strategies = [strat, { ...strat }, { ...strat, id: 's2' }];
    const res2 = importData(st, JSON.stringify(parsed));
    if (!res2.ok) throw new Error('expected ok');
    const saved2 = JSON.parse(backing.getItem(`gazua:v1:${profileKeys.strategies(res2.profileId)}`)!).strategies;
    expect(saved2.map((x: { id: string }) => x.id)).toEqual(['s1', 's2']);
  });

  it('가져온 전략의 빈 id 항목은 버리고, 소수 이동평균 기간은 기본값으로 저장한다', () => {
    const { st, backing } = source();
    const parsed = JSON.parse(exportData(st, 'p1', false));
    const bad = { ...strat, id: 's2', entry: { ...strat.entry, filter: { aboveMa: { on: true, period: 2.5 } } } };
    parsed.strategies = [{ ...strat, id: '' }, bad];
    const res = importData(st, JSON.stringify(parsed));
    if (!res.ok) throw new Error('expected ok');
    const saved = JSON.parse(backing.getItem(`gazua:v1:${profileKeys.strategies(res.profileId)}`)!).strategies;
    expect(saved.map((x: { id: string }) => x.id)).toEqual(['s2']);
    expect(saved[0].entry.filter.aboveMa).toEqual({ on: true, period: 60 });
  });

  it('그룹이 0개인 파일은 형식 오류', () => {
    const { st } = source();
    const parsed = JSON.parse(exportData(st, 'p1', false));
    parsed.watchlists = { groups: [] };
    expect(importData(st, JSON.stringify(parsed))).toEqual({ ok: false, reason: IMPORT_BAD_FORMAT });
  });

  it('strategies가 배열이 아니면 형식 오류', () => {
    const { st } = source();
    const parsed = JSON.parse(exportData(st, 'p1', false));
    parsed.strategies = 'x';
    expect(importData(st, JSON.stringify(parsed))).toEqual({ ok: false, reason: IMPORT_BAD_FORMAT });
  });
});

describe('importData — repaired flag', () => {
  const strat = { ...newStrategy(1_700_000_000_000, 'g1', '전략'), id: 's1' };
  const file = (extra: Record<string, unknown>) =>
    JSON.stringify({ format: 'gazua-export', schemaVersion: 1, profile: { name: '회사' }, settings: {}, watchlists: LISTS, ...extra });

  it('깨끗한 파일은 repaired false', () => {
    const { st } = source();
    expect(importData(st, exportData(st, 'p1', false))).toMatchObject({ ok: true, repaired: false });
    expect(importData(st, file({ strategies: [strat] }))).toMatchObject({ ok: true, repaired: false });
  });

  it('선택 필드 strategies가 아예 없는 파일은 repaired false(없는 필드는 조용히 기본값)', () => {
    const { st } = source();
    expect(importData(st, file({}))).toMatchObject({ ok: true, repaired: false });
  });

  it('소수 이동평균 기간을 기본값으로 바꾸면 repaired true', () => {
    const { st } = source();
    const bad = { ...strat, entry: { ...strat.entry, filter: { aboveMa: { on: true, period: 2.5 } } } };
    expect(importData(st, file({ strategies: [bad] }))).toMatchObject({ ok: true, repaired: true });
  });

  it('마지막 익절 단계 sellPct가 100이 아니면 100으로 저장하고 repaired true, 이미 100이면 false', () => {
    const { st } = source();
    const withTp = (takeProfit: unknown) => ({ ...strat, exit: { ...strat.exit, takeProfit } });
    const res = importData(st, file({ strategies: [withTp([{ pct: 15, sellPct: 50 }])] }));
    expect(res).toMatchObject({ ok: true, repaired: true });
    if (!res.ok) return;
    expect(loadStrategies(st, res.profileId)[0].exit.takeProfit).toEqual([{ pct: 15, sellPct: 100 }]);
    expect(importData(st, file({ strategies: [withTp([{ pct: 15, sellPct: 100 }])] }))).toMatchObject({ ok: true, repaired: false });
  });

  it('빈 id 전략을 버리면 repaired true', () => {
    const { st } = source();
    expect(importData(st, file({ strategies: [{ ...strat, id: '' }, { ...strat, id: 's2' }] }))).toMatchObject({ ok: true, repaired: true });
  });

  it('문자열이 아닌 최근 종목을 버리면 repaired true', () => {
    const { st } = source();
    const res = importData(st, file({ recent: [1, '005930'] }));
    expect(res).toMatchObject({ ok: true, repaired: true });
    if (!res.ok) return;
    expect(loadRecent(st, res.profileId)).toEqual(['005930']);
  });

  it('맞지 않는 설정 필드를 기본값으로 바꾸면 repaired true', () => {
    const { st } = source();
    expect(importData(st, file({ settings: { provider: 'nope' } }))).toMatchObject({ ok: true, repaired: true });
  });
});

describe('criteria in export files', () => {
  const crit = { ...newCriteria(1_700_000_000_000, { from: '2021-03-02', to: '2026-10-15' }, '기준'), id: 'c1' };
  const file = (extra: Record<string, unknown>) =>
    JSON.stringify({ format: 'gazua-export', schemaVersion: 1, profile: { name: '회사' }, settings: {}, watchlists: LISTS, ...extra });

  it('내보낸 JSON에 criteria가 있고 가져온 새 프로필에 같은 기준이 저장된다(왕복)', () => {
    const { st, backing } = source();
    seed(backing, profileKeys.criteria('p1'), { criteria: [crit] });
    const json = exportData(st, 'p1', false);
    expect(JSON.parse(json).criteria).toEqual([crit]);
    const res = importData(st, json);
    expect(res).toMatchObject({ ok: true, repaired: false });
    if (!res.ok) return;
    expect(JSON.parse(backing.getItem(`gazua:v1:${profileKeys.criteria(res.profileId)}`)!)).toEqual({ criteria: [crit] });
    expect(loadCriteria(st, res.profileId)).toEqual([crit]);
  });

  it('criteria가 없는 옛 파일도 가져오고 목록은 [], repaired false', () => {
    const { st, backing } = source();
    const res = importData(st, file({}));
    expect(res).toMatchObject({ ok: true, repaired: false });
    if (!res.ok) return;
    expect(JSON.parse(backing.getItem(`gazua:v1:${profileKeys.criteria(res.profileId)}`)!)).toEqual({ criteria: [] });
  });

  it('criteria가 배열이 아니면 형식 오류', () => {
    const { st } = source();
    expect(importData(st, file({ criteria: 'x' }))).toEqual({ ok: false, reason: IMPORT_BAD_FORMAT });
  });

  it('범위 밖 take·빈 id는 고쳐 저장하고 repaired true', () => {
    const { st } = source();
    const bad = { ...crit, rank: { by: 'marketCap', take: 31 } };
    const res = importData(st, file({ criteria: [bad, { ...crit, id: '' }] }));
    expect(res).toMatchObject({ ok: true, repaired: true });
    if (!res.ok) return;
    const saved = loadCriteria(st, res.profileId);
    expect(saved).toHaveLength(1);
    expect(saved[0].rank.take).toBe(10);
  });

  it('20개를 넘으면 20개까지만 저장하고 repaired true', () => {
    const { st } = source();
    const many = Array.from({ length: 21 }, (_, i) => ({ ...crit, id: `c${i}` }));
    const res = importData(st, file({ criteria: many }));
    expect(res).toMatchObject({ ok: true, repaired: true });
    if (!res.ok) return;
    expect(loadCriteria(st, res.profileId)).toHaveLength(20);
  });
});

describe('baskets in export files', () => {
  const bk = { ...newBasket(1_700_000_000_000, '내 묶음', ['005930', '000660']), id: 'b1' };
  const file = (extra: Record<string, unknown>) =>
    JSON.stringify({ format: 'gazua-export', schemaVersion: 1, profile: { name: '회사' }, settings: {}, watchlists: LISTS, ...extra });

  it('내보낸 JSON에 baskets가 있고 가져온 새 프로필에 같은 묶음이 저장된다(왕복)', () => {
    const { st, backing } = source();
    seed(backing, profileKeys.baskets('p1'), { baskets: [bk] });
    const json = exportData(st, 'p1', false);
    expect(JSON.parse(json).baskets).toEqual([bk]);
    const res = importData(st, json);
    expect(res).toMatchObject({ ok: true, repaired: false });
    if (!res.ok) return;
    expect(loadBaskets(st, res.profileId)).toEqual([bk]);
  });

  it('baskets가 없는 옛 파일도 조용히 가져오고 목록은 [], repaired false', () => {
    const { st, backing } = source();
    const res = importData(st, file({}));
    expect(res).toMatchObject({ ok: true, repaired: false });
    if (!res.ok) return;
    expect(JSON.parse(backing.getItem(`gazua:v1:${profileKeys.baskets(res.profileId)}`)!)).toEqual({ baskets: [] });
  });

  it('baskets가 배열이 아니면 형식 오류, 깨진 항목은 고쳐 저장하고 repaired true', () => {
    const { st } = source();
    expect(importData(st, file({ baskets: 'x' }))).toEqual({ ok: false, reason: IMPORT_BAD_FORMAT });
    const res = importData(st, file({ baskets: [{ ...bk, symbols: ['005930', 'zz'] }] }));
    expect(res).toMatchObject({ ok: true, repaired: true });
    if (!res.ok) return;
    expect(loadBaskets(st, res.profileId)[0].symbols).toEqual(['005930']);
  });
});
