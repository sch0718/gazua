export type RouteName = 'compare' | 'simulate' | 'performance' | 'settings' | 'onboarding' | 'unlock' | 'profiles';

export type SettingsSection = 'connection' | 'diagnostics' | 'data';

export interface Route {
  name: RouteName;
  groupId?: string;
  /** 시뮬레이션: 열 전략. 없으면 전략 목록. */
  strategyId?: string;
  /** 시뮬레이션: `criteria`면 선정 기준 탭. 없으면 매매 규칙 탭. */
  tab?: 'criteria';
  /** 선정 기준 탭: 열 기준. 없으면 기준 목록. */
  criteriaId?: string;
  /** 선정 기준 탭: 편집(기본) 또는 결과 */
  view?: 'edit' | 'result';
  /** 설정: 열자마자 보여 줄 구역(오류 배너의 `진단 열기`·`키 다시 입력`). 해시에는 남기지 않는다. */
  section?: SettingsSection;
}

/** `#/compare/:groupId`, `#/simulate/:strategyId`, `#/performance`, `#/settings`, `#/onboarding`. 그 밖의 해시는 null. */
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
  const crit = /^#\/simulate\/criteria(?:\/([^/?#]+)(?:\/(result))?)?\/?$/.exec(hash);
  if (crit) {
    if (!crit[1]) return { name: 'simulate', tab: 'criteria' };
    try {
      const criteriaId = decodeURIComponent(crit[1]);
      return crit[2] ? { name: 'simulate', tab: 'criteria', criteriaId, view: 'result' } : { name: 'simulate', tab: 'criteria', criteriaId };
    } catch {
      return { name: 'simulate', tab: 'criteria' };
    }
  }
  const sim = /^#\/simulate(?:\/([^/?#]+))?\/?$/.exec(hash);
  if (sim) {
    if (!sim[1]) return { name: 'simulate' };
    try {
      return { name: 'simulate', strategyId: decodeURIComponent(sim[1]) };
    } catch {
      return { name: 'simulate' };
    }
  }
  if (/^#\/performance\/?$/.test(hash)) return { name: 'performance' };
  if (/^#\/settings\/?$/.test(hash)) return { name: 'settings' };
  if (/^#\/onboarding\/?$/.test(hash)) return { name: 'onboarding' };
  return null;
}

/** 해시로 표현하는 화면의 해시. 잠금 해제·프로필 선택은 해시가 없다(관문 화면). */
export function hashFor(r: Route): string | null {
  switch (r.name) {
    case 'compare':
      return r.groupId ? `#/compare/${encodeURIComponent(r.groupId)}` : '#/compare';
    case 'simulate':
      if (r.tab === 'criteria') {
        if (!r.criteriaId) return '#/simulate/criteria';
        const base = `#/simulate/criteria/${encodeURIComponent(r.criteriaId)}`;
        return r.view === 'result' ? `${base}/result` : base;
      }
      return r.strategyId ? `#/simulate/${encodeURIComponent(r.strategyId)}` : '#/simulate';
    case 'performance':
      return '#/performance';
    case 'settings':
      return '#/settings';
    case 'onboarding':
      return '#/onboarding';
    default:
      return null;
  }
}
