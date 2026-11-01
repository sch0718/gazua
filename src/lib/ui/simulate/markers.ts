// 체결 마커(거래 차트 시트·재생 자산 차트 공용): 같은 방향 체결을 묶고 매수는 아래 ▲, 매도는 위 ▼로 그린다.
import type { SeriesMarker, Time } from 'lightweight-charts';
import type { Trade } from '../../sim/types';

/** [CSS 변수, 대체 색(라이트 토큰 값)] */
export type ColorToken = [string, string];

export const TRADE_LABEL: Record<Trade['kind'], string> = {
  buy: '매수',
  add: '추가',
  take: '익절',
  gapTake: '익절',
  stop: '손절',
  gapStop: '손절',
  trail: '트레일',
  time: '기간',
  signalSell: '조건',
};

const ACCENT: ColorToken = ['--accent', '#5b47e0'];
const UP: ColorToken = ['--up', '#d4202f'];
const DOWN: ColorToken = ['--down', '#1d5fd6'];
/** 익절·손절처럼 색이 섞인 마커 */
const MIXED_COLOR: ColorToken = ['--t2', '#5b6069'];
// 매수 = 강조색, 익절 = 상승색, 손절 = 하락색, 트레일링·기간 청산·조건 매도 = 손익 방향이 정해지지 않아 섞인 색
export const MARKER_COLOR: Record<Trade['kind'], ColorToken> = {
  buy: ACCENT,
  add: ACCENT,
  take: UP,
  gapTake: UP,
  stop: DOWN,
  gapStop: DOWN,
  trail: MIXED_COLOR,
  time: MIXED_COLOR,
  signalSell: MIXED_COLOR,
};

const isBuying = (t: Trade): boolean => t.kind === 'buy' || t.kind === 'add';

interface MarkerGroup {
  time: string;
  bar: number;
  buying: boolean;
  kinds: Trade['kind'][];
}

/** 같은 방향 거래가 mergeBars봉 안에 몰리면 마커 하나로(라벨 `매수·추가`·`익절·손절`). 0이면 같은 날만. 시간 순으로 돌려준다. */
export function mergedMarkers(list: Trade[], barOf: (date: string) => number, mergeBars: number): MarkerGroup[] {
  const groups: MarkerGroup[] = [];
  const lastOf = new Map<boolean, MarkerGroup>();
  for (const t of list) {
    const bar = barOf(t.date);
    const last = lastOf.get(isBuying(t));
    if (last && bar - last.bar <= mergeBars) {
      last.kinds.push(t.kind);
      continue;
    }
    const g = { time: t.date, bar, buying: isBuying(t), kinds: [t.kind] };
    groups.push(g);
    lastOf.set(g.buying, g);
  }
  return groups.sort((a, b) => a.bar - b.bar);
}

/** lightweight-charts 마커. color는 토큰을 실제 색으로 바꾼다 */
export function tradeMarkers(list: Trade[], barOf: (date: string) => number, mergeBars: number, color: (token: ColorToken) => string): SeriesMarker<Time>[] {
  return mergedMarkers(list, barOf, mergeBars).map((g) => {
    const colors = [...new Set(g.kinds.map((k) => color(MARKER_COLOR[k])))];
    return {
      time: g.time as Time,
      position: g.buying ? 'belowBar' : 'aboveBar',
      shape: g.buying ? 'arrowUp' : 'arrowDown',
      color: colors.length === 1 ? colors[0] : color(MIXED_COLOR),
      text: [...new Set(g.kinds.map((k) => TRADE_LABEL[k]))].join('·'),
    };
  });
}
