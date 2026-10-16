// 선정 기준 화면의 문구와 요약. 문구는 스펙 7.2·7.3·4장 그대로다.
import { sectorGroupCount } from '../../screen/precompute';
import { ERROR_TEXT, type ValidationResult, type WorkerErrorCode } from '../../screen/runValidation';
import type { MarketDataFile } from '../../marketData/format';
import type { SelectionCriteria } from '../../screen/types';
import { kstDate, kstEpoch } from '../../time/kst';
import { fmtWon } from '../format';
import { fmtReturnPct, trendReturn } from '../simulate/simText';

export type ConditionKey = keyof SelectionCriteria['conditions'];

/** 조건 한 줄 설명(스펙 7.3 표) */
export const CONDITION_HELP: Record<ConditionKey, string> = {
  marketCap: '회사 전체의 값어치예요. 클수록 큰 회사예요.',
  tradingValue: '하루에 거래된 금액이에요. 크면 사고팔기 쉬워요.',
  leader: '같은 업종에서 시가총액이 몇 등 안에 드는지예요.',
  returnRange: '최근 며칠 동안 얼마나 오르거나 내렸는지예요.',
  vsMa: '최근 며칠 평균 가격보다 위에 있는지예요. 위면 오르는 흐름이에요.',
  fromHigh: '1년 중 가장 높았던 가격에서 얼마나 내려와 있는지예요.',
  volatility: '하루 가격이 얼마나 출렁이는지예요. 작을수록 잔잔해요.',
  rebound: '하락이 이어지다 저점을 찍고 반등하는 내 매수 패턴이 최근에 나타났는지예요.',
};

/** 화면에 보이는 조건 이름. 스펙 7.3 표의 순서 */
export const CONDITION_LABEL: Record<ConditionKey, string> = {
  marketCap: '시가총액',
  tradingValue: '거래대금',
  leader: '대장주',
  returnRange: '수익률',
  vsMa: '이동평균',
  fromHigh: '52주 고점 대비',
  volatility: '변동성',
  rebound: '반등 신호',
};
export const CONDITION_ORDER: ConditionKey[] = ['marketCap', 'tradingValue', 'leader', 'returnRange', 'vsMa', 'fromHigh', 'volatility', 'rebound'];

export const NO_DATA_TEXT = '시장 데이터가 없어요. 수집 스크립트로 만든 파일을 가져와 주세요';
export const NO_DATA_RUN_REASON = '시장 데이터를 가져오면 실행할 수 있어요';
export const STALE_DAYS = 30;
export const staleText = (n: number) => `데이터가 ${n}일 전 것이에요. 최근 기간은 검증에 빠져요`;

const REBALANCE_LABEL = { monthly: '매월', quarterly: '분기', semiannual: '반기' } as const;
export const rebalanceLabel = (r: SelectionCriteria['rebalance']) => REBALANCE_LABEL[r];

/** 억 원 단위 금액: 1,000억 · 1조 */
function eok(n: number): string {
  return n >= 10_000 && n % 10_000 === 0 ? `${fmtWon(n / 10_000)}조` : `${fmtWon(n)}억`;
}
const MINUS = '−';
const signed = (n: number) => (n < 0 ? `${MINUS}${Math.abs(n)}` : String(n));

/** 목록 행의 한 줄: `KOSPI·KOSDAQ 주식 · 거래대금 10억↑ · 반등 10일 · 상위 10 · 매월` */
export function criteriaLine(c: SelectionCriteria, sectors: MarketDataFile['sectors'] = []): string {
  const k = c.conditions;
  const types = c.pool.types.map((t) => (t === 'STOCK' ? '주식' : 'ETF')).join('·');
  const parts = [`${c.pool.markets.join('·')} ${types}`];
  if (c.pool.sectors.length) parts.push(`업종 ${sectorGroupCount(c.pool.sectors, sectors)}개`);
  const on: string[] = [];
  if (k.marketCap.on) on.push(`시총 ${eok(k.marketCap.minEok)}↑`);
  if (k.tradingValue.on) on.push(`거래대금 ${eok(k.tradingValue.minEok)}↑`);
  if (k.leader.on) on.push(`${k.leader.level === 1 ? '대분류' : '중분류'} ${k.leader.maxRank}위 이내`);
  if (k.returnRange.on) on.push(`${k.returnRange.days}일 수익률 ${signed(k.returnRange.minPct)}~${signed(k.returnRange.maxPct)}%`);
  if (k.vsMa.on) on.push(`${k.vsMa.period}일선 ${k.vsMa.side === 'above' ? '위' : '아래'}`);
  if (k.fromHigh.on) on.push(`고점 대비 ${k.fromHigh.minPct}~${k.fromHigh.maxPct}% 하락`);
  if (k.volatility.on) on.push(`변동성 ${k.volatility.days}일 ${k.volatility.maxPct}%↓`);
  if (k.rebound.on) on.push(`반등 ${k.rebound.withinDays}일`);
  parts.push(...(on.length ? on : ['조건 없음']));
  parts.push(`상위 ${c.rank.take}`, rebalanceLabel(c.rebalance));
  return parts.join(' · ');
}

/** 수집일(ISO)로부터 지난 달력 날수. 읽을 수 없으면 null */
export function dataAgeDays(collectedAt: string, now: number): number | null {
  const t = Date.parse(collectedAt);
  if (!Number.isFinite(t)) return null;
  const DAY = 24 * 60 * 60 * 1000;
  return Math.round((kstEpoch(kstDate(now), '00:00:00') - kstEpoch(kstDate(t), '00:00:00')) / DAY);
}

