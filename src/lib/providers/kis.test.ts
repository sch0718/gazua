import { describe, expect, it } from 'vitest';
import type { Candle } from '../data/metrics';
import { createRequestQueue, type Priority, type RequestQueue } from '../data/requestQueue';
import { addDays, kstDate, kstEpoch } from '../time/kst';
import { runProviderContract } from './contract';
import { ApiError } from './errors';
import { createProxyClient, type ProxyClient, type ProxyResponse } from './http';
import { KIS_MINUTE_TIME_IS_BAR_END, UnsupportedRangeError, createKisProvider } from './kis';
import type { IssuedAtStore, MarketDataProvider, TokenInfo, TokenStore } from './types';
import chkHoliday from './fixtures/kis/chk-holiday.json';
import daily005930 from './fixtures/kis/daily-005930.json';
import indexDaily0001 from './fixtures/kis/index-daily-0001.json';
import indexDaily1001 from './fixtures/kis/index-daily-1001.json';
import indexMinute0001 from './fixtures/kis/index-minute-0001.json';
import price000660 from './fixtures/kis/inquire-price-000660.json';
import price005930 from './fixtures/kis/inquire-price-005930.json';
import price069500 from './fixtures/kis/inquire-price-069500.json';
import info005930 from './fixtures/kis/search-stock-info-005930.json';
import info069500 from './fixtures/kis/search-stock-info-069500.json';
import minPage1 from './fixtures/kis/time-dailychart-005930-200000.json';
import minPage2 from './fixtures/kis/time-dailychart-005930-091500.json';
import tokenFixture from './fixtures/kis/token.json';

const Q = '/uapi/domestic-stock/v1/quotations';
const SUN = kstEpoch('2026-10-11', '12:00:00');
const APP_KEY = 'test-app-key-AAAA';
const APP_SECRET = 'test-app-secret-BBBB';

interface Call {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body?: unknown;
}
type Json = Record<string, unknown>;
type Handler = (call: Call) => Json | ProxyResponse | undefined | Promise<Json | ProxyResponse | undefined>;

const PRICES: Record<string, unknown> = { '005930': price005930, '000660': price000660, '069500': price069500 };
const INFOS: Record<string, unknown> = { '005930': info005930, '069500': info069500 };
const MINUTES: Record<string, unknown> = { '005930/200000': minPage1, '005930/091500': minPage2 };
const DAILY: Record<string, { output2: Json[] }> = {
  '005930': daily005930,
  '0001': indexDaily0001,
  '1001': indexDaily1001,
};
const EMPTY = { rt_cd: '0', msg_cd: 'MCA00000', msg1: 'ok', output1: {}, output2: [] };

function isProxyResponse(v: unknown): v is ProxyResponse {
  return typeof v === 'object' && v !== null && 'status' in v && 'json' in v && 'headers' in v;
}

/** Routes (path, tr_id, query) to fixtures; `handler` can override any request first. */
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
      if (method === 'POST' && path === '/oauth2/tokenP') return respond(tokenFixture);
      switch (path) {
        case `${Q}/inquire-price`:
          return respond(PRICES[q.FID_INPUT_ISCD]);
        case `${Q}/search-stock-info`:
          return respond(INFOS[q.PDNO]);
        case `${Q}/inquire-time-dailychartprice`:
          return respond(MINUTES[`${q.FID_INPUT_ISCD}/${q.FID_INPUT_HOUR_1}`] ?? EMPTY);
        case `${Q}/inquire-daily-itemchartprice`:
        case `${Q}/inquire-daily-indexchartprice`: {
          const src = DAILY[q.FID_INPUT_ISCD];
          const rows = src.output2.filter(
            (r) => String(r.stck_bsop_date) >= q.FID_INPUT_DATE_1 && String(r.stck_bsop_date) <= q.FID_INPUT_DATE_2,
          );
          return respond({ ...EMPTY, output2: rows });
        }
        case `${Q}/inquire-time-indexchartprice`:
          return respond(indexMinute0001);
        case `${Q}/chk-holiday`:
          return respond({
            ...chkHoliday,
            output: chkHoliday.output.filter((r) => r.bass_dt >= q.BASS_DT),
          });
      }
      throw new Error(`fake KIS: unrouted ${method} ${path}`);
    },
  };
}

function memoryStore(): TokenStore {
  let v: TokenInfo | null = null;
  return { load: () => v, save: (t) => (v = t) };
}

function fastQueue(): RequestQueue {
  return createRequestQueue({ ratesPerSec: { kis: 15 }, now: () => 0, sleep: async () => {} });
}

