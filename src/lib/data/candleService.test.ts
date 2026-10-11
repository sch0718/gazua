import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { fetchPlanFor } from '../market/periods';
import { sessionsForDay, type TradingDay } from '../market/sessions';
import { tradableIntervals, type Venue, type VenueMode } from '../market/tradable';
import { createDemoProvider } from '../providers/demo';
import { ApiError } from '../providers/errors';
import type { ProxyClient, ProxyResponse } from '../providers/http';
import { createKisProvider } from '../providers/kis';
import type { CandleQuery, MarketDataProvider, StockMeta, TokenInfo } from '../providers/types';
import tokenFixture from '../providers/fixtures/kis/token.json';
import type { Period } from '../state/schema';
import { addDays, kstDate, kstEpoch, kstWeekday } from '../time/kst';
import { createCandleCache, type CandleCache } from './candleCache';
import {
  DAILY_CLOSE_INCLUDES_AFTER_MARKET,
  adjustmentFactor,
  createDailyMemo,
  createSeriesSnapshots,
  indexAvailabilityFor,
  loadIndexSeries,
  loadSeries,
  type LoadedSeries,
} from './candleService';
import { metricAvailability } from './metricRegistry';
import { changePct, rvolDaily, rvolIntraday, type Candle } from './metrics';
import { createRequestQueue } from './requestQueue';

const MIN = 60_000;
const SUN = kstEpoch('2026-10-11', '12:00:00'); // 10/9(금) 휴장 → 최근 거래일 10/8(목)
const THU_10 = kstEpoch('2026-10-08', '10:00:00'); // 장중
const THU_2030 = kstEpoch('2026-10-08', '20:30:00'); // 장 밖
const D1: Period = { unit: 'D', n: 1 };
const W1: Period = { unit: 'W', n: 1 };
const W2: Period = { unit: 'W', n: 2 };
const Y1: Period = { unit: 'Y', n: 1 };
const HOLIDAYS = ['2026-10-09'];

const at = (date: string, hhmm: string) => kstEpoch(date, `${hhmm}:00`);
const dayT = (date: string) => kstEpoch(date, '00:00:00');
const isOpen = (d: string) => kstWeekday(d) !== 0 && kstWeekday(d) !== 6 && !HOLIDAYS.includes(d);
function openDays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (isOpen(d)) out.push(d);
  return out;
}
const dayNum = (d: string) => Math.round((dayT(d) - dayT('2026-01-01')) / 86_400_000);

function meta(over: Partial<StockMeta> = {}): StockMeta {
  return {
    symbol: '005930',
    name: '삼성전자',
    market: 'KOSPI',
    securityType: 'STOCK',
    nxtSupported: true,
    krxSuspended: false,
    nxtSuspended: null,
    liquidationTrading: false,
    sharesOutstanding: 1000,
    ...over,
  };
}

type DailyFn = (venue: Venue, date: string) => { c: number; v: number } | null;
type MinuteFn = (venue: Venue, t: number) => { c: number; v?: number } | null;
const VENUE_PRICE: Record<Venue, number> = { KRX: 100, NXT: 200, UNIFIED: 150 };

interface FakeOpts {
  id?: MarketDataProvider['id'];
  venues?: Venue[];
  now: () => number;
  daily?: DailyFn;
  minute?: MinuteFn;
  /** false면 getIndexCandles 없음 */
  index?: boolean;
  indexMinutePastDays?: boolean;
}

/** 거래일은 평일 중 HOLIDAYS 제외. 미래 봉은 주지 않는다. */
function fakeProvider(o: FakeOpts) {
  const calls: CandleQuery[] = [];
  const indexCalls: { index: string; interval: string; from: string; to: string }[] = [];
  const fail = { daily: false, minute: false, index: false };
  const state = {
    daily: o.daily ?? ((venue: Venue) => ({ c: VENUE_PRICE[venue], v: 1000 })),
    minute: o.minute ?? ((venue: Venue) => ({ c: VENUE_PRICE[venue] })),
  };
  const dailyBars = (fn: DailyFn, venue: Venue, from: string, to: string): Candle[] =>
    openDays(from, to)
      .filter((d) => dayT(d) <= o.now())
      .flatMap((d) => {
        const x = fn(venue, d);
        return x ? [{ t: dayT(d), o: x.c, h: x.c, l: x.c, c: x.c, v: x.v }] : [];
      });
  const minuteBars = (fn: MinuteFn, venue: Venue, date: string): Candle[] => {
    if (!isOpen(date)) return [];
    const out: Candle[] = [];
    for (let t = at(date, '08:00'); t < at(date, '20:00'); t += MIN) {
      if (t >= o.now()) break;
      const x = fn(venue, t);
      if (x) out.push({ t, o: x.c, h: x.c, l: x.c, c: x.c, v: x.v ?? 10 });
    }
    return out;
  };
  const hasIndex = o.index ?? true;
  const provider: MarketDataProvider = {
    id: o.id ?? 'kis',
    capabilities: {
      venues: o.venues ?? ['KRX', 'NXT', 'UNIFIED'],
      quoteBatchSize: 1,
      hasIndexCandles: hasIndex,
      indexMinutePastDays: o.indexMinutePastDays ?? false,
    },
    getStockMeta: async (symbols) => symbols.map((symbol) => meta({ symbol })),
    getQuotes: async () => [],
    async getTradingDays(from, to) {
      const days: TradingDay[] = [];
      for (let d = from; d <= to; d = addDays(d, 1)) days.push({ date: d, isOpen: isOpen(d) });
      return days;
    },
    async getCandles(q) {
      calls.push(q);
      if (q.interval === '1d') {
        if (fail.daily) throw new ApiError('upstream');
        return dailyBars(state.daily, q.venue, q.from, q.to);
      }
      if (fail.minute) throw new ApiError('timeout');
      if (q.from !== q.to) throw new Error('fake: one day at a time');
      return minuteBars(state.minute, q.venue, q.from);
    },
  };
  if (hasIndex) {
    provider.getIndexCandles = async (index, interval, from, to) => {
      indexCalls.push({ index, interval, from, to });
      if (fail.index) throw new ApiError('upstream');
      if (interval === '1d') return dailyBars((_v, d) => ({ c: 2000 + dayNum(d), v: 1 }), 'KRX', from, to);
      return minuteBars(() => ({ c: 2500 }), 'KRX', from);
    };
  }
  const count = (interval: '1m' | '1d') => calls.filter((c) => c.interval === interval).length;
  return { provider, calls, indexCalls, fail, state, count };
}

