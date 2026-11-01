// 전략 v2 형식과 읽기 검증(전략 빌더 스펙 §3). PR①에서는 서버 검사(dto·snapshot)만 쓴다. 앱은 아직 v1(types.ts의 Strategy)을 쓴다.
// Worker 번들에 들어가니 DOM·저장소·import.meta.env를 쓰지 않는다.
// 종목·기간·자금·분할 매수·익절 단계·손절·비교·비용은 v1 검증(sanitizeStrategiesV1)을 그대로 빌려 규칙이 갈라지지 않게 한다.
import { MAX_STRATEGIES } from './defaults';
import type { StopBasis } from './types';
import type { StrategyV1 } from './strategyV1';
import { sanitizeEntry, sanitizeStrategiesV1 } from './strategyV1';

export type PatternEntry = StrategyV1['entry'];

export type Cond =
  | { kind: 'maPrice'; period: number; side: 'above' | 'below' }
  | { kind: 'maCross'; short: number; long: number; dir: 'golden' | 'dead' }
  | { kind: 'rsi'; period: number; level: number; op: 'above' | 'below' | 'crossUp' | 'crossDown' }
  | { kind: 'volume'; days: number; ratio: number }
  | { kind: 'change'; days: number; pct: number; op: 'above' | 'below' }
  | { kind: 'fromHigh'; days: number; pct: number }
  | { kind: 'newHigh'; days: number }
  | { kind: 'pattern'; entry: PatternEntry };

export interface CondGroup {
  conds: Cond[];
}

export type SizingMode = 'fixed' | 'equityPct' | 'cashPct' | 'equal';

export interface StrategyV2 {
  v: 2;
  id: string;
  name: string;
  updatedAt: number;
  universe: StrategyV1['universe'];
  period: StrategyV1['period'];
  capital: { initial: number };
  sizing: { mode: SizingMode; pct: number };
  rules: {
    buy: CondGroup[];
    sell: {
      takeProfit: { on: boolean; stages: { pct: number; sellPct: number }[]; afterFirstTake: 'keep' | 'breakeven' };
      stopLoss: { on: boolean; pct: number; basis: StopBasis };
      trailing: { on: boolean; pct: number };
      timeExit: { on: boolean; days: number };
      signal: { on: boolean; groups: CondGroup[] };
    };
  };
  scaleIn: StrategyV1['scaleIn'];
  benchmarks: StrategyV1['benchmarks'];
  costs: StrategyV1['costs'];
}

export const MAX_GROUPS = 4;
export const MAX_CONDS = 5;
const SIZING_MODES: readonly SizingMode[] = ['fixed', 'equityPct', 'cashPct', 'equal'];
const SIDES = ['above', 'below'] as const;
const DIRS = ['golden', 'dead'] as const;
const RSI_OPS = ['above', 'below', 'crossUp', 'crossDown'] as const;

type Row = Record<string, unknown>;
const isRecord = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 한 전략을 고치는 동안의 상태. 없는 필드는 조용히 기본값, 있는데 틀린 것만 repaired로 센다(v1과 같은 규칙). */
interface Ctx {
  repaired: boolean;
  now: number;
}

function pick<T>(ctx: Ctx, v: unknown, def: T, ok: (x: unknown) => boolean): T {
  if (ok(v)) return v as T;
  if (v !== undefined) ctx.repaired = true;
  return def;
}
const rec = (ctx: Ctx, v: unknown): Row => {
  if (isRecord(v)) return v;
  if (v !== undefined) ctx.repaired = true;
  return {};
};
const int = (ctx: Ctx, v: unknown, def: number, min: number, max: number) =>
  pick(ctx, v, def, (x) => Number.isInteger(x) && (x as number) >= min && (x as number) <= max);
const num = (ctx: Ctx, v: unknown, def: number, min: number, max: number) =>
  pick(ctx, v, def, (x) => typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max);
const bool = (ctx: Ctx, v: unknown, def: boolean) => pick(ctx, v, def, (x) => typeof x === 'boolean');
const oneOf = <T extends string>(ctx: Ctx, v: unknown, def: T, list: readonly T[]) => pick(ctx, v, def, (x) => list.includes(x as T));

