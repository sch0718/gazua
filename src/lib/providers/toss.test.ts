import { describe, expect, it } from 'vitest';
import { createRequestQueue, type Priority, type RequestQueue } from '../data/requestQueue';
import { addDays, kstEpoch } from '../time/kst';
import { runProviderContract } from './contract';
import { ApiError } from './errors';
import { createProxyClient, type ProxyClient, type ProxyResponse } from './http';
import { createTossProvider } from './toss';
import type { MarketDataProvider, TokenInfo, TokenStore } from './types';
import calendarBusinessDay from './fixtures/toss/calendar-business-day.json';
import calendarHoliday from './fixtures/toss/calendar-holiday.json';
import calendarNxtPreHoliday from './fixtures/toss/calendar-nxt-premarket-holiday.json';
import calendarOctober from './fixtures/toss/calendar-2026-10.json';
import candles1d from './fixtures/toss/candles-005930-1d.json';
import minPage1 from './fixtures/toss/candles-005930-1m-p1.json';
import minPage2 from './fixtures/toss/candles-005930-1m-p2.json';
import minPage3 from './fixtures/toss/candles-005930-1m-p3.json';
import indexKosdaq1d from './fixtures/toss/index-kosdaq-1d.json';
import indexKospi1d from './fixtures/toss/index-kospi-1d.json';
import indexKospi1m from './fixtures/toss/index-kospi-1m.json';
import prices from './fixtures/toss/prices.json';
import stocks005930 from './fixtures/toss/stocks-005930.json';
import stocks069500 from './fixtures/toss/stocks-069500.json';
import tokenFixture from './fixtures/toss/token.json';

const CLIENT_ID = 'test-client-id-AAAA';
const CLIENT_SECRET = 'test-client-secret-BBBB';
const SUN = kstEpoch('2026-10-11', '12:00:00');
const DAY_MS = 86_400_000;

interface Call {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body?: unknown;
}
type Json = Record<string, unknown>;
type Handler = (call: Call) => unknown | Promise<unknown>;
interface Bar {
  timestamp: string;
  closePrice: string;
  [k: string]: unknown;
}

function isProxyResponse(v: unknown): v is ProxyResponse {
  return typeof v === 'object' && v !== null && 'status' in v && 'json' in v && 'headers' in v;
}

const ok = (result: unknown) => ({ result });
const stockRows = [...stocks005930.result, ...stocks069500.result];
const minutePages = [minPage1, minPage2, minPage3];
const CALENDARS: Record<string, unknown> = {
  ...calendarOctober,
  '2026-03-25': calendarBusinessDay,
  '2026-05-05': calendarHoliday,
};

/** 실제 API처럼: `before` 이하(inclusive)의 봉을 최신순으로 count개, 더 있으면 nextBefore = 마지막 봉 시각. */
function servePage(series: Bar[], q: Record<string, string>): Json {
  const limit = q.before === undefined ? Infinity : Date.parse(q.before);
  const eligible = series.filter((b) => Date.parse(b.timestamp) <= limit);
  const count = Number(q.count ?? '100');
  const page = eligible.slice(0, count);
  return ok({ candles: page, nextBefore: eligible.length > count ? page[page.length - 1].timestamp : null });
}

/** 연속한 달력일의 일봉 n개(최신순). 종가는 날짜에서 결정된다. */
function dailySeries(n: number, newest = '2026-10-08'): Bar[] {
  return Array.from({ length: n }, (_, i) => {
    const date = addDays(newest, -i);
    const c = 50_000 + (kstEpoch(date, '00:00:00') / DAY_MS) % 1000;
    return {
      timestamp: `${date}T00:00:00+09:00`,
      openPrice: String(c),
      highPrice: String(c + 10),
      lowPrice: String(c - 10),
      closePrice: String(c),
      volume: '1000',
      currency: 'KRW',
    };
  });
}

/** 한 번에 모든 분봉 페이지에서 `before`에 맞는 것을 고른다(각 페이지의 첫 봉이 before 이하인 첫 페이지). */
function serveMinutes(q: Record<string, string>): Json {
  const limit = q.before === undefined ? Infinity : Date.parse(q.before);
  const page = minutePages.find((p) => Date.parse(p.result.candles[0].timestamp) <= limit);
  return page ?? ok({ candles: [], nextBefore: null });
}

function fakeClient(handler?: Handler): ProxyClient & { calls: Call[]; dataCalls: Call[] } {
  const calls: Call[] = [];
  const respond = (json: unknown): ProxyResponse => ({ status: 200, headers: new Headers(), json });
  return {
    calls,
    get dataCalls() {
      return calls.filter((c) => c.method === 'GET');
    },
    async request(_provider, method, path, opts = {}) {
      const call: Call = { method, path, query: opts.query ?? {}, headers: opts.headers ?? {}, body: opts.body };
      calls.push(call);
      const over = await handler?.(call);
      if (over !== undefined) return isProxyResponse(over) ? over : respond(over);

      const q = call.query;
      if (method === 'POST' && path === '/oauth2/token') return respond(tokenFixture);
      const indicator = /^\/api\/v1\/market-indicators\/(KOSPI|KOSDAQ)\/candles$/.exec(path);
      if (indicator) {
        const src = q.interval === '1m' ? indexKospi1m : indicator[1] === 'KOSPI' ? indexKospi1d : indexKosdaq1d;
        return respond(servePage(src.result.candles, q));
      }
      switch (path) {
        case '/api/v1/prices':
          return respond(ok(prices.result.filter((p) => q.symbols.split(',').includes(p.symbol))));
        case '/api/v1/stocks':
          return respond(ok(stockRows.filter((s) => q.symbols.split(',').includes(s.symbol))));
        case '/api/v1/candles':
          return respond(q.interval === '1m' ? serveMinutes(q) : servePage(candles1d.result.candles, q));
        case '/api/v1/market-calendar/KR':
          if (q.date in CALENDARS) return respond(CALENDARS[q.date]);
      }
      throw new Error(`fake Toss: unrouted ${method} ${path} ${JSON.stringify(q)}`);
    },
  };
}

