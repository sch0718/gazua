// 키가 없을 때와 E2E 테스트에서 쓰는 결정적 데모 공급자.
// 같은 seed·같은 now이면 언제나 같은 데이터를 낸다(외부 입력·Math.random 없음).
import type { Candle } from '../data/metrics';
import type { UniverseItem } from '../data/universe';
import { sessionsForDay, type TradingDay } from '../market/sessions';
import { tradableIntervals, type TradableMeta, type Venue } from '../market/tradable';
import { addDays, kstDate, kstEpoch, kstWeekday } from '../time/kst';
import { sellTaxPct } from '../sim/tax';
import type { AccountOrder, AccountSource, CandleQuery, MarketDataProvider, Quote, StockMeta } from './types';

const MINUTE = 60_000;
const HOLIDAYS = new Set(['2026-09-24', '2026-09-25', '2026-10-09']);
/** 일봉 랜덤워크의 시작일. 이전 날짜에는 일봉이 없다. */
const ANCHOR = '2025-01-01';
const PREV_CLOSE_LOOKBACK_DAYS = 15;

// market은 universe.json(KRX 종목 마스터)의 시장 값과 같다.
const KNOWN: Record<
  string,
  { name: string; market: StockMeta['market']; securityType: StockMeta['securityType']; nxt: boolean; base: number; shares: number }
> = {
  '005930': { name: '삼성전자', market: 'KOSPI', securityType: 'STOCK', nxt: true, base: 72_000, shares: 5919637922 },
  '000660': { name: 'SK하이닉스', market: 'KOSPI', securityType: 'STOCK', nxt: true, base: 195_000, shares: 728002365 },
  '042700': { name: '한미반도체', market: 'KOSPI', securityType: 'STOCK', nxt: false, base: 120_000, shares: 97100000 },
  '000990': { name: 'DB하이텍', market: 'KOSPI', securityType: 'STOCK', nxt: true, base: 48_000, shares: 44400000 },
  '069500': { name: 'KODEX 200', market: 'KOSPI', securityType: 'ETF', nxt: false, base: 36_000, shares: 100000000 },
};

/** universe.json의 시장 값(m). 목록에 없으면 KOSPI(이전과 같은 기본값). */
function marketOf(listed?: UniverseItem): StockMeta['market'] {
  if (!listed) return 'KOSPI';
  return listed.m === 'KOSDAQ' ? 'KOSDAQ' : listed.m === 'KOSPI' ? 'KOSPI' : 'KR_ETC';
}

const INDEX_BASE = { KOSPI: 2_650, KOSDAQ: 850 } as const;

/** 데모 계좌의 첫 주문 가능일. 그 뒤 거래일 축의 비율 위치(at)에 주문을 둔다. */
const ACCOUNT_FROM = '2025-02-03';
/** 데모 계좌 주문 계획: 종목, 방향, 수량, 거래일 축에서의 위치(0~1) */
const ACCOUNT_PLAN: ReadonlyArray<{ symbol: string; side: 'BUY' | 'SELL'; qty: number; at: number }> = [
  { symbol: '005930', side: 'BUY', qty: 10, at: 0.02 },
  { symbol: '000660', side: 'BUY', qty: 3, at: 0.05 },
  { symbol: '042700', side: 'BUY', qty: 8, at: 0.1 },
  { symbol: '000990', side: 'BUY', qty: 20, at: 0.15 },
  { symbol: '005930', side: 'BUY', qty: 5, at: 0.3 },
  { symbol: '000660', side: 'SELL', qty: 3, at: 0.4 },
  { symbol: '042700', side: 'BUY', qty: 4, at: 0.45 },
  { symbol: '000990', side: 'SELL', qty: 8, at: 0.5 },
  { symbol: '005930', side: 'SELL', qty: 6, at: 0.55 },
  { symbol: '042700', side: 'SELL', qty: 5, at: 0.65 },
  { symbol: '000660', side: 'BUY', qty: 2, at: 0.7 },
  { symbol: '005930', side: 'BUY', qty: 4, at: 0.8 },
  { symbol: '000990', side: 'BUY', qty: 10, at: 0.85 },
  { symbol: '000990', side: 'SELL', qty: 4, at: 0.92 },
];
/** 보유 수량을 일부러 1주 어긋나게 둘 종목(입고한 주식이 있는 것처럼). 수량 대조 화면을 데모에서 보이려고. */
const ACCOUNT_EXTRA_HOLDING = '042700';
/** 토스 국내 주식 수수료율(0.015%) */
const ACCOUNT_FEE_RATE = 0.00015;

/** 32비트 FNV-1a */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 평균 0·표준편차 약 1인 근사 정규 난수 */
const shock = (rand: () => number): number => (rand() + rand() + rand() - 1.5) * 2;

