// 신호 계산(스펙 §7). 판정만 하고 주문하지 않으며 주문안도 만들지 않는다(단계 B).
import type { Candle } from '../../src/lib/data/metrics';
import type { Venue } from '../../src/lib/market/tradable';
import { normalizeOrders } from '../../src/lib/perf/ledger';
import type { Trade } from '../../src/lib/perf/types';
import type { AccountOrder, MarketDataProvider } from '../../src/lib/providers/types';
import { createRuleEvaluator, rulesLookback } from '../../src/lib/sim/rules';
import type { CondGroup, Strategy } from '../../src/lib/sim/types';
import { addDays, kstDate, kstMinuteOfDay } from '../../src/lib/time/kst';

/** KST 자정부터의 분. 통합(NXT 포함)은 20:00 */
export const CLOSE_MINUTE: Record<Venue, number> = { KRX: 15 * 60 + 30, NXT: 20 * 60, UNIFIED: 20 * 60 };

export const NOTES = {
  base: ['매매 이력 없이 계산한 조건 신호예요', 'RSI는 기준 봉 앞 250봉에서 시작해요', '보유 중인 종목도 매수 조건을 판정해요'],
  tossOnly: '보유 기준 판정은 토스만 돼요',
  avgAfterScaleIn: '분할 매수가 끝났는지 알 수 없어 손절 가격을 평단으로 계산했어요',
  breakeven: '본전 손절은 1단계 익절 여부를 알 수 없어 판정하지 않아요',
  noSymbols: '전략에 종목이 없어요',
} as const;

const EPS = 1e-9;
const round2 = (x: number) => Math.round(x * 100) / 100;

/** loadSimData와 같은 규칙: venues가 비었거나 KRX가 있으면 KRX, 아니면 첫 venue */
export function pickVenue(provider: Pick<MarketDataProvider, 'capabilities'>): Venue {
  const venues = provider.capabilities.venues;
  return venues.length === 0 || venues.includes('KRX') ? 'KRX' : venues[0];
}

/** 기준 봉의 끝 날짜. --today이고 그 venue 마감 뒤이며 오늘이 거래일일 때만 오늘, 아니면 어제 */
export function windowEnd(o: { now: number; today: boolean; venue: Venue; openToday: boolean }): { to: string; includesToday: boolean } {
  const today = kstDate(o.now);
  const includesToday = o.today && kstMinuteOfDay(o.now) >= CLOSE_MINUTE[o.venue] && o.openToday;
  return { to: includesToday ? today : addDays(today, -1), includesToday };
}

export function warmFrom(to: string, strategy: Strategy): string {
  const lookback = rulesLookback([...strategy.rules.buy, ...(strategy.rules.sell.signal.on ? strategy.rules.sell.signal.groups : [])]);
  return addDays(to, -Math.max(400, Math.ceil(lookback * 1.6)));
}

const validBar = (c: Candle) => [c.o, c.h, c.l, c.c].every((p) => Number.isFinite(p) && p > 0);

export function usableCandles(candles: Candle[], to: string): Candle[] {
  return candles.filter((c) => validBar(c) && kstDate(c.t) <= to).sort((a, b) => a.t - b.t);
}

export interface Judge {
  match: boolean;
  reason?: string;
  group?: number;
}

/** 앞 봉부터 signal→update를 차례로 부르고 idx 봉의 signal을 본다. firstDayIdx는 기준 봉(idx)이다(RSI는 기준 봉 앞 250봉에서 시작) */
export function evaluateAt(candles: Candle[], groups: CondGroup[], idx: number): Judge {
  const ev = createRuleEvaluator(candles, groups, idx);
  let last: ReturnType<typeof ev.signal> = null;
  for (let i = 0; i <= idx; i++) {
    last = ev.signal(i);
    ev.update(i);
  }
  return last ? { match: true, reason: last.reason, group: last.group } : { match: false };
}

/** 전략 종목 s와 토스 코드 code: 토스 ETN 코드는 Q 없는 6자리로 온다 */
export const matchesHolding = (strategySymbol: string, code: string): boolean => strategySymbol === code || strategySymbol === `Q${code}`;

/**
 * 보유 구간 복원용 체결 목록: normalizeOrders로 걸러(KRW·중복) 낸 뒤 실제 체결 시각순으로 다시 정렬한다.
 * normalizeOrders는 같은 날 매수를 매도보다 먼저 두므로 「같은 날 전량 매도 후 재매수」를 거꾸로 읽는다.
 */
export function tradesInFillOrder(orders: AccountOrder[]): Trade[] {
  const at = new Map(orders.map((o) => [o.orderId, Date.parse(o.filledAt ?? o.orderedAt) || Date.parse(o.orderedAt) || 0]));
  return normalizeOrders(orders).trades.sort((a, b) => (at.get(a.orderId) ?? 0) - (at.get(b.orderId) ?? 0) || a.orderId.localeCompare(b.orderId));
}

