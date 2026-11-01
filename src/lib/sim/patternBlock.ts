// 매수 조건의 반등 패턴 블록 찾기. 엔진·선정 기준·화면 문구가 같이 쓴다(스펙 §7).
import type { Cond, CondGroup, PatternEntry, Strategy } from './types';

type PatternCond = Extract<Cond, { kind: 'pattern' }>;
const patterns = (groups: CondGroup[]): PatternCond[] => groups.flatMap((g) => g.conds.filter((c): c is PatternCond => c.kind === 'pattern'));

/** 매수 묶음에서 처음 나오는 반등 패턴 블록의 entry. 없으면 null */
export function patternEntryOf(s: Pick<Strategy, 'rules'>): PatternEntry | null {
  return patterns(s.rules.buy)[0]?.entry ?? null;
}

/** 매수 묶음 전체의 반등 패턴 블록 수(1개까지만 실행할 수 있다, §11) */
export function patternCount(s: Pick<Strategy, 'rules'>): number {
  return patterns(s.rules.buy).length;
}
