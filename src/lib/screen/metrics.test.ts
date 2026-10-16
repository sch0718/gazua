import { describe, expect, it } from 'vitest';
import type { HoldSegment } from './holdSelection';
import { beatCount, curveStats } from './metrics';

describe('curveStats', () => {
  const days = ['2025-01-01', '2025-01-02', '2025-01-03', '2026-01-01'];
  it('총수익·CAGR(달력일)·최대 낙폭·변동성', () => {
    const s = curveStats([110, 99, 121, 121], days, 100);
    // 365일 간격이라 CAGR은 총수익과 같다
    expect(s.totalPct).toBeCloseTo(21, 9);
    expect(s.cagrPct).toBeCloseTo(21, 9);
    expect(s.mddPct).toBeCloseTo(-10, 9); // 110 → 99
  });
  it('변동성은 일간 수익률 표준편차(n−1) × √252', () => {
    expect(curveStats([100, 110, 99, 121], days, 100).volPct).toBeCloseTo(258.2, 1);
  });
  it('시작값 아래로만 내려가면 낙폭은 초기 자본 기준이다', () => {
    expect(curveStats([90, 80], ['2025-01-01', '2025-01-02'], 100).mddPct).toBeCloseTo(-20, 9);
  });
});

describe('beatCount', () => {
  const axis = ['2025-01-02', '2025-01-03', '2025-01-06', '2025-01-07'];
  const seg = (from: string, to: string, rets: (number | null)[]): HoldSegment => ({
    from,
    to,
    picked: rets.map((retPct, i) => ({ symbol: `S${i}`, retPct, soldAtLastClose: false, notBought: retPct === null })),
  });
  it('구간별로 ① 수익률(평균, 못 산 몫은 0%)이 지수보다 크면 센다', () => {
    const idx = [100, 105, 105, 100]; // 구간 +5%, 0%, −4.76%
    const segs = [seg(axis[0], axis[1], [10, 2]), seg(axis[1], axis[2], [null, 4]), seg(axis[2], axis[3], [])];
    // 6% > 5% 이김, (0+4)/2=2% > 0% 이김, 빈 구간 0% > −4.76% 이김
    expect(beatCount(segs, idx, axis)).toEqual({ beat: 3, total: 3 });
    expect(beatCount([seg(axis[0], axis[1], [4])], idx, axis)).toEqual({ beat: 0, total: 1 });
  });
});
