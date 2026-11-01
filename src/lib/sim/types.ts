import type { Candle } from '../data/metrics';
import type { StrategyV2 } from './strategyV2';
export type { Cond, CondGroup, PatternEntry, SizingMode } from './strategyV2';
export type { StrategyV1 } from './strategyV1';

export type StopBasis = 'avgAfterScaleIn' | 'avgAlways' | 'firstBuy';

/** 앱 전략(v2, 전략 빌더 스펙 §3). 옛 형식은 StrategyV1(strategyV1.ts)이고 읽을 때 toV2로 옮긴다 */
export type Strategy = StrategyV2;

export interface PatternSnapshot {
  a: number;
  aDate: string;
  b: number;
  l: number;
  lDate: string;
}

export interface SimInput {
  strategy: Strategy;
  days: string[]; // 거래일 축(시작~끝), 오름차순
  stocks: { symbol: string; name: string; market: 'KOSPI' | 'KOSDAQ' | 'KR_ETC'; isEtf: boolean; candles: Candle[]; buyWindows?: { from: string; to: string }[] }[]; // 그룹 순서, 워밍업 포함. buyWindows(양끝 포함)가 있으면 그 안에서만 매수
  index: { id: 'KOSPI' | 'KOSDAQ'; candles: Candle[] } | null;
  benchmarkStock: {
    symbol: string;
    name: string;
    isEtf: boolean;
    market: 'KOSPI' | 'KOSDAQ' | 'KR_ETC';
    candles: Candle[];
  } | null;
}

export interface Trade {
  date: string;
  symbol: string;
  kind: 'buy' | 'add' | 'take' | 'stop' | 'gapStop' | 'gapTake' | 'trail' | 'time' | 'signalSell'; // 뒤 3종은 전략 빌더(트레일링·기간 청산·조건 매도)
  stage?: number; // 익절 단계(1부터)
  price: number;
  qty: number;
  fee: number;
  tax: number;
  reason: string;
  pnlPct?: number; // 매도 줄: 평균 단가 대비
  pattern?: PatternSnapshot; // 매수 줄
}

export interface Skip {
  date: string;
  symbol: string;
  reason: '현금 부족' | '1주가 1회 금액보다 비쌈' | '거래 없음' | '선정 기간이 아니에요';
}

export interface SimResult {
  equity: { date: string; strategy: number; hold: number; index: number | null; benchmark: number | null; cash: number }[];
  summary: {
    totalReturnPct: number;
    cagrPct: number;
    mddPct: number;
    winRatePct: number | null;
    wins: number;
    losses: number;
    avgWinPct: number | null;
    avgLossPct: number | null;
    roundTrips: number;
    openPositions: number;
    avgHoldDays: number | null;
    avgCashPct: number;
    skippedSignals: number;
    vsHoldPp: number;
    vsIndexPp: number | null;
    vsBenchmarkPp: number | null; // 총수익률 차이(%p)
  };
  benchmarks: { holdReturnPct: number; indexReturnPct: number | null; benchmarkReturnPct: number | null };
  trades: Trade[]; // 날짜 오름차순, 같은 날은 체결 순
  skipped: Skip[];
  perSymbol: { symbol: string; name: string; pnl: number; roundTrips: number; firstDate: string | null }[];
  nearMiss: { maxDropPct: number; declineDays: number } | null; // 거래가 하나도 없을 때만
  /** 재생용 일별 상태. equity와 같은 길이·같은 날짜. 옵션을 켠 실행에만 있고, 공유에서 복원한 결과에는 없음 */
  timeline?: DayFrame[];
}

/** 그날 종가 처리를 마친 뒤 보유 한 종목의 상태(재생 패널). 손절·추가·익절 가격은 다음 거래일 장중 경로에 쓰이는 값 */
export interface HoldingFrame {
  symbol: string;
  qty: number;
  avgPrice: number; // Position.avgPrice
  close: number; // 그날 종가, 봉이 없는 날은 마지막 종가
  value: number; // roundMoney(qty × close), equity 계산과 같은 값
  pnlPct: number; // (close / avgPrice − 1) × 100
  stop: number | null; // Position.stopPrice()
  trail: number | null; // Position.trailPrice(), 다음 거래일 트레일 가격. 꺼지면 null
  nextAdd: number | null; // Position.nextAddPrice(), 그날 건너뛴 가격이어도 그대로
  takes: { stage: number; price: number }[]; // Position.takeLevels() 중 qty > 0
  openDate: string; // 이번 포지션의 첫 매수일
  heldDays: number; // 시장 축 보유 거래일, 매수일 = 1(기간 청산과 같은 셈)
}

export interface DayFrame {
  date: string;
  cash: number; // equity[i].cash와 같음
  value: number; // equity[i].strategy와 같음
  holdings: HoldingFrame[]; // 그룹 순서, 보유 중인 종목만
  pending: { symbol: string; reason: string }[]; // 그날 종가 신호 → 다음 거래일 시가 매수 예약
  pendingSells: { symbol: string; reason: string }[]; // 그날 종가 → 다음 거래일 시가 매도 예약(조건 매도·기간 청산)
}
