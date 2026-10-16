// 선정 기준 검증 묶음(스펙 6장): ① 동일 비중 보유, ② 매매 규칙, 비교 기준, 시장별 보기. Worker에서 돈다.
import type { Candle } from '../data/metrics';
import type { MarketDataFile } from '../marketData/format';
import { indexCurve, singleCurve } from '../sim/benchmarks';
import { simulate } from '../sim/simulate';
import type { SimInput, Skip, Strategy } from '../sim/types';
import { addDays, kstEpoch } from '../time/kst';
import { holdSelection, type HoldSegment } from './holdSelection';
import { beatCount, curveStats } from './metrics';
import { MissingStrategyError, precompute, rebalanceDates, resolveReboundEntry, tradingAxis, type Precomputed } from './precompute';
import { selectAt, type Selection } from './select';
import type { Market, SelectionCriteria } from './types';
import { strategyRuleIssues } from './validate';

export type CurveStats = ReturnType<typeof curveStats>;
export type CurvePoint = { date: string; value: number };
export type ValidationNote = 'survivorship' | 'snapshot' | 'dividend' | 'fewSegments' | 'warmup' | 'allEmpty' | 'sparseAxis';
export type MissingReason = '받지 못했어요' | '기간 일부만 받았어요';
export type ByMarketKey = 'KOSPI' | 'KOSDAQ' | 'ETF';

export interface ValidationResult {
  /** 검증 거래일: 첫 재선정일 ~ 기간 끝. 모든 곡선이 이 축에 맞춰져 있다 */
  axis: string[];
  rebalances: Selection[];
  /** 마지막 거래일 다음 날로 본 선별(마지막 날 봉까지 쓴다) */
  today: Selection;
  hold: { equity: CurvePoint[]; segments: HoldSegment[]; stats: CurveStats; beat: { beat: number; total: number } | null };
  /** ② 요약. 건너뜀 전체 목록·nearMiss는 선정 기간 밖 건너뜀이 대부분이라 싣지 않는다 */
  trading: { curve: CurvePoint[]; stats: CurveStats; trades: number; skipCounts: Partial<Record<Skip['reason'], number>> } | null;
  indices: { id: Market; curve: CurvePoint[] | null; reason?: MissingReason; stats: CurveStats | null }[];
  benchmarks: { symbol: string; name: string; curve: CurvePoint[] | null; reason?: MissingReason; stats: CurveStats | null }[];
  byMarket: { key: ByMarketKey; inPool: boolean; stats: CurveStats; avgPicked: number }[];
  notes: ValidationNote[];
}

export type ValidationErrorCode = 'no-rebalance' | 'invalid-number' | 'missing-strategy' | 'invalid-strategy';

export const ERROR_TEXT: Record<ValidationErrorCode, string> = {
  'no-rebalance': '기간 안에 재선정일이 없어요',
  'invalid-number': '계산 중 잘못된 숫자가 나왔어요',
  'missing-strategy': '매매 규칙 전략이 지워졌어요',
  'invalid-strategy': '매매 규칙 전략에 고칠 곳이 있어요',
};

export class ValidationError extends Error {
  constructor(readonly code: ValidationErrorCode) {
    super(ERROR_TEXT[code]);
    this.name = 'ValidationError';
  }
}

/** 미리 계산 함수. Worker는 같은 기준 값이면 결과를 재사용하는 함수를 넣는다 */
export type PrecomputeFn = typeof precompute;

export interface ValidationInput {
  data: MarketDataFile;
  criteria: SelectionCriteria;
  strategies: Strategy[];
}

/** 시장별 보기의 후보 범위(스펙 6.5) */
const MARKET_POOLS: { key: ByMarketKey; pool: Pick<SelectionCriteria['pool'], 'markets' | 'types'> }[] = [
  { key: 'KOSPI', pool: { markets: ['KOSPI'], types: ['STOCK'] } },
  { key: 'KOSDAQ', pool: { markets: ['KOSDAQ'], types: ['STOCK'] } },
  { key: 'ETF', pool: { markets: ['KOSPI', 'KOSDAQ'], types: ['ETF'] } },
];

const FEW_SEGMENTS = 12;
const SIM_NON_FINITE = '평가액 계산 실패';
const WARMUP_DAYS = 250;

