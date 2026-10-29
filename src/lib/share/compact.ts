// 공유 스냅샷 만들기 중 열 형식·축약이 필요한 것(설계 2.3~2.5, 3절). 검사는 snapshot.ts·checkResult.ts가 한다.
import type { Group, Settings } from '../state/schema';
import { shareTitle, type CompareSnapshot } from './snapshot';

/** 시세 값은 넣지 않는다. 받은 사람이 자기 연결이나 데모로 다시 받는다. 지표는 사용자가 고른 값(app.settings.metric)이다. */
export function compareSnapshot(g: Group, s: Pick<Settings, 'period' | 'metric' | 'benchmark' | 'boardOrder'>): CompareSnapshot {
  return {
    kind: 'compare',
    v: 1,
    title: shareTitle(g.name),
    symbols: g.items.filter((i) => !i.hidden).map((i) => i.symbol),
    view: { period: { unit: s.period.unit, n: s.period.n }, metric: s.metric, benchmark: s.benchmark, boardOrder: s.boardOrder },
  };
}
