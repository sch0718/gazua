// 결과 스냅샷(simResult·validation)의 결과 부분 검사(설계 2.7). sync-worker가 함께 쓴다: DOM·계산 코드 의존 금지.
// 원칙은 snapshot.ts와 같다. 모르는 필드는 unknown-field, 모양·값이 틀리면 invalid, 가리키는 곳이 없으면 reference. 고쳐 받지 않는다.
import {
  BY_MARKET_KEYS,
  MISSING_REASONS,
  NOT_BOUGHT_REASONS,
  SELL_KINDS,
  SHARE_SYMBOL_RE,
  SIM_FAILURE_REASONS,
  SKIP_REASONS,
  TRADE_KINDS,
  VALIDATION_NOTES,
  VALUE_KEY_RULE,
} from './resultEnums';
import type { ShareAxis } from './snapshot';

/** 10년 일봉 여유 */
export const AXIS_MAX = 3700;
export const REASON_MAX = 40;
export const SOURCE_MAX = 30;
export const NAME_MAX = 30;
/** 선정 기준 상위 N의 한도(TAKE_MAX) */
export const PICKS_MAX = 30;

export type ResultFail = { code: 'invalid' | 'unknown-field' | 'reference'; path: string };

type Row = Record<string, unknown>;
const isRecord = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v);
const bad = (path: string): ResultFail => ({ code: 'invalid', path });
const ref = (path: string): ResultFail => ({ code: 'reference', path });
const at = (path: string, k: string | number) => (typeof k === 'number' ? `${path}[${k}]` : `${path}.${k}`);

function keys(v: unknown, want: readonly string[], path: string): ResultFail | null {
  if (!isRecord(v)) return bad(path);
  for (const k of Object.keys(v)) if (!want.includes(k)) return { code: 'unknown-field', path: at(path, k) };
  for (const k of want) if (!Object.hasOwn(v, k)) return bad(at(path, k));
  return null;
}

const isInt = (x: unknown, min = 0): x is number => Number.isInteger(x) && (x as number) >= min;
/** 소수 둘째 자리 이하의 유한수 */
const is2 = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && Math.round(x * 100) / 100 === x;
const is2n = (x: unknown): x is number | null => x === null || is2(x);
const isSym = (x: unknown): x is string => typeof x === 'string' && SHARE_SYMBOL_RE.test(x);
const isText = (x: unknown, max: number): x is string => typeof x === 'string' && x.length >= 1 && x.length <= max;
const oneOf = <T extends string>(list: readonly T[], x: unknown): x is T => typeof x === 'string' && (list as readonly string[]).includes(x);

// ── 날짜 ──────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const utc = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export function isIsoDate(s: unknown): s is string {
  return typeof s === 'string' && DATE_RE.test(s) && iso(utc(s)) === s;
}
/** start(KST YYYY-MM-DD)에서 offset 달력 일 뒤 */
export function axisDate(start: string, offset: number): string {
  return iso(utc(start) + offset * 86_400_000);
}
/** start에서 date까지 달력 일수 */
export function dayOffset(start: string, date: string): number {
  return Math.round((utc(date) - utc(start)) / 86_400_000);
}

// ── 공통 조각 ──────────────────────────────────────────

function checkAxis(v: unknown, path: string): ResultFail | null {
  const k = keys(v, ['start', 'offsets'], path);
  if (k) return k;
  const a = v as Row;
  const o = a.offsets;
  if (!isIsoDate(a.start) || !Array.isArray(o) || o.length < 1 || o.length > AXIS_MAX || o[0] !== 0) return bad(path);
  for (let i = 1; i < o.length; i++) if (!isInt(o[i]) || (o[i] as number) <= (o[i - 1] as number)) return bad(path);
  return null;
}

function checkCurve(v: unknown, n: number, path: string, nullable: boolean): ResultFail | null {
  if (!Array.isArray(v) || v.length !== n) return bad(path);
  return v.every((x) => is2(x) || (nullable && x === null)) ? null : bad(path);
}

