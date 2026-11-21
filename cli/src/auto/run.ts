import type { AccountHolding } from '../../../src/lib/providers/types';
import { fromTemplate, TEMPLATES } from '../../../src/lib/sim/templates';
import { resolveSymbols } from '../../../src/lib/sim/validate';
import { kstDate, kstMinuteOfDay, kstWeekday } from '../../../src/lib/time/kst';
import { readAlertConfig } from '../alert/config';
import { sendNtfy } from '../commands/alert';
import { orderStatus, proxySettings, sendOrder, tossAccount } from '../commands/order';
import type { Ctx } from '../context';
import { CliError, toCliError } from '../errors';
import { NAVER, naverGet, parseDayBars, parseMarketStatus, parseStockName, type DayBar } from '../naverMarket';
import { findStrategy, pickProfile, type ProfileData } from '../profileData';
import { PROPOSAL_NOTES } from '../proposals';
import { authedClient } from '../session';
import { evaluateAt, warmFrom } from '../signals';
import { readAutoConfig, type AutoConfig } from './config';
import { BUY_CUTOFF_MIN, decideBuy, decideSell, toCandles } from './judge';
import { ledgerPath, readLedger, writeLedger, type AutoLedger, type AutoPosition } from './ledger';
import { judgeDry, type PresetResult } from './preset';
import { tickDown } from './tick';

interface AutoDeps {
  loadProfile?: (ctx: Ctx, cfg: AutoConfig) => Promise<ProfileData>;
  tossAccount?: typeof tossAccount;
  sendOrder?: typeof sendOrder;
  notify?: typeof sendNtfy;
}
export interface AutoOrder {
  symbol: string; quantity: number; price: number; reason: string;
  result: 'dry' | 'sent' | 'rejected' | 'unknown'; code?: string;
}
export interface AutoResult {
  mode: 'dry' | 'live'; strategy: string; skipped: 'hours' | 'closed' | null;
  buys: AutoOrder[]; sells: AutoOrder[]; skippedSymbols: { symbol: string; reason: string }[]; notes: string[]; presets: PresetResult[];
}

/** 오류 알림 뒤 회복 알림을 기다리는 표시(원장 notified에 날짜와 함께 둔다) */
const RECOVER = 'recover';
const RETRY = new Set(['order-rate-limited', 'order-busy', 'order-token-failed']);
const REJECTED = new Set(['order-over-limit', 'order-daily-limit', 'order-total-limit', 'order-stopped', 'order-disabled', 'order-invalid', 'order-upstream']);
const inHours = (now: number) => {
  const day = kstWeekday(kstDate(now)), minute = kstMinuteOfDay(now);
  return day >= 1 && day <= 5 && minute >= 545 && minute <= 920;
};

