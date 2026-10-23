// 실제 포트폴리오와 가상(벤치마크) 포트폴리오의 날짜별 평가금액과 현금흐름. 스펙 3.1–3.3.
// 종목마다 그림자 포지션을 하나씩 두어, 종목별 기여도를 그대로 더할 수 있게 한다.
import type { Candle } from '../data/metrics';
import { roundMoney } from '../sim/money';
import { sellTaxPct } from '../sim/tax';
import { kstDate } from '../time/kst';
import type { BenchSeries, StockSeries, Timeline, Track, TrackEvent, Trade } from './types';

/** 실제 주문에 수수료가 없을 때 ETF 가상 매매에 쓰는 수수료율(시뮬레이션 기본 0.015%) */
export const DEFAULT_FEE_RATE = 0.00015;
/** 체결가가 그날 수정 일봉의 [저가 × 0.97, 고가 × 1.03] 밖이면 분할로 본다(스펙 2.6) */
const SPLIT_MARGIN = 0.03;

/** 날짜 → 종가 조회. 그날 봉이 없으면 직전 종가, 그 전 봉도 없으면 처음 종가. 봉이 없으면 null. */
function closeLookup(candles: Candle[]): { at(date: string): number | null; bar(date: string): Candle | undefined } {
  const bars = [...candles].sort((a, b) => a.t - b.t);
  const dates = bars.map((c) => kstDate(c.t));
  const byDate = new Map(dates.map((d, i) => [d, bars[i]]));
  return {
    at(date) {
      if (bars.length === 0) return null;
      // date 이하인 마지막 봉(이분 탐색)
      let lo = 0;
      let hi = dates.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (dates[mid] <= date) lo = mid + 1;
        else hi = mid;
      }
      return lo === 0 ? bars[0].c : bars[lo - 1].c;
    },
    bar: (date) => byDate.get(date),
  };
}

const feeRateOf = (t: Trade): number => (t.amount > 0 && t.commission > 0 ? t.commission / t.amount : DEFAULT_FEE_RATE);

/**
 * trades는 normalizeOrders의 순서(날짜, 같은 날은 매수 먼저)를 따른다.
 * benchOf가 null이거나 봉이 없는 벤치마크면 그 종목의 거래는 가상 계산에서 빠진다(uncompared).
 */
export function buildTimeline(
  trades: Trade[],
  stocks: Map<string, StockSeries>,
  benchOf: (symbol: string) => BenchSeries | null,
  opts: { names?: Map<string, string> } = {},
): Timeline {
  const missing: Timeline['missing'] = [];
  const bySymbol = new Map<string, Trade[]>();
  for (const t of trades) {
    if (!stocks.has(t.symbol) || stocks.get(t.symbol)!.candles.length === 0) {
      if (!missing.some((m) => m.symbol === t.symbol)) {
        missing.push({ symbol: t.symbol, name: stocks.get(t.symbol)?.name ?? opts.names?.get(t.symbol) ?? t.symbol });
      }
      continue;
    }
    const list = bySymbol.get(t.symbol) ?? [];
    list.push(t);
    bySymbol.set(t.symbol, list);
  }
  if (bySymbol.size === 0) return { days: [], tracks: [], missing };

  // 거래일 축: 첫 체결일부터 받은 봉의 마지막 날까지, 종목·벤치마크 봉 날짜와 체결일의 합집합
  const first = [...bySymbol.values()].reduce((m, l) => (l[0].date < m ? l[0].date : m), '9999-12-31');
  const set = new Set<string>();
  const benches = new Map<string, BenchSeries | null>();
  for (const [symbol, list] of bySymbol) {
    for (const t of list) set.add(t.date);
    for (const c of stocks.get(symbol)!.candles) set.add(kstDate(c.t));
    const b = benchOf(symbol);
    benches.set(symbol, b);
    if (b) for (const c of b.candles) set.add(kstDate(c.t));
  }
  const days = [...set].filter((d) => d >= first).sort();
  const dayIndex = new Map(days.map((d, i) => [d, i]));

  const tracks: Track[] = [];
  for (const [symbol, list] of bySymbol) {
    const stock = stocks.get(symbol)!;
    const px = closeLookup(stock.candles);
    const bench = benches.get(symbol) ?? null;
    const bpx = bench && bench.candles.length > 0 ? closeLookup(bench.candles) : null;

    let units = 0; // 수정주가 기준 보유 단위
    let qty = 0; // 기록된 실제 보유 수량
    let vUnits = 0;
    let splitAdjusted = false;
    let excessQty = 0;
    let uncompared = 0;
    const events: TrackEvent[] = [];
    const actual: number[] = [];
    const virtual: number[] = [];
    let k = 0;

    for (let i = 0; i < days.length; i++) {
      const day = days[i];
      for (; k < list.length && dayIndex.get(list[k].date) === i; k++) {
        const t = list[k];
        const bp = bpx?.at(day) ?? null;
        if (t.side === 'BUY') {
          const cost = t.amount + t.commission + t.tax;
          const b = px.bar(day);
          let factor = 1;
          if (b && (t.price < b.l * (1 - SPLIT_MARGIN) || t.price > b.h * (1 + SPLIT_MARGIN))) {
            factor = t.price / b.c;
            splitAdjusted = true;
          }
          units += t.qty * factor;
          qty += t.qty;
          let v: number | null = null;
          if (bench && bp !== null) {
            vUnits += bench.kind === 'index' ? cost / bp : cost / (bp * (1 + feeRateOf(t)));
            v = -cost;
          } else uncompared++;
          events.push({ i, trade: t, actual: -cost, virtual: v, excessQty: 0 });
        } else {
          const sold = Math.min(t.qty, qty);
          const excess = t.qty - sold;
          excessQty += excess;
          const share = t.qty > 0 ? sold / t.qty : 0;
          const proceeds = roundMoney((t.amount - t.commission - t.tax) * share);
          const f = qty > 0 ? sold / qty : 0;
          let v: number | null = null;
          if (bench && bp !== null) {
            const soldUnits = f >= 1 ? vUnits : vUnits * f;
            const gross = soldUnits * bp;
            v =
              bench.kind === 'index'
                ? gross
                : gross - gross * feeRateOf(t) - (gross * sellTaxPct(day, bench.market, true)) / 100;
            vUnits = f >= 1 ? 0 : vUnits - soldUnits;
          } else uncompared++;
          units = f >= 1 ? 0 : units * (1 - f);
          qty -= sold;
          events.push({ i, trade: t, actual: proceeds, virtual: v, excessQty: excess });
        }
      }
      const close = px.at(day) ?? 0;
      actual.push(roundMoney(units * close));
      virtual.push(bpx ? roundMoney(vUnits * (bpx.at(day) ?? 0)) : 0);
    }

    tracks.push({
      symbol,
      name: stock.name,
      bench: bench ? { id: bench.id, name: bench.name } : null,
      actual,
      virtual,
      events,
      splitAdjusted,
      excessQty,
      uncompared,
    });
  }
  return { days, tracks, missing };
}
