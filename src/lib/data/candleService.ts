// 공급자 봉 → 기간·거래소 모드별 차트 시리즈. 스펙 4.2–4.4, 5.1–5.4.
import { fetchPlanFor, type FetchPlan } from '../market/periods';
import { sessionsForDay, type TradingDay } from '../market/sessions';
import { sessionLabelAt, tradableIntervals, type TradeInterval, type Venue, type VenueMode } from '../market/tradable';
import { ApiError } from '../providers/errors';
import type { MarketDataProvider, ProviderCapabilities, StockMeta } from '../providers/types';
import type { Period } from '../state/schema';
import { addDays, kstDate } from '../time/kst';
import type { CandleCache } from './candleCache';
import type { IndexAvailability } from './metricRegistry';
import type { Candle } from './metrics';

/** KRX 일봉 종가에 애프터마켓 체결이 포함되는지. 실연결 점검표 ③으로 확정한다. */
export const DAILY_CLOSE_INCLUDES_AFTER_MARKET = false;

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const TODAY_MINUTE_TTL_MS = 60_000;
const DAILY_TTL_IN_SESSION_MS = 60_000;
const DAILY_TTL_OUTSIDE_MS = 600_000;
const INDEX_DAILY_TTL_MS = 600_000;
const RVOL_DAYS = 20;
const CALENDAR_LOOKBACK_DAYS = 14;
const FACTOR_TOLERANCE = 0.01;

// ── 일봉 메모 (메모리 전용) ─────────────────────────────────────

export interface DailyMemo {
  get(key: string, now: number): Candle[] | undefined;
  set(key: string, v: Candle[], now: number, ttlMs: number): void;
}

/** 키 `provider|symbol|venue|from|to`. 만료 항목은 get에서, 그리고 set할 때 모두 지운다. */
export function createDailyMemo(): DailyMemo {
  const entries = new Map<string, { v: Candle[]; expiresAt: number }>();
  return {
    get(key, now) {
      const e = entries.get(key);
      if (!e) return undefined;
      if (now >= e.expiresAt) {
        entries.delete(key);
        return undefined;
      }
      return e.v;
    },
    set(key, v, now, ttlMs) {
      // 지난 날짜 키(키에 today가 들어 있다)가 쌓이지 않게 만료 항목을 정리한다.
      for (const [k, e] of entries) if (now >= e.expiresAt) entries.delete(k);
      entries.set(key, { v, expiresAt: now + ttlMs });
    },
  };
}

// ── 결과 ───────────────────────────────────────────────────────

export interface SeriesSegment {
  start: number;
  end: number;
  venue: Venue;
}

export interface LoadedSeries {
  symbol: string;
  tradingDate: string;
  /** 기간 시작 직전 거래일 KRX(없으면 통합) 종가. 1일 차트는 adjustmentFactor 적용 후 값 */
  base: number | null;
  /** RVOL용 직전 20거래일 평균 거래량. 1일 차트는 환산 후 값 */
  avgDailyVolume: number | null;
  candles: Candle[];
  /** 시리즈 거래소의 lookbackFrom..오늘 일봉 전체 */
  daily: Candle[];
  segments: SeriesSegment[];
  intervals: TradeInterval[];
  sharesOutstanding?: number;
  computedAt: number;
}

export interface LoadSeriesArgs {
  provider: MarketDataProvider;
  cache: CandleCache;
  memo: DailyMemo;
  meta: StockMeta;
  period: Period;
  venueMode: VenueMode;
  now: number;
}

// ── 거래일 ─────────────────────────────────────────────────────

interface TradingContext {
  today: string;
  /** 차트가 보여 줄 거래일: 오늘 첫 세션이 시작했으면 오늘, 아니면 직전 거래일 */
  day: TradingDay;
  /** 지금 어느 세션 안인지(일봉 메모 TTL) */
  inSession: boolean;
}

