import { addDays, kstDate } from '../time/kst';
import type { Strategy } from './types';

export const MAX_SYMBOLS = 8;
export const MAX_STRATEGIES = 20;
export const MAX_TAKE_STAGES = 3;
export const NAME_MAX = 30;

/** 어제(KST) 기준 3년 전 같은 날부터 어제까지. 윤일이면 2월 28일로 맞춘다. */
export function defaultPeriod(now: number): { from: string; to: string } {
  const to = addDays(kstDate(now), -1);
  const y = Number(to.slice(0, 4)) - 3;
  let from = `${String(y).padStart(4, '0')}${to.slice(4)}`;
  if (from.slice(5) === '02-29') from = `${from.slice(0, 5)}02-28`;
  return { from, to };
}

export function newStrategy(now: number, groupId: string | null, name = '새 전략'): Strategy {
  return {
    id: crypto.randomUUID(),
    name,
    updatedAt: now,
    universe: groupId ? { kind: 'group', groupId } : { kind: 'symbols', symbols: [] },
    period: defaultPeriod(now),
    capital: { initial: 10_000_000, perBuyPct: 10 },
    entry: {
      decline: { dropPct: { on: true, value: 10 }, days: { on: false, value: 10 } },
      triggers: {
        reboundDays: { on: true, value: 3 },
        breakout: { on: true, level: 'B' },
        maCross: { on: false, period: 20 },
        goldenCross: { on: false, short: 5, long: 20 },
      },
      filter: { aboveMa: { on: false, period: 60 } },
    },
    scaleIn: { on: false, stepPct: 3, maxAdds: 2 },
    exit: {
      takeProfit: [{ pct: 15, sellPct: 100 }],
      stopLoss: { pct: 5, basis: 'avgAfterScaleIn' },
      afterFirstTake: 'keep',
    },
    benchmarks: { index: 'KOSPI', symbol: '069500' },
    costs: { feePct: 0.015 },
  };
}