let dbSeq = 0;
/** 호출마다 비어 있는 캐시(별도 DB)와 메모 */
function deps(clock: { now: number }) {
  return { cache: createCandleCache(`gazua-cache-test-${++dbSeq}`, () => clock.now), memo: createDailyMemo() };
}

const barAt = (s: LoadedSeries, t: number) => s.candles.find((c) => c.t === t);
const lastPct = (s: LoadedSeries) =>
  changePct(
    s.candles.map((c) => ({ t: c.t, v: c.c })),
    s.base as number,
  ).at(-1)?.v;

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('loadSeries: trading date and venues', () => {
  it('D1 on a holiday shows the latest trading day', async () => {
    const clock = { now: SUN };
    const f = fakeProvider({ now: () => clock.now });
    const s = await loadSeries({ provider: f.provider, ...deps(clock), meta: meta(), period: D1, venueMode: 'AUTO', now: SUN });
    expect(s.tradingDate).toBe('2026-10-08');
    const minuteCalls = f.calls.filter((c) => c.interval === '1m');
    expect(minuteCalls.map((c) => c.venue).sort()).toEqual(['KRX', 'NXT']);
    for (const c of minuteCalls) {
      expect(c.from).toBe('2026-10-08');
      expect(c.to).toBe('2026-10-08');
    }
    expect(s.candles.length).toBeGreaterThan(0);
    expect(s.candles.every((c) => kstDate(c.t) === '2026-10-08')).toBe(true);
    expect(s.computedAt).toBe(SUN);
    expect(s.sharesOutstanding).toBe(1000);
  });

  it('uses the previous trading day before the first session of an open day', async () => {
    const clock = { now: kstEpoch('2026-10-08', '07:30:00') };
    const f = fakeProvider({ now: () => clock.now });
    const s = await loadSeries({ provider: f.provider, ...deps(clock), meta: meta(), period: D1, venueMode: 'KRX', now: clock.now });
    expect(s.tradingDate).toBe('2026-10-07');
  });

  it('AUTO stitches NXT pre, KRX regular, KRX after for KIS', async () => {
    const clock = { now: SUN };
    const f = fakeProvider({ now: () => clock.now });
    const s = await loadSeries({ provider: f.provider, ...deps(clock), meta: meta(), period: D1, venueMode: 'AUTO', now: SUN });
    const d = '2026-10-08';
    expect(barAt(s, at(d, '08:10'))?.c).toBe(200);
    expect(barAt(s, at(d, '10:00'))?.c).toBe(100);
    expect(barAt(s, at(d, '17:00'))?.c).toBe(100);
    expect(barAt(s, at(d, '15:45'))?.c).toBe(200);
    // 단일가 구간의 봉은 그 구간 거래소(tradableIntervals AUTO)의 것을 남긴다: KRX 시가·종가 단일가.
    expect(barAt(s, at(d, '08:55'))?.c).toBe(100);
    expect(barAt(s, at(d, '15:25'))?.c).toBe(100);
    expect(s.candles.map((c) => c.t)).toEqual([...s.candles.map((c) => c.t)].sort((a, b) => a - b));
    expect(new Set(s.candles.map((c) => c.t)).size).toBe(s.candles.length);
    expect(s.segments).toEqual([
      { start: at(d, '08:00'), end: at(d, '08:50'), venue: 'NXT' },
      { start: at(d, '08:50'), end: at(d, '15:30'), venue: 'KRX' },
      { start: at(d, '15:30'), end: at(d, '16:00'), venue: 'NXT' },
      { start: at(d, '16:00'), end: at(d, '20:00'), venue: 'KRX' },
    ]);
    expect(s.intervals).toEqual(tradableIntervals(sessionsForDay({ date: d, isOpen: true }), meta(), 'AUTO'));
  });

  it('AUTO 1D of an NXT-unsupported ETF ends at the KRX closing-auction bar (official close)', async () => {
    const clock = { now: SUN };
    const d = '2026-10-08';
    const f = fakeProvider({
      now: () => clock.now,
      minute: (venue, t) => (t === at(d, '15:29') ? { c: 123 } : { c: VENUE_PRICE[venue] }),
    });
    const etf = meta({ symbol: '069500', securityType: 'ETF', nxtSupported: false });
    const s = await loadSeries({ provider: f.provider, ...deps(clock), meta: etf, period: D1, venueMode: 'AUTO', now: SUN });
    expect(s.candles.at(-1)).toMatchObject({ t: at(d, '15:29'), c: 123 });
    expect(lastPct(s)).toBeCloseTo(((123 - (s.base as number)) / (s.base as number)) * 100, 6);
    // 시가 단일가 봉도 남고, ETF에 없는 KRX 애프터 봉은 버린다.
    expect(barAt(s, at(d, '08:45'))?.c).toBe(100);
    expect(barAt(s, at(d, '08:29'))).toBeUndefined();
    expect(barAt(s, at(d, '16:30'))).toBeUndefined();
  });

  it('AUTO 1D of an NXT stock keeps the KRX closing-auction bar, then NXT from 15:40', async () => {
    const clock = { now: SUN };
    const d = '2026-10-08';
    const f = fakeProvider({
      now: () => clock.now,
      minute: (venue, t) => (venue === 'KRX' && t === at(d, '15:29') ? { c: 111 } : { c: VENUE_PRICE[venue] }),
    });
    const s = await loadSeries({ provider: f.provider, ...deps(clock), meta: meta(), period: D1, venueMode: 'AUTO', now: SUN });
    expect(barAt(s, at(d, '15:19'))?.c).toBe(100);
    expect(barAt(s, at(d, '15:29'))?.c).toBe(111);
    expect(barAt(s, at(d, '15:40'))?.c).toBe(200);
    const closeIdx = s.candles.findIndex((c) => c.t === at(d, '15:29'));
    expect(s.candles.slice(closeIdx + 1).every((c) => c.t >= at(d, '15:30'))).toBe(true);
    // KRX 우선 규칙은 그대로: 정규장 중에는 NXT 봉이 끼지 않는다.
    expect(s.candles.filter((c) => c.t >= at(d, '09:00') && c.t < at(d, '15:30')).every((c) => c.c !== 200)).toBe(true);
  });

  it('AUTO on a stock without NXT fetches only KRX minutes', async () => {
    const clock = { now: SUN };
    const f = fakeProvider({ now: () => clock.now });
    const s = await loadSeries({
      provider: f.provider, ...deps(clock), meta: meta({ nxtSupported: false }), period: D1, venueMode: 'AUTO', now: SUN,
    });
    expect(f.calls.filter((c) => c.interval === '1m').map((c) => c.venue)).toEqual(['KRX']);
    expect(new Set(s.segments.map((x) => x.venue))).toEqual(new Set(['KRX']));
  });

  it('toss forces UNIFIED regardless of venueMode', async () => {
    for (const mode of ['AUTO', 'KRX', 'NXT', 'UNIFIED'] as VenueMode[]) {
      const clock = { now: SUN };
      const f = fakeProvider({ id: 'toss', venues: ['UNIFIED'], now: () => clock.now });
      const s = await loadSeries({ provider: f.provider, ...deps(clock), meta: meta(), period: D1, venueMode: mode, now: SUN });
      expect(f.calls.length).toBeGreaterThan(0);
      expect(f.calls.every((c) => c.venue === 'UNIFIED')).toBe(true);
      expect(s.intervals.length).toBeGreaterThan(0);
      expect(s.intervals.every((i) => i.venue === 'UNIFIED')).toBe(true);
      expect(s.segments.map((x) => x.venue)).toEqual(['UNIFIED']);
      expect(s.base).toBe(150);
    }
  });

  it('daily periods use KRX candles and KRX previous close as base', async () => {
    const daily: DailyFn = (venue, d) => ({ c: (venue === 'KRX' ? 1000 : 5000) + dayNum(d), v: 1000 });
    const plan = fetchPlanFor(W1, '2026-10-08');
    const prevClose = 1000 + dayNum('2026-10-01');

    const clock = { now: SUN };
    const f = fakeProvider({ now: () => clock.now, daily });
    const auto = await loadSeries({ provider: f.provider, ...deps(clock), meta: meta(), period: W1, venueMode: 'AUTO', now: SUN });
    expect(f.calls.map((c) => [c.interval, c.venue])).toEqual([['1d', 'KRX']]);
    expect(auto.base).toBe(prevClose);
    expect(auto.candles.map((c) => kstDate(c.t))).toEqual(openDays(plan.from, plan.to));
    expect(auto.candles.every((c) => c.c === 1000 + dayNum(kstDate(c.t)))).toBe(true);

    // NXT 모드: 봉은 NXT, 기준가는 여전히 KRX 종가
    const g = fakeProvider({ now: () => clock.now, daily });
    const nxt = await loadSeries({ provider: g.provider, ...deps(clock), meta: meta(), period: W1, venueMode: 'NXT', now: SUN });
    expect(g.calls.map((c) => c.venue).sort()).toEqual(['KRX', 'NXT']);
    expect(nxt.base).toBe(prevClose);
    expect(nxt.candles.every((c) => c.c === 5000 + dayNum(kstDate(c.t)))).toBe(true);
    expect(nxt.daily.every((c) => c.c >= 5000)).toBe(true);
  });

  it('empty candles yield an empty series without throwing', async () => {
    const clock = { now: SUN };
    const f = fakeProvider({ now: () => clock.now, minute: () => null, daily: (_v, d) => ({ c: 500 + dayNum(d), v: 1 }) });
    const s = await loadSeries({ provider: f.provider, ...deps(clock), meta: meta(), period: D1, venueMode: 'AUTO', now: SUN });
    expect(s.candles).toEqual([]);
    expect(s.segments).toEqual([]);
    expect(s.base).toBe(500 + dayNum('2026-10-07'));
  });
});

