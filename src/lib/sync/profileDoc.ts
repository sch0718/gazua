// 저장소 ↔ 동기화 프로필 문서. 기존 JSON 가져오기(새 UUID)와 달리 원격 적용은 같은 프로필 ID를 쓴다.
// 키·토큰·최근 종목·기기 전용 설정은 읽지도 쓰지도 않는다.
import { loadBaskets } from '../screen/baskets';
import { loadCriteria } from '../screen/criteriaStore';
import { loadStrategies } from '../sim/strategyStore';
import { sanitizeStrategiesV1, toV2 } from '../sim/strategyV1';
import { loadSettings, loadWatchlists, profileKeys } from '../state/profileStore';
import { DEFAULT_PROFILE_NAME } from '../state/schema';
import type { SafeStorage } from '../state/storage';
import { PROFILE_NAME_MAX, pickSyncedSettings, type ProfileDoc, type ProfileDocV2 } from './dto';

/** 프로필 이름을 문서 규칙(앞뒤 공백 없음, 30자, 빈 값 금지)에 맞춘다. */
export function docName(name: string): string {
  const t = [...name.trim()].slice(0, PROFILE_NAME_MAX).join('').trim();
  return t || DEFAULT_PROFILE_NAME;
}

/** 전략을 뺀 문서 부분. 옮기기 단계(migrate.ts)가 v1·v2 해시를 같은 바탕으로 계산하는 데도 쓴다 */
export function profileDocBase(st: SafeStorage, profileId: string, name: string): Omit<ProfileDocV2, 'v' | 'strategies'> {
  return {
    name: docName(name),
    settings: pickSyncedSettings(loadSettings(st, profileId)),
    watchlists: loadWatchlists(st, profileId),
    criteria: loadCriteria(st, profileId),
    baskets: loadBaskets(st, profileId),
  };
}

/** 저장된 프로필로 문서(v2)를 만든다. 읽기 검증은 각 load 함수가 한다. */
export function buildProfileDoc(st: SafeStorage, profileId: string, name: string): ProfileDocV2 {
  return { v: 2, ...profileDocBase(st, profileId, name), strategies: loadStrategies(st, profileId) };
}

/**
 * 검증된 문서를 이 프로필 ID에 쓴다. v2는 새 키에만, v1(아직 옮기지 않은 기기의 서버 문서)은 옛 키에 v1을 쓰고
 * 그 자리에서 toV2한 결과를 새 키에도 쓴다(스펙 §8.2). 설정은 동기화 필드만 바꾼다.
 */
export function applyProfileDoc(st: SafeStorage, profileId: string, doc: ProfileDoc): void {
  const settings = loadSettings(st, profileId);
  st.set(profileKeys.settings(profileId), { ...settings, ...doc.settings, period: { ...doc.settings.period } });
  st.set(profileKeys.watchlists(profileId), doc.watchlists);
  if (doc.v === 1) {
    st.set(profileKeys.strategies(profileId), { strategies: doc.strategies });
    st.set(profileKeys.strategySet(profileId), { strategies: sanitizeStrategiesV1({ strategies: doc.strategies }).strategies.map(toV2) });
  } else st.set(profileKeys.strategySet(profileId), { strategies: doc.strategies });
  st.set(profileKeys.criteria(profileId), { criteria: doc.criteria });
  st.set(profileKeys.baskets(profileId), { baskets: doc.baskets });
}
