// 벤치마크 선택 → 종목별 벤치마크 시리즈. 스펙 3.3.
import type { StockMeta } from '../providers/types';
import { BENCH_CHOICES, type BenchChoice, type BenchSeries } from './types';

export const INDEX_IDS = ['KOSPI', 'KOSDAQ'] as const;
export type IndexId = (typeof INDEX_IDS)[number];

const isIndex = (id: string): id is IndexId => id === 'KOSPI' || id === 'KOSDAQ';

/** 이 선택에 필요한 시리즈 id. 자동이면 두 지수 */
export function benchIdsFor(choice: BenchChoice): string[] {
  return choice === 'AUTO' ? [...INDEX_IDS] : [choice];
}

export const benchLabel = (choice: BenchChoice): string => BENCH_CHOICES.find((c) => c.id === choice)?.label ?? choice;

/** 시리즈 하나의 모양(봉은 받은 뒤 채운다). ETF의 시장은 매도세 계산용 */
export function benchShell(id: string): Omit<BenchSeries, 'candles'> {
  if (isIndex(id)) return { id, name: id, kind: 'index', market: id };
  return { id, name: benchLabel(id as BenchChoice), kind: 'etf', market: id === '229200' ? 'KOSDAQ' : 'KOSPI' };
}

/** 자동이면 종목 시장의 지수(KOSDAQ이면 KOSDAQ, 그 밖은 KOSPI), 아니면 고른 하나. 받지 못한 시리즈면 null */
export function benchOfFor(
  choice: BenchChoice,
  metas: Map<string, StockMeta>,
  series: Map<string, BenchSeries>,
): (symbol: string) => BenchSeries | null {
  return (symbol) => {
    const id = choice === 'AUTO' ? (metas.get(symbol)?.market === 'KOSDAQ' ? 'KOSDAQ' : 'KOSPI') : choice;
    return series.get(id) ?? null;
  };
}
