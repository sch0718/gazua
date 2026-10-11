import type { Candle } from '../data/metrics';
import type { Priority, RequestQueue } from '../data/requestQueue';
import type { SecurityType, TradingDay } from '../market/sessions';
import type { Venue } from '../market/tradable';
import { addDays, kstDate, kstEpoch } from '../time/kst';
import { createTokenManager } from './auth';
import { ApiError } from './errors';
import type { ProxyClient } from './http';
import type { CandleQuery, MarketDataProvider, Quote, StockMeta, TokenInfo, TokenStore } from './types';

export interface TossDeps {
  client: ProxyClient;
  queue: RequestQueue;
  creds: { clientId: string; clientSecret: string };
  tokenStore: TokenStore;
  now: () => number;
}

/**
 * 토스 한도 그룹(초당 호출 수의 80%는 요청 큐 설정에서 정한다). 그룹 이름은 OpenAPI 문서의 Rate Limits Group과 같다.
 * AUTH 그룹(토큰 발급)은 큐를 거치지 않는다.
 */
export const TOSS_QUEUE_RATES = {
  MARKET_DATA: 12,
  MARKET_DATA_CHART: 16,
  STOCK: 4,
  MARKET_INFO: 2.4,
  MARKET_INDICATOR_CHART: 4,
} as const;

type Group = keyof typeof TOSS_QUEUE_RATES;

const BATCH_SIZE = 200;
const CANDLE_PAGE_SIZE = '200';
const CANDLE_MAX_PAGES = 60;
const CALENDAR_MAX_HOPS = 500;
const MINUTE_MS = 60_000;
const END_OF_DAY = 'T23:59:59+09:00';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Row = Record<string, unknown>;