const ymd = (d: string): string => d.replaceAll('-', '');
const iso = (d: string): string => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
const toCandles = (d: string[], o: number[], h: number[], l: number[], c: number[], v: number[]): Candle[] =>
  d.map((x, i) => ({ t: kstEpoch(iso(x), '00:00:00'), o: o[i], h: h[i], l: l[i], c: c[i], v: v[i] }));
const points = (days: string[], values: number[]): CurvePoint[] => days.map((date, i) => ({ date, value: values[i] }));

/** 첫날·마지막 날 봉이 있어야 비교 곡선으로 쓴다(시뮬레이션과 같은 규칙) */
const covers = (d: string[], days: string[]): boolean => d.includes(ymd(days[0])) && d.includes(ymd(days[days.length - 1]));

function lowerBound(a: string[], x: string): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** 편집 화면 미리 보기: 마지막 거래일 다음 날의 선별 */
export function preview(
  data: MarketDataFile,
  criteria: SelectionCriteria,
  strategies: Strategy[],
  opts: { precompute?: PrecomputeFn } = {},
): Selection {
  const pre = (opts.precompute ?? precompute)(data, criteria, resolveReboundEntry(criteria, strategies));
  return todaySelection(pre, criteria);
}

function todaySelection(pre: Precomputed, criteria: SelectionCriteria): Selection {
  return selectAt(addDays(pre.axis[pre.axis.length - 1], 1), pre, criteria);
}

// 전 거래일 p에 봉이 있는 후보가, 그날을 기간 안에 둔 후보의 절반 미만인가(축이 날짜 합집합이라 일부만 거래한 날이 p가 될 수 있다)
function sparseAt(pre: Precomputed, criteria: SelectionCriteria, p: string): boolean {
  let covered = 0;
  let withBar = 0;
  for (const st of pre.stocks) {
    if (!criteria.pool.markets.includes(st.m) || !criteria.pool.types.includes(st.t as 'STOCK' | 'ETF')) continue;
    if (!st.d.length || st.d[0] > p || st.d[st.d.length - 1] < p) continue;
    covered++;
    if (st.d[lowerBound(st.d, p)] === p) withBar++;
  }
  return covered > 0 && withBar * 2 < covered;
}

