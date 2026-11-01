// 프로필별 전략 목록의 읽기·쓰기. 저장 모양은 { strategies: Strategy[] }(v2, 키 strategySet).
// 옛 키(strategies, v1)만 있으면 옮겨 새 키에 쓰고 옛 키는 그대로 둔다(백업, 스펙 §8.2).
import { profileKeys } from '../state/profileStore';
import type { SafeStorage } from '../state/storage';
import { MAX_STRATEGIES } from './defaults';
import type { Strategy } from './types';
import { sanitizeStrategiesV1, toV2 } from './strategyV1';
import { sanitizeStrategiesV2 } from './strategyV2';

const listShape = (raw: unknown): boolean =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw) && Array.isArray((raw as { strategies?: unknown }).strategies);

/** 읽을 때 검증한다. 모양이 깨졌거나 고친 것이 있으면 저장소 배너로 알린다. 옮기기는 고침이 아니라 알리지 않는다 */
export function loadStrategies(st: SafeStorage, profileId: string): Strategy[] {
  const key = profileKeys.strategySet(profileId);
  const raw = st.get<unknown>(key, null);
  if (raw !== null) {
    const { strategies, repaired } = sanitizeStrategiesV2(raw);
    if (repaired || !listShape(raw)) st.reportCorrupt(key);
    return strategies;
  }
  const oldKey = profileKeys.strategies(profileId);
  const old = st.get<unknown>(oldKey, null);
  if (old === null) return [];
  const { strategies, repaired } = sanitizeStrategiesV1(old);
  if (repaired || !listShape(old)) st.reportCorrupt(oldKey);
  const next = strategies.map(toV2);
  st.trySet(key, { strategies: next }); // 실패하면 메모리로만 쓰고 다음 읽기에서 다시 옮긴다(옛 키가 그대로라 결과가 같다)
  return next;
}

/** 한도 문구. 오류와 화면 스낵바가 같은 문구를 쓴다. */
export const STRATEGY_CAP_MESSAGE = `전략은 ${MAX_STRATEGIES}개까지 저장할 수 있어요`;

/** 저장 한도를 넘으면 던진다. 앱 상태와 저장소가 같은 문구·기준을 쓴다. */
export function assertStrategyCap(list: Strategy[]): void {
  if (list.length > MAX_STRATEGIES) throw new Error(STRATEGY_CAP_MESSAGE);
}

export function saveStrategies(st: SafeStorage, profileId: string, list: Strategy[]): void {
  assertStrategyCap(list);
  st.set(profileKeys.strategySet(profileId), { strategies: list });
}
