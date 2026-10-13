import { kstEpoch } from '../time/kst';
import type { CoreResult } from './simulate';
import type { SimResult } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
export const retPct = (curve: number[], initial: number): number => ((curve[curve.length - 1] ?? initial) / initial - 1) * 100;

export function summarize(
  core: CoreResult,
  curves: { hold: number[]; index: number[] | null; benchmark: number[] | null },
  days: string[],
  initial: number,
): SimResult['summary'] {
  const values = core.equity.map((e) => e.value);
  const final = values[values.length - 1] ?? initial;
  const totalReturnPct = (final / initial - 1) * 100;

  const calDays = days.length ? Math.round((kstEpoch(days[days.length - 1], '00:00:00') - kstEpoch(days[0], '00:00:00')) / DAY_MS) : 0;
  const cagrPct = calDays > 0 ? ((final / initial) ** (365 / calDays) - 1) * 100 : totalReturnPct;

  let peak = initial;
  let mddPct = 0;
  for (const v of values) {
    peak = Math.max(peak, v);
    mddPct = Math.min(mddPct, (v / peak - 1) * 100);
  }

  const closed = core.roundTrips.filter((r) => r.close !== null);
  const winPcts = closed.filter((r) => r.pnl > 0).map((r) => (r.pnl / r.cost) * 100);
  const lossPcts = closed.filter((r) => !(r.pnl > 0)).map((r) => (r.pnl / r.cost) * 100);

  const holdPct = retPct(curves.hold, initial);
  const indexPct = curves.index ? retPct(curves.index, initial) : null;
  const benchPct = curves.benchmark ? retPct(curves.benchmark, initial) : null;

  return {
    totalReturnPct,
    cagrPct,
    mddPct,
    winRatePct: closed.length ? (winPcts.length / closed.length) * 100 : null,
    wins: winPcts.length,
    losses: lossPcts.length,
    avgWinPct: winPcts.length ? mean(winPcts) : null,
    avgLossPct: lossPcts.length ? mean(lossPcts) : null,
    roundTrips: core.roundTrips.length,
    openPositions: core.roundTrips.length - closed.length,
    avgHoldDays: closed.length ? mean(closed.map((r) => r.holdDays)) : null,
    avgCashPct: core.equity.length ? mean(core.equity.map((e) => (e.value ? (e.cash / e.value) * 100 : 0))) : 0,
    skippedSignals: core.skipped.length,
    vsHoldPp: totalReturnPct - holdPct,
    vsIndexPp: indexPct === null ? null : totalReturnPct - indexPct,
    vsBenchmarkPp: benchPct === null ? null : totalReturnPct - benchPct,
  };
}

/** 거래도 건너뜀도 없을 때만 (신호가 났다가 건너뛴 경우는 null) */
export function nearMiss(core: CoreResult): SimResult['nearMiss'] {
  if (core.trades.length > 0 || core.skipped.length > 0) return null;
  return { ...core.patternStats };
}