function checkSampled(v: unknown, n: number, path: string): ResultFail | null {
  if (v === null) return null;
  const k = keys(v, ['from'], path);
  if (k) return k;
  return isInt((v as Row).from) && ((v as Row).from as number) > n ? null : bad(path);
}

function checkStats(v: unknown, path: string): ResultFail | null {
  const k = keys(v, ['totalPct', 'cagrPct', 'mddPct', 'volPct'], path);
  if (k) return k;
  for (const f of ['totalPct', 'cagrPct', 'mddPct', 'volPct']) if (!is2((v as Row)[f])) return bad(at(path, f));
  return null;
}

/** [이유, 개수] 목록: SKIP_REASONS 순서, 중복 없음. 개수 합을 돌려준다 */
function checkCounts(v: unknown, path: string): ResultFail | number {
  if (!Array.isArray(v)) return bad(path);
  let last = -1;
  let sum = 0;
  for (const c of v) {
    if (!Array.isArray(c) || c.length !== 2 || !isInt(c[1])) return bad(path);
    const i = SKIP_REASONS.indexOf(c[0]);
    if (i <= last) return bad(path);
    last = i;
    sum += c[1];
  }
  return sum;
}

/** 곡선·이유·통계 세 짝: 곡선이 없으면 이유가 있고 통계가 없다 */
function checkTrio(v: Row, n: number, path: string): ResultFail | null {
  if (v.curve === null) return oneOf(MISSING_REASONS, v.reason) && v.stats === null ? null : bad(path);
  if (v.reason !== null) return bad(path);
  return checkCurve(v.curve, n, at(path, 'curve'), false) ?? checkStats(v.stats, at(path, 'stats'));
}

function checkPairs(v: unknown, valueKeys: readonly string[], path: string): ResultFail | null {
  if (!Array.isArray(v) || v.length % 2 !== 0) return bad(path);
  const seen = new Set<number>();
  for (let i = 0; i < v.length; i += 2) {
    const k = v[i];
    const x = v[i + 1];
    if (!isInt(k) || k >= valueKeys.length || seen.has(k)) return bad(path);
    seen.add(k);
    const rule = VALUE_KEY_RULE[valueKeys[k]];
    if (rule === 'bool') {
      if (typeof x !== 'boolean') return bad(path);
    } else if (x !== null) {
      if (typeof x !== 'number' || !Number.isFinite(x)) return bad(path);
      if (rule === 'int' ? !Number.isInteger(x) : Number(x.toPrecision(4)) !== x) return bad(path);
    }
  }
  return null;
}

// ── 실행 머리 ──────────────────────────────────────────

/** run.from·to는 축의 첫날·마지막 날. 축은 결과 검사가 먼저 확인했다 */
export function checkRun(v: unknown, axis: ShareAxis, path = 'run'): ResultFail | null {
  const k = keys(v, ['from', 'to', 'source', 'demo', 'fetchedAt'], path);
  if (k) return k;
  const r = v as Row;
  if (r.from !== axis.start) return bad(at(path, 'from'));
  if (r.to !== axisDate(axis.start, axis.offsets[axis.offsets.length - 1])) return bad(at(path, 'to'));
  if (!isText(r.source, SOURCE_MAX)) return bad(at(path, 'source'));
  if (typeof r.demo !== 'boolean') return bad(at(path, 'demo'));
  if (!isInt(r.fetchedAt, 1)) return bad(at(path, 'fetchedAt'));
  return null;
}

// ── 시뮬레이션 결과 ─────────────────────────────────────