describe('daily: one request, memo, adjusted prices', () => {
  it('daily comes from one request covering lookbackFrom..today', async () => {
    const daily: DailyFn = (_v, d) => ({ c: 100 + dayNum(d), v: 1000 + dayNum(d) * 3 });
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    for (const period of [W2, D1]) {
      const clock = { now: THU_10 };
      const f = fakeProvider({ now: () => clock.now, daily });
      const s = await loadSeries({ provider: f.provider, ...deps(clock), meta: meta(), period, venueMode: 'AUTO', now: THU_10 });
      const plan = fetchPlanFor(period, '2026-10-08');
      const dailyCalls = f.calls.filter((c) => c.interval === '1d');
      expect(dailyCalls).toEqual([{ symbol: '005930', venue: 'KRX', interval: '1d', from: plan.lookbackFrom, to: '2026-10-08' }]);

      const before = openDays(plan.lookbackFrom, addDays(plan.from, -1));
      expect(s.base).toBe(daily('KRX', before.at(-1) as string)?.c);
      expect(s.avgDailyVolume).toBeCloseTo(mean(before.slice(-20).map((d) => daily('KRX', d)?.v as number)), 9);
      expect(s.daily.at(-1)?.t).toBe(dayT('2026-10-08')); // 오늘 봉도 같은 응답
      if (period.unit === 'W') expect(s.candles.at(-1)?.c).toBe(daily('KRX', '2026-10-08')?.c);
    }
  });

  it('avgDailyVolume is null with fewer than 20 prior daily bars', async () => {
    const clock = { now: THU_10 };
    const f = fakeProvider({ now: () => clock.now, daily: (_v, d) => (d >= '2026-09-20' ? { c: 100, v: 5 } : null) });
    const s = await loadSeries({ provider: f.provider, ...deps(clock), meta: meta(), period: D1, venueMode: 'KRX', now: THU_10 });
    expect(s.avgDailyVolume).toBeNull();
    expect(s.base).toBe(100);
  });

  it('daily memo expires after 60s in session and 10min outside', async () => {
    for (const [start, keep, refetch] of [
      [THU_10, 59_000, 61_000],
      [THU_2030, 9 * MIN, 11 * MIN],
    ]) {
      const clock = { now: start };
      const f = fakeProvider({ now: () => clock.now });
      const d = deps(clock);
      const load = () => loadSeries({ provider: f.provider, ...d, meta: meta(), period: W1, venueMode: 'KRX', now: clock.now });
      await load();
      expect(f.count('1d')).toBe(1);
      clock.now = start + keep;
      await load();
      expect(f.count('1d')).toBe(1);
      clock.now = start + refetch;
      await load();
      expect(f.count('1d')).toBe(2);
    }

    const memo = createDailyMemo();
    const v: Candle[] = [{ t: 1, o: 1, h: 1, l: 1, c: 1, v: 1 }];
    memo.set('k', v, 0, 60_000);
    expect(memo.get('k', 59_999)).toEqual(v);
    expect(memo.get('k', 60_000)).toBeUndefined();
    expect(memo.get('k', 0)).toBeUndefined(); // 만료된 키는 get에서 지워졌다

    // set은 다른 만료 항목(예: 어제 날짜 키)도 정리한다
    memo.set('2026-10-07', v, 0, 60_000);
    memo.set('2026-10-08', v, 120_000, 60_000);
    expect(memo.get('2026-10-07', 0)).toBeUndefined();
    expect(memo.get('2026-10-08', 120_000)).toEqual(v);
  });

  it('NXT mode memoizes base and series daily as one pair', async () => {
    const clock = { now: THU_10 };
    const f = fakeProvider({ now: () => clock.now });
    const d = deps(clock);
    const load = (venueMode: VenueMode) =>
      loadSeries({ provider: f.provider, ...d, meta: meta(), period: W1, venueMode, now: clock.now });
    const dailyVenues = () => f.calls.filter((c) => c.interval === '1d').map((c) => c.venue);

    await load('KRX');
    expect(dailyVenues()).toEqual(['KRX']);
    // KRX 단독 메모가 살아 있어도 NXT 모드는 기준·시리즈 일봉을 함께 받는다
    clock.now += 30_000;
    await load('NXT');
    expect(dailyVenues().sort()).toEqual(['KRX', 'KRX', 'NXT']);
    clock.now += 20_000;
    await load('NXT');
    await load('KRX');
    expect(dailyVenues()).toHaveLength(3);
    // KRX 단독 메모가 만료돼도 쌍은 쌍대로 유지된다(30초 뒤 함께 만료)
    clock.now += 20_000;
    await load('KRX');
    await load('NXT');
    expect(dailyVenues()).toHaveLength(4);
    clock.now += 20_000;
    await load('NXT');
    expect(dailyVenues().slice(4).sort()).toEqual(['KRX', 'NXT']);
  });

  it('paged daily refetches when overlapping day disagrees', async () => {
    const compact = (d: string) => d.replaceAll('-', '');
    const json = (j: unknown): ProxyResponse => ({ status: 200, headers: new Headers(), json: j });
    function kis(closeFor: (page: number) => number) {
      let page = 0;
      let dailyRequests = 0;
      const client: ProxyClient = {
        async request(_p, method, path, opts = {}) {
          if (method === 'POST') return json(tokenFixture);
          const q = opts.query ?? {};
          if (path.endsWith('inquire-daily-itemchartprice')) {
            dailyRequests++;
            const c = closeFor(page++);
            const rows = openDays('2025-01-01', '2026-10-08')
              .filter((d) => compact(d) >= q.FID_INPUT_DATE_1 && compact(d) <= q.FID_INPUT_DATE_2)
              .reverse()
              .slice(0, 100)
              .map((d) => ({ stck_bsop_date: compact(d), stck_clpr: String(c), stck_oprc: '1', stck_hgpr: '2', stck_lwpr: '1', acml_vol: '3' }));
            return json({ rt_cd: '0', msg_cd: 'MCA00000', output2: rows });
          }
          throw new Error(`unrouted ${path}`);
        },
      };
      let token: TokenInfo | null = null;
      const real = createKisProvider({
        client,
        queue: createRequestQueue({ ratesPerSec: { kis: 15 }, now: () => 0, sleep: async () => {} }),
        creds: { appKey: 'k', appSecret: 's' },
        tokenStore: { load: () => token, save: (t) => (token = t) },
        now: () => SUN,
      });
      const calendar = fakeProvider({ now: () => SUN }).provider;
      const provider: MarketDataProvider = { ...real, getTradingDays: calendar.getTradingDays };
      return { provider, requests: () => dailyRequests };
    }
    const args = (provider: MarketDataProvider) => ({
      provider, ...deps({ now: SUN }), meta: meta(), period: Y1, venueMode: 'KRX' as const, now: SUN,
    });

    const clean = kis(() => 100);
    await loadSeries(args(clean.provider));
    const pagesPerAttempt = clean.requests();
    expect(pagesPerAttempt).toBeGreaterThanOrEqual(3);

    // 두 번째 요청(첫 시도의 2페이지)만 겹친 날 종가가 다르다 → 처음부터 1회 다시 받아 일관된 결과
    const once = kis((page) => (page === 1 ? 999 : 100));
    const s = await loadSeries(args(once.provider));
    expect(once.requests()).toBe(2 + pagesPerAttempt);
    expect(s.base).toBe(100);
    expect(s.daily.every((c) => c.c === 100)).toBe(true);

    // 다시 받아도 다르면 그 종목은 조회 실패
    const always = kis((page) => 100 + page);
    const err = await createSeriesSnapshots().load(args(always.provider)).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
  });

  it('D1 past day with post-event adjusted daily does not mix', async () => {
    // 1:1 무상증자 반영 일봉(종가 50, 거래량 2배) vs 원래 가격 1분봉(종가 단일가 봉 100)
    const clock = { now: SUN };
    const f = fakeProvider({
      now: () => clock.now,
      daily: () => ({ c: 50, v: 2000 }),
      minute: (venue, t) => (venue === 'KRX' ? { c: t >= at('2026-10-08', '16:00') ? 104 : 100 } : { c: 101 }),
    });
    for (const venueMode of ['KRX', 'AUTO'] as VenueMode[]) {
      const s = await loadSeries({ provider: f.provider, ...deps(clock), meta: meta(), period: D1, venueMode, now: SUN });
      expect(s.base).toBe(100);
      expect(s.avgDailyVolume).toBe(1000);
      expect(lastPct(s)).toBeCloseTo(4, 9); // 마지막 봉 104 기준 +4%, +108%가 아님
    }
  });

  it('factor is applied exactly once', async () => {
    const clock = { now: SUN };
    const f = fakeProvider({ now: () => clock.now, daily: () => ({ c: 50, v: 2000 }), minute: () => ({ c: 100, v: 10 }) });
    const s = await loadSeries({ provider: f.provider, ...deps(clock), meta: meta(), period: D1, venueMode: 'KRX', now: SUN });
    const total = s.candles.reduce((sum, c) => sum + c.v, 0);
    expect(rvolIntraday(s.candles, s.avgDailyVolume).at(-1)?.v).toBeCloseTo(total / 1000, 12);
    expect(s.base).toBe(100);
  });

  it('split adjustment never mixes old and new prices', async () => {
    const clock = { now: THU_10 };
    const f = fakeProvider({ now: () => clock.now, daily: (_v, d) => ({ c: 100 + (dayNum(d) % 7), v: 1000 + dayNum(d) }) });
    const d = deps(clock);
    const load = () => loadSeries({ provider: f.provider, ...d, meta: meta(), period: W1, venueMode: 'KRX', now: clock.now });
    const before = await load();
    // 메모 만료 뒤 공급자가 1:2 분할을 반영한 값을 준다
    f.state.daily = (_v, day) => ({ c: (100 + (dayNum(day) % 7)) / 2, v: 2 * (1000 + dayNum(day)) });
    clock.now += 61_000;
    const after = await load();
    expect(f.count('1d')).toBe(2);
    expect(after.base).toBe((before.base as number) / 2);
    expect(lastPct(after)).toBeCloseTo(lastPct(before) as number, 9);
    expect(lastPct(after)).not.toBeCloseTo(-50, 0);
    expect(rvolDaily(after.daily, 20).at(-1)?.v).toBeCloseTo(rvolDaily(before.daily, 20).at(-1)?.v as number, 12);
  });
});

