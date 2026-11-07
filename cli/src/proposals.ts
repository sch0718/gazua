// 주문안(로드맵 최우선 2 단계 B의 가장 작은 버전): 신호 판정을 「살 것·팔 것, 수량, 참고 가격」 목록으로 바꾼다.
// 어디에도 주문을 보내지 않는다. 사람이 보고 직접 주문한다.
import type { Strategy } from '../../src/lib/sim/types';
import type { HoldingJudgement, SymbolSignal } from './signals';

export interface OrderProposal {
  side: 'BUY' | 'SELL';
  symbol: string;
  quantity: number;
  /** 기준 봉 종가 */
  refPrice: number;
  /** 수량 × 참고 가격(비용 제외) */
  amount: number;
  reason: string;
}

export interface Proposals {
  orders: OrderProposal[];
  skipped: { symbol: string; reason: string }[];
  /** 매수안 금액 합계(비용 제외) */
  buyTotal: number;
  notes: string[];
}

export const PROPOSAL_NOTES = {
  base: ['주문을 보내지 않아요. 사람이 확인하고 직접 주문해요', '참고 가격은 기준 봉 종가예요. 시뮬레이션은 다음 거래일 시가에 체결해요', '수수료·세금은 빼지 않았어요'],
  noHoldings: '보유를 확인하지 못해 매도안이 없고, 이미 가진 종목도 매수안에 들어갈 수 있어요',
  sizingFromInitial: '총자산·현금 비율 배분은 계좌 잔고를 몰라 전략의 처음 자금 기준으로 계산했어요',
  takeFromHeld: '익절 단계가 이미 체결됐는지 몰라 지금 보유 수량 기준으로 계산했어요',
  noScaleIn: '분할 매수(추가 매수)는 제안하지 않아요',
} as const;

const won = (x: number) => Math.round(x);

/** 1회 매수 금액. 잔고를 모르므로 비율 배분은 처음 자금 기준이다 */
export function buyBudget(strategy: Strategy, symbolCount: number): number {
  const { initial } = strategy.capital;
  const { mode, pct } = strategy.sizing;
  return won(mode === 'equal' ? initial / Math.max(1, symbolCount) : (initial * pct) / 100);
}

function sellOf(h: HoldingJudgement, strategy: Strategy): { quantity: number; reason: string; take?: true } | { skip: string } | null {
  const all = (reason: string) => ({ quantity: h.quantity, reason });
  if (h.stop?.hit === true) return all('손절');
  if (h.trail?.hit === true) return all('트레일링 스톱');
  if (h.timeExit?.hit === true) return all('기간 청산');
  if (h.signalSell?.match) return all(`조건 매도${h.signalSell.reason ? `: ${h.signalSell.reason}` : ''}`);
  const stages = strategy.rules.sell.takeProfit.stages;
  const hit = [...h.takes].reverse().find((t) => t.hit === true);
  if (hit) {
    const last = hit.stage === stages.length;
    const quantity = last ? h.quantity : Math.min(h.quantity, Math.floor((h.quantity * stages[hit.stage - 1].sellPct) / 100));
    if (quantity <= 0) return { skip: `${hit.stage}단계 익절 수량이 1주 미만이에요` };
    return { quantity, reason: stages.length === 1 ? '익절' : `${hit.stage}단계 익절`, take: true };
  }
  const unknown = [h.stop?.hit, h.trail?.hit, h.timeExit?.hit, ...h.takes.map((t) => t.hit)].some((x) => x === 'unknown');
  if (unknown) return { skip: '판정하지 못한 매도 규칙이 있어요(signals의 holdings를 보세요)' };
  // 본전 손절은 1단계 익절 여부를 몰라 늘 unknown이다. 종가가 평단보다 높으면 걸릴 수 없으니 그때만 넘어간다
  if (h.breakeven && (h.avgPrice === null || h.close <= h.avgPrice)) return { skip: '1단계 익절 뒤라면 본전 손절 가격이에요. 익절했는지 직접 확인해요' };
  return null;
}

export function proposeOrders(i: {
  strategy: Strategy;
  signals: SymbolSignal[];
  holdings: HoldingJudgement[] | undefined;
  /** 종목 → 기준 봉 종가 */
  closes: Map<string, number>;
  /** 전략 종목 수(같은 금액 배분용) */
  symbolCount: number;
}): Proposals {
  const { strategy } = i;
  const orders: OrderProposal[] = [];
  const skipped: Proposals['skipped'] = [];
  const notes: string[] = [...PROPOSAL_NOTES.base];
  let takeUsed = false;

  const stale = new Map(i.signals.flatMap((s) => (s.asOf !== undefined ? [[s.symbol, s.asOf] as const] : [])));
  for (const h of i.holdings ?? []) {
    const asOf = stale.get(h.symbol);
    if (asOf !== undefined) {
      skipped.push({ symbol: h.symbol, reason: `기준 봉(${asOf})이 다른 종목보다 오래됐어요` });
      continue;
    }
    const s = sellOf(h, strategy);
    if (!s) continue;
    if ('skip' in s) skipped.push({ symbol: h.symbol, reason: s.skip });
    else {
      takeUsed ||= s.take === true;
      orders.push({ side: 'SELL', symbol: h.symbol, quantity: s.quantity, refPrice: h.close, amount: won(s.quantity * h.close), reason: s.reason });
    }
  }

  const held = new Set((i.holdings ?? []).map((h) => h.symbol));
  const budget = buyBudget(strategy, i.symbolCount);
  for (const sig of i.signals) {
    if (!sig.buy.match) continue;
    const close = i.closes.get(sig.symbol);
    if (held.has(sig.symbol)) skipped.push({ symbol: sig.symbol, reason: '이미 보유 중이에요' });
    else if (sig.asOf !== undefined) skipped.push({ symbol: sig.symbol, reason: `기준 봉(${sig.asOf})이 다른 종목보다 오래됐어요` });
    else if (close === undefined || close <= 0) skipped.push({ symbol: sig.symbol, reason: '종가를 모르겠어요' });
    else {
      const quantity = Math.floor(budget / close);
      if (quantity <= 0) skipped.push({ symbol: sig.symbol, reason: `1회 금액 ${budget.toLocaleString('ko-KR')}원으로 1주도 살 수 없어요` });
      else orders.push({ side: 'BUY', symbol: sig.symbol, quantity, refPrice: close, amount: won(quantity * close), reason: `매수 조건${sig.buy.reason ? `: ${sig.buy.reason}` : ''}` });
    }
  }

  if (i.holdings === undefined) notes.push(PROPOSAL_NOTES.noHoldings);
  if (strategy.sizing.mode === 'equityPct' || strategy.sizing.mode === 'cashPct') notes.push(PROPOSAL_NOTES.sizingFromInitial);
  if (takeUsed) notes.push(PROPOSAL_NOTES.takeFromHeld);
  if (strategy.scaleIn.on) notes.push(PROPOSAL_NOTES.noScaleIn);

  return { orders, skipped, buyTotal: orders.filter((o) => o.side === 'BUY').reduce((a, o) => a + o.amount, 0), notes };
}