async function tradingContext(provider: MarketDataProvider, now: number): Promise<TradingContext> {
  const today = kstDate(now);
  const days = await provider.getTradingDays(addDays(today, -CALENDAR_LOOKBACK_DAYS), today);
  const todayDay = days.find((d) => d.date === today && d.isOpen);
  const todaySessions = todayDay ? sessionsForDay(todayDay) : [];
  const started = todaySessions.length > 0 && now >= Math.min(...todaySessions.map((s) => s.start));
  const inSession = sessionLabelAt(todaySessions, now) !== null;
  if (todayDay && started) return { today, day: todayDay, inSession };

  const past = days.filter((d) => d.isOpen && d.date < today).sort((a, b) => a.date.localeCompare(b.date));
  const day = past.at(-1);
  if (!day) throw new ApiError('upstream', 'no trading day in the calendar window');
  return { today, day, inSession };
}

// ── 공통 계산 ──────────────────────────────────────────────────

const dateOf = (c: Candle) => kstDate(c.t);

/** `date` 이전 마지막 봉의 종가 */
function closeBefore(daily: Candle[], date: string): number | null {
  const before = daily.filter((c) => dateOf(c) < date);
  return before.at(-1)?.c ?? null;
}

/** `date` 직전 20거래일 평균 거래량. 20개가 안 되면 null */
function avgVolumeBefore(daily: Candle[], date: string): number | null {
  const last = daily.filter((c) => dateOf(c) < date).slice(-RVOL_DAYS);
  if (last.length < RVOL_DAYS) return null;
  return last.reduce((sum, c) => sum + c.v, 0) / RVOL_DAYS;
}

const inRange = (daily: Candle[], plan: FetchPlan) =>
  daily.filter((c) => dateOf(c) >= plan.from && dateOf(c) <= plan.to);

/** 같은 거래소가 이어지는 봉 묶음. end는 마지막 봉의 끝. */
function segmentsOf(bars: { t: number; venue: Venue }[], barMs: number): SeriesSegment[] {
  const out: SeriesSegment[] = [];
  for (const b of bars) {
    const last = out.at(-1);
    if (last && last.venue === b.venue) last.end = b.t + barMs;
    else out.push({ start: b.t, end: b.t + barMs, venue: b.venue });
  }
  return out;
}

// ── 1일 차트의 기준 맞추기 ───────────────────────────────────────

/**
 * 1분봉(원래 가격)과 일봉(수정주가)의 비율. 지난 거래일 1일 차트에서만 1이 아닐 수 있다.
 * 비교 봉: 플래그가 false면 KRX 종가 단일가 구간 안의 마지막 봉, true면 KRX 구간 안의 마지막 봉.
 * KRX 구간이나 비교 봉이 없거나(종가 단일가 구간에 봉이 없는 경우 포함) |factor − 1| ≤ 1%면 1.
 * `includesAfterMarket`은 테스트용으로만 바꾼다.
 */
export function adjustmentFactor(args: {
  daily: Candle[];
  minutes: Candle[];
  intervals: TradeInterval[];
  tradingDate: string;
  today: string;
  includesAfterMarket?: boolean;
}): number {
  const { daily, minutes, intervals, tradingDate, today } = args;
  const includesAfterMarket = args.includesAfterMarket ?? DAILY_CLOSE_INCLUDES_AFTER_MARKET;
  if (tradingDate === today) return 1;

  const krx = intervals.filter((i) => i.venue === 'KRX');
  if (krx.length === 0) return 1;
  const inside = (t: number, list: TradeInterval[]) => list.some((i) => i.start <= t && t < i.end);
  const krxBars = minutes.filter((c) => inside(c.t, krx));

  let bar: Candle | undefined;
  if (includesAfterMarket) {
    bar = krxBars.at(-1);
  } else {
    // 종가 단일가: 첫 KRX 접속매매 구간 뒤에 오는 마지막 KRX 단일가 구간(시가 단일가는 앞에 온다)
    const firstContinuous = krx.find((i) => i.kind === 'continuous');
    const closing = krx.filter((i) => i.kind === 'auction' && firstContinuous && i.start > firstContinuous.start).at(-1);
    // 다른 봉으로 대신하지 않는다(정규장 마지막 봉은 종가와 달라 평소에도 1%를 넘을 수 있다).
    bar = closing ? krxBars.filter((c) => inside(c.t, [closing])).at(-1) : undefined;
  }
  const dailyClose = daily.find((c) => dateOf(c) === tradingDate)?.c;
  if (!bar || dailyClose === undefined || bar.c === 0) return 1;

  const factor = dailyClose / bar.c;
  return Math.abs(factor - 1) <= FACTOR_TOLERANCE ? 1 : factor;
}

