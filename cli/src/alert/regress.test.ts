import { describe, expect, it } from 'vitest';
import { fitLine, stdev } from './regress';

describe('단일 회귀', () => {
  it('상수항과 베타·결정계수를 복원한다', () => {
    const xs = Array.from({ length: 80 }, (_, i) => i / 1000);
    const fit = fitLine(xs, xs.map((x) => 0.001 + 1.5 * x), 30)!;
    expect(fit.alpha).toBeCloseTo(0.001, 12);
    expect(fit.beta).toBeCloseTo(1.5, 12);
    expect(fit.r2).toBeCloseTo(1, 12);
    expect(fit.t).toBeGreaterThan(1000);
    expect(fit.n).toBe(80);
  });
  it('유한한 짝만 쓰고 표본 부족·분산 0을 제외한다', () => {
    expect(fitLine([1, 2, NaN, 3, 4], [2, 4, 1, Infinity, 8], 3)?.n).toBe(3);
    expect(fitLine([1, 1, 1], [1, 2, 3], 3)).toBeNull();
    expect(fitLine([1, 2], [2, 4], 3)).toBeNull();
    expect(fitLine([1, 2], [2, 4], 2)).toMatchObject({ alpha: 0, beta: 2, r2: 1, n: 2 });
    expect(fitLine([1, 2, 3], [4, 4, 4], 3)).toMatchObject({ beta: 0, r2: 0, t: 0 });
  });
  it('표본 표준편차를 계산한다', () => {
    expect(stdev([1, 2, 3])).toBe(1);
    expect(stdev([])).toBe(0);
    expect(stdev([1])).toBe(0);
  });
});