/** 목록 행의 마지막 결과: `① +12.3% vs KOSPI +8.1%`의 숫자들. 화면이 ▲▼와 색을 입힌다 */
export interface LastResult {
  hold: number;
  /** 첫 비교 지수(지수보다 나은 구간 수와 같은 지수). 곡선이 없으면 pct가 null이고 이유를 보인다 */
  index: { id: string; pct: number | null; reason?: string } | null;
}
/** 지수 대비의 기준: `result.indices[0]`. 곡선이 없으면 stats가 null이라 이유를 보인다 */
export function vsIndex(r: ValidationResult): { id: string; stats: ValidationResult['hold']['stats'] | null; reason: string } | null {
  const i = r.indices[0];
  return i ? { id: i.id, stats: i.stats, reason: i.reason ?? '받지 못했어요' } : null;
}
export function lastResultSummary(r: ValidationResult): LastResult {
  const v = vsIndex(r);
  return {
    hold: r.hold.stats.totalPct,
    index: v ? (v.stats ? { id: v.id, pct: v.stats.totalPct } : { id: v.id, pct: null, reason: v.reason }) : null,
  };
}

/** 수익률 차이(%p)에 ▲▼: `▲ +3.2%p` */
export function trendPp(v: number): string {
  const t = trendReturn(v);
  return t === '—' ? t : `${t}p`;
}

/** 실패 화면 문구(스펙 8.2). 시뮬레이션의 `계산 중 문제가 생겼어요`와 같은 말투 */
export const FAILURE_TEXT: Record<WorkerErrorCode, string> = {
  ...ERROR_TEXT,
  'no-data': NO_DATA_TEXT,
  crash: '계산 중 문제가 생겼어요',
};

export const ALL_EMPTY_TEXT = '기간 내내 조건을 통과한 종목이 없어요';
export const WARMUP_TEXT = '앞부분은 지표 계산에 필요한 데이터가 모자라요';
export const SPARSE_TEXT = '일부 재선정일은 전날 거래한 종목이 적어서 선별이 덜 정확할 수 있어요';
/** 해석 도움말(스펙 7.4-6). 앞의 셋은 항상 보인다 */
export const HELP_ALWAYS = [
  '지금 상장된 종목만 들어 있어 상장폐지 종목이 빠져요(생존 편향). 결과가 실제보다 좋게 나올 수 있어요',
  '업종과 상장주식수는 수집일 기준이에요. 과거 시점에도 지금 값을 써요',
  '배당 제외 · 가격 수익률만이에요',
] as const;
export const FEW_SEGMENTS_TEXT = '구간이 적어서 우연일 수 있어요';
/** 못 산 이유별 문구(스펙 6.2·7.4) */
export const NOT_BOUGHT_TEXT: Record<'noBar' | 'tooExpensive' | 'cash', string> = {
  noBar: '매수 못 함(재선정일 거래 없음)',
  tooExpensive: '매수 못 함(1주 값이 배정 금액보다 커요)',
  cash: '매수 못 함(현금이 모자라요)',
};
export const SOLD_AT_LAST_CLOSE_TEXT = '거래가 멈춰 마지막 종가로 팔았어요';

/** 선정 이력에서 펼치면 나오는 조건 계산값의 이름과 표시 */
const WON = (n: number) => (n >= 1e12 ? `${(n / 1e12).toFixed(1)}조원` : n >= 1e8 ? `${fmtWon(Math.round(n / 1e8))}억원` : `${fmtWon(Math.round(n))}원`);
const ONE = (n: number) => String(Math.round(n * 10) / 10).replace('-', MINUS);
export const VALUE_LABEL: Record<string, { label: string; fmt: (v: number | boolean | null) => string }> = {
  marketCap: { label: '시가총액', fmt: (v) => (typeof v === 'number' ? WON(v) : '—') },
  tradingValue: { label: '거래대금', fmt: (v) => (typeof v === 'number' ? WON(v) : '—') },
  leaderRank: { label: '업종 순위', fmt: (v) => (typeof v === 'number' ? `${v}위` : '—') },
  return: { label: '수익률', fmt: (v) => (typeof v === 'number' ? fmtReturnPct(v, true) : '—') },
  ma: { label: '이동평균', fmt: (v) => (typeof v === 'number' ? `${fmtWon(Math.round(v))}원` : '—') },
  fromHigh: { label: '52주 고점 대비', fmt: (v) => (typeof v === 'number' ? fmtReturnPct(v, true) : '—') },
  volatility: { label: '변동성', fmt: (v) => (typeof v === 'number' ? `${ONE(v)}%` : '—') },
  rebound: { label: '반등 신호', fmt: (v) => (v === true ? '있음' : '—') },
};
export function valueText(key: string, v: number | boolean | null): { label: string; text: string } {
  const f = VALUE_LABEL[key];
  return f ? { label: f.label, text: f.fmt(v) } : { label: key, text: v === null ? '—' : String(v) };
}

/** 새 기준 이름: `새 기준`이 없으면 그대로, 있으면 비어 있는 가장 작은 번호 */
export function nextCriteriaName(list: { name: string }[], base = '새 기준'): string {
  const used = new Set(list.map((c) => c.name));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}
