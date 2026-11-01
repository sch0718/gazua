// 전략 v1 형식(전략 빌더 이전)과 읽기 검증·옮기기(스펙 §8.1). 앱은 저장소·문서·공유에서 v1을 만나면 toV2로 옮긴다.
// Worker 번들(dto·snapshot)이 sanitizeStrategiesV1·sanitizeEntry를 쓰니 DOM·저장소·import.meta.env를 쓰지 않는다.
import { kstDate, kstEpoch } from '../time/kst';
import { defaultPatternEntry, defaultPeriod, MAX_INITIAL, MAX_STRATEGIES, MAX_SYMBOLS, MAX_TAKE_STAGES, NAME_MAX } from './defaults';
import type { StrategyV2 } from './strategyV2';
import type { StopBasis } from './types';

export interface StrategyV1 {
  id: string;
  name: string; // 30자 이내
  updatedAt: number;
  universe: { kind: 'group'; groupId: string } | { kind: 'symbols'; symbols: string[] }; // 최대 8종목
  period: { from: string; to: string }; // KST YYYY-MM-DD, 양끝 포함
  capital: { initial: number; perBuyPct: number };
  entry: {
    decline: {
      dropPct: { on: boolean; value: number };
      days: { on: boolean; value: number };
    };
    triggers: {
      reboundDays: { on: boolean; value: number };
      breakout: { on: boolean; level: 'A' | 'B' };
      maCross: { on: boolean; period: number };
      goldenCross: { on: boolean; short: number; long: number };
    };
    filter: { aboveMa: { on: boolean; period: number } };
  };
  scaleIn: { on: boolean; stepPct: number; maxAdds: number };
  exit: {
    takeProfit: { pct: number; sellPct: number }[]; // 1~3단계, 마지막 단계 sellPct = 100
    stopLoss: { pct: number; basis: StopBasis };
    afterFirstTake: 'keep' | 'breakeven';
  };
  benchmarks: { index: 'KOSPI' | 'KOSDAQ'; symbol: string | null };
  costs: { feePct: number }; // 매수·매도 각각
}

export function newStrategyV1(now: number, groupId: string | null, name = '새 전략'): StrategyV1 {
  return {
    id: crypto.randomUUID(),
    name,
    updatedAt: now,
    universe: groupId ? { kind: 'group', groupId } : { kind: 'symbols', symbols: [] },
    period: defaultPeriod(now),
    capital: { initial: 10_000_000, perBuyPct: 10 },
    entry: defaultPatternEntry(),
    scaleIn: { on: false, stepPct: 3, maxAdds: 2 },
    exit: {
      takeProfit: [{ pct: 15, sellPct: 100 }],
      stopLoss: { pct: 5, basis: 'avgAfterScaleIn' },
      afterFirstTake: 'keep',
    },
    benchmarks: { index: 'KOSPI', symbol: '069500' },
    costs: { feePct: 0.015 },
  };
}

type Row = Record<string, unknown>;
const isRecord = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 달력에 있는 날짜인가(2026-02-30, 2026-99-99는 아님). */
const realDate = (x: unknown): boolean =>
  typeof x === 'string' && DATE_RE.test(x) && kstDate(kstEpoch(x, '00:00:00')) === x;
const BASES: readonly StopBasis[] = ['avgAfterScaleIn', 'avgAlways', 'firstBuy'];

