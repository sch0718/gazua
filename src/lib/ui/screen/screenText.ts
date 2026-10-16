// 선정 기준 화면의 문구와 요약. 문구는 스펙 7.2·7.3·4장 그대로다.
import { rankFlowOf, sectorGroupCount } from '../../screen/precompute';
import { ERROR_TEXT, type ValidationResult, type WorkerErrorCode } from '../../screen/runValidation';
import type { MarketDataFile } from '../../marketData/format';
import type { FlowWho, MacroSeriesKey, SelectionCriteria } from '../../screen/types';
import { kstDate, kstEpoch } from '../../time/kst';
import { fmtWon } from '../format';
import { fmtReturnPct, trendReturn } from '../simulate/simText';

// 환율·유가(macro)는 켜는 조건이 계열별이라 이 목록에 넣지 않는다(화면은 Task 6)
export type ConditionKey = Exclude<keyof SelectionCriteria['conditions'], 'macro' | 'flow'>;

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

/** 환율·유가 계열 이름 */
export const SERIES_LABEL: Record<MacroSeriesKey, string> = { usdkrw: '원/달러', wti: '유가' };
export const SERIES_ORDER: MacroSeriesKey[] = ['usdkrw', 'wti'];
// 이/가: 환율은 받침이 있어 `환율이`, 유가는 없어 `유가가`(스펙의 `환율`→`유가` 바꾸기에 조사를 맞춘다)
const SERIES_SUBJECT: Record<MacroSeriesKey, string> = { usdkrw: '환율이', wti: '유가가' };
/** 환율·유가 조건 한 줄 설명(스펙 5.2). WTI는 `환율`을 `유가`로 바꾼다 */
export const macroBetaHelp = (k: MacroSeriesKey) =>
  `${SERIES_SUBJECT[k]} 1% 오를 때 주가가 평균 몇 % 움직였는지예요. +면 같이 오르고, −면 반대로 움직여요.`;
export const macroTrendHelp = (k: MacroSeriesKey) =>
  `최근 며칠 동안 ${SERIES_SUBJECT[k]} 크게 오르면 같이 오르는 종목을, 크게 내리면 반대로 움직이는 종목을 골라요.`;
export const NEED_RECOLLECT_TEXT = '다시 수집하면 쓸 수 있어요';

/** 투자자 매매동향(3단계 스펙 4.1) */
export const FLOW_WHO_LABEL: Record<FlowWho, string> = { foreign: '외국인', inst: '기관', indiv: '개인', both: '외국인+기관' };
export const FLOW_WHO_ORDER: FlowWho[] = ['foreign', 'inst', 'indiv', 'both'];
export const FLOW_AMOUNT_HELP = '최근 기간 순매수 금액이 같은 기간 거래대금에서 차지하는 비율이에요. 음수면 순매도예요';
export const FLOW_STREAK_HELP = '이 주체가 하루도 빠짐없이 순매수한 날이 이어진 수예요';
export const FLOW_LAG_HINT = '매매동향은 하루 늦게 반영해요(장 마감 뒤 수치가 바뀔 수 있어서)';
/** 결과 메모(3단계 스펙 4.3) */
export const FLOW_LAG_TEXT = '매매동향은 재선정일 이틀 전 거래일까지 써요';
export const FLOW_GAP_TEXT = '수급 데이터가 없는 구간이 있어 그 재선정일에는 고른 종목이 없거나 적어요';

/** 해석 메모(스펙 4.3·5.3·7) */
export const THEME_SNAPSHOT_TEXT = '테마·내 묶음은 지금 구성을 과거에도 써요. 그때는 없던 종목이 들어 있어 결과가 실제보다 좋게 나올 수 있어요';
export const MACRO_LAG_TEXT = '환율·유가는 매주 묶어서 공개돼 최근 1~2주는 반영되지 않아요';
export const MACRO_GAP_TEXT = '일부 기간은 환율·유가 값이 없어 그 조건을 통과한 종목이 없어요';