describe('adjustmentFactor', () => {
  const d = '2026-10-08';
  const sessions = sessionsForDay({ date: d, isOpen: true });
  const daily = (c: number): Candle[] => [{ t: dayT(d), o: c, h: c, l: c, c, v: 1 }];
  const bar = (hhmm: string, c: number): Candle => ({ t: at(d, hhmm), o: c, h: c, l: c, c, v: 1 });
  const krx = tradableIntervals(sessions, meta(), 'KRX');
  const base = { tradingDate: d, today: '2026-10-11' };

  it('is the daily close divided by the closing-auction bar when they disagree', () => {
    expect(DAILY_CLOSE_INCLUDES_AFTER_MARKET).toBe(false);
    expect(adjustmentFactor({ ...base, daily: daily(50), minutes: [bar('15:19', 99), bar('15:29', 100)], intervals: krx })).toBe(0.5);
    // 종가 단일가 구간에 봉이 없으면 다른 봉으로 대신하지 않고 1
    expect(adjustmentFactor({ ...base, daily: daily(50), minutes: [bar('15:19', 100), bar('16:30', 120)], intervals: krx })).toBe(1);
  });

  it('adjustmentFactor stays 1 on normal days and undefined comparisons', () => {
    // (a) 오늘
    expect(adjustmentFactor({ ...base, today: d, daily: daily(50), minutes: [bar('15:29', 100)], intervals: krx })).toBe(1);
    // (b) 종가 단일가 봉 100, 19:59 KRX 애프터 봉 103, 일봉 100, 플래그 false
    const b = [bar('15:29', 100), bar('19:59', 103)];
    expect(adjustmentFactor({ ...base, daily: daily(100), minutes: b, intervals: krx })).toBe(1);
    expect(adjustmentFactor({ ...base, daily: daily(100), minutes: b, intervals: krx, includesAfterMarket: true })).toBeCloseTo(100 / 103, 12);
    // (c) NXT 모드의 NXT 지원 종목
    const nxt = tradableIntervals(sessions, meta(), 'NXT');
    expect(adjustmentFactor({ ...base, daily: daily(50), minutes: [bar('15:19', 100), bar('19:59', 100)], intervals: nxt })).toBe(1);
    // (d) 토스 UNIFIED
    const uni = tradableIntervals(sessions, meta(), 'UNIFIED');
    expect(adjustmentFactor({ ...base, daily: daily(50), minutes: [bar('15:29', 100)], intervals: uni })).toBe(1);
    // (e) 1분봉 없음
    expect(adjustmentFactor({ ...base, daily: daily(50), minutes: [], intervals: krx })).toBe(1);
    // (f) 오차 0.4%
    expect(adjustmentFactor({ ...base, daily: daily(100.4), minutes: [bar('15:29', 100)], intervals: krx })).toBe(1);
    // (g) AUTO + NXT 지원 ETF + 플래그 true: 마지막 봉이 NXT 애프터여도 KRX 구간 마지막 봉과만 비교
    const etf = meta({ securityType: 'ETF', nxtSupported: true });
    const auto = tradableIntervals(sessions, etf, 'AUTO');
    expect(auto.find((i) => i.start === at(d, '19:00'))).toBeUndefined();
    expect(adjustmentFactor({
      ...base, daily: daily(100), minutes: [bar('15:29', 100), bar('19:59', 130)], intervals: auto, includesAfterMarket: true,
    })).toBe(1);
  });

  it('loadSeries keeps the daily base unchanged when the factor is 1', async () => {
    const prev = (c: number): DailyFn => () => ({ c, v: 1 });
    const cases: { venues?: Venue[]; id?: MarketDataProvider['id']; mode: VenueMode; daily: DailyFn; minute: MinuteFn; base: number }[] = [
      // (b) 종가 단일가 100 + KRX 애프터 103, 일봉 100
      { mode: 'KRX', daily: prev(100), minute: (_v, t) => ({ c: t >= at(d, '16:00') ? 103 : 100 }), base: 100 },
      // (c) NXT 모드, NXT 지원 종목: 비교할 KRX 봉이 없다
      { mode: 'NXT', daily: prev(50), minute: () => ({ c: 100 }), base: 50 },
      // (d) 토스 통합
      { mode: 'AUTO', id: 'toss', venues: ['UNIFIED'], daily: prev(50), minute: () => ({ c: 100 }), base: 50 },
      // (e) 1분봉 없음
      { mode: 'KRX', daily: prev(50), minute: () => null, base: 50 },
    ];
    for (const c of cases) {
      const clock = { now: SUN };
      const f = fakeProvider({ now: () => clock.now, id: c.id, venues: c.venues, daily: c.daily, minute: c.minute });
      const s = await loadSeries({ provider: f.provider, ...deps(clock), meta: meta(), period: D1, venueMode: c.mode, now: SUN });
      expect(s.base).toBe(c.base);
      expect(s.avgDailyVolume).toBe(1);
    }
  });
});

