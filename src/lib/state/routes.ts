export type RouteName = 'compare' | 'settings' | 'onboarding' | 'unlock' | 'profiles';

export type SettingsSection = 'connection' | 'diagnostics';

export interface Route {
  name: RouteName;
  groupId?: string;
  /** 설정: 열자마자 보여 줄 구역(오류 배너의 `진단 열기`·`키 다시 입력`). 해시에는 남기지 않는다. */
  section?: SettingsSection;
}

/** `#/compare/:groupId`, `#/settings`, `#/onboarding`. 그 밖의 해시는 null. */
export function parseHash(hash: string): Route | null {
  const compare = /^#\/compare(?:\/([^/?#]+))?\/?$/.exec(hash);
  if (compare) {
    if (!compare[1]) return { name: 'compare' };
    try {
      return { name: 'compare', groupId: decodeURIComponent(compare[1]) };
    } catch {
      return { name: 'compare' };
    }
  }
  if (/^#\/settings\/?$/.test(hash)) return { name: 'settings' };
  if (/^#\/onboarding\/?$/.test(hash)) return { name: 'onboarding' };
  return null;
}

/** 해시로 표현하는 화면의 해시. 잠금 해제·프로필 선택은 해시가 없다(관문 화면). */
export function hashFor(r: Route): string | null {
  switch (r.name) {
    case 'compare':
      return r.groupId ? `#/compare/${encodeURIComponent(r.groupId)}` : '#/compare';
    case 'settings':
      return '#/settings';
    case 'onboarding':
      return '#/onboarding';
    default:
      return null;
  }
}
