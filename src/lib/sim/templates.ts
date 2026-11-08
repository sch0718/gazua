// 새 전략 프리셋(스펙 §3.4). 규칙(rules·scaleIn·sizing)만 정하고 종목·기간·비교·비용은 newStrategy 값을 쓴다.
// 첫 줄은 앱 기본 반등 패턴이고, 나머지는 널리 알려진 규칙을 원래 형태에 가깝게 옮긴 것이다. 숫자는 시작값이다.
// 성과를 약속하는 문구는 쓰지 않는다.
import { newStrategy } from './defaults';
import type { Strategy } from './types';

export interface StrategyTemplate {
  id: 'rebound' | 'ma200' | 'golden' | 'breakout' | 'rsi2';
  name: string;
  desc: string;
  /** 어디서 알려진 규칙인지(앱 기본은 null) */
  source: string | null;
  apply(s: Strategy): void;
}

const noExits = (s: Strategy) => {
  s.rules.sell.takeProfit = { ...s.rules.sell.takeProfit, on: false };
  s.rules.sell.stopLoss = { ...s.rules.sell.stopLoss, on: false };
};

export const TEMPLATES: readonly StrategyTemplate[] = [
  { id: 'rebound', name: '하락 후 반등', desc: '고점에서 떨어진 뒤 다시 오를 때 사요. 익절 +15%, 손절 −5%', source: null, apply: () => {} },
  {
    id: 'ma200',
    name: '200일선 추세 추종',
    desc: '종가가 200일 이동평균 위면 사고, 아래로 내려가면 팔아요',
    source: 'Faber(2007) 이동평균 타이밍',
    apply(s) {
      s.rules.buy = [{ conds: [{ kind: 'maPrice', period: 200, side: 'above' }] }];
      noExits(s);
      s.rules.sell.signal = { on: true, groups: [{ conds: [{ kind: 'maPrice', period: 200, side: 'below' }] }] };
    },
  },
  {
    id: 'golden',
    name: '골든크로스 50/200',
    desc: '50일선이 200일선을 위로 넘으면 사고, 아래로 넘으면(데드크로스) 팔아요',
    source: '고전 이동평균 교차',
    apply(s) {
      s.rules.buy = [{ conds: [{ kind: 'maCross', short: 50, long: 200, dir: 'golden' }] }];
      noExits(s);
      s.rules.sell.signal = { on: true, groups: [{ conds: [{ kind: 'maCross', short: 50, long: 200, dir: 'dead' }] }] };
    },
  },
  {
    id: 'breakout',
    name: '52주 신고가 돌파',
    desc: '종가가 지난 1년(250거래일) 최고가를 넘으면 사고, 고점에서 15% 밀리면 팔아요',
    source: 'George·Hwang(2004) 52주 고가 모멘텀, 터틀 돌파',
    apply(s) {
      s.rules.buy = [{ conds: [{ kind: 'newHigh', days: 250 }] }];
      noExits(s);
      s.rules.sell.trailing = { on: true, pct: 15 };
    },
  },
  {
    id: 'rsi2',
    name: 'RSI(2) 눌림목',
    desc: '200일선 위 종목의 RSI(2)가 10 아래로 떨어지면 사고, 종가가 5일선을 넘으면 팔아요',
    source: 'Connors RSI(2) 평균 회귀',
    apply(s) {
      s.rules.buy = [{ conds: [{ kind: 'rsi', period: 2, level: 10, op: 'below' }, { kind: 'maPrice', period: 200, side: 'above' }] }];
      noExits(s);
      s.rules.sell.signal = { on: true, groups: [{ conds: [{ kind: 'maPrice', period: 5, side: 'above' }] }] };
    },
  },
];

export function fromTemplate(t: StrategyTemplate, now: number, groupId: string | null, name: string): Strategy {
  const s = newStrategy(now, groupId, name);
  t.apply(s);
  return s;
}
