import { addDays, kstDate, kstEpoch, kstMinuteOfDay } from '../../../src/lib/time/kst';
import { readAlertConfig, type AlertConfig } from '../alert/config';
import { fetchFredSeries } from '../alert/fred';
import { allowSend, detectSpike, formatSpike, markSent, rankMovers, returns10, STEP_MS, type WatchState } from '../alert/intraday';
import { backtest, fitModel, formatPremarket, futAt, macroSide, predict, samples, todayX, type Backtest } from '../alert/premarket';
import { appendLog, readLogs, readState, writeState, type LogLine } from '../alert/state';
import type { Command, Ctx } from '../context';
import { CliError } from '../errors';
import { NAVER, naverGet, parseDayBars, parseDomesticWeek, parseFuturesWeek, parseIndexQuote, parseMarketStatus, type Bar10, type DayBar, type IndexQuote, parseStockName } from '../naverMarket';
import { pickProfile } from '../profileData';
import { authedClient } from '../session';

export async function sendNtfy(ctx: Ctx, cfg: AlertConfig, msg: { title: string; body: string; tags?: string }): Promise<boolean> {
  let status = 0;
  try {
    const res = await ctx.fetch(cfg.server.replace(/\/+$/, ''), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: cfg.topic, title: msg.title, message: msg.body, ...(msg.tags ? { tags: msg.tags.split(',').map((t) => t.trim()).filter(Boolean) } : {}) }),
    });
    if (res.ok) return true;
    status = res.status;
  } catch { /* 통신 예외의 URL이나 토픽은 표시하지 않는다. */ }
  ctx.say(`ntfy 전송 실패: HTTP ${status}`);
  return false;
}

export async function targetSymbols(ctx: Ctx): Promise<{ code: string; name: string }[]> {
  if (ctx.args.symbols) return withNames(ctx, [...new Set(ctx.args.symbols)]);
  const profile = await pickProfile(authedClient(ctx), ctx.args.profile, ctx.now());
  const codes = new Set<string>();
  for (const group of profile.watchlists.groups) {
    for (const item of group.items) if (!item.hidden) codes.add(item.symbol);
  }
  return withNames(ctx, [...codes].slice(0, 30));
}

/** 동기화 문서에는 종목명이 없어 네이버에서 찾는다. 못 찾으면 코드로 표시한다. */
async function withNames(ctx: Ctx, codes: string[]): Promise<{ code: string; name: string }[]> {
  const out: { code: string; name: string }[] = [];
  for (const code of codes) out.push({ code, name: parseStockName(await get(ctx, NAVER.stockBasic(code))) ?? code });
  return out;
}

/** 네이버 오류 원문에는 URL이 들어갈 수 있어 해당 자료만 제외한다. */
async function get(ctx: Ctx, url: string): Promise<unknown> {
  try { return await naverGet(ctx, url); } catch { return null; }
}
const emptyState = (): WatchState => ({ lastBar: {}, lastSent: {}, sentByDate: {} });
function watchState(dir: string): WatchState {
  const st = readState<WatchState | null>(dir, 'watch', null);
  const numbers = (v: unknown) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((n) => typeof n === 'number' && Number.isFinite(n));
  return st && numbers(st.lastBar) && numbers(st.lastSent) && numbers(st.sentByDate) ? st : emptyState();
}

async function symbolsWithLogin(ctx: Ctx, cfg: AlertConfig, name: 'watch' | 'premarket', st: { loginNotified?: string }, notify = true): Promise<Awaited<ReturnType<typeof targetSymbols>>> {
  try { return await targetSymbols(ctx); } catch (e) {
    if (notify && e instanceof CliError && ['not-logged-in', 'cli-token-expired', 'cli-token-revoked'].includes(e.code)) {
      const date = kstDate(ctx.now());
      if (st.loginNotified !== date) {
        await sendNtfy(ctx, cfg, { title: 'gazua login 필요', body: '관심 종목을 읽으려면 gazua login을 실행해 주세요' });
        writeState(ctx.dir, name, { ...st, loginNotified: date });
      }
    }
    throw e;
  }
}