function isRecord(v: unknown): v is Row {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const text = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

/** 문자열(또는 숫자)을 유한한 숫자로. 비었거나 숫자가 아니면 undefined. */
function toNumber(v: unknown): number | undefined {
  const s = text(v).trim();
  if (s === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function upstream(message: string): ApiError {
  // HTTP는 성공이었으므로 status를 달아 큐의 재시도 대상(5xx·무상태)에서 뺀다.
  return new ApiError('upstream', message, { status: 200 });
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function requireUnified(venue: Venue): void {
  // 호출부 버그를 드러내려고 ApiError가 아닌 일반 Error를 던진다.
  if (venue !== 'UNIFIED') throw new Error('toss supports UNIFIED only');
}

function securityTypeOf(type: string): SecurityType {
  return type === 'STOCK' || type === 'ETF' || type === 'ETN' || type === 'REIT' ? type : 'OTHER';
}

function marketOf(market: string): StockMeta['market'] {
  return market === 'KOSPI' || market === 'KOSDAQ' ? market : 'KR_ETC';
}

/** 같은 시각의 봉이 페이지마다 다르다 — 조회 도중 데이터가 바뀐 것. */
class PageInconsistency extends Error {}

interface Call {
  group: Group;
  path: string;
  query: Record<string, string>;
  priority: Priority;
}

interface CandlePlan {
  group: Group;
  path: string;
  /** symbol·interval 등 페이지마다 같은 쿼리(count·before는 여기서 붙인다). */
  query: Record<string, string> & { interval: '1m' | '1d' };
}

/**
 * 봉 한 개를 Candle로. 1분봉의 timestamp는 봉 종료 시각이라 한 칸 앞으로 당기고,
 * 일봉은 종목은 KST 자정, 지수는 09:00으로 오므로 둘 다 그날 KST 자정으로 맞춘다.
 */
function mapBar(row: unknown, interval: '1m' | '1d'): Candle | null {
  if (!isRecord(row)) return null;
  const ts = Date.parse(text(row.timestamp));
  const o = toNumber(row.openPrice);
  const h = toNumber(row.highPrice);
  const l = toNumber(row.lowPrice);
  const c = toNumber(row.closePrice);
  if (Number.isNaN(ts) || o === undefined || h === undefined || l === undefined || c === undefined) return null;
  const t = interval === '1m' ? ts - MINUTE_MS : kstEpoch(kstDate(ts), '00:00:00');
  return { t, o, h, l, c, v: toNumber(row.volume) ?? 0 };
}

/** 캘린더의 한 구간(`regularMarket` 등)에서 시각 필드를 epoch ms로. 없거나 null이면 undefined. */
function edge(integrated: Row, session: string, field: 'startTime' | 'endTime'): number | undefined {
  const s = integrated[session];
  if (!isRecord(s)) return undefined;
  const ms = Date.parse(text(s[field]));
  return Number.isNaN(ms) ? undefined : ms;
}

function mapCalendarDay(date: string, day: Row): TradingDay {
  const integrated = day.integrated;
  if (!isRecord(integrated)) return { date, isOpen: false };
  const times: NonNullable<TradingDay['integrated']> = {};
  const preStart = edge(integrated, 'preMarket', 'startTime');
  const regularStart = edge(integrated, 'regularMarket', 'startTime');
  const afterEnd = edge(integrated, 'afterMarket', 'endTime');
  if (preStart !== undefined) times.preStart = preStart;
  if (regularStart !== undefined) times.regularStart = regularStart;
  if (afterEnd !== undefined) times.afterEnd = afterEnd;
  return { date, isOpen: true, integrated: times };
}

/** `/oauth2/token` 응답 → 토큰(만료 = 받은 시각 + expires_in초). 모양이 틀리면 null. */
export function parseTossToken(json: unknown, receivedAt: number): TokenInfo | null {
  const accessToken = isRecord(json) ? text(json.access_token) : '';
  const expiresIn = isRecord(json) ? toNumber(json.expires_in) : undefined;
  if (!accessToken || expiresIn === undefined || expiresIn <= 0) return null;
  return { accessToken, expiresAt: receivedAt + expiresIn * 1000 };
}

export function createTossProvider(deps: TossDeps): MarketDataProvider {
  const { client, queue, creds, now } = deps;

  async function issueToken(): Promise<TokenInfo> {
    const res = await client.request('toss', 'POST', '/oauth2/token', {
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
      }),
    });
    const token = parseTossToken(res.json, now());
    if (!token) throw upstream('Toss token response is malformed');
    return token;
  }

  const tokens = createTokenManager(issueToken, deps.tokenStore, now);
  let lastInvalidated: string | undefined;

  /** 큐를 거치는 데이터 호출. `{ result }`를 벗겨 돌려준다. token-expired면 토큰을 버리고 한 번만 다시 시도한다. */
  async function api(call: Call): Promise<unknown> {
    const key = `${call.path}|${JSON.stringify(call.query)}`;
    let usedToken: string | undefined;
    const attempt = (suffix: string): Promise<unknown> =>
      queue.run(call.group, key + suffix, call.priority, async () => {
        const accessToken = await tokens.get();
        usedToken = accessToken;
        const res = await client.request('toss', 'GET', call.path, {
          query: call.query,
          headers: { authorization: `Bearer ${accessToken}` },
        });
        if (!isRecord(res.json) || !('result' in res.json)) throw upstream('Toss response has no result');
        return res.json.result;
      });
    try {
      return await attempt('');
    } catch (e) {
      if (!(e instanceof ApiError) || e.code !== 'token-expired') throw e;
      // 같은 토큰으로 동시에 실패한 호출들이 서로의 재발급을 지우지 않게, 토큰당 한 번만 무효화한다.
      if (usedToken === undefined || usedToken !== lastInvalidated) {
        lastInvalidated = usedToken;
        tokens.invalidate();
      }
      return attempt('|retry');
    }
  }

  function resultRows(result: unknown, what: string): Row[] {
    if (!Array.isArray(result)) throw upstream(`Toss ${what} result is not a list`);
    return result.filter(isRecord);
  }

  /** 최신순 페이지를 nextBefore로 이어 받는다. 경계 봉이 한 번 겹치므로 종가가 같은지 확인한다. */
  async function pagesOnce(plan: CandlePlan, from: string, to: string): Promise<Map<number, Candle>> {
    const { interval } = plan.query;
    const byT = new Map<number, Candle>();
    // 지난 날짜를 요청할 때는 그날 끝에서부터 받아 최신 구간을 건너뛴다.
    let before: string | undefined = to < kstDate(now()) ? `${to}${END_OF_DAY}` : undefined;
    for (let page = 0; page < CANDLE_MAX_PAGES; page++) {
      const query: Record<string, string> = { ...plan.query, count: CANDLE_PAGE_SIZE };
      if (before !== undefined) query.before = before;
      const result = await api({ group: plan.group, path: plan.path, query, priority: 1 });
      const body = isRecord(result) ? result : {};
      if (!Array.isArray(body.candles)) throw upstream('Toss candle result has no candles');

      let added = 0;
      let oldest = '';
      for (const raw of body.candles) {
        const c = mapBar(raw, interval);
        if (!c) continue;
        const prev = byT.get(c.t);
        if (prev) {
          if (prev.c !== c.c) throw new PageInconsistency();
        } else {
          byT.set(c.t, c);
          added++;
        }
        const date = kstDate(c.t);
        if (oldest === '' || date < oldest) oldest = date;
      }
      const next = typeof body.nextBefore === 'string' && body.nextBefore !== '' ? body.nextBefore : null;
      // 일봉은 하루에 한 봉뿐이라 `from` 날짜를 받으면 끝, 분봉은 `from` 이전 날짜가 나와야 끝이다.
      const reachedFrom = oldest !== '' && (interval === '1d' ? oldest <= from : oldest < from);
      if (next === null || added === 0 || reachedFrom) break;
      before = next;
    }
    return byT;
  }

  async function candles(plan: CandlePlan, from: string, to: string): Promise<Candle[]> {
    let byT: Map<number, Candle>;
    try {
      byT = await pagesOnce(plan, from, to);
    } catch (e) {
      if (!(e instanceof PageInconsistency)) throw e;
      try {
        byT = await pagesOnce(plan, from, to);
      } catch (e2) {
        if (e2 instanceof PageInconsistency) throw upstream('Toss candle pages are inconsistent');
        throw e2;
      }
    }
    return [...byT.values()]
      .filter((c) => {
        const d = kstDate(c.t);
        return d >= from && d <= to;
      })
      .sort((a, b) => a.t - b.t);
  }

  async function stockRows(symbols: string[], path: string, group: Group, priority: Priority, what: string) {
    const unique = [...new Set(symbols)];
    const pages = await Promise.all(
      chunk(unique, BATCH_SIZE).map((batch) =>
        api({ group, path, query: { symbols: batch.join(',') }, priority }).then((r) => resultRows(r, what)),
      ),
    );
    const bySymbol = new Map<string, Row>();
    for (const row of pages.flat()) bySymbol.set(text(row.symbol), row);
    return symbols.map((s) => {
      const row = bySymbol.get(s);
      if (!row) throw upstream(`Toss ${what} response is missing a requested symbol`);
      return row;
    });
  }

  const calendarCache = new Map<string, TradingDay>();
  let calendarCacheDay = '';

  async function hopCalendar(from: string, to: string): Promise<void> {
    let x = from;
    for (let hops = 0; x <= to; ) {
      if (calendarCache.has(x)) {
        x = addDays(x, 1);
        continue;
      }
      if (++hops > CALENDAR_MAX_HOPS) throw upstream('Toss calendar needed too many requests');
      const result = await api({
        group: 'MARKET_INFO',
        path: '/api/v1/market-calendar/KR',
        query: { date: x },
        priority: 1,
      });
      const body = isRecord(result) ? result : {};
      const today = isRecord(body.today) ? body.today : {};
      const next = isRecord(body.nextBusinessDay) ? text(body.nextBusinessDay.date) : '';
      const todayDate = text(today.date);
      if (!DATE_RE.test(next) || next <= x) throw upstream('Toss calendar has no later business day');
      if (todayDate === x) {
        calendarCache.set(x, mapCalendarDay(x, today));
      } else {
        // 서버가 휴장일 조회를 영업일로 당겨 답하면 x는 휴장으로 보고, 응답의 today가 범위 안이면 그날의 실제 값을 쓴다.
        if (!DATE_RE.test(todayDate) || next <= todayDate) throw upstream('Toss calendar returned an inconsistent day');
        calendarCache.set(x, { date: x, isOpen: false });
        if (todayDate > x && todayDate <= to && !calendarCache.has(todayDate)) {
          calendarCache.set(todayDate, mapCalendarDay(todayDate, today));
        }
      }
      // 다음 영업일 전까지의 날짜는 전부 휴장이다(위에서 실제 값을 기록한 날은 건드리지 않는다).
      for (let d = addDays(x, 1); d < next; d = addDays(d, 1)) {
        if (!calendarCache.has(d)) calendarCache.set(d, { date: d, isOpen: false });
      }
      x = next;
    }
  }

  const provider: MarketDataProvider = {
    id: 'toss',
    capabilities: {
      venues: ['UNIFIED'],
      quoteBatchSize: BATCH_SIZE,
      hasIndexCandles: true,
      indexMinutePastDays: true,
    },

    async getStockMeta(symbols) {
      const rows = await stockRows(symbols, '/api/v1/stocks', 'STOCK', 1, 'stock');
      return rows.map((row, i): StockMeta => {
        const detail = isRecord(row.koreanMarketDetail) ? row.koreanMarketDetail : {};
        const meta: StockMeta = {
          symbol: symbols[i],
          name: text(row.name) || symbols[i],
          market: marketOf(text(row.market)),
          securityType: securityTypeOf(text(row.securityType)),
          nxtSupported: detail.nxtSupported === true,
          krxSuspended: detail.krxTradingSuspended === true,
          nxtSuspended: typeof detail.nxtTradingSuspended === 'boolean' ? detail.nxtTradingSuspended : null,
          liquidationTrading: detail.liquidationTrading === true,
        };
        const shares = toNumber(row.sharesOutstanding);
        if (shares !== undefined && shares > 0) meta.sharesOutstanding = shares;
        return meta;
      });
    },

    async getQuotes(symbols, venue) {
      requireUnified(venue);
      const rows = await stockRows(symbols, '/api/v1/prices', 'MARKET_DATA', 0, 'price');
      return rows.map((row, i): Quote => {
        const price = toNumber(row.lastPrice);
        if (price === undefined) throw upstream('Toss quote has no price');
        const ts = Date.parse(text(row.timestamp));
        return { symbol: symbols[i], venue: 'UNIFIED', price, ts: Number.isNaN(ts) ? null : ts };
      });
    },

    async getCandles(q: CandleQuery) {
      requireUnified(q.venue);
      const query: CandlePlan['query'] = { symbol: q.symbol, interval: q.interval };
      // 기본값도 true지만 수정주가 적용을 계약으로 고정한다.
      if (q.interval === '1d') query.adjusted = 'true';
      return candles({ group: 'MARKET_DATA_CHART', path: '/api/v1/candles', query }, q.from, q.to);
    },

    async getTradingDays(from, to) {
      const today = kstDate(now());
      if (today !== calendarCacheDay) {
        calendarCache.clear();
        calendarCacheDay = today;
      }
      await hopCalendar(from, to);
      const out: TradingDay[] = [];
      for (let d = from; d <= to; d = addDays(d, 1)) {
        const day = calendarCache.get(d);
        if (day) out.push({ ...day, ...(day.integrated ? { integrated: { ...day.integrated } } : {}) });
      }
      return out;
    },

    getIndexCandles(index, interval, from, to) {
      return candles(
        {
          group: 'MARKET_INDICATOR_CHART',
          path: `/api/v1/market-indicators/${index}/candles`,
          query: { interval },
        },
        from,
        to,
      );
    },
  };
  return provider;
}