/** 한 번만 판정한다. 원장의 선기록이 재시작 때 중복 주문을 막는다. */
export async function runAuto(ctx: Ctx, deps: AutoDeps = {}): Promise<AutoResult> {
  const today = kstDate(ctx.now());
  let ledger: AutoLedger | undefined;
  let path: string | undefined;
  let mode: 'dry' | 'live' = ctx.env.AUTO_MODE?.trim() === 'live' ? 'live' : 'dry';
  const save = () => { if (ledger && path) writeLedger(path, ledger); };
  const notify = async (title: string, body: string) => {
    const cfg = readAlertConfig(ctx.env);
    ctx.redact.add(cfg.topic);
    return (deps.notify ?? sendNtfy)(ctx, cfg, { title: `${mode === 'dry' ? '[연습] ' : ''}${title}`, body: `${body}\n투자 조언 아님` });
  };
  const once = async (key: string, title: string, body: string) => {
    const stamp = `${today}:${key}`;
    if (ledger?.notified.includes(stamp)) return false;
    if (ledger) {
      ledger.notified.push(stamp);
      try { save(); } catch { /* 기록을 못 써도 오류 알림은 시도한다. */ }
    }
    await notify(title, body);
    return true;
  };
  try {
    const cfg = readAutoConfig(ctx.env);
    const { dayCloseMin } = cfg;
    const buyCutoffMin = Math.min(BUY_CUTOFF_MIN, dayCloseMin ?? BUY_CUTOFF_MIN);
    mode = cfg.mode;
    const out: AutoResult = { mode, strategy: cfg.strategy, skipped: null, buys: [], sells: [], skippedSymbols: [], notes: [], presets: [] };
    if (!inHours(ctx.now())) return { ...out, skipped: 'hours' };
    if (parseMarketStatus(await naverGet(ctx, NAVER.kospiStatus)) !== 'OPEN') return { ...out, skipped: 'closed' };
    // 알림 설정이 틀리면 주문을 시작하기 전에 멈춘다.
    ctx.redact.add(readAlertConfig(ctx.env).topic);
    path = ledgerPath(ctx.dir, mode);
    ledger = readLedger(path, today);
    const profile = await (deps.loadProfile ?? ((c, a) => pickProfile(authedClient(c), a.profile, c.now())))(ctx, cfg);
    const strategy = findStrategy(profile.strategies, cfg.strategy);
    out.strategy = strategy.name;
    if (ledger.positions.length && ledger.strategyId !== strategy.id) throw new CliError('invalid-args', '포지션이 남아 있어 전략을 바꿀 수 없어요');
    ledger.strategyId = strategy.id;
    const symbols = [...new Set(resolveSymbols(strategy, profile.watchlists))];
    const presets = mode === 'dry' && cfg.dryPresets === 'all' ? TEMPLATES.map((t) => {
      const preset = fromTemplate(t, ctx.now(), null, t.name);
      preset.id = `preset-${t.id}`;
      preset.universe = strategy.universe;
      const path = ledgerPath(ctx.dir, 'dry', t.id);
      const result: PresetResult = { id: preset.id, name: preset.name, buys: [], sells: [] };
      out.presets.push(result);
      try {
        const ledger = readLedger(path, today);
        if (ledger.positions.length && ledger.strategyId !== preset.id) throw new CliError('invalid-args', '포지션이 남아 있어 전략을 바꿀 수 없어요');
        return { strategy: preset, path, ledger, result };
      } catch (e) {
        result.error = toCliError(e).code;
        return { strategy: preset, path, ledger: undefined, result };
      }
    }) : [];
    const primarySymbols = new Set([...symbols, ...ledger.positions.map((p) => p.symbol)]);
    const allSymbols = new Set([...primarySymbols, ...presets.flatMap((p) => p.ledger?.positions.map((pos) => pos.symbol) ?? [])]);
    const fromFor = (s: typeof strategy, l: AutoLedger, symbol: string) => [warmFrom(today, s), ...l.positions.filter((p) => p.symbol === symbol).map((p) => p.boughtAt)].sort()[0];
    const sharedFrom = [warmFrom(today, strategy), ...ledger.positions.map((p) => p.boughtAt),
      ...presets.flatMap((p) => p.ledger ? [warmFrom(today, p.strategy), ...p.ledger.positions.map((pos) => pos.boughtAt)] : [])].sort()[0];
    const sharedBars = new Map<string, DayBar[]>(), failedBars = new Map<string, unknown>();
    const bars = new Map<string, DayBar[]>();
    out.notes.push('네이버 일봉에는 거래대금이 없어 거래대금 규칙이 시뮬레이션과 다를 수 있어요');
    if (['cashPct', 'equityPct'].includes(strategy.sizing.mode)) out.notes.push(PROPOSAL_NOTES.sizingFromInitial);
    for (const symbol of allSymbols) {
      if (!/^\d{6}$/.test(symbol)) { if (primarySymbols.has(symbol)) out.skippedSymbols.push({ symbol, reason: '6자리 숫자 종목만 처리해요' }); continue; }
      const from = presets.length ? sharedFrom : fromFor(strategy, ledger, symbol);
      let days: DayBar[];
      try {
        days = parseDayBars(await naverGet(ctx, NAVER.itemDay(symbol, from.replaceAll('-', '') + '0000', today.replaceAll('-', '') + '2359'))).filter((b) => b.date <= today);
      } catch (e) {
        if (primarySymbols.has(symbol)) throw e;
        failedBars.set(symbol, e);
        continue;
      }
      if (days.at(-1)?.date !== today) { if (primarySymbols.has(symbol)) out.skippedSymbols.push({ symbol, reason: '오늘 봉이 없어요' }); continue; }
      sharedBars.set(symbol, days);
      if (primarySymbols.has(symbol)) bars.set(symbol, presets.length ? days.filter((b) => b.date >= fromFor(strategy, ledger!, symbol)) : days);
    }
    const names = new Map<string, string>();
    const nameOf = async (symbol: string) => {
      if (!names.has(symbol)) {
        let name = symbol;
        try { name = parseStockName(await naverGet(ctx, NAVER.stockBasic(symbol))) ?? symbol; } catch { /* 이름을 못 읽으면 코드로 알린다. */ }
        names.set(symbol, name);
      }
      return names.get(symbol)!;
    };
    let account: Awaited<ReturnType<typeof tossAccount>> | undefined;
    let holdings: AccountHolding[] | undefined;
    const remove = (pos: AutoPosition) => { ledger!.positions = ledger!.positions.filter((p) => p !== pos); };
    const heldOf = (symbol: string) => holdings?.find((h) => h.symbol === symbol)?.quantity ?? 0;
    const loadHoldings = async () => {
      if (holdings) return;
      account = await (deps.tossAccount ?? tossAccount)(ctx);
      holdings = await account.account.holdings();
      if (holdings.some((h) => !Number.isSafeInteger(h.quantity) || h.quantity < 0)) throw new CliError('upstream');
      for (const p of [...ledger!.positions]) {
        const held = Math.min(p.qty, heldOf(p.symbol));
        const pending = p.pendingSell;
        if (pending) {
          if (held < p.qty) {
            p.sells.push({ qty: p.qty - held, ...(pending.stage === undefined ? {} : { stage: pending.stage }) });
            p.qty = held;
          }
          if (pending.qtyBefore - held >= pending.qty || pending.date !== today) delete p.pendingSell;
          else if (!pending.warned && ctx.now() - pending.sentAt >= 600_000) {
            pending.warned = true;
            save();
            await notify(`매도 확인 ${p.symbol} ${await nameOf(p.symbol)}`, '안 팔렸어요. 토스 앱에서 확인해 주세요');
          }
        }
        if (p.boughtAt < today && !p.pendingSell) {
          p.qty = Math.min(p.qty, heldOf(p.symbol));
          p.boughtQty = p.qty + p.sells.reduce((n, s) => n + s.qty, 0);
          if (!p.qty) {
            remove(p);
            if (!pending) await notify(`보유 확인 ${p.symbol} ${await nameOf(p.symbol)}`, '보유가 없어 팔지 않았어요');
          }
        } else if (!p.qty) remove(p);
      }
      save();
    };
    let settings: ReturnType<typeof proxySettings> | undefined;
    let limits: Awaited<ReturnType<typeof orderStatus>> | undefined;
    const allowed = async (buy: boolean) => {
      if (mode === 'dry') return true;
      settings ??= proxySettings(ctx);
      limits ??= await orderStatus(ctx, settings);
      const code = !limits.enabled ? 'order-disabled' : limits.stopped ? 'order-stopped' : buy && limits.totalMaxAmount === null ? 'order-total-limit'
        : limits.usedToday.count >= limits.maxPerDay ? 'order-daily-count' : undefined;
      if (code) {
        await once(code, '자동 실행을 건너뛰었어요', code === 'order-daily-count' ? `하루 주문 건수 한도(${limits.maxPerDay}건)를 다 써서 주문하지 않았어요`
          : buy && limits.totalMaxAmount === null
            ? '총 가용 금액 ORDER_TOTAL_MAX_AMOUNT가 없어 매수하지 않았어요' : `프록시가 주문을 막고 있어요(${code})`);
        return false;
      }
      return true;
    };
    const send = async (side: 'BUY' | 'SELL', p: AutoPosition, q: number, price: number, reason: string, current: number, previouslySold = false): Promise<AutoOrder> => {
      let result: AutoOrder['result'] = mode === 'dry' ? 'dry' : 'sent';
      let code: string | undefined;
      if (mode === 'live') {
        try {
          const sent = await (deps.sendOrder ?? sendOrder)(ctx, settings!, account!.credentials, { side, symbol: p.symbol, quantity: q, price });
          if (side === 'BUY') { delete p.unconfirmed; p.orderId = sent.orderId; }
        } catch (e) {
          code = toCliError(e).code;
          const rejected = RETRY.has(code) || REJECTED.has(code);
          result = rejected ? 'rejected' : 'unknown';
          if (side === 'BUY' && rejected) {
            remove(p);
            if (RETRY.has(code)) ledger!.today.bought = ledger!.today.bought.filter((s) => s !== p.symbol);
          } else if (side === 'SELL' && rejected) {
            delete p.pendingSell;
            if (RETRY.has(code)) {
              if (!previouslySold) ledger!.today.sold = ledger!.today.sold.filter((s) => s !== p.symbol);
            } else p.sellBlocked = today;
          }
        }
      } else if (side === 'BUY') delete p.unconfirmed;
      else {
        p.sells.push({ qty: q, ...(p.pendingSell?.stage === undefined ? {} : { stage: p.pendingSell.stage }) });
        p.qty -= q;
        delete p.pendingSell;
        if (!p.qty) remove(p);
      }
      save();
      // 이름 조회를 기다리는 동안 꺼져도 연습 매도 상태가 남지 않도록 저장한 뒤 거래를 기록한다.
      if (mode === 'dry') { (ledger!.today.trades ??= []).push({ side, symbol: p.symbol, name: await nameOf(p.symbol), qty: q, price, reason }); save(); }
      const status = { dry: '연습', sent: '접수', rejected: '거절', unknown: '결과 불명' }[result];
      const avg = mode === 'live' ? holdings?.find((h) => h.symbol === p.symbol)?.avgPrice : undefined;
      const body = `${q}주, 지정가 ${price}원, 현재가 ${current}원\n이유: ${reason}\n${mode === 'dry' ? '이렇게 보냈을 거예요' : status}${code ? ` (${code})` : ''}${avg === undefined ? '' : `\n토스 평단 ${avg}원`}`
        + (result === 'unknown' ? '\n토스 앱에서 확인해 주세요' : side === 'SELL' && result === 'rejected' && !RETRY.has(code!) ? `\n자동 매도가 막혔어요(${code}). 토스 앱에서 직접 확인해 주세요` : '');
      await notify(`${side === 'BUY' ? '매수' : '매도'} ${p.symbol} ${await nameOf(p.symbol)}`, body);
      return { symbol: p.symbol, quantity: q, price, reason, result, ...(code ? { code } : {}) };
    };
    if (mode === 'dry') { ledger.today.judgedDate = today; save(); }
    if (mode === 'live' && ledger.positions.some((p) => p.pendingSell)) await loadHoldings();
    for (const p of [...ledger.positions]) {
      const days = bars.get(p.symbol);
      if (!days) continue;
      const current = days.at(-1)!.close;
      p.peak = Math.max(p.peak, current);
      if (p.pendingSell || p.sellBlocked === today) continue;
      const candles = toCandles(days);
      const sellSignal = strategy.rules.sell.signal.on && evaluateAt(candles, strategy.rules.sell.signal.groups, candles.length - 1).match;
      const heldDays = days.filter((b) => b.date >= p.boughtAt).length;
      let closeAll: string | undefined;
      if (dayCloseMin !== undefined) {
        if (p.boughtAt < today) closeAll = '전날 남은 포지션 청산';
        else if (kstMinuteOfDay(ctx.now()) >= dayCloseMin) closeAll = '장 마감 전 청산';
      }
      let decision = decideSell(p, strategy, current, heldDays, sellSignal, closeAll);
      if (!decision || !inHours(ctx.now()) || kstDate(ctx.now()) !== today) continue;
      if (mode === 'live') {
        await loadHoldings();
        if (!ledger.positions.includes(p)) continue;
        // 토스 보유가 원장보다 많으면 사람이 같은 종목을 따로 산 것이다. 체결을 구분할 수 없어 자동 매도를 하지 않는다.
        if (heldOf(p.symbol) > p.qty) {
          out.skippedSymbols.push({ symbol: p.symbol, reason: '직접 산 주식과 섞여 자동 매도하지 않아요' });
          await once(`mixed:${p.symbol}`, `자동 매도 멈춤 ${p.symbol} ${await nameOf(p.symbol)}`,
            `토스 보유(${heldOf(p.symbol)}주)가 자동 실행기 원장(${p.qty}주)보다 많아 자동 매도하지 않았어요(${decision.reason}). 토스 앱에서 직접 확인해 주세요`);
          continue;
        }
        decision = decideSell(p, strategy, current, heldDays, sellSignal, closeAll);
        if (!decision) continue;
      }
      const qtyBefore = mode === 'live' ? Math.min(p.qty, heldOf(p.symbol)) : p.qty;
      const qty = Math.min(decision.qty, qtyBefore);
      if (qty <= 0 || !await allowed(false) || !inHours(ctx.now()) || kstDate(ctx.now()) !== today) continue;
      const price = tickDown(current * (1 - cfg.sellSlipPct / 100));
      if (price <= 0 || !Number.isSafeInteger(price * qty)) continue;
      const previouslySold = ledger.today.sold.includes(p.symbol);
      ledger.today.sold = [...new Set([...ledger.today.sold, p.symbol])];
      p.pendingSell = { date: today, sentAt: ctx.now(), qty, qtyBefore, price, reason: decision.reason, ...(decision.stage === undefined ? {} : { stage: decision.stage }) };
      save();
      out.sells.push(await send('SELL', p, qty, price, decision.reason, current, previouslySold));
    }
    for (const symbol of symbols) {
      const days = bars.get(symbol);
      if (!days || kstDate(ctx.now()) !== today || !inHours(ctx.now())) continue;
      const current = days.at(-1)!.close, candles = toCandles(days);
      const signal = evaluateAt(candles, strategy.rules.buy, candles.length - 1);
      const decide = () => decideBuy({ strategy, symbolCount: symbols.length, symbol, price: current, minute: kstMinuteOfDay(ctx.now()), buyCutoffMin, match: signal.match, reason: signal.reason, ledger: ledger!, held: mode === 'live' && heldOf(symbol) > 0, buySlipPct: cfg.buySlipPct });
      let decision = decide();
      if (!decision) continue;
      if ('skip' in decision) { out.skippedSymbols.push({ symbol, reason: decision.skip }); continue; }
      if (!await allowed(true)) continue;
      if (mode === 'live') { await loadHoldings(); decision = decide(); }
      if (!decision || 'skip' in decision) {
        if (decision && 'skip' in decision) out.skippedSymbols.push({ symbol, reason: decision.skip });
        continue;
      }
      const now = ctx.now();
      if (!inHours(now) || kstDate(now) !== today || kstMinuteOfDay(now) >= buyCutoffMin) continue;
      const p: AutoPosition = { symbol, boughtAt: today, buyPrice: decision.price, boughtQty: decision.qty, qty: decision.qty, peak: decision.price, sells: [], unconfirmed: true };
      ledger.today.bought.push(symbol);
      ledger.positions.push(p);
      save();
      out.buys.push(await send('BUY', p, decision.qty, decision.price, decision.reason, current));
    }
    save();
    // 오류를 알린 뒤 처음 끝까지 돈 실행이면 정상으로 돌아왔다고 한 번 알린다.
    const recover = `${today}:${RECOVER}`;
    if (ledger.notified.includes(recover)) {
      ledger.notified = ledger.notified.filter((key) => key !== recover);
      save();
      try { await notify('자동 실행 정상', '다시 문제없이 돌고 있어요'); } catch { /* 회복 알림 실패는 판정 결과를 바꾸지 않는다. */ }
    }
    for (const p of presets) {
      if (!p.ledger) continue;
      try {
        for (const symbol of new Set([...symbols, ...p.ledger.positions.map((pos) => pos.symbol)])) {
          if (failedBars.has(symbol)) throw failedBars.get(symbol);
        }
        const bars = new Map([...sharedBars].map(([symbol, days]) => [symbol, days.filter((b) => b.date >= fromFor(p.strategy, p.ledger!, symbol))]));
        Object.assign(p.result, await judgeDry(p.strategy, p.ledger, bars, { symbols, cfg, path: p.path, now: ctx.now,
          canJudge: () => inHours(ctx.now()) && kstDate(ctx.now()) === today, nameOf }));
      } catch (e) { p.result.error = toCliError(e).code; }
    }
    if (dayCloseMin !== undefined) {
      const hour = Math.floor(dayCloseMin / 60);
      const minute = String(dayCloseMin % 60).padStart(2, '0');
      out.notes.push(`당일 청산 모드: ${hour}:${minute}부터 모두 팔아요`);
    }
    return out;
  } catch (e) {
    const err = toCliError(e);
    if (!path) {
      path = ledgerPath(ctx.dir, mode);
      try { ledger = readLedger(path, today); } catch { /* 손상 원장은 덮어쓰지 않는다. */ }
    }
    try {
      if (await once(err.code, '자동 실행 오류', `자동 실행을 멈췄어요(${err.code}). 설정과 토스 앱을 확인해 주세요`) && ledger && !ledger.notified.includes(`${today}:${RECOVER}`)) {
        ledger.notified.push(`${today}:${RECOVER}`);
        save();
      }
    } catch { /* 알림 실패가 원래 오류를 가리지 않게 한다. */ }
    throw e;
  }
}