async function watch(ctx: Ctx): Promise<unknown> {
  const minute = kstMinuteOfDay(ctx.now());
  if (minute < 540 || minute > 930) return { skipped: 'hours' };
  const status = parseMarketStatus(await get(ctx, NAVER.kospiStatus));
  if (status !== null && status !== 'OPEN') return { skipped: 'closed' };
  const cfg = readAlertConfig(ctx.env);
  let st = watchState(ctx.dir);
  const futures: Partial<Record<'ES' | 'NQ', Bar10[]>> = {};
  const missing: string[] = [];
  for (const sym of ['ES', 'NQ'] as const) {
    // 선물 10분 자료는 10분 지연이라 end가 지난 봉도 아직 쌓이는 중이다. 한 봉 더 지난 것만 완성으로 본다.
    const bars = parseFuturesWeek(await get(ctx, NAVER.futuresWeek(sym))).filter((b) => b.end <= ctx.now() - STEP_MS);
    if (bars.length) futures[sym] = bars;
    else missing.push(sym);
  }
  if (!futures.ES && !futures.NQ) {
    ctx.say('선물 자료를 받지 못했어요');
    return { skipped: 'nodata' };
  }
  const spikes = (['ES', 'NQ'] as const).flatMap((sym) => {
    const spike = detectSpike(sym, futures[sym] ?? [], ctx.now(), cfg.spikeSigma);
    return spike ? [spike] : [];
  });
  if (!spikes.length) return { spikes: [] };
  const symbols = await symbolsWithLogin(ctx, cfg, 'watch', st);
  const stocks: { code: string; name: string; ret: Map<number, number> }[] = [];
  for (const stock of symbols) {
    const bars = parseDomesticWeek(await get(ctx, NAVER.itemWeek(stock.code))).filter((b) => b.end <= ctx.now());
    if (bars.length) stocks.push({ ...stock, ret: returns10(bars) });
    else missing.push(stock.name);
  }
  const ref: { oil?: IndexQuote; rate?: IndexQuote; dollar?: IndexQuote } = {};
  for (const [kind, label] of [['oil', '유가'], ['rate', '금리'], ['dollar', '달러']] as const) {
    const quote = parseIndexQuote(await get(ctx, NAVER.marketIndex(kind)));
    if ((kind === 'rate' ? quote.changeAbs : quote.changePct) === null) missing.push(label);
    else ref[kind] = quote;
  }
  const results = [];
  for (const spike of spikes) {
    const now = ctx.now();
    if (!allowSend(st, spike, now, cfg.cooldownMin, cfg.dailyMax)) continue;
    const movers = rankMovers(spike, returns10(futures[spike.sym]!), stocks, cfg.top);
    const receivedAt = now;
    const delivered = await sendNtfy(ctx, cfg, formatSpike(spike, movers, ref, missing));
    st = markSent(st, spike, now);
    appendLog(ctx.dir, {
      kind: 'watch', barStart: spike.end - STEP_MS, barEnd: spike.end, receivedAt, sentAt: delivered ? now : null,
      changes: { [spike.sym]: spike.change }, picks: [...movers.up, ...movers.down].map(({ code, expected }) => ({ code, expected })), delivered,
      ...(!delivered ? { note: '보내지 못함' } : {}),
    });
    results.push({ ...spike, delivered, movers });
  }
  writeState(ctx.dir, 'watch', st);
  return { spikes: results };
}

const sentPremarket = (logs: LogLine[]) => logs.filter((l) => l.kind === 'premarket' && l.delivered && l.sentAt !== null);
const dayStamp = (date: string, time: string) => date.replaceAll('-', '') + time;
function historyFrom(today: string, logs: LogLine[] = []): string {
  return [addDays(today, -730), ...logs.map((l) => addDays(kstDate(l.sentAt!), -14))].sort()[0];
}
async function stockDays(ctx: Ctx, codes: Iterable<string>, from: string, today: string): Promise<Map<string, DayBar[]>> {
  const byCode = new Map<string, DayBar[]>();
  for (const code of new Set(codes)) {
    const bars = parseDayBars(await get(ctx, NAVER.itemDay(code, dayStamp(from, '0000'), dayStamp(today, '2359')))).filter((b) => b.date <= today);
    byCode.set(code, bars);
  }
  return byCode;
}

/** 다음 개장 전 실행과 stats는 같은 시가 평가를 쓴다. 미발송·개장 전 기록은 세지 않는다. */
function premarketRecord(logs: LogLine[], byCode: Map<string, DayBar[]>, now: number): Backtest & { recent20: { date: string; hit: number; baseUp: number; n: number }[] } {
  const byDate = new Map<string, { hit: number; up: number; n: number }>();
  for (const line of sentPremarket(logs)) {
    const date = kstDate(line.sentAt!);
    if (date > kstDate(now) || (date === kstDate(now) && kstMinuteOfDay(now) < 540)) continue;
    for (const pick of line.picks) {
      const bars = byCode.get(pick.code) ?? [];
      const i = bars.findIndex((b) => b.date === date);
      if (i < 1) continue;
      const actual = bars[i].open / bars[i - 1].close - 1;
      if (!Number.isFinite(actual) || actual === 0) continue;
      const counts = byDate.get(date) ?? { hit: 0, up: 0, n: 0 };
      counts.n++;
      if (Math.sign(actual) === Math.sign(pick.expected)) counts.hit++;
      if (actual > 0) counts.up++;
      byDate.set(date, counts);
    }
  }
  const totals = [...byDate.values()].reduce((a, b) => ({ hit: a.hit + b.hit, up: a.up + b.up, n: a.n + b.n }), { hit: 0, up: 0, n: 0 });
  return {
    hit: totals.n ? totals.hit / totals.n : 0, baseUp: totals.n ? totals.up / totals.n : 0, n: totals.n, days: byDate.size,
    recent20: [...byDate].sort(([a], [b]) => a.localeCompare(b)).slice(-20).map(([date, c]) => ({ date, hit: c.hit / c.n, baseUp: c.up / c.n, n: c.n })),
  };
}

