import { describe, expect, it } from 'vitest';
import { maxShares, openPosition } from './position';
import type { Strategy } from './types';

type Exit = Strategy['exit'];
const exit: Exit = {
  takeProfit: [{ pct: 10, sellPct: 50 }, { pct: 15, sellPct: 100 }],
  stopLoss: { pct: 5, basis: 'avgAfterScaleIn' },
  afterFirstTake: 'keep',
};
const scale = { on: true, stepPct: 3, maxAdds: 2 };

describe('position', () => {
  it('분할 매수, 평균 단가, 손절선, 익절 단계', () => {
    const p = openPosition(100, 10, scale, exit);
    expect(p.stopPrice()).toBeNull();
    expect(p.nextAddPrice()).toBe(97);
    p.buy(97, 10);
    p.buy(94.09, 10);
    expect(p.adds).toBe(2);
    expect(p.initialQty).toBe(30);
    expect(p.avgPrice).toBeCloseTo(97.03, 2);
    expect(p.stopPrice()).toBeCloseTo(92.1785, 3);
    expect(p.nextAddPrice()).toBeNull();
    expect(p.takeLevels()).toEqual([
      { stage: 1, price: expect.closeTo(106.733, 3), qty: 15 },
      { stage: 2, price: expect.closeTo(111.5845, 3), qty: 30 },
    ]);
    p.sell(15, 1);
    expect(p.stagesDone).toBe(1);
    expect(p.avgPrice).toBeCloseTo(97.03, 2);
    expect(p.takeLevels()).toEqual([{ stage: 2, price: expect.closeTo(111.5845, 3), qty: 15 }]);
    expect(p.nextAddPrice()).toBeNull();
  });

  it('nextAddPrice는 직전 매수가 기준이고 buy가 add로 센다', () => {
    const p = openPosition(100, 10, scale, exit);
    p.buy(97, 10);
    expect(p.adds).toBe(1);
    expect(p.lastBuyPrice).toBe(97);
    expect(p.nextAddPrice()).toBeCloseTo(94.09, 6);
    expect(p.firstPrice).toBe(100);
  });

  it('분할 꺼짐이면 손절선이 바로 생기고 추가 매수 없음', () => {
    const p = openPosition(100, 10, { ...scale, on: false }, exit);
    expect(p.stopPrice()).toBeCloseTo(95, 6);
    expect(p.nextAddPrice()).toBeNull();
  });

  it('일부 매도하면 분할 완료로 본다', () => {
    const p = openPosition(100, 10, scale, exit);
    expect(p.stopPrice()).toBeNull();
    p.sell(1);
    expect(p.soldAny).toBe(true);
    expect(p.stopPrice()).toBeCloseTo(95, 6);
    expect(p.nextAddPrice()).toBeNull();
  });

  it('breakeven: 1단계 뒤 손절선 = max(손절선, 평균 단가)', () => {
    const p = openPosition(100, 10, { ...scale, on: false }, { ...exit, afterFirstTake: 'breakeven' });
    expect(p.stopPrice()).toBeCloseTo(95, 6);
    p.sell(5, 1);
    expect(p.stopPrice()).toBe(100);
  });

  it('breakeven: 기본 손절선이 null이어도 평균 단가', () => {
    const p = openPosition(100, 10, scale, { ...exit, afterFirstTake: 'breakeven' });
    p.sell(5, 1);
    expect(p.stopPrice()).toBe(100);
  });

  it('keep이면 1단계 뒤에도 손절선 그대로', () => {
    const p = openPosition(100, 10, { ...scale, on: false }, exit);
    p.sell(5, 1);
    expect(p.stopPrice()).toBeCloseTo(95, 6);
  });

  it('firstBuy: 추가 매수해도 첫 매수가 기준', () => {
    const p = openPosition(100, 10, scale, { ...exit, stopLoss: { pct: 5, basis: 'firstBuy' } });
    expect(p.stopPrice()).toBeCloseTo(95, 6);
    p.buy(97, 10);
    expect(p.stopPrice()).toBeCloseTo(95, 6);
  });

  it('avgAlways: 첫 매수 직후부터 평균 단가 기준', () => {
    const p = openPosition(100, 10, scale, { ...exit, stopLoss: { pct: 5, basis: 'avgAlways' } });
    expect(p.stopPrice()).toBeCloseTo(95, 6);
    p.buy(90, 10);
    expect(p.stopPrice()).toBeCloseTo(95 * 0.95, 6);
  });

  it('수량 내림: initialQty 3, sellPct 50이면 1주', () => {
    const p = openPosition(100, 3, { ...scale, on: false }, exit);
    expect(p.takeLevels()[0].qty).toBe(1);
  });

  it('수량 0인 단계도 목록에 남는다', () => {
    const p = openPosition(100, 1, { ...scale, on: false }, exit);
    expect(p.takeLevels()[0]).toEqual({ stage: 1, price: expect.closeTo(110, 6), qty: 0 });
    expect(p.takeLevels()[1].qty).toBe(1);
  });

  it('남은 수량보다 큰 중간 단계는 남은 수량으로 제한', () => {
    const p = openPosition(100, 10, { ...scale, on: false }, exit);
    p.sell(8);
    expect(p.takeLevels()[0].qty).toBe(2);
    expect(p.takeLevels()[1].qty).toBe(2);
  });

  it('잘못된 매수·매도는 오류', () => {
    const p = openPosition(100, 10, scale, exit);
    expect(() => p.sell(11)).toThrow();
    expect(() => p.sell(0)).toThrow();
    expect(() => p.buy(100, 0)).toThrow();
    expect(() => p.buy(100, -1)).toThrow();
  });

  it('sell 단계는 뒤로 가지 않는다', () => {
    const p = openPosition(100, 10, scale, exit);
    p.sell(2, 2);
    p.sell(1, 1);
    expect(p.stagesDone).toBe(2);
  });
});

describe('maxShares', () => {
  it('경계: 560,084원 / 80,000원 / 0.015% → 7주 (나눗셈은 6.999…)', () => {
    expect(maxShares(560_084, 80_000, 0.015)).toBe(7);
  });
  it('1원 모자라면 6주, 수수료 0이면 floor', () => {
    expect(maxShares(560_083, 80_000, 0.015)).toBe(6);
    expect(maxShares(1000, 300, 0)).toBe(3);
    expect(maxShares(100, 300, 0.015)).toBe(0);
  });
});