describe('minute cache', () => {
  it('cache failures degrade to provider fetches', async () => {
    const broken: CandleCache = {
      get: async () => {
        throw new Error('idb read failed');
      },
      put: async () => {
        throw new Error('quota exceeded');
      },
      evict: async () => {},
      clear: async () => {},
      estimateBytes: async () => 0,
    };
    const clock = { now: SUN };
    const f = fakeProvider({ now: () => clock.now });
    const s = await loadSeries({ provider: f.provider, cache: broken, memo: createDailyMemo(), meta: meta(), period: D1, venueMode: 'AUTO', now: SUN });
    expect(s.candles.length).toBeGreaterThan(0);
    expect(f.count('1m')).toBe(2);
    const idx = await loadIndexSeries({ provider: f.provider, cache: broken, index: 'KOSPI', period: W1, now: SUN });
    expect(idx?.candles.length).toBeGreaterThan(0);
  });

  it('past trading day minutes come from the cache; today refetches after 61s', async () => {
    const clock = { now: kstEpoch('2026-10-08', '07:30:00') }; // 첫 세션 전 → 지난 거래일 10/7
    const f = fakeProvider({ now: () => clock.now });
    const cache = createCandleCache('gazua-cache', () => clock.now);
    const load = () =>
      loadSeries({ provider: f.provider, cache, memo: createDailyMemo(), meta: meta(), period: D1, venueMode: 'KRX', now: clock.now });
    const first = await load();
    expect(first.tradingDate).toBe('2026-10-07');
    expect(f.count('1m')).toBe(1);
    const second = await load();
    expect(f.count('1m')).toBe(1);
    expect(second.candles).toEqual(first.candles);

    clock.now = THU_10;
    await load();
    expect(f.count('1m')).toBe(2);
    clock.now = THU_10 + 30_000;
    await load();
    expect(f.count('1m')).toBe(2);
    clock.now = THU_10 + 61_000;
    await load();
    expect(f.count('1m')).toBe(3);
  });
});

