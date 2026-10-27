// 저장된 선정 기준의 검증과 편집 화면 경고. sim/validate.ts와 같은 규칙: 틀린 값은 기본값으로 되돌리고 repaired를 켠다.
import { kstDate, kstEpoch } from '../time/kst';
import { ruleIssues, sanitizeEntry } from '../sim/validate';
import type { Strategy } from '../sim/types';
import { BENCH_MAX, MAX_CRITERIA, MAX_INITIAL, NAME_MAX, POOL_THEMES_MAX, TAKE_MAX, newCriteria } from './defaults';
import { MAX_BASKETS, type Basket } from './baskets';
import type { FinMetric, FlowWho, MacroSeriesCond, MacroSeriesKey, Market, RankBy, Rebalance, SecurityType, SelectionCriteria } from './types';

type Row = Record<string, unknown>;
const isRecord = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const realDate = (x: unknown): boolean =>
  typeof x === 'string' && DATE_RE.test(x) && kstDate(kstEpoch(x, '00:00:00')) === x;

const MARKETS: readonly Market[] = ['KOSPI', 'KOSDAQ'];
const TYPES: readonly SecurityType[] = ['STOCK', 'ETF'];
const RANKS: readonly RankBy[] = ['marketCap', 'tradingValue', 'return', 'lowVolatility', 'macroBeta', 'flow', 'fin'];
const FIN_METRICS: readonly FinMetric[] = ['per', 'pbr', 'roe', 'opMargin', 'revGrowth', 'opGrowth'];
const WHOS: readonly FlowWho[] = ['foreign', 'inst', 'indiv', 'both'];
const SERIES: readonly MacroSeriesKey[] = ['usdkrw', 'wti'];
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
  // 문자열 목록(테마 코드·묶음 id). 틀린 항목은 버리고 고침으로 센다
  // 문자열만 중복 없이 max개까지 앞에서부터 남긴다
  const strList = (v: unknown, def: string[], max: number): string[] => {
    if (!Array.isArray(v)) {
      if (v !== undefined) repaired = true;
      return def;
    }
    const out = [...new Set(v.filter((x): x is string => typeof x === 'string' && x !== ''))].slice(0, max);
    if (out.length !== v.length) repaired = true;
    return out;
  };
  const pool = {
    themes: strList(pl.themes, d.pool.themes, POOL_THEMES_MAX),
    baskets: strList(pl.baskets, d.pool.baskets, MAX_BASKETS),
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

  const mcr = rec(cd.macro);
  const series = (v: unknown, def: MacroSeriesCond): MacroSeriesCond => {
    const r = rec(v);
    const b = rec(r.beta);
    const t = rec(r.trend);
    return {
      beta: { on: bool(b.on, def.beta.on), min: num(b.min, def.beta.min, -20, 20), max: num(b.max, def.beta.max, -20, 20) },
      trend: {
        on: bool(t.on, def.trend.on),
        lookback: int(t.lookback, def.trend.lookback, 5, 120),
        thresholdPct: num(t.thresholdPct, def.trend.thresholdPct, 0.5, 50),
        minAbsBeta: num(t.minAbsBeta, def.trend.minAbsBeta, 0, 20),
        whenFlat: pick(t.whenFlat, def.trend.whenFlat, (x) => x === 'pass' || x === 'none'),
      },
    };
  };

  const fl = rec(cd.flow);
  const fa = rec(fl.amount);
  const fs = rec(fl.streak);
  const who = (x: unknown, def: FlowWho): FlowWho => pick(x, def, (y) => WHOS.includes(y as FlowWho));

  const fn = rec(cd.fin);
  const fper = rec(fn.per);
  const fpbr = rec(fn.pbr);
  const froe = rec(fn.roe);
  const fom = rec(fn.opMargin);
  const frg = rec(fn.revGrowth);
  const fog = rec(fn.opGrowth);
  const fdr = rec(fn.debtRatio);
  const fpf = rec(fn.profitable);

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
    macro: {
      betaDays: int(mcr.betaDays, dc.macro.betaDays, 30, 250),
      usdkrw: series(mcr.usdkrw, dc.macro.usdkrw),
      wti: series(mcr.wti, dc.macro.wti),
    },
    flow: {
      amount: {
        on: bool(fa.on, dc.flow.amount.on),
        who: who(fa.who, dc.flow.amount.who),
        days: int(fa.days, dc.flow.amount.days, 5, 120),
        minPct: num(fa.minPct, dc.flow.amount.minPct, -100, 100),
        maxPct: num(fa.maxPct, dc.flow.amount.maxPct, -100, 100),
      },
      streak: {
        on: bool(fs.on, dc.flow.streak.on),
        who: who(fs.who, dc.flow.streak.who),
        minDays: int(fs.minDays, dc.flow.streak.minDays, 1, 60),
      },
    },
    fin: {
      per: { on: bool(fper.on, dc.fin.per.on), min: num(fper.min, dc.fin.per.min, 0, 1000), max: num(fper.max, dc.fin.per.max, 0, 1000) },
      pbr: { on: bool(fpbr.on, dc.fin.pbr.on), min: num(fpbr.min, dc.fin.pbr.min, 0, 100), max: num(fpbr.max, dc.fin.pbr.max, 0, 100) },
      roe: { on: bool(froe.on, dc.fin.roe.on), min: num(froe.min, dc.fin.roe.min, -100, 100) },
      opMargin: { on: bool(fom.on, dc.fin.opMargin.on), min: num(fom.min, dc.fin.opMargin.min, -100, 100) },
      revGrowth: { on: bool(frg.on, dc.fin.revGrowth.on), min: num(frg.min, dc.fin.revGrowth.min, -100, 1000) },
      opGrowth: { on: bool(fog.on, dc.fin.opGrowth.on), min: num(fog.min, dc.fin.opGrowth.min, -100, 1000) },
      debtRatio: { on: bool(fdr.on, dc.fin.debtRatio.on), max: num(fdr.max, dc.fin.debtRatio.max, 0, 10000) },
      profitable: { on: bool(fpf.on, dc.fin.profitable.on) },
    },
  };

  const rk = rec(raw.rank);
  const by = pick(rk.by, d.rank.by, (x) => RANKS.includes(x as RankBy));
  const dSeries = d.rank.series ?? 'usdkrw';
  // series는 macroBeta일 때만 검증한다. 아니면 틀린 값도 고침으로 세지 않고 기본값으로 둔다
  const rankSeries: MacroSeriesKey =
    by === 'macroBeta'
      ? pick(rk.series, dSeries, (x) => SERIES.includes(x as MacroSeriesKey))
      : SERIES.includes(rk.series as MacroSeriesKey)
        ? (rk.series as MacroSeriesKey)
        : dSeries;
  const rf = rec(rk.flow);
  const dFlow = d.rank.flow ?? { who: 'foreign' as FlowWho, days: 20 };
  const rfin = rec(rk.fin);
  const dFin = d.rank.fin ?? { metric: 'per' as FinMetric };
  const rank = {
    by,
    take: int(rk.take, d.rank.take, 1, TAKE_MAX),
    series: rankSeries,
    flow: { who: who(rf.who, dFlow.who), days: int(rf.days, dFlow.days, 5, 120) },
    fin: { metric: pick(rfin.metric, dFin.metric, (x) => FIN_METRICS.includes(x as FinMetric)) },
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

const RULE_SECTIONS = ['entry', 'scaleIn', 'exit'];
// 전략 편집 화면의 구역 번호(②)는 이 화면의 ②와 헷갈리므로 '전략 편집'으로 바꾼다
const borrowed = (text: string): string => text.replace(/[①-⑨]에서/g, '전략 편집에서');

/**
 * 참조 전략에서 전략 편집 화면이 실행을 막는 매수·매도 규칙 오류(스펙 5장). 반등 패턴은 entry만 본다.
 * 종목 범위·기간·비용 등은 선정 기준 값으로 바뀌므로 보지 않는다. 지워진 전략은 건너뛴다.
 */
export function strategyRuleIssues(c: SelectionCriteria, strategies: Strategy[]): Issue[] {
  const out: Issue[] = [];
  const blocking = (id: string, sections: string[]) => {
    const s = strategies.find((x) => x.id === id);
    return s ? ruleIssues(s).filter((i) => i.blocking && sections.includes(i.section)) : [];
  };
  const p = c.conditions.rebound;
  if (p.on && p.pattern.from === 'strategy')
    for (const i of blocking(p.pattern.strategyId, ['entry']))
      out.push({ section: 'conditions', text: `반등 패턴 전략에 고칠 곳이 있어요: ${borrowed(i.text)}`, blocking: true });
  if (c.trading.strategyId !== null)
    for (const i of blocking(c.trading.strategyId, RULE_SECTIONS))
      out.push({ section: 'trading', text: `매매 규칙 전략에 고칠 곳이 있어요: ${borrowed(i.text)}`, blocking: true });
  return out;
}

const NO_MACRO = '이 데이터에는 환율·유가가 없어요';
const NO_FLOW = '이 데이터에는 투자자 매매동향이 없어요';
const NO_FIN = '이 데이터에는 재무 정보가 없어요';

/** 환율·유가 조건이 하나라도 켜져 있는가 */
export const macroOn = (m: SelectionCriteria['conditions']['macro']): boolean =>
  m.usdkrw.beta.on || m.usdkrw.trend.on || m.wti.beta.on || m.wti.trend.on;

/** 수급 조건이 하나라도 켜져 있는가 */
export const flowOn = (c: SelectionCriteria): boolean => c.conditions.flow.amount.on || c.conditions.flow.streak.on;
/** 수급 조건을 켰거나 수급 순으로 정렬하는가 */
export const usesFlow = (c: SelectionCriteria): boolean => flowOn(c) || c.rank.by === 'flow';

/** 재무 조건이 하나라도 켜져 있는가 */
export const finOn = (c: SelectionCriteria): boolean => Object.values(c.conditions.fin).some((x) => x.on);
/** 재무 조건을 켰거나 재무 순으로 정렬하는가 */
export const usesFin = (c: SelectionCriteria): boolean => finOn(c) || c.rank.by === 'fin';

/**
 * dataInfo·baskets를 주면 데이터와 내 묶음에 기대는 검사를 더한다. 생략하면 건너뛴다(기존 호출 그대로).
 * baskets는 지금 프로필의 내 묶음 목록이다.
 */
export function criteriaIssues(
  c: SelectionCriteria,
  strategies: Strategy[],
  dataInfo?: { hasMacro: boolean; hasFlow: boolean; hasFin: boolean; themeCodes?: string[] },
  baskets?: Pick<Basket, 'id'>[],
): Issue[] {
  const out: Issue[] = [];
  const has = (id: string) => strategies.some((s) => s.id === id);
  const k = c.conditions;

  if (k.rebound.on && k.rebound.pattern.from === 'strategy' && !has(k.rebound.pattern.strategyId))
    out.push({ section: 'conditions', text: '반등 신호에 쓰던 전략이 없어요. 다시 골라 주세요', blocking: true });
  if (c.trading.strategyId !== null && !has(c.trading.strategyId))
    out.push({ section: 'trading', text: '매매 규칙 전략이 없어요. 다시 골라 주세요', blocking: true });
  out.push(...strategyRuleIssues(c, strategies));

  if (c.period.from >= c.period.to) out.push({ section: 'period', text: '시작일이 종료일보다 앞이어야 해요', blocking: true });
  if (k.returnRange.on && k.returnRange.minPct > k.returnRange.maxPct)
    out.push({ section: 'conditions', text: '수익률 범위는 작은 값부터 적어 주세요', blocking: true });
  if (k.fromHigh.on && k.fromHigh.minPct > k.fromHigh.maxPct)
    out.push({ section: 'conditions', text: '고점 대비 범위는 작은 값부터 적어 주세요', blocking: true });

  if (dataInfo && !dataInfo.hasMacro && macroOn(k.macro))
    out.push({ section: 'conditions', text: NO_MACRO, blocking: true });
  (['usdkrw', 'wti'] as const).forEach((key) => {
    const b = k.macro[key].beta;
    if (b.on && b.min > b.max)
      out.push({
        section: 'conditions',
        text: `${key === 'usdkrw' ? '원/달러' : '유가'} 민감도 범위의 최소가 최대보다 커요`,
        blocking: true,
      });
  });
  // 같은 문구는 한 번만(조건 구역의 이슈를 남긴다)
  if (dataInfo && !dataInfo.hasMacro && c.rank.by === 'macroBeta' && !out.some((i) => i.text === NO_MACRO))
    out.push({ section: 'rank', text: NO_MACRO, blocking: true });
  if (k.flow.amount.on && k.flow.amount.minPct > k.flow.amount.maxPct)
    out.push({ section: 'conditions', text: '순매수 비율의 최소가 최대보다 커요', blocking: true });
  if (dataInfo && !dataInfo.hasFlow && usesFlow(c))
    out.push({ section: flowOn(c) ? 'conditions' : 'rank', text: NO_FLOW, blocking: true });
  if (k.fin.per.on && k.fin.per.min > k.fin.per.max)
    out.push({ section: 'conditions', text: 'PER 범위의 최소가 최대보다 커요', blocking: true });
  if (k.fin.pbr.on && k.fin.pbr.min > k.fin.pbr.max)
    out.push({ section: 'conditions', text: 'PBR 범위의 최소가 최대보다 커요', blocking: true });
  if (dataInfo && !dataInfo.hasFin && usesFin(c))
    out.push({ section: finOn(c) ? 'conditions' : 'rank', text: NO_FIN, blocking: true });
  if (baskets && c.pool.baskets.some((id) => !baskets.some((b) => b.id === id)))
    out.push({ section: 'pool', text: '지워진 내 묶음이 있어요. 다시 골라 주세요', blocking: false });
  const codes = dataInfo?.themeCodes;
  if (codes && c.pool.themes.some((t) => !codes.includes(t)))
    out.push({ section: 'pool', text: '지금 데이터에 없는 테마가 있어요', blocking: false });

  const { macro, flow, fin, ...simple } = k;
  void flow;
  void fin;
  if (!macroOn(macro) && !flowOn(c) && !finOn(c) && !Object.values(simple).some((x) => x.on))
    out.push({ section: 'conditions', text: '조건이 없으면 후보 범위의 모든 종목에서 정렬 순으로 골라요', blocking: false });
  return out;
}
