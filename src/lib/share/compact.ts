// 공유 스냅샷 만들기 중 열 형식·축약이 필요한 것(설계 2.3~2.5, 3절)과 받은 결과 펼치기(4.7). 검사는 snapshot.ts·checkResult.ts가 한다.
import type { SimResult } from '../sim/types';
import type { Group, Settings } from '../state/schema';
import { jsonBytes } from '../sync/forbidden';
import type { DoneState } from '../ui/simulate/runController.svelte';
import { AXIS_MAX, axisDate, dayOffset } from './checkResult';
import { SELL_KINDS, SKIP_REASONS } from './resultEnums';
import type { SymbolNames } from './shareText';
import {
  checkShareSnapshot,
  SHARE_MAX_BYTES,
  shareTitle,
  strategySnapshot,
  type CompareSnapshot,
  type ShareAxis,
  type ShareBuild,
  type SharedPerSymbol,
  type SharedTrade,
  type ShareReduction,
  type ShareSnapshot,
  type SimResultSnapshot,
} from './snapshot';

/** 시세 값은 넣지 않는다. 받은 사람이 자기 연결이나 데모로 다시 받는다. 지표는 사용자가 고른 값(app.settings.metric)이다. */
export function compareSnapshot(g: Group, s: Pick<Settings, 'period' | 'metric' | 'benchmark' | 'boardOrder'>): CompareSnapshot {
  return {
    kind: 'compare',
    v: 1,
    title: shareTitle(g.name),
    symbols: g.items.filter((i) => !i.hidden).map((i) => i.symbol),
    view: { period: { unit: s.period.unit, n: s.period.n }, metric: s.metric, benchmark: s.benchmark, boardOrder: s.boardOrder },
  };
}

// ── 값 다듬기 ─────────────────────────────────────────

/** 만들기 실패: null을 허용하지 않는 자리의 유한수가 아닌 값, 가리킬 곳이 없는 종목 등. path는 스냅샷 안 경로다 */
export class BuildError extends Error {
  constructor(readonly path: string) {
    super(`share build: ${path}`);
  }
}
const zero = (x: number) => (Object.is(x, -0) ? 0 : x);
/** 소수 둘째 자리. 유한수가 아니면 만들기 실패 */
export function r2(x: number, path: string): number {
  if (!Number.isFinite(x)) throw new BuildError(path);
  return zero(Math.round(x * 100) / 100);
}
/** 소수 둘째 자리. 유한수가 아니면 null */
export function r2n(x: number | null | undefined): number | null {
  return x == null || !Number.isFinite(x) ? null : zero(Math.round(x * 100) / 100);
}
/** 유효숫자 4자리(조건 계산값) */
export function sig4(x: number): number {
  return zero(Number(x.toPrecision(4)));
}

export function toAxis(dates: readonly string[]): ShareAxis {
  return { start: dates[0], offsets: dates.map((d) => dayOffset(dates[0], d)) };
}
export function fromAxis(a: ShareAxis): string[] {
  return a.offsets.map((o) => axisDate(a.start, o));
}

// ── 솎기(설계 3.3) ────────────────────────────────────

export const THIN_STEPS = [500, 250, 120] as const;
/** 축이 AXIS_MAX(3,700)를 넘으면 크기와 상관없이 먼저 이 점 수로 솎는다 */
export const AXIS_PRETHIN = 3000;

/** n개 중 남길 위치(오름차순). m은 고르게 남길 점 수, keep은 반드시 남길 위치 */
export function thinIndices(n: number, m: number, keep: readonly number[]): number[] {
  if (n <= m) return [...Array(n).keys()];
  const s = new Set<number>([0, n - 1]);
  for (const k of keep) if (Number.isInteger(k) && k >= 0 && k < n) s.add(k);
  for (let i = 0; i < m; i++) s.add(Math.round((i * (n - 1)) / (m - 1)));
  return [...s].sort((a, b) => a - b);
}