interface PremarketState { sentDate?: string; loginNotified?: string }
async function premarket(ctx: Ctx): Promise<unknown> {
  const today = kstDate(ctx.now());
  const raw = readState<PremarketState | null>(ctx.dir, 'premarket', null);
  const st: PremarketState = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  if (st.sentDate === today) return { skipped: 'sent' };
  const status = parseMarketStatus(await get(ctx, NAVER.kospiStatus));
  if (status !== null && !['PREOPEN', 'OPEN'].includes(status)) return { skipped: 'closed' };
  const cfg = readAlertConfig(ctx.env);
  const inHours = () => kstDate(ctx.now()) === today && kstMinuteOfDay(ctx.now()) >= 480 && kstMinuteOfDay(ctx.now()) < 540;
  const from = historyFrom(today);
  const futures: Record<'ES' | 'NQ', DayBar[]> = { ES: [], NQ: [] };
  const missing: string[] = [];
  for (const sym of ['ES', 'NQ'] as const) {
    futures[sym] = parseDayBars(await get(ctx, NAVER.futuresDay(sym, dayStamp(from, '0000'), dayStamp(today, '2359')))).filter((b) => b.date < today);
    if (!futures[sym].length) missing.push(sym);
  }
  if (!futures.ES.length && !futures.NQ.length) {
    appendLog(ctx.dir, { kind: 'premarket', receivedAt: ctx.now(), sentAt: null, changes: {}, picks: [], delivered: false, note: 'nodata' });
    return { sent: false, reason: 'nodata', backtest: backtest([]), picks: [] };
  }
  const symbols = await symbolsWithLogin(ctx, cfg, 'premarket', st, inHours());
  const logs = sentPremarket(readLogs(ctx.dir));
  const byCode = await stockDays(ctx, [...symbols.map((s) => s.code), ...logs.flatMap((l) => l.picks.map((p) => p.code))], historyFrom(today, logs), today);
  const stocks = symbols.flatMap((s) => {
    const bars = (byCode.get(s.code) ?? []).filter((b) => b.date < today);
    if (!bars.length) { missing.push(s.name); return []; }
    return [{ ...s, bars, byFut: { ES: samples(bars, futures.ES), NQ: samples(bars, futures.NQ) } }];
  });
  if (!stocks.length) {
    appendLog(ctx.dir, { kind: 'premarket', receivedAt: ctx.now(), sentAt: null, changes: {}, picks: [], delivered: false, note: 'nostocks' });
    return { sent: false, reason: 'nostocks', backtest: backtest([]), picks: [] };
  }
  const predictions = stocks.flatMap((stock) => {
    const model = fitModel(stock.byFut, today);
    if (!model) { missing.push(`${stock.name}(학습 표본 부족)`); return []; }
    const x = todayX(futures[model.sym], stock.bars.at(-1)!.date, today);
    if (x === null) return [];
    const pct = predict(model, x);
    return Number.isFinite(pct) ? [{ code: stock.code, name: stock.name, sym: model.sym, pct }] : [];
  });
  const up = predictions.filter((p) => p.pct > 0).sort((a, b) => b.pct - a.pct).slice(0, cfg.top);
  const down = predictions.filter((p) => p.pct < 0).sort((a, b) => a.pct - b.pct).slice(0, cfg.top);
  const picks = [...up, ...down];
  const macro: Parameters<typeof formatPremarket>[0]['macro'] = [];
  for (const [kind, id, label] of [['oil', 'DCOILWTICO', '유가'], ['rate', 'DGS10', '금리'], ['dollar', 'DTWEXBGS', '달러']] as const) {
    try {
      const fred = await fetchFredSeries(ctx, id, from, addDays(today, -1));
      const quote = parseIndexQuote(await get(ctx, NAVER.marketIndex(kind)));
      if (!fred.d.length || quote.tradedAt === null || ctx.now() - quote.tradedAt > 72 * 3600_000 || (kind === 'rate' ? quote.changeAbs : quote.changePct) === null) { missing.push(label); continue; }
      const same: string[] = [], opposite: string[] = [];
      for (const stock of stocks) {
        const side = macroSide(stock.bars, fred, kind);
        if (side === 'same') same.push(stock.name);
        if (side === 'opposite') opposite.push(stock.name);
      }
      macro.push({ kind, quote, same, opposite });
    } catch { missing.push(label); }
  }
  const tested = backtest(stocks.map((s) => s.byFut));
  const actual = premarketRecord(logs, byCode, ctx.now());
  const record = actual.days >= 20 ? { ...actual, source: '기록' as const } : { ...tested, source: '백테스트' as const };
  const previous = stocks.map((s) => s.bars.at(-1)!.date).sort().at(-1);
  const changes: Record<string, number> = {};
  for (const sym of ['ES', 'NQ'] as const) {
    const a = previous ? futAt(futures[sym], previous) : null, b = futAt(futures[sym], today);
    if (a !== null && b !== null) changes[sym] = b / a - 1;
  }
  const sessions = [...new Set(Object.values(futures).flatMap((bars) => bars.at(-1)?.date ?? []))].sort().map((d) => d.slice(5).replace('-', '/'));
  const msg = formatPremarket({ esPct: changes.ES ?? null, nqPct: changes.NQ ?? null, session: `${sessions.join('·')} 미국 세션`, up, down, macro, record, missing, statusUnknown: status === null });
  const receivedAt = ctx.now();
  // 자료를 받는 동안 09:00을 넘겼어도 발송하지 않는다.
  const late = !inHours();
  const sent = !late && await sendNtfy(ctx, cfg, msg);
  const sentAt = sent ? ctx.now() : null;
  appendLog(ctx.dir, {
    kind: 'premarket', ...(previous ? { barStart: kstEpoch(previous, '00:00:00'), barEnd: kstEpoch(today, '00:00:00') } : {}), receivedAt, sentAt, changes,
    picks: picks.map((p) => ({ code: p.code, expected: p.pct })), delivered: sent, ...(!sent ? { note: late ? 'late' : '보내지 못함' } : {}),
  });
  if (sent) writeState(ctx.dir, 'premarket', { ...st, sentDate: today });
  return { sent, ...(late ? { reason: 'late' } : {}), backtest: tested, picks, record };
}