const SIM_KEYS = ['axis', 'sampled', 'curves', 'summary', 'benchmarks', 'indexFailed', 'benchmarkFailed', 'symbols', 'trades', 'perSymbol', 'skipped', 'nearMiss', 'failed'];
const SUMMARY_INT = ['wins', 'losses', 'roundTrips', 'openPositions', 'skippedSignals'];
const SUMMARY_2 = ['totalReturnPct', 'cagrPct', 'mddPct', 'avgCashPct', 'vsHoldPp'];
const SUMMARY_2N = ['winRatePct', 'avgWinPct', 'avgLossPct', 'avgHoldDays', 'vsIndexPp', 'vsBenchmarkPp'];

export function checkSimResult(v: unknown, ctx: { universe: readonly string[]; capitalHidden: boolean }, path = 'result'): ResultFail | null {
  const k0 = keys(v, SIM_KEYS, path);
  if (k0) return k0;
  const r = v as Row;
  const axisFail = checkAxis(r.axis, at(path, 'axis'));
  if (axisFail) return axisFail;
  const offsets = (r.axis as ShareAxis).offsets;
  const n = offsets.length;
  const lastDay = offsets[n - 1];
  const sampled = checkSampled(r.sampled, n, at(path, 'sampled'));
  if (sampled) return sampled;

  const cp = at(path, 'curves');
  const ck = keys(r.curves, ['strategy', 'hold', 'index', 'benchmark'], cp);
  if (ck) return ck;
  const curves = r.curves as Row;
  for (const name of ['strategy', 'hold'])
    if (checkCurve(curves[name], n, at(cp, name), false)) return bad(at(cp, name));
  for (const name of ['index', 'benchmark'])
    if (curves[name] !== null && checkCurve(curves[name], n, at(cp, name), true)) return bad(at(cp, name));

  const sp = at(path, 'summary');
  const sk = keys(r.summary, [...SUMMARY_INT, ...SUMMARY_2, ...SUMMARY_2N], sp);
  if (sk) return sk;
  const sum = r.summary as Row;
  for (const f of SUMMARY_INT) if (!isInt(sum[f])) return bad(at(sp, f));
  for (const f of SUMMARY_2) if (!is2(sum[f])) return bad(at(sp, f));
  for (const f of SUMMARY_2N) if (!is2n(sum[f])) return bad(at(sp, f));

  const bp = at(path, 'benchmarks');
  const bk = keys(r.benchmarks, ['holdReturnPct', 'indexReturnPct', 'benchmarkReturnPct'], bp);
  if (bk) return bk;
  const bm = r.benchmarks as Row;
  if (!is2(bm.holdReturnPct)) return bad(at(bp, 'holdReturnPct'));
  if (!is2n(bm.indexReturnPct)) return bad(at(bp, 'indexReturnPct'));
  if (!is2n(bm.benchmarkReturnPct)) return bad(at(bp, 'benchmarkReturnPct'));
  if (r.indexFailed !== null && !oneOf(MISSING_REASONS, r.indexFailed)) return bad(at(path, 'indexFailed'));
  if (typeof r.benchmarkFailed !== 'boolean') return bad(at(path, 'benchmarkFailed'));

  const symbols = r.symbols;
  if (!Array.isArray(symbols) || symbols.length < 1 || symbols.length > 8 || !symbols.every(isSym) || new Set(symbols).size !== symbols.length)
    return bad(at(path, 'symbols'));
  if (symbols.length !== ctx.universe.length || symbols.some((s, i) => s !== ctx.universe[i])) return bad(at(path, 'symbols'));
  const symAt = (i: unknown) => isInt(i) && i < symbols.length;

  // 거래: 날짜 오름차순(같은 날 허용), 종류별 단계·손익 규칙, 자금 숨김이면 수량 null
  const tp = at(path, 'trades');
  if (!Array.isArray(r.trades)) return bad(tp);
  let prevDay = 0;
  for (const [i, t] of r.trades.entries()) {
    const p = at(tp, i);
    if (!Array.isArray(t) || t.length !== 8) return bad(p);
    const [day, sym, kind, stage, price, qty, reason, pnlPct] = t;
    if (!isInt(day) || day > lastDay || day < prevDay) return bad(p);
    prevDay = day;
    if (!isInt(sym)) return bad(p);
    if (!symAt(sym)) return ref(p);
    if (!oneOf(TRADE_KINDS, kind)) return bad(p);
    const sell = oneOf(SELL_KINDS, kind);
    const staged = kind === 'take' || kind === 'gapTake';
    if (staged ? !(isInt(stage, 1) && stage <= 3) : stage !== null) return bad(p);
    if (!isInt(price, 1)) return bad(p);
    if (ctx.capitalHidden ? qty !== null : !isInt(qty, 1)) return bad(p);
    if (!isText(reason, REASON_MAX)) return bad(p);
    if (sell ? !is2(pnlPct) : pnlPct !== null) return bad(p);
  }

  // 종목별: symbols 순서, 중복 없음 / failed: symbols 안, 종목별과 겹치지 않음, 둘을 합치면 symbols
  const pp = at(path, 'perSymbol');
  if (!Array.isArray(r.perSymbol)) return bad(pp);
  const inPer = new Set<number>();
  let prevSym = -1;
  for (const [i, row] of r.perSymbol.entries()) {
    const p = at(pp, i);
    if (!Array.isArray(row) || row.length !== 5) return bad(p);
    const [sym, pnl, pnlPct, roundTrips, firstDay] = row;
    if (!isInt(sym)) return bad(p);
    if (!symAt(sym)) return ref(p);
    if (ctx.capitalHidden ? pnl !== null : !Number.isInteger(pnl)) return bad(p);
    if (!is2(pnlPct) || !isInt(roundTrips)) return bad(p);
    if (firstDay !== null && !(isInt(firstDay) && firstDay <= lastDay)) return bad(p);
    if (sym <= prevSym) return bad(pp);
    prevSym = sym;
    inPer.add(sym);
  }
  const fp = at(path, 'failed');
  if (!Array.isArray(r.failed)) return bad(fp);
  const failedSyms = new Set<string>();
  for (const [i, f] of r.failed.entries()) {
    const p = at(fp, i);
    const fk = keys(f, ['symbol', 'reason'], p);
    if (fk) return fk;
    const row = f as Row;
    if (!isSym(row.symbol) || !oneOf(SIM_FAILURE_REASONS, row.reason)) return bad(p);
    const idx = symbols.indexOf(row.symbol);
    if (idx < 0) return ref(p);
    if (inPer.has(idx) || failedSyms.has(row.symbol)) return bad(fp);
    failedSyms.add(row.symbol);
  }
  if (r.perSymbol.length + r.failed.length !== symbols.length) return bad(pp);

  // 건너뜀: 이유별 개수(합 = summary.skippedSignals), 목록이 있으면 개수와 맞는다
  const kp = at(path, 'skipped');
  const kk = keys(r.skipped, ['counts', 'rows'], kp);
  if (kk) return kk;
  const skipped = r.skipped as Row;
  const total = checkCounts(skipped.counts, at(kp, 'counts'));
  if (typeof total !== 'number') return total;
  if (total !== sum.skippedSignals) return bad(at(kp, 'counts'));
  if (skipped.rows !== null) {
    const rp = at(kp, 'rows');
    if (!Array.isArray(skipped.rows)) return bad(rp);
    const byReason = new Array<number>(SKIP_REASONS.length).fill(0);
    for (const [i, row] of skipped.rows.entries()) {
      const p = at(rp, i);
      if (!Array.isArray(row) || row.length !== 3) return bad(p);
      const [day, sym, reason] = row;
      if (!isInt(day) || day > lastDay || !isInt(reason) || reason >= SKIP_REASONS.length) return bad(p);
      if (!isInt(sym)) return bad(p);
      if (!symAt(sym)) return ref(p);
      byReason[reason]++;
    }
    const counted = new Map((skipped.counts as [string, number][]).map(([reason, c]) => [reason, c]));
    if (SKIP_REASONS.some((reason, i) => (counted.get(reason) ?? 0) !== byReason[i])) return bad(rp);
  }

  if (r.nearMiss !== null) {
    const np = at(path, 'nearMiss');
    const nk = keys(r.nearMiss, ['maxDropPct', 'declineDays'], np);
    if (nk) return nk;
    const nm = r.nearMiss as Row;
    if (!is2(nm.maxDropPct) || !isInt(nm.declineDays)) return bad(np);
  }
  return null;
}

