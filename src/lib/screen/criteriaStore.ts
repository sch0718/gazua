// 프로필별 선정 기준 목록의 읽기·쓰기. 저장 모양은 { criteria: SelectionCriteria[] }.
import { profileKeys } from '../state/profileStore';
import type { SafeStorage } from '../state/storage';
import { MAX_CRITERIA } from './defaults';
import type { SelectionCriteria } from './types';
import { sanitizeCriteria } from './validate';

/** 읽을 때 검증한다. 모양이 깨졌거나 고친 것이 있으면 저장소 배너로 알리고, 저장된 값은 덮어쓰지 않는다. */
export function loadCriteria(st: SafeStorage, profileId: string): SelectionCriteria[] {
  const key = profileKeys.criteria(profileId);
  const raw = st.get<unknown>(key, null);
  if (raw === null) return [];
  const { criteria, repaired } = sanitizeCriteria(raw);
  const shapeOk = typeof raw === 'object' && !Array.isArray(raw) && Array.isArray((raw as { criteria?: unknown }).criteria);
  if (repaired || !shapeOk) st.reportCorrupt(key);
  return criteria;
}

/** 한도 문구. 오류와 화면 스낵바가 같은 문구를 쓴다. */
export const CRITERIA_CAP_MESSAGE = `선정 기준은 ${MAX_CRITERIA}개까지 저장할 수 있어요`;

export function assertCriteriaCap(list: SelectionCriteria[]): void {
  if (list.length > MAX_CRITERIA) throw new Error(CRITERIA_CAP_MESSAGE);
}

export function saveCriteria(st: SafeStorage, profileId: string, list: SelectionCriteria[]): void {
  assertCriteriaCap(list);
  st.set(profileKeys.criteria(profileId), { criteria: list });
}
