// 시뮬레이션 화면의 문구. 목업의 한 줄 요약과 같은 말투로 쓴다.
import { resolveSymbols, type Issue } from '../../sim/validate';
import type { Strategy } from '../../sim/types';
import type { Watchlists } from '../../state/schema';
import { fmtWon } from '../format';

const dots = (d: string) => d.replaceAll('-', '.');
const MINUS = '−';

/**
 * 수익률 표시. 소수 첫째 자리, 음수는 진짜 빼기 기호(U+2212).
 * format.ts의 fmtPct(▲▼·소수 둘째 자리)와 모양이 달라 따로 둔다.
 */
export function fmtPct(v: number, signed = false): string {
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