const condFactories: { [P in Cond['kind']]: (now: number) => Extract<Cond, { kind: P }> } = {
  maPrice: () => ({ kind: 'maPrice', period: 20, side: 'above' }),
  maCross: () => ({ kind: 'maCross', short: 20, long: 60, dir: 'golden' }),
  rsi: () => ({ kind: 'rsi', period: 14, level: 30, op: 'crossUp' }),
  volume: () => ({ kind: 'volume', days: 20, ratio: 1.5 }),
  change: () => ({ kind: 'change', days: 5, pct: 10, op: 'above' }),
  fromHigh: () => ({ kind: 'fromHigh', days: 60, pct: 20 }),
  newHigh: () => ({ kind: 'newHigh', days: 60 }),
  pattern: (now) => ({ kind: 'pattern', entry: sanitizeEntry(undefined, now).entry }),
};

/** 종류별 기본 조건. 편집 화면(PR②)이 종류를 바꿀 때와 정리의 기본값이 같은 값을 쓴다. pattern의 entry는 기본 반등 패턴 */
export function defaultCond<K extends Cond['kind']>(kind: K, now = 0): Extract<Cond, { kind: K }> {
  return condFactories[kind](now);
}

/** 조건 하나. 모르는 kind, 매도 쪽 pattern은 null(버림, repaired). 기본값은 defaultCond */
function sanitizeCond(ctx: Ctx, raw: unknown, allowPattern: boolean): Cond | null {
  if (!isRecord(raw)) {
    ctx.repaired = true;
    return null;
  }
  switch (raw.kind) {
    case 'maPrice': {
      const d = defaultCond('maPrice');
      return { kind: 'maPrice', period: int(ctx, raw.period, d.period, 2, 250), side: oneOf(ctx, raw.side, d.side, SIDES) };
    }
    case 'maCross': {
      const d = defaultCond('maCross');
      return { kind: 'maCross', short: int(ctx, raw.short, d.short, 2, 250), long: int(ctx, raw.long, d.long, 2, 250), dir: oneOf(ctx, raw.dir, d.dir, DIRS) };
    }
    case 'rsi': {
      const d = defaultCond('rsi');
      return { kind: 'rsi', period: int(ctx, raw.period, d.period, 2, 50), level: num(ctx, raw.level, d.level, 1, 99), op: oneOf(ctx, raw.op, d.op, RSI_OPS) };
    }
    case 'volume': {
      const d = defaultCond('volume');
      return { kind: 'volume', days: int(ctx, raw.days, d.days, 2, 120), ratio: num(ctx, raw.ratio, d.ratio, 1, 20) };
    }
    case 'change': {
      const d = defaultCond('change');
      return { kind: 'change', days: int(ctx, raw.days, d.days, 1, 250), pct: num(ctx, raw.pct, d.pct, -90, 500), op: oneOf(ctx, raw.op, d.op, SIDES) };
    }
    case 'fromHigh': {
      const d = defaultCond('fromHigh');
      return { kind: 'fromHigh', days: int(ctx, raw.days, d.days, 2, 250), pct: num(ctx, raw.pct, d.pct, 1, 90) };
    }
    case 'newHigh':
      return { kind: 'newHigh', days: int(ctx, raw.days, defaultCond('newHigh').days, 2, 250) };
    case 'pattern': {
      if (!allowPattern) {
        ctx.repaired = true;
        return null;
      }
      const r = sanitizeEntry(raw.entry, ctx.now);
      if (r.repaired) ctx.repaired = true;
      return { kind: 'pattern', entry: r.entry };
    }
    default:
      ctx.repaired = true;
      return null;
  }
}

/** 묶음 목록. 한도를 넘으면 자르고, 모양이 틀린 묶음은 버린다. 빈 묶음은 남긴다(편집 중 정상 상태, 실행은 경고가 막는다). */
function sanitizeGroups(ctx: Ctx, raw: unknown, allowPattern: boolean, def: () => CondGroup[]): CondGroup[] {
  if (raw === undefined) return def();
  if (!Array.isArray(raw)) {
    ctx.repaired = true;
    return def();
  }
  if (raw.length > MAX_GROUPS) ctx.repaired = true;
  const out: CondGroup[] = [];
  for (const g of raw.slice(0, MAX_GROUPS)) {
    if (!isRecord(g) || !Array.isArray(g.conds)) {
      ctx.repaired = true;
      continue;
    }
    if (g.conds.length > MAX_CONDS) ctx.repaired = true;
    const conds: Cond[] = [];
    for (const c of g.conds.slice(0, MAX_CONDS)) {
      const cond = sanitizeCond(ctx, c, allowPattern);
      if (cond) conds.push(cond);
    }
    out.push({ conds });
  }
  return out;
}