export function runValidation(
  input: ValidationInput,
  onProgress?: (done: number, total: number) => void,
  isCancelled?: () => boolean,
  opts: { precompute?: PrecomputeFn } = {},
): ValidationResult | { cancelled: true } {
  const { data, criteria, strategies } = input;
  const capital = criteria.capital;
  const feePct = criteria.costs.feePct;
  const fullAxis = tradingAxis(data);
  const dates = rebalanceDates(fullAxis, criteria.period, criteria.rebalance);
  if (dates.length === 0) throw new ValidationError('no-rebalance');

  let tradingStrategy: Strategy | null = null;
  if (criteria.trading.strategyId !== null) {
    tradingStrategy = strategies.find((s) => s.id === criteria.trading.strategyId) ?? null;
    if (!tradingStrategy) throw new ValidationError('missing-strategy');
  }
  // 편집 화면을 거치지 않은 실행도 막는다(전략 편집 화면이 막는 규칙 오류)
  if (strategyRuleIssues(criteria, strategies).length > 0) throw new ValidationError('invalid-strategy');

  // 미리 계산과 모든 selectAt은 같은 해석된 entry를 쓴다
  const pre = (opts.precompute ?? precompute)(data, criteria, resolveReboundEntry(criteria, strategies));
  const days = fullAxis.filter((d) => d >= dates[0] && d <= criteria.period.to);

  const rebalances: Selection[] = [];
  const byPool: Selection[][] = MARKET_POOLS.map(() => []);
  let sparse = false;
  for (let i = 0; i < dates.length; i++) {
    if (isCancelled?.()) return { cancelled: true };
    const d = dates[i];
    rebalances.push(selectAt(d, pre, criteria));
    MARKET_POOLS.forEach((m, k) => byPool[k].push(selectAt(d, pre, criteria, m.pool)));
    const ai = fullAxis.indexOf(d);
    if (ai > 0 && sparseAt(pre, criteria, fullAxis[ai - 1])) sparse = true;
    onProgress?.(i + 1, dates.length);
  }
  if (isCancelled?.()) return { cancelled: true };

  // ①은 결제일(T+2)을 전체 축(fullAxis)으로 정하고, ②(simulate)는 기간 축(days)으로 정한다.
  // 기간 마지막 2거래일 안의 매도만 결제일이 축 밖이라 어림으로 정해져 두 방식의 세율이 다를 수 있다(세율이 바뀌는 해 경계에서만)
  const hold = (selections: Selection[]) =>
    holdSelection({ axis: fullAxis, selections, data, capital, feePct, periodEnd: criteria.period.to });
  const statsOf = (curve: CurvePoint[]) =>
    curveStats(
      curve.map((p) => p.value),
      curve.map((p) => p.date),
      capital,
    );

  // 지수: 수집 파일의 시가·종가로 봉을 만든다(스펙 6.4)
  const indexCandles = (id: Market): Candle[] | null => {
    const x = data.indices.find((i) => i.id === id);
    if (!x) return null;
    const hi = x.o.map((o, i) => Math.max(o, x.c[i]));
    const lo = x.o.map((o, i) => Math.min(o, x.c[i]));
    return toCandles(x.d, x.o, hi, lo, x.c, x.d.map(() => 0));
  };
  const indices: ValidationResult['indices'] = criteria.benchmarks.indices.map((id) => {
    const x = data.indices.find((i) => i.id === id);
    if (!x) return { id, curve: null, reason: '받지 못했어요', stats: null };
    const values = covers(x.d, days) ? indexCurve(days, indexCandles(id)!, capital) : null;
    if (!values) return { id, curve: null, reason: '기간 일부만 받았어요', stats: null };
    const curve = points(days, values);
    return { id, curve, stats: statsOf(curve) };
  });

  const benchmarks: ValidationResult['benchmarks'] = criteria.benchmarks.symbols.map((symbol) => {
    const st = data.stocks.find((x) => x.s === symbol);
    if (!st) return { symbol, name: symbol, curve: null, reason: '받지 못했어요', stats: null };
    if (!covers(st.d, days)) return { symbol, name: st.n, curve: null, reason: '기간 일부만 받았어요', stats: null };
    const curve = points(days, singleCurve(days, toCandles(st.d, st.o, st.h, st.l, st.c, st.v), capital, feePct));
    return { symbol, name: st.n, curve, stats: statsOf(curve) };
  });

  // ①: "지수보다 나은 구간"은 첫 비교 지수 기준. 곡선이 없으면 셀 수 없다
  const h = hold(rebalances);
  const firstIndex = indices[0]?.curve ?? null;
  const holdResult: ValidationResult['hold'] = {
    equity: h.equity,
    segments: h.segments,
    stats: statsOf(h.equity),
    beat: firstIndex ? beatCount(h.segments, h.equity, firstIndex.map((p) => p.value), days, capital) : null,
  };

  const byMarket: ValidationResult['byMarket'] = MARKET_POOLS.map((m, k) => {
    const sels = byPool[k];
    const inPool =
      m.key === 'ETF'
        ? criteria.pool.types.includes('ETF') && criteria.pool.markets.includes('KOSPI') && criteria.pool.markets.includes('KOSDAQ')
        : criteria.pool.markets.includes(m.key) && criteria.pool.types.includes('STOCK');
    return {
      key: m.key,
      inPool,
      stats: statsOf(hold(sels).equity),
      avgPicked: sels.reduce((a, s) => a + s.picked.length, 0) / sels.length,
    };
  });

  let trading: ValidationResult['trading'] = null;
  if (tradingStrategy) {
    if (isCancelled?.()) return { cancelled: true };
    trading = runTrading(tradingStrategy, criteria, data, days, dates, rebalances, indexCandles);
  }

  const notes: ValidationNote[] = ['survivorship', 'snapshot', 'dividend'];
  if (dates.length < FEW_SEGMENTS) notes.push('fewSegments');
  if (lowerBound(fullAxis, dates[0]) < WARMUP_DAYS) notes.push('warmup');
  if (rebalances.every((s) => s.passed === 0)) notes.push('allEmpty');
  if (sparse) notes.push('sparseAxis');

  const result: ValidationResult = {
    axis: days,
    rebalances,
    today: todaySelection(pre, criteria),
    hold: holdResult,
    trading,
    indices,
    benchmarks,
    byMarket,
    notes,
  };
  assertFinite(result);
  return result;
}

