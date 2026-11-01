// 프로필별 전략 목록의 읽기·쓰기. 저장 모양은 { strategies: Strategy[] }(v2, 키 strategySet).
// 옛 키(strategies, v1)만 있으면 옮겨 새 키에 쓰고 옛 키는 그대로 둔다(백업, 스펙 §8.2).
import { profileKeys } from '../state/profileStore';
import type { SafeStorage } from '../state/storage';
import { MAX_STRATEGIES } from './defaults';
import type { Strategy } from './types';
import { sanitizeStrategiesV1, toV2 } from './strategyV1';
import { sanitizeStrategiesV2 } from './strategyV2';
import { stableJson } from '../sync/hash';

type StrategySetBase = { v1: string; v2: string };

function readBase(st: SafeStorage, profileId: string): StrategySetBase | null {
  const base = st.get<unknown>(profileKeys.strategySetBase(profileId), null);
  if (typeof base !== 'object' || base === null) return null;
  const b = base as Partial<StrategySetBase>;
  return typeof b.v1 === 'string' && typeof b.v2 === 'string' ? b as StrategySetBase : null;
}

/** v1에서 옮긴 목록과 그 바탕을 함께 남긴다. 새 키 쓰기가 실패하면 다음 읽기에서 다시 옮긴다. */
function migrateStrategySet(st: SafeStorage, profileId: string, old: unknown): Strategy[] {
  const { strategies, repaired } = sanitizeStrategiesV1(old);
  if (old !== null && (repaired || !listShape(old))) st.reportCorrupt(profileKeys.strategies(profileId));
  const next = strategies.map(toV2);
  if (st.trySet(profileKeys.strategySet(profileId), { strategies: next })) {
    st.trySet(profileKeys.strategySetBase(profileId), { v1: fingerprint(old), v2: stableJson(next) });
  }
  return next;
}

const listShape = (raw: unknown): boolean =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw) && Array.isArray((raw as { strategies?: unknown }).strategies);

const fingerprint = (raw: unknown): string => stableJson(listShape(raw) ? (raw as { strategies: unknown[] }).strategies : []);

/** 정렬 JSON 지문에서 옮길 당시의 v1을 복원해 새 탭의 실제 수정을 구분한다. */
function derivedV2(base: StrategySetBase): string | null {
  try {
    return stableJson(sanitizeStrategiesV1({ strategies: JSON.parse(base.v1) }).strategies.map(toV2));
  } catch {
    return null;
  }
}

/** 새 키 저장 뒤에는 옛 바탕을 유지하고 v2 지문만 갱신한다. */
export function recordStrategySet(st: SafeStorage, profileId: string, list: Strategy[], fromV1 = false): void {
  const base = fromV1 ? null : readBase(st, profileId);
  const v1 = base?.v1 ?? fingerprint(st.get<unknown>(profileKeys.strategies(profileId), null));
  st.trySet(profileKeys.strategySetBase(profileId), { v1, v2: stableJson(list) });
}

/** 읽을 때 검증한다. 모양이 깨졌거나 고친 것이 있으면 저장소 배너로 알린다. 옮기기는 고침이 아니라 알리지 않는다 */
export function loadStrategies(st: SafeStorage, profileId: string): Strategy[] {
  const key = profileKeys.strategySet(profileId);
  const raw = st.get<unknown>(key, null);
  const old = st.get<unknown>(profileKeys.strategies(profileId), null);
  if (raw !== null) {
    const { strategies, repaired } = sanitizeStrategiesV2(raw);
    if (repaired || !listShape(raw)) st.reportCorrupt(key);
    const base = readBase(st, profileId);
    const v1 = fingerprint(old);
    const v2 = fingerprint(raw);
    if (!base) st.trySet(profileKeys.strategySetBase(profileId), { v1, v2 });
    else if (v1 !== base.v1 && v2 === base.v2 && v2 === derivedV2(base)) return migrateStrategySet(st, profileId, old);
    return strategies;
  }
  if (old === null) return [];
  return migrateStrategySet(st, profileId, old);
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
  recordStrategySet(st, profileId, list);
}
