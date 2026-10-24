// 내 성과 화면의 문구. 시뮬레이션 결과와 같은 말투·기호(▲▼, U+2212)를 쓴다.
import type { ReconcileStatus } from '../../perf/reconcile';
import type { SideSummary } from '../../perf/types';
import { ApiError, describeError } from '../../providers/errors';
import { fmtWon } from '../format';
import { fmtReturnPct } from '../simulate/simText';

const MINUS = '−';

/** 연율(소수) → `+12.3%`. 없으면 `계산할 수 없어요` */
export const irrText = (r: number | null): string => (r === null || !Number.isFinite(r) ? '계산할 수 없어요' : fmtReturnPct(r * 100, true));

/** 1년 미만이면 `기간 +4.1%`를 덧붙인다 */
export const periodText = (s: SideSummary): string | null => (s.periodReturn === null ? null : `기간 ${fmtReturnPct(s.periodReturn * 100, true)}`);

/** 손익: `+141,000원`, `−88,000원`, `0원` */
export function signedWon(n: number): string {
  const r = Math.round(n);
  if (r === 0) return '0원';
  return `${r > 0 ? '+' : MINUS}${fmtWon(Math.abs(r))}원`;
}

/** 금액 축·범례: 억 단위면 `1.23억`, 만 단위면 `1,234만`, 아니면 `12,345원` */
export function axisWon(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? MINUS : '';
  if (a >= 1e8) return `${sign}${(a / 1e8).toFixed(2)}억`;
  if (a >= 1e4) return `${sign}${fmtWon(Math.round(a / 1e4))}만`;
  return `${sign}${fmtWon(Math.round(a))}원`;
}

/** %p 차이(값은 이미 %p): `+4.2%p`. 없으면 `—` */
export const ppText = (v: number | null): string => (v === null || !Number.isFinite(v) ? '—' : `${fmtReturnPct(v, true)}p`);

export const signClass = (n: number | null): 'up' | 'down' | '' =>
  n === null || !Number.isFinite(n) || Math.round(n * 10) === 0 ? '' : n > 0 ? 'up' : 'down';

export const RECONCILE_LABEL: Record<ReconcileStatus, string> = {
  ok: '맞음',
  more: '맞지 않음',
  less: '맞지 않음',
  unknown: '확인 못 함',
};

export const RECONCILE_REASON: Record<'more' | 'less', string> = {
  more: '입고했거나 시간외 종가로 산 주식이 있을 수 있어요',
  less: '출고했거나 시간외 종가로 판 주식이 있을 수 있어요',
};

export const PERF_LIMITS = '배당·입출금·입고는 토스 API에 없어 빠져요 · 시간외 종가 주문은 조회되지 않아요 · 가상 매수는 그날 종가로 계산해요';

/** 불러오기 오류 문구. 프록시가 주문 조회를 막으면 프록시를 바꾸라고 알린다 */
export function perfErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'path-blocked') return '프록시가 주문 조회를 막고 있어요 · 프록시를 새 버전으로 바꿔 주세요';
    return describeError(e.code).title;
  }
  return '계좌 내역을 받지 못했어요';
}
