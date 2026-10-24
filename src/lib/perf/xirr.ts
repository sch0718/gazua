// 금액가중 수익률(XIRR, 연율). Σ CFᵢ ÷ (1 + r)^((tᵢ − t₀) ÷ 365) = 0. 스펙 3.5.
import { kstEpoch } from '../time/kst';

export interface Flow {
  /** KST YYYY-MM-DD */
  date: string;
  /** 나간 돈은 음수, 들어온 돈(과 마지막 평가금액)은 양수 */
  amount: number;
}

const DAY_MS = 86_400_000;
const LOW = -0.9999;
// 며칠 만의 큰 이익은 연율로 수백 배가 된다(화면은 1년 미만이면 기간 수익률도 보인다).
const HIGH = 1e6;

export const daysBetween = (a: string, b: string): number =>
  Math.round((kstEpoch(b, '00:00:00') - kstEpoch(a, '00:00:00')) / DAY_MS);

/** 연율 r을 days일 동안의 기간 수익률로 */
export const periodReturn = (r: number, days: number): number => (1 + r) ** (days / 365) - 1;

/** 해가 없거나(부호가 바뀌지 않음, 날짜가 하나뿐) 범위 밖이면 null */
export function xirr(flows: Flow[]): number | null {
  if (flows.length === 0) return null;
  const first = flows.reduce((m, f) => (f.date < m ? f.date : m), flows[0].date);
  // 같은 날 흐름은 합친다
  const byDay = new Map<number, number>();
  for (const f of flows) {
    const t = daysBetween(first, f.date) / 365;
    byDay.set(t, (byDay.get(t) ?? 0) + f.amount);
  }
  const cfs = [...byDay].filter(([, a]) => a !== 0);
  if (cfs.length < 2 || !cfs.some(([, a]) => a < 0) || !cfs.some(([, a]) => a > 0)) return null;

  const npv = (r: number) => cfs.reduce((s, [t, a]) => s + a / (1 + r) ** t, 0);
  const dnpv = (r: number) => cfs.reduce((s, [t, a]) => s - (t * a) / (1 + r) ** (t + 1), 0);
  const scale = cfs.reduce((s, [, a]) => s + Math.abs(a), 0);
  const tol = scale * 1e-12;

  // 뉴턴법
  let r = 0.1;
  for (let i = 0; i < 100; i++) {
    const v = npv(r);
    if (Math.abs(v) <= tol) return r;
    const d = dnpv(r);
    if (!Number.isFinite(d) || d === 0) break;
    const next = r - v / d;
    if (!Number.isFinite(next) || next <= LOW || next > HIGH) break;
    if (Math.abs(next - r) < 1e-12) return next;
    r = next;
  }

  // 이분법: 양 끝의 부호가 달라야 한다
  let lo = LOW;
  let hi = HIGH;
  let flo = npv(lo);
  const fhi = npv(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || Math.sign(flo) === Math.sign(fhi)) return null;
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (Math.abs(fm) <= tol || hi - lo < 1e-13) return mid;
    if (Math.sign(fm) === Math.sign(flo)) {
      lo = mid;
      flo = fm;
    } else hi = mid;
  }
  return (lo + hi) / 2;
}
