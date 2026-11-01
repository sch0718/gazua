import type { Candle } from '../data/metrics';
import { kstDate } from '../time/kst';
import { roundMoney } from './money';
import { createRuleEvaluator, type RuleEvaluator } from './rules';
import { costOf, maxShares, openPosition, type Position } from './position';
import { sellTaxPct, settlementDate } from './tax';
import { holdCurve, indexCurve, singleCurve } from './benchmarks';
import { nearMiss, retPct, summarize } from './summary';
import type { DayFrame, HoldingFrame, PatternSnapshot, SimInput, SimResult, Skip, Strategy, Trade } from './types';

export interface CoreResult {
  equity: { date: string; value: number; cash: number }[];
  trades: Trade[];
  skipped: Skip[];
  roundTrips: { symbol: string; open: string; close: string | null; cost: number; pnl: number; holdDays: number }[];
  perSymbolFirstDate: Record<string, string | null>;
  patternStats: { maxDropPct: number; declineDays: number } | null; // 매수 조건에 반등 패턴 블록이 없으면 null
  /** 옵션 timeline을 켰을 때만 있다 */
  timeline?: DayFrame[];
}

export interface SimOptions {
  /** 결과 화면 재생용 일별 상태(DayFrame)를 기록한다. 기본은 끔(선정 기준 검증은 지금과 같다) */
  timeline?: boolean;
}

/** 한 종목을 파는 데 필요한 것(장중 경로·시가 예약 매도 공용) */
export interface SellCtx {
  date: string;
  symbol: string;
  wallet: { cash: number };
  feePct: number;
  taxPct: number; // 그날 매도세 %
  trade(t: Trade): void;
}

/** qty주를 price에 판다. 수수료·세금·현금 반영·체결 줄 모양을 한곳에서 정한다 */
export function sellQty(pos: Position, qty: number, price: number, kind: Trade['kind'], reason: string, ctx: SellCtx, stage?: number): void {
  const gross = roundMoney(qty * price);
  const fee = roundMoney((gross * ctx.feePct) / 100);
  const tax = roundMoney((gross * ctx.taxPct) / 100);
  const pnlPct = (price / pos.avgPrice - 1) * 100;
  pos.sell(qty, stage);
  ctx.wallet.cash = roundMoney(ctx.wallet.cash + roundMoney(gross - fee - tax));
  ctx.trade({ date: ctx.date, symbol: ctx.symbol, kind, ...(stage !== undefined && { stage }), price, qty, fee, tax, reason, pnlPct });
}

/** 한 종목의 하루 장중 경로에 필요한 것 */
export interface WalkCtx extends SellCtx {
  amount: number; // 1회 매수 금액(포지션을 열 때 정한 값)
  takeProfit: Strategy['rules']['sell']['takeProfit']['stages'];
  trailPct: number; // 트레일링 사유 문구용
  excluded: Set<number>; // 그날 건너뛴 추가 매수 가격
  canBuy?: boolean; // false면 추가 매수를 하지 않는다(선정 기간 밖). 없으면 true
  skip(reason: Skip['reason'], addPrice: number): void;
}

/** 1회 금액으로 살 수량과 총비용(수수료 포함)·수수료. 못 사면 건너뜀 사유.
 *  비용은 여기서 한 번만 계산하고 수수료는 비용에서 뺀다(수량 × 가격 + 수수료 = 비용) */
export function sizeBuy(amount: number, price: number, feePct: number, cash: number): { qty: number; cost: number; fee: number } | Skip['reason'] {
  const qty = maxShares(amount, price, feePct);
  if (qty === 0) return '1주가 1회 금액보다 비쌈';
  const cost = costOf(qty, price, feePct);
  if (cash < cost) return '현금 부족';
  return { qty, cost, fee: roundMoney(cost - qty * price) };
}

