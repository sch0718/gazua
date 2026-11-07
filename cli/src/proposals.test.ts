import { describe, expect, it } from 'vitest';
import { fullStrategyV2 } from '../../src/lib/sim/testStrategyV2';
import type { Strategy } from '../../src/lib/sim/types';
import { buyBudget, PROPOSAL_NOTES, proposeOrders } from './proposals';
import type { HoldingJudgement, SymbolSignal } from './signals';

/** 처음 자금 1,000만 원, 1회 10%(같은 금액), 익절 10%/50% · 20%/100%, 분할 매수 꺼짐 */
function strat(over: (s: Strategy) => void = () => {}): Strategy {
  const s = fullStrategyV2();
  s.sizing = { mode: 'fixed', pct: 10 };
  s.scaleIn.on = false;
  over(s);
  return s;
}

const buy = (symbol: string, over: Partial<SymbolSignal> = {}): SymbolSignal => ({ symbol, buy: { match: true, reason: '3일선 위', group: 1 }, sell: null, ...over });
const holding = (over: Partial<HoldingJudgement> = {}): HoldingJudgement => ({
  symbol: '005930',
  quantity: 10,
  avgPrice: 68500,
  close: 71200,
  firstBuyDate: '2026-09-02',
  stop: { price: 63705, hit: false },
  takes: [{ stage: 1, price: 75350, hit: false }, { stage: 2, price: 82200, hit: false }],
  stagesDoneUnknown: true,
  trail: { price: 70470, hit: false },
  timeExit: { heldDays: 5, days: 20, hit: false },
  signalSell: { match: false },
  ...over,
});
const run = (o: { strategy?: Strategy; signals?: SymbolSignal[]; holdings?: HoldingJudgement[]; closes?: Record<string, number>; symbolCount?: number }) =>
  proposeOrders({ strategy: o.strategy ?? strat(), signals: o.signals ?? [], holdings: o.holdings, closes: new Map(Object.entries(o.closes ?? {})), symbolCount: o.symbolCount ?? 2 });

describe('buyBudget: 1회 매수 금액', () => {
  it.each([
    ['fixed', 10, 1_000_000],
    ['equityPct', 10, 1_000_000],
    ['cashPct', 25, 2_500_000],
    ['equal', 10, 2_500_000], // 1,000만 원 ÷ 4종목
  ] as const)('%s %i%% → %i원', (mode, pct, want) => {
    expect(buyBudget(strat((s) => (s.sizing = { mode, pct })), 4)).toBe(want);
  });
});

