// 저장된 전략의 검증은 strategyV1.ts에서 다시 내보내고, 편집 화면 경고는 여기에 둔다.
import type { Watchlists } from '../state/schema';
import { addDays } from '../time/kst';
import { MAX_SYMBOLS } from './defaults';
import type { Strategy } from './types';

export { sanitizeEntry, sanitizeStrategiesV1 as sanitizeStrategies } from './strategyV1';

export type Issue = {
  section: 'universe' | 'period' | 'capital' | 'entry' | 'scaleIn' | 'exit' | 'benchmarks' | 'costs';
  text: string;
  blocking: boolean;
};

/** 그룹이면 지금 그룹의 종목 순서대로, 그룹이 없으면 []. */
export function resolveSymbols(s: Strategy, w: Watchlists): string[] {
  if (s.universe.kind === 'symbols') return s.universe.symbols.slice(0, MAX_SYMBOLS);
  const id = s.universe.groupId;
  const g = w.groups.find((x) => x.id === id);
  return g ? g.items.map((i) => i.symbol).slice(0, MAX_SYMBOLS) : [];
}

/** 매수·분할 매수·매도 규칙(entry·scaleIn·exit)만 본 경고. 종목 범위·기간을 쓰지 않아 선정 기준 ②도 쓴다. */
export function ruleIssues(s: Strategy): Issue[] {
  const out: Issue[] = [];
  const t = s.entry.triggers;
  if (!t.reboundDays.on && !t.breakout.on && !t.maCross.on && !t.goldenCross.on)
    out.push({ section: 'entry', text: '사는 신호가 하나도 켜져 있지 않아요. ②에서 하나 이상 켜 주세요', blocking: true });
  if (t.goldenCross.on && t.goldenCross.short >= t.goldenCross.long)
    out.push({ section: 'entry', text: '짧은 이동평균 기간이 긴 이동평균보다 짧아야 해요', blocking: false });

  const { stopLoss, takeProfit } = s.exit;
  if (stopLoss.basis === 'avgAlways' && s.scaleIn.on && s.scaleIn.stepPct >= stopLoss.pct)
    out.push({ section: 'exit', text: '추가 매수보다 손절이 먼저 일어나요. 추가 매수 간격을 손절폭보다 작게 해 주세요', blocking: false });
  if (takeProfit.some((x, i) => i > 0 && x.pct <= takeProfit[i - 1].pct))
    out.push({ section: 'exit', text: '익절 단계는 낮은 %부터 차례로 적어 주세요', blocking: true });
  if (takeProfit.slice(0, -1).reduce((a, x) => a + x.sellPct, 0) >= 100)
    out.push({ section: 'exit', text: '마지막 단계 전에 모두 팔려서 뒤 단계가 실행되지 않아요', blocking: false });
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
  if (s.capital.perBuyPct * buys * n > 100)
    out.push({ section: 'capital', text: '모든 종목이 한꺼번에 사면 현금이 모자라요. 신호 일부를 건너뛸 수 있어요', blocking: false });
  return out;
}
