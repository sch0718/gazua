import { kstDate, kstMinuteOfDay } from '../../../src/lib/time/kst';
import { readAlertConfig, type AlertConfig } from '../alert/config';
import { allowSend, detectSpike, formatSpike, markSent, rankMovers, returns10, STEP_MS, type WatchState } from '../alert/intraday';
import { appendLog, readLogs, readState, writeState } from '../alert/state';
import type { Command, Ctx } from '../context';
import { CliError } from '../errors';
import { NAVER, naverGet, parseDomesticWeek, parseFuturesWeek, parseIndexQuote, parseMarketStatus, type Bar10, type IndexQuote } from '../naverMarket';
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
  if (ctx.args.symbols) return [...new Set(ctx.args.symbols)].map((code) => ({ code, name: code }));
  const profile = await pickProfile(authedClient(ctx), ctx.args.profile, ctx.now());
  const codes = new Set<string>();
  for (const group of profile.watchlists.groups) {
    for (const item of group.items) if (!item.hidden) codes.add(item.symbol);
  }
  // 동기화 문서에는 종목명이 없어 코드로 표시한다.
  return [...codes].slice(0, 30).map((code) => ({ code, name: code }));
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
  let symbols: Awaited<ReturnType<typeof targetSymbols>>;
  try {
    symbols = await targetSymbols(ctx);
  } catch (e) {
    if (e instanceof CliError && ['not-logged-in', 'cli-token-expired', 'cli-token-revoked'].includes(e.code)) {
      const date = kstDate(ctx.now());
      if (st.loginNotified !== date) {
        await sendNtfy(ctx, cfg, { title: 'gazua login 필요', body: '관심 종목을 읽으려면 gazua login을 실행해 주세요' });
        writeState(ctx.dir, 'watch', { ...st, loginNotified: date });
      }
    }
    throw e;
  }
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
  return { kinds: { watch: { hit: n ? hit / n : 0, n, days: days.size, baseUp: n ? up / n : 0 } } };
}

export const alert: Command = async (ctx) => {
  const [sub, ...rest] = ctx.args.positionals;
  if (rest.length || !['watch', 'test', 'stats'].includes(sub)) throw new CliError('invalid-args', 'alert는 watch, test, stats 중 하나를 써 주세요. premarket은 아직 준비 중이에요');
  if (sub === 'watch') return watch(ctx);
  if (sub === 'stats') return stats(ctx);
  const cfg = readAlertConfig(ctx.env), now = ctx.now();
  const delivered = await sendNtfy(ctx, cfg, { title: 'gazua 알람 시험', body: '알람 연결을 확인했어요' });
  appendLog(ctx.dir, { kind: 'test', receivedAt: now, sentAt: delivered ? now : null, changes: {}, picks: [], delivered, ...(!delivered ? { note: '보내지 못함' } : {}) });
  return { delivered };
};
