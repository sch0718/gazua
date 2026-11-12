import type { DayBar, IndexQuote } from '../naverMarket';
import type { FredSeries } from './fred';
import { fitLine, type Fit } from './regress';

/** 날짜가 같은 봉은 아직 진행 중인 세션이므로 쓰지 않는다. */
export function futAt(fut: DayBar[], date: string): number | null {
  let last: DayBar | undefined;
  for (const b of fut) {
    if (b.date < date && b.close > 0 && Number.isFinite(b.close) && (!last || b.date > last.date)) last = b;
  }
  return last?.close ?? null;
}

/** 오늘 예상의 x: 학습과 같은 정의(국내 전 거래일 → 오늘). 연휴로 쌓인 세션도 그대로 들어간다 */
export function todayX(fut: DayBar[], prevDate: string, today: string): number | null {
  const a = futAt(fut, prevDate), b = futAt(fut, today);
  return a === null || b === null ? null : Math.log(b / a);
}

export interface Sample { date: string; x: number; y: number }
export function samples(stock: DayBar[], fut: DayBar[]): Sample[] {
  const sorted = [...stock].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.slice(1).flatMap((b, i) => {
    const prev = sorted[i], before = futAt(fut, prev.date), after = futAt(fut, b.date);
    if (before === null || after === null || b.open <= 0 || prev.close <= 0) return [];
    const x = Math.log(after / before), y = Math.log(b.open / prev.close);
    return Number.isFinite(x) && Number.isFinite(y) && Math.abs(y) <= 0.3 ? [{ date: b.date, x, y }] : [];
  });
}

export interface Model { sym: 'ES' | 'NQ'; fit: Fit }
export function fitModel(byFut: { ES: Sample[]; NQ: Sample[] }, asOf: string): Model | null {
  let best: Model | null = null;
  for (const sym of ['ES', 'NQ'] as const) {
    const train = byFut[sym].filter((s) => s.date < asOf && Number.isFinite(s.x) && Number.isFinite(s.y)).sort((a, b) => a.date.localeCompare(b.date)).slice(-250);
    const fit = fitLine(train.map((s) => s.x), train.map((s) => s.y), 120);
    if (fit && (!best || fit.r2 > best.fit.r2)) best = { sym, fit };
  }
  return best;
}

export const predict = (m: Model, x: number): number => Math.expm1(m.fit.alpha + m.fit.beta * x);
export interface Backtest { hit: number; baseUp: number; n: number; days: number }
export function backtest(stocks: { ES: Sample[]; NQ: Sample[] }[], days = 60): Backtest {
  const dates = [...new Set(stocks.flatMap((s) => [...s.ES, ...s.NQ].map((p) => p.date)))].sort().slice(-days);
  let hit = 0, n = 0, up = 0;
  const evaluated = new Set<string>();
  for (const date of dates) {
    for (const stock of stocks) {
      const m = fitModel(stock, date);
      if (!m) continue;
      const s = stock[m.sym].find((s) => s.date === date);
      if (!s || s.y === 0 || !Number.isFinite(s.y)) continue;
      const expected = predict(m, s.x);
      if (!Number.isFinite(expected)) continue;
      n++;
      if (Math.sign(expected) === Math.sign(s.y)) hit++;
      if (s.y > 0) up++;
      evaluated.add(date);
    }
  }
  return { hit: n ? hit / n : 0, baseUp: n ? up / n : 0, n, days: evaluated.size };
}