// ── 종목 시리즈 ────────────────────────────────────────────────

interface Venues {
  mode: VenueMode;
  /** 기준 종가·RVOL 일봉 */
  base: Venue;
  /** 일봉 시리즈 */
  series: Venue;
  /** 1일 차트에서 받을 1분봉 */
  minutes: Venue[];
}

function venuesFor(caps: ProviderCapabilities, meta: StockMeta, requested: VenueMode): Venues {
  const stitches = caps.venues.includes('KRX') && caps.venues.includes('NXT');
  const mode: VenueMode =
    requested === 'AUTO' ? (stitches ? 'AUTO' : 'UNIFIED') : caps.venues.includes(requested) ? requested : 'UNIFIED';
  const base: Venue = caps.venues.includes('KRX') ? 'KRX' : 'UNIFIED';
  const nxtOwn = mode === 'NXT' && meta.nxtSupported;
  const minutes: Venue[] =
    mode === 'AUTO'
      ? meta.nxtSupported
        ? ['KRX', 'NXT']
        : ['KRX']
      : mode === 'NXT'
        ? [nxtOwn ? 'NXT' : 'KRX']
        : [mode];
  return { mode, base, series: nxtOwn ? 'NXT' : base, minutes };
}

async function cachedFetch(
  cache: CandleCache,
  key: string,
  ttlMs: number | null,
  fetch: () => Promise<Candle[]>,
): Promise<Candle[]> {
  // 저장소 오류는 조회를 막지 않는다(스펙 11): 읽기 실패는 미스, 쓰기는 최선 노력.
  let hit: Candle[] | undefined;
  try {
    hit = await cache.get(key);
  } catch {
    hit = undefined;
  }
  if (hit) return hit;
  const v = await fetch();
  // 빈 응답은 저장하지 않는다(지난 날짜가 영구히 비어 보이지 않게).
  if (v.length > 0) {
    try {
      await cache.put(key, v, ttlMs);
    } catch {
      // 저장 실패는 무시한다.
    }
  }
  return v;
}

