// 동기화 첫 주기 전 옮기기 단계(전략 빌더 §8.3). 엔진 주기와 겹치지 않게 engine.exclusive() 안에서 부른다.
// 새 키를 채우고 옮기기만으로 바뀐 해시를 앞당긴 뒤, 옛 탭이 남긴 앱 갱신 거절 기록을 지운다.
import { toV2 } from '../sim/strategyV1';
import { loadStrategies } from '../sim/strategyStore';
import type { SafeStorage } from '../state/storage';
import { APP_OUTDATED_CODE } from './dto';
import { docHash } from './hash';
import { syncedV1Doc } from './profileDoc';
import type { SyncStore } from './store';

/** 확인된 v1에서만 v2 확인 해시를 구한다. 새 키의 실제 수정은 섞지 않는다. */
export async function migratedSyncedHash(storage: SafeStorage, id: string, name: string, hash: string): Promise<string | null> {
  const v1 = await syncedV1Doc(storage, id, name, hash);
  return v1 ? docHash({ ...v1, v: 2, strategies: v1.strategies.map(toV2) }) : null;
}

export async function migrateStrategies(deps: {
  storage: SafeStorage;
  profiles: { id: string; name: string }[];
  store: Pick<SyncStore, 'state' | 'putState'>;
}): Promise<void> {
  const { storage, store } = deps;
  for (const p of deps.profiles) {
    loadStrategies(storage, p.id); // 새 키를 채우고 옛 키만 바뀌었으면 다시 옮긴다
    const st = await store.state(p.id);
    if (!st) continue;
    let next = st;
    if (st.rejectedCode === APP_OUTDATED_CODE) {
      const { rejectedHash: _h, rejectedCode: _c, ...rest } = st;
      next = rest;
    }
    // H1·H2 모두 옛 키로 계산한다. 새 키의 사용자 수정을 확인된 상태로 잘못 치지 않게 한다.
    const hash = await migratedSyncedHash(storage, p.id, p.name, next.syncedHash);
    if (hash) next = { ...next, syncedHash: hash };
    if (next !== st) await store.putState(next);
  }
}
