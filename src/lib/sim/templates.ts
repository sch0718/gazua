// 새 전략 프리셋(스펙 §3.4). 규칙(rules·scaleIn·sizing)만 정하고 종목·기간·비교·비용은 newStrategy 값을 쓴다.
// 첫 줄은 앱 기본 반등 패턴이고, 나머지는 널리 알려진 규칙을 원래 형태에 가깝게 옮긴 것이다. 숫자는 시작값이다.
// 성과를 약속하는 문구는 쓰지 않는다.
import { newStrategy } from './defaults';
import type { Strategy } from './types';

export type Regime = 'up' | 'down' | 'range' | 'crash';

export const REGIMES: readonly { id: Regime; title: string }[] = [
  { id: 'up', title: '상승장' },
  { id: 'range', title: '횡보장' },
  { id: 'down', title: '하락장' },
  { id: 'crash', title: '급락 뒤' },
];

export interface StrategyTemplate {
  id: 'rebound' | 'ma200' | 'golden' | 'breakout' | 'rsi2' | 'crash';
  name: string;
  desc: string;
  /** 어디서 알려진 규칙인지(앱 기본은 null) */
  source: string | null;
  regimes: Regime[];
  evidence: string | null;
  apply(s: Strategy): void;
}

const noExits = (s: Strategy) => {
  s.rules.sell.takeProfit = { ...s.rules.sell.takeProfit, on: false };
  s.rules.sell.stopLoss = { ...s.rules.sell.stopLoss, on: false };
};

export const TEMPLATES: readonly StrategyTemplate[] = [
  {
    id: 'rebound',
    name: '하락 후 반등',
    desc: '고점에서 떨어진 뒤 다시 오를 때 사요. 익절 +15%, 손절 −5%',
    source: null,
    regimes: [],
    evidence: null,
    apply: () => {},
  },
  {
    id: 'ma200',
    name: '200일선 추세 추종',
    desc: '종가가 200일 이동평균 위면 사고, 아래로 내려가면 팔아요',
    source: 'Faber(2007) 이동평균 타이밍',
    regimes: ['up'],
    evidence: '과거 상승장 구간에서 시험: 4구간 모두 수익이 났어요. 그냥 보유했을 때보다 수익이 작았고 구간은 지나고 나서 나눴어요.',
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
    regimes: [],
    evidence: null,
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
    regimes: ['up'],
    evidence: '과거 상승장 구간에서 시험: 4구간 모두 수익이 났어요. 그냥 보유했을 때보다 수익이 작았고 구간은 지나고 나서 나눴어요.',
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
    regimes: ['range', 'down'],
    evidence: '과거 횡보장·하락장 구간에서 시험: 횡보장 5구간 중 4구간과 하락장 3구간 중 2구간에서 수익이 났어요. 구간은 지나고 나서 나눴어요.',
    apply(s) {
      s.rules.buy = [{ conds: [{ kind: 'rsi', period: 2, level: 10, op: 'below' }, { kind: 'maPrice', period: 200, side: 'above' }] }];
      noExits(s);
      s.rules.sell.signal = { on: true, groups: [{ conds: [{ kind: 'maPrice', period: 5, side: 'above' }] }] };
    },
  },
  {
    // RSI(2) 눌림목의 200일선 조건을 빼고 급락 조건을 더한 하락장용. 오래 들지 않게 기간 청산·손절을 둔다.
    id: 'crash',
    name: '급락 후 단기 반등',
    desc: '5일 동안 10% 넘게 빠지고 RSI(2)가 10 아래면 사요. 종가가 5일선을 넘거나 5거래일이 지나면 팔고, 손절 −8%',
    source: '단기 과매도 평균 회귀(Connors 계열)',
    regimes: ['down', 'crash'],
    evidence: '과거 하락장·급락장 구간에서 시험: 하락장 3구간과 급락장 2구간에서 모두 수익이 났어요. 구간은 지나고 나서 나눴어요.',
    apply(s) {
      s.rules.buy = [{ conds: [{ kind: 'change', days: 5, pct: -10, op: 'below' }, { kind: 'rsi', period: 2, level: 10, op: 'below' }] }];
      noExits(s);
      s.rules.sell.stopLoss = { ...s.rules.sell.stopLoss, on: true, pct: 8 };
      s.rules.sell.timeExit = { on: true, days: 5 };
      s.rules.sell.signal = { on: true, groups: [{ conds: [{ kind: 'maPrice', period: 5, side: 'above' }] }] };
    },
  },
];

export function templatesByRegime(): { id: Regime | 'other'; title: string; templates: StrategyTemplate[] }[] {
  const groups = REGIMES.map(({ id, title }) => ({
    id,
    title,
    templates: TEMPLATES.filter((t) => t.regimes.includes(id)),
  }));
  return [
    ...groups,
    { id: 'other' as const, title: '그 밖의 전략', templates: TEMPLATES.filter((t) => t.regimes.length === 0) },
  ].filter((group) => group.templates.length > 0);
}

export function fromTemplate(t: StrategyTemplate, now: number, groupId: string | null, name: string): Strategy {
  const s = newStrategy(now, groupId, name);
  t.apply(s);
  return s;
}
