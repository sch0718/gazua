// 선정 기준 화면의 문구와 요약. 문구는 스펙 7.2·7.3·4장 그대로다.
import type { ValidationResult } from '../../screen/runValidation';
import type { SelectionCriteria } from '../../screen/types';
import { kstDate, kstEpoch } from '../../time/kst';
import { fmtWon } from '../format';
import { fmtReturnPct } from '../simulate/simText';

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
export function criteriaLine(c: SelectionCriteria): string {
  const k = c.conditions;
  const types = c.pool.types.map((t) => (t === 'STOCK' ? '주식' : 'ETF')).join('·');
  const parts = [`${c.pool.markets.join('·')} ${types}`];
  if (c.pool.sectors.length) parts.push(`업종 ${c.pool.sectors.length}개`);
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

/** 목록 행의 마지막 결과: `① +12.3% vs KOSPI +8.1%` */
export function lastResultLine(r: ValidationResult): string {
  const hold = `① ${fmtReturnPct(r.hold.stats.totalPct, true)}`;
  const idx = r.indices.find((i) => i.stats);
  return idx?.stats ? `${hold} vs ${idx.id} ${fmtReturnPct(idx.stats.totalPct, true)}` : hold;
}

/** 새 기준 이름: `새 기준`이 없으면 그대로, 있으면 비어 있는 가장 작은 번호 */
export function nextCriteriaName(list: { name: string }[], base = '새 기준'): string {
  const used = new Set(list.map((c) => c.name));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}
