// 프로필별 전략 목록의 읽기·쓰기. 저장 모양은 { strategies: Strategy[] }.
import { profileKeys } from '../state/profileStore';
import type { SafeStorage } from '../state/storage';
import { MAX_STRATEGIES } from './defaults';
import type { Strategy } from './types';
import { sanitizeStrategies } from './validate';

/** 읽을 때 검증한다. 모양이 깨졌거나 고친 것이 있으면 저장소 배너로 알리고, 저장된 값은 덮어쓰지 않는다. */
export function loadStrategies(st: SafeStorage, profileId: string): Strategy[] {
  const key = profileKeys.strategies(profileId);
  const raw = st.get<unknown>(key, null);
  if (raw === null) return [];
  const { strategies, repaired } = sanitizeStrategies(raw);
  const shapeOk = typeof raw === 'object' && !Array.isArray(raw) && Array.isArray((raw as { strategies?: unknown }).strategies);
  if (repaired || !shapeOk) st.reportCorrupt(key);
  return strategies;
}

/** 저장 한도를 넘으면 던진다. 앱 상태와 저장소가 같은 문구·기준을 쓴다. */
export function assertStrategyCap(list: Strategy[]): void {
  if (list.length > MAX_STRATEGIES) throw new Error(`전략은 ${MAX_STRATEGIES}개까지 저장할 수 있어요`);
}

export function saveStrategies(st: SafeStorage, profileId: string, list: Strategy[]): void {
  assertStrategyCap(list);
  st.set(profileKeys.strategies(profileId), { strategies: list });
}
