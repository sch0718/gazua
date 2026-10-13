import { describe, expect, it } from 'vitest';
import { holdCurve, singleCurve } from './benchmarks';
import { roundMoney } from './money';
import { costOf, maxShares } from './position';
import { sizeBuy } from './simulate';
import { bar, tradingDates } from './testBars';

/** 시드 고정 난수(mulberry32) */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAYS = tradingDates('2026-01-05', 2);
const stockOf = (price: number) => ({
  symbol: 'S',
  name: 'S',
  market: 'KOSPI' as const,
  isEtf: false,
  candles: DAYS.map((d) => bar(d, price, price, price, price)),
});

describe('roundMoney', () => {
  it('0.0001원 단위로 맞춘다', () => {
    expect(roundMoney(1020153.0000000001)).toBe(1020153);
    expect(roundMoney(0.12345)).toBe(0.1235);
    expect(roundMoney(0)).toBe(0);
  });
});

describe('금액 = costOf(q)이면 정확히 q주 (시드 고정 속성 테스트)', () => {
  const fees = [0, 0.015, 0.1, 0.25, 1];
  const next = rng(20261013);

  it('maxShares·sizeBuy·현금 0·holdCurve·singleCurve가 모두 q주로 맞는다', () => {
    for (let n = 0; n < 3000; n++) {
      const price = 100 + Math.floor(next() * 499_901);
      const q = 1 + Math.floor(next() * 5000);
      const fee = fees[Math.floor(next() * fees.length)];
      const amount = costOf(q, price, fee);
      const tag = `price=${price} q=${q} fee=${fee} amount=${amount}`;

      expect(roundMoney(amount), tag).toBe(amount);
      expect(maxShares(amount, price, fee), tag).toBe(q);

      const sized = sizeBuy(amount, price, fee, amount);
      if (typeof sized === 'string') throw new Error(`${tag}: ${sized}`);
      expect(sized.qty, tag).toBe(q);
      expect(sized.cost, tag).toBe(amount);
      expect(roundMoney(sized.fee), tag).toBe(sized.fee);
      expect(roundMoney(amount - sized.cost), tag).toBe(0);

      const s = stockOf(price);
      expect(singleCurve(DAYS, s.candles, amount, fee)[0], tag).toBe(q * price);
      expect(holdCurve(DAYS, [s, s], amount * 2, fee)[0], tag).toBe(2 * q * price);

      // 1원 모자라면 q-1주, q=1이면 못 산다
      const less = amount - 1;
      expect(maxShares(less, price, fee), tag).toBe(q - 1);
      const sizedLess = sizeBuy(less, price, fee, less);
      if (q === 1) expect(sizedLess, tag).toBe('1주가 1회 금액보다 비쌈');
      else expect(typeof sizedLess === 'string' ? sizedLess : sizedLess.qty, tag).toBe(q - 1);
    }
  });
});