/** [최고 위치, 최저 위치]. null은 건너뛰고 같은 값이면 처음 위치. 값이 없으면 [] */
export function extremes(values: readonly (number | null)[]): number[] {
  let hi = -1;
  let lo = -1;
  values.forEach((v, i) => {
    if (v === null) return;
    if (hi < 0 || v > (values[hi] as number)) hi = i;
    if (lo < 0 || v < (values[lo] as number)) lo = i;
  });
  return hi < 0 ? [] : [hi, lo];
}

/** 초기 자금 대비 % 곡선에서 비율 최대 낙폭의 [고점 위치, 바닥 위치]. 초기 고점은 0%, 위치는 0. */
export function drawdownPoints(values: readonly number[]): number[] {
  let peak = 0;
  let peakAt = 0;
  let best: [number, number] = [0, 0];
  let worst = 0;
  values.forEach((v, i) => {
    if (v > peak) peakAt = i;
    peak = Math.max(peak, v);
    const dd = (1 + v / 100) / (1 + peak / 100) - 1;
    if (dd < worst) {
      worst = dd;
      best = [peakAt, i];
    }
  });
  return best;
}

const pick = <T>(arr: readonly T[], at: readonly number[]): T[] => at.map((i) => arr[i]);

/** 만든 쪽 마지막 단계: JSON 왕복 뒤 create 검사(설계 3.1). 서버가 거절할 것을 미리 막는다 */
export function finishBuild<S extends ShareSnapshot>(s: S, reduced: ShareReduction[], now: number): ShareBuild<S> {
  const copy = JSON.parse(JSON.stringify(s)) as S;
  const c = checkShareSnapshot(copy, s.kind, now, 'create');
  if (c.ok) return { ok: true, snapshot: copy, reduced };
  if (c.code === 'too-large') return { ok: false, code: 'too-large', bytes: jsonBytes(copy) };
  return c.path === undefined ? { ok: false, code: 'invalid' } : { ok: false, code: 'invalid', path: c.path };
}

// ── 시뮬레이션 결과(설계 2.4, 3.4) ──────────────────────

function roundSummary(s: SimResult['summary']): SimResult['summary'] {
  const p = (k: keyof SimResult['summary']) => `result.summary.${k}`;
  return {
    totalReturnPct: r2(s.totalReturnPct, p('totalReturnPct')),
    cagrPct: r2(s.cagrPct, p('cagrPct')),
    mddPct: r2(s.mddPct, p('mddPct')),
    winRatePct: r2n(s.winRatePct),
    wins: s.wins,
    losses: s.losses,
    avgWinPct: r2n(s.avgWinPct),
    avgLossPct: r2n(s.avgLossPct),
    roundTrips: s.roundTrips,
    openPositions: s.openPositions,
    avgHoldDays: r2n(s.avgHoldDays),
    avgCashPct: r2(s.avgCashPct, p('avgCashPct')),
    skippedSignals: s.skippedSignals,
    vsHoldPp: r2(s.vsHoldPp, p('vsHoldPp')),
    vsIndexPp: r2n(s.vsIndexPp),
    vsBenchmarkPp: r2n(s.vsBenchmarkPp),
  };
}

