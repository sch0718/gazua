// 새 전략 템플릿(스펙 §3.4). 규칙(rules·scaleIn·sizing)만 정하고 종목·기간·비교·비용은 newStrategy 값을 쓴다.
// 숫자는 시작값이다. 성과를 약속하는 문구는 쓰지 않는다.
import { newStrategy } from './defaults';
import type { Strategy } from './types';

export interface StrategyTemplate {
  id: 'rebound' | 'rsi' | 'golden';
  name: string;
  desc: string;
  apply(s: Strategy): void;
}

export const TEMPLATES: readonly StrategyTemplate[] = [
  { id: 'rebound', name: '하락 후 반등', desc: '고점에서 떨어진 뒤 다시 오를 때 사요', apply: () => {} },
  {
    id: 'rsi',
    name: 'RSI 과매도 반등',
    desc: 'RSI가 30을 위로 넘고 장기 추세 위일 때 사요',
    apply(s) {
      s.rules.buy = [{ conds: [{ kind: 'rsi', period: 14, level: 30, op: 'crossUp' }, { kind: 'maPrice', period: 120, side: 'above' }] }];
      s.rules.sell.takeProfit = { on: true, stages: [{ pct: 10, sellPct: 100 }], afterFirstTake: 'keep' };
      s.rules.sell.stopLoss = { on: true, pct: 5, basis: 'avgAfterScaleIn' };
      s.rules.sell.timeExit = { on: true, days: 20 };
    },
  },
  {
    id: 'golden',
    name: '골든크로스 추세',
    desc: '이평 골든크로스와 거래량이 함께 나올 때 사요',
    apply(s) {
      s.rules.buy = [{ conds: [{ kind: 'maCross', short: 20, long: 60, dir: 'golden' }, { kind: 'volume', days: 20, ratio: 1.5 }] }];
      s.rules.sell.takeProfit = { ...s.rules.sell.takeProfit, on: false };
      s.rules.sell.stopLoss = { on: true, pct: 7, basis: 'avgAfterScaleIn' };
      s.rules.sell.trailing = { on: true, pct: 10 };
      s.rules.sell.signal = { on: true, groups: [{ conds: [{ kind: 'maCross', short: 20, long: 60, dir: 'dead' }] }] };
    },
  },
];

export function fromTemplate(t: StrategyTemplate, now: number, groupId: string | null, name: string): Strategy {
  const s = newStrategy(now, groupId, name);
  t.apply(s);
  return s;
}