function sanitizeOneV2(raw: Row, now: number): { strategy: StrategyV2; repaired: boolean } | null {
  const ctx: Ctx = { repaired: false, now };
  const rules = rec(ctx, raw.rules);
  const sell = rec(ctx, rules.sell);
  const tp = rec(ctx, sell.takeProfit);
  const sl = rec(ctx, sell.stopLoss);
  const tr = rec(ctx, sell.trailing);
  const te = rec(ctx, sell.timeExit);
  const sg = rec(ctx, sell.signal);
  const sizing = rec(ctx, raw.sizing);
  const cap = rec(ctx, raw.capital);

  // 공통 필드는 v1 모양으로 옮겨 v1 검증을 그대로 쓴다. undefined는 v1에서도 「없는 필드」(조용히 기본값)다
  const v1 = sanitizeStrategiesV1(
    {
      strategies: [
        {
          id: raw.id,
          name: raw.name,
          updatedAt: raw.updatedAt,
          universe: raw.universe,
          period: raw.period,
          capital: { initial: cap.initial, perBuyPct: sizing.pct },
          scaleIn: raw.scaleIn,
          exit: { takeProfit: tp.stages, stopLoss: { pct: sl.pct, basis: sl.basis }, afterFirstTake: tp.afterFirstTake },
          benchmarks: raw.benchmarks,
          costs: raw.costs,
        },
      ],
    },
    now,
  );
  const b = v1.strategies[0];
  if (!b) return null;
  if (v1.repaired) ctx.repaired = true;
  if (raw.v !== 2) ctx.repaired = true;

  const defaultBuy = (): CondGroup[] => [{ conds: [defaultCond('pattern', now)] }];
  const strategy: StrategyV2 = {
    v: 2,
    id: b.id,
    name: b.name,
    updatedAt: b.updatedAt,
    universe: b.universe,
    period: b.period,
    capital: { initial: b.capital.initial },
    sizing: { mode: oneOf(ctx, sizing.mode, 'fixed', SIZING_MODES), pct: b.capital.perBuyPct },
    rules: {
      buy: sanitizeGroups(ctx, rules.buy, true, defaultBuy),
      sell: {
        takeProfit: { on: bool(ctx, tp.on, true), stages: b.exit.takeProfit, afterFirstTake: b.exit.afterFirstTake },
        stopLoss: { on: bool(ctx, sl.on, true), pct: b.exit.stopLoss.pct, basis: b.exit.stopLoss.basis },
        trailing: { on: bool(ctx, tr.on, false), pct: num(ctx, tr.pct, 10, 1, 50) },
        timeExit: { on: bool(ctx, te.on, false), days: int(ctx, te.days, 20, 1, 250) },
        signal: { on: bool(ctx, sg.on, false), groups: sanitizeGroups(ctx, sg.groups, false, () => []) },
      },
    },
    scaleIn: b.scaleIn,
    benchmarks: b.benchmarks,
    costs: b.costs,
  };
  return { strategy, repaired: ctx.repaired };
}

/**
 * `{ strategies: [...] }`의 v2 전략 목록을 고친다. 규칙은 sanitizeStrategiesV1(v1)와 같다:
 * 필수 필드(id·name)가 틀린 항목과 id가 겹치는 항목은 버리고, MAX_STRATEGIES개까지만 남긴다.
 */
export function sanitizeStrategiesV2(raw: unknown, now = Date.now()): { strategies: StrategyV2[]; repaired: boolean } {
  if (!isRecord(raw) || !Array.isArray(raw.strategies))
    return { strategies: [], repaired: isRecord(raw) ? raw.strategies !== undefined : raw !== undefined && raw !== null };
  const strategies: StrategyV2[] = [];
  const ids = new Set<string>();
  let repaired = false;
  for (const item of raw.strategies) {
    const r = isRecord(item) ? sanitizeOneV2(item, now) : null;
    if (!r || ids.has(r.strategy.id) || strategies.length >= MAX_STRATEGIES) {
      repaired = true;
      continue;
    }
    ids.add(r.strategy.id);
    strategies.push(r.strategy);
    if (r.repaired) repaired = true;
  }
  return { strategies, repaired };
}