/** 시리즈 하나(종목 또는 지수)를 생성하는 데 필요한 정보 */
interface Instrument {
  key: string;
  base: number;
  decimals: 0 | 2;
  /** 이 날짜·거래소에서 1분봉이 나오는 연속 구간 [start, end) */
  windows(date: string, venue: Venue): Array<[number, number]>;
}

interface CloseSeries {
  through: string;
  y: number;
  closes: Map<string, number>;
}

/** `listed`는 종목 목록(universe.json)의 항목. KNOWN에 없는 종목의 이름·시장·종류를 실제 값으로 채운다. */
function metaFor(symbol: string, listed?: UniverseItem): StockMeta {
  const known = KNOWN[symbol];
  const common = { krxSuspended: false, nxtSuspended: null, liquidationTrading: false };
  if (known) {
    return {
      symbol,
      name: known.name,
      market: known.market,
      securityType: known.securityType,
      nxtSupported: known.nxt,
      sharesOutstanding: known.shares,
      ...common,
    };
  }
  const h = hashString(symbol);
  return {
    symbol,
    name: listed?.n ?? symbol,
    market: marketOf(listed),
    securityType: listed?.t ?? 'STOCK',
    nxtSupported: (h & 1) === 1,
    sharesOutstanding: 10_000_000 + (hashString(`shares|${symbol}`) % 990_000_000),
    ...common,
  };
}