interface Setup {
  provider: MarketDataProvider;
  client: ReturnType<typeof fakeClient>;
  runs: { group: string; priority: Priority }[];
  clock: { now: number };
}

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
  const provider = createKisProvider({
    client,
    queue,
    creds: { appKey: APP_KEY, appSecret: APP_SECRET },
    tokenStore: memoryStore(),
    now: () => clock.now,
  });
  return { provider, client: client as Setup['client'], runs, clock };
}

const minuteQuery = (date: string, venue: 'KRX' | 'NXT' | 'UNIFIED' = 'KRX', symbol = '005930') =>
  ({ symbol, venue, interval: '1m' as const, from: date, to: date });
const dayT = (d: string) => kstEpoch(d, '00:00:00');

runProviderContract('kis', () => setup().provider, '2026-10-08');

describe('kis provider: basics', () => {
  it('has the expected id and capabilities', () => {
    const { provider } = setup();
    expect(provider.id).toBe('kis');
    expect(provider.capabilities).toEqual({
      venues: ['KRX', 'NXT', 'UNIFIED'],
      quoteBatchSize: 1,
      hasIndexCandles: true,
      indexMinutePastDays: false,
    });
  });

  it('keeps the minute-time interpretation in one exported constant', () => {
    expect(KIS_MINUTE_TIME_IS_BAR_END).toBe(true);
  });
});