function memoryStore(): TokenStore {
  let v: TokenInfo | null = null;
  return { load: () => v, save: (t) => (v = t) };
}

const RATES = { MARKET_DATA: 12, MARKET_DATA_CHART: 16, STOCK: 4, MARKET_INFO: 2.4, MARKET_INDICATOR_CHART: 4 };
function fastQueue(): RequestQueue {
  return createRequestQueue({ ratesPerSec: RATES, now: () => 0, sleep: async () => {} });
}

interface Setup {
  provider: MarketDataProvider;
  client: ReturnType<typeof fakeClient>;
  runs: { group: string; priority: Priority }[];
  clock: { now: number };
  store: TokenStore;
}

describe('toss provider: shared access token', () => {
  it('getAccessToken shares the token with data calls (one issue)', async () => {
    const { provider, client } = setup();
    const [t] = await Promise.all([provider.getAccessToken!(), provider.getQuotes(['005930'], 'UNIFIED')]);
    expect(t.accessToken).toBe('test-access-token');
    expect(client.calls.filter((c) => c.path === '/oauth2/token')).toHaveLength(1);
  });
});

function setup(handler?: Handler, now = SUN, clientOverride?: ProxyClient): Setup {
  const client = clientOverride ?? fakeClient(handler);
  const inner = fastQueue();
  const runs: Setup['runs'] = [];
  const queue: RequestQueue = {
    run: (group, key, priority, task) => {
      runs.push({ group, priority });
      return inner.run(group, key, priority, task);
    },
  };
  const clock = { now };
  const store = memoryStore();
  const provider = createTossProvider({
    client,
    queue,
    creds: { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET },
    tokenStore: store,
    now: () => clock.now,
  });
  return { provider, client: client as Setup['client'], runs, clock, store };
}

const minuteQuery = (date: string, symbol = '005930') =>
  ({ symbol, venue: 'UNIFIED' as const, interval: '1m' as const, from: date, to: date });
const dailyQuery = (from: string, to: string, symbol = '005930') =>
  ({ symbol, venue: 'UNIFIED' as const, interval: '1d' as const, from, to });
const dayT = (d: string) => kstEpoch(d, '00:00:00');
const candleCalls = (client: { dataCalls: Call[] }) => client.dataCalls.filter((c) => c.path === '/api/v1/candles');

runProviderContract('toss', () => setup().provider, '2026-10-08');

describe('toss provider: basics', () => {
  it('has the expected id and capabilities', () => {
    const { provider } = setup();
    expect(provider.id).toBe('toss');
    expect(provider.capabilities).toEqual({
      venues: ['UNIFIED'],
      quoteBatchSize: 200,
      hasIndexCandles: true,
      indexMinutePastDays: true,
    });
  });
});

