import { describe, expect, it } from 'vitest';
import { newStrategyV1, toV2 } from '../sim/strategyV1';
import { loadStrategies, saveStrategies } from '../sim/strategyStore';
import { profileKeys } from '../state/profileStore';
import { createSafeStorage, type SafeStorage } from '../state/storage';
import { memoryBacking, seed } from '../state/testStorage';
import { APP_OUTDATED_CODE } from './dto';
import { docHash, stableJson } from './hash';
import { migrateStrategies } from './migrate';
import { buildProfileDoc, profileDocBase } from './profileDoc';
import { createMemorySyncStore } from './store';

const PID = 'p1';
function setup() {
  const backing = memoryBacking();
  seed(backing, `p:${PID}:watchlists`, { groups: [{ id: 'g0', name: '관심', items: [{ symbol: '005930', colorSlot: 1, hidden: false, addedAt: 1 }] }] });
  const v1 = { ...newStrategyV1(0, 'g0', '옛'), id: 's1' };
  seed(backing, `p:${PID}:strategies`, { strategies: [v1] });
  const st = createSafeStorage(backing);
  const store = createMemorySyncStore();
  return { st, v1, store, profiles: [{ id: PID, name: '내 프로필' }] };
}
const h1Of = async (st: SafeStorage, v1: unknown) => docHash({ v: 1, ...profileDocBase(st, PID, '내 프로필'), strategies: [v1] });

describe('migrateStrategies(§8.3)', () => {
  it('syncedHash가 H1이면 H2로 앞당기고 리비전은 그대로', async () => {
    const { st, v1, store, profiles } = setup();
    await store.putState({ profileId: PID, syncedRevision: 7, syncedHash: await h1Of(st, v1) });
    await migrateStrategies({ storage: st, profiles, store });
    const h2 = await docHash(buildProfileDoc(st, PID, '내 프로필'));
    expect(await store.state(PID)).toEqual({ profileId: PID, syncedRevision: 7, syncedHash: h2 });
    expect(st.get(profileKeys.strategySet(PID), null)).toEqual({ strategies: [toV2(v1)] });
    expect(st.get(`p:${PID}:strategySetBase`, null)).toMatchObject({ v1: stableJson([v1]), v2: stableJson([toV2(v1)]) });
  });
  it('syncedHash가 H1이 아니면(이 기기에 확인 안 된 수정) 앞당기지 않는다', async () => {
    const { st, store, profiles } = setup();
    await store.putState({ profileId: PID, syncedRevision: 7, syncedHash: 'other' });
    await migrateStrategies({ storage: st, profiles, store });
    expect((await store.state(PID))!.syncedHash).toBe('other');
  });
  it('멱등: 두 번 돌려도 같다', async () => {
    const { st, v1, store, profiles } = setup();
    await store.putState({ profileId: PID, syncedRevision: 7, syncedHash: await h1Of(st, v1) });
    await migrateStrategies({ storage: st, profiles, store });
    const once = await store.state(PID);
    await migrateStrategies({ storage: st, profiles, store });
    expect(await store.state(PID)).toEqual(once);
  });
  it('옮김 → 새 키 수정 → 재시작: 수정이 「변경 있음」으로 남는다', async () => {
    const { st, v1, store, profiles } = setup();
    await store.putState({ profileId: PID, syncedRevision: 7, syncedHash: await h1Of(st, v1) });
    await migrateStrategies({ storage: st, profiles, store });
    saveStrategies(st, PID, [{ ...loadStrategies(st, PID)[0], name: '고침' }]);
    await migrateStrategies({ storage: st, profiles, store });
    const local = await docHash(buildProfileDoc(st, PID, '내 프로필'));
    expect((await store.state(PID))!.syncedHash).not.toBe(local);
  });
  it('옛 탭이 남긴 「앱을 새로 고쳐 주세요」 거절 기록을 지운다', async () => {
    const { st, store, profiles } = setup();
    await store.putState({ profileId: PID, syncedRevision: 1, syncedHash: 'x', rejectedHash: 'r', rejectedCode: APP_OUTDATED_CODE });
    await migrateStrategies({ storage: st, profiles, store });
    expect(await store.state(PID)).toEqual({ profileId: PID, syncedRevision: 1, syncedHash: 'x' });
  });
  it('옛 키가 없어도 빈 전략 v1 해시가 확인됐으면 v2 해시로 앞당긴다', async () => {
    const st = createSafeStorage(memoryBacking());
    const store = createMemorySyncStore();
    const h1 = await docHash({ v: 1, ...profileDocBase(st, PID, '내 프로필'), strategies: [] });
    await store.putState({ profileId: PID, syncedRevision: 7, syncedHash: h1 });
    expect(st.get(profileKeys.strategies(PID), null)).toBeNull();

    await migrateStrategies({ storage: st, profiles: [{ id: PID, name: '내 프로필' }], store });

    const h2 = await docHash(buildProfileDoc(st, PID, '내 프로필'));
    expect(h2).not.toBe(h1);
    expect(await store.state(PID)).toEqual({ profileId: PID, syncedRevision: 7, syncedHash: h2 });
    expect(st.get(profileKeys.strategies(PID), null)).toBeNull();
  });
  it('옛 키가 없어도 실제 수정으로 v1 해시가 다르면 확인 해시를 그대로 둔다', async () => {
    const st = createSafeStorage(memoryBacking());
    const store = createMemorySyncStore();
    const h1 = await docHash({ v: 1, ...profileDocBase(st, PID, '내 프로필'), strategies: [] });
    const state = { profileId: PID, syncedRevision: 7, syncedHash: h1 };
    await store.putState(state);

    await migrateStrategies({ storage: st, profiles: [{ id: PID, name: '이 기기에서 고침' }], store });

    expect(await store.state(PID)).toEqual(state);
  });
  it('옛 키가 없는 프로필도 확인 해시가 다르면 건드리지 않는다', async () => {
    const st = createSafeStorage(memoryBacking());
    const store = createMemorySyncStore();
    await store.putState({ profileId: PID, syncedRevision: 1, syncedHash: 'x' });
    await migrateStrategies({ storage: st, profiles: [{ id: PID, name: 'a' }], store });
    expect((await store.state(PID))!.syncedHash).toBe('x');
  });
});
