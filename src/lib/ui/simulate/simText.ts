// 시뮬레이션 화면의 문구. 목업의 한 줄 요약과 같은 말투로 쓴다.
import { resolveSymbols, type Issue } from '../../sim/validate';
import type { Skip, Strategy } from '../../sim/types';
import { addDays, kstDate } from '../../time/kst';
import { kstHHMM } from '../compare/compareText';
import type { Watchlists } from '../../state/schema';
import { fmtWon } from '../format';

const dots = (d: string) => d.replaceAll('-', '.');
const MINUS = '−';

/**
 * 수익률 표시. 소수 첫째 자리, 음수는 진짜 빼기 기호(U+2212).
 * format.ts의 fmtPct(▲▼·소수 둘째 자리)와 모양이 달라 따로 둔다.
 */
export function fmtReturnPct(v: number, signed = false): string {
  if (!Number.isFinite(v)) return '—';
  const r = Math.round(v * 10) / 10;
  if (r === 0) return '0.0%';
  if (r < 0) return `${MINUS}${Math.abs(r).toFixed(1)}%`;
  return `${signed ? '+' : ''}${r.toFixed(1)}%`;
}

function universeName(s: Strategy, w: Watchlists): string {
  if (s.universe.kind === 'symbols') return `직접 고른 ${resolveSymbols(s, w).length}종목`;
  const id = s.universe.groupId;
  return w.groups.find((g) => g.id === id)?.name ?? '그룹 없음';
}

/** 목록 행의 한 줄: `반도체 · 2023.10.11~2026.10.11` */
export function strategyLine(s: Strategy, w: Watchlists): string {
  return `${universeName(s, w)} · ${dots(s.period.from)}~${dots(s.period.to)}`;
}

/** 금액: 만 원 단위면 조·억·만으로 끊어 `1억 2,000만 원`·`1,000만 원`, 아니면 `12,345원` */
export function money(n: number): string {
  if (n === 0 || n % 10_000 !== 0) return `${fmtWon(n)}원`;
  let man = n / 10_000;
  const parts: string[] = [];
  for (const [unit, size] of [['조', 100_000_000], ['억', 10_000]] as const) {
    const q = Math.floor(man / size);
    if (q) parts.push(`${fmtWon(q)}${unit}`);
    man -= q * size;
  }
  if (man) parts.push(`${fmtWon(man)}만`);
  return `${parts.join(' ')} 원`;
}

function entrySummary(s: Strategy): string {
  const { decline, triggers: t, filter } = s.entry;
  const down: string[] = [];
  if (decline.dropPct.on) down.push(`고점 대비 ${decline.dropPct.value}% 하락`);
  if (decline.days.on) down.push(`${decline.days.value}일 하락`);
  const trig: string[] = [];
  if (t.reboundDays.on) trig.push(`${t.reboundDays.value}일 연속 상승`);
  if (t.breakout.on) trig.push(`${t.breakout.level} 돌파`);
  if (t.maCross.on) trig.push(`${t.maCross.period}일선 돌파`);
  if (t.goldenCross.on) trig.push(`${t.goldenCross.short}·${t.goldenCross.long} 골든크로스`);
  let out = `${down.length ? down.join(' · ') : '하락 조건 없음'} 뒤 → ${trig.length ? trig.join(' 또는 ') : '사는 신호 없음'}`;
  if (filter.aboveMa.on) out += ` · ${filter.aboveMa.period}일선 위`;
  return out;
}

/** 손절 기준 표시 문구(편집 세그먼트와 같은 말) */
export const STOP_BASIS_LABEL = { avgAfterScaleIn: '분할 후 평단', avgAlways: '매번 평단', firstBuy: '첫 매수가' } as const;

function exitSummary(s: Strategy): string {
  const { takeProfit, stopLoss, afterFirstTake } = s.exit;
  const n = takeProfit.length;
  // 마지막 단계는 남은 것 전부: 단계가 하나면 전량, 여럿이면 나머지
  const amount = (sellPct: number, i: number) => (i === n - 1 ? (n === 1 ? '전량' : '나머지') : `${sellPct}%`);
  const tp = n ? '익절 ' + takeProfit.map((t, i) => `+${t.pct}%에 ${amount(t.sellPct, i)}`).join(' → ') : '익절 없음';
  // 분할 매수를 끄면 세 기준이 같으므로 기준을 뺀다
  const basis = s.scaleIn.on ? ` ${STOP_BASIS_LABEL[stopLoss.basis]}` : '';
  let out = `${tp} · 손절 ${MINUS}${stopLoss.pct}%${basis}`;
  if (afterFirstTake === 'breakeven') out += ' · 1단계 뒤 본전 손절';
  return out;
}

/** 편집 화면에서 접힌 구역의 한 줄 요약. benchName은 지정 종목의 이름(모르면 null이라 종목 코드). */
export function sectionSummary(s: Strategy, section: Issue['section'], w: Watchlists, benchName: string | null): string {
  switch (section) {
    case 'universe':
      return s.universe.kind === 'symbols' ? universeName(s, w) : `${universeName(s, w)} · ${resolveSymbols(s, w).length}종목`;
    case 'period':
      return `${dots(s.period.from)} ~ ${dots(s.period.to)}`;
    case 'capital':
      return `${money(s.capital.initial)} · 회당 ${s.capital.perBuyPct}%`;
    case 'entry':
      return entrySummary(s);
    case 'scaleIn':
      return s.scaleIn.on ? `${s.scaleIn.stepPct}% 내릴 때마다 최대 ${s.scaleIn.maxAdds}번 더` : '끔';
    case 'exit':
      return exitSummary(s);
    case 'benchmarks': {
      const name = s.benchmarks.symbol ? (benchName ?? s.benchmarks.symbol) : null;
      return ['같은 종목 사서 보유', s.benchmarks.index, name].filter(Boolean).join(' · ');
    }
    case 'costs':
      return `수수료 ${s.costs.feePct}% · 팔 때 세금 포함`;
  }
}