describe('index series', () => {
  it('index series uses same base rule', async () => {
    const demo = createDemoProvider({ seed: 7, now: () => SUN });
    const clock = { now: SUN };
    const { cache } = deps(clock);
    const w1 = await loadIndexSeries({ provider: demo, cache, index: 'KOSPI', period: W1, now: SUN });
    const plan = fetchPlanFor(W1, '2026-10-08');
    const daily = await demo.getIndexCandles!('KOSPI', '1d', plan.lookbackFrom, '2026-10-11');
    const before = daily.filter((c) => kstDate(c.t) < plan.from);
    expect(w1?.base).toBe(before.at(-1)?.c);
    expect(w1?.candles.map((c) => kstDate(c.t))).toEqual(openDays(plan.from, plan.to));
    expect(w1?.tradingDate).toBe('2026-10-08');

    const d1 = await loadIndexSeries({ provider: demo, cache, index: 'KOSPI', period: D1, now: SUN });
    const prev = daily.find((c) => kstDate(c.t) === '2026-10-07');
    expect(d1?.base).toBe(prev?.c);
    expect(d1?.candles.length).toBeGreaterThan(0);
    expect(d1?.candles.every((c) => kstDate(c.t) === '2026-10-08')).toBe(true);

    const none = fakeProvider({ now: () => SUN, index: false });
    expect(await loadIndexSeries({ provider: none.provider, cache, index: 'KOSPI', period: W1, now: SUN })).toBeNull();
  });

  it('excess on a past trading day is unavailable when the provider has no past index minutes', async () => {
    const clock = { now: SUN };
    const f = fakeProvider({ now: () => clock.now, indexMinutePastDays: false });
    const r = await loadIndexSeries({ provider: f.provider, ...deps(clock), index: 'KOSPI', period: D1, now: SUN });
    expect(r).toBeNull();
    expect(f.indexCalls).toEqual([]);
    const index = indexAvailabilityFor({
      caps: f.provider.capabilities, period: D1, tradingDate: '2026-10-08', today: '2026-10-11', indexLoad: 'null',
    });
    expect(index).toBe('no-past-minutes');
    expect(metricAvailability('excess', { period: D1, index, hasShares: true }).ok).toBe(false);

    // 오늘이 거래일이면 지수 분봉을 받는다
    const today = fakeProvider({ now: () => THU_10, indexMinutePastDays: false });
    const r2 = await loadIndexSeries({ provider: today.provider, ...deps({ now: THU_10 }), index: 'KOSDAQ', period: D1, now: THU_10 });
    expect(r2?.candles.length).toBeGreaterThan(0);
    expect(today.indexCalls.some((c) => c.interval === '1m' && c.from === '2026-10-08' && c.to === '2026-10-08')).toBe(true);
  });

  it('indexAvailabilityFor priority is none > no-past-minutes > failed > ok', () => {
    const caps = { venues: ['KRX'] as Venue[], quoteBatchSize: 1, hasIndexCandles: true, indexMinutePastDays: false };
    const past = { period: D1, tradingDate: '2026-10-08', today: '2026-10-11' };
    expect(indexAvailabilityFor({ caps: { ...caps, hasIndexCandles: false }, ...past, indexLoad: 'failed' })).toBe('none');
    expect(indexAvailabilityFor({ caps, ...past, indexLoad: 'failed' })).toBe('no-past-minutes');
    expect(indexAvailabilityFor({ caps, ...past, period: W1, indexLoad: 'failed' })).toBe('failed');
    expect(indexAvailabilityFor({ caps, ...past, period: W1, indexLoad: 'ok' })).toBe('ok');
    expect(indexAvailabilityFor({ caps: { ...caps, indexMinutePastDays: true }, ...past, indexLoad: 'ok' })).toBe('ok');
    expect(indexAvailabilityFor({ caps, ...past, period: W1, indexLoad: 'null' })).toBe('none');
  });
});

