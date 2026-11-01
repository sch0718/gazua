import { describe, expect, it } from 'vitest';
import { rollingMax, rsi, volumeRatio } from './indicators';

// StockCharts의 14일 RSI 예시표 앞부분(스펙 §12.2) — 원본 표의 소수 넷째 자리 종가. 첫 값 70.533, 다음 66.319(검토에서 확인)
const SC = [44.3389, 44.0902, 44.1497, 43.6124, 44.3278, 44.8264, 45.0955, 45.4245, 45.8433, 46.0826, 45.8931, 46.0328, 45.614, 46.282, 46.282, 46.0028];

describe('rsi', () => {
  it('손으로 계산한 값: 기간 2', () => {
    // 변화 +1,+1,−1. i=2: 상승 평균 1, 하락 0 → 100. i=3: 상승 (1·1+0)/2=0.5, 하락 (0·1+1)/2=0.5 → 50
    expect(rsi([1, 2, 3, 2], 2)).toEqual([null, null, 100, 50]);
  });
  it('StockCharts 예시표 14일: 첫 값 70.53, 다음 66.32', () => {
    const r = rsi(SC, 14);
    expect(r.slice(0, 14).every((x) => x === null)).toBe(true);
    expect(r[14]).toBeCloseTo(70.533, 2);
    expect(r[15]).toBeCloseTo(66.319, 2);
  });
  it('특수값: 계속 오르면 100, 변화가 없으면 50', () => {
    expect(rsi([1, 2, 3, 4, 5], 3)[4]).toBe(100);
    expect(rsi([5, 5, 5, 5, 5], 3)[4]).toBe(50);
  });
  it('start부터 평활을 시작한다: 앞을 잘라도 같은 위치는 같은 값', () => {
    const c = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 5 + i * 0.1);
    const full = rsi(c, 14, 10);
    const cut = rsi(c.slice(10), 14, 0);
    for (let i = 24; i < 60; i++) expect(full[i]).toBeCloseTo(cut[i - 10]!, 10);
    expect(full[23]).toBeNull();
  });
  it('봉이 모자라면 모두 null', () => {
    expect(rsi([1, 2, 3], 3)).toEqual([null, null, null]);
  });
});

describe('volumeRatio', () => {
  it('오늘은 평균에서 빼고 전날까지 n개 평균과 비교한다', () => {
    expect(volumeRatio([10, 20, 30, 60], 3)).toEqual([null, null, null, 3]);
  });
  it('v ≤ 0은 값 없음: 평균에서 빼고, 오늘이 0이면 null', () => {
    expect(volumeRatio([10, 0, 30, 40], 3)[3]).toBe(2);
    expect(volumeRatio([10, 20, 30, 0], 3)[3]).toBeNull();
    expect(volumeRatio([0, 0, 0, 50], 3)[3]).toBeNull();
    expect(volumeRatio([10, Number.NaN, 30, 40], 3)[3]).toBe(2);
  });
});

describe('rollingMax', () => {
  it('오늘 포함 window개 최댓값, 개수가 min 미만이면 null', () => {
    expect(rollingMax([3, 1, 4, 1, 5], 3, 3)).toEqual([null, null, 4, 4, 5]);
    expect(rollingMax([3, 1, 4, 1, 5], 3, 1)).toEqual([3, 3, 4, 4, 5]);
  });
});