// ── 검증 결과 ─────────────────────────────────────────

const VAL_KEYS = ['axis', 'sampled', 'hold', 'trading', 'indices', 'benchmarks', 'byMarket', 'history', 'valueKeys', 'rebalances', 'today', 'notes'];

export function checkValidation(v: unknown, ctx: { indices: readonly string[]; benchSymbols: readonly string[] }, path = 'result'): ResultFail | null {
  const k0 = keys(v, VAL_KEYS, path);
  if (k0) return k0;
  const r = v as Row;
  const axisFail = checkAxis(r.axis, at(path, 'axis'));
  if (axisFail) return axisFail;
  const offsets = (r.axis as ShareAxis).offsets;
  const n = offsets.length;
  const sampled = checkSampled(r.sampled, n, at(path, 'sampled'));
  if (sampled) return sampled;

  const hp = at(path, 'hold');
  const hk = keys(r.hold, ['curve', 'stats', 'beat'], hp);
  if (hk) return hk;
  const hold = r.hold as Row;
  const hc = checkCurve(hold.curve, n, at(hp, 'curve'), false) ?? checkStats(hold.stats, at(hp, 'stats'));
  if (hc) return hc;
  if (hold.beat !== null) {
    const bk = keys(hold.beat, ['beat', 'total'], at(hp, 'beat'));
    if (bk) return bk;
    const b = hold.beat as Row;
    if (!isInt(b.beat) || !isInt(b.total) || b.beat > b.total) return bad(at(hp, 'beat'));
  }

  if (r.trading !== null) {
    const tp = at(path, 'trading');
    const tk = keys(r.trading, ['curve', 'stats', 'trades', 'skipCounts'], tp);
    if (tk) return tk;
    const t = r.trading as Row;
    const tc = checkCurve(t.curve, n, at(tp, 'curve'), false) ?? checkStats(t.stats, at(tp, 'stats'));
    if (tc) return tc;
    if (!isInt(t.trades)) return bad(at(tp, 'trades'));
    const c = checkCounts(t.skipCounts, at(tp, 'skipCounts'));
    if (typeof c !== 'number') return c;
  }

  const ip = at(path, 'indices');
  if (!Array.isArray(r.indices) || r.indices.length !== ctx.indices.length) return bad(ip);
  for (const [i, x] of r.indices.entries()) {
    const p = at(ip, i);
    const xk = keys(x, ['id', 'curve', 'reason', 'stats'], p);
    if (xk) return xk;
    const row = x as Row;
    if (row.id !== ctx.indices[i]) return bad(p);
    const trio = checkTrio(row, n, p);
    if (trio) return bad(p);
  }

  const bp = at(path, 'benchmarks');
  if (!Array.isArray(r.benchmarks) || r.benchmarks.length !== ctx.benchSymbols.length) return bad(bp);
  for (const [i, x] of r.benchmarks.entries()) {
    const p = at(bp, i);
    const xk = keys(x, ['symbol', 'name', 'curve', 'reason', 'stats'], p);
    if (xk) return xk;
    const row = x as Row;
    if (row.symbol !== ctx.benchSymbols[i] || !isText(row.name, NAME_MAX)) return bad(p);
    if (checkTrio(row, n, p)) return bad(p);
  }

  const mp = at(path, 'byMarket');
  if (!Array.isArray(r.byMarket) || r.byMarket.length !== BY_MARKET_KEYS.length) return bad(mp);
  for (const [i, x] of r.byMarket.entries()) {
    const p = at(mp, i);
    const xk = keys(x, ['key', 'inPool', 'stats', 'avgPicked'], p);
    if (xk) return xk;
    const row = x as Row;
    if (row.key !== BY_MARKET_KEYS[i] || typeof row.inPool !== 'boolean' || !is2(row.avgPicked) || row.avgPicked < 0) return bad(p);
    const st = checkStats(row.stats, at(p, 'stats'));
    if (st) return st;
  }

  if (!oneOf(['full', 'noValues', 'codes'] as const, r.history)) return bad(at(path, 'history'));
  const history = r.history;
  const vp = at(path, 'valueKeys');
  const vk = r.valueKeys;
  if (!Array.isArray(vk) || !vk.every((x) => typeof x === 'string' && Object.hasOwn(VALUE_KEY_RULE, x)) || new Set(vk).size !== vk.length) return bad(vp);
  const valueKeys = vk as string[];

  const daySet = new Set(offsets);
  const rp = at(path, 'rebalances');
  if (!Array.isArray(r.rebalances)) return bad(rp);
  let prev = -1;
  for (const [i, x] of r.rebalances.entries()) {
    const p = at(rp, i);
    const xk = keys(x, ['day', 'passed', 'picks'], p);
    if (xk) return xk;
    const row = x as Row;
    if (!isInt(row.day) || !daySet.has(row.day) || row.day <= prev) return bad(p);
    prev = row.day;
    if (!isInt(row.passed) || !Array.isArray(row.picks) || row.picks.length > Math.min(row.passed, PICKS_MAX)) return bad(p);
    const pk = at(p, 'picks');
    const seen = new Set<string>();
    for (const [j, pick] of row.picks.entries()) {
      const pj = at(pk, j);
      let symbol: unknown;
      if (history === 'codes') {
        if (Array.isArray(pick)) return bad(pk);
        symbol = pick;
      } else {
        if (!Array.isArray(pick)) return bad(pk);
        if (pick.length !== 4) return bad(pj);
        const [sym, retPct, mark, values] = pick;
        symbol = sym;
        if (!is2n(retPct) || !(mark === 0 || mark === 1 || oneOf(NOT_BOUGHT_REASONS, mark))) return bad(pj);
        if (history === 'full' ? checkPairs(values, valueKeys, pj) : values !== null) return bad(pj);
      }
      if (!isSym(symbol)) return bad(history === 'codes' ? pk : pj);
      if (seen.has(symbol)) return bad(pk);
      seen.add(symbol);
    }
  }

  const tdp = at(path, 'today');
  const tdk = keys(r.today, ['date', 'passed', 'picks'], tdp);
  if (tdk) return tdk;
  const today = r.today as Row;
  if (!isIsoDate(today.date)) return bad(at(tdp, 'date'));
  if (!isInt(today.passed) || !Array.isArray(today.picks) || today.picks.length > Math.min(today.passed, PICKS_MAX)) return bad(tdp);
  const seenToday = new Set<string>();
  for (const [j, pick] of today.picks.entries()) {
    const pj = at(at(tdp, 'picks'), j);
    const pk = keys(pick, ['symbol', 'values'], pj);
    if (pk) return pk;
    const row = pick as Row;
    if (!isSym(row.symbol) || seenToday.has(row.symbol)) return bad(pj);
    seenToday.add(row.symbol);
    if (checkPairs(row.values, valueKeys, pj)) return bad(pj);
  }

  const np = at(path, 'notes');
  if (!Array.isArray(r.notes) || !r.notes.every((x) => oneOf(VALIDATION_NOTES, x)) || new Set(r.notes).size !== r.notes.length) return bad(np);
  return null;
}
