// 저장된 선정 기준의 검증과 편집 화면 경고. sim/validate.ts와 같은 규칙: 틀린 값은 기본값으로 되돌리고 repaired를 켠다.
import { kstDate, kstEpoch } from '../time/kst';
import { sanitizeEntry } from '../sim/validate';
import type { Strategy } from '../sim/types';
import { BENCH_MAX, MAX_CRITERIA, MAX_INITIAL, NAME_MAX, TAKE_MAX, newCriteria } from './defaults';
import type { Market, RankBy, Rebalance, SecurityType, SelectionCriteria } from './types';

type Row = Record<string, unknown>;
const isRecord = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const realDate = (x: unknown): boolean =>
  typeof x === 'string' && DATE_RE.test(x) && kstDate(kstEpoch(x, '00:00:00')) === x;

const MARKETS: readonly Market[] = ['KOSPI', 'KOSDAQ'];
const TYPES: readonly SecurityType[] = ['STOCK', 'ETF'];
const RANKS: readonly RankBy[] = ['marketCap', 'tradingValue', 'return', 'lowVolatility'];
const REBALANCES: readonly Rebalance[] = ['monthly', 'quarterly', 'semiannual'];
/** 억 원 단위 상한(1,000조 원). 그 위는 입력 실수로 본다 */
const EOK_MAX = 10_000_000;

export type Issue = {
  section: 'pool' | 'conditions' | 'rank' | 'period' | 'benchmarks' | 'trading';
  text: string;
  blocking: boolean;
};

function sanitizeOne(raw: Row, now: number, template: SelectionCriteria): { criteria: SelectionCriteria; repaired: boolean } | null {
  if (typeof raw.id !== 'string' || raw.id.trim() === '' || typeof raw.name !== 'string') return null;
  const d = structuredClone(template);
  let repaired = false;
  const pick = <T>(v: unknown, def: T, ok: (x: unknown) => boolean): T => {
    if (ok(v)) return v as T;
    if (v !== undefined) repaired = true;
    return def;
  };
  const rec = (v: unknown): Row => {
    if (isRecord(v)) return v;
    if (v !== undefined) repaired = true;
    return {};
  };
  const num = (v: unknown, def: number, min: number, max: number): number =>
    pick(v, def, (x) => typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max);
  const int = (v: unknown, def: number, min: number, max: number): number =>
    pick(v, def, (x) => Number.isInteger(x) && (x as number) >= min && (x as number) <= max);
  const bool = (v: unknown, def: boolean): boolean => pick(v, def, (x) => typeof x === 'boolean');
  /** 허용 값만 중복 없이 남긴다. 걸러졌으면 고침으로 세고, 비면 기본값(allowEmpty면 빈 채로) */
  const list = <T extends string>(v: unknown, def: T[], allowed: readonly T[], allowEmpty: boolean): T[] => {
    if (!Array.isArray(v)) {
      if (v !== undefined) repaired = true;
      return def;
    }
    const out = [...new Set(v.filter((x): x is T => allowed.includes(x as T)))];
    if (out.length !== v.length) repaired = true;
    if (out.length === 0 && !allowEmpty) {
      repaired = true;
      return def;
    }
    return out;
  };

  if (raw.name.length > NAME_MAX) repaired = true;
  const name = raw.name.slice(0, NAME_MAX);

  const pl = rec(raw.pool);
  let sectors = d.pool.sectors;
  if (Array.isArray(pl.sectors)) {
    sectors = [...new Set(pl.sectors.filter((x): x is string => typeof x === 'string' && x !== ''))];
    if (sectors.length !== pl.sectors.length) repaired = true;
  } else if (pl.sectors !== undefined) repaired = true;
  const pool = {
    markets: list(pl.markets, d.pool.markets, MARKETS, false),
    types: list(pl.types, d.pool.types, TYPES, false),
    excludeManaged: bool(pl.excludeManaged, d.pool.excludeManaged),
    sectors,
  };

  const cd = rec(raw.conditions);
  const mc = rec(cd.marketCap);
  const tv = rec(cd.tradingValue);
  const ld = rec(cd.leader);
  const rr = rec(cd.returnRange);
  const vm = rec(cd.vsMa);
  const fh = rec(cd.fromHigh);
  const vo = rec(cd.volatility);
  const rb = rec(cd.rebound);
  const dc = d.conditions;

  const pt = rec(rb.pattern);
  let pattern = dc.rebound.pattern;
  if (pt.from === 'strategy' && typeof pt.strategyId === 'string' && pt.strategyId !== '')
    pattern = { from: 'strategy', strategyId: pt.strategyId };
  else if (pt.from === 'custom') {
    const e = sanitizeEntry(pt.entry, now);
    if (e.repaired) repaired = true;
    pattern = { from: 'custom', entry: e.entry };
  } else if (rb.pattern !== undefined) repaired = true;

  const conditions: SelectionCriteria['conditions'] = {
    marketCap: { on: bool(mc.on, dc.marketCap.on), minEok: num(mc.minEok, dc.marketCap.minEok, 0, EOK_MAX) },
    tradingValue: {
      on: bool(tv.on, dc.tradingValue.on),
      days: int(tv.days, dc.tradingValue.days, 1, 250),
      minEok: num(tv.minEok, dc.tradingValue.minEok, 0, EOK_MAX),
    },
    leader: {
      on: bool(ld.on, dc.leader.on),
      level: pick(ld.level, dc.leader.level, (x) => x === 1 || x === 2),
      maxRank: int(ld.maxRank, dc.leader.maxRank, 1, 100),
    },
    returnRange: {
      on: bool(rr.on, dc.returnRange.on),
      days: int(rr.days, dc.returnRange.days, 1, 250),
      minPct: num(rr.minPct, dc.returnRange.minPct, -100, 1000),
      maxPct: num(rr.maxPct, dc.returnRange.maxPct, -100, 1000),
    },
    vsMa: {
      on: bool(vm.on, dc.vsMa.on),
      period: int(vm.period, dc.vsMa.period, 2, 250),
      side: pick(vm.side, dc.vsMa.side, (x) => x === 'above' || x === 'below'),
    },
    fromHigh: {
      on: bool(fh.on, dc.fromHigh.on),
      minPct: num(fh.minPct, dc.fromHigh.minPct, 0, 100),
      maxPct: num(fh.maxPct, dc.fromHigh.maxPct, 0, 100),
    },
    volatility: {
      on: bool(vo.on, dc.volatility.on),
      days: int(vo.days, dc.volatility.days, 2, 250),
      maxPct: num(vo.maxPct, dc.volatility.maxPct, 0, 100),
    },
    rebound: { on: bool(rb.on, dc.rebound.on), withinDays: int(rb.withinDays, dc.rebound.withinDays, 1, 60), pattern },
  };

  const rk = rec(raw.rank);
  const rank = {
    by: pick(rk.by, d.rank.by, (x) => RANKS.includes(x as RankBy)),
    take: int(rk.take, d.rank.take, 1, TAKE_MAX),
  };

  const p = rec(raw.period);
  const period = { from: pick(p.from, d.period.from, realDate), to: pick(p.to, d.period.to, realDate) };

  const bm = rec(raw.benchmarks);
  let symbols = d.benchmarks.symbols;
  if (Array.isArray(bm.symbols)) {
    const all = bm.symbols.filter((x): x is string => typeof x === 'string' && x !== '');
    const uniq = [...new Set(all)];
    if (uniq.length !== bm.symbols.length || uniq.length > BENCH_MAX) repaired = true;
    symbols = uniq.slice(0, BENCH_MAX);
  } else if (bm.symbols !== undefined) repaired = true;
  const benchmarks = { indices: list(bm.indices, d.benchmarks.indices, MARKETS, true), symbols };

  const tr = rec(raw.trading);
  return {
    criteria: {
      id: raw.id,
      name,
      updatedAt: pick(raw.updatedAt, 0, (x) => typeof x === 'number' && Number.isFinite(x)),
      pool,
      conditions,
      rank,
      rebalance: pick(raw.rebalance, d.rebalance, (x) => REBALANCES.includes(x as Rebalance)),
      period,
      benchmarks,
      costs: { feePct: num(rec(raw.costs).feePct, d.costs.feePct, 0, 1) },
      capital: int(raw.capital, d.capital, 1, MAX_INITIAL),
      trading: { strategyId: pick(tr.strategyId, null, (x) => x === null || (typeof x === 'string' && x !== '')) },
    },
    repaired,
  };
}

