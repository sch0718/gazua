// 결과 스냅샷 검사용 열거값(설계 2.7). 원래 타입이 있는 모듈(sim/types·screen/runValidation 등)을 끌어오지 않으려고
// 값만 따로 둔다. 원래 타입과 같은지는 resultEnums.test.ts가 타입으로 확인한다. 이 파일은 아무것도 import하지 않는다.

export const TRADE_KINDS = ['buy', 'add', 'take', 'stop', 'gapStop', 'gapTake'] as const;
export const SELL_KINDS = ['take', 'stop', 'gapStop', 'gapTake'] as const;
/** 고정 순서. 건너뜀 이유별 개수·목록의 이유 위치가 이 순서다 */
export const SKIP_REASONS = ['현금 부족', '1주가 1회 금액보다 비쌈', '거래 없음', '선정 기간이 아니에요'] as const;
export const SIM_FAILURE_REASONS = ['받지 못했어요', '종목 정보를 받지 못했어요', '기간 안에 데이터가 없어요'] as const;
export const MISSING_REASONS = ['받지 못했어요', '기간 일부만 받았어요'] as const;
export const NOT_BOUGHT_REASONS = ['noBar', 'tooExpensive', 'cash'] as const;
export const BY_MARKET_KEYS = ['KOSPI', 'KOSDAQ', 'ETF'] as const;
export const MARKETS = ['KOSPI', 'KOSDAQ'] as const;
export const VALIDATION_NOTES = [
  'survivorship',
  'snapshot',
  'dividend',
  'fewSegments',
  'warmup',
  'allEmpty',
  'sparseAxis',
  'themeSnapshot',
  'macroGap',
  'flowLag',
  'flowGap',
  'finLag',
  'finShares',
  'finGap',
] as const;

/** 조건 계산값 키의 반올림 규칙: 정수 그대로 · 유효숫자 4자리 · boolean */
export type ValueRule = 'int' | 'sig4' | 'bool';

/** select.ts가 만드는 값 키(설계 2.5). 목록 밖 이름(`__proto__` 포함)은 거절한다 */
export const VALUE_KEYS: readonly (readonly [string, ValueRule])[] = [
  ['marketCap', 'sig4'],
  ['tradingValue', 'sig4'],
  ['leaderRank', 'int'],
  ['return', 'sig4'],
  ['ma', 'sig4'],
  ['fromHigh', 'sig4'],
  ['volatility', 'sig4'],
  ['rebound', 'bool'],
  ['usdkrwTrend', 'sig4'],
  ['wtiTrend', 'sig4'],
  ['usdkrwBeta', 'sig4'],
  ['wtiBeta', 'sig4'],
  ['flowRatio', 'sig4'],
  ['flowRatioForeign', 'sig4'],
  ['flowRatioInst', 'sig4'],
  ['flowStreak', 'int'],
  ['rankFlow', 'sig4'],
  ['rankFlowForeign', 'sig4'],
  ['rankFlowInst', 'sig4'],
  ['finPer', 'sig4'],
  ['finPbr', 'sig4'],
  ['finRoe', 'sig4'],
  ['finOpMargin', 'sig4'],
  ['finRevGrowth', 'sig4'],
  ['finOpGrowth', 'sig4'],
  ['finDebtRatio', 'sig4'],
  ['finQuarter', 'int'],
  ['rankFin', 'sig4'],
];

/** 프로토타입이 없는 표라 `__proto__`·`toString` 같은 이름이 규칙으로 잡히지 않는다 */
export const VALUE_KEY_RULE: Readonly<Partial<Record<string, ValueRule>>> = Object.freeze(
  Object.assign(Object.create(null) as Record<string, ValueRule>, Object.fromEntries(VALUE_KEYS)),
);

/**
 * 공유 경로의 종목 코드(설계 2.7). scripts/parse-master.mjs의 SYMBOL_PATTERN과 같다.
 * 주식·ETF·리츠는 6자리, ETN은 Q + 6자리(src/lib/data/universe.ts 주석).
 */
export const SHARE_SYMBOL_RE = /^(?:[0-9A-Z]{6}|Q[0-9A-Z]{6})$/;
