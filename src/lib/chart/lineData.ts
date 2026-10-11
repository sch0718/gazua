import type { Point } from '../data/metrics';
import type { TradeInterval } from '../market/tradable';
import { kstEpoch } from '../time/kst';

/** 값이 없으면 LWC whitespace(축에 자리만 차지), 있으면 선의 한 점. time은 toChartTime 값(초). */
export type LineDatum = { time: number } | { time: number; value: number };
export type ColoredLineDatum = LineDatum & { color?: string };

export type SeriesSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** 차트·세션 레인에 넘기는 종목 한 개. slot이 색(--s{slot})을 정한다. */
export interface ChartSeriesInput {
  id: string;
  slot: SeriesSlot;
  label: string;
  points: Point[];
  intervals: TradeInterval[];
  hidden: boolean;
}

export interface LineDataOptions {
  /** 첫 값이 나오기 전 점선이 머무를 값(등락률이면 기준선 0). null이면 첫 값 전은 비워 둔다. 기본 0 */
  startValue?: number | null;
  /** 1일 차트: 이 시각(epoch ms)까지는 마지막 값을 이어 그린다. 기본은 이 종목의 마지막 실제 봉 */
  until?: number;
}

const KST_OFFSET_MS = 9 * 3600_000;
const MINUTE_MS = 60_000;
const GRID_START = '08:00:00';
const GRID_MINUTES = 12 * 60; // 08:00..19:59

/** epoch ms → LWC UTCTimestamp(초). UTC로 읽으면 KST 벽시계가 보이도록 +9h 민다. */
export function toChartTime(t: number): number {
  return Math.floor((t + KST_OFFSET_MS) / 1000);
}

/** toChartTime의 역변환. */
export function fromChartTime(time: number): number {
  return time * 1000 - KST_OFFSET_MS;
}

/** 1일 차트 X축: KST 08:00..19:59 매 분의 epoch ms (720개). */
export function minuteGrid(day: string): number[] {
  const start = kstEpoch(day, GRID_START);
  return Array.from({ length: GRID_MINUTES }, (_, i) => start + i * MINUTE_MS);
}

export const hasValue = (d: LineDatum): d is { time: number; value: number } => 'value' in d;

const realPoints = (points: Point[]) =>
  points.filter((p): p is { t: number; v: number } => p.v !== null).sort((a, b) => a.t - b.t);

/**
 * 거래 가능 구간은 solid, 거래 불가·단일가 구간은 직전 값으로 dotted.
 * - grid가 있으면(1일 차트) grid의 매 분마다 한 항목. 마지막 실제 봉(또는 until) 이후는 둘 다 whitespace.
 *   거래 가능 구간인데 그 분에 봉이 없으면 직전 값을 solid로 잇는다(체결이 없었을 뿐 거래는 가능).
 * - grid가 없으면(일봉) 점마다 한 항목. 값이 null인 날은 dotted로 직전 값을 잇는다.
 * 점선이 실선 끝에 닿도록 공백 바로 앞·뒤 실선 점에도 dotted 값을 둔다.
 * 실제 값이 하나도 없으면 전부 whitespace.
 */
export function buildLineData(
  points: Point[],
  intervals: TradeInterval[],
  grid?: number[],
  options: LineDataOptions = {},
): { solid: LineDatum[]; dotted: LineDatum[] } {
  const startValue = options.startValue === undefined ? 0 : options.startValue;
  const real = realPoints(points);
  const result = grid
    ? intraday(real, intervals, grid, startValue, options.until)
    : daily(points, startValue, real.length > 0);
  return { solid: result.solid, dotted: anchorDotted(result.solid, result.dotted) };
}