/**
 * 저장소에서 읽은 `{ criteria: [...] }`를 고친다. id·name이 틀린 항목과 id가 겹치는 항목은 버리고 20개까지만 남긴다.
 * repaired: 무언가를 버리거나 있는 값을 기본값으로 바꾸거나 잘라냈다(없는 필드는 조용히 기본값).
 */
export function sanitizeCriteria(raw: unknown, now = Date.now()): { criteria: SelectionCriteria[]; repaired: boolean } {
  if (!isRecord(raw) || !Array.isArray(raw.criteria))
    return { criteria: [], repaired: isRecord(raw) ? raw.criteria !== undefined : raw !== undefined && raw !== null };
  const criteria: SelectionCriteria[] = [];
  const ids = new Set<string>();
  let repaired = false;
  const template = newCriteria(now, null);
  for (const item of raw.criteria) {
    const r = isRecord(item) ? sanitizeOne(item, now, template) : null;
    if (!r || ids.has(r.criteria.id) || criteria.length >= MAX_CRITERIA) {
      repaired = true;
      continue;
    }
    ids.add(r.criteria.id);
    criteria.push(r.criteria);
    if (r.repaired) repaired = true;
  }
  return { criteria, repaired };
}

export function criteriaIssues(c: SelectionCriteria, strategies: Strategy[]): Issue[] {
  const out: Issue[] = [];
  const has = (id: string) => strategies.some((s) => s.id === id);
  const k = c.conditions;

  if (k.rebound.pattern.from === 'strategy' && !has(k.rebound.pattern.strategyId))
    out.push({ section: 'conditions', text: '반등 신호에 쓰던 전략이 없어요. 다시 골라 주세요', blocking: true });
  if (c.trading.strategyId !== null && !has(c.trading.strategyId))
    out.push({ section: 'trading', text: '매매 규칙 전략이 없어요. 다시 골라 주세요', blocking: true });

  if (c.period.from >= c.period.to) out.push({ section: 'period', text: '시작일이 종료일보다 앞이어야 해요', blocking: true });
  if (k.returnRange.on && k.returnRange.minPct > k.returnRange.maxPct)
    out.push({ section: 'conditions', text: '수익률 범위는 작은 값부터 적어 주세요', blocking: true });
  if (k.fromHigh.on && k.fromHigh.minPct > k.fromHigh.maxPct)
    out.push({ section: 'conditions', text: '고점 대비 범위는 작은 값부터 적어 주세요', blocking: true });

  if (!Object.values(k).some((x) => x.on))
    out.push({ section: 'conditions', text: '조건이 없으면 후보 범위의 모든 종목에서 정렬 순으로 골라요', blocking: false });
  return out;
}
