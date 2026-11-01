import { addDays, kstDate } from '../time/kst';
import { newStrategyV1, type StrategyV1 } from './strategyV1';
import type { Strategy } from './types';

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
export function defaultPatternEntry(): StrategyV1['entry'] {
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

export function newStrategy(now: number, groupId: string | null, name = '새 전략'): Strategy {
  return newStrategyV1(now, groupId, name);
}
