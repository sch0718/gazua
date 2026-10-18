import type { Candle } from '../data/metrics';
import type { Priority } from '../data/requestQueue';
import type { SecurityType, TradingDay } from '../market/sessions';
import type { Venue } from '../market/tradable';

export interface ProviderCapabilities {
  venues: Venue[];
  quoteBatchSize: number;
  hasIndexCandles: boolean;
  /** 지난 거래일 지수 분봉 제공 여부 (KIS false: 지수 분봉 TR에 날짜 파라미터 없음) */
  indexMinutePastDays: boolean;
}

export interface StockMeta {
  symbol: string;
  name: string;
  market: 'KOSPI' | 'KOSDAQ' | 'KR_ETC';
  securityType: SecurityType;
  nxtSupported: boolean;
  krxSuspended: boolean;
  nxtSuspended: boolean | null;
  liquidationTrading: boolean;
  sharesOutstanding?: number;
}

export interface Quote {
  symbol: string;
  venue: Venue;
  price: number;
  ts: number | null;
}

export interface TokenInfo {
  accessToken: string;
  expiresAt: number;
}

export interface CandleQuery {
  symbol: string;
  venue: Venue;
  interval: '1m' | '1d';
  /** KST `YYYY-MM-DD`, 양끝 포함 */
  from: string;
  to: string;
  /** 요청 큐 우선순위. 기본 1 */
  priority?: Priority;
}

export interface MarketDataProvider {
  id: 'kis' | 'toss' | 'demo';
  capabilities: ProviderCapabilities;
  /**
   * 요청 순서를 보존한다. 받지 못한 종목(상장폐지·만기 ETN·거절된 코드)은 빼고 나머지를 돌려준다.
   * 한 종목도 받지 못했을 때만 오류를 던질 수 있다(연결·키 문제).
   */
  getStockMeta(symbols: string[]): Promise<StockMeta[]>;
  /** t 오름차순, t = 봉 시작. */
  getCandles(q: CandleQuery): Promise<Candle[]>;
  getQuotes(symbols: string[], venue: Venue): Promise<Quote[]>;
  /** 장이 열린 날만 isOpen true. */
  getTradingDays(from: string, to: string): Promise<TradingDay[]>;
  /**
   * 이 공급자의 접근 토큰(캐시·저장소·진행 중 발급을 함께 쓴다). 연결 진단이 따로 발급하지 않도록 쓴다.
   * 데모 공급자에는 없다.
   */
  getAccessToken?(): Promise<TokenInfo>;
  getIndexCandles?(
    index: 'KOSPI' | 'KOSDAQ',
    interval: '1m' | '1d',
    from: string,
    to: string,
    priority?: Priority,
  ): Promise<Candle[]>;
  /** 관심그룹을 만들 재료(토스만). 공급자의 종목 코드를 그대로 돌려준다(앱 코드로 바꾸는 건 호출자). */
  groupImport?: GroupImportSource;
}

/** 가져올 종목. symbol은 공급자의 코드(토스 ETN은 Q 없는 6자리). */
export interface ImportStock {
  symbol: string;
  name: string;
}

export interface ImportSector {
  id: string;
  name: string;
  /** 대분류부터 이은 이름(예: `IT › 반도체 › 메모리`) */
  path: string;
}

export interface GroupImportSource {
  /** 국내 보유 종목, 평가금액 큰 순. */
  holdings(): Promise<ImportStock[]>;
  /** 섹터 전체(대·중·소분류). */
  sectors(): Promise<ImportSector[]>;
  /** 섹터(하위 포함)의 국내 보통주, 시가총액 큰 순. */
  sectorStocks(sectorId: string): Promise<ImportStock[]>;
}

/** 토큰 저장소. 잠금 모드면 메모리 구현을 쓴다. */
export interface TokenStore {
  load(): TokenInfo | null;
  save(t: TokenInfo): void;
}

/** 같은 저장소를 쓰는 탭끼리 토큰 발급을 한 번에 하나로 묶는 잠금(브라우저에서는 navigator.locks). */
export type TokenLock = <T>(fn: () => Promise<T>) => Promise<T>;

/** 마지막 토큰 발급 성공 시각(epoch ms). 비밀이 아니라 잠금 모드에서도 저장한다(KIS 1분 제한 남은 초). */
export interface IssuedAtStore {
  load(): number | null;
  save(t: number): void;
}