describe('kis provider: auth, headers and errors', () => {
  it('getAccessToken shares the token with data calls (one issue)', async () => {
    const { provider, client } = setup();
    const [t] = await Promise.all([provider.getAccessToken!(), provider.getQuotes(['005930'], 'KRX')]);
    expect(t.accessToken).toBe('test-access-token');
    expect(t.expiresAt).toBe(kstEpoch('2026-10-12', '09:00:00'));
    expect(client.calls.filter((c) => c.path === '/oauth2/tokenP')).toHaveLength(1);
    await provider.getAccessToken!();
    expect(client.calls.filter((c) => c.path === '/oauth2/tokenP')).toHaveLength(1);
  });

  it('issues a token via POST /oauth2/tokenP and parses the KST expiry', async () => {
    const { provider, client } = setup();
    await provider.getQuotes(['005930'], 'KRX');
    const [tokenCall] = client.calls;
    expect(tokenCall).toMatchObject({
      method: 'POST',
      path: '/oauth2/tokenP',
      body: { grant_type: 'client_credentials', appkey: APP_KEY, appsecret: APP_SECRET },
    });
  });

  it('sends the common headers and reuses the token across calls', async () => {
    const { provider, client } = setup();
    await provider.getQuotes(['005930', '000660'], 'KRX');
    expect(client.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    const [a, b] = client.dataCalls;
    expect(a.headers).toMatchObject({
      authorization: 'Bearer test-access-token',
      appkey: APP_KEY,
      appsecret: APP_SECRET,
      tr_id: 'FHKST01010100',
      custtype: 'P',
      'content-type': 'application/json; charset=utf-8',
    });
    expect(b.headers.tr_id).toBe('FHKST01010100');
  });

  it('does not reissue a token that the store still has (expiry parsed as KST)', async () => {
    const t = kstEpoch('2026-10-12', '09:00:00');
    const client = fakeClient();
    const store = memoryStore();
    const make = (now: number) =>
      createKisProvider({ client, queue: fastQueue(), creds: { appKey: APP_KEY, appSecret: APP_SECRET }, tokenStore: store, now: () => now });
    await make(t - 3_600_000).getQuotes(['005930'], 'KRX');
    expect(store.load()?.expiresAt).toBe(t);
    await make(t - 3_600_000).getQuotes(['005930'], 'KRX');
    expect(client.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('wraps a failed token response as upstream without leaking secrets', async () => {
    const { provider } = setup((c) => (c.method === 'POST' ? { error: 'x' } : undefined));
    const err = await provider.getQuotes(['005930'], 'KRX').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('upstream');
    expect(err.message).not.toContain(APP_KEY);
    expect(err.message).not.toContain(APP_SECRET);
  });

  it('on token-expired invalidates the token and retries the call once', async () => {
    let failed = false;
    const { provider, client } = setup((c) => {
      if (c.method === 'GET' && !failed) {
        failed = true;
        throw new ApiError('token-expired');
      }
      return undefined;
    });
    const [q] = await provider.getQuotes(['005930'], 'KRX');
    expect(q.price).toBe(71200);
    expect(client.calls.filter((c) => c.method === 'POST')).toHaveLength(2);
    expect(client.dataCalls).toHaveLength(2);
  });

  it('gives up after a second token-expired', async () => {
    const { provider, client } = setup((c) => {
      if (c.method === 'GET') throw new ApiError('token-expired');
      return undefined;
    });
    await expect(provider.getQuotes(['005930'], 'KRX')).rejects.toMatchObject({ code: 'token-expired' });
    expect(client.dataCalls).toHaveLength(2);
  });

  describe('token expiry reported in the body', () => {
    const tokenJson = (n: number) => ({
      ...tokenFixture,
      access_token: `tok${n}`,
    });
    /** POST hands out tok1, tok2, ...; GETs made with tok1 are rejected by `reject`. */
    const rotating = (reject: (c: Call) => Json | ProxyResponse) => {
      let n = 0;
      return (c: Call): Json | ProxyResponse | undefined => {
        if (c.method === 'POST') return tokenJson(++n);
        return c.headers.authorization === 'Bearer tok1' ? reject(c) : undefined;
      };
    };
    const posts = (client: { calls: Call[] }) => client.calls.filter((c) => c.method === 'POST').length;

    it('HTTP 500 with msg_cd EGW00123 (via the real proxy client): invalidates and retries once', async () => {
      let n = 0;
      const sent: { method: string; auth: string | null }[] = [];
      const fetchImpl = (async (url: string, init: RequestInit) => {
        const headers = new Headers(init.headers);
        const method = init.method ?? 'GET';
        sent.push({ method, auth: headers.get('authorization') });
        const json = (body: unknown, status = 200) =>
          new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
        if (method === 'POST') return json(tokenJson(++n));
        if (headers.get('authorization') === 'Bearer tok1') return json({ rt_cd: '1', msg_cd: 'EGW00123', msg1: 'expired' }, 500);
        return json(price005930);
      }) as unknown as typeof fetch;
      const client = createProxyClient({ baseUrl: 'https://proxy.test', fetchImpl });
      const { provider } = setup(undefined, SUN, client);
      const [q] = await provider.getQuotes(['005930'], 'KRX');
      expect(q.price).toBe(71200);
      expect(sent.filter((s) => s.method === 'POST')).toHaveLength(2);
      expect(sent.filter((s) => s.method === 'GET')).toHaveLength(2);
    });

    it('HTTP 200 with rt_cd != 0 and msg_cd EGW00121: invalidates and retries once', async () => {
      const { provider, client } = setup(rotating(() => ({ rt_cd: '1', msg_cd: 'EGW00121', msg1: 'invalid token' })));
      const [q] = await provider.getQuotes(['005930'], 'KRX');
      expect(q.price).toBe(71200);
      expect(posts(client)).toBe(2);
      expect(client.dataCalls).toHaveLength(2);
    });

    it('treats msg_cd EGW00201 in a 200 body as rate-limited and lets the queue retry', async () => {
      let hits = 0;
      const { provider, client } = setup((c) =>
        c.method === 'GET' && hits++ === 0 ? { rt_cd: '1', msg_cd: 'EGW00201', msg1: 'too many' } : undefined,
      );
      const [q] = await provider.getQuotes(['005930'], 'KRX');
      expect(q.price).toBe(71200);
      expect(client.dataCalls).toHaveLength(2);
    });

    it('parallel callers that all hit token-expired trigger one re-issue, not one each', async () => {
      const { provider, client } = setup(rotating(() => { throw new ApiError('token-expired'); }));
      const quotes = await provider.getQuotes(['005930', '000660', '069500'], 'KRX');
      expect(quotes.map((q) => q.price)).toEqual([71200, 198500, 36450]);
      expect(posts(client)).toBe(2);
    });
  });

  it('turns rt_cd != 0 into an upstream ApiError built from msg_cd only, without retrying', async () => {
    const { provider, client } = setup((c) =>
      c.method === 'GET' ? { rt_cd: '1', msg_cd: 'EGW00500', msg1: `초당 ${APP_SECRET}` } : undefined,
    );
    const err = await provider.getQuotes(['005930'], 'KRX').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('upstream');
    expect(err.message).toContain('EGW00500');
    expect(err.message).not.toContain(APP_SECRET);
    expect(client.dataCalls).toHaveLength(1);
  });

  it('uses queue group "kis": priority 0 for quotes, 1 for everything else', async () => {
    const { provider, runs } = setup();
    await provider.getQuotes(['005930'], 'KRX');
    await provider.getStockMeta(['005930']);
    await provider.getCandles({ symbol: '005930', venue: 'KRX', interval: '1d', from: '2026-10-06', to: '2026-10-08' });
    await provider.getTradingDays('2026-10-05', '2026-10-11');
    expect(runs.every((r) => r.group === 'kis')).toBe(true);
    expect(runs[0].priority).toBe(0);
    expect(runs.slice(1).every((r) => r.priority === 1)).toBe(true);
  });
});

describe('kis provider: request priority', () => {
  const daily = { symbol: '005930', venue: 'KRX' as const, interval: '1d' as const, from: '2026-10-06', to: '2026-10-08' };

  it('passes priority to every daily page, stock minute page and index request; defaults to 1', async () => {
    const { provider, runs } = setup();
    await provider.getCandles({ ...daily, priority: 2 });
    await provider.getCandles({ ...minuteQuery('2026-10-08'), priority: 2 });
    await provider.getIndexCandles!('KOSPI', '1d', '2026-10-06', '2026-10-08', 2);
    expect(runs.length).toBeGreaterThan(3);
    expect(runs.every((r) => r.priority === 2)).toBe(true);

    runs.length = 0;
    await provider.getCandles(daily);
    await provider.getIndexCandles!('KOSPI', '1d', '2026-10-06', '2026-10-08');
    expect(runs.length).toBeGreaterThan(1);
    expect(runs.every((r) => r.priority === 1)).toBe(true);
  });

  it('passes priority to the index minute request', async () => {
    // 분봉 fixture가 2026-10-12 것이라 그날 장중으로 맞춘다(오류를 삼키지 않고 실제로 성공해야 한다)
    const now = kstEpoch('2026-10-12', '09:11:30');
    const { provider, runs } = setup(undefined, now);
    const today = kstDate(now);
    const candles = await provider.getIndexCandles!('KOSPI', '1m', today, today, 2);
    expect(candles.length).toBeGreaterThan(0);
    expect(runs.map((r) => r.priority)).toEqual([2]);
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
    const provider = createKisProvider({
      client,
      queue,
      creds: { appKey: APP_KEY, appSecret: APP_SECRET },
      tokenStore: memoryStore(),
      now: () => SUN,
    });
    await Promise.all([provider.getCandles({ ...daily, priority: 2 }), provider.getCandles({ ...daily, priority: 1 })]);
    expect(client.dataCalls).toHaveLength(1);
    expect(executed).toEqual([2]);
  });
});

describe('kis provider: quotes', () => {
  it('maps venue to the market division code and returns price with ts = now', async () => {
    const { provider, client } = setup();
    for (const [venue, code] of [['KRX', 'J'], ['NXT', 'NX'], ['UNIFIED', 'UN']] as const) {
      const quotes = await provider.getQuotes(['005930'], venue);
      expect(quotes).toEqual([{ symbol: '005930', venue, price: 71200, ts: SUN }]);
      expect(client.dataCalls.at(-1)).toMatchObject({
        path: `${Q}/inquire-price`,
        query: { FID_COND_MRKT_DIV_CODE: code, FID_INPUT_ISCD: '005930' },
      });
    }
  });

  it('keeps symbol order', async () => {
    const { provider } = setup();
    const quotes = await provider.getQuotes(['069500', '005930', '000660'], 'KRX');
    expect(quotes.map((q) => [q.symbol, q.price])).toEqual([
      ['069500', 36450],
      ['005930', 71200],
      ['000660', 198500],
    ]);
  });
});

describe('kis provider: stock meta', () => {
  const infoWith = (over: Json) => (c: Call): Json | undefined =>
    c.path.endsWith('/search-stock-info')
      ? { rt_cd: '0', msg_cd: 'MCA00000', output: { prdt_abrv_name: 'X', mket_id_cd: 'STK', scty_grp_id_cd: 'ST', tr_stop_yn: 'N', cptt_trad_tr_psbl_yn: 'N', nxt_tr_stop_yn: 'N', ...over } }
      : undefined;

  it('maps name, market, type, NXT flags and shares outstanding', async () => {
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
        sharesOutstanding: 780000000,
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
    const info = client.dataCalls.find((c) => c.path.endsWith('/search-stock-info'))!;
    expect(info.headers.tr_id).toBe('CTPF1002R');
    expect(info.query).toMatchObject({ PRDT_TYPE_CD: '300', PDNO: '069500' });
    const price = client.dataCalls.find((c) => c.path.endsWith('/inquire-price'))!;
    expect(price.query.FID_COND_MRKT_DIV_CODE).toBe('J');
  });

  it('maps mket_id_cd', async () => {
    const out: string[] = [];
    for (const code of ['STK', 'KSQ', 'KNX', '']) {
      const { provider } = setup(infoWith({ mket_id_cd: code }));
      out.push((await provider.getStockMeta(['005930']))[0].market);
    }
    expect(out).toEqual(['KOSPI', 'KOSDAQ', 'KR_ETC', 'KR_ETC']);
  });

  it('maps scty_grp_id_cd', async () => {
    const out: string[] = [];
    for (const code of ['ST', 'EF', 'EN', 'RT', 'FS']) {
      const { provider } = setup(infoWith({ scty_grp_id_cd: code }));
      out.push((await provider.getStockMeta(['005930']))[0].securityType);
    }
    expect(out).toEqual(['STOCK', 'ETF', 'ETN', 'REIT', 'OTHER']);
  });

  it('maps suspension and NXT flags', async () => {
    const a = setup(infoWith({ tr_stop_yn: 'Y', cptt_trad_tr_psbl_yn: 'Y', nxt_tr_stop_yn: 'Y' }));
    expect((await a.provider.getStockMeta(['005930']))[0]).toMatchObject({
      krxSuspended: true,
      nxtSupported: true,
      nxtSuspended: true,
    });
    const b = setup(infoWith({ cptt_trad_tr_psbl_yn: 'N', nxt_tr_stop_yn: 'Y' }));
    expect((await b.provider.getStockMeta(['005930']))[0]).toMatchObject({ nxtSupported: false, nxtSuspended: null });
  });

  it('omits a symbol KIS rejects and returns the rest in request order', async () => {
    const reject = (c: Call): Json | undefined =>
      c.query.PDNO === '999999' || c.query.FID_INPUT_ISCD === '999999'
        ? { rt_cd: '1', msg_cd: 'EGW00001', msg1: '조회할 자료가 없습니다' }
        : undefined;
    const { provider } = setup(reject);
    const metas = await provider.getStockMeta(['069500', '999999', '005930']);
    expect(metas.map((m) => m.symbol)).toEqual(['069500', '005930']);
  });

  it('rejects when no symbol could be resolved (e.g. the proxy is down)', async () => {
    const { provider } = setup((c) => (c.method === 'GET' ? { rt_cd: '1', msg_cd: 'EGW00001', msg1: 'x' } : undefined));
    await expect(provider.getStockMeta(['005930', '069500'])).rejects.toBeInstanceOf(ApiError);
  });
});

describe('kis provider: minute candles', () => {
  it('pages the daily-minute TR for the requested date, newest first, stopping on an empty page', async () => {
    const { provider, client } = setup(); // Sunday: asks for the last trading day
    const candles = await provider.getCandles(minuteQuery('2026-10-08'));
    const calls = client.dataCalls;
    expect(calls.map((c) => c.query.FID_INPUT_HOUR_1)).toEqual(['200000', '091500', '090000']);
    for (const c of calls) {
      expect(c.path).toBe(`${Q}/inquire-time-dailychartprice`);
      expect(c.headers.tr_id).toBe('FHKST03010230');
      expect(c.query).toMatchObject({
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: '005930',
        FID_INPUT_DATE_1: '20261008',
        FID_PW_DATA_INCU_YN: 'N',
        FID_FAKE_TICK_INCU_YN: '',
      });
    }
    expect(candles).toHaveLength(30);
    // cntg_hour is the bar end, so 09:01:00 is the bar that starts at 09:00.
    expect(candles[0]).toEqual({ t: kstEpoch('2026-10-08', '09:00:00'), o: 71000, h: 71020, l: 70990, c: 71010, v: 1000 });
    expect(candles.at(-1)!.t).toBe(kstEpoch('2026-10-08', '09:29:00'));
  });

  it('maps venue to the market division code', async () => {
    const { provider, client } = setup();
    for (const [venue, code] of [['KRX', 'J'], ['NXT', 'NX'], ['UNIFIED', 'UN']] as const) {
      await provider.getCandles(minuteQuery('2026-10-08', venue));
      expect(client.dataCalls.at(-1)!.query.FID_COND_MRKT_DIV_CODE).toBe(code);
    }
  });

  it('keeps only bars of the requested date, de-duplicates, and sorts ascending', async () => {
    const row = (date: string, hour: string, c: number) => ({
      stck_bsop_date: date, stck_cntg_hour: hour, stck_prpr: String(c), stck_oprc: String(c), stck_hgpr: String(c), stck_lwpr: String(c), cntg_vol: '5',
    });
    const { provider, client } = setup((c) =>
      c.path.endsWith('inquire-time-dailychartprice')
        ? {
            ...EMPTY,
            output2:
              c.query.FID_INPUT_HOUR_1 === '200000'
                ? [row('20261008', '100200', 3), row('20261008', '100100', 2), row('20261008', '100100', 2), row('20261007', '153000', 9)]
                : [],
          }
        : undefined,
    );
    const candles = await provider.getCandles(minuteQuery('2026-10-08'));
    expect(candles.map((x) => x.c)).toEqual([2, 3]);
    // the page spilled into the previous date, so there is nothing older to fetch
    expect(client.dataCalls).toHaveLength(1);
  });

  it('stops once the oldest bar is before 08:00', async () => {
    const { provider, client } = setup((c) =>
      c.path.endsWith('inquire-time-dailychartprice')
        ? {
            ...EMPTY,
            output2: [
              { stck_bsop_date: '20261008', stck_cntg_hour: '080100', stck_prpr: '10', stck_oprc: '10', stck_hgpr: '10', stck_lwpr: '10', cntg_vol: '1' },
              { stck_bsop_date: '20261008', stck_cntg_hour: '080000', stck_prpr: '10', stck_oprc: '10', stck_hgpr: '10', stck_lwpr: '10', cntg_vol: '1' },
            ],
          }
        : undefined,
    );
    const candles = await provider.getCandles(minuteQuery('2026-10-08'));
    expect(client.dataCalls).toHaveLength(1);
    expect(candles.map((x) => x.t)).toEqual([kstEpoch('2026-10-08', '08:00:00')]);
  });

  it('stops after 10 pages', async () => {
    let n = 0;
    const { provider, client } = setup((c) => {
      if (!c.path.endsWith('inquire-time-dailychartprice')) return undefined;
      const minute = 19 * 60 + 59 - n++; // always a bar older than the last page
      const hh = String(Math.floor(minute / 60)).padStart(2, '0');
      const mm = String(minute % 60).padStart(2, '0');
      return { ...EMPTY, output2: [{ stck_bsop_date: '20261008', stck_cntg_hour: `${hh}${mm}00`, stck_prpr: '1', stck_oprc: '1', stck_hgpr: '1', stck_lwpr: '1', cntg_vol: '1' }] };
    });
    const candles = await provider.getCandles(minuteQuery('2026-10-08'));
    expect(client.dataCalls).toHaveLength(10);
    expect(candles).toHaveLength(10);
  });

  it('rejects multi-day minute ranges', async () => {
    const { provider } = setup();
    await expect(
      provider.getCandles({ symbol: '005930', venue: 'KRX', interval: '1m', from: '2026-10-07', to: '2026-10-08' }),
    ).rejects.toBeInstanceOf(UnsupportedRangeError);
  });
});

describe('kis provider: daily candles', () => {
  it('requests FHKST03010100 with D / unadjusted and maps fields including traded value', async () => {
    const { provider, client } = setup();
    const candles = await provider.getCandles({ symbol: '005930', venue: 'NXT', interval: '1d', from: '2026-10-06', to: '2026-10-08' });
    const [first] = client.dataCalls;
    expect(first.path).toBe(`${Q}/inquire-daily-itemchartprice`);
    expect(first.headers.tr_id).toBe('FHKST03010100');
    expect(first.query).toMatchObject({
      FID_COND_MRKT_DIV_CODE: 'NX',
      FID_INPUT_ISCD: '005930',
      FID_INPUT_DATE_1: '20261006',
      FID_INPUT_DATE_2: '20261008',
      FID_PERIOD_DIV_CODE: 'D',
      FID_ORG_ADJ_PRC: '0',
    });
    expect(candles.map((c) => c.t)).toEqual(['2026-10-06', '2026-10-07', '2026-10-08'].map(dayT));
    expect(candles[2]).toEqual({ t: dayT('2026-10-08'), o: 70900, h: 71500, l: 70500, c: 71200, v: 12000000, value: 12000000 * 71200 });
  });

  describe('paging beyond 100 rows', () => {
    const START = '2025-01-01';
    const days = Array.from({ length: 250 }, (_, i) => addDays(START, i)); // ascending
    const compact = (d: string) => d.replaceAll('-', '');
    const rowFor = (d: string, close: number) => ({
      stck_bsop_date: compact(d), stck_clpr: String(close), stck_oprc: '1', stck_hgpr: '2', stck_lwpr: '1', acml_vol: '3', acml_tr_pbmn: '4',
    });
    /** Serves up to 100 newest rows in [DATE_1, DATE_2]; `closeFor` can corrupt a page. */
    const pager = (closeFor: (d: string, page: number) => number = (_d, _p) => 100) => {
      let page = 0;
      return (c: Call): Json | undefined => {
        if (!c.path.endsWith('inquire-daily-itemchartprice')) return undefined;
        const rows = days
          .filter((d) => compact(d) >= c.query.FID_INPUT_DATE_1 && compact(d) <= c.query.FID_INPUT_DATE_2)
          .reverse()
          .slice(0, 100)
          .map((d) => rowFor(d, closeFor(d, page)));
        page++;
        return { ...EMPTY, output2: rows };
      };
    };
    const range = { symbol: '005930', venue: 'KRX' as const, interval: '1d' as const, from: days[0], to: days[249] };

    it('moves FID_INPUT_DATE_2 back to the oldest date of the previous page and returns every day once', async () => {
      const { provider, client } = setup(pager());
      const candles = await provider.getCandles(range);
      expect(candles).toHaveLength(250);
      expect(candles.map((c) => c.t)).toEqual(days.map(dayT));
      const ends = client.dataCalls.map((c) => c.query.FID_INPUT_DATE_2);
      expect(ends).toEqual([compact(days[249]), compact(days[150]), compact(days[51])]);
    });

    it('restarts the whole fetch once when the overlapping day disagrees between pages', async () => {
      // Only the second request (page index 1) serves a bad close, so the retry is clean.
      const { provider, client } = setup(pager((_d, page) => (page === 1 ? 999 : 100)));
      const candles = await provider.getCandles(range);
      expect(candles).toHaveLength(250);
      expect(candles.every((c) => c.c === 100)).toBe(true);
      expect(client.dataCalls).toHaveLength(2 + 3); // aborted attempt (2 pages) + full retry (3 pages)
    });

    it('throws upstream if the overlap disagrees again after the restart', async () => {
      const { provider } = setup(pager((_d, page) => (page % 3 === 0 ? 100 : 100 + page)));
      const err = await provider.getCandles(range).catch((e) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect(err.code).toBe('upstream');
    });
  });
});

describe('kis provider: trading days', () => {
  it('calls chk-holiday with BASS_DT = from and maps opnd_yn', async () => {
    const { provider, client } = setup();
    const days = await provider.getTradingDays('2026-10-05', '2026-10-11');
    expect(days.map((d) => [d.date, d.isOpen])).toEqual([
      ['2026-10-05', true],
      ['2026-10-06', true],
      ['2026-10-07', true],
      ['2026-10-08', true],
      ['2026-10-09', false],
      ['2026-10-10', false],
      ['2026-10-11', false],
    ]);
    expect(client.dataCalls).toHaveLength(1);
    expect(client.dataCalls[0].path).toBe(`${Q}/chk-holiday`);
    expect(client.dataCalls[0].headers.tr_id).toBe('CTCA0903R');
    expect(client.dataCalls[0].query).toEqual({ BASS_DT: '20261005', CTX_AREA_FK: '', CTX_AREA_NK: '' });
  });

  it('returns only the requested range and caches per date for the day', async () => {
    const { provider, client, clock } = setup();
    expect((await provider.getTradingDays('2026-10-06', '2026-10-07')).map((d) => d.date)).toEqual(['2026-10-06', '2026-10-07']);
    await provider.getTradingDays('2026-10-07', '2026-10-07');
    await provider.getTradingDays('2026-10-06', '2026-10-07');
    expect(client.dataCalls).toHaveLength(1);
    clock.now = kstEpoch('2026-10-12', '09:00:00');
    await provider.getTradingDays('2026-10-06', '2026-10-07');
    expect(client.dataCalls).toHaveLength(2);
  });

  it('follows tr_cont pagination until the end date is covered', async () => {
    const row = (d: string) => ({ bass_dt: d, opnd_yn: 'Y' });
    const { provider, client } = setup((c) => {
      if (!c.path.endsWith('/chk-holiday')) return undefined;
      if (c.headers.tr_cont === undefined) {
        return {
          status: 200,
          headers: new Headers({ tr_cont: 'M' }),
          json: { ...EMPTY, ctx_area_fk: 'FK1', ctx_area_nk: 'NK1', output: [row('20261005'), row('20261006')] },
        };
      }
      return {
        status: 200,
        headers: new Headers({ tr_cont: 'D' }),
        json: { ...EMPTY, ctx_area_fk: '', ctx_area_nk: '', output: [row('20261007'), row('20261008')] },
      };
    });
    const days = await provider.getTradingDays('2026-10-05', '2026-10-08');
    expect(days.map((d) => d.date)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08']);
    expect(client.dataCalls).toHaveLength(2);
    expect(client.dataCalls[1].headers.tr_cont).toBe('N');
    expect(client.dataCalls[1].query).toEqual({ BASS_DT: '20261005', CTX_AREA_FK: 'FK1', CTX_AREA_NK: 'NK1' });
  });

  it('does not paginate when the first page already covers the end date', async () => {
    const { provider, client } = setup((c) =>
      c.path.endsWith('/chk-holiday')
        ? { status: 200, headers: new Headers({ tr_cont: 'M' }), json: { ...chkHoliday, ctx_area_fk: 'a', ctx_area_nk: 'b' } }
        : undefined,
    );
    await provider.getTradingDays('2026-10-05', '2026-10-08');
    expect(client.dataCalls).toHaveLength(1);
  });
});

describe('kis provider: index candles', () => {
  it('daily: FHKUP03500100 with market U and the index code', async () => {
    const { provider, client } = setup();
    const kospi = await provider.getIndexCandles!('KOSPI', '1d', '2026-10-06', '2026-10-08');
    expect(client.dataCalls[0].path).toBe(`${Q}/inquire-daily-indexchartprice`);
    expect(client.dataCalls[0].headers.tr_id).toBe('FHKUP03500100');
    expect(client.dataCalls[0].query).toMatchObject({
      FID_COND_MRKT_DIV_CODE: 'U',
      FID_INPUT_ISCD: '0001',
      FID_INPUT_DATE_1: '20261006',
      FID_INPUT_DATE_2: '20261008',
      FID_PERIOD_DIV_CODE: 'D',
    });
    expect(kospi.map((c) => c.t)).toEqual(['2026-10-06', '2026-10-07', '2026-10-08'].map(dayT));
    expect(kospi.at(-1)).toMatchObject({ o: 2640.5, h: 2655, l: 2635.2, c: 2650.12 });
    await provider.getIndexCandles!('KOSDAQ', '1d', '2026-10-06', '2026-10-08');
    expect(client.dataCalls.at(-1)!.query.FID_INPUT_ISCD).toBe('1001');
  });

  it('minute: only for today, otherwise UnsupportedRangeError without any request', async () => {
    const { provider, client } = setup();
    await expect(provider.getIndexCandles!('KOSPI', '1m', '2026-10-08', '2026-10-08')).rejects.toBeInstanceOf(UnsupportedRangeError);
    expect(client.calls).toHaveLength(0);
  });

  it('minute today: FHKUP03500200, bars of today only, ascending', async () => {
    const { provider, client } = setup(undefined, kstEpoch('2026-10-12', '09:11:30'));
    const candles: Candle[] = await provider.getIndexCandles!('KOSPI', '1m', '2026-10-12', '2026-10-12');
    expect(client.dataCalls).toHaveLength(1);
    expect(client.dataCalls[0].path).toBe(`${Q}/inquire-time-indexchartprice`);
    expect(client.dataCalls[0].headers.tr_id).toBe('FHKUP03500200');
    expect(client.dataCalls[0].query).toMatchObject({
      FID_COND_MRKT_DIV_CODE: 'U',
      FID_ETC_CLS_CODE: '0',
      FID_INPUT_ISCD: '0001',
      FID_PW_DATA_INCU_YN: 'N',
    });
    expect(candles).toHaveLength(10);
    expect(candles[0]).toMatchObject({ t: kstEpoch('2026-10-12', '09:00:00'), o: 2650, c: 2650.5 });
    expect(candles.at(-1)!.t).toBe(kstEpoch('2026-10-12', '09:09:00'));
  });
});

describe('KIS token throttle countdown', () => {
  const T0 = kstEpoch('2026-10-12', '09:00:00');

  function issuedAtStore(): IssuedAtStore {
    let v: number | null = null;
    return { load: () => v, save: (t) => (v = t) };
  }

  /** 새로고침 흉내: 토큰 저장소는 비고(잠금 모드는 메모리) 발급 시각 저장소만 같다. */
  function make(issuedAt: IssuedAtStore | undefined, clock: { now: number }, throttle: () => ApiError | null) {
    const client = fakeClient((c) => {
      if (c.method !== 'POST') return undefined;
      const e = throttle();
      if (e) throw e;
      return undefined;
    });
    return createKisProvider({
      client,
      queue: fastQueue(),
      creds: { appKey: APP_KEY, appSecret: APP_SECRET },
      tokenStore: memoryStore(),
      now: () => clock.now,
      ...(issuedAt ? { issuedAt } : {}),
    });
  }

  it('throttled reissue after reload shows remaining seconds', async () => {
    const issuedAt = issuedAtStore();
    const clock = { now: T0 };
    await make(issuedAt, clock, () => null).getQuotes(['005930'], 'KRX');
    expect(issuedAt.load()).toBe(T0);

    clock.now = T0 + 20_000;
    const reloaded = make(issuedAt, clock, () => new ApiError('token-throttled', undefined, { status: 403 }));
    const err = await reloaded.getQuotes(['005930'], 'KRX').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('token-throttled');
    expect(err.status).toBe(403);
    expect(err.retryAfterMs).toBe(40_000);
  });

  it('prefers the Retry-After header, never goes below zero, and leaves it unknown without an issue time', async () => {
    const issuedAt = issuedAtStore();
    issuedAt.save(T0);
    const clock = { now: T0 + 20_000 };
    const withHeader = make(issuedAt, clock, () => new ApiError('token-throttled', undefined, { status: 403, retryAfterMs: 5_000 }));
    expect((await withHeader.getQuotes(['005930'], 'KRX').catch((e) => e)).retryAfterMs).toBe(5_000);

    clock.now = T0 + 90_000;
    const late = make(issuedAt, clock, () => new ApiError('token-throttled', undefined, { status: 403 }));
    expect((await late.getQuotes(['005930'], 'KRX').catch((e) => e)).retryAfterMs).toBe(0);

    const unknown = make(issuedAtStore(), clock, () => new ApiError('token-throttled', undefined, { status: 403 }));
    const err = await unknown.getQuotes(['005930'], 'KRX').catch((e) => e);
    expect(err.code).toBe('token-throttled');
    expect(err.retryAfterMs).toBeUndefined();
    const noStore = make(undefined, clock, () => new ApiError('token-throttled', undefined, { status: 403 }));
    expect((await noStore.getQuotes(['005930'], 'KRX').catch((e) => e)).retryAfterMs).toBeUndefined();
  });
});