export function simResultSnapshot(done: DoneState, opts: { hideCapital: boolean; now?: number }): ShareBuild<SimResultSnapshot> {
  const now = opts.now ?? Date.now();
  try {
    const { result, meta } = done;
    const initial = meta.strategy.capital.initial;
    // 규칙은 실행한 작업본, 종목은 실행에 쓴 종목(설계 1.5-2)
    const rules = strategySnapshot({ ...meta.strategy, universe: { kind: 'symbols', symbols: meta.symbols } }, { groups: [] }, opts);
    const symbols = [...meta.symbols];
    const at = new Map(symbols.map((s, i) => [s, i]));
    const idx = (s: string, path: string) => {
      const i = at.get(s);
      if (i === undefined) throw new BuildError(path);
      return i;
    };
    const dates = result.equity.map((e) => e.date);
    if (dates.length === 0) throw new BuildError('result.axis');
    const n = dates.length;
    const day = (d: string) => dayOffset(dates[0], d);
    const pct = (v: number, path: string) => r2((v / initial - 1) * 100, path);
    const pctN = (v: number | null) => (v === null ? null : r2n((v / initial - 1) * 100));

    const full = {
      strategy: result.equity.map((e, i) => pct(e.strategy, `result.curves.strategy[${i}]`)),
      hold: result.equity.map((e, i) => pct(e.hold, `result.curves.hold[${i}]`)),
      index: result.equity.some((e) => e.index !== null) ? result.equity.map((e) => pctN(e.index)) : null,
      benchmark: result.equity.some((e) => e.benchmark !== null) ? result.equity.map((e) => pctN(e.benchmark)) : null,
    };
    const trades: SharedTrade[] = result.trades.map((t, i) => {
      const p = `result.trades[${i}]`;
      const sell = (SELL_KINDS as readonly string[]).includes(t.kind);
      return [day(t.date), idx(t.symbol, p), t.kind, t.stage ?? null, Math.round(t.price), opts.hideCapital ? null : t.qty, t.reason, sell ? r2(t.pnlPct ?? Number.NaN, `${p}.pnlPct`) : null];
    });
    const perSymbol: SharedPerSymbol[] = result.perSymbol.map((ps, i) => {
      const p = `result.perSymbol[${i}]`;
      return [idx(ps.symbol, p), opts.hideCapital ? null : Math.round(ps.pnl), r2((ps.pnl / initial) * 100, p), ps.roundTrips, ps.firstDate === null ? null : day(ps.firstDate)];
    });
    const counts = SKIP_REASONS.map((reason) => [reason, result.skipped.filter((k) => k.reason === reason).length] as [(typeof SKIP_REASONS)[number], number]).filter(([, c]) => c > 0);
    const rows = result.skipped.map((k, i) => [day(k.date), idx(k.symbol, `result.skipped.rows[${i}]`), SKIP_REASONS.indexOf(k.reason)] as [number, number, number]);
    const summary = roundSummary(result.summary);
    const benchmarks = {
      holdReturnPct: r2(result.benchmarks.holdReturnPct, 'result.benchmarks.holdReturnPct'),
      indexReturnPct: r2n(result.benchmarks.indexReturnPct),
      benchmarkReturnPct: r2n(result.benchmarks.benchmarkReturnPct),
    };
    const nearMiss = result.nearMiss && { maxDropPct: r2(result.nearMiss.maxDropPct, 'result.nearMiss.maxDropPct'), declineDays: result.nearMiss.declineDays };
    const keep = [
      ...extremes(full.strategy),
      ...extremes(full.hold),
      ...(full.index ? extremes(full.index) : []),
      ...(full.benchmark ? extremes(full.benchmark) : []),
      ...drawdownPoints(full.strategy),
    ];

    const make = (m: number | null, withRows: boolean): SimResultSnapshot => {
      const pos = m === null ? [...Array(n).keys()] : thinIndices(n, m, keep);
      return {
        kind: 'simResult',
        v: 1,
        title: rules.title,
        strategy: rules.strategy,
        capitalHidden: opts.hideCapital,
        run: { from: dates[0], to: dates[n - 1], source: meta.venueLabel, demo: meta.demo, fetchedAt: meta.fetchedAt },
        result: {
          axis: toAxis(pick(dates, pos)),
          sampled: pos.length === n ? null : { from: n },
          curves: {
            strategy: pick(full.strategy, pos),
            hold: pick(full.hold, pos),
            index: full.index && pick(full.index, pos),
            benchmark: full.benchmark && pick(full.benchmark, pos),
          },
          summary,
          benchmarks,
          indexFailed: meta.indexFailed,
          benchmarkFailed: meta.benchmarkFailed,
          symbols,
          trades,
          perSymbol,
          skipped: { counts, rows: withRows ? rows : null },
          nearMiss,
          failed: meta.failed.map((f) => ({ symbol: f.symbol, reason: f.reason })),
        },
      };
    };

    // 줄이는 순서(설계 3.4): 그대로 → 건너뜀은 개수만 → 원래 축에서 500 → 250 → 120점. 그래도 넘으면 거절(거래는 빼지 않는다)
    const first = n > AXIS_MAX ? AXIS_PRETHIN : null;
    const steps: [m: number | null, rows: boolean][] = [[first, true]];
    if (rows.length > 0) steps.push([first, false]);
    for (const m of THIN_STEPS) if (m < (first ?? n)) steps.push([m, rows.length === 0]);
    let bytes = 0;
    for (const [m, withRows] of steps) {
      const s = make(m, withRows);
      bytes = jsonBytes(s);
      if (bytes > SHARE_MAX_BYTES) continue;
      const reduced: ShareReduction[] = [];
      if (s.result.skipped.rows === null) reduced.push('skipped-counts');
      if (s.result.sampled) reduced.push('thinned');
      return finishBuild(s, reduced, now);
    }
    return { ok: false, code: 'too-large', bytes };
  } catch (e) {
    if (e instanceof BuildError) return { ok: false, code: 'invalid', path: e.path };
    throw e;
  }
}