/** 수량이 0에서 양수가 된 마지막 날과 그날의 첫 매수 체결가. 끝 수량이 보유 수량과 다르면 이력이 모자란 것이라 null */
export function firstBuyOf(trades: Trade[], quantity: number): { date: string; price: number } | null {
  let qty = 0;
  let open: { date: string; price: number } | null = null;
  for (const t of trades) {
    if (t.side === 'BUY') {
      if (qty <= EPS) open = { date: t.date, price: t.price };
      qty += t.qty;
    } else {
      qty -= t.qty;
      // 주문별 체결이 합쳐져(filledAt = 마지막 체결 시각) 부분 체결이 섞이면 순서를 복원할 수 없다. 수량이 음수가 되면 복원이 틀린 것이라 모른다
      if (qty < -EPS) return null;
    }
  }
  return open !== null && Math.abs(qty - quantity) < 1e-6 ? open : null;
}

export type Tri = boolean | 'unknown';
export interface HoldingJudgement {
  symbol: string;
  quantity: number;
  avgPrice: number | null;
  close: number;
  firstBuyDate: string | null;
  stop: { price: number | null; hit: Tri } | null;
  takes: { stage: number; price: number | null; hit: Tri }[];
  /** 익절 단계가 이미 체결됐는지는 모른다 → 모든 단계를 내고 true */
  stagesDoneUnknown: boolean;
  trail: { price: number | null; hit: Tri } | null;
  timeExit: { heldDays: number | null; days: number; hit: Tri } | null;
  /** 본전 손절(1단계 익절 뒤)은 익절 여부를 몰라 판정하지 않는다 */
  breakeven?: { price: number | null; hit: 'unknown' };
  signalSell: Judge | null;
}

export function judgeHolding(i: {
  strategy: Strategy;
  symbol: string;
  quantity: number;
  avgPrice: number | undefined;
  close: number;
  first: { date: string; price: number } | null;
  peakClose: number | null;
  heldDays: number | null;
  signalSell: Judge | null;
}): HoldingJudgement {
  const { stopLoss, takeProfit, trailing, timeExit } = i.strategy.rules.sell;
  const avg = i.avgPrice;
  const down = (base: number | null | undefined, pct: number) => (base == null ? null : round2(base * (1 - pct / 100)));
  const tri = (price: number | null, hit: (p: number) => boolean): Tri => (price === null ? 'unknown' : hit(price));

  let stop: HoldingJudgement['stop'] = null;
  if (stopLoss.on) {
    const price = down(stopLoss.basis === 'firstBuy' ? i.first?.price : avg, stopLoss.pct);
    stop = { price, hit: tri(price, (p) => i.close <= p) };
  }
  const takes = takeProfit.on
    ? takeProfit.stages.map((s, k) => {
        const price = avg == null ? null : round2(avg * (1 + s.pct / 100));
        return { stage: k + 1, price, hit: tri(price, (p) => i.close >= p) };
      })
    : [];
  let trail: HoldingJudgement['trail'] = null;
  if (trailing.on) {
    // 첫 매수일부터의 종가 최고값을 모르면(조회 범위를 못 채움) 트레일은 unknown
    const price = i.first === null || i.peakClose === null ? null : down(Math.max(i.peakClose, i.first.price), trailing.pct);
    trail = { price, hit: tri(price, (p) => i.close <= p) };
  }
  const time = timeExit.on ? { heldDays: i.heldDays, days: timeExit.days, hit: (i.heldDays === null ? 'unknown' : i.heldDays >= timeExit.days) as Tri } : null;
  return {
    symbol: i.symbol,
    quantity: i.quantity,
    avgPrice: avg ?? null,
    close: i.close,
    firstBuyDate: i.first?.date ?? null,
    stop,
    takes,
    stagesDoneUnknown: takes.length > 0,
    trail,
    timeExit: time,
    ...(takeProfit.on && takeProfit.afterFirstTake === 'breakeven' ? { breakeven: { price: avg ?? null, hit: 'unknown' as const } } : {}),
    signalSell: i.signalSell,
  };
}

export interface SymbolSignal {
  symbol: string;
  buy: Judge;
  sell: Judge | null;
  /** 이 종목의 기준 봉이 전체 asOf와 다를 때만(거래정지 등) */
  asOf?: string;
}

export interface SignalsDeps {
  provider: MarketDataProvider;
  strategy: Strategy;
  symbols: string[];
  now: number;
  today: boolean;
  /** 토스: 주문 이력(파일 캐시 포함). 없으면 보유 기준 판정을 하지 않는다 */
  loadOrders?: () => Promise<AccountOrder[]>;
}

export interface SignalsOutput {
  strategy: string;
  asOf: string | null;
  includesToday: boolean;
  venue: Venue;
  signals: SymbolSignal[];
  holdings?: HoldingJudgement[];
  failed: { symbol: string; reason: string }[];
  notes: string[];
}

interface Base {
  candles: Candle[];
  idx: number;
  date: string;
  close: number;
}