/** 시가 → 저가 → 고가 → 종가를 가격 커서 하나로 지나가며 손절·트레일링·추가 매수·익절을 체결한다(스펙 5.2, 전략 빌더 §4.3). */
export function walkBar(pos: Position, bar: Candle, ctx: WalkCtx): void {
  const { date, symbol, feePct } = ctx;
  const single = ctx.takeProfit.length === 1;
  const trailReason = (gap: boolean) => `트레일링 −${ctx.trailPct}%${gap ? '(갭)' : ''}`;

  const sell = (qty: number, price: number, kind: Trade['kind'], stage?: number, reason?: string) =>
    sellQty(pos, qty, price, kind, reason ?? (stage === undefined ? '손절' : single ? '익절' : `${stage}단계 익절 ${ctx.takeProfit[stage - 1].sellPct}%`), ctx, stage);

  const add = (level: number, price: number) => {
    const sized = sizeBuy(ctx.amount, price, feePct, ctx.wallet.cash);
    if (typeof sized === 'string') {
      ctx.excluded.add(level);
      ctx.skip(sized, level);
      return;
    }
    if (ctx.canBuy === false) {
      ctx.excluded.add(level);
      ctx.skip('선정 기간이 아니에요', level);
      return;
    }
    pos.buy(price, sized.qty);
    ctx.wallet.cash = roundMoney(ctx.wallet.cash - sized.cost);
    ctx.trade({ date, symbol, kind: 'add', price, qty: sized.qty, fee: sized.fee, tax: 0, reason: '추가 매수' });
  };

  let cur = bar.o;
  for (const to of [bar.l, bar.h, bar.c]) {
    while (pos.qty > 0) {
      // 내려갈 때 지키는 선: 손절가와 트레일 가격 중 높은 것. 같으면 손절이다
      const stop = pos.stopPrice();
      const trail = pos.trailPrice();
      const trailWins = trail !== null && (stop === null || trail > stop);
      const floor = trailWins ? trail : stop;
      const next = pos.nextAddPrice();
      const addAt = next !== null && !ctx.excluded.has(next) ? next : null;
      const takes = pos.takeLevels().filter((t) => t.qty > 0);

      // 1. 이미 지나친 가격은 커서에: 손절·트레일 → 추가 매수 → 익절(낮은 단계부터)
      if (floor !== null && floor >= cur) {
        const gap = floor > cur;
        if (trailWins) sell(pos.qty, cur, 'trail', undefined, trailReason(gap));
        else sell(pos.qty, cur, gap ? 'gapStop' : 'stop');
        continue;
      }
      if (addAt !== null && addAt >= cur) {
        add(addAt, cur);
        continue;
      }
      const passed = takes.find((t) => t.price <= cur);
      if (passed) {
        sell(passed.qty, cur, passed.price < cur ? 'gapTake' : 'take', passed.stage);
        continue;
      }

      if (to < cur) {
        // 2. 내려감: 구간 안의 가장 높은 손절·트레일·추가 매수, 같으면 손절·트레일
        const s = floor !== null && floor >= to ? floor : null;
        const a = addAt !== null && addAt >= to ? addAt : null;
        if (s !== null && (a === null || s >= a)) {
          cur = s;
          if (trailWins) sell(pos.qty, s, 'trail', undefined, trailReason(false));
          else sell(pos.qty, s, 'stop');
          continue;
        }
        if (a !== null) {
          cur = a;
          add(a, a);
          continue;
        }
      } else if (to > cur) {
        // 3. 올라감: 구간 안의 가장 낮은 익절
        const hit = takes.filter((t) => t.price <= to).sort((x, y) => x.price - y.price)[0];
        if (hit) {
          cur = hit.price;
          sell(hit.qty, hit.price, 'take', hit.stage);
          continue;
        }
      }
      break;
    }
    if (pos.qty === 0) return;
    cur = to;
  }
}

const inWindows = (w: { from: string; to: string }[] | undefined, date: string) =>
  !w || w.some((x) => x.from <= date && date <= x.to);

interface SymState {
  stock: SimInput['stocks'][number];
  dates: string[];
  byDate: Map<string, number>;
  tracker: RuleEvaluator;
  pos: Position | null;
  posAmount: number;
  posSeq: number;
  pending: { reason: string; snapshot?: PatternSnapshot } | null;
  /** 어제 종가에 생긴 매도 예약(조건 매도·기간 청산). 오늘 시가에 남은 수량 전부 판다. 봉이 없으면 다음 봉까지 둔다 */
  pendingSell: { kind: 'time' | 'signalSell'; reason: string } | null;
  /** 조건 매도 평가기. 꺼져 있거나 묶음이 없으면 null */
  sellEval: RuleEvaluator | null;
  lastClose: number | null;
  rt: { open: string; openDay: number; cost: number; proceeds: number } | null;
}

