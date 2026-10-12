import type { Candle } from '../data/metrics';
import type { MarketDataProvider, StockMeta } from '../providers/types';
import { addDays, kstDate } from '../time/kst';
import type { SimInput, Strategy } from './types';

export interface SimMemo {
  get(key: string): Candle[] | undefined;
  set(key: string, v: Candle[]): void;
  clear(): void;
}

export function createSimMemo(): SimMemo {
  const m = new Map<string, Candle[]>();
  return { get: (k) => m.get(k), set: (k, v) => void m.set(k, v), clear: () => m.clear() };
}

export type LoadProgress = { done: number; total: number; waiting: boolean };

export type LoadOutcome =
  | {
      ok: true;
      input: SimInput;
      failed: { symbol: string; reason: string }[];
      venueLabel: 'KRX 일봉' | '통합 일봉';
      fetchedAt: number;
      clampedTo: string | null;
      indexFailed: null | '받지 못했어요' | '기간 일부만 받았어요';
      benchmarkFailed: boolean;
    }
  | { ok: false; error: unknown } // 첫 요청(메타)부터 실패 = 연결 문제
  | { ok: false; cancelled: true }
  | { ok: false; noData: true };

const WAITING_MS = 3000;
const PRIORITY = 2;

class Cancelled extends Error {}

/** 켜진 조건 중 가장 긴 이동평균 기간. 없으면 0. */
function longestMa(s: Strategy): number {
  const { triggers, filter } = s.entry;
  const periods = [0];
  if (triggers.maCross.on) periods.push(triggers.maCross.period);
  if (triggers.goldenCross.on) periods.push(triggers.goldenCross.short, triggers.goldenCross.long);
  if (filter.aboveMa.on) periods.push(filter.aboveMa.period);
  return Math.max(...periods);
}