// ── 결과 화면 ──────────────────────────────────────────

/** `2024-03-02` → `2024.03.02` */
export const dotDate = dots;

/** `2024-03-14` → `03.14` */
export const shortDate = (d: string) => dots(d.slice(5));

/** 수익률에 ▲▼를 붙인다: `▲ +32.4%`, `▼ −2.5%`, `0.0%`(소수 첫째 자리로 반올림해 0이면 화살표 없음). 색은 returnClass로. */
export function trendReturn(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—';
  const text = fmtReturnPct(v, true);
  if (text === '0.0%') return text;
  return `${v > 0 ? '▲' : '▼'} ${text}`;
}

/** trendReturn과 같은 반올림(소수 첫째 자리) 기준의 색 클래스. 0.0%로 보이면 색 없음. */
export function returnClass(v: number | null): 'up' | 'down' | '' {
  if (v === null || !Number.isFinite(v)) return '';
  const r = Math.round(v * 10) / 10;
  return r === 0 ? '' : r > 0 ? 'up' : 'down';
}

/** 손익(원)에 ▲▼: `▲ +141,000원`, `▼ −88,000원` */
export function trendWon(n: number): string {
  if (n === 0) return '0원';
  return `${n > 0 ? '▲ +' : `▼ ${MINUS}`}${fmtWon(Math.abs(n))}원`;
}

/** 수익률 차이: `+16.1%p`, `−3.0%p` */
export function fmtPp(v: number): string {
  return `${fmtReturnPct(v, true)}p`;
}

/**
 * 실제 시작일이 요청 시작일보다 7일 넘게 늦은지. 주말·명절 연휴(최대 5일 안팎)로 늦은 것은 거짓 표시하지 않는다.
 */
export function startsLate(actualStart: string, requestedFrom: string): boolean {
  return actualStart > addDays(requestedFrom, 7);
}

/**
 * 결과 머리줄: `2023.10.11 ~ 2026.10.11 · KRX 일봉 · 10/12 14:05 받음` (받은 시각은 KST).
 * from·to는 실제 데이터 기간. 요청 시작일보다 늦게 시작하면 `(요청 YYYY.MM.DD부터)`를 덧붙인다.
 */
export function resultHeadline(from: string, to: string, venueLabel: string, fetchedAt: number, requestedFrom: string): string {
  const d = kstDate(fetchedAt);
  const req = startsLate(from, requestedFrom) ? ` (요청 ${dots(requestedFrom)}부터)` : '';
  return `${dots(from)} ~ ${dots(to)}${req} · ${venueLabel} · ${d.slice(5, 7)}/${d.slice(8)} ${kstHHMM(fetchedAt)} 받음`;
}

/** 거래가 0건일 때 가장 가까웠던 순간. */
export function nearMissText(nm: { maxDropPct: number; declineDays: number }, s: Strategy): string {
  const drop = `${(Math.round(nm.maxDropPct * 10) / 10).toFixed(1)}%`;
  const { dropPct, days } = s.entry.decline;
  if (dropPct.on && nm.maxDropPct < dropPct.value) return `고점 대비 가장 크게 빠진 때도 ${drop}라, 하락 조건(${dropPct.value}% 이상)에 닿지 않았어요`;
  if (nm.declineDays > 0) return `충분히 떨어진 날은 ${nm.declineDays}일 있었지만, 그 뒤 ②의 사는 신호(연속 상승·돌파 등)가 한 번도 나오지 않았어요`;
  if (days.on) return `고점 뒤 하락이 ${days.value}거래일 이상 이어진 적이 없었어요`;
  return `가장 크게 빠진 때는 ${drop}였어요`;
}

const SKIP_LABEL: Record<Skip['reason'], string> = {
  '현금 부족': '현금이 모자랐어요',
  '1주가 1회 금액보다 비쌈': '1주가 회당 금액보다 비싸요',
  '거래 없음': '그날 거래가 없었어요',
  '선정 기간이 아니에요': '선정 기간이 아니에요',
};
/** 건너뛴 이유의 표시 문구(엔진 enum은 그대로 둔다). */
export const skipReasonLabel = (r: Skip['reason']): string => SKIP_LABEL[r];

/** 건너뛴 이유별 개수, 많은 순(같으면 먼저 나온 것). */
export function skipCounts(skipped: Skip[]): { reason: Skip['reason']; n: number }[] {
  const count = new Map<Skip['reason'], number>();
  for (const k of skipped) count.set(k.reason, (count.get(k.reason) ?? 0) + 1);
  return [...count].map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n);
}

/** 건너뛴 이유 중 가장 많은 것(같으면 먼저 나온 것). */
export function dominantSkipReason(skipped: Skip[]): Skip['reason'] | null {
  return skipCounts(skipped)[0]?.reason ?? null;
}

export const LIMITATIONS = [
  '배당 제외 · 가격 수익률만이에요',
  '지금 관심종목만 넣을 수 있어서 상장폐지 종목이 빠져요(생존 편향)',
  '일봉으로 계산해서 하루 안의 순서는 시가→저가→고가→종가로 가정해요',
] as const;