export async function runSignals(d: SignalsDeps): Promise<SignalsOutput> {
  const { provider, strategy, symbols, now } = d;
  const venue = pickVenue(provider);
  const todayStr = kstDate(now);
  let openToday = false;
  if (d.today && kstMinuteOfDay(now) >= CLOSE_MINUTE[venue]) {
    openToday = (await provider.getTradingDays(todayStr, todayStr)).some((x) => x.date === todayStr && x.isOpen);
  }
  const { to, includesToday: wanted } = windowEnd({ now, today: d.today, venue, openToday });
  const from = warmFrom(to, strategy);
  const sellOn = strategy.rules.sell.signal.on;

  const fetched = await Promise.all(
    symbols.map(async (symbol) => {
      try {
        return { symbol, candles: usableCandles(await provider.getCandles({ symbol, venue, interval: '1d', from, to, priority: 0 }), to) };
      } catch (error) {
        return { symbol, error };
      }
    }),
  );

  const failed: SignalsOutput['failed'] = [];
  const bases = new Map<string, Base>();
  let firstError: unknown;
  for (const f of fetched) {
    if ('error' in f) {
      failed.push({ symbol: f.symbol, reason: '받지 못했어요' });
      firstError ??= f.error;
    } else if (f.candles.length === 0) {
      failed.push({ symbol: f.symbol, reason: '데이터가 없어요' });
    } else {
      const idx = f.candles.length - 1;
      bases.set(f.symbol, { candles: f.candles, idx, date: kstDate(f.candles[idx].t), close: f.candles[idx].c });
    }
  }
  if (symbols.length > 0 && failed.length === symbols.length && firstError !== undefined) throw firstError; // 연결·키 문제

  const asOf = [...bases.values()].reduce<string | null>((m, b) => (m === null || b.date > m ? b.date : m), null);
  const sells = new Map<string, Judge | null>();
  const signals: SymbolSignal[] = [];
  for (const symbol of symbols) {
    const b = bases.get(symbol);
    if (!b) continue;
    const sell = sellOn ? evaluateAt(b.candles, strategy.rules.sell.signal.groups, b.idx) : null;
    sells.set(symbol, sell);
    signals.push({ symbol, buy: evaluateAt(b.candles, strategy.rules.buy, b.idx), sell, ...(b.date !== asOf ? { asOf: b.date } : {}) });
  }

  const notes: string[] = [...NOTES.base];
  let holdings: HoldingJudgement[] | undefined;
  if (!provider.account || !d.loadOrders) {
    notes.push(NOTES.tossOnly);
  } else {
    const held = await provider.account.holdings();
    const matched = symbols.flatMap((s) => {
      const h = held.find((x) => matchesHolding(s, x.symbol));
      return h && bases.has(s) ? [{ s, h }] : [];
    });
    holdings = [];
    if (matched.length > 0) {
      const trades = tradesInFillOrder(await d.loadOrders());
      for (const { s, h } of matched) {
        const b = bases.get(s)!;
        const first = firstBuyOf(trades.filter((t) => matchesHolding(s, t.symbol)), h.quantity);
        let peakClose: number | null = null;
        let heldDays: number | null = null;
        if (first) {
          // 첫 매수일이 받아 둔 범위보다 앞이면 그 날부터 다시 받는다. 첫 매수일 근처부터 확보하지 못하면 최고값을 모른다(트레일 unknown)
          let all = b.candles;
          if (first.date < from) {
            try {
              all = usableCandles(await provider.getCandles({ symbol: s, venue, interval: '1d', from: first.date, to, priority: 0 }), to);
            } catch {
              all = [];
            }
          }
          const covered = all.length > 0 && kstDate(all[0].t) <= addDays(first.date, 7);
          const closes = all.filter((c) => kstDate(c.t) >= first.date && kstDate(c.t) <= b.date).map((c) => c.c);
          peakClose = !covered ? null : closes.length ? Math.max(...closes) : first.price;
          heldDays = first.date > b.date ? 0 : (await provider.getTradingDays(first.date, b.date)).filter((x) => x.isOpen).length;
        }
        holdings.push(judgeHolding({ strategy, symbol: s, quantity: h.quantity, avgPrice: h.avgPrice, close: b.close, first, peakClose, heldDays, signalSell: sells.get(s) ?? null }));
      }
    }
    const { stopLoss, takeProfit } = strategy.rules.sell;
    if (stopLoss.on && stopLoss.basis === 'avgAfterScaleIn') notes.push(NOTES.avgAfterScaleIn);
    if (takeProfit.on && takeProfit.afterFirstTake === 'breakeven') notes.push(NOTES.breakeven);
  }
  if (symbols.length === 0) notes.push(NOTES.noSymbols);

  return {
    strategy: strategy.name,
    asOf,
    includesToday: wanted && asOf === todayStr,
    venue,
    signals,
    ...(holdings ? { holdings } : {}),
    failed,
    notes,
  };
}