/** 후보 범위 요약: `업종 2개·테마 2·묶음 1`. 아무것도 안 골랐으면 `전체 업종` */
export function poolScopeText(pool: SelectionCriteria['pool'], sectors: MarketDataFile['sectors'] = []): string {
  const parts: string[] = [];
  if (pool.sectors.length) parts.push(`업종 ${sectorGroupCount(pool.sectors, sectors)}개`);
  if (pool.themes.length) parts.push(`테마 ${pool.themes.length}`);
  if (pool.baskets.length) parts.push(`묶음 ${pool.baskets.length}`);
  return parts.length ? parts.join('·') : '전체 업종';
}

/** 목록 행의 한 줄: `KOSPI·KOSDAQ 주식 · 거래대금 10억↑ · 반등 10일 · 상위 10 · 매월` */
export function criteriaLine(c: SelectionCriteria, sectors: MarketDataFile['sectors'] = []): string {
  const k = c.conditions;
  const types = c.pool.types.map((t) => (t === 'STOCK' ? '주식' : 'ETF')).join('·');
  const parts = [`${c.pool.markets.join('·')} ${types}`];
  if (c.pool.sectors.length || c.pool.themes.length || c.pool.baskets.length) parts.push(poolScopeText(c.pool, sectors));
  const on: string[] = [];
  if (k.marketCap.on) on.push(`시총 ${eok(k.marketCap.minEok)}↑`);
  if (k.tradingValue.on) on.push(`거래대금 ${eok(k.tradingValue.minEok)}↑`);
  if (k.leader.on) on.push(`${k.leader.level === 1 ? '대분류' : '중분류'} ${k.leader.maxRank}위 이내`);
  if (k.returnRange.on) on.push(`${k.returnRange.days}일 수익률 ${signed(k.returnRange.minPct)}~${signed(k.returnRange.maxPct)}%`);
  if (k.vsMa.on) on.push(`${k.vsMa.period}일선 ${k.vsMa.side === 'above' ? '위' : '아래'}`);
  if (k.fromHigh.on) on.push(`고점 대비 ${k.fromHigh.minPct}~${k.fromHigh.maxPct}% 하락`);
  if (k.volatility.on) on.push(`변동성 ${k.volatility.days}일 ${k.volatility.maxPct}%↓`);
  if (k.rebound.on) on.push(`반등 ${k.rebound.withinDays}일`);
  for (const key of SERIES_ORDER) {
    const m = k.macro[key];
    if (m.beta.on) on.push(`${SERIES_LABEL[key]} 민감도 ${signed(m.beta.min)}~${signed(m.beta.max)}`);
    if (m.trend.on) on.push(`${SERIES_LABEL[key]} 흐름 ${m.trend.lookback}일`);
  }
  const fa = k.flow.amount;
  const fs = k.flow.streak;
  if (fa.on) on.push(`${FLOW_WHO_LABEL[fa.who]} 순매수 ${fa.days}일 ${signed(fa.minPct)}~${signed(fa.maxPct)}%`);
  if (fs.on) on.push(`${FLOW_WHO_LABEL[fs.who]} 연속 ${fs.minDays}일↑`);
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

/** 선정 이력의 환율·유가 값 줄: `원/달러 민감도 0.82 · 최근 20일 +3.4%`. 값이 없는 계열은 줄이 없다 */
export const MACRO_VALUE_KEYS = new Set(SERIES_ORDER.flatMap((k) => [`${k}Beta`, `${k}Trend`]));
export function macroValueLines(values: Record<string, number | boolean | null>, lookback?: Partial<Record<MacroSeriesKey, number>>): string[] {
  const out: string[] = [];
  for (const k of SERIES_ORDER) {
    const hasBeta = `${k}Beta` in values;
    const hasTrend = `${k}Trend` in values;
    if (!hasBeta && !hasTrend) continue;
    const b = values[`${k}Beta`];
    const t = values[`${k}Trend`];
    const parts = [`${SERIES_LABEL[k]} 민감도 ${typeof b === 'number' ? (b < 0 ? MINUS : '') + Math.abs(b).toFixed(2) : '—'}`];
    if (hasTrend) {
      const days = lookback?.[k];
      const pct = typeof t === 'number' ? `${t < 0 ? MINUS : '+'}${Math.abs(t).toFixed(1)}%` : '—';
      parts.push(`최근 ${days ? `${days}일 ` : '흐름 '}${pct}`);
    }
    out.push(parts.join(' · '));
  }
  return out;
}

/** 실행할 때 기준의 수급 주체·기간. 선정 이력은 이것으로 값의 이름을 붙인다 */
export interface FlowRunSnap {
  amount: { who: FlowWho; days: number };
  streak: { who: FlowWho };
  rank: { who: FlowWho; days: number };
}
/** 선정 이력의 수급 값 키(일반 값 목록에는 따로 나오지 않는다) */
export const FLOW_VALUE_KEYS = new Set(['flowRatio', 'flowRatioForeign', 'flowRatioInst', 'flowStreak', 'rankFlow', 'rankFlowForeign', 'rankFlowInst']);
/** 실행할 때 기준에서 수급 주체·기간을 떼어 둔다(정렬 수급이 없는 옛 기준은 기본값) */
export function flowRunSnap(c: SelectionCriteria): FlowRunSnap {
  const { amount, streak } = c.conditions.flow;
  const rank = rankFlowOf(c);
  return { amount: { who: amount.who, days: amount.days }, streak: { who: streak.who }, rank: { who: rank.who, days: rank.days } };
}
/** 소수 한 자리 %, 음수는 `−`. 0으로 반올림되면 부호가 없다 */
const pct1 = (v: number | boolean | null | undefined) => {
  if (typeof v !== 'number') return '—';
  const t = Math.abs(v).toFixed(1);
  return `${v < 0 && Number(t) !== 0 ? MINUS : ''}${t}%`;
};
/**
 * 선정 이력의 수급 값 줄(3단계 스펙 4.3): `외국인 순매수 20일 3.2% · 연속 5일`,
 * `both`면 `외국인 2.1% · 기관 1.4% (20일) · 함께 연속 3일`. `수급 순` 정렬 값은 순매수 규모와 같은 값이 아니면 따로 한 줄이다
 */
export function flowValueLines(values: Record<string, number | boolean | null>, snap: FlowRunSnap): string[] {
  const has = (k: string) => k in values;
  const out: string[] = [];
  const parts: string[] = [];
  const amountShown = has('flowRatio') || has('flowRatioForeign');
  if (has('flowRatioForeign')) parts.push(`외국인 ${pct1(values.flowRatioForeign)}`, `기관 ${pct1(values.flowRatioInst)} (${snap.amount.days}일)`);
  else if (has('flowRatio')) parts.push(`${FLOW_WHO_LABEL[snap.amount.who]} 순매수 ${snap.amount.days}일 ${pct1(values.flowRatio)}`);
  if (has('flowStreak')) {
    const n = values.flowStreak;
    const run = `${snap.streak.who === 'both' ? '함께 ' : ''}연속 ${typeof n === 'number' ? n : '—'}일`;
    parts.push(amountShown && snap.streak.who === snap.amount.who ? run : `${FLOW_WHO_LABEL[snap.streak.who]} ${run}`);
  }
  if (parts.length) out.push(parts.join(' · '));
  const sameAsAmount = amountShown && snap.rank.who === snap.amount.who && snap.rank.days === snap.amount.days;
  if (has('rankFlow') && !sameAsAmount)
    out.push(
      has('rankFlowForeign')
        ? `외국인 ${pct1(values.rankFlowForeign)} · 기관 ${pct1(values.rankFlowInst)} (${snap.rank.days}일)`
        : `${FLOW_WHO_LABEL[snap.rank.who]} 순매수 ${snap.rank.days}일 ${pct1(values.rankFlow)}`,
    );
  return out;
}

/** 새 기준 이름: `새 기준`이 없으면 그대로, 있으면 비어 있는 가장 작은 번호 */
export function nextCriteriaName(list: { name: string }[], base = '새 기준'): string {
  const used = new Set(list.map((c) => c.name));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}