describe('toss provider: auth and errors', () => {
  it('issues a token via POST /oauth2/token with a form body and stores now + expires_in', async () => {
    const { provider, client, store } = setup();
    await provider.getQuotes(['005930'], 'UNIFIED');
    const [tokenCall] = client.calls;
    expect(tokenCall.method).toBe('POST');
    expect(tokenCall.path).toBe('/oauth2/token');
    expect(tokenCall.body).toBeInstanceOf(URLSearchParams);
    expect((tokenCall.body as URLSearchParams).toString()).toBe(
      `grant_type=client_credentials&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}`,
    );
    expect(store.load()).toEqual({ accessToken: 'test-access-token', expiresAt: SUN + 86_400_000 });
  });

  it('sends a Bearer token on data calls and reuses it', async () => {
    const { provider, client } = setup();
    await provider.getQuotes(['005930'], 'UNIFIED');
    await provider.getStockMeta(['005930']);
    expect(client.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    for (const c of client.dataCalls) expect(c.headers.authorization).toBe('Bearer test-access-token');
  });

  it('does not queue the token request', async () => {
    const { provider, runs } = setup();
    await provider.getQuotes(['005930'], 'UNIFIED');
    expect(runs).toHaveLength(1);
  });

  it('wraps a malformed token response as upstream without leaking secrets', async () => {
    const { provider } = setup((c) => (c.method === 'POST' ? { error: 'x' } : undefined));
    const err = await provider.getQuotes(['005930'], 'UNIFIED').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('upstream');
    expect(err.message).not.toContain(CLIENT_ID);
    expect(err.message).not.toContain(CLIENT_SECRET);
  });

  it('on token-expired invalidates the token and retries the call once', async () => {
    let failed = false;
    const { provider, client } = setup((c) => {
      if (c.method === 'GET' && !failed) {
        failed = true;
        throw new ApiError('token-expired');
      }
    });
    const [q] = await provider.getQuotes(['005930'], 'UNIFIED');
    expect(q.price).toBe(72000);
    expect(client.calls.filter((c) => c.method === 'POST')).toHaveLength(2);
    expect(client.dataCalls).toHaveLength(2);
  });

  it('gives up after a second token-expired', async () => {
    const { provider, client } = setup((c) => {
      if (c.method === 'GET') throw new ApiError('token-expired');
    });
    await expect(provider.getQuotes(['005930'], 'UNIFIED')).rejects.toMatchObject({ code: 'token-expired' });
    expect(client.dataCalls).toHaveLength(2);
  });

  describe('token revoked by a newer token', () => {
    const rotating = () => {
      let n = 0;
      return (c: Call): unknown => {
        if (c.method === 'POST') return { ...tokenFixture, access_token: `tok${++n}` };
        if (c.headers.authorization === 'Bearer tok1') throw new ApiError('token-expired');
      };
    };
    const posts = (client: { calls: Call[] }) => client.calls.filter((c) => c.method === 'POST').length;

    it('HTTP 401 token-revoked via the real proxy client: invalidates and retries once', async () => {
      let n = 0;
      const sent: { method: string; auth: string | null }[] = [];
      const fetchImpl = (async (_url: string, init: RequestInit) => {
        const headers = new Headers(init.headers);
        const method = init.method ?? 'GET';
        sent.push({ method, auth: headers.get('authorization') });
        const json = (body: unknown, status = 200) =>
          new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
        if (method === 'POST') return json({ ...tokenFixture, access_token: `tok${++n}` });
        if (headers.get('authorization') === 'Bearer tok1') {
          return json({ error: { code: 'token-revoked', message: 'revoked' } }, 401);
        }
        return json(ok(prices.result.slice(0, 1)));
      }) as unknown as typeof fetch;
      const client = createProxyClient({ baseUrl: 'https://proxy.test', fetchImpl });
      const { provider } = setup(undefined, SUN, client);
      const [q] = await provider.getQuotes(['005930'], 'UNIFIED');
      expect(q.price).toBe(72000);
      expect(sent.filter((s) => s.method === 'POST')).toHaveLength(2);
      expect(sent.filter((s) => s.method === 'GET')).toHaveLength(2);
    });

    it('parallel callers that all hit token-expired trigger one re-issue, not one each', async () => {
      const { provider, client } = setup(rotating());
      const batches = await Promise.all([
        provider.getQuotes(['005930'], 'UNIFIED'),
        provider.getQuotes(['000660'], 'UNIFIED'),
        provider.getQuotes(['069500'], 'UNIFIED'),
      ]);
      expect(batches.map((b) => b[0].price)).toEqual([72000, 198500, 36450]);
      expect(posts(client)).toBe(2);
    });
  });

  it('rejects a 200 response without a result envelope as upstream', async () => {
    const { provider, client } = setup((c) => (c.method === 'GET' ? { unexpected: true } : undefined));
    const err = await provider.getQuotes(['005930'], 'UNIFIED').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('upstream');
    expect(client.dataCalls).toHaveLength(1);
  });

  it('uses the documented queue groups; priority 0 for quotes, 1 for everything else', async () => {
    const { provider, runs } = setup();
    await provider.getQuotes(['005930'], 'UNIFIED');
    await provider.getStockMeta(['005930']);
    await provider.getCandles(dailyQuery('2026-10-06', '2026-10-08'));
    await provider.getTradingDays('2026-10-08', '2026-10-08');
    await provider.getIndexCandles!('KOSPI', '1d', '2026-10-06', '2026-10-08');
    expect(runs).toEqual([
      { group: 'MARKET_DATA', priority: 0 },
      { group: 'STOCK', priority: 1 },
      { group: 'MARKET_DATA_CHART', priority: 1 },
      { group: 'MARKET_INFO', priority: 1 },
      { group: 'MARKET_INDICATOR_CHART', priority: 1 },
    ]);
  });
});

describe('toss provider: request priority', () => {
  it('passes priority to every daily, minute and index request; defaults to 1', async () => {
    const { provider, runs } = setup();
    await provider.getCandles({ ...dailyQuery('2026-10-06', '2026-10-08'), priority: 2 });
    await provider.getCandles({ ...minuteQuery('2026-10-08'), priority: 2 });
    await provider.getIndexCandles!('KOSPI', '1d', '2026-10-06', '2026-10-08', 2);
    expect(runs.length).toBeGreaterThanOrEqual(3);
    expect(runs.every((r) => r.priority === 2)).toBe(true);

    runs.length = 0;
    await provider.getCandles(dailyQuery('2026-10-06', '2026-10-08'));
    await provider.getIndexCandles!('KOSPI', '1d', '2026-10-06', '2026-10-08');
    expect(runs.length).toBeGreaterThanOrEqual(2);
    expect(runs.every((r) => r.priority === 1)).toBe(true);
  });

  it('does not key dedupe on priority: identical in-flight requests share the first caller priority', async () => {
    const client = fakeClient();
    const inner = fastQueue();
    const executed: Priority[] = [];
    const queue: RequestQueue = {
      run: (group, key, priority, task) =>
        inner.run(group, key, priority, () => {
          executed.push(priority);
          return task();
        }),
    };
    const provider = createTossProvider({
      client,
      queue,
      creds: { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET },
      tokenStore: memoryStore(),
      now: () => SUN,
    });
    const q = dailyQuery('2026-10-06', '2026-10-08');
    await Promise.all([provider.getCandles({ ...q, priority: 2 }), provider.getCandles({ ...q, priority: 1 })]);
    expect(candleCalls(client)).toHaveLength(1);
    expect(executed).toEqual([2]);
  });
});

describe('toss provider: quotes', () => {
  it('requires UNIFIED with a plain Error and makes no request', async () => {
    const { provider, client } = setup();
    const err = await provider.getQuotes(['005930'], 'KRX').catch((e) => e);
    expect(err).not.toBeInstanceOf(ApiError);
    expect(err).toEqual(new Error('toss supports UNIFIED only'));
    expect(client.calls).toHaveLength(0);
  });

  it('maps lastPrice to a number and the timestamp to epoch ms', async () => {
    const { provider, client } = setup();
    const quotes = await provider.getQuotes(['005930'], 'UNIFIED');
    expect(quotes).toEqual([
      { symbol: '005930', venue: 'UNIFIED', price: 72000, ts: Date.parse('2026-03-25T09:30:00.123+09:00') },
    ]);
    expect(client.dataCalls[0]).toMatchObject({ path: '/api/v1/prices', query: { symbols: '005930' } });
  });

  it('uses ts null when the timestamp is null', async () => {
    const { provider } = setup((c) =>
      c.path === '/api/v1/prices'
        ? ok([{ symbol: '005930', timestamp: null, lastPrice: '72000', currency: 'KRW' }])
        : undefined,
    );
    expect((await provider.getQuotes(['005930'], 'UNIFIED'))[0].ts).toBeNull();
  });

  it('keeps input order even when the response is ordered differently', async () => {
    const { provider } = setup();
    const quotes = await provider.getQuotes(['069500', '005930', '000660'], 'UNIFIED');
    expect(quotes.map((q) => [q.symbol, q.price])).toEqual([
      ['069500', 36450],
      ['005930', 72000],
      ['000660', 198500],
    ]);
  });

  it('batches at 200 symbols per request', async () => {
    const symbols = Array.from({ length: 450 }, (_, i) => String(100000 + i));
    const { provider, client } = setup((c) =>
      c.path === '/api/v1/prices'
        ? ok(c.query.symbols.split(',').map((s) => ({ symbol: s, timestamp: null, lastPrice: '1', currency: 'KRW' })))
        : undefined,
    );
    const quotes = await provider.getQuotes(symbols, 'UNIFIED');
    expect(quotes.map((q) => q.symbol)).toEqual(symbols);
    expect(client.dataCalls.map((c) => c.query.symbols.split(',').length)).toEqual([200, 200, 50]);
    expect(client.dataCalls[0].query.symbols).toBe(symbols.slice(0, 200).join(','));
  });

  it('returns [] without a request for no symbols', async () => {
    const { provider, client } = setup();
    expect(await provider.getQuotes([], 'UNIFIED')).toEqual([]);
    expect(client.calls).toHaveLength(0);
  });

  it('fails as upstream when a requested symbol is missing from the response', async () => {
    const { provider } = setup((c) => (c.path === '/api/v1/prices' ? ok([]) : undefined));
    await expect(provider.getQuotes(['005930'], 'UNIFIED')).rejects.toMatchObject({ code: 'upstream' });
  });

  it('fails as upstream when lastPrice is not a number', async () => {
    const { provider } = setup((c) =>
      c.path === '/api/v1/prices' ? ok([{ symbol: '005930', timestamp: null, lastPrice: 'abc' }]) : undefined,
    );
    await expect(provider.getQuotes(['005930'], 'UNIFIED')).rejects.toMatchObject({ code: 'upstream' });
  });
});

describe('toss provider: stock meta', () => {
  const stockWith = (over: Json, detail: Json | null = {}) =>
    (c: Call): unknown =>
      c.path === '/api/v1/stocks'
        ? ok([
            {
              symbol: '005930',
              name: 'X',
              market: 'KOSPI',
              securityType: 'STOCK',
              sharesOutstanding: '100',
              koreanMarketDetail:
                detail === null
                  ? null
                  : { liquidationTrading: false, nxtSupported: false, krxTradingSuspended: false, nxtTradingSuspended: null, ...detail },
              ...over,
            },
          ])
        : undefined;

  it('maps the spec examples and keeps request order', async () => {
    const { provider, client } = setup();
    const metas = await provider.getStockMeta(['069500', '005930']);
    expect(metas).toEqual([
      {
        symbol: '069500',
        name: 'KODEX 200',
        market: 'KOSPI',
        securityType: 'ETF',
        nxtSupported: false,
        krxSuspended: false,
        nxtSuspended: null,
        liquidationTrading: false,
        sharesOutstanding: 208050000,
      },
      {
        symbol: '005930',
        name: '삼성전자',
        market: 'KOSPI',
        securityType: 'STOCK',
        nxtSupported: true,
        krxSuspended: false,
        nxtSuspended: false,
        liquidationTrading: false,
        sharesOutstanding: 5919637922,
      },
    ]);
    expect(client.dataCalls).toHaveLength(1);
    expect(client.dataCalls[0]).toMatchObject({ path: '/api/v1/stocks', query: { symbols: '069500,005930' } });
  });

  it('maps market: KOSPI/KOSDAQ pass through, everything else is KR_ETC', async () => {
    const out: string[] = [];
    for (const market of ['KOSPI', 'KOSDAQ', 'KR_ETC', 'NASDAQ']) {
      out.push((await setup(stockWith({ market })).provider.getStockMeta(['005930']))[0].market);
    }
    expect(out).toEqual(['KOSPI', 'KOSDAQ', 'KR_ETC', 'KR_ETC']);
  });

  it('maps securityType: STOCK/ETF/ETN/REIT pass through, the rest is OTHER', async () => {
    const out: string[] = [];
    for (const securityType of ['STOCK', 'ETF', 'ETN', 'REIT', 'STOCK_WARRANTS', 'DEPOSITARY_RECEIPT']) {
      out.push((await setup(stockWith({ securityType })).provider.getStockMeta(['005930']))[0].securityType);
    }
    expect(out).toEqual(['STOCK', 'ETF', 'ETN', 'REIT', 'OTHER', 'OTHER']);
  });

  it('maps the koreanMarketDetail flags', async () => {
    const meta = (
      await setup(
        stockWith({}, { liquidationTrading: true, nxtSupported: true, krxTradingSuspended: true, nxtTradingSuspended: true }),
      ).provider.getStockMeta(['005930'])
    )[0];
    expect(meta).toMatchObject({ liquidationTrading: true, nxtSupported: true, krxSuspended: true, nxtSuspended: true });
  });

  it('treats a missing koreanMarketDetail as unsupported and not suspended', async () => {
    const meta = (await setup(stockWith({}, null)).provider.getStockMeta(['005930']))[0];
    expect(meta).toMatchObject({ nxtSupported: false, krxSuspended: false, nxtSuspended: null, liquidationTrading: false });
  });

  it('omits sharesOutstanding when it is not a positive number', async () => {
    const meta = (await setup(stockWith({ sharesOutstanding: '' })).provider.getStockMeta(['005930']))[0];
    expect('sharesOutstanding' in meta).toBe(false);
  });

  it('batches at 200 symbols per request', async () => {
    const symbols = Array.from({ length: 250 }, (_, i) => String(100000 + i));
    const { provider, client } = setup((c) =>
      c.path === '/api/v1/stocks'
        ? ok(c.query.symbols.split(',').map((s) => ({ symbol: s, name: s, market: 'KOSPI', securityType: 'STOCK', sharesOutstanding: '1' })))
        : undefined,
    );
    const metas = await provider.getStockMeta(symbols);
    expect(metas.map((m) => m.symbol)).toEqual(symbols);
    expect(client.dataCalls.map((c) => c.query.symbols.split(',').length)).toEqual([200, 50]);
  });

  it('omits a requested symbol missing from the response and keeps the rest', async () => {
    const { provider } = setup((c) => (c.path === '/api/v1/stocks' ? ok(stocks069500.result) : undefined));
    expect((await provider.getStockMeta(['005930', '069500'])).map((m) => m.symbol)).toEqual(['069500']);
    expect(await provider.getStockMeta(['005930'])).toEqual([]);
  });

  it('still fails a quote batch with a missing symbol as upstream', async () => {
    const { provider } = setup((c) => (c.path === '/api/v1/prices' ? ok([]) : undefined));
    await expect(provider.getQuotes(['005930'], 'UNIFIED')).rejects.toMatchObject({ code: 'upstream' });
  });
});

describe('toss provider: minute candles', () => {
  it('rejects venues other than UNIFIED with a plain Error and makes no request', async () => {
    const { provider, client } = setup();
    for (const venue of ['KRX', 'NXT'] as const) {
      const err = await provider.getCandles({ ...minuteQuery('2026-10-08'), venue }).catch((e) => e);
      expect(err).not.toBeInstanceOf(ApiError);
      expect(err).toEqual(new Error('toss supports UNIFIED only'));
    }
    expect(client.calls).toHaveLength(0);
  });

  it('stamps t at the bar start: timestamp 09:01 (bar end) becomes 09:00', async () => {
    const { provider } = setup();
    const candles = await provider.getCandles(minuteQuery('2026-10-08'));
    const first = candles[0];
    expect(candles.some((c) => c.t === kstEpoch('2026-10-08', '09:00:00'))).toBe(true);
    expect(first.t).toBe(kstEpoch('2026-10-08', '08:00:00')); // bar ending 08:01
    expect(candles.at(-1)!.t).toBe(kstEpoch('2026-10-08', '09:02:00')); // bar ending 09:03
  });

  it('converts string numbers to numbers', async () => {
    const { provider } = setup();
    const candles = await provider.getCandles(minuteQuery('2026-10-08'));
    expect(candles.at(-1)).toEqual({ t: kstEpoch('2026-10-08', '09:02:00'), o: 71300, h: 71400, l: 71250, c: 71350, v: 12000 });
  });

  it('requests symbol, interval and count=200 with no adjusted flag, anchoring before at the end of a past day', async () => {
    const { provider, client } = setup();
    await provider.getCandles(minuteQuery('2026-10-08'));
    const first = candleCalls(client)[0];
    expect(first.query).toEqual({
      symbol: '005930',
      interval: '1m',
      count: '200',
      before: '2026-10-08T23:59:59+09:00',
    });
  });

  it('does not send before on the first page when the range ends today', async () => {
    const { provider, client } = setup(undefined, kstEpoch('2026-10-08', '12:00:00'));
    await provider.getCandles(minuteQuery('2026-10-08'));
    expect(candleCalls(client)[0].query).toEqual({ symbol: '005930', interval: '1m', count: '200' });
  });

  it('follows nextBefore and stops once the oldest bar is before `from`', async () => {
    const { provider, client } = setup();
    const candles = await provider.getCandles(minuteQuery('2026-10-08'));
    expect(candleCalls(client).map((c) => c.query.before)).toEqual([
      '2026-10-08T23:59:59+09:00',
      '2026-10-08T09:01:00+09:00',
      '2026-10-08T08:01:00+09:00',
    ]);
    // 10-07 bars on the last page are outside the range
    expect(candles.every((c) => c.t >= dayT('2026-10-08'))).toBe(true);
  });

  it('keeps each boundary bar once and returns ascending bars', async () => {
    const { provider } = setup();
    const candles = await provider.getCandles(minuteQuery('2026-10-08'));
    expect(candles.map((c) => c.t)).toEqual(
      ['08:00', '08:29', '08:59', '09:00', '09:01', '09:02'].map((hm) => kstEpoch('2026-10-08', `${hm}:00`)),
    );
  });

  it('stops when nextBefore is null', async () => {
    const { provider, client } = setup((c) =>
      c.path === '/api/v1/candles' ? ok({ candles: minPage1.result.candles, nextBefore: null }) : undefined,
    );
    const candles = await provider.getCandles(minuteQuery('2026-10-08'));
    expect(candleCalls(client)).toHaveLength(1);
    expect(candles).toHaveLength(3);
  });

  it('stops on an empty page', async () => {
    const { provider, client } = setup((c) =>
      c.path === '/api/v1/candles' ? ok({ candles: [], nextBefore: '2026-10-08T09:00:00+09:00' }) : undefined,
    );
    expect(await provider.getCandles(minuteQuery('2026-10-08'))).toEqual([]);
    expect(candleCalls(client)).toHaveLength(1);
  });

  it('URL-encodes the + of the before offset as %2B through the real proxy client', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      urls.push(url);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      if (init.method === 'POST') return json(tokenFixture);
      return json(minPage1);
    }) as unknown as typeof fetch;
    const client = createProxyClient({ baseUrl: 'https://proxy.test', fetchImpl });
    await setup(undefined, SUN, client).provider.getCandles(minuteQuery('2026-10-08'));
    const candleUrl = urls.find((u) => u.includes('/toss/api/v1/candles'))!;
    expect(candleUrl).toContain('before=2026-10-08T23%3A59%3A59%2B09%3A00');
    expect(candleUrl).not.toMatch(/before=[^&]*\+09/);
  });

  it('restarts the whole fetch once when a boundary bar disagrees, then fails as upstream if it disagrees again', async () => {
    const changed = (page: typeof minPage2): unknown => ({
      result: {
        ...page.result,
        candles: page.result.candles.map((b, i) => (i === 0 ? { ...b, closePrice: '99999' } : b)),
      },
    });
    let pass = 0;
    const once = setup((c) => {
      if (c.path !== '/api/v1/candles') return undefined;
      if (c.query.before === '2026-10-08T09:01:00+09:00') return pass++ === 0 ? changed(minPage2) : undefined;
    });
    const candles = await once.provider.getCandles(minuteQuery('2026-10-08'));
    expect(candles).toHaveLength(6);
    expect(candleCalls(once.client)).toHaveLength(5); // 2 pages, mismatch on page 2, then 3 pages

    const always = setup((c) =>
      c.path === '/api/v1/candles' && c.query.before === '2026-10-08T09:01:00+09:00' ? changed(minPage2) : undefined,
    );
    const err = await always.provider.getCandles(minuteQuery('2026-10-08')).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('upstream');
    expect(candleCalls(always.client)).toHaveLength(4); // 2 pages, restart, 2 pages
  });

  it('stops after a bounded number of pages', async () => {
    let n = 0;
    const { provider, client } = setup((c) => {
      if (c.path !== '/api/v1/candles') return undefined;
      const ts = new Date(Date.parse('2026-10-08T12:00:00+09:00') - n++ * 60_000).toISOString();
      return ok({ candles: [{ timestamp: ts, openPrice: '1', highPrice: '1', lowPrice: '1', closePrice: '1', volume: '1' }], nextBefore: ts });
    });
    await provider.getCandles(minuteQuery('2026-10-08'));
    expect(candleCalls(client).length).toBeLessThanOrEqual(60);
    expect(candleCalls(client).length).toBeGreaterThan(5);
  });
});

