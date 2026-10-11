// 모든 시각 계산은 KST(UTC+9) 고정 오프셋 산술만 사용한다.
// 한국은 서머타임이 없으므로 Intl/기기 시간대에 의존하지 않는다.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** epoch ms → KST 달력 날짜 `YYYY-MM-DD` */
export function kstDate(ms: number): string {
  const d = new Date(ms + KST_OFFSET_MS);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** epoch ms → KST 기준 하루 중 경과 분 (0..1439) */
export function kstMinuteOfDay(ms: number): number {
  const d = new Date(ms + KST_OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** KST `YYYY-MM-DD` + `HH:mm:ss` → epoch ms */
export function kstEpoch(date: string, hhmmss: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm, ss] = hhmmss.split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh, mm, ss ?? 0) - KST_OFFSET_MS;
}

/** KST 달력 날짜의 요일 (0=일 .. 6=토) */
export function kstWeekday(date: string): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

/** 달력 날짜에 n일을 더한 `YYYY-MM-DD` (음수 가능) */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + n * DAY_MS;
  const r = new Date(t);
  return `${pad(r.getUTCFullYear(), 4)}-${pad(r.getUTCMonth() + 1)}-${pad(r.getUTCDate())}`;
}
