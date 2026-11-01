// 편집 화면 경고. 저장된 전략의 검증은 버전별 모듈에 둔다.
import type { Watchlists } from '../state/schema';
import { addDays } from '../time/kst';
import { MAX_SYMBOLS } from './defaults';
import { patternCount, patternEntryOf } from './patternBlock';
import type { CondGroup, Strategy } from './types';

export type Issue = {
  section: 'universe' | 'period' | 'capital' | 'entry' | 'scaleIn' | 'exit' | 'benchmarks' | 'costs';
  text: string;
  blocking: boolean;
  /** 반등 패턴 블록에서 나온 경고. 선정 기준이 빌려 쓴다(§7) */
  pattern?: true;
};

/** 그룹이면 지금 그룹의 종목 순서대로, 그룹이 없으면 []. */
export function resolveSymbols(s: Strategy, w: Watchlists): string[] {
  if (s.universe.kind === 'symbols') return s.universe.symbols.slice(0, MAX_SYMBOLS);
  const id = s.universe.groupId;
  const g = w.groups.find((x) => x.id === id);
  return g ? g.items.map((i) => i.symbol).slice(0, MAX_SYMBOLS) : [];
}

/** 매수·분할 매수·매도 규칙(rules·scaleIn)만 본 경고. 종목 범위·기간을 쓰지 않아 선정 기준 ②도 쓴다. */
export function ruleIssues(s: Strategy): Issue[] {
  const out: Issue[] = [];
  const EMPTY_GROUP = '빈 묶음이 있어요. 조건을 넣거나 묶음을 지워 주세요';
  const MA_ORDER = '짧은 이동평균 기간이 긴 이동평균보다 짧아야 해요';
  const badCross = (groups: CondGroup[]) => groups.some((g) => g.conds.some((c) => c.kind === 'maCross' && c.short >= c.long));
  const buy = s.rules.buy;
  if (buy.length === 0) out.push({ section: 'entry', text: '사는 조건이 없어요. 조건을 하나 이상 넣어 주세요', blocking: true });
  if (buy.some((g) => g.conds.length === 0)) out.push({ section: 'entry', text: EMPTY_GROUP, blocking: true });
  if (patternCount(s) > 1) out.push({ section: 'entry', text: '반등 패턴은 하나만 넣을 수 있어요', blocking: true });
  if (badCross(buy)) out.push({ section: 'entry', text: MA_ORDER, blocking: false });
  const p = patternEntryOf(s);
  if (p) {
    const t = p.triggers;
    if (!t.reboundDays.on && !t.breakout.on && !t.maCross.on && !t.goldenCross.on)
      out.push({ section: 'entry', text: '사는 신호가 하나도 켜져 있지 않아요. 반등 패턴 ②에서 하나 이상 켜 주세요', blocking: true, pattern: true });
    if (t.goldenCross.on && t.goldenCross.short >= t.goldenCross.long)
      out.push({ section: 'entry', text: '짧은 이동평균 기간이 긴 이동평균보다 짧아야 해요', blocking: false, pattern: true });
  }
  const { takeProfit, stopLoss } = s.rules.sell;
  if (stopLoss.on && stopLoss.basis === 'avgAlways' && s.scaleIn.on && s.scaleIn.stepPct >= stopLoss.pct)
    out.push({ section: 'exit', text: '추가 매수보다 손절이 먼저 일어나요. 추가 매수 간격을 손절폭보다 작게 해 주세요', blocking: false });
  if (takeProfit.on) {
    const st = takeProfit.stages;
    if (st.some((x, i) => i > 0 && x.pct <= st[i - 1].pct)) out.push({ section: 'exit', text: '익절 단계는 낮은 %부터 차례로 적어 주세요', blocking: true });
    if (st.slice(0, -1).reduce((a, x) => a + x.sellPct, 0) >= 100)
      out.push({ section: 'exit', text: '마지막 단계 전에 모두 팔려서 뒤 단계가 실행되지 않아요', blocking: false });
  }
  const { trailing, timeExit, signal } = s.rules.sell;
  if (signal.on && signal.groups.length === 0) out.push({ section: 'exit', text: '조건 매도에 조건을 넣거나 꺼 주세요', blocking: true });
  if (signal.on && signal.groups.some((g) => g.conds.length === 0)) out.push({ section: 'exit', text: EMPTY_GROUP, blocking: true });
  if (signal.on && badCross(signal.groups)) out.push({ section: 'exit', text: MA_ORDER, blocking: false });
  if (trailing.on && s.scaleIn.on && s.scaleIn.stepPct >= trailing.pct)
    out.push({ section: 'exit', text: '추가 매수보다 트레일링이 먼저 일어나요. 추가 매수 간격을 트레일링 폭보다 작게 해 주세요', blocking: false });
  if (!takeProfit.on && !stopLoss.on && !trailing.on && !timeExit.on && !signal.on)
    out.push({ section: 'exit', text: '파는 규칙이 없어요. 기간 끝까지 들고 있어요', blocking: false });
  return out;
}

export function strategyIssues(s: Strategy, w: Watchlists): Issue[] {
  const out: Issue[] = [];
  const n = resolveSymbols(s, w).length;
  if (n === 0) out.push({ section: 'universe', text: '종목을 하나 이상 골라 주세요', blocking: true });

  const { from, to } = s.period;
  if (from >= to) out.push({ section: 'period', text: '시작일이 종료일보다 앞이어야 해요', blocking: true });
  else if (addDays(from, 42) > to) out.push({ section: 'period', text: '기간이 짧아 결과를 믿기 어려워요', blocking: false });

  out.push(...ruleIssues(s));

  const buys = 1 + (s.scaleIn.on ? s.scaleIn.maxAdds : 0); // 분할 매수를 껐으면 추가 매수는 없다
  if ((s.sizing.mode === 'fixed' || s.sizing.mode === 'equityPct') && s.sizing.pct * buys * n > 100)
    out.push({ section: 'capital', text: '모든 종목이 한꺼번에 사면 현금이 모자라요. 신호 일부를 건너뛸 수 있어요', blocking: false });
  if (s.sizing.mode === 'equal' && s.scaleIn.on)
    out.push({ section: 'capital', text: '균등 배분은 첫 매수에 몫을 다 써요. 추가 매수는 현금이 모자라 건너뛸 수 있어요', blocking: false });
  return out;
}