describe('toss provider: daily candles', () => {
  it('always sends adjusted=true and count=200 for 1d', async () => {
    const { provider, client } = setup();
    await provider.getCandles(dailyQuery('2026-10-06', '2026-10-08'));
    expect(candleCalls(client)[0].query).toMatchObject({
      symbol: '005930',
      interval: '1d',
      count: '200',
      adjusted: 'true',
    });
  });

  it('stamps t at KST midnight and returns only [from, to], ascending', async () => {
    const { provider } = setup();
    const candles = await provider.getCandles(dailyQuery('2026-09-29', '2026-10-06'));
    expect(candles.map((c) => c.t)).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-06'].map(dayT));
    expect(candles[0]).toMatchObject({ o: expect.any(Number), h: expect.any(Number), l: expect.any(Number), c: expect.any(Number), v: expect.any(Number) });
    expect(typeof candles[0].c).toBe('number');
  });

  it('pages through nextBefore, repeating the boundary bar once, until `from`', async () => {
    const series = dailySeries(450);
    const { provider, client } = setup((c) =>
      c.path === '/api/v1/candles' ? servePage(series, c.query) : undefined,
    );
    const from = addDays('2026-10-08', -300);
    const candles = await provider.getCandles(dailyQuery(from, '2026-10-08'));
    expect(candles).toHaveLength(301);
    expect(new Set(candles.map((c) => c.t)).size).toBe(301);
    expect(candles[0].t).toBe(dayT(from));
    const calls = candleCalls(client);
    expect(calls).toHaveLength(2);
    expect(calls[1].query.before).toBe(series[199].timestamp);
  });

  it('does not request another page once a bar dated `from` has been seen (1d)', async () => {
    const series = dailySeries(450);
    const { provider, client } = setup((c) => (c.path === '/api/v1/candles' ? servePage(series, c.query) : undefined));
    await provider.getCandles(dailyQuery(addDays('2026-10-08', -150), '2026-10-08'));
    expect(candleCalls(client)).toHaveLength(1);
  });

  it('restarts once when the boundary bar disagrees between pages, then fails as upstream', async () => {
    const series = dailySeries(450);
    const from = addDays('2026-10-08', -300);
    let calls = 0;
    const tamper = (c: Call, enabled: () => boolean): unknown => {
      if (c.path !== '/api/v1/candles') return undefined;
      const page = servePage(series, c.query) as { result: { candles: Bar[]; nextBefore: string | null } };
      if (c.query.before === series[199].timestamp && enabled()) {
        page.result.candles = page.result.candles.map((b, i) => (i === 0 ? { ...b, closePrice: '1' } : b));
      }
      calls++;
      return page;
    };
    let tamperedOnce = false;
    const first = setup((c) => tamper(c, () => !tamperedOnce && (tamperedOnce = true)));
    expect(await first.provider.getCandles(dailyQuery(from, '2026-10-08'))).toHaveLength(301);
    expect(calls).toBe(4); // 2 pages, mismatch on page 2, restart with 2 pages

    const second = setup((c) => tamper(c, () => true));
    const err = await second.provider.getCandles(dailyQuery(from, '2026-10-08')).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('upstream');
  });
});