/** 항목 하나를 고친다. 맞지 않는 필드는 기본값으로 바꾸고 repaired를 켠다(빠진 필드는 조용히 기본값). */
function sanitizeOne(raw: Row, now: number, template: StrategyV1): { strategy: StrategyV1; repaired: boolean } | null {
  if (typeof raw.id !== 'string' || raw.id.trim() === '' || typeof raw.name !== 'string') return null;
  const d = structuredClone(template);
  let repaired = false;
  const pick = <T>(v: unknown, def: T, ok: (x: unknown) => boolean): T => {
    if (ok(v)) return v as T;
    if (v !== undefined) repaired = true; // 없는 필드는 조용히 기본값, 있는데 틀린 것만 고침으로 센다
    return def;
  };
  const rec = (v: unknown): Row => {
    if (isRecord(v)) return v;
    if (v !== undefined) repaired = true;
    return {};
  };
  const num = (v: unknown, def: number, min: number, max: number): number =>
    pick(v, def, (x) => typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max);
  // 날·번처럼 정수여야 하는 칸(편집 화면의 정수 칸과 같다). 소수 기간은 이동평균이 NaN이 된다
  const int = (v: unknown, def: number, min: number, max: number): number =>
    pick(v, def, (x) => Number.isInteger(x) && (x as number) >= min && (x as number) <= max);
  const bool = (v: unknown, def: boolean): boolean => pick(v, def, (x) => typeof x === 'boolean');
  const flag = (v: unknown, def: { on: boolean; value: number }, min: number, max: number, whole = false) => {
    const r = rec(v);
    return { on: bool(r.on, def.on), value: (whole ? int : num)(r.value, def.value, min, max) };
  };

  if (raw.name.length > NAME_MAX) repaired = true;
  const name = raw.name.slice(0, NAME_MAX);

  let universe = d.universe;
  const u = rec(raw.universe);
  if (u.kind === 'group' && typeof u.groupId === 'string') universe = { kind: 'group', groupId: u.groupId };
  else if (u.kind === 'symbols' && Array.isArray(u.symbols)) {
    const symbols = [...new Set(u.symbols.filter((x): x is string => typeof x === 'string'))];
    if (symbols.length !== u.symbols.length || symbols.length > MAX_SYMBOLS) repaired = true;
    universe = { kind: 'symbols', symbols: symbols.slice(0, MAX_SYMBOLS) };
  } else if (raw.universe !== undefined) repaired = true;

  const p = rec(raw.period);
  const dp = defaultPeriod(now);
  const period = { from: pick(p.from, dp.from, realDate), to: pick(p.to, dp.to, realDate) };

  const cap = rec(raw.capital);
  const capital = {
    initial: int(cap.initial, d.capital.initial, 1, MAX_INITIAL),
    perBuyPct: num(cap.perBuyPct, d.capital.perBuyPct, 1, 100),
  };

  const en = rec(raw.entry);
  const dec = rec(en.decline);
  const trg = rec(en.triggers);
  const brk = rec(trg.breakout);
  const mac = rec(trg.maCross);
  const gc = rec(trg.goldenCross);
  const flt = rec(rec(en.filter).aboveMa);
  const entry: StrategyV1['entry'] = {
    decline: {
      dropPct: flag(dec.dropPct, d.entry.decline.dropPct, 1, 90),
      days: flag(dec.days, d.entry.decline.days, 1, 60, true),
    },
    triggers: {
      reboundDays: flag(trg.reboundDays, d.entry.triggers.reboundDays, 1, 60, true),
      breakout: {
        on: bool(brk.on, d.entry.triggers.breakout.on),
        level: pick(brk.level, d.entry.triggers.breakout.level, (x) => x === 'A' || x === 'B'),
      },
      maCross: {
        on: bool(mac.on, d.entry.triggers.maCross.on),
        period: int(mac.period, d.entry.triggers.maCross.period, 2, 250),
      },
      goldenCross: {
        on: bool(gc.on, d.entry.triggers.goldenCross.on),
        short: int(gc.short, d.entry.triggers.goldenCross.short, 2, 250),
        long: int(gc.long, d.entry.triggers.goldenCross.long, 2, 250),
      },
    },
    filter: { aboveMa: { on: bool(flt.on, d.entry.filter.aboveMa.on), period: int(flt.period, d.entry.filter.aboveMa.period, 2, 250) } },
  };

  const sc = rec(raw.scaleIn);
  const scaleIn = {
    on: bool(sc.on, d.scaleIn.on),
    stepPct: num(sc.stepPct, d.scaleIn.stepPct, 0.5, 50),
    maxAdds: int(sc.maxAdds, d.scaleIn.maxAdds, 1, 5),
  };

  const ex = rec(raw.exit);
  let takeProfit = d.exit.takeProfit;
  const tpOk = (t: unknown) =>
    isRecord(t) &&
    typeof t.pct === 'number' && t.pct >= 0.5 && t.pct <= 500 &&
    typeof t.sellPct === 'number' && t.sellPct >= 1 && t.sellPct <= 100;
  if (Array.isArray(ex.takeProfit) && ex.takeProfit.length > 0 && ex.takeProfit.every(tpOk)) {
    if (ex.takeProfit.length > MAX_TAKE_STAGES) repaired = true;
    const stages = (ex.takeProfit as { pct: number; sellPct: number }[]).slice(0, MAX_TAKE_STAGES).map((t) => ({ pct: t.pct, sellPct: t.sellPct }));
    const last = stages[stages.length - 1];
    if (last.sellPct !== 100) repaired = true; // 앱은 늘 100으로 저장하니 100이 아니면 바깥에서 온 값을 바꾼 것
    last.sellPct = 100; // 마지막 단계는 나머지 전부
    takeProfit = stages;
  } else if (ex.takeProfit !== undefined) repaired = true;
  const sl = rec(ex.stopLoss);

  const bm = rec(raw.benchmarks);
  const benchmarks = {
    index: pick(bm.index, d.benchmarks.index, (x) => x === 'KOSPI' || x === 'KOSDAQ'),
    symbol: pick(bm.symbol, d.benchmarks.symbol, (x) => x === null || typeof x === 'string'),
  };
  const costs = { feePct: num(rec(raw.costs).feePct, d.costs.feePct, 0, 1) };

  return {
    strategy: {
      id: raw.id,
      name,
      updatedAt: pick(raw.updatedAt, 0, (x) => typeof x === 'number' && Number.isFinite(x)),
      universe,
      period,
      capital,
      entry,
      scaleIn,
      exit: {
        takeProfit,
        stopLoss: {
          pct: num(sl.pct, d.exit.stopLoss.pct, 0.5, 50),
          basis: pick(sl.basis, d.exit.stopLoss.basis, (x) => BASES.includes(x as StopBasis)),
        },
        afterFirstTake: pick(ex.afterFirstTake, d.exit.afterFirstTake, (x) => x === 'keep' || x === 'breakeven'),
      },
      benchmarks,
      costs,
    },
    repaired,
  };
}

