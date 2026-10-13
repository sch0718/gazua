// 저장된 전략의 검증과 편집 화면 경고. state/validate.ts처럼 아는 필드만 타입을 검사하고 틀리면 기본값으로 되돌린다.
import type { Watchlists } from '../state/schema';
import { addDays, kstDate, kstEpoch } from '../time/kst';
import { defaultPeriod, MAX_INITIAL, MAX_STRATEGIES, MAX_SYMBOLS, MAX_TAKE_STAGES, NAME_MAX, newStrategy } from './defaults';
import type { StopBasis, Strategy } from './types';

type Row = Record<string, unknown>;
const isRecord = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 달력에 있는 날짜인가(2026-02-30, 2026-99-99는 아님). */
const realDate = (x: unknown): boolean =>
  typeof x === 'string' && DATE_RE.test(x) && kstDate(kstEpoch(x, '00:00:00')) === x;
const BASES: readonly StopBasis[] = ['avgAfterScaleIn', 'avgAlways', 'firstBuy'];

export type Issue = {
  section: 'universe' | 'period' | 'capital' | 'entry' | 'scaleIn' | 'exit' | 'benchmarks' | 'costs';
  text: string;
  blocking: boolean;
};

/** 항목 하나를 고친다. 맞지 않거나 빠진 필드는 기본값으로 바꾸고 repaired를 켠다. */
function sanitizeOne(raw: Row, now: number, template: Strategy): { strategy: Strategy; repaired: boolean } | null {
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
  const entry: Strategy['entry'] = {
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
    stages[stages.length - 1].sellPct = 100; // 마지막 단계는 나머지 전부
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
 * repaired: 무언가를 버렸거나 틀린 값을 기본값으로 바꿨다(없는 필드는 조용히 기본값).
 */
export function sanitizeStrategies(raw: unknown, now = Date.now()): { strategies: Strategy[]; repaired: boolean } {
  if (!isRecord(raw) || !Array.isArray(raw.strategies)) return { strategies: [], repaired: false };
  const strategies: Strategy[] = [];
  const ids = new Set<string>();
  let repaired = false;
  const template = newStrategy(now, null); // 기본값 원본은 한 번만 만든다
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

/** 그룹이면 지금 그룹의 종목 순서대로, 그룹이 없으면 []. */
export function resolveSymbols(s: Strategy, w: Watchlists): string[] {
  if (s.universe.kind === 'symbols') return s.universe.symbols.slice(0, MAX_SYMBOLS);
  const id = s.universe.groupId;
  const g = w.groups.find((x) => x.id === id);
  return g ? g.items.map((i) => i.symbol).slice(0, MAX_SYMBOLS) : [];
}

export function strategyIssues(s: Strategy, w: Watchlists): Issue[] {
  const out: Issue[] = [];
  const n = resolveSymbols(s, w).length;
  if (n === 0) out.push({ section: 'universe', text: '종목을 하나 이상 골라 주세요', blocking: true });

  const { from, to } = s.period;
  if (from >= to) out.push({ section: 'period', text: '시작일이 종료일보다 앞이어야 해요', blocking: true });
  else if (addDays(from, 42) > to) out.push({ section: 'period', text: '기간이 짧아 결과를 믿기 어려워요', blocking: false });

  const t = s.entry.triggers;
  if (!t.reboundDays.on && !t.breakout.on && !t.maCross.on && !t.goldenCross.on)
    out.push({ section: 'entry', text: '사는 신호가 하나도 켜져 있지 않아요. ②에서 하나 이상 켜 주세요', blocking: true });
  if (t.goldenCross.on && t.goldenCross.short >= t.goldenCross.long)
    out.push({ section: 'entry', text: '짧은 이동평균 기간이 긴 이동평균보다 짧아야 해요', blocking: false });

  const { stopLoss, takeProfit } = s.exit;
  if (stopLoss.basis === 'avgAlways' && s.scaleIn.on && s.scaleIn.stepPct >= stopLoss.pct)
    out.push({ section: 'exit', text: '추가 매수보다 손절이 먼저 일어나요. 추가 매수 간격을 손절폭보다 작게 해 주세요', blocking: false });
  if (takeProfit.some((x, i) => i > 0 && x.pct <= takeProfit[i - 1].pct))
    out.push({ section: 'exit', text: '익절 단계는 낮은 %부터 차례로 적어 주세요', blocking: true });
  if (takeProfit.slice(0, -1).reduce((a, x) => a + x.sellPct, 0) >= 100)
    out.push({ section: 'exit', text: '마지막 단계 전에 모두 팔려서 뒤 단계가 실행되지 않아요', blocking: false });

  const buys = 1 + (s.scaleIn.on ? s.scaleIn.maxAdds : 0); // 분할 매수를 껐으면 추가 매수는 없다
  if (s.capital.perBuyPct * buys * n > 100)
    out.push({ section: 'capital', text: '모든 종목이 한꺼번에 사면 현금이 모자라요. 신호 일부를 건너뛸 수 있어요', blocking: false });
  return out;
}