describe('toss provider: trading days', () => {
  it('maps a business day: integrated times as epoch ms', async () => {
    const { provider, client } = setup();
    const days = await provider.getTradingDays('2026-03-25', '2026-03-25');
    expect(days).toEqual([
      {
        date: '2026-03-25',
        isOpen: true,
        integrated: {
          preStart: kstEpoch('2026-03-25', '08:00:00'),
          regularStart: kstEpoch('2026-03-25', '09:00:00'),
          afterEnd: kstEpoch('2026-03-25', '20:00:00'),
        },
      },
    ]);
    expect(client.dataCalls).toHaveLength(1);
    expect(client.dataCalls[0]).toMatchObject({ path: '/api/v1/market-calendar/KR', query: { date: '2026-03-25' } });
  });

  it('maps integrated:null to a closed day', async () => {
    const { provider } = setup();
    expect(await provider.getTradingDays('2026-05-05', '2026-05-05')).toEqual([{ date: '2026-05-05', isOpen: false }]);
  });

  it('leaves preStart out when preMarket is null', async () => {
    const { provider } = setup((c) =>
      c.path === '/api/v1/market-calendar/KR' ? calendarNxtPreHoliday : undefined,
    );
    const [day] = await provider.getTradingDays('2026-03-25', '2026-03-25');
    expect(day.isOpen).toBe(true);
    expect(day.integrated).toEqual({
      regularStart: kstEpoch('2026-03-25', '09:00:00'),
      afterEnd: kstEpoch('2026-03-25', '20:00:00'),
    });
    expect('preStart' in day.integrated!).toBe(false);
  });

  it('hops from day to nextBusinessDay and closes every date in between', async () => {
    const { provider, client } = setup();
    const days = await provider.getTradingDays('2026-10-05', '2026-10-11');
    expect(client.dataCalls.map((c) => c.query.date)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08']);
    expect(days.map((d) => [d.date, d.isOpen])).toEqual([
      ['2026-10-05', false],
      ['2026-10-06', true],
      ['2026-10-07', true],
      ['2026-10-08', true],
      ['2026-10-09', false],
      ['2026-10-10', false],
      ['2026-10-11', false],
    ]);
    expect(days[3].integrated?.regularStart).toBe(kstEpoch('2026-10-08', '09:00:00'));
  });

  it('returns only the requested range even when the hop reveals more', async () => {
    const { provider } = setup();
    const days = await provider.getTradingDays('2026-10-09', '2026-10-09');
    expect(days).toEqual([{ date: '2026-10-09', isOpen: false }]);
  });

  it('caches by date for the KST day and refetches on the next day', async () => {
    const { provider, client, clock } = setup();
    await provider.getTradingDays('2026-10-05', '2026-10-11');
    const n = client.dataCalls.length;
    await provider.getTradingDays('2026-10-06', '2026-10-10');
    expect(client.dataCalls).toHaveLength(n);
    clock.now += DAY_MS;
    await provider.getTradingDays('2026-10-05', '2026-10-11');
    expect(client.dataCalls).toHaveLength(2 * n);
  });

  it('fails as upstream instead of looping when the calendar does not advance', async () => {
    const { provider, client } = setup((c) =>
      c.path === '/api/v1/market-calendar/KR'
        ? ok({ today: { date: c.query.date, integrated: null }, previousBusinessDay: { date: c.query.date }, nextBusinessDay: { date: c.query.date } })
        : undefined,
    );
    await expect(provider.getTradingDays('2026-10-05', '2026-10-11')).rejects.toMatchObject({ code: 'upstream' });
    expect(client.dataCalls).toHaveLength(1);
  });

  it('when the API snaps a weekend query to the next business day, the weekend is closed and that day keeps its real data', async () => {
    const monday = calendarOctober['2026-10-06'].result.today; // pretend 10-06 is the following business day
    const { provider, client } = setup((c) => {
      if (c.path !== '/api/v1/market-calendar/KR') return undefined;
      if (c.query.date === '2026-10-03') return ok({ ...calendarOctober['2026-10-06'].result, today: monday });
      return calendarOctober[c.query.date as keyof typeof calendarOctober];
    });
    const days = await provider.getTradingDays('2026-10-03', '2026-10-06');
    expect(days.map((d) => [d.date, d.isOpen])).toEqual([
      ['2026-10-03', false],
      ['2026-10-04', false],
      ['2026-10-05', false],
      ['2026-10-06', true],
    ]);
    expect(days[3].integrated?.regularStart).toBe(kstEpoch('2026-10-06', '09:00:00'));
    expect(client.dataCalls.map((c) => c.query.date)).toEqual(['2026-10-03']);
  });

  it('fails as upstream when nextBusinessDay is not after the requested date (loop guard)', async () => {
    for (const next of ['2026-10-05', '2026-10-04']) {
      const { provider, client } = setup((c) =>
        c.path === '/api/v1/market-calendar/KR'
          ? ok({ today: { date: c.query.date, integrated: null }, nextBusinessDay: { date: next } })
          : undefined,
      );
      await expect(provider.getTradingDays('2026-10-05', '2026-10-11')).rejects.toMatchObject({ code: 'upstream' });
      expect(client.dataCalls).toHaveLength(1);
    }
  });

  it('fails as upstream when a snapped today is not before its own nextBusinessDay', async () => {
    const { provider } = setup((c) =>
      c.path === '/api/v1/market-calendar/KR'
        ? ok({ today: { date: '2026-10-07', integrated: null }, nextBusinessDay: { date: '2026-10-06' } })
        : undefined,
    );
    await expect(provider.getTradingDays('2026-10-03', '2026-10-03')).rejects.toMatchObject({ code: 'upstream' });
  });
});

describe('toss provider: index candles', () => {
  it('uses the market-indicators path with the same paging and time rules', async () => {
    const { provider, client } = setup();
    const candles = await provider.getIndexCandles!('KOSPI', '1d', '2026-10-06', '2026-10-08');
    const call = client.dataCalls[0];
    expect(call.path).toBe('/api/v1/market-indicators/KOSPI/candles');
    expect(call.query).toEqual({ interval: '1d', count: '200', before: '2026-10-08T23:59:59+09:00' });
    expect(candles.map((c) => c.t)).toEqual(['2026-10-06', '2026-10-07', '2026-10-08'].map(dayT));
    expect(candles[0]).toMatchObject({ o: expect.any(Number), v: expect.any(Number) });
  });

  it('stamps daily index bars at KST midnight even though Toss stamps them 09:00', async () => {
    const { provider } = setup();
    const candles = await provider.getIndexCandles!('KOSDAQ', '1d', '2026-10-07', '2026-10-08');
    expect(candles.map((c) => c.t)).toEqual([dayT('2026-10-07'), dayT('2026-10-08')]);
  });

  it('serves 1m index candles for a past day with before, stamping the bar start', async () => {
    const { provider, client } = setup();
    const candles = await provider.getIndexCandles!('KOSPI', '1m', '2026-10-08', '2026-10-08');
    expect(client.dataCalls[0].query).toEqual({
      interval: '1m',
      count: '200',
      before: '2026-10-08T23:59:59+09:00',
    });
    expect(candles.map((c) => c.t)).toEqual(['09:00', '09:01', '09:02'].map((hm) => kstEpoch('2026-10-08', `${hm}:00`)));
  });

  it('does not send adjusted for index candles', async () => {
    const { provider, client } = setup();
    await provider.getIndexCandles!('KOSPI', '1d', '2026-10-06', '2026-10-08');
    expect('adjusted' in client.dataCalls[0].query).toBe(false);
  });
});
