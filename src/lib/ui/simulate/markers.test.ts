import { describe, expect, it } from 'vitest';
import type { Trade } from '../../sim/types';
import { MARKER_COLOR, TRADE_LABEL, mergedMarkers, tradeMarkers, type ColorToken } from './markers';

const bars = ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05'];
const barOf = (d: string) => bars.indexOf(d);
const t = (date: string, kind: Trade['kind']): Trade => ({ date, symbol: 'X', kind, price: 100, qty: 1, fee: 0, tax: 0, reason: '' });
const fallback = (token: ColorToken) => token[1];

describe('mergedMarkers', () => {
  it('간격 0: 같은 날·같은 방향만 하나로, 다음 날은 따로', () => {
    const g = mergedMarkers([t(bars[0], 'buy'), t(bars[0], 'add'), t(bars[1], 'add'), t(bars[1], 'take'), t(bars[1], 'stop')], barOf, 0);
    expect(g.map((x) => [x.time, x.buying, x.kinds])).toEqual([
      [bars[0], true, ['buy', 'add']],
      [bars[1], true, ['add']],
      [bars[1], false, ['take', 'stop']],
    ]);
  });

  it('간격 3: 3봉 안의 같은 방향은 합치고 4봉 뒤는 따로', () => {
    expect(mergedMarkers([t(bars[0], 'buy'), t(bars[3], 'add')], barOf, 3)).toHaveLength(1);
    expect(mergedMarkers([t(bars[0], 'buy'), t(bars[4], 'add')], barOf, 3)).toHaveLength(2);
  });
});

describe('tradeMarkers', () => {
  it('매수는 아래 ▲ 강조색, 매도는 위 ▼, 색이 섞이면 중립색, 라벨은 겹치지 않게 ·로 잇는다', () => {
    const m = tradeMarkers([t(bars[0], 'buy'), t(bars[0], 'add'), t(bars[2], 'take'), t(bars[2], 'gapStop'), t(bars[3], 'gapTake')], barOf, 0, fallback);
    expect(m).toEqual([
      { time: bars[0], position: 'belowBar', shape: 'arrowUp', color: '#5b47e0', text: '매수·추가' },
      { time: bars[2], position: 'aboveBar', shape: 'arrowDown', color: '#5b6069', text: '익절·손절' },
      { time: bars[3], position: 'aboveBar', shape: 'arrowDown', color: '#d4202f', text: '익절' },
    ]);
  });
});

describe('새 매도 종류 표시', () => {
  it('라벨과 섞인 색을 쓴다', () => {
    expect(TRADE_LABEL.trail).toBe('트레일');
    expect(TRADE_LABEL.time).toBe('기간');
    expect(TRADE_LABEL.signalSell).toBe('조건');
    expect(MARKER_COLOR.trail).toEqual(['--t2', '#5b6069']);
    expect(MARKER_COLOR.time).toEqual(['--t2', '#5b6069']);
    expect(MARKER_COLOR.signalSell).toEqual(['--t2', '#5b6069']);
  });
});