export async function loadSimData(args: {
  provider: MarketDataProvider;
  strategy: Strategy;
  symbols: string[];
  now: number;
  memo: SimMemo;
  onProgress: (p: LoadProgress) => void;
  isCancelled: () => boolean;
}): Promise<LoadOutcome> {
  const { provider, strategy, symbols, now, memo, onProgress, isCancelled } = args;
  const { from } = strategy.period;
  const today = kstDate(now);
  const clampedTo = strategy.period.to >= today ? addDays(today, -1) : null;
  const to = clampedTo ?? strategy.period.to;
  const warmFrom = addDays(from, -Math.max(400, Math.ceil(longestMa(strategy) * 1.6)));
  const venue = provider.capabilities.venues.includes('KRX') ? 'KRX' : provider.capabilities.venues[0];
  const venueLabel = venue === 'KRX' ? 'KRX 일봉' : '통합 일봉';
  const benchSymbol = strategy.benchmarks.symbol;
  const total = 3 + symbols.length;
  let done = 0;
  const report = (waiting = false) => onProgress({ done, total, waiting });

  // 요청 하나: 앞뒤로 취소를 확인하고, 3초 넘게 걸리면 waiting 표시
  async function request<T>(fn: () => Promise<T>): Promise<T> {
    if (isCancelled()) throw new Cancelled();
    let waiting = false;
    const timer = setTimeout(() => {
      waiting = true;
      report(true);
    }, WAITING_MS);
    try {
      const r = await fn();
      if (isCancelled()) throw new Cancelled();
      return r;
    } finally {
      clearTimeout(timer);
      if (waiting) report(false);
    }
  }
  const step = () => {
    done += 1;
    report();
  };

  const memoKey = (symbol: string) => `${provider.id}|${symbol}|${venue}|${warmFrom}|${to}`;
  async function fetchStock(symbol: string): Promise<Candle[]> {
    const key = memoKey(symbol);
    const hit = memo.get(key);
    if (hit) {
      if (isCancelled()) throw new Cancelled();
      return hit;
    }
    const candles = await request(() =>
      provider.getCandles({ symbol, venue, interval: '1d', from: warmFrom, to, priority: PRIORITY }),
    );
    if (candles.some((c) => inRange(c))) memo.set(key, candles);
    return candles;
  }
  const inRange = (c: Candle) => {
    const d = kstDate(c.t);
    return d >= from && d <= to;
  };

  try {
    report();

    // 1. 메타
    let metas: StockMeta[];
    try {
      const wanted = benchSymbol && !symbols.includes(benchSymbol) ? [...symbols, benchSymbol] : symbols;
      metas = await request(() => provider.getStockMeta(wanted));
    } catch (e) {
      if (e instanceof Cancelled) throw e;
      return { ok: false, error: e };
    }
    const metaOf = new Map(metas.map((m) => [m.symbol, m]));
    step();

    // 2. 지수
    let indexCandles: Candle[] | null = null;
    let indexFailed: null | '받지 못했어요' | '기간 일부만 받았어요' = null;
    let indexBars: Candle[] = [];
    try {
      if (!provider.getIndexCandles) throw new Error('지수 일봉을 지원하지 않는 공급자');
      const getIndex = provider.getIndexCandles.bind(provider);
      indexBars = (await request(() => getIndex(strategy.benchmarks.index, '1d', from, to, PRIORITY))).filter(inRange);
    } catch (e) {
      if (e instanceof Cancelled) throw e;
      indexFailed = '받지 못했어요';
    }
    step();

    // 3. 지정 종목
    let benchmarkStock: SimInput['benchmarkStock'] = null;
    let benchmarkFailed = false;
    if (benchSymbol) {
      const meta = metaOf.get(benchSymbol);
      try {
        const candles = meta ? await fetchStock(benchSymbol) : [];
        if (candles.some(inRange)) {
          benchmarkStock = {
            symbol: benchSymbol,
            name: meta!.name,
            isEtf: meta!.securityType === 'ETF',
            market: meta!.market,
            candles,
          };
        } else {
          benchmarkFailed = true;
        }
      } catch (e) {
        if (e instanceof Cancelled) throw e;
        benchmarkFailed = true;
      }
    }
    step();

    // 4. 종목들
    const failed: { symbol: string; reason: string }[] = [];
    const stocks: SimInput['stocks'] = [];
    for (const symbol of symbols) {
      const meta = metaOf.get(symbol);
      try {
        if (!meta) {
          failed.push({ symbol, reason: '종목 정보를 받지 못했어요' });
        } else {
          const candles = await fetchStock(symbol);
          if (candles.some(inRange)) {
            stocks.push({
              symbol,
              name: meta.name,
              market: meta.market,
              isEtf: meta.securityType === 'ETF',
              candles,
            });
          } else {
            failed.push({ symbol, reason: '기간 안에 데이터가 없어요' });
          }
        }
      } catch (e) {
        if (e instanceof Cancelled) throw e;
        failed.push({ symbol, reason: '받지 못했어요' });
      }
      step();
    }

    // 거래일 축 = 지수 날짜 ∪ 종목 날짜
    const set = new Set<string>();
    for (const c of indexBars) set.add(kstDate(c.t));
    for (const s of stocks) for (const c of s.candles) if (inRange(c)) set.add(kstDate(c.t));
    const days = [...set].sort();
    if (days.length === 0) return { ok: false, noData: true };

    // 지수는 축의 첫날·마지막 날 봉이 모두 있을 때만 비교 기준으로 쓴다
    if (!indexFailed) {
      const have = new Set(indexBars.map((c) => kstDate(c.t)));
      if (have.has(days[0]) && have.has(days[days.length - 1])) indexCandles = indexBars;
      else indexFailed = '기간 일부만 받았어요';
    }

    return {
      ok: true,
      input: {
        strategy,
        days,
        stocks,
        index: indexCandles ? { id: strategy.benchmarks.index, candles: indexCandles } : null,
        benchmarkStock,
      },
      failed,
      venueLabel,
      fetchedAt: now,
      clampedTo,
      indexFailed,
      benchmarkFailed,
    };
  } catch (e) {
    if (e instanceof Cancelled) return { ok: false, cancelled: true };
    throw e;
  }
}