async function stats(ctx: Ctx): Promise<unknown> {
  const logs = readLogs(ctx.dir).filter((l) => l.kind === 'watch' && l.delivered && l.sentAt !== null);
  const byCode = new Map<string, { bars: Bar10[]; ret: Map<number, number>; dates: Set<string> }>();
  for (const code of new Set(logs.flatMap((l) => l.picks.map((p) => p.code)))) {
    const bars = parseDomesticWeek(await get(ctx, NAVER.itemWeek(code))).filter((b) => b.end <= ctx.now());
    const dates = new Set([...new Set(bars.map((b) => kstDate(b.end)))].sort().slice(-5));
    byCode.set(code, { bars, ret: returns10(bars), dates });
  }
  let hit = 0, n = 0, up = 0;
  const days = new Set<string>();
  for (const line of logs) {
    const sentAt = line.sentAt!;
    for (const pick of line.picks) {
      const data = byCode.get(pick.code);
      if (!data || !data.dates.has(kstDate(sentAt))) continue;
      const bar = data.bars.find((b) => b.end > sentAt);
      if (!bar || kstDate(bar.end) !== kstDate(sentAt)) continue;
      const actual = data.ret.get(bar.end);
      if (actual === undefined || actual === 0 || pick.expected === 0) continue;
      n++;
      if (Math.sign(actual) === Math.sign(pick.expected)) hit++;
      if (actual > 0) up++;
      days.add(kstDate(sentAt));
    }
  }
  const preLogs = sentPremarket(readLogs(ctx.dir));
  const today = kstDate(ctx.now());
  const daily = await stockDays(ctx, preLogs.flatMap((l) => l.picks.map((p) => p.code)), historyFrom(today, preLogs), today);
  return { kinds: { watch: { hit: n ? hit / n : 0, n, days: days.size, baseUp: n ? up / n : 0 }, premarket: premarketRecord(preLogs, daily, ctx.now()) } };
}

export const alert: Command = async (ctx) => {
  const [sub, ...rest] = ctx.args.positionals;
  if (rest.length || !['watch', 'test', 'stats', 'premarket'].includes(sub)) throw new CliError('invalid-args', 'alert는 watch, test, stats, premarket 중 하나를 써 주세요');
  if (sub === 'watch') return watch(ctx);
  if (sub === 'stats') return stats(ctx);
  if (sub === 'premarket') return premarket(ctx);
  const cfg = readAlertConfig(ctx.env), now = ctx.now();
  const delivered = await sendNtfy(ctx, cfg, { title: 'gazua 알람 시험', body: '알람 연결을 확인했어요' });
  appendLog(ctx.dir, { kind: 'test', receivedAt: now, sentAt: delivered ? now : null, changes: {}, picks: [], delivered, ...(!delivered ? { note: '보내지 못함' } : {}) });
  return { delivered };
};
