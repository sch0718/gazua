import { kstEpoch } from '../time/kst';
import type { HoldSegment } from './holdSelection';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 곡선 지표. 최대 낙폭은 0 이하, 변동성은 일간 수익률 표준편차(n−1) × √252 */
export function curveStats(curve: number[], days: string[], initial: number): { totalPct: number; cagrPct: number; mddPct: number; volPct: number } {
  const final = curve[curve.length - 1] ?? initial;
  const totalPct = (final / initial - 1) * 100;
  const calDays = days.length ? Math.round((kstEpoch(days[days.length - 1], '00:00:00') - kstEpoch(days[0], '00:00:00')) / DAY_MS) : 0;
  const cagrPct = calDays > 0 ? ((final / initial) ** (365 / calDays) - 1) * 100 : totalPct;

  let peak = initial;
  let mddPct = 0;
  for (const v of curve) {
    peak = Math.max(peak, v);
    mddPct = Math.min(mddPct, (v / peak - 1) * 100);
  }

  const r = curve.slice(1).map((v, i) => v / curve[i] - 1);
  let volPct = 0;
  if (r.length > 1) {
    const mean = r.reduce((a, b) => a + b, 0) / r.length;
    volPct = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1)) * Math.sqrt(252) * 100;
  }
  return { totalPct, cagrPct, mddPct, volPct };
}

/**
 * 구간별로 ①의 수익률(고른 종목 retPct의 평균, 못 산 몫과 빈 구간은 현금이라 0%)이
 * 같은 구간의 지수 수익률보다 크면 이긴 것으로 센다.
 */
export function beatCount(segments: HoldSegment[], indexCurve: number[], axis: string[]): { beat: number; total: number } {
  let beat = 0;
  for (const s of segments) {
    const a = axis.indexOf(s.from);
    const b = axis.indexOf(s.to);
    if (a < 0 || b < 0) continue;
    const hold = s.picked.length ? s.picked.reduce((sum, p) => sum + (p.retPct ?? 0), 0) / s.picked.length : 0;
    if (hold > (indexCurve[b] / indexCurve[a] - 1) * 100) beat++;
  }
  return { beat, total: segments.length };
}
