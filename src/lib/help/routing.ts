import type { Route } from '../state/routes';
import type { HelpPageId } from './content';

/** 지금 화면의 도움말(앱 바의 물음표 단추가 여는 곳). 관문·온보딩·도움말 화면 자신은 없다. */
export function helpIdForRoute(r: Route): HelpPageId | null {
  switch (r.name) {
    case 'compare':
      return 'compare';
    case 'simulate':
      return r.tab === 'criteria' ? 'criteria' : 'simulate';
    case 'performance':
      return 'performance';
    case 'settings':
      return 'settings';
    default:
      return null;
  }
}

/** 처음 안내는 네 메뉴(비교·매매 규칙 목록·선정 기준 목록·내 성과)에 들어올 때 한 번만 띄운다. */
export function introIdFor(r: Route, seen: ReadonlySet<string>, blocked: boolean): HelpPageId | null {
  if (blocked) return null;
  const entry =
    r.name === 'compare' ||
    r.name === 'performance' ||
    (r.name === 'simulate' && (r.tab === 'criteria' ? !r.criteriaId : !r.strategyId));
  if (!entry) return null;
  const id = helpIdForRoute(r);
  return id !== null && !seen.has(id) ? id : null;
}
