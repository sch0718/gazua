import { roundMoney } from './money';
import type { Strategy } from './types';

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
  exit: Strategy['exit'],
): Position {
  if (!(qty > 0)) throw new Error('수량은 0보다 커야 합니다');
  let held = qty;
  let bought = qty;
  let cost = qty * price;
  let lastBuy = price;
  let addCount = 0;
  let sold = false;
  let stages = 0;

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
      const { basis, pct } = exit.stopLoss;
      const f = 1 - pct / 100;
      let base: number | null;
      if (basis === 'firstBuy') base = price * f;
      else if (basis === 'avgAlways') base = avg() * f;
      else base = scaleInDone() ? avg() * f : null;
      if (stages >= 1 && exit.afterFirstTake === 'breakeven') {
        return base === null ? avg() : Math.max(base, avg());
      }
      return base;
    },

    nextAddPrice() {
      if (!scaleIn.on || addCount >= scaleIn.maxAdds || sold) return null;
      return lastBuy * (1 - scaleIn.stepPct / 100);
    },

    takeLevels() {
      const n = exit.takeProfit.length;
      const a = avg();
      const out: { stage: number; price: number; qty: number }[] = [];
      exit.takeProfit.forEach((t, i) => {
        const stage = i + 1;
        if (stage <= stages) return;
        const q = stage === n ? held : Math.min(held, Math.floor((bought * t.sellPct) / 100));
        out.push({ stage, price: a * (1 + t.pct / 100), qty: q });
      });
      return out;
    },
  };
}
