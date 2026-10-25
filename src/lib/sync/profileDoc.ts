// 저장소 ↔ 동기화 프로필 문서. 기존 JSON 가져오기(새 UUID)와 달리 원격 적용은 같은 프로필 ID를 쓴다.
// 키·토큰·최근 종목·기기 전용 설정은 읽지도 쓰지도 않는다.
import { loadBaskets } from '../screen/baskets';
import { loadCriteria } from '../screen/criteriaStore';
import { loadStrategies } from '../sim/strategyStore';
import { loadSettings, loadWatchlists, profileKeys } from '../state/profileStore';
import { DEFAULT_PROFILE_NAME } from '../state/schema';
import type { SafeStorage } from '../state/storage';
import { PROFILE_NAME_MAX, pickSyncedSettings, type ProfileDocV1 } from './dto';

/** 프로필 이름을 문서 규칙(앞뒤 공백 없음, 30자, 빈 값 금지)에 맞춘다. */
export function docName(name: string): string {
  const t = [...name.trim()].slice(0, PROFILE_NAME_MAX).join('').trim();
  return t || DEFAULT_PROFILE_NAME;
}

/** 저장된 프로필로 문서를 만든다. 읽기 검증은 각 load 함수가 한다. */
export function buildProfileDoc(st: SafeStorage, profileId: string, name: string): ProfileDocV1 {
  return {
    v: 1,
    name: docName(name),
    settings: pickSyncedSettings(loadSettings(st, profileId)),
    watchlists: loadWatchlists(st, profileId),
    strategies: loadStrategies(st, profileId),
    criteria: loadCriteria(st, profileId),
    baskets: loadBaskets(st, profileId),
  };
}

/**
 * 검증된 문서를 이 프로필 ID에 쓴다. 설정은 동기화 필드만 바꾸고 기기 전용 필드(공급자·프록시·테마·잠금 등)는 그대로 둔다.
 * 이름(색인)은 호출한 쪽이 meta에 반영한다.
 */
export function applyProfileDoc(st: SafeStorage, profileId: string, doc: ProfileDocV1): void {
  const settings = loadSettings(st, profileId);
  st.set(profileKeys.settings(profileId), { ...settings, ...doc.settings, period: { ...doc.settings.period } });
  st.set(profileKeys.watchlists(profileId), doc.watchlists);
  st.set(profileKeys.strategies(profileId), { strategies: doc.strategies });
  st.set(profileKeys.criteria(profileId), { criteria: doc.criteria });
  st.set(profileKeys.baskets(profileId), { baskets: doc.baskets });
}