/** 하루 끝 상태(설계 §2.1). 엔진 상태를 읽기만 하고, 가격은 반올림하지 않는다 */
function dayFrame(date: string, di: number, cash: number, value: number, syms: SymState[]): DayFrame {
  const holdings: HoldingFrame[] = [];
  const pending: DayFrame['pending'] = [];
  const pendingSells: DayFrame['pendingSells'] = [];
  for (const st of syms) {
    // 예약은 시가에 비우므로 하루 끝에 남은 것은 그날 종가 신호뿐이다(매도 예약은 봉이 없어 미룬 것도 남는다)
    if (st.pending) pending.push({ symbol: st.stock.symbol, reason: st.pending.reason });
    if (st.pendingSell) pendingSells.push({ symbol: st.stock.symbol, reason: st.pendingSell.reason });
    const pos = st.pos;
    if (!pos || !st.rt) continue;
    const close = st.lastClose!;
    holdings.push({
      symbol: st.stock.symbol,
      qty: pos.qty,
      avgPrice: pos.avgPrice,
      close,
      value: roundMoney(pos.qty * close),
      pnlPct: (close / pos.avgPrice - 1) * 100,
      stop: pos.stopPrice(),
      trail: pos.trailPrice(),
      nextAdd: pos.nextAddPrice(),
      takes: pos
        .takeLevels()
        .filter((t) => t.qty > 0)
        .map(({ stage, price }) => ({ stage, price })),
      openDate: st.rt.open,
      heldDays: di - st.rt.openDay + 1,
    });
  }
  return { date, cash, value, holdings, pending, pendingSells };
}