// ②: 참조 전략에서 매수·매도 규칙과 1회 매수 비율만 쓰고 나머지는 기준 값으로 바꾼다(스펙 6.3)
function runTrading(
  ref: Strategy,
  criteria: SelectionCriteria,
  data: MarketDataFile,
  days: string[],
  dates: string[],
  rebalances: Selection[],
  indexCandles: (id: Market) => Candle[] | null,
): NonNullable<ValidationResult['trading']> {
  const firstIndex = criteria.benchmarks.indices[0] ?? null;
  const strategy: Strategy = {
    ...ref,
    period: { ...criteria.period },
    capital: { initial: criteria.capital, perBuyPct: ref.capital.perBuyPct },
    costs: { feePct: criteria.costs.feePct },
    benchmarks: { index: firstIndex ?? 'KOSPI', symbol: null },
  };

  // 창: 뽑힌 구간 [d, 다음 재선정일 전 거래일], 마지막 구간은 기간 끝까지
  const windows = new Map<string, { from: string; to: string }[]>();
  rebalances.forEach((sel, i) => {
    const to = i + 1 < dates.length ? days[days.indexOf(dates[i + 1]) - 1] : days[days.length - 1];
    for (const p of sel.picked) {
      const w = windows.get(p.symbol);
      if (w) w.push({ from: dates[i], to });
      else windows.set(p.symbol, [{ from: dates[i], to }]);
    }
  });
  const stocks: SimInput['stocks'] = [];
  for (const [symbol, buyWindows] of windows) {
    const st = data.stocks.find((x) => x.s === symbol)!;
    stocks.push({
      symbol,
      name: st.n,
      market: st.m,
      isEtf: st.t === 'ETF',
      candles: toCandles(st.d, st.o, st.h, st.l, st.c, st.v),
      buyWindows,
    });
  }
  const candles = firstIndex ? indexCandles(firstIndex) : null;
  let res: ReturnType<typeof simulate>;
  try {
    res = simulate({
      strategy,
      days,
      stocks,
      index: firstIndex && candles ? { id: firstIndex, candles } : null,
      benchmarkStock: null,
    });
  } catch (e) {
    // 엔진은 평가액이 NaN·Infinity면 이 문구로 던진다(simulate.ts)
    if (e instanceof Error && e.message.startsWith(SIM_NON_FINITE)) throw new ValidationError('invalid-number');
    throw e;
  }

  const curve = res.equity.map((e) => ({ date: e.date, value: e.strategy }));
  const skipCounts: Partial<Record<Skip['reason'], number>> = {};
  for (const s of res.skipped) skipCounts[s.reason] = (skipCounts[s.reason] ?? 0) + 1;
  return {
    curve,
    stats: curveStats(
      curve.map((p) => p.value),
      days,
      criteria.capital,
    ),
    trades: res.trades.length,
    skipCounts,
  };
}

function assertFinite(r: ValidationResult): void {
  const curves: (CurvePoint[] | null)[] = [r.hold.equity, r.trading?.curve ?? null, ...r.indices.map((x) => x.curve), ...r.benchmarks.map((x) => x.curve)];
  const stats: (CurveStats | null)[] = [r.hold.stats, r.trading?.stats ?? null, ...r.indices.map((x) => x.stats), ...r.benchmarks.map((x) => x.stats), ...r.byMarket.map((x) => x.stats)];
  const bad =
    curves.some((c) => c?.some((p) => !Number.isFinite(p.value))) ||
    stats.some((s) => s && Object.values(s).some((v) => !Number.isFinite(v)));
  if (bad) throw new ValidationError('invalid-number');
}

/** Worker가 돌려줄 오류 코드 */
export type WorkerErrorCode = ValidationErrorCode | 'no-data' | 'crash';

export function errorCode(e: unknown): WorkerErrorCode {
  if (e instanceof ValidationError) return e.code;
  if (e instanceof MissingStrategyError) return 'missing-strategy';
  return 'crash';
}

/** Worker 메시지(스펙 7.4). data가 없으면 Worker가 IndexedDB에서 직접 읽는다 */
export type WorkerInput = Omit<ValidationInput, 'data'> & { data?: MarketDataFile };
export type WorkerRequest = { type: 'run'; input: WorkerInput } | { type: 'preview'; id: number; input: WorkerInput };
export type WorkerResponse =
  | { type: 'progress'; done: number; total: number }
  | { type: 'result'; result: ValidationResult }
  | { type: 'error'; code: WorkerErrorCode; id?: number }
  | { type: 'preview'; id: number; selection: Selection };
