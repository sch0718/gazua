import type { Candle } from '../data/metrics';
import { kstDate } from '../time/kst';
import { createPatternTracker, type PatternTracker } from './pattern';
import { openPosition, type Position } from './position';
import { sellTaxPct, settlementDate } from './tax';
import { holdCurve, indexCurve, singleCurve } from './benchmarks';
import { nearMiss, retPct, summarize } from './summary';
import type { PatternSnapshot, SimInput, SimResult, Skip, Strategy, Trade } from './types';

export interface CoreResult {
  equity: { date: string; value: number; cash: number }[];
  trades: Trade[];
  skipped: Skip[];
  roundTrips: { symbol: string; open: string; close: string | null; cost: number; pnl: number; holdDays: number }[];
  perSymbolFirstDate: Record<string, string | null>;
  patternStats: { maxDropPct: number; declineDays: number };
}

/** 한 종목의 하루 장중 경로에 필요한 것 */
export interface WalkCtx {
  date: string;
  symbol: string;
  wallet: { cash: number };
  amount: number; // 1회 매수 금액
  feePct: number;
  taxPct: number; // 그날 매도세 %
  takeProfit: Strategy['exit']['takeProfit'];
  excluded: Set<number>; // 그날 건너뛴 추가 매수 가격
  trade(t: Trade): void;
  skip(reason: Skip['reason'], addPrice: number): void;
}

/** 1회 금액으로 살 수량과 총비용(수수료 포함)·수수료. 못 사면 건너뜀 사유.
 *  비용은 여기서 한 번만 계산하고 수수료는 비용에서 뺀다(수량 × 가격 + 수수료 = 비용) */
function sizeBuy(amount: number, price: number, feePct: number, cash: number): { qty: number; cost: number; fee: number } | Skip['reason'] {
  const qty = Math.floor(amount / (price * (1 + feePct / 100)));
  if (qty === 0) return '1주가 1회 금액보다 비쌈';
  const cost = qty * price * (1 + feePct / 100);
  if (cash < cost) return '현금 부족';
  return { qty, cost, fee: cost - qty * price };
}

