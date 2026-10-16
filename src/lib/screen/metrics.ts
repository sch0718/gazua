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
 * 구간마다 ①의 순자산 수익률(수수료·세금 포함)이 같은 두 날짜의 지수 수익률보다 엄격히 크면 센다.
 * 첫 구간은 둘 다 initial에서 시작한다(지수는 첫날 시가). 축이나 자산 곡선에 없는 날짜의 구간은 합계에서도 뺀다.
 */
export function beatCount(
  segments: HoldSegment[],
  equity: { date: string; value: number }[],
  indexCurve: number[],
  axis: string[],
  initial: number,
): { beat: number; total: number } {
  const at = new Map(equity.map((e, i) => [e.date, i]));
  let beat = 0;
  let total = 0;
  for (const s of segments) {
    const ef = at.get(s.from);
    const et = at.get(s.to);
    const xf = axis.indexOf(s.from);
    const xt = axis.indexOf(s.to);
    if (ef === undefined || et === undefined || xf < 0 || xt < 0) continue;
    total++;
    const first = ef === 0;
    const hold = equity[et].value / (first ? initial : equity[ef].value);
    const index = indexCurve[xt] / (first ? initial : indexCurve[xf]);
    if (hold > index) beat++;
  }
  return { beat, total };
}
