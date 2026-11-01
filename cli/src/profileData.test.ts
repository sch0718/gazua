import { describe, expect, it } from 'vitest';
import { CliError } from './errors';
import { createSyncClient } from './syncClient';
import { findStrategy, loadAllProfiles, normalizeDoc, pickProfile } from './profileData';
import { profileDoc, syncServer } from './testing';
import { fullStrategyV2 } from '../../src/lib/sim/testStrategyV2';

const NOW = Date.UTC(2026, 10, 2);
const clientFor = (profiles: Parameters<typeof syncServer>[0]) => createSyncClient({ server: 'https://sync.example', token: `gzc_${'A'.repeat(43)}`, fetchImpl: syncServer(profiles) });
const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return { code: (e as CliError).code, data: (e as CliError).data };
  }
  return { code: 'no-error', data: undefined };
};

describe('normalizeDoc', () => {
  it('v1 문서는 전략을 v2로 옮겨 읽는다(매수 조건은 반등 패턴 블록 하나)', () => {
    const d = normalizeDoc(profileDoc(1), NOW);
    expect(d.name).toBe('내 프로필');
    expect(d.strategies).toHaveLength(1);
    expect(d.strategies[0]).toMatchObject({ v: 2, id: 's1', name: '눌림목' });
    expect(d.strategies[0].rules.buy[0].conds[0].kind).toBe('pattern');
    expect(d.watchlists.groups[0].items.map((i) => [i.symbol, i.hidden])).toEqual([['005930', false], ['000660', true]]);
  });

  it('v2 문서는 그대로', () => {
    const d = normalizeDoc(profileDoc(2), NOW);
    expect(d.strategies[0]).toEqual(fullStrategyV2());
  });

  it('v가 2보다 높으면 app-outdated, 모양이 이상하면 internal', () => {
    expect(() => normalizeDoc({ ...profileDoc(2), v: 3 }, NOW)).toThrow(expect.objectContaining({ code: 'app-outdated' }));
    expect(() => normalizeDoc('x', NOW)).toThrow(expect.objectContaining({ code: 'internal' }));
  });
});

describe('pickProfile', () => {
  const two = { p1: { doc: profileDoc(2, '내 프로필'), revision: 12 }, p2: { doc: profileDoc(2, '회사'), revision: 3 }, gone: { doc: profileDoc(2, '지운 것'), deleted: true } };

  it('삭제 안 된 프로필이 하나면 --profile 없이 그것', async () => {
    const p = await pickProfile(clientFor({ p1: two.p1, gone: two.gone }), undefined, NOW);
    expect(p).toMatchObject({ id: 'p1', name: '내 프로필', revision: 12 });
  });

  it('여럿인데 --profile이 없으면 profile-required(목록은 삭제 안 된 것만)', async () => {
    expect(await codeOf(pickProfile(clientFor(two), undefined, NOW))).toEqual({
      code: 'profile-required',
      data: { profiles: [{ id: 'p1', name: '내 프로필' }, { id: 'p2', name: '회사' }] },
    });
  });

  it('--profile은 ID가 먼저, 아니면 이름', async () => {
    expect((await pickProfile(clientFor(two), 'p2', NOW)).name).toBe('회사');
    expect((await pickProfile(clientFor(two), '회사', NOW)).id).toBe('p2');
    expect((await codeOf(pickProfile(clientFor(two), '없는 이름', NOW))).code).toBe('profile-not-found');
    expect((await codeOf(pickProfile(clientFor(two), 'gone', NOW))).code).toBe('profile-not-found');
  });

  it('ID와 다른 프로필 이름이 겹쳐도 ID가 우선이다', async () => {
    const collision = { p1: two.p1, p2: { doc: profileDoc(2, 'p1') } };
    expect((await pickProfile(clientFor(collision), 'p1', NOW)).name).toBe('내 프로필');
  });

  it('같은 이름이 둘이면 profile-required, 프로필이 없으면 profile-not-found', async () => {
    const same = { a: { doc: profileDoc(2, '같은') }, b: { doc: profileDoc(2, '같은') } };
    expect(await codeOf(pickProfile(clientFor(same), '같은', NOW))).toEqual({
      code: 'profile-required', data: { profiles: [{ id: 'a', name: '같은' }, { id: 'b', name: '같은' }] },
    });
    expect((await codeOf(pickProfile(clientFor({}), undefined, NOW))).code).toBe('profile-not-found');
  });

  it('loadAllProfiles는 삭제 안 된 프로필 전부', async () => {
    expect((await loadAllProfiles(clientFor(two), NOW)).map((p) => p.id)).toEqual(['p1', 'p2']);
  });
});

describe('findStrategy', () => {
  const a = { ...fullStrategyV2(), id: 'a', name: '같은 이름' };
  const b = { ...fullStrategyV2(), id: 'b', name: '같은 이름' };
  const c = { ...fullStrategyV2(), id: 'c', name: '다른 이름' };

  it('이름 정확 일치가 먼저, 없으면 ID', () => {
    expect(findStrategy([a, c], '다른 이름').id).toBe('c');
    expect(findStrategy([a, c], 'a').id).toBe('a');
    expect(findStrategy([a, { ...c, name: 'a' }], 'a').id).toBe('c');
  });

  it('같은 이름이 여럿이면 ambiguous-strategy(후보 ID), 없으면 strategy-not-found', () => {
    expect(() => findStrategy([a, b, c], '같은 이름')).toThrow(expect.objectContaining({ code: 'ambiguous-strategy', data: { matches: [{ id: 'a', name: '같은 이름' }, { id: 'b', name: '같은 이름' }] } }));
    expect(() => findStrategy([a], 'zzz')).toThrow(expect.objectContaining({ code: 'strategy-not-found' }));
    expect(findStrategy([a, b], 'b').id).toBe('b');
  });

  it('중복된 이름과 ID가 겹쳐도 이름의 모호성을 보고한다', () => {
    const collision = { ...c, id: '같은 이름' };
    expect(() => findStrategy([a, b, collision], '같은 이름')).toThrow(expect.objectContaining({
      code: 'ambiguous-strategy', data: { matches: [{ id: 'a', name: '같은 이름' }, { id: 'b', name: '같은 이름' }] },
    }));
  });
});
