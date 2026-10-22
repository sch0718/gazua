// 조건으로 골라 새 그룹 만들기: 후보 종목마다 비교 화면과 같은 방식으로 지표를 계산해 순위를 매긴다.
// 값은 기간 안 지표 점의 마지막 값(비교 화면 리더보드가 장 마감 뒤 보여 주는 값과 같다).
import type { MarketDataProvider, StockMeta } from '../providers/types';
import type { VenueMode } from '../market/tradable';
import type { MetricId, Period, Settings } from '../state/schema';
import { loadIndexSeries, loadSeries, type DailyMemo, type LoadedSeries } from './candleService';
import type { CandleCache } from './candleCache';
import { metricPoints } from './seriesMetrics';

/** 기간 일봉만으로 계산되는 지표(변동성·RSI는 비교 화면에서도 따로 계산해 여기서는 빼 둔다). */
export const RANK_METRICS = ['excess', 'change', 'drawdown', 'rvol', 'mcap'] as const satisfies readonly MetricId[];
export type RankMetric = (typeof RANK_METRICS)[number];

export interface RankRow {
  symbol: string;
  value: number | null;
  /** 값이 없을 때 이유 */
  reason?: string;
}

export interface RankArgs {
  provider: MarketDataProvider;
  cache: CandleCache;
  memo: DailyMemo;
  now: number;
  venueMode: VenueMode;
  benchmark: Settings['benchmark'];
  symbols: string[];
  metric: RankMetric;
  period: Period;
  /** 후보 하나가 끝날 때마다(성공·실패 모두) 끝난 수 */
  onProgress?: (done: number, total: number) => void;
}

const lastValue = (points: { v: number | null }[]): number | null => {
  for (let i = points.length - 1; i >= 0; i--) {
    const v = points[i].v;
    if (v !== null && Number.isFinite(v)) return v;
  }
  return null;
};

/** 비교 화면과 같은 규칙: 벤치마크가 자동이면 종목 시장(코스닥이 아니면 코스피). */
const indexOf = (meta: StockMeta, benchmark: Settings['benchmark']): 'KOSPI' | 'KOSDAQ' =>
  benchmark !== 'AUTO' ? benchmark : meta.market === 'KOSDAQ' ? 'KOSDAQ' : 'KOSPI';

/** 후보 순서대로 결과를 돌려준다. 한 종목이 실패해도 나머지는 계속한다. */
export async function rankCandidates(args: RankArgs): Promise<RankRow[]> {
  const { provider, cache, memo, now, period, metric } = args;
  const symbols = [...new Set(args.symbols)];
  const metas = new Map((await provider.getStockMeta(symbols)).map((m) => [m.symbol, m]));

  // 초과수익은 필요한 지수만 한 번씩 받는다.
  const indices = new Map<'KOSPI' | 'KOSDAQ', Promise<LoadedSeries | null>>();
  const indexFor = (meta: StockMeta) => {
    const name = indexOf(meta, args.benchmark);
    let p = indices.get(name);
    if (!p) {
      p = loadIndexSeries({ provider, cache, index: name, period, now }).catch(() => null);
      indices.set(name, p);
    }
    return p;
  };

  let done = 0;
  const finish = (row: RankRow): RankRow => {
    done++;
    args.onProgress?.(done, symbols.length);
    return row;
  };

  return Promise.all(
    symbols.map(async (symbol): Promise<RankRow> => {
      const meta = metas.get(symbol);
      if (!meta) return finish({ symbol, value: null, reason: '종목 정보를 받지 못했어요' });
      try {
        const series = await loadSeries({ provider, cache, memo, meta, period, venueMode: args.venueMode, now });
        const index = metric === 'excess' ? await indexFor(meta) : null;
        if (metric === 'excess' && !index) return finish({ symbol, value: null, reason: '지수를 받지 못했어요' });
        const value = lastValue(metricPoints(series, metric, { period, index }));
        return finish(value === null ? { symbol, value: null, reason: '값을 계산할 수 없어요' } : { symbol, value });
      } catch {
        return finish({ symbol, value: null, reason: '불러오지 못했어요' });
      }
    }),
  );
}

/** 큰 순(desc)·작은 순(asc). 값이 같으면 후보 순서를 지키고, 값이 없는 종목은 맨 뒤. */
export function orderRanked(rows: RankRow[], direction: 'desc' | 'asc'): RankRow[] {
  const sign = direction === 'desc' ? -1 : 1;
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const av = a.r.value;
      const bv = b.r.value;
      if (av === null || bv === null) return av === bv ? a.i - b.i : av === null ? 1 : -1;
      return sign * (av - bv) || a.i - b.i;
    })
    .map((x) => x.r);
}
