// 동기화 첫 주기 전 옮기기 단계(전략 빌더 §8.3). 엔진 주기와 겹치지 않게 engine.exclusive() 안에서 부른다.
// 새 키를 채우고 옮기기만으로 바뀐 해시를 앞당긴 뒤, 옛 탭이 남긴 앱 갱신 거절 기록을 지운다.
import { sanitizeStrategiesV1, toV2 } from '../sim/strategyV1';
import { loadStrategies } from '../sim/strategyStore';
import { profileKeys } from '../state/profileStore';
import type { SafeStorage } from '../state/storage';
import { APP_OUTDATED_CODE } from './dto';
import { docHash } from './hash';
import { profileDocBase } from './profileDoc';
import type { SyncStore } from './store';

export async function migrateStrategies(deps: {
  storage: SafeStorage;
  profiles: { id: string; name: string }[];
  store: Pick<SyncStore, 'state' | 'putState'>;
}): Promise<void> {
  const { storage, store } = deps;
  for (const p of deps.profiles) {
    loadStrategies(storage, p.id); // 새 키가 없으면 옛 키를 옮겨 쓴다
    const st = await store.state(p.id);
    if (!st) continue;
    let next = st;
    if (st.rejectedCode === APP_OUTDATED_CODE) {
      const { rejectedHash: _h, rejectedCode: _c, ...rest } = st;
      next = rest;
    }
    const raw = storage.get<unknown>(profileKeys.strategies(p.id), null);
    if (raw !== null) {
      // H1·H2 모두 옛 키로 계산한다. 새 키의 사용자 수정을 확인된 상태로 잘못 치지 않게 한다.
      const v1 = sanitizeStrategiesV1(raw).strategies;
      const base = profileDocBase(storage, p.id, p.name);
      const h1 = await docHash({ v: 1, ...base, strategies: v1 });
      if (next.syncedHash === h1) next = { ...next, syncedHash: await docHash({ v: 2, ...base, strategies: v1.map(toV2) }) };
    }
    if (next !== st) await store.putState(next);
  }
}
