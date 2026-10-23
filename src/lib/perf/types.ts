import type { Candle } from '../data/metrics';
import type { TaxMarket } from '../sim/tax';

/** 화면의 벤치마크 선택. AUTO는 종목마다 그 시장 지수다. */
export type BenchChoice = 'AUTO' | 'KOSPI' | 'KOSDAQ' | '069500' | '229200';

export const BENCH_CHOICES: readonly { id: BenchChoice; label: string }[] = [
  { id: 'AUTO', label: '자동(시장 지수)' },
  { id: 'KOSPI', label: 'KOSPI' },
  { id: 'KOSDAQ', label: 'KOSDAQ' },
  { id: '069500', label: 'KODEX 200' },
  { id: '229200', label: 'KODEX 코스닥150' },
];

/** 국내 체결 한 건(정규화한 주문). date는 체결일(KST). */
export interface Trade {
  orderId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  date: string;
  orderedAt: string;
  qty: number;
  price: number;
  amount: number;
  commission: number;
  tax: number;
}

/** 가상 매수에 쓸 벤치마크 시리즈 */
export interface BenchSeries {
  id: string;
  name: string;
  kind: 'index' | 'etf';
  /** ETF 매도세 계산용(지금 ETF 세율은 0) */
  market: TaxMarket;
  candles: Candle[];
}

export interface StockSeries {
  name: string;
  candles: Candle[];
}

/** 종목 하나의 날짜별 값과 현금흐름. 날짜 인덱스는 Timeline.days 기준. */
export interface TrackEvent {
  i: number;
  trade: Trade;
  /** 실제 현금흐름: 매수 −(금액+수수료+세금), 매도 +회수액(초과 매도분 제외) */
  actual: number;
  /** 가상 현금흐름. 비교하지 못한 거래면 null */
  virtual: number | null;
  /** 이 매도에서 기록된 수량을 넘어 뺀 수량 */
  excessQty: number;
}

export interface Track {
  symbol: string;
  name: string;
  bench: { id: string; name: string } | null;
  /** 그날 종가 기준 평가금액 */
  actual: number[];
  virtual: number[];
  events: TrackEvent[];
  /** 분할 보정을 쓴 거래가 있음 */
  splitAdjusted: boolean;
  excessQty: number;
  uncompared: number;
}

export interface Timeline {
  days: string[];
  tracks: Track[];
  /** 시세를 받지 못해 계산에서 뺀 종목 */
  missing: { symbol: string; name: string }[];
}

export interface SideSummary {
  irr: number | null;
  /** 1년 미만이면 기간 수익률, 아니면 null */
  periodReturn: number | null;
  profit: number;
  invested: number;
  endValue: number;
}

export interface SymbolRow {
  symbol: string;
  name: string;
  benchName: string | null;
  actualProfit: number;
  virtualProfit: number;
  diff: number;
  actualIrr: number | null;
  trades: Trade[];
  splitAdjusted: boolean;
  excessQty: number;
  uncompared: number;
}

export interface CurvePoint {
  date: string;
  /** 평가금액 + 이 구간에서 회수한 돈 */
  actual: number;
  virtual: number;
  /** 구간 시작 평가금액 + 이 구간 매수액 */
  invested: number;
}

export interface PerfView {
  from: string;
  to: string;
  days: number;
  actual: SideSummary;
  virtual: SideSummary;
  excessIrrPp: number | null;
  excessProfit: number;
  curve: CurvePoint[];
  rows: SymbolRow[];
}