export async function loadSeries(args: LoadSeriesArgs): Promise<LoadedSeries> {
  const { provider, cache, memo, meta, period, now } = args;
  const ctx = await tradingContext(provider, now);
  const tradingDate = ctx.day.date;
  const plan = fetchPlanFor(period, tradingDate);
  const v = venuesFor(provider.capabilities, meta, args.venueMode);
  const sessions = sessionsForDay(ctx.day);
  const intervals = tradableIntervals(sessions, meta, v.mode);

  const dailyTtl = ctx.inSession ? DAILY_TTL_IN_SESSION_MS : DAILY_TTL_OUTSIDE_MS;
  const fetchDaily = (venue: Venue) =>
    provider.getCandles({ symbol: meta.symbol, venue, interval: '1d', from: plan.lookbackFrom, to: ctx.today });
  /**
   * 기준 일봉과 시리즈 일봉. 거래소가 다르면(NXT 모드) 두 응답을 한 쌍의 메모 키로 함께 받고 함께 만료시킨다.
   * 기준 종가와 봉이 서로 다른 시각의 수정주가에서 나오지 않게 하기 위함이다.
   */
  const dailyPair = async (): Promise<{ base: Candle[]; series: Candle[] }> => {
    if (v.series === v.base) {
      const key = `${provider.id}|${meta.symbol}|${v.base}|${plan.lookbackFrom}|${ctx.today}`;
      const hit = memo.get(key, now);
      if (hit) return { base: hit, series: hit };
      const bars = await fetchDaily(v.base);
      memo.set(key, bars, now, dailyTtl);
      return { base: bars, series: bars };
    }
    // 두 항목을 같은 시각·같은 TTL로 함께 쓰므로 함께 만료된다. 한쪽만 있으면 둘 다 다시 받는다.
    const pairKey = `${provider.id}|${meta.symbol}|PAIR:${v.base}+${v.series}|${plan.lookbackFrom}|${ctx.today}`;
    const baseHit = memo.get(`${pairKey}|base`, now);
    const seriesHit = memo.get(`${pairKey}|series`, now);
    if (baseHit && seriesHit) return { base: baseHit, series: seriesHit };
    const [base, series] = await Promise.all([fetchDaily(v.base), fetchDaily(v.series)]);
    memo.set(`${pairKey}|base`, base, now, dailyTtl);
    memo.set(`${pairKey}|series`, series, now, dailyTtl);
    return { base, series };
  };
  const minutes = (venue: Venue): Promise<Candle[]> =>
    cachedFetch(
      cache,
      `${provider.id}|${meta.symbol}|${venue}|1m|${tradingDate}`,
      tradingDate === ctx.today ? TODAY_MINUTE_TTL_MS : null,
      () => provider.getCandles({ symbol: meta.symbol, venue, interval: '1m', from: tradingDate, to: tradingDate }),
    );

  const isD1 = period.unit === 'D';
  const [{ base: baseDaily, series: seriesDaily }, minuteSets] = await Promise.all([
    dailyPair(),
    isD1 ? Promise.all(v.minutes.map(async (venue) => ({ venue, bars: await minutes(venue) }))) : [],
  ]);

  let base = closeBefore(baseDaily, plan.from);
  let avgDailyVolume = avgVolumeBefore(baseDaily, isD1 ? tradingDate : plan.from);
  const result = {
    symbol: meta.symbol,
    tradingDate,
    daily: seriesDaily,
    intervals,
    computedAt: now,
    ...(meta.sharesOutstanding !== undefined ? { sharesOutstanding: meta.sharesOutstanding } : {}),
  };

  if (!isD1) {
    const candles = inRange(result.daily, plan);
    return { ...result, base, avgDailyVolume, candles, segments: segmentsOf(candles.map((c) => ({ t: c.t, venue: v.series })), DAY_MS) };
  }

  // 1일 차트: AUTO면 각 봉 시각을 담은 거래 가능 구간(tradableIntervals AUTO)의 거래소 봉만 남긴다.
  // 접속매매는 KRX 우선 규칙 그대로이고, 단일가 구간(KRX 시가·종가 단일가)의 봉도 남겨
  // 15:30 공식 종가가 1일 차트의 마지막 값이 되게 한다. 단일가 구간은 lineData가 점선으로 그린다.
  const venueAt = (t: number) => intervals.find((i) => i.start <= t && t < i.end)?.venue ?? null;
  const tagged = minuteSets
    .flatMap(({ venue, bars }) =>
      bars.filter((c) => v.mode !== 'AUTO' || venueAt(c.t) === venue).map((c) => ({ c, venue })),
    )
    .sort((a, b) => a.c.t - b.c.t);

  const factor = adjustmentFactor({
    daily: baseDaily,
    // 일봉 종가와 같은 정의의 원래 KRX 1분봉(종가 단일가 봉 포함, 이어 붙이기 전)
    minutes: minuteSets.find((m) => m.venue === 'KRX')?.bars ?? [],
    intervals,
    tradingDate,
    today: ctx.today,
  });
  if (base !== null) base /= factor;
  if (avgDailyVolume !== null) avgDailyVolume *= factor;

  return {
    ...result,
    base,
    avgDailyVolume,
    candles: tagged.map((x) => x.c),
    segments: segmentsOf(tagged.map((x) => ({ t: x.c.t, venue: x.venue })), MINUTE_MS),
  };
}