/**
 * 저장소에서 읽은 `{ strategies: [...] }`를 고친다. 필수 필드(id·name)가 틀린 항목과 id가 겹치는 항목은 버리고, 20개까지만 남긴다.
 * repaired: 무언가를 버렸거나, 있는 값을 기본값으로 바꾸거나 잘라내거나 맞췄다(없는 필드는 조용히 기본값).
 */
export function sanitizeStrategiesV1(raw: unknown, now = Date.now()): { strategies: StrategyV1[]; repaired: boolean } {
  // 루트가 없거나 null이면 조용히 빈 목록, 있는데 모양이 틀리면 버린 것으로 센다
  if (!isRecord(raw) || !Array.isArray(raw.strategies))
    return { strategies: [], repaired: isRecord(raw) ? raw.strategies !== undefined : raw !== undefined && raw !== null };
  const strategies: StrategyV1[] = [];
  const ids = new Set<string>();
  let repaired = false;
  const template = newStrategyV1(now, null); // 기본값 원본은 한 번만 만든다
  for (const item of raw.strategies) {
    const r = isRecord(item) ? sanitizeOne(item, now, template) : null;
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

/** 매수 조건(entry) 하나만 같은 규칙으로 고친다. 선정 기준의 반등 패턴(직접 정하기)이 쓴다. */
export function sanitizeEntry(raw: unknown, now: number): { entry: StrategyV1['entry']; repaired: boolean } {
  const r = sanitizeOne({ id: 'x', name: 'x', entry: raw }, now, newStrategyV1(now, null));
  // id·name을 고정했으니 null일 수 없다
  return { entry: r!.strategy.entry, repaired: r!.repaired };
}

/** v1 → v2(스펙 §8.1). 순수 함수: 시각·난수를 쓰지 않아 같은 v1이면 늘 같은 v2, 원본과 객체를 나누지 않는다 */
export function toV2(s: StrategyV1): StrategyV2 {
  return {
    v: 2,
    id: s.id,
    name: s.name,
    updatedAt: s.updatedAt,
    universe: s.universe.kind === 'group' ? { kind: 'group', groupId: s.universe.groupId } : { kind: 'symbols', symbols: [...s.universe.symbols] },
    period: { from: s.period.from, to: s.period.to },
    capital: { initial: s.capital.initial },
    sizing: { mode: 'fixed', pct: s.capital.perBuyPct },
    rules: {
      buy: [{ conds: [{ kind: 'pattern', entry: structuredClone(s.entry) }] }],
      sell: {
        takeProfit: { on: true, stages: s.exit.takeProfit.map((t) => ({ pct: t.pct, sellPct: t.sellPct })), afterFirstTake: s.exit.afterFirstTake },
        stopLoss: { on: true, pct: s.exit.stopLoss.pct, basis: s.exit.stopLoss.basis },
        trailing: { on: false, pct: 10 },
        timeExit: { on: false, days: 20 },
        signal: { on: false, groups: [] },
      },
    },
    scaleIn: { on: s.scaleIn.on, stepPct: s.scaleIn.stepPct, maxAdds: s.scaleIn.maxAdds },
    benchmarks: { index: s.benchmarks.index, symbol: s.benchmarks.symbol },
    costs: { feePct: s.costs.feePct },
  };
}
