import type { MetricId, Period, PeriodUnit } from '../state/schema';

/** '%': 부호·등락 색이 있는 변화율, '%abs': 부호 없는 퍼센트(변동성), 'x': 배수, '조': 조 원, '': 단위 없는 수(RSI) */
export type MetricUnit = '%' | '%abs' | 'x' | '조' | '';

export interface MetricDef {
  id: MetricId;
  label: string;
  description: string;
  unit: MetricUnit;
  needs: { minPeriodDays?: number; indexCandles?: boolean; shares?: boolean };
}

export const METRICS: MetricDef[] = [
  {
    id: 'change',
    label: '등락률',
    description: '기간 시작 직전 종가 대비 몇 % 올랐나',
    unit: '%',
    needs: {},
  },
  {
    id: 'drawdown',
    label: '고점 대비 하락률',
    description: '기간 중 최고가에서 얼마나 내려왔나',
    unit: '%',
    needs: {},
  },
  {
    id: 'excess',
    label: '시장 대비 초과수익',
    description: 'KOSPI·KOSDAQ보다 얼마나 더 올랐나',
    unit: '%',
    needs: { indexCandles: true },
  },
  {
    id: 'rvol',
    label: '상대 거래량',
    description: '평소(20일 평균) 대비 거래량 배수',
    unit: 'x',
    needs: {},
  },
  {
    id: 'mcap',
    label: '시가총액',
    description: '발행주식수 × 가격 (조 원)',
    unit: '조',
    needs: { shares: true },
  },
  {
    id: 'volatility',
    label: '변동성',
    description: '20일 수익률 표준편차(연율)',
    unit: '%abs',
    needs: { minPeriodDays: 30 },
  },
  {
    id: 'rsi',
    label: 'RSI(14)',
    description: '과열·침체 비교 (0–100)',
    unit: '',
    needs: { minPeriodDays: 30 },
  },
];

/** none: 공급자에 지수 캔들 없음, no-past-minutes: 지난 거래일 1일 차트인데 지수 분봉 없음, failed: 이번 조회 실패 */
export type IndexAvailability = 'ok' | 'none' | 'no-past-minutes' | 'failed';

export type MetricAvailability = { ok: true } | { ok: false; reason: string };

/** 기간 길이(일). 1개월=30일로 보고 minPeriodDays와 비교한다. */
const PERIOD_DAYS: Record<PeriodUnit, number> = { D: 1, W: 7, M: 30, Y: 365 };

export function metricAvailability(
  id: MetricId,
  ctx: { period: Period; index: IndexAvailability; hasShares: boolean },
): MetricAvailability {
  const def = METRICS.find((m) => m.id === id);
  if (!def) return { ok: false, reason: '곧 추가될 예정이에요' };
  const min = def.needs.minPeriodDays;
  // 지금 minPeriodDays는 30(1개월)뿐이라 문구를 고정한다.
  if (min !== undefined && PERIOD_DAYS[ctx.period.unit] * ctx.period.n < min) {
    return { ok: false, reason: '1개월 이상에서 볼 수 있어요' };
  }
  if (id === 'excess') {
    switch (ctx.index) {
      case 'none':
        return { ok: false, reason: '이 데이터 소스는 지수 데이터를 주지 않아요' };
      case 'no-past-minutes':
        return { ok: false, reason: '휴장일에는 이 데이터 소스가 지수 분봉을 주지 않아요' };
      case 'failed':
        return { ok: false, reason: '지수 데이터를 받지 못했어요' };
    }
  }
  if (id === 'mcap' && !ctx.hasShares) {
    return { ok: false, reason: '발행주식수 정보가 없어요' };
  }
  return { ok: true };
}
