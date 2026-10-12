// 시뮬레이션 화면의 문구. 목업의 한 줄 요약과 같은 말투로 쓴다.
import { resolveSymbols, type Issue } from '../../sim/validate';
import type { Skip, Strategy } from '../../sim/types';
import { kstDate } from '../../time/kst';
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

function money(n: number): string {
  return n % 10_000 === 0 ? `${fmtWon(n / 10_000)}만 원` : `${fmtWon(n)}원`;
}

function entrySummary(s: Strategy): string {
  const { decline, triggers: t, filter } = s.entry;
  const down: string[] = [];
  if (decline.dropPct.on) down.push(`고점 대비 ${decline.dropPct.value}%↓`);
  if (decline.days.on) down.push(`${decline.days.value}일 하락`);
  const trig: string[] = [];
  if (t.reboundDays.on) trig.push(`${t.reboundDays.value}일 연속 상승`);
  if (t.breakout.on) trig.push(`${t.breakout.level} 돌파`);
  if (t.maCross.on) trig.push(`${t.maCross.period}일선 돌파`);
  if (t.goldenCross.on) trig.push(`${t.goldenCross.short}·${t.goldenCross.long} 골든크로스`);
  let out = `${down.length ? down.join(' · ') : '하락 조건 없음'} 뒤 → ${trig.length ? trig.join(' 또는 ') : '트리거 없음'}`;
  if (filter.aboveMa.on) out += ` · ${filter.aboveMa.period}일선 위`;
  return out;
}

const BASIS = { avgAfterScaleIn: '분할 완료 후 평단', avgAlways: '평단', firstBuy: '첫 매수가' } as const;

function exitSummary(s: Strategy): string {
  const { takeProfit, stopLoss, afterFirstTake } = s.exit;
  const tp = takeProfit.length
    ? '익절 ' + takeProfit.map((t) => `+${t.pct}% ${t.sellPct >= 100 ? '전량' : `${t.sellPct}%`}`).join(' → ')
    : '익절 없음';
  let out = `${tp} · 손절 ${MINUS}${stopLoss.pct}% ${BASIS[stopLoss.basis]}`;
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
      return s.scaleIn.on ? `${s.scaleIn.stepPct}%씩 최대 ${s.scaleIn.maxAdds}번` : '끔';
    case 'exit':
      return exitSummary(s);
    case 'benchmarks': {
      const name = s.benchmarks.symbol ? (benchName ?? s.benchmarks.symbol) : null;
      return ['같은 종목 보유', s.benchmarks.index, name].filter(Boolean).join(' · ');
    }
    case 'costs':
      return `수수료 ${s.costs.feePct}% · 매도 세금`;
  }
}

// ── 결과 화면 ──────────────────────────────────────────

/** `2024-03-02` → `2024.03.02` */
export const dotDate = dots;

/** `2024-03-14` → `03.14` */
export const shortDate = (d: string) => dots(d.slice(5));

/** 수익률에 ▲▼를 붙인다: `▲ +32.4%`, `▼ −2.5%`, `0.0%`. 색은 format.ts의 trendClass로. */
export function trendReturn(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—';
  const text = fmtReturnPct(v, true);
  if (text === '0.0%') return text;
  return `${v > 0 ? '▲' : '▼'} ${text}`;
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

/** 결과 머리줄: `2023.10.11 ~ 2026.10.11 · KRX 일봉 · 10/12 14:05 받음` (받은 시각은 KST) */
export function resultHeadline(from: string, to: string, venueLabel: string, fetchedAt: number): string {
  const d = kstDate(fetchedAt);
  return `${dots(from)} ~ ${dots(to)} · ${venueLabel} · ${d.slice(5, 7)}/${d.slice(8)} ${kstHHMM(fetchedAt)} 받음`;
}

/** 거래가 0건일 때 가장 가까웠던 순간. */
export function nearMissText(nm: { maxDropPct: number; declineDays: number }, s: Strategy): string {
  const drop = `${(Math.round(nm.maxDropPct * 10) / 10).toFixed(1)}%`;
  const cond = s.entry.decline.dropPct;
  if (cond.on && nm.maxDropPct < cond.value) return `가장 크게 빠진 때도 ${drop}였어요(조건 ${cond.value}%)`;
  if (nm.declineDays > 0) return `하락 조건을 만족한 날이 ${nm.declineDays}일 있었지만 매수 트리거가 나지 않았어요`;
  return `가장 크게 빠진 때는 ${drop}였어요`;
}

/** 건너뛴 이유 중 가장 많은 것(같으면 먼저 나온 것). */
export function dominantSkipReason(skipped: Skip[]): Skip['reason'] | null {
  const count = new Map<Skip['reason'], number>();
  for (const k of skipped) count.set(k.reason, (count.get(k.reason) ?? 0) + 1);
  let best: Skip['reason'] | null = null;
  for (const [r, n] of count) if (best === null || n > count.get(best)!) best = r;
  return best;
}

export const LIMITATIONS = [
  '배당 제외 · 가격 수익률만이에요',
  '지금 관심종목만 넣을 수 있어서 상장폐지 종목이 빠져요(생존 편향)',
  '일봉으로 계산해서 하루 안의 순서는 시가→저가→고가→종가로 가정해요',
] as const;
