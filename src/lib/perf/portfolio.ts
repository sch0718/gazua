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
/** 매도가 남은 단위를 이만큼 이내로만 넘으면 전량 매도로 본다(부동소수점 오차) */
const UNIT_EPS = 1e-9;
/** 분할 배율 후보의 간격. 앞에 있을수록 둥근 수다(50:1 분할, 2:1 분할, 0.5주 무상증자 1.5배 …) */
const ROUND_STEPS = [100, 50, 25, 20, 10, 5, 2, 1, 0.5, 0.25, 0.2, 0.1];

/** [lo, hi] 안의 가장 둥근 수(ROUND_STEPS 순서). 같은 간격이면 est에 가장 가까운 것. 없으면 null */
function roundest(lo: number, hi: number, est: number): number | null {
  for (const step of ROUND_STEPS) {
    const first = Math.ceil(lo / step - 1e-9);
    const last = Math.floor(hi / step + 1e-9);
    if (first > last || last <= 0) continue;
    const n = Math.min(last, Math.max(first, Math.round(est / step), 1));
    return Math.round(n * step * 1e6) / 1e6;
  }
  return null;
}

/**
 * 그날 실제 체결 1주가 수정주가 기준 몇 단위인지(스펙 2.6). 배율은 그날의 권리 변동이라 같은 날 체결은 모두 같은 값을 쓴다.
 * 체결가가 모두 그날 수정 일봉 범위(여유 3%) 안이면 1. 아니면 체결마다 [체결가 ÷ (고가 × 1.03), 체결가 ÷ (저가 × 0.97)]의
 * 공통 구간(없으면 합친 구간)에서 가장 둥근 비율을 쓴다(50:1 분할이면 체결가가 조금 달라도 50). 1보다 작으면(병합) 역수로
 * 찾아 1:3 병합이 정확히 1/3이 된다. 맞는 비율이 없으면 체결가 ÷ 종가의 기하평균.
 */
export function splitFactorForDay(prices: number[], bar: Candle | undefined): number {
  if (!bar || prices.length === 0) return 1;
  const los = prices.map((p) => p / (bar.h * (1 + SPLIT_MARGIN)));
  const his = prices.map((p) => p / (bar.l * (1 - SPLIT_MARGIN)));
  let lo = Math.max(...los);
  let hi = Math.min(...his);
  if (lo > hi) {
    lo = Math.min(...los);
    hi = Math.max(...his);
  }
  if (lo <= 1 && 1 <= hi) return 1;
  const est = Math.exp(prices.reduce((x, p) => x + Math.log(p / bar.c), 0) / prices.length);
  if (hi < 1) {
    const inv = roundest(1 / hi, 1 / lo, 1 / est);
    return inv === null ? est : 1 / inv;
  }
  return roundest(lo, hi, est) ?? est;
}

/** 체결 하나만 볼 때의 배율(splitFactorForDay와 같은 규칙) */
export const splitFactor = (price: number, bar: Candle | undefined): number => splitFactorForDay([price], bar);

/** 종목·날짜마다 그날 체결로 배율을 정한다(키 `종목|날짜`) */
function dayFactors(trades: Trade[], barOf: (symbol: string, date: string) => Candle | undefined): Map<string, number> {
  const prices = new Map<string, number[]>();
  for (const t of trades) {
    const k = `${t.symbol}|${t.date}`;
    prices.set(k, [...(prices.get(k) ?? []), t.price]);
  }
  const out = new Map<string, number>();
  for (const [k, ps] of prices) {
    const [symbol, date] = k.split('|');
    out.set(k, splitFactorForDay(ps, barOf(symbol, date)));
  }
  return out;
}

/** 체결마다 분할 배율(orderId → 배율). 시세가 없는 종목은 1. 수량 대조가 같은 단위로 세려고 쓴다 */
export function splitFactors(trades: Trade[], stocks: Map<string, StockSeries>): Map<string, number> {
  const bars = new Map<string, Map<string, Candle>>();
  const barOf = (symbol: string, date: string) => {
    let byDate = bars.get(symbol);
    if (!byDate) {
      byDate = new Map((stocks.get(symbol)?.candles ?? []).map((c) => [kstDate(c.t), c]));
      bars.set(symbol, byDate);
    }
    return byDate.get(date);
  };
  const byDay = dayFactors(trades, barOf);
  return new Map(trades.map((t) => [t.orderId, byDay.get(`${t.symbol}|${t.date}`) ?? 1]));
}

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
    const factors = dayFactors(list, (_s, date) => px.bar(date));

    // 보유는 수정주가 기준 단위로만 센다. 분할 전에 산 10주(배율 2)와 분할 뒤에 판 20주(배율 1)가 같은 20단위다
    let units = 0;
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
          const factor = factors.get(`${symbol}|${day}`) ?? 1;
          if (factor !== 1) splitAdjusted = true;
          units += t.qty * factor;
          let v: number | null = null;
          if (bench && bp !== null) {
            vUnits += bench.kind === 'index' ? cost / bp : cost / (bp * (1 + feeRateOf(t)));
            v = -cost;
          } else uncompared++;
          events.push({ i, trade: t, actual: -cost, virtual: v, excessQty: 0 });
        } else {
          const factor = factors.get(`${symbol}|${day}`) ?? 1;
          if (factor !== 1) splitAdjusted = true;
          const want = t.qty * factor;
          // 남은 단위를 오차 이내로만 넘으면 전량 매도
          const full = units > 0 && want >= units * (1 - UNIT_EPS);
          const sold = full ? units : Math.min(want, units);
          // 기록된 수량을 넘은 몫(이 매도의 주식 수 기준). 오차는 버린다
          const excess = full && want <= units * (1 + UNIT_EPS) ? 0 : Math.max(0, Math.round(((want - sold) / factor) * 1e6) / 1e6);
          excessQty += excess;
          const share = want > 0 ? Math.min(1, sold / want) : 0;
          const proceeds = roundMoney((t.amount - t.commission - t.tax) * share);
          const f = full ? 1 : units > 0 ? sold / units : 0;
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
          units = f >= 1 ? 0 : units - sold;
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
