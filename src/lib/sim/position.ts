import { roundMoney } from './money';
import type { Strategy } from './types';

/** 포지션이 쓰는 매도 규칙(rules.sell). 기간 청산·조건 매도는 엔진이 다룬다 */
export type SellRules = Strategy['rules']['sell'];

export interface Position {
  readonly qty: number;
  readonly initialQty: number;
  readonly avgPrice: number;
  readonly firstPrice: number;
  readonly lastBuyPrice: number;
  readonly adds: number;
  readonly soldAny: boolean;
  readonly stagesDone: number;
  buy(price: number, qty: number): void;
  sell(qty: number, stage?: number): void;
  stopPrice(): number | null;
  nextAddPrice(): number | null;
  takeLevels(): { stage: number; price: number; qty: number }[];
  /** 다음 거래일 장중에 쓰는 트레일 가격(보유 중 최고 종가 × (1 − pct)). 꺼져 있으면 null */
  trailPrice(): number | null;
  /** 그날 종가로 트레일 기준가를 갱신한다 */
  markClose(close: number): void;
}

/** q주의 총비용(수수료 포함, 0.0001원 단위). 매수 현금 차감과 같은 식 */
export const costOf = (q: number, price: number, feePct: number): number => roundMoney(q * price * (1 + feePct / 100));

/** amount 안에서 살 수 있는 최대 주수. 나눗셈이 경계에서 6.999…로 어긋나도 반올림한 총비용으로 비교해 바로잡는다 */
export function maxShares(amount: number, price: number, feePct: number): number {
  const budget = roundMoney(amount);
  let q = Math.floor(budget / (price * (1 + feePct / 100)));
  while (q > 0 && costOf(q, price, feePct) > budget) q--;
  while (costOf(q + 1, price, feePct) <= budget) q++;
  return q;
}

export function openPosition(
  price: number,
  qty: number,
  scaleIn: Strategy['scaleIn'],
  sell: SellRules,
): Position {
  if (!(qty > 0)) throw new Error('수량은 0보다 커야 합니다');
  let held = qty;
  let bought = qty;
  let cost = qty * price;
  let lastBuy = price;
  let addCount = 0;
  let sold = false;
  let stages = 0;
  let peak = price; // 트레일 기준가: 매수가와 보유 중 종가의 최댓값(추가 매수로 바뀌지 않는다)

  const avg = () => cost / bought;
  const scaleInDone = () => !scaleIn.on || addCount >= scaleIn.maxAdds || sold;

  return {
    get qty() { return held; },
    get initialQty() { return bought; },
    get avgPrice() { return avg(); },
    get firstPrice() { return price; },
    get lastBuyPrice() { return lastBuy; },
    get adds() { return addCount; },
    get soldAny() { return sold; },
    get stagesDone() { return stages; },

    buy(p, q) {
      if (!(q > 0)) throw new Error('수량은 0보다 커야 합니다');
      held += q;
      bought += q;
      cost += q * p;
      lastBuy = p;
      addCount++;
    },

    sell(q, stage) {
      if (!(q > 0)) throw new Error('수량은 0보다 커야 합니다');
      if (q > held) throw new Error('보유 수량보다 많이 팔 수 없습니다');
      held -= q;
      sold = true;
      if (stage !== undefined) stages = Math.max(stages, stage);
    },

    stopPrice() {
      const { on, basis, pct } = sell.stopLoss;
      const f = 1 - pct / 100;
      let base: number | null = null;
      if (on) {
        if (basis === 'firstBuy') base = price * f;
        else if (basis === 'avgAlways') base = avg() * f;
        else base = scaleInDone() ? avg() * f : null;
      }
      // 본전 손절은 익절에 딸린 설정이라 손절을 꺼도 1단계 익절 뒤에는 산다(스펙 §4.4)
      if (stages >= 1 && sell.takeProfit.afterFirstTake === 'breakeven') {
        return base === null ? avg() : Math.max(base, avg());
      }
      return base;
    },

    nextAddPrice() {
      if (!scaleIn.on || addCount >= scaleIn.maxAdds || sold) return null;
      return lastBuy * (1 - scaleIn.stepPct / 100);
    },

    takeLevels() {
      if (!sell.takeProfit.on) return [];
      const tp = sell.takeProfit.stages;
      const n = tp.length;
      const a = avg();
      const out: { stage: number; price: number; qty: number }[] = [];
      tp.forEach((t, i) => {
        const stage = i + 1;
        if (stage <= stages) return;
        const q = stage === n ? held : Math.min(held, Math.floor((bought * t.sellPct) / 100));
        out.push({ stage, price: a * (1 + t.pct / 100), qty: q });
      });
      return out;
    },

    trailPrice() {
      return sell.trailing.on ? peak * (1 - sell.trailing.pct / 100) : null;
    },

    markClose(close) {
      if (close > peak) peak = close;
    },
  };
}
