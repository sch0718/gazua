import { addDays, kstDate } from '../time/kst';
import type { PatternEntry, Strategy } from './types';

export const MAX_SYMBOLS = 8;
export const MAX_STRATEGIES = 20;
export const MAX_TAKE_STAGES = 3;
export const NAME_MAX = 30;
/** 처음 자금 상한(1,000억 원). 이 위는 float 간격이 0.0001원을 넘어 roundMoney가 정확한 비용을 표현하지 못한다 */
export const MAX_INITIAL = 1e11;

/** 어제(KST) 기준 3년 전 같은 날부터 어제까지. 윤일이면 2월 28일로 맞춘다. */
export function defaultPeriod(now: number): { from: string; to: string } {
  const to = addDays(kstDate(now), -1);
  const y = Number(to.slice(0, 4)) - 3;
  let from = `${String(y).padStart(4, '0')}${to.slice(4)}`;
  if (from.slice(5) === '02-29') from = `${from.slice(0, 5)}02-28`;
  return { from, to };
}

/** 기본 반등 패턴(지금 새 전략의 매수 조건). 선정 기준·전략 v2 기본값이 같이 쓴다 */
export function defaultPatternEntry(): PatternEntry {
  return {
    decline: { dropPct: { on: true, value: 10 }, days: { on: false, value: 10 } },
    triggers: {
      reboundDays: { on: true, value: 3 },
      breakout: { on: true, level: 'B' },
      maCross: { on: false, period: 20 },
      goldenCross: { on: false, short: 5, long: 20 },
    },
    filter: { aboveMa: { on: false, period: 60 } },
  };
}

/** 새 전략(v2). 매수는 기본 반등 패턴 블록 하나, 매도는 익절 +15% 전량·손절 −5%(분할 후 평단), 배분은 처음 자금 10% */
export function newStrategy(now: number, groupId: string | null, name = '새 전략'): Strategy {
  return {
    v: 2,
    id: crypto.randomUUID(),
    name,
    updatedAt: now,
    universe: groupId ? { kind: 'group', groupId } : { kind: 'symbols', symbols: [] },
    period: defaultPeriod(now),
    capital: { initial: 10_000_000 },
    sizing: { mode: 'fixed', pct: 10 },
    rules: {
      buy: [{ conds: [{ kind: 'pattern', entry: defaultPatternEntry() }] }],
      sell: {
        takeProfit: { on: true, stages: [{ pct: 15, sellPct: 100 }], afterFirstTake: 'keep' },
        stopLoss: { on: true, pct: 5, basis: 'avgAfterScaleIn' },
        trailing: { on: false, pct: 10 },
        timeExit: { on: false, days: 20 },
        signal: { on: false, groups: [] },
      },
    },
    scaleIn: { on: false, stepPct: 3, maxAdds: 2 },
    benchmarks: { index: 'KOSPI', symbol: '069500' },
    costs: { feePct: 0.015 },
  };
}