export function simulateCore(input: SimInput, opts: SimOptions = {}): CoreResult {
  const { strategy: s, days } = input;
  const feePct = s.costs.feePct;
  const wallet = { cash: roundMoney(s.capital.initial) };
  const inDays = new Set(days);
  const equity: CoreResult['equity'] = [];
  const trades: Trade[] = [];
  const skipped: Skip[] = [];
  const roundTrips: CoreResult['roundTrips'] = [];
  const skipKeys = new Set<string>();
  const timeline: DayFrame[] | null = opts.timeline ? [] : null;

  const syms: SymState[] = input.stocks.map((stock) => {
    const dates = stock.candles.map((k) => kstDate(k.t));
    const firstIdx = dates.findIndex((dt) => dt >= days[0]);
    const tracker = createRuleEvaluator(stock.candles, s.rules.buy, firstIdx < 0 ? dates.length : firstIdx);
    const sig = s.rules.sell.signal;
    const sellEval = sig.on && sig.groups.length > 0 ? createRuleEvaluator(stock.candles, sig.groups, firstIdx < 0 ? dates.length : firstIdx) : null;
    let lastClose: number | null = null;
    // 워밍업: 패턴만 먹이고 거래·예약 없음
    for (let i = 0; i < dates.length && dates[i] < days[0]; i++) {
      tracker.update(i);
      sellEval?.update(i);
      lastClose = stock.candles[i].c;
    }
    tracker.resetStats();
    const byDate = new Map<string, number>();
    dates.forEach((dt, i) => inDays.has(dt) && byDate.set(dt, i));
    return { stock, dates, byDate, tracker, pos: null, posAmount: 0, posSeq: 0, pending: null, pendingSell: null, sellEval, lastClose, rt: null };
  });

  const initial = roundMoney(s.capital.initial);
  const { mode, pct } = s.sizing;
  /** 지금 열 포지션의 1회 금액(스펙 §6.1). equityPct는 전 거래일 종가 총자산, cashPct는 그 순간 현금 */
  const amountNow = (): number => {
    switch (mode) {
      case 'fixed':
        return roundMoney((s.capital.initial * pct) / 100);
      case 'equityPct':
        return roundMoney(((equity.length ? equity[equity.length - 1].value : initial) * pct) / 100);
      case 'cashPct':
        return roundMoney((wallet.cash * pct) / 100);
      case 'equal':
        return roundMoney(s.capital.initial / Math.max(1, input.stocks.length));
    }
  };

  const record = (st: SymState, t: Trade) => {
    trades.push(t);
    const rt = st.rt!;
    if (t.kind === 'buy' || t.kind === 'add') rt.cost = roundMoney(rt.cost + roundMoney(t.price * t.qty) + t.fee);
    else rt.proceeds = roundMoney(rt.proceeds + roundMoney(t.price * t.qty) - t.fee - t.tax);
  };

  /** 전량 매도한 종목을 정리한다(왕복 기록·포지션 비움·그날 청산 표시) */
  const closeRound = (st: SymState, di: number, date: string, closed: Set<SymState>) => {
    const rt = st.rt!;
    roundTrips.push({ symbol: st.stock.symbol, open: rt.open, close: date, cost: rt.cost, pnl: roundMoney(rt.proceeds - rt.cost), holdDays: di - rt.openDay + 1 });
    st.pos = null;
    st.rt = null;
    st.pendingSell = null;
    closed.add(st);
  };

  days.forEach((date, di) => {
    const settle = settlementDate(date, days); // 세율은 양도일(결제일) 기준
    const closed = new Set<SymState>();

    // 1-1. 시가: 예약 매도(조건 매도·기간 청산). 매도 대금이 먼저 들어와 예약 매수에 쓴다
    for (const st of syms) {
      const ps = st.pendingSell;
      if (!ps || !st.pos) continue;
      const i = st.byDate.get(date);
      if (i === undefined) continue; // 봉 없는 날은 예약을 두고 다음 봉에서 판다(건너뜀으로 남기지 않는다)
      const { symbol, market, isEtf } = st.stock;
      sellQty(st.pos, st.pos.qty, st.stock.candles[i].o, ps.kind, ps.reason, {
        date,
        symbol,
        wallet,
        feePct,
        taxPct: sellTaxPct(settle, market, isEtf),
        trade: (t) => record(st, t),
      });
      closeRound(st, di, date, closed);
    }

    // 1-2. 시가: 예약 매수
    for (const st of syms) {
      if (!st.pending) continue;
      const { reason, snapshot } = st.pending;
      st.pending = null;
      const i = st.byDate.get(date);
      if (i === undefined) {
        skipped.push({ date, symbol: st.stock.symbol, reason: '거래 없음' });
        continue;
      }
      const price = st.stock.candles[i].o;
      const posAmount = amountNow();
      const sized = sizeBuy(posAmount, price, feePct, wallet.cash);
      if (typeof sized === 'string') {
        skipped.push({ date, symbol: st.stock.symbol, reason: sized });
        continue;
      }
      // 체결일이 선정 기간 밖이면 사려던 것만 건너뜀으로 남긴다(다른 사유가 먼저)
      if (!inWindows(st.stock.buyWindows, date)) {
        skipped.push({ date, symbol: st.stock.symbol, reason: '선정 기간이 아니에요' });
        continue;
      }
      st.pos = openPosition(price, sized.qty, s.scaleIn, s.rules.sell);
      st.posAmount = posAmount;
      st.posSeq++;
      st.rt = { open: date, openDay: di, cost: 0, proceeds: 0 };
      wallet.cash = roundMoney(wallet.cash - sized.cost);
      record(st, { date, symbol: st.stock.symbol, kind: 'buy', price, qty: sized.qty, fee: sized.fee, tax: 0, reason, ...(snapshot && { pattern: snapshot }) });
    }

    // 2. 장중 경로, 3. 종가
    for (const st of syms) {
      const i = st.byDate.get(date);
      if (!st.pos || i === undefined) continue;
      const { symbol, market, isEtf } = st.stock;
      walkBar(st.pos, st.stock.candles[i], {
        date,
        symbol,
        wallet,
        amount: st.posAmount,
        feePct,
        taxPct: sellTaxPct(settle, market, isEtf),
        takeProfit: s.rules.sell.takeProfit.stages,
        trailPct: s.rules.sell.trailing.pct,
        excluded: new Set(),
        canBuy: inWindows(st.stock.buyWindows, date),
        trade: (t) => record(st, t),
        skip: (reason, price) => {
          // 추가 매수 건너뜀은 (종목, 포지션, 가격)마다 한 번만 기록. 선정 기간 밖은 날짜·종목당 한 번
          const key = reason === '선정 기간이 아니에요' ? `${date}|${symbol}|${reason}` : `${symbol}|${st.posSeq}|${price}`;
          if (skipKeys.has(key)) return;
          skipKeys.add(key);
          skipped.push({ date, symbol, reason });
        },
      });
      if (st.pos.qty === 0) closeRound(st, di, date, closed);
    }

    let held = 0;
    for (const st of syms) {
      const i = st.byDate.get(date);
      // 4-1. 보유 중이면 매도 판정만(보유 중 재진입 없음). 조건 매도가 기간 청산보다 먼저. 기간은 시장 축이라 봉 없는 날도 센다
      if (st.pos && !st.pendingSell && di < days.length - 1) {
        const sig = i !== undefined && st.sellEval ? st.sellEval.signal(i) : null;
        const te = s.rules.sell.timeExit;
        if (sig) st.pendingSell = { kind: 'signalSell', reason: sig.reason };
        else if (te.on && di - st.rt!.openDay + 1 >= te.days) st.pendingSell = { kind: 'time', reason: `보유 ${te.days}일 청산` };
      }
      if (i !== undefined) {
        // 4-2. 보유하지 않고 그날 청산하지 않았으면 매수 판정(그날 청산한 종목은 리셋 전 상태로 신호를 내지 않는다)
        if (!st.pos && !closed.has(st) && di < days.length - 1) {
          const sig = st.tracker.signal(i);
          if (sig) st.pending = sig;
        }
        st.tracker.update(i);
        st.sellEval?.update(i);
        if (closed.has(st)) st.tracker.reset(i);
        if (st.pos) st.pos.markClose(st.stock.candles[i].c); // 트레일 기준가는 종가로(스펙 §4.3)
        st.lastClose = st.stock.candles[i].c;
      }
      if (st.pos) held = roundMoney(held + roundMoney(st.pos.qty * st.lastClose!)); // 봉 없는 날은 마지막 종가
    }
    const value = roundMoney(wallet.cash + held);
    equity.push({ date, value, cash: wallet.cash });
    // 재생 기록: 그날 종가 처리를 마친 뒤의 상태를 읽기만 한다
    if (timeline) timeline.push(dayFrame(date, di, wallet.cash, value, syms));
  });

  const last = days.length - 1;
  for (const st of syms) {
    if (!st.pos || !st.rt) continue;
    const value = roundMoney(st.pos.qty * st.lastClose!);
    roundTrips.push({
      symbol: st.stock.symbol,
      open: st.rt.open,
      close: null,
      cost: st.rt.cost,
      pnl: roundMoney(st.rt.proceeds + value - st.rt.cost),
      holdDays: last - st.rt.openDay + 1,
    });
  }

  const perSymbolFirstDate: Record<string, string | null> = {};
  let maxDropPct = 0;
  let declineDays = 0;
  let anyPattern = false;
  for (const st of syms) {
    perSymbolFirstDate[st.stock.symbol] = st.dates.find((dt) => inDays.has(dt)) ?? null;
    const ps = st.tracker.stats();
    if (!ps) continue;
    anyPattern = true;
    maxDropPct = Math.max(maxDropPct, ps.maxDropPct);
    declineDays += ps.declineDays;
  }

  const patternStats = anyPattern ? { maxDropPct, declineDays } : null;

  return { equity, trades, skipped, roundTrips, perSymbolFirstDate, patternStats, ...(timeline && { timeline }) };
}