/** 받은 시뮬레이션 결과를 결과 화면(ResultView)이 받는 모양으로 되돌린다. 곡선은 initial × (1 + pct / 100), 원시 일봉은 없다 */
export function expandSimResult(s: SimResultSnapshot, names?: SymbolNames): DoneState {
  const r = s.result;
  const initial = s.strategy.capital.initial;
  const back = (p: number) => initial * (1 + p / 100);
  const backN = (p: number | null) => (p === null ? null : back(p));
  const date = (d: number) => axisDate(r.axis.start, d);
  const nameMap: Record<string, string> = {};
  const bench = s.strategy.benchmarks.symbol;
  for (const c of [...r.symbols, ...(bench ? [bench] : [])]) nameMap[c] = names?.get(c) ?? c;
  const result: SimResult = {
    equity: fromAxis(r.axis).map((d, i) => ({
      date: d,
      strategy: back(r.curves.strategy[i]),
      hold: back(r.curves.hold[i]),
      index: r.curves.index ? backN(r.curves.index[i]) : null,
      benchmark: r.curves.benchmark ? backN(r.curves.benchmark[i]) : null,
      cash: 0, // 화면에 쓰지 않는다(요약의 avgCashPct는 남는다)
    })),
    summary: { ...r.summary },
    benchmarks: { ...r.benchmarks },
    trades: r.trades.map(([d, sym, kind, stage, price, qty, reason, pnlPct]) => ({
      date: date(d),
      symbol: r.symbols[sym],
      kind,
      ...(stage !== null && { stage }),
      price,
      qty: qty ?? 0,
      fee: 0,
      tax: 0,
      reason,
      ...(pnlPct !== null && { pnlPct }),
    })),
    skipped: (r.skipped.rows ?? []).map(([d, sym, reason]) => ({ date: date(d), symbol: r.symbols[sym], reason: SKIP_REASONS[reason] })),
    perSymbol: r.perSymbol.map(([sym, pnl, , roundTrips, firstDay]) => ({
      symbol: r.symbols[sym],
      name: nameMap[r.symbols[sym]],
      pnl: pnl ?? 0,
      roundTrips,
      firstDate: firstDay === null ? null : date(firstDay),
    })),
    nearMiss: r.nearMiss ? { ...r.nearMiss } : null,
  };
  return {
    kind: 'done',
    result,
    meta: {
      venueLabel: s.run.source,
      fetchedAt: s.run.fetchedAt,
      from: s.run.from,
      to: s.run.to,
      demo: s.run.demo,
      failed: r.failed.map((f) => ({ symbol: f.symbol, name: nameMap[f.symbol], reason: f.reason })),
      indexFailed: r.indexFailed,
      benchmarkFailed: r.benchmarkFailed,
      candles: {},
      names: nameMap,
      strategy: s.strategy,
      symbols: [...r.symbols],
    },
  };
}

/** 종목별 자금 대비 %(받은 화면의 종목별 탭이 자금 숨김일 때 쓴다) */
export function perSymbolPct(s: SimResultSnapshot): Record<string, number> {
  return Object.fromEntries(s.result.perSymbol.map(([sym, , pct]) => [s.result.symbols[sym], pct]));
}
