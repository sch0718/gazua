/** 숫자 표시 규칙. 상승·하락은 색만이 아니라 늘 ▲▼ 기호와 함께 쓴다. */

const won = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });

/** 소수 둘째 자리 반올림 결과가 0이면 '평평함'으로 본다(‑0.00 방지). */
function roundedPct(v: number): number {
  return Math.round(v * 100) / 100;
}

export function fmtPct(v: number | null): string {
  if (v === null) return '—';
  const r = roundedPct(v);
  if (r === 0) return '0.00%';
  return r > 0 ? `▲ +${r.toFixed(2)}%` : `▼ ${r.toFixed(2)}%`;
}

export function fmtWon(n: number): string {
  return won.format(n);
}

/** 단위가 이미 조(兆)인 값을 소수 첫째 자리까지. */
export function fmtTrillion(n: number): string {
  return `${n.toFixed(1)}조`;
}

/**
 * 등락 방향 클래스. 색 관례(kr/global)는 CSS 변수 `--up/--down`이 바꾸므로
 * 클래스 이름은 관례와 무관하다. fmtPct와 같은 반올림 기준을 쓴다.
 */
export function trendClass(v: number | null, _conv: 'kr' | 'global'): 'up' | 'down' | '' {
  if (v === null) return '';
  const r = roundedPct(v);
  if (r === 0) return '';
  return r > 0 ? 'up' : 'down';
}