export function simulate(input: SimInput, opts: SimOptions = {}): SimResult {
  const core = simulateCore(input, opts);
  const { strategy: s, days } = input;
  const initial = s.capital.initial;
  const fee = s.costs.feePct;

  const hold = holdCurve(days, input.stocks, initial, fee);
  const index = input.index ? indexCurve(days, input.index.candles, initial) : null;
  const benchmark = input.benchmarkStock ? singleCurve(days, input.benchmarkStock.candles, initial, fee) : null;
  const summary = summarize(core, { hold, index, benchmark }, days, initial);

  // 잘못된 데이터로 생긴 NaN·Infinity는 숫자 카드 대신 실패 화면으로 보낸다
  for (const e of core.equity) {
    if (!Number.isFinite(e.value) || !Number.isFinite(e.cash)) throw new Error(`평가액 계산 실패: ${e.date}`);
  }

  return {
    equity: core.equity.map((e, i) => ({
      date: e.date,
      strategy: e.value,
      hold: hold[i],
      index: index ? index[i] : null,
      benchmark: benchmark ? benchmark[i] : null,
      cash: e.cash,
    })),
    summary,
    benchmarks: { holdReturnPct: retPct(hold, initial), indexReturnPct: index ? retPct(index, initial) : null, benchmarkReturnPct: benchmark ? retPct(benchmark, initial) : null },
    trades: core.trades,
    skipped: core.skipped,
    perSymbol: input.stocks.map((st) => {
      const rts = core.roundTrips.filter((r) => r.symbol === st.symbol);
      return {
        symbol: st.symbol,
        name: st.name,
        pnl: rts.reduce((a, r) => a + r.pnl, 0),
        roundTrips: rts.length,
        firstDate: core.perSymbolFirstDate[st.symbol] ?? null,
      };
    }),
    nearMiss: nearMiss(core),
    ...(core.timeline && { timeline: core.timeline }),
  };
}
