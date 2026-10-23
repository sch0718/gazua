// 거래일 축의 구간 [a, b](전체 또는 한 해)에 대한 요약·곡선·종목별 기여도. 스펙 3.5–3.6.
// 구간 시작 전날의 평가금액을 첫 현금흐름(나간 돈)으로, 끝날 평가금액을 마지막 흐름으로 둔다.
import { roundMoney } from '../sim/money';
import type { CurvePoint, PerfView, SideSummary, SymbolRow, Timeline, Track } from './types';
import { daysBetween, periodReturn, xirr, type Flow } from './xirr';

export interface PeriodRange {
  id: string;
  label: string;
  a: number;
  b: number;
}

/** `전체`와 데이터가 있는 해들(최근 해가 앞) */
export function periodRanges(days: string[]): PeriodRange[] {
  if (days.length === 0) return [];
  const years: PeriodRange[] = [];
  for (let i = 0; i < days.length; i++) {
    const y = days[i].slice(0, 4);
    const last = years.at(-1);
    if (last?.id === y) last.b = i;
    else years.push({ id: y, label: y, a: i, b: i });
  }
  return [{ id: 'all', label: '전체', a: 0, b: days.length - 1 }, ...years.reverse()];
}

interface Side {
  start: number;
  end: number;
  invested: number;
  proceeds: number;
  flows: Flow[];
}

function sideOf(t: Track, days: string[], a: number, b: number, which: 'actual' | 'virtual'): Side {
  const values = t[which];
  const start = a > 0 ? values[a - 1] : 0;
  const s: Side = { start, end: values[b], invested: start, proceeds: 0, flows: [] };
  if (start > 0) s.flows.push({ date: days[a], amount: -start });
  for (const e of t.events) {
    if (e.i < a || e.i > b) continue;
    const cf = e[which];
    if (cf === null || cf === 0) continue;
    s.flows.push({ date: days[e.i], amount: cf });
    if (cf < 0) s.invested -= cf;
    else s.proceeds += cf;
  }
  if (s.end > 0) s.flows.push({ date: days[b], amount: s.end });
  return s;
}

const profitOf = (s: Side) => roundMoney(s.end + s.proceeds - s.invested);

function summary(sides: Side[], span: number): SideSummary {
  const flows = sides.flatMap((s) => s.flows);
  const irr = xirr(flows);
  return {
    irr,
    periodReturn: irr !== null && span < 365 ? periodReturn(irr, span) : null,
    profit: roundMoney(sides.reduce((x, s) => x + profitOf(s), 0)),
    invested: roundMoney(sides.reduce((x, s) => x + s.invested, 0)),
    endValue: roundMoney(sides.reduce((x, s) => x + s.end, 0)),
  };
}

export function viewOf(tl: Timeline, a: number, b: number): PerfView {
  const { days } = tl;
  const span = daysBetween(days[a], days[b]);
  const used = tl.tracks.filter(
    (t) =>
      t.events.some((e) => e.i >= a && e.i <= b) ||
      (a > 0 && (t.actual[a - 1] > 0 || t.virtual[a - 1] > 0)) ||
      t.actual[b] > 0 ||
      t.virtual[b] > 0,
  );
  const sides = used.map((t) => ({ t, act: sideOf(t, days, a, b, 'actual'), vir: sideOf(t, days, a, b, 'virtual') }));
  const actual = summary(
    sides.map((s) => s.act),
    span,
  );
  const virtual = summary(
    sides.map((s) => s.vir),
    span,
  );

  const rows: SymbolRow[] = sides
    .map(({ t, act, vir }) => {
      const actualProfit = profitOf(act);
      const virtualProfit = profitOf(vir);
      const inRange = t.events.filter((e) => e.i >= a && e.i <= b);
      return {
        symbol: t.symbol,
        name: t.name,
        benchName: t.bench?.name ?? null,
        actualProfit,
        virtualProfit,
        diff: roundMoney(actualProfit - virtualProfit),
        actualIrr: xirr(act.flows),
        trades: inRange.map((e) => e.trade),
        splitAdjusted: t.splitAdjusted,
        excessQty: inRange.reduce((x, e) => x + e.excessQty, 0),
        uncompared: inRange.filter((e) => e.virtual === null).length,
      };
    })
    .sort((x, y) => y.diff - x.diff || x.symbol.localeCompare(y.symbol));

  // 곡선: 그날 평가금액 + 구간 안에서 회수한 돈, 그리고 구간 시작 평가금액 + 구간 안 매수액
  const curve: CurvePoint[] = [];
  let outA = 0;
  let outV = 0;
  let invested = sides.reduce((x, s) => x + s.act.start, 0);
  const byDay = new Map<number, Track['events']>();
  for (const { t } of sides) for (const e of t.events) if (e.i >= a && e.i <= b) byDay.set(e.i, [...(byDay.get(e.i) ?? []), e]);
  for (let i = a; i <= b; i++) {
    for (const e of byDay.get(i) ?? []) {
      if (e.actual > 0) outA += e.actual;
      else invested -= e.actual;
      if (e.virtual !== null && e.virtual > 0) outV += e.virtual;
    }
    curve.push({
      date: days[i],
      actual: roundMoney(used.reduce((x, t) => x + t.actual[i], 0) + outA),
      virtual: roundMoney(used.reduce((x, t) => x + t.virtual[i], 0) + outV),
      invested: roundMoney(invested),
    });
  }

  return {
    from: days[a],
    to: days[b],
    days: span,
    actual,
    virtual,
    excessIrrPp: actual.irr !== null && virtual.irr !== null ? (actual.irr - virtual.irr) * 100 : null,
    excessProfit: roundMoney(actual.profit - virtual.profit),
    curve,
    rows,
  };
}