// ── 지수 시리즈 ────────────────────────────────────────────────

/** 공급자에 지수 봉이 없거나, 지난 거래일 지수 분봉을 받을 수 없으면 null. */
export async function loadIndexSeries(args: {
  provider: MarketDataProvider;
  cache: CandleCache;
  index: 'KOSPI' | 'KOSDAQ';
  period: Period;
  now: number;
}): Promise<LoadedSeries | null> {
  const { provider, cache, index, period, now } = args;
  const getIndex = provider.getIndexCandles?.bind(provider);
  if (!provider.capabilities.hasIndexCandles || !getIndex) return null;

  const ctx = await tradingContext(provider, now);
  const tradingDate = ctx.day.date;
  const isD1 = period.unit === 'D';
  if (isD1 && tradingDate !== ctx.today && !provider.capabilities.indexMinutePastDays) return null;

  const plan = fetchPlanFor(period, tradingDate);
  const symbol = `INDEX:${index}`;
  const [daily, minutes] = await Promise.all([
    cachedFetch(cache, `${provider.id}|${symbol}|1d|${plan.lookbackFrom}|${ctx.today}`, INDEX_DAILY_TTL_MS, () =>
      getIndex(index, '1d', plan.lookbackFrom, ctx.today),
    ),
    isD1
      ? cachedFetch(cache, `${provider.id}|${symbol}|1m|${tradingDate}`, tradingDate === ctx.today ? TODAY_MINUTE_TTL_MS : null, () =>
          getIndex(index, '1m', tradingDate, tradingDate),
        )
      : undefined,
  ]);

  const candles = minutes ?? inRange(daily, plan);
  return {
    symbol,
    tradingDate,
    base: closeBefore(daily, plan.from),
    avgDailyVolume: null,
    candles,
    daily,
    segments: segmentsOf(candles.map((c) => ({ t: c.t, venue: 'KRX' as const })), isD1 ? MINUTE_MS : DAY_MS),
    intervals: [],
    computedAt: now,
  };
}

/** 우선순위 none > no-past-minutes > failed > ok. metricAvailability의 index 값. */
export function indexAvailabilityFor(args: {
  caps: ProviderCapabilities;
  period: Period;
  tradingDate: string;
  today: string;
  indexLoad: 'ok' | 'failed' | 'null';
}): IndexAvailability {
  const { caps, period, tradingDate, today, indexLoad } = args;
  if (!caps.hasIndexCandles) return 'none';
  if (period.unit === 'D' && tradingDate !== today && !caps.indexMinutePastDays) return 'no-past-minutes';
  if (indexLoad === 'failed') return 'failed';
  if (indexLoad === 'null') return 'none';
  return 'ok';
}

// ── 마지막 성공 결과 ───────────────────────────────────────────

export interface SeriesSnapshots {
  /** stale이면 staleError에 이번에 받지 못한 이유(ApiError일 때만)를 담는다. */
  load(args: LoadSeriesArgs): Promise<LoadedSeries & { stale: boolean; staleError?: ApiError }>;
}

/**
 * 종목별 마지막 성공 결과(메모리). 조회가 실패하면 같은 공급자·같은 KST 날짜의 결과를 통째로 stale로 돌려주고,
 * 없으면 오류를 그대로 던진다. 이전 결과에 새 봉을 덧붙이지 않는다.
 */
export function createSeriesSnapshots(): SeriesSnapshots {
  const last = new Map<string, LoadedSeries>();
  return {
    async load(args) {
      const key = `${args.provider.id}|${args.meta.symbol}|${args.period.unit}${args.period.n}|${args.venueMode}`;
      try {
        const result = await loadSeries(args);
        last.set(key, result);
        return { ...result, stale: false };
      } catch (e) {
        const snap = last.get(key);
        if (snap && kstDate(snap.computedAt) === kstDate(args.now)) {
          return { ...snap, stale: true, ...(e instanceof ApiError ? { staleError: e } : {}) };
        }
        throw e;
      }
    },
  };
}
