import { kstDate, kstMinuteOfDay } from '../../../src/lib/time/kst';
import type { Bar10, IndexQuote } from '../naverMarket';
import { fitLine, stdev } from './regress';

export const STEP_MS = 600_000;
const regular = (end: number) => kstMinuteOfDay(end) >= 540 && kstMinuteOfDay(end) <= 930;

/** 정규장 안에서 정확히 10분 간격이고 날짜가 같은 봉만 짝짓는다. */
export function returns10(bars: Bar10[]): Map<number, number> {
  const sorted = [...bars].sort((a, b) => a.end - b.end);
  const ret = new Map<number, number>();
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1], b = sorted[i];
    if (!regular(a.end) || !regular(b.end) || b.end - a.end !== STEP_MS || kstDate(a.end) !== kstDate(b.end) || a.close <= 0 || b.close <= 0) continue;
    const value = Math.log(b.close / a.close);
    if (Number.isFinite(value)) ret.set(b.end, value);
  }
  return ret;
}

export interface Spike { sym: 'ES' | 'NQ'; end: number; change: number; sigma: number }

export function detectSpike(sym: 'ES' | 'NQ', bars: Bar10[], now: number, spikeSigma: number): Spike | null {
  const completed = bars.filter((b) => b.end <= now).sort((a, b) => a.end - b.end);
  const last = completed.at(-1);
  if (!last || now - last.end > 30 * 60_000) return null;
  const ret = returns10(completed), change = ret.get(last.end);
  if (change === undefined) return null;
  // 판정 중인 봉을 기준 분산에 넣어 급변 자체가 기준을 키우지 않게 한다.
  const history = [...ret].filter(([end]) => end < last.end).map(([, r]) => r);
  if (history.length < 60) return null;
  const sigma = stdev(history);
  return sigma > 0 && Math.abs(change) >= spikeSigma * sigma ? { sym, end: last.end, change, sigma } : null;
}

export interface Mover { code: string; name: string; expected: number }
export function rankMovers(spike: Spike, futRet: Map<number, number>, stocks: { code: string; name: string; ret: Map<number, number> }[], top: number): { up: Mover[]; down: Mover[] } {
  const movers = stocks.flatMap((stock) => {
    const pairs = [...stock.ret].filter(([end]) => futRet.has(end));
    const fit = fitLine(pairs.map(([end]) => futRet.get(end)!), pairs.map(([, r]) => r), 30);
    return fit ? [{ code: stock.code, name: stock.name, expected: fit.beta * spike.change }] : [];
  });
  return {
    up: movers.filter((m) => m.expected > 0).sort((a, b) => b.expected - a.expected).slice(0, top),
    down: movers.filter((m) => m.expected < 0).sort((a, b) => a.expected - b.expected).slice(0, top),
  };
}

export interface WatchState {
  lastBar: Partial<Record<'ES' | 'NQ', number>>;
  lastSent: Partial<Record<'ES' | 'NQ', number>>;
  sentByDate: Record<string, number>;
  loginNotified?: string;
}
export function allowSend(st: WatchState, spike: Spike, now: number, cooldownMin: number, dailyMax: number): boolean {
  if (st.lastBar[spike.sym] === spike.end) return false;
  const last = st.lastSent[spike.sym];
  if (cooldownMin > 0 && last !== undefined && now - last < cooldownMin * 60_000) return false;
  return !(dailyMax > 0 && (st.sentByDate[kstDate(now)] ?? 0) >= dailyMax);
}
export function markSent(st: WatchState, spike: Spike, now: number): WatchState {
  const date = kstDate(now);
  return { ...st, lastBar: { ...st.lastBar, [spike.sym]: spike.end }, lastSent: { ...st.lastSent, [spike.sym]: now }, sentByDate: { ...st.sentByDate, [date]: (st.sentByDate[date] ?? 0) + 1 } };
}

const clock = (ms: number) => {
  const m = kstMinuteOfDay(ms);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const signed = (n: number, digits = 1) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(digits)}`;
export function formatSpike(spike: Spike, movers: { up: Mover[]; down: Mover[] }, ref: { oil?: IndexQuote; rate?: IndexQuote; dollar?: IndexQuote }, missing: string[]): { title: string; body: string } {
  const lines: string[] = [];
  const list = (items: Mover[]) => items.map((m) => `· ${m.name} ${signed(Math.expm1(m.expected) * 100)}%`);
  const block = (title: string, items: Mover[]) => lines.push(title, ...(items.length ? list(items) : ['· 없음']));
  if (spike.change < 0 || movers.down.length) block('같이 내릴 것 같은 종목', movers.down);
  if (spike.change >= 0 || movers.up.length) block('같이 오를 것 같은 종목', movers.up);
  const refs: string[] = [];
  if (ref.oil?.changePct != null) refs.push(`유가 ${signed(ref.oil.changePct)}%`);
  if (ref.dollar?.changePct != null) refs.push(`달러 ${signed(ref.dollar.changePct)}%`);
  if (ref.rate?.changeAbs != null) refs.push(`미국 금리 ${signed(ref.rate.changeAbs, 2)}%p`);
  if (refs.length) lines.push('', `참고(어제보다): ${refs.join(', ')}`);
  if (missing.length) lines.push(`못 가져온 자료: ${missing.map((m) => ({ ES: 'S&P 선물', NQ: '나스닥 선물' } as Record<string, string>)[m] ?? m).join(', ')}`);
  lines.push(`${clock(spike.end - STEP_MS)}~${clock(spike.end)} 움직임이에요(자료가 10분 늦게 들어와요)`);
  const label = spike.sym === 'ES' ? 'S&P' : '나스닥';
  return {
    title: `장중 알림 · ${label} 선물 10분 새 ${signed(Math.expm1(spike.change) * 100)}% ${spike.change < 0 ? '급락' : '급등'}`,
    body: lines.join('\n'),
  };
}
