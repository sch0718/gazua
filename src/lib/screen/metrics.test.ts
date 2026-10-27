import { describe, expect, it } from 'vitest';
import { holdSelection, type HoldSegment } from './holdSelection';
import { beatCount, curveStats } from './metrics';
import { DATES, mkFile, mkStock } from './testData';

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
  const seg = (from: string, to: string): HoldSegment => ({ from, to, picked: [] });
  const eq = (...v: number[]) => v.map((value, i) => ({ date: axis[i], value }));
  it('구간마다 순자산 수익률이 지수보다 엄격히 크면 센다(첫 구간은 initial에서 시작)', () => {
    const idx = [100, 105, 105, 100];
    const segs = [seg(axis[0], axis[1]), seg(axis[1], axis[2]), seg(axis[2], axis[3])];
    // 1구간 108/100 > 105/100 이김, 2구간 105/108 < 1 짐, 3구간 105/105 = 1 > 100/105 이김
    expect(beatCount(segs, eq(102, 108, 105, 105), idx, axis, 100)).toEqual({ beat: 2, total: 3 });
  });
  it('첫 구간은 첫날 값이 아니라 initial에서 잰다(첫날 값에서 재면 결과가 뒤집히는 경우)', () => {
    // initial 100 기준: 순자산 112/100 = 1.12 > 지수 111/100 = 1.11 → 이김
    // 첫날 값 기준이었다면 112/110 ≈ 1.018 < 111/104 ≈ 1.067 → 짐
    const idx = [104, 111, 111, 111];
    expect(beatCount([seg(axis[0], axis[1])], eq(110, 112, 112, 112), idx, axis, 100)).toEqual({ beat: 1, total: 1 });
    // 첫 구간이 아니면 그 구간 시작일 값에서 잰다: 112/112 = 1 > 111/111 = 1 아님 → 짐
    expect(beatCount([seg(axis[1], axis[2])], eq(110, 112, 112, 112), idx, axis, 100)).toEqual({ beat: 0, total: 1 });
  });

  it('같으면 세지 않고, 날짜가 축에 없는 구간은 합계에서도 뺀다', () => {
    const idx = [100, 100, 100, 100];
    const segs = [seg(axis[0], axis[1]), seg('2030-01-01', '2030-02-01')];
    expect(beatCount(segs, eq(100, 100, 100, 100), idx, axis, 100)).toEqual({ beat: 0, total: 1 });
  });
  it('고른 종목의 총수익 평균이 지수를 넘어도 수수료·세금을 뺀 순자산이 못 넘으면 세지 않는다', () => {
    const A = [100, 100, 100, 100.2, 100.2, 100.2, 100.2, 100.2, 100.2, 100.2];
    const n = 10;
    const selections = [0, 3].map((i) => ({ date: DATES[i], passed: i ? 0 : 1, picked: i ? [] : [{ symbol: 'A', values: {} }] }));
    const axis10 = DATES.slice(0, n);
    const r = holdSelection({ axis: axis10, selections, data: mkFile([mkStock('A', A)], n), capital: 1_000_000, feePct: 0.1, periodEnd: DATES[9] });
    expect(r.segments[0].picked[0].retPct).toBeCloseTo(0.2, 9); // 총수익은 지수(+0.1%)보다 큼
    const idx = axis10.map((_, i) => (i < 3 ? 1_000_000 : 1_001_000));
    expect(beatCount(r.segments, r.equity, idx, axis10, 1_000_000)).toEqual({ beat: 0, total: 2 });
  });
});