describe('proposeOrders', () => {
  it('매수 조건이 맞은 종목은 1회 금액 ÷ 종가의 내림 수량으로 매수안을 낸다', () => {
    const out = run({ signals: [buy('000660'), { symbol: '035420', buy: { match: false }, sell: null }], holdings: [], closes: { '000660': 180_000, '035420': 200_000 } });
    expect(out.orders).toEqual([{ side: 'BUY', symbol: '000660', quantity: 5, refPrice: 180_000, amount: 900_000, reason: '매수 조건: 3일선 위' }]);
    expect(out.buyTotal).toBe(900_000);
    expect(out.notes).toEqual([...PROPOSAL_NOTES.base]);
  });

  it('보유 중·기준 봉이 오래된 종목·1주도 못 사는 종목은 매수안 대신 skipped', () => {
    const out = run({
      signals: [buy('005930'), buy('000660', { asOf: '2026-10-28' }), buy('373220')],
      holdings: [holding()],
      closes: { '005930': 71_200, '000660': 180_000, '373220': 2_000_000 },
    });
    expect(out.orders).toEqual([]);
    expect(out.skipped).toEqual([
      { symbol: '005930', reason: '이미 보유 중이에요' },
      { symbol: '000660', reason: '기준 봉(2026-10-28)이 다른 종목보다 오래됐어요' },
      { symbol: '373220', reason: '1회 금액 1,000,000원으로 1주도 살 수 없어요' },
    ]);
  });

  it.each([
    ['손절', { stop: { price: 72000, hit: true } }],
    ['트레일링 스톱', { trail: { price: 72000, hit: true } }],
    ['기간 청산', { timeExit: { heldDays: 21, days: 20, hit: true } }],
    ['조건 매도: 3일선 아래', { signalSell: { match: true, reason: '3일선 아래', group: 1 } }],
  ] as const)('%s → 전량 매도안', (reason, over) => {
    const out = run({ holdings: [holding(over as Partial<HoldingJudgement>)] });
    expect(out.orders).toEqual([{ side: 'SELL', symbol: '005930', quantity: 10, refPrice: 71200, amount: 712_000, reason }]);
  });

  it('손절이 익절보다 먼저다', () => {
    const out = run({ holdings: [holding({ stop: { price: 72000, hit: true }, takes: [{ stage: 1, price: 70000, hit: true }, { stage: 2, price: 82200, hit: false }] })] });
    expect(out.orders[0].reason).toBe('손절');
  });

  it('익절은 맞은 가장 높은 단계: 중간 단계는 보유 수량 × 비율, 마지막 단계는 전량', () => {
    const mid = run({ holdings: [holding({ takes: [{ stage: 1, price: 70000, hit: true }, { stage: 2, price: 82200, hit: false }] })] });
    expect(mid.orders).toEqual([{ side: 'SELL', symbol: '005930', quantity: 5, refPrice: 71200, amount: 356_000, reason: '1단계 익절' }]);
    expect(mid.notes).toContain(PROPOSAL_NOTES.takeFromHeld);
    const last = run({ holdings: [holding({ takes: [{ stage: 1, price: 60000, hit: true }, { stage: 2, price: 70000, hit: true }] })] });
    expect(last.orders[0]).toMatchObject({ quantity: 10, reason: '2단계 익절' });
  });

  it('맞은 매도 규칙이 없고 판정 못 한 규칙이 있으면 skipped, 모두 아니면 아무것도 없다', () => {
    expect(run({ holdings: [holding({ trail: { price: null, hit: 'unknown' } })] }).skipped).toEqual([{ symbol: '005930', reason: '판정하지 못한 매도 규칙이 있어요(signals의 holdings를 보세요)' }]);
    expect(run({ holdings: [holding()] })).toMatchObject({ orders: [], skipped: [] });
  });

  it('본전 손절(늘 unknown)은 종가가 평단 이하이거나 평단을 모를 때만 skipped', () => {
    const be = { breakeven: { price: 68500, hit: 'unknown' as const } };
    const why = [{ symbol: '005930', reason: '1단계 익절 뒤라면 본전 손절 가격이에요. 익절했는지 직접 확인해요' }];
    expect(run({ holdings: [holding(be)] }).skipped).toEqual([]); // 종가 71,200 > 평단 68,500
    expect(run({ holdings: [holding({ ...be, close: 68500 })] }).skipped).toEqual(why);
    expect(run({ holdings: [holding({ ...be, avgPrice: null })] }).skipped).toEqual(why);
  });

  it('기준 봉이 오래된 보유 종목은 매도안 대신 skipped', () => {
    const out = run({ signals: [{ symbol: '005930', buy: { match: false }, sell: null, asOf: '2026-10-28' }], holdings: [holding({ stop: { price: 72000, hit: true } })] });
    expect(out).toMatchObject({ orders: [], skipped: [{ symbol: '005930', reason: '기준 봉(2026-10-28)이 다른 종목보다 오래됐어요' }] });
  });

  it('보유를 모르면(KIS) 안내, 비율 배분·분할 매수 안내', () => {
    const out = run({ strategy: strat((s) => ((s.sizing = { mode: 'cashPct', pct: 10 }), (s.scaleIn.on = true))), holdings: undefined });
    expect(out.notes).toEqual([...PROPOSAL_NOTES.base, PROPOSAL_NOTES.noHoldings, PROPOSAL_NOTES.sizingFromInitial, PROPOSAL_NOTES.noScaleIn]);
  });
});