/** 시가 → 저가 → 고가 → 종가를 가격 커서 하나로 지나가며 손절·추가 매수·익절을 체결한다(스펙 5.2). */
export function walkBar(pos: Position, bar: Candle, ctx: WalkCtx): void {
  const { date, symbol, feePct } = ctx;
  const single = ctx.takeProfit.length === 1;

  const sell = (qty: number, price: number, kind: Trade['kind'], stage?: number) => {
    const gross = qty * price;
    const fee = (gross * feePct) / 100;
    const tax = (gross * ctx.taxPct) / 100;
    const pnlPct = (price / pos.avgPrice - 1) * 100;
    const reason =
      stage === undefined ? '손절' : single ? '익절' : `${stage}단계 익절 ${ctx.takeProfit[stage - 1].sellPct}%`;
    pos.sell(qty, stage);
    ctx.wallet.cash += gross - fee - tax;
    ctx.trade({ date, symbol, kind, ...(stage !== undefined && { stage }), price, qty, fee, tax, reason, pnlPct });
  };

  const add = (level: number, price: number) => {
    const sized = sizeBuy(ctx.amount, price, feePct, ctx.wallet.cash);
    if (typeof sized === 'string') {
      ctx.excluded.add(level);
      ctx.skip(sized, level);
      return;
    }
    pos.buy(price, sized.qty);
    ctx.wallet.cash -= sized.cost;
    ctx.trade({ date, symbol, kind: 'add', price, qty: sized.qty, fee: sized.fee, tax: 0, reason: '추가 매수' });
  };

  let cur = bar.o;
  for (const to of [bar.l, bar.h, bar.c]) {
    while (pos.qty > 0) {
      const stop = pos.stopPrice();
      const next = pos.nextAddPrice();
      const addAt = next !== null && !ctx.excluded.has(next) ? next : null;
      const takes = pos.takeLevels().filter((t) => t.qty > 0);

      // 1. 이미 지나친 가격은 커서에: 손절 → 추가 매수 → 익절(낮은 단계부터)
      if (stop !== null && stop >= cur) {
        sell(pos.qty, cur, stop > cur ? 'gapStop' : 'stop');
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
        // 2. 내려감: 구간 안의 가장 높은 손절·추가 매수, 같으면 손절
        const s = stop !== null && stop >= to ? stop : null;
        const a = addAt !== null && addAt >= to ? addAt : null;
        if (s !== null && (a === null || s >= a)) {
          cur = s;
          sell(pos.qty, s, 'stop');
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

interface SymState {
  stock: SimInput['stocks'][number];
  dates: string[];
  byDate: Map<string, number>;
  tracker: PatternTracker;
  pos: Position | null;
  posSeq: number;
  pending: { reason: string; snapshot: PatternSnapshot } | null;
  lastClose: number | null;
  rt: { open: string; openDay: number; cost: number; proceeds: number } | null;
}

export function simulateCore(input: SimInput): CoreResult {
  const { strategy: s, days } = input;
  const feePct = s.costs.feePct;
  const amount = (s.capital.initial * s.capital.perBuyPct) / 100;
  const wallet = { cash: s.capital.initial };
  const inDays = new Set(days);
  const equity: CoreResult['equity'] = [];
  const trades: Trade[] = [];
  const skipped: Skip[] = [];
  const roundTrips: CoreResult['roundTrips'] = [];
  const skipKeys = new Set<string>();

  const syms: SymState[] = input.stocks.map((stock) => {
    const dates = stock.candles.map((k) => kstDate(k.t));
    const tracker = createPatternTracker(stock.candles, s.entry);
    let lastClose: number | null = null;
    // 워밍업: 패턴만 먹이고 거래·예약 없음
    for (let i = 0; i < dates.length && dates[i] < days[0]; i++) {
      tracker.update(i);
      lastClose = stock.candles[i].c;
    }
    tracker.resetStats();
    const byDate = new Map<string, number>();
    dates.forEach((dt, i) => inDays.has(dt) && byDate.set(dt, i));
    return { stock, dates, byDate, tracker, pos: null, posSeq: 0, pending: null, lastClose, rt: null };
  });

  const record = (st: SymState, t: Trade) => {
    trades.push(t);
    const rt = st.rt!;
    if (t.kind === 'buy' || t.kind === 'add') rt.cost += t.price * t.qty + t.fee;
    else rt.proceeds += t.price * t.qty - t.fee - t.tax;
  };

  days.forEach((date, di) => {
    // 1. 시가: 예약 매수
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
      const sized = sizeBuy(amount, price, feePct, wallet.cash);
      if (typeof sized === 'string') {
        skipped.push({ date, symbol: st.stock.symbol, reason: sized });
        continue;
      }
      st.pos = openPosition(price, sized.qty, s.scaleIn, s.exit);
      st.posSeq++;
      st.rt = { open: date, openDay: di, cost: 0, proceeds: 0 };
      wallet.cash -= sized.cost;
      record(st, { date, symbol: st.stock.symbol, kind: 'buy', price, qty: sized.qty, fee: sized.fee, tax: 0, reason, pattern: snapshot });
    }

    // 2. 장중 경로, 3. 종가
    const settle = settlementDate(date, days); // 세율은 양도일(결제일) 기준
    const closed = new Set<SymState>();
    for (const st of syms) {
      const i = st.byDate.get(date);
      if (!st.pos || i === undefined) continue;
      const { symbol, market, isEtf } = st.stock;
      walkBar(st.pos, st.stock.candles[i], {
        date,
        symbol,
        wallet,
        amount,
        feePct,
        taxPct: sellTaxPct(settle, market, isEtf),
        takeProfit: s.exit.takeProfit,
        excluded: new Set(),
        trade: (t) => record(st, t),
        skip: (reason, price) => {
          // 추가 매수 건너뜀은 (종목, 포지션, 가격)마다 한 번만 기록
          const key = `${symbol}|${st.posSeq}|${price}`;
          if (skipKeys.has(key)) return;
          skipKeys.add(key);
          skipped.push({ date, symbol, reason });
        },
      });
      if (st.pos.qty === 0) {
        const rt = st.rt!;
        roundTrips.push({ symbol, open: rt.open, close: date, cost: rt.cost, pnl: rt.proceeds - rt.cost, holdDays: di - rt.openDay + 1 });
        st.pos = null;
        st.rt = null;
        closed.add(st);
      }
    }

    let held = 0;
    for (const st of syms) {
      const i = st.byDate.get(date);
      if (i !== undefined) {
        // 그날 청산한 종목은 리셋 전 상태로 신호를 내지 않는다
        if (!st.pos && !closed.has(st) && di < days.length - 1) {
          const sig = st.tracker.signal(i);
          if (sig) st.pending = sig;
        }
        st.tracker.update(i);
        if (closed.has(st)) st.tracker.reset(i);
        st.lastClose = st.stock.candles[i].c;
      }
      if (st.pos) held += st.pos.qty * st.lastClose!; // 봉 없는 날은 마지막 종가
    }
    equity.push({ date, value: wallet.cash + held, cash: wallet.cash });
  });

  const last = days.length - 1;
  for (const st of syms) {
    if (!st.pos || !st.rt) continue;
    const value = st.pos.qty * st.lastClose!;
    roundTrips.push({
      symbol: st.stock.symbol,
      open: st.rt.open,
      close: null,
      cost: st.rt.cost,
      pnl: st.rt.proceeds + value - st.rt.cost,
      holdDays: last - st.rt.openDay + 1,
    });
  }

  const perSymbolFirstDate: Record<string, string | null> = {};
  let maxDropPct = 0;
  let declineDays = 0;
  for (const st of syms) {
    perSymbolFirstDate[st.stock.symbol] = st.dates.find((dt) => inDays.has(dt)) ?? null;
    const ps = st.tracker.stats();
    maxDropPct = Math.max(maxDropPct, ps.maxDropPct);
    declineDays += ps.declineDays;
  }

  return { equity, trades, skipped, roundTrips, perSymbolFirstDate, patternStats: { maxDropPct, declineDays } };
}

export function simulate(input: SimInput): SimResult {
  const core = simulateCore(input);
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
  };
}