export type Side = 'same' | 'opposite';
export function macroSide(stockClose: DayBar[], fred: FredSeries, kind: 'oil' | 'dollar' | 'rate'): Side | null {
  const changes = new Map<string, number>();
  for (let i = 1; i < fred.d.length; i++) {
    const a = fred.v[i - 1], b = fred.v[i];
    const x = kind === 'rate' ? b - a : a > 0 && b > 0 ? Math.log(b / a) : NaN;
    const date = fred.d[i].replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
    if (Number.isFinite(x)) changes.set(date, x);
  }
  // 미국 날짜 d의 변화는 국내 d 장 마감 뒤에 나온다. 국내 전 거래일 a~t 종가 변화는 a <= d < t인 마지막 미국 날짜의 변화와 짝짓는다(없으면 뺀다).
  const usDates = [...changes.keys()].sort();
  const between = (from: string, to: string): number | undefined => {
    let lo = 0, hi = usDates.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (usDates[mid] < to) lo = mid + 1; else hi = mid; }
    const d = lo > 0 ? usDates[lo - 1] : undefined;
    return d !== undefined && d >= from ? changes.get(d) : undefined;
  };
  const sorted = [...stockClose].sort((a, b) => a.date.localeCompare(b.date));
  const pairs = sorted.slice(1).flatMap((b, i) => {
    const a = sorted[i], x = between(a.date, b.date);
    const y = a.close > 0 && b.close > 0 ? Math.log(b.close / a.close) : NaN;
    return x !== undefined && Number.isFinite(y) ? [{ x, y }] : [];
  }).slice(-250);
  const fit = fitLine(pairs.map((p) => p.x), pairs.map((p) => p.y), 120);
  return fit && Math.abs(fit.t) >= 2 ? (fit.beta > 0 ? 'same' : 'opposite') : null;
}

const signed = (n: number, digits = 1) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(digits)}`;
const FUT_LABEL: Record<string, string> = { ES: 'S&P 선물', NQ: '나스닥 선물' };
const plain = (names: string[]) => names.map((n) => FUT_LABEL[n] ?? n);
interface Pick { name: string; pct: number; sym: string }
export function formatPremarket(args: {
  esPct: number | null; nqPct: number | null; session: string; up: Pick[]; down: Pick[];
  macro: { kind: 'oil' | 'rate' | 'dollar'; quote: IndexQuote; same: string[]; opposite: string[] }[];
  record: Backtest & { source: '기록' | '백테스트' }; missing: string[]; statusUnknown: boolean;
}): { title: string; body: string } {
  const lines: string[] = [];
  const list = (picks: Pick[]) => picks.map((p) => `· ${p.name} ${signed(p.pct * 100)}%`);
  if (args.up.length) lines.push('오를 것 같은 종목', ...list(args.up));
  if (args.down.length) lines.push('내릴 것 같은 종목', ...list(args.down));
  if (!args.up.length && !args.down.length) lines.push('예상할 수 있는 종목이 없어요');
  const extra: string[] = [];
  for (const m of args.macro) {
    const value = m.kind === 'rate' ? m.quote.changeAbs : m.quote.changePct;
    if (value === null || (!m.same.length && !m.opposite.length)) continue;
    const label = { oil: '유가', rate: '미국 금리', dollar: '달러' }[m.kind];
    const change = m.kind === 'rate' ? `${signed(value, 2)}%p` : `${signed(value)}%`;
    const rose = value >= 0;
    const groups = [[m.same, rose], [m.opposite, !rose]] as const;
    const parts = groups.filter(([names]) => names.length).map(([names, up]) => `${up ? '오르는' : '내리는'} 편: ${names.join('·')}`);
    extra.push(`${label} ${rose ? '올랐어요' : '내렸어요'}(${change}) → 보통 ${parts.join(' / ')}`);
  }
  if (extra.length) lines.push('', ...extra);
  const r = args.record;
  lines.push('', `${r.source === '기록' ? '실제 알림' : '지난 자료로 시험해 보니'} 최근 ${r.days}일 방향 적중 ${(r.hit * 100).toFixed(0)}% (「매일 오른다」로 찍으면 ${(r.baseUp * 100).toFixed(0)}%)`);
  if (args.statusUnknown) lines.push('오늘 장이 열리는지 확인하지 못했어요');
  if (args.missing.length) lines.push(`못 가져온 자료: ${plain(args.missing).join(', ')}`);
  lines.push('과거 흐름으로 본 예상일 뿐, 투자 조언이 아니에요');
  const moves = [['S&P', args.esPct], ['나스닥', args.nqPct]] as const;
  const known = moves.filter(([, v]) => v !== null) as [string, number][];
  const mood = !known.length ? '자료 없음' : known.every(([, v]) => v >= 0) ? '올랐어요' : known.every(([, v]) => v < 0) ? '내렸어요' : '엇갈렸어요';
  const detail = known.map(([k, v]) => `${k} ${signed(v * 100)}%`).join(', ');
  return { title: `아침 예상 · 밤사이 미국 선물 ${mood}${detail ? ` (${detail})` : ''}`, body: lines.join('\n') };
}
