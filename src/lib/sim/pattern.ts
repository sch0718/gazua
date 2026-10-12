import type { Candle } from '../data/metrics';
import { kstDate } from '../time/kst';
import { sma } from './indicators';
import type { PatternSnapshot, Strategy } from './types';

export interface PatternTracker {
  /** i번째 봉(그 종목 배열 기준)의 종가로 신호를 판단한다. 상태는 바꾸지 않는다. 어제까지의 상태를 쓴다. */
  signal(i: number): { reason: string; snapshot: PatternSnapshot } | null;
  /** i번째 봉 종가로 상태를 갱신한다. signal(i) 다음에 부른다. */
  update(i: number): void;
  /** 전량 매도한 날 i에 부른다. A = c[i], L·B 없음. */
  reset(i: number): void;
  /** nearMiss용: 지금까지 본 가장 큰 (A−L)/A %, 하락 조건을 만족한 날 수 */
  stats(): { maxDropPct: number; declineDays: number };
}

export function createPatternTracker(candles: Candle[], entry: Strategy['entry']): PatternTracker {
  const c = candles.map((k) => k.c);
  const { decline, triggers, filter } = entry;
  const maCross = triggers.maCross.on ? sma(c, triggers.maCross.period) : [];
  const maShort = triggers.goldenCross.on ? sma(c, triggers.goldenCross.short) : [];
  const maLong = triggers.goldenCross.on ? sma(c, triggers.goldenCross.long) : [];
  const maFilter = filter.aboveMa.on ? sma(c, filter.aboveMa.period) : [];

  let aIdx = -1; // 아직 첫 봉을 보지 않음
  let lIdx = -1; // L 없음
  let peaks: number[] = []; // aIdx 이후 확정된 국소 고점 인덱스(오름차순)
  let maxDropPct = 0;
  let declineDays = 0;

  const bIdx = (): number => {
    for (let k = peaks.length - 1; k >= 0; k--) if (peaks[k] < lIdx) return peaks[k];
    return aIdx;
  };

  // 어제까지의 상태로 오늘 t의 하락 조건
  const declineOk = (t: number): boolean => {
    if (aIdx < 0 || lIdx < 0) return false;
    const a = c[aIdx];
    if (decline.dropPct.on && ((a - c[lIdx]) / a) * 100 < decline.dropPct.value) return false;
    if (decline.days.on && t - aIdx < decline.days.value) return false;
    return true;
  };

  // up이 어제 base 이하, 오늘 base 초과. 값이 모자라면 불만족
  const crossed = (up: (number | null)[], base: (number | null)[], t: number): boolean => {
    const u0 = up[t - 1];
    const u1 = up[t];
    const b0 = base[t - 1];
    const b1 = base[t];
    if (u0 == null || u1 == null || b0 == null || b1 == null) return false;
    return u0 <= b0 && u1 > b1;
  };

  const reasonAt = (t: number): string | null => {
    const rb = triggers.reboundDays;
    if (rb.on && t - lIdx >= rb.value) {
      let up = true;
      for (let k = lIdx + 1; k <= t && up; k++) up = c[k] > c[k - 1];
      if (up) return `${rb.value}일 연속 상승`;
    }
    const bo = triggers.breakout;
    if (bo.on) {
      const x = bo.level === 'A' ? c[aIdx] : c[bIdx()];
      if (c[t - 1] <= x && x < c[t]) return `${bo.level} 돌파`;
    }
    if (triggers.maCross.on && crossed(c, maCross, t)) return `${triggers.maCross.period}일선 돌파`;
    const gc = triggers.goldenCross;
    if (gc.on && crossed(maShort, maLong, t)) return `골든크로스 ${gc.short}/${gc.long}`;
    return null;
  };

  const reset = (i: number): void => {
    aIdx = i;
    lIdx = -1;
    peaks = [];
  };

  return {
    signal(t) {
      if (t < 1 || !declineOk(t)) return null;
      if (filter.aboveMa.on) {
        const m = maFilter[t];
        if (m == null || !(c[t] > m)) return null;
      }
      const reason = reasonAt(t);
      if (!reason) return null;
      return {
        reason,
        snapshot: {
          a: c[aIdx],
          aDate: kstDate(candles[aIdx].t),
          b: c[bIdx()],
          l: c[lIdx],
          lDate: kstDate(candles[lIdx].t),
        },
      };
    },
    update(i) {
      if (declineOk(i)) declineDays++;
      if (aIdx < 0) {
        reset(i);
        return;
      }
      if (i <= aIdx) return; // 같은 날 reset 뒤 다시 불린 경우
      if (c[i] > c[aIdx]) {
        aIdx = i;
        lIdx = -1;
        peaks = [];
        return;
      }
      if (i - 1 > aIdx && c[i - 2] < c[i - 1] && c[i - 1] > c[i]) peaks.push(i - 1);
      if (lIdx < 0 || c[i] <= c[lIdx]) lIdx = i;
      const a = c[aIdx];
      maxDropPct = Math.max(maxDropPct, ((a - c[lIdx]) / a) * 100);
    },
    reset,
    stats() {
      return { maxDropPct, declineDays };
    },
  };
}