function intraday(
  real: { t: number; v: number }[],
  intervals: TradeInterval[],
  grid: number[],
  startValue: number | null,
  until: number | undefined,
) {
  const solid: LineDatum[] = [];
  const dotted: LineDatum[] = [];
  const continuous = intervals.filter((iv) => iv.kind === 'continuous');
  const lastReal = real.at(-1)?.t;
  const end = lastReal === undefined ? undefined : Math.max(lastReal, until ?? lastReal);

  let held: number | null = null;
  let next = 0;
  for (const g of grid) {
    const time = toChartTime(g);
    if (end === undefined || g > end) {
      solid.push({ time });
      dotted.push({ time });
      continue;
    }
    while (next < real.length && real[next].t < g + MINUTE_MS) held = real[next++].v;
    const tradable = continuous.some((iv) => iv.start <= g && g < iv.end);
    if (tradable && held !== null) {
      solid.push({ time, value: held });
      dotted.push({ time });
    } else {
      solid.push({ time });
      dotted.push(heldDatum(time, held, startValue));
    }
  }
  return { solid, dotted };
}

function heldDatum(time: number, held: number | null, startValue: number | null): LineDatum {
  const value = held ?? startValue;
  return value === null ? { time } : { time, value };
}

function daily(points: Point[], startValue: number | null, anyReal: boolean) {
  const solid: LineDatum[] = [];
  const dotted: LineDatum[] = [];
  let held: number | null = null;
  for (const p of [...points].sort((a, b) => a.t - b.t)) {
    const time = toChartTime(p.t);
    if (!anyReal) {
      solid.push({ time });
      dotted.push({ time });
    } else if (p.v !== null) {
      held = p.v;
      solid.push({ time, value: p.v });
      dotted.push({ time });
    } else {
      solid.push({ time });
      dotted.push(heldDatum(time, held, startValue));
    }
  }
  return { solid, dotted };
}

/** 점선 구간의 양 끝을 이웃 실선 점까지 늘린다(앞: 실선 값, 뒤: 머물던 값). */
function anchorDotted(solid: LineDatum[], dotted: LineDatum[]): LineDatum[] {
  const isGap = dotted.map(hasValue);
  return dotted.map((d, i) => {
    const s = solid[i];
    if (isGap[i] || !hasValue(s)) return d;
    if (isGap[i + 1]) return { time: d.time, value: s.value };
    const prev = dotted[i - 1];
    if (isGap[i - 1] && hasValue(prev)) return { time: d.time, value: prev.value };
    return d;
  });
}

/**
 * LWC 선 시리즈는 whitespace를 건너 이웃 값끼리 잇는다. 공백 바로 앞 값에 breakColor를 주어
 * 그 점에서 다음 값까지의 선분을 감춘다(선분 색은 왼쪽 점 색을 따른다). 마지막 값은 건드리지 않는다.
 */
export function withLineBreaks(data: LineDatum[], breakColor: string): ColoredLineDatum[] {
  const out: ColoredLineDatum[] = data.map((d) => ({ ...d }));
  let valueLater = false;
  for (let i = data.length - 1; i >= 0; i--) {
    const d = data[i];
    if (!hasValue(d)) continue;
    const next = data[i + 1];
    if (valueLater && next !== undefined && !hasValue(next)) out[i] = { ...d, color: breakColor };
    valueLater = true;
  }
  return out;
}

/** 일봉: 장이 열렸는데 점이 없는 날(dayTimes, epoch ms)을 null 점으로 채운다. */
export function fillMissingDays(points: Point[], dayTimes: number[]): Point[] {
  const have = new Set(points.map((p) => p.t));
  const filled = [...points, ...dayTimes.filter((t) => !have.has(t)).map((t) => ({ t, v: null }))];
  return filled.sort((a, b) => a.t - b.t);
}

/**
 * 일봉: 장이 열린 날 값이 없는 종목(거래정지)을 날짜별로 모은다.
 * 어느 종목에도 값이 없는 마지막 날 이후(아직 봉이 없는 날)는 보지 않는다.
 */
export function haltDays(
  series: { label: string; points: Point[] }[],
  dayTimes: number[],
): { t: number; labels: string[] }[] {
  const valued = series.map((s) => new Set(realPoints(s.points).map((p) => p.t)));
  const cutoff = Math.max(-Infinity, ...series.flatMap((s) => realPoints(s.points).map((p) => p.t)));
  const result: { t: number; labels: string[] }[] = [];
  for (const t of [...dayTimes].sort((a, b) => a - b)) {
    if (t > cutoff) break;
    const labels = series.filter((_, i) => !valued[i].has(t)).map((s) => s.label);
    if (labels.length > 0) result.push({ t, labels });
  }
  return result;
}