export function createDemoProvider(opts: {
  seed: number;
  now: () => number;
  /** 종목 목록. 없거나 못 받으면 KNOWN에 없는 종목은 코드를 이름으로 쓴다(테스트는 오프라인으로 돌린다). */
  universe?: () => Promise<UniverseItem[]>;
}): MarketDataProvider {
  const { seed, now } = opts;
  const rngFor = (...parts: Array<string | number>) => mulberry32(hashString([seed, ...parts].join('|')));
  const roundTo = (inst: Instrument, x: number) => (inst.decimals === 0 ? Math.round(x) : Math.round(x * 100) / 100);

  const isOpenDay = (date: string): boolean => {
    const wd = kstWeekday(date);
    return wd !== 0 && wd !== 6 && !HOLIDAYS.has(date);
  };
  const tradingDay = (date: string): TradingDay => ({ date, isOpen: isOpenDay(date) });

  function previousOpenDay(date: string): string | null {
    for (let i = 1; i <= PREV_CLOSE_LOOKBACK_DAYS; i++) {
      const d = addDays(date, -i);
      if (d < ANCHOR) return null;
      if (isOpenDay(d)) return d;
    }
    return null;
  }

  // ── 인스턴스 ──────────────────────────────────────────────
  const stockCache = new Map<string, Instrument>();
  function stockInstrument(symbol: string): Instrument {
    let inst = stockCache.get(symbol);
    if (inst) return inst;
    const meta: TradableMeta = metaFor(symbol);
    const known = KNOWN[symbol];
    const base = known ? known.base : 5_000 + (hashString(`base|${symbol}`) % 195_000);
    inst = {
      key: symbol,
      base: known ? base : Math.round(base / 100) * 100,
      decimals: 0,
      windows(date, venue) {
        let sessions;
        try {
          sessions = sessionsForDay({ date, isOpen: true });
        } catch {
          return []; // 시간표가 정의되기 전 날짜
        }
        return tradableIntervals(sessions, meta, venue)
          .filter((i) => i.kind === 'continuous')
          .map((i): [number, number] => [i.start, i.end]);
      },
    };
    stockCache.set(symbol, inst);
    return inst;
  }

  const indexInstrument = (index: 'KOSPI' | 'KOSDAQ'): Instrument => ({
    key: `INDEX:${index}`,
    base: INDEX_BASE[index],
    decimals: 2,
    windows: (date) => [[kstEpoch(date, '09:00:00'), kstEpoch(date, '15:30:00')]],
  });

  // ── 일별 종가 (KRX 기준, 범위와 무관하게 결정적) ─────────────
  const seriesCache = new Map<string, CloseSeries>();
  function krxClose(inst: Instrument, date: string): number {
    let s = seriesCache.get(inst.key);
    if (!s) {
      s = { through: addDays(ANCHOR, -1), y: 0, closes: new Map() };
      seriesCache.set(inst.key, s);
    }
    while (s.through < date) {
      const d = addDays(s.through, 1);
      if (isOpenDay(d)) {
        // 기준가 쪽으로 약하게 되돌아오는 로그 랜덤워크
        s.y = s.y * 0.985 + shock(rngFor(inst.key, d, 'close')) * 0.012;
        s.closes.set(d, inst.base * Math.exp(s.y));
      }
      s.through = d;
    }
    return s.closes.get(date) ?? inst.base;
  }

  /** 거래소별 일 종가. NXT·통합은 KRX와 조금 다르다. */
  function dayClose(inst: Instrument, date: string, venue: Venue): number {
    const spread = venue === 'KRX' ? 0 : venue === 'NXT' ? 0.006 : 0.003;
    const factor = 1 + (rngFor(inst.key, date, venue, 'factor')() - 0.5) * spread;
    return roundTo(inst, krxClose(inst, date) * factor);
  }

  /** 직전 거래일 종가. 없으면 기준가. */
  function prevClose(inst: Instrument, date: string, venue: Venue): number {
    const prev = previousOpenDay(date);
    return prev ? dayClose(inst, prev, venue) : roundTo(inst, inst.base);
  }

  // ── 봉 생성 ──────────────────────────────────────────────
  /** 하루치 1분봉 전체(현재 시각 무관). 마지막 봉의 종가는 그날 일 종가에 맞춘다. */
  function fullDayMinutes(inst: Instrument, date: string, venue: Venue): Candle[] {
    if (!isOpenDay(date) || date < ANCHOR) return [];
    const starts: number[] = [];
    for (const [start, end] of inst.windows(date, venue)) {
      for (let t = Math.ceil(start / MINUTE) * MINUTE; t + MINUTE <= end; t += MINUTE) starts.push(t);
    }
    const n = starts.length;
    if (n === 0) return [];

    const rand = rngFor(inst.key, date, venue, '1m');
    const open = prevClose(inst, date, venue);
    const target = dayClose(inst, date, venue);
    const logOpen = Math.log(open * (1 + (rand() - 0.5) * 0.004));
    const walk = [logOpen];
    for (let i = 0; i < n; i++) walk.push(walk[i] + shock(rand) * 0.0004);
    // 마지막 값이 일 종가가 되도록 선형으로 보정한다.
    const drift = Math.log(target) - walk[n];
    const prices = walk.map((w, i) => roundTo(inst, Math.exp(w + (drift * i) / n)));
    prices[n] = target;

    const candles: Candle[] = [];
    for (let i = 0; i < n; i++) {
      const o = prices[i];
      const c = prices[i + 1];
      candles.push({
        t: starts[i],
        o,
        h: roundTo(inst, Math.max(o, c) * (1 + rand() * 0.0004)),
        l: roundTo(inst, Math.min(o, c) * (1 - rand() * 0.0004)),
        c,
        v: 100 + Math.floor(rand() * rand() * 20_000),
      });
    }
    return candles;
  }

  /** 하루치 1분봉. 오늘이면 now 이전에 시작한 봉만, 미래 날짜는 비어 있다. */
  function minuteCandles(inst: Instrument, date: string, venue: Venue): Candle[] {
    const t = now();
    const today = kstDate(t);
    if (date > today) return [];
    const full = fullDayMinutes(inst, date, venue);
    return date === today ? full.filter((c) => c.t < t) : full;
  }

  function dailyCandle(inst: Instrument, date: string, venue: Venue): Candle | null {
    if (!isOpenDay(date) || date < ANCHOR) return null;
    const t = kstEpoch(date, '00:00:00');
    if (date === kstDate(now())) {
      const mins = minuteCandles(inst, date, venue);
      if (mins.length === 0) return null;
      return {
        t,
        o: mins[0].o,
        h: Math.max(...mins.map((m) => m.h)),
        l: Math.min(...mins.map((m) => m.l)),
        c: mins[mins.length - 1].c,
        v: mins.reduce((sum, m) => sum + m.v, 0),
      };
    }
    const rand = rngFor(inst.key, date, venue, '1d');
    const o = prevClose(inst, date, venue);
    const c = dayClose(inst, date, venue);
    return {
      t,
      o,
      h: roundTo(inst, Math.max(o, c) * (1 + rand() * 0.01)),
      l: roundTo(inst, Math.min(o, c) * (1 - rand() * 0.01)),
      c,
      v: 100_000 + Math.floor(rand() * 5_000_000),
    };
  }

  function candlesFor(inst: Instrument, venue: Venue, interval: '1m' | '1d', from: string, to: string): Candle[] {
    const last = to < kstDate(now()) ? to : kstDate(now());
    const result: Candle[] = [];
    for (let d = from; d <= last; d = addDays(d, 1)) {
      if (interval === '1m') result.push(...minuteCandles(inst, d, venue));
      else {
        const bar = dailyCandle(inst, d, venue);
        if (bar) result.push(bar);
      }
    }
    return result;
  }

  function quoteFor(symbol: string, venue: Venue): Quote {
    const inst = stockInstrument(symbol);
    const t = now();
    const today = kstDate(t);
    const bars = minuteCandles(inst, today, venue);
    if (bars.length > 0) {
      const lastBar = bars[bars.length - 1];
      return { symbol, venue, price: lastBar.c, ts: lastBar.t };
    }
    const prev = previousOpenDay(today);
    return { symbol, venue, price: prev ? dayClose(inst, prev, venue) : roundTo(inst, inst.base), ts: null };
  }

  // ── 데모 계좌 (내 성과) ─────────────────────────────────────
  /** 오늘 전까지의 계획된 주문. 가격은 그날 KRX 종가 근처, 해외 주문 하나를 섞는다(계산에서 빠지는지 보이려고). */
  function accountOrders(): AccountOrder[] {
    const today = kstDate(now());
    const days: string[] = [];
    for (let d = ACCOUNT_FROM; d < today; d = addDays(d, 1)) if (isOpenDay(d)) days.push(d);
    if (days.length < ACCOUNT_PLAN.length) return [];
    const orders = ACCOUNT_PLAN.map((p, i): AccountOrder => {
      const date = days[Math.min(days.length - 1, Math.floor(p.at * days.length))];
      const inst = stockInstrument(p.symbol);
      const jitter = 1 + (rngFor('account', i, date)() - 0.5) * 0.01;
      const price = roundTo(inst, krxClose(inst, date) * jitter);
      const amount = price * p.qty;
      const known = KNOWN[p.symbol];
      const tax = p.side === 'SELL' ? Math.floor((amount * sellTaxPct(date, known.market, known.securityType === 'ETF')) / 100) : 0;
      const minute = String(10 + (i % 40)).padStart(2, '0');
      return {
        orderId: `demo-${i + 1}`,
        symbol: p.symbol,
        side: p.side,
        status: 'FILLED',
        currency: 'KRW',
        orderedAt: `${date}T10:${minute}:00+09:00`,
        filledAt: `${date}T10:${minute}:30+09:00`,
        quantity: p.qty,
        price,
        amount,
        commission: Math.floor(amount * ACCOUNT_FEE_RATE),
        tax,
      };
    });
    const usDate = days[Math.floor(days.length * 0.6)];
    orders.push({
      orderId: 'demo-us-1',
      symbol: 'AAPL',
      side: 'BUY',
      status: 'FILLED',
      currency: 'USD',
      orderedAt: `${usDate}T23:40:00+09:00`,
      filledAt: `${usDate}T23:40:10+09:00`,
      quantity: 2,
      price: 180,
      amount: 360,
      commission: 0.36,
      tax: 0,
    });
    return orders.sort((a, b) => a.orderedAt.localeCompare(b.orderedAt));
  }

  const account: AccountSource = {
    async accountId() {
      return 'demo';
    },
    async closedOrders(o = {}) {
      const rows = accountOrders().filter((r) => {
        const d = r.orderedAt.slice(0, 10);
        return (!o.from || d >= o.from) && (!o.to || d <= o.to);
      });
      o.onPage?.(rows.length);
      return rows;
    },
    async holdings() {
      const qty = new Map<string, number>();
      for (const r of accountOrders()) {
        if (r.currency !== 'KRW') continue;
        qty.set(r.symbol, (qty.get(r.symbol) ?? 0) + (r.side === 'BUY' ? r.quantity : -r.quantity));
      }
      if (qty.has(ACCOUNT_EXTRA_HOLDING)) qty.set(ACCOUNT_EXTRA_HOLDING, qty.get(ACCOUNT_EXTRA_HOLDING)! + 1);
      return [...qty].filter(([, q]) => q > 0).map(([symbol, quantity]) => ({ symbol, name: KNOWN[symbol]?.name ?? symbol, quantity }));
    },
  };

  return {
    id: 'demo',
    account,
    capabilities: {
      venues: ['KRX', 'NXT', 'UNIFIED'],
      quoteBatchSize: 200,
      hasIndexCandles: true,
      indexMinutePastDays: true,
    },
    async getStockMeta(symbols) {
      const listed = new Map<string, UniverseItem>();
      if (opts.universe && symbols.some((s) => !KNOWN[s])) {
        try {
          for (const u of await opts.universe()) listed.set(u.s, u);
        } catch {
          // 목록을 못 받으면 코드를 이름으로 쓴다.
        }
      }
      return symbols.map((s) => metaFor(s, listed.get(s)));
    },
    async getCandles(q: CandleQuery) {
      return candlesFor(stockInstrument(q.symbol), q.venue, q.interval, q.from, q.to);
    },
    async getQuotes(symbols, venue) {
      return symbols.map((s) => quoteFor(s, venue));
    },
    async getTradingDays(from, to) {
      const days: TradingDay[] = [];
      for (let d = from; d <= to; d = addDays(d, 1)) days.push(tradingDay(d));
      return days;
    },
    // 우선순위는 받기만 한다(큐가 없다).
    async getIndexCandles(index, interval, from, to, _priority) {
      return candlesFor(indexInstrument(index), 'KRX', interval, from, to);
    },
  };
}