describe('series snapshots', () => {
  for (const which of ['daily', 'minute'] as const) {
    it(`failed refresh returns the last good snapshot unchanged (${which} fails)`, async () => {
      const clock = { now: THU_10 };
      const f = fakeProvider({ now: () => clock.now, daily: () => ({ c: 90, v: 1 }) });
      const d = deps(clock);
      const snaps = createSeriesSnapshots();
      const args = () => ({ provider: f.provider, ...d, meta: meta(), period: D1, venueMode: 'KRX' as const, now: clock.now });
      const first = await snaps.load(args());
      expect(first.stale).toBe(false);

      clock.now += 61_000; // 일봉 메모·당일 1분봉 캐시 모두 만료
      f.state.daily = () => ({ c: 70, v: 9 });
      f.state.minute = () => ({ c: 300 });
      f.fail[which] = true;
      const second = await snaps.load(args());
      expect(second.stale).toBe(true);
      expect(second.base).toBe(first.base);
      expect(second.candles).toEqual(first.candles);
      expect(second.candles.at(-1)?.c).toBe(first.candles.at(-1)?.c);
      expect(second.computedAt).toBe(first.computedAt);

      const fresh = await createSeriesSnapshots().load(args()).catch((e) => e);
      expect(fresh).toBeInstanceOf(ApiError);
    });
  }

  it('snapshots are keyed by provider and trading date', async () => {
    const snaps = createSeriesSnapshots();
    const clock = { now: kstEpoch('2026-10-07', '10:00:00') };
    const args = (provider: MarketDataProvider) => ({
      provider, ...deps(clock), meta: meta(), period: D1, venueMode: 'AUTO' as const, now: clock.now,
    });
    const ok = await snaps.load(args(createDemoProvider({ seed: 1, now: () => clock.now })));
    expect(ok.stale).toBe(false);
    expect(ok.tradingDate).toBe('2026-10-07');

    // 공급자가 바뀌면 데모 결과를 돌려주지 않는다
    const kis = fakeProvider({ now: () => clock.now });
    kis.fail.daily = true;
    expect(await snaps.load(args(kis.provider)).catch((e) => e)).toBeInstanceOf(ApiError);

    // 같은 공급자(id 'demo')라도 다음 거래일에는 전날 결과를 돌려주지 않는다
    clock.now = THU_10;
    const failingDemo = fakeProvider({ id: 'demo', now: () => clock.now });
    failingDemo.fail.minute = true;
    expect(await snaps.load(args(failingDemo.provider)).catch((e) => e)).toBeInstanceOf(ApiError);
  });

  it('index failure disables only excess for that load', async () => {
    const clock = { now: THU_10 };
    const f = fakeProvider({ now: () => clock.now });
    f.fail.index = true;
    const d = deps(clock);
    const indexErr = await loadIndexSeries({ provider: f.provider, cache: d.cache, index: 'KOSPI', period: D1, now: THU_10 }).catch((e) => e);
    expect(indexErr).toBeInstanceOf(ApiError);
    const s = await createSeriesSnapshots().load({ provider: f.provider, ...d, meta: meta(), period: D1, venueMode: 'AUTO', now: THU_10 });
    expect(s.stale).toBe(false);
    expect(s.candles.length).toBeGreaterThan(0);
    const index = indexAvailabilityFor({
      caps: f.provider.capabilities, period: D1, tradingDate: s.tradingDate, today: '2026-10-08', indexLoad: 'failed',
    });
    expect(index).toBe('failed');
    expect(metricAvailability('excess', { period: D1, index, hasShares: true }).ok).toBe(false);
    expect(metricAvailability('change', { period: D1, index, hasShares: true }).ok).toBe(true);
  });
});
