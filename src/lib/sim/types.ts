import type { Candle } from '../data/metrics';

export type StopBasis = 'avgAfterScaleIn' | 'avgAlways' | 'firstBuy';

export interface Strategy {
  id: string;
  name: string; // 30자 이내
  updatedAt: number;
  universe: { kind: 'group'; groupId: string } | { kind: 'symbols'; symbols: string[] }; // 최대 8종목
  period: { from: string; to: string }; // KST YYYY-MM-DD, 양끝 포함
  capital: { initial: number; perBuyPct: number };
  entry: {
    decline: {
      dropPct: { on: boolean; value: number };
      days: { on: boolean; value: number };
    };
    triggers: {
      reboundDays: { on: boolean; value: number };
      breakout: { on: boolean; level: 'A' | 'B' };
      maCross: { on: boolean; period: number };
      goldenCross: { on: boolean; short: number; long: number };
    };
    filter: { aboveMa: { on: boolean; period: number } };
  };
  scaleIn: { on: boolean; stepPct: number; maxAdds: number };
  exit: {
    takeProfit: { pct: number; sellPct: number }[]; // 1~3단계, 마지막 단계 sellPct = 100
    stopLoss: { pct: number; basis: StopBasis };
    afterFirstTake: 'keep' | 'breakeven';
  };
  benchmarks: { index: 'KOSPI' | 'KOSDAQ'; symbol: string | null };
  costs: { feePct: number }; // 매수·매도 각각
}

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
  kind: 'buy' | 'add' | 'take' | 'stop' | 'gapStop' | 'gapTake';
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
}
