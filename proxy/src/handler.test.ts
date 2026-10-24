import { describe, expect, it, vi } from 'vitest';
import { handle, tokenMatches, UPSTREAM, type ProxyEnv } from './handler.js';

const ORIGIN = 'https://sch0718.github.io';
const env: ProxyEnv = { ALLOWED_ORIGINS: ` ${ORIGIN} , http://localhost:5173` };

function fakeFetch(res?: () => Response) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    res ? res() : new Response('{"ok":1}', { status: 200, headers: { 'content-type': 'application/json' } }),
  );
}

function req(path: string, init: RequestInit & { origin?: string | null } = {}) {
  const { origin = ORIGIN, headers, ...rest } = init;
  const h = new Headers(headers);
  if (origin) h.set('origin', origin);
  return new Request(`https://proxy.example${path}`, { ...rest, headers: h });
}

async function code(res: Response) {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

describe('preflight and origin', () => {
  it('answers OPTIONS from an allowed origin with 204 and CORS headers', async () => {
    const f = fakeFetch();
    const res = await handle(req('/toss/api/v1/prices', { method: 'OPTIONS' }), env, f);
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(res.headers.get('access-control-allow-methods')).toBe('GET, POST, OPTIONS');
    expect(res.headers.get('access-control-allow-headers')).toBe(
      'authorization, appkey, appsecret, tr_id, tr_cont, custtype, content-type, x-proxy-token, x-tossinvest-account',
    );
    expect(res.headers.get('access-control-max-age')).toBe('600');
    expect(res.headers.get('vary')).toBe('Origin');
    expect(f).not.toHaveBeenCalled();
  });

  it('rejects OPTIONS from a disallowed origin', async () => {
    const res = await handle(req('/toss/api/v1/prices', { method: 'OPTIONS', origin: 'https://evil.example' }), env, fakeFetch());
    expect(res.status).toBe(403);
    expect(await code(res)).toBe('origin-not-allowed');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rejects proxied requests with a disallowed or missing origin', async () => {
    const f = fakeFetch();
    const a = await handle(req('/toss/api/v1/prices', { origin: 'https://evil.example' }), env, f);
    const b = await handle(req('/toss/api/v1/prices', { origin: null }), env, f);
    expect(a.status).toBe(403);
    expect(await code(a)).toBe('origin-not-allowed');
    expect(b.status).toBe(403);
    expect(await code(b)).toBe('origin-not-allowed');
    expect(f).not.toHaveBeenCalled();
  });

  it('matches origins exactly', async () => {
    const res = await handle(req('/toss/api/v1/prices', { origin: `${ORIGIN}/` }), env, fakeFetch());
    expect(res.status).toBe(403);
  });
});

describe('/health', () => {
  it('returns 200 with CORS headers for an allowed origin', async () => {
    const res = await handle(req('/health'), env, fakeFetch());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, providers: ['kis', 'toss'], originAllowed: true });
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
  });

  // 비밀값이 없는 응답이라 어느 출처에서나 읽게 한다. 앱 진단이 "터널이 끊김"과 "출처를 허용하지 않음"을 구분하는 데 쓴다.
  it('is readable from any origin and says whether that origin is allowed', async () => {
    for (const origin of ['https://evil.example', null]) {
      const res = await handle(req('/health', { origin }), env, fakeFetch());
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, providers: ['kis', 'toss'], originAllowed: false });
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
    }
  });

  it('opening /health does not open other paths to a disallowed origin', async () => {
    const f = fakeFetch();
    const res = await handle(req('/toss/api/v1/prices', { origin: 'https://evil.example' }), env, f);
    expect(res.status).toBe(403);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});

describe('proxy token', () => {
  const withToken: ProxyEnv = { ...env, PROXY_TOKEN: 's' };

  it('401s when the token is missing or wrong, without calling upstream', async () => {
    const f = fakeFetch();
    const a = await handle(req('/toss/api/v1/prices'), withToken, f);
    const b = await handle(req('/toss/api/v1/prices', { headers: { 'x-proxy-token': 'x' } }), withToken, f);
    expect(a.status).toBe(401);
    expect(await code(a)).toBe('proxy-token-invalid');
    expect(a.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(b.status).toBe(401);
    expect(f).not.toHaveBeenCalled();
  });

  it('401s for a wrong token of the same length, a different length, and an empty header', async () => {
    const f = fakeFetch();
    for (const given of ['t', 'ss', '']) {
      const res = await handle(req('/toss/api/v1/prices', { headers: { 'x-proxy-token': given } }), withToken, f);
      expect(res.status).toBe(401);
      expect(await code(res)).toBe('proxy-token-invalid');
    }
    expect(f).not.toHaveBeenCalled();
  });

  it('accepts the right token and does not forward it', async () => {
    const f = fakeFetch();
    const res = await handle(req('/toss/api/v1/prices', { headers: { 'x-proxy-token': 's' } }), withToken, f);
    expect(res.status).toBe(200);
    const sent = new Headers(f.mock.calls[0][1]?.headers);
    expect(sent.has('x-proxy-token')).toBe(false);
  });

  it('checks the token before the path allowlist', async () => {
    const res = await handle(req('/toss/api/v1/orders', { method: 'POST' }), withToken, fakeFetch());
    expect(res.status).toBe(401);
  });
});

describe('tokenMatches', () => {
  it('compares by SHA-256 digest: equal strings match, others do not, null never matches', async () => {
    expect(await tokenMatches('secret', 'secret')).toBe(true);
    expect(await tokenMatches('secreT', 'secret')).toBe(false);
    expect(await tokenMatches('secret!', 'secret')).toBe(false);
    expect(await tokenMatches('', 'secret')).toBe(false);
    expect(await tokenMatches(null, 'secret')).toBe(false);
  });
});

describe('allowlist', () => {
  it('blocks toss order paths without calling upstream', async () => {
    const f = fakeFetch();
    const res = await handle(req('/toss/api/v1/orders', { method: 'POST' }), env, f);
    expect(res.status).toBe(403);
    expect(await code(res)).toBe('proxy-path-blocked');
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(f).not.toHaveBeenCalled();
  });

  // 관심그룹 가져오기를 위해 계좌 목록·보유 주식 조회(GET)를, 내 성과를 위해 주문 목록 조회(GET)만 연다.
  // 주문 생성·정정·취소, 주문 상세, 조건주문, 매수가능금액·매도가능수량·수수료는 계속 막는다.
  it('keeps every other toss account and order path blocked', async () => {
    const f = fakeFetch();
    const cases: Array<[string, string]> = [
      ['POST', '/toss/api/v1/orders'],
      ['PUT', '/toss/api/v1/orders'],
      ['PATCH', '/toss/api/v1/orders'],
      ['DELETE', '/toss/api/v1/orders'],
      ['GET', '/toss/api/v1/orders/'],
      ['GET', '/toss/api/v1/orders/1'],
      ['POST', '/toss/api/v1/orders/1'],
      ['GET', '/toss/api/v1/orders/1/modify'],
      ['POST', '/toss/api/v1/orders/1/modify'],
      ['GET', '/toss/api/v1/orders/1/cancel'],
      ['POST', '/toss/api/v1/orders/1/cancel'],
      ['GET', '/toss/api/v1/conditional-orders'],
      ['POST', '/toss/api/v1/conditional-orders'],
      ['GET', '/toss/api/v1/conditional-orders/1'],
      ['POST', '/toss/api/v1/conditional-orders/1/modify'],
      ['GET', '/toss/api/v1/buying-power'],
      ['GET', '/toss/api/v1/sellable-quantity'],
      ['GET', '/toss/api/v1/commissions'],
      ['POST', '/toss/api/v1/holdings'],
      ['POST', '/toss/api/v1/accounts'],
      ['GET', '/toss/api/v1/holdings/1'],
      ['GET', '/toss/api/v1/sectors/1'],
      ['GET', '/toss/api/v1/sectors/1/etfs'],
      ['GET', '/toss/api/v1/sectors/a.b/stocks'],
      ['GET', '/toss/api/v1/sectors//stocks'],
    ];
    for (const [method, path] of cases) {
      const res = await handle(req(path, { method }), env, f);
      expect(res.status, `${method} ${path}`).toBe(403);
    }
    expect(f).not.toHaveBeenCalled();
  });

  it('blocks kis balance inquiry', async () => {
    const f = fakeFetch();
    const res = await handle(req('/kis/uapi/domestic-trading/v1/trading/inquire-balance'), env, f);
    expect(res.status).toBe(403);
    expect(await code(res)).toBe('proxy-path-blocked');
    expect(f).not.toHaveBeenCalled();
  });

  it('blocks wrong methods, unknown providers, and near-miss paths', async () => {
    const f = fakeFetch();
    const cases: Array<[string, string]> = [
      ['POST', '/toss/api/v1/prices'],
      ['GET', '/toss/oauth2/token'],
      ['GET', '/kis/oauth2/tokenP'],
      ['DELETE', '/toss/api/v1/prices'],
      ['GET', '/other/api/v1/prices'],
      ['GET', '/toss/api/v1/prices/extra'],
      ['GET', '/toss/api/v1/market-indicators/NASDAQ/candles'],
      ['GET', '/kis/uapi/domestic-stock/v1/quotations/inquire-balance'],
      ['GET', '/toss/api/v1/prices/../buying-power'],
      ['POST', '/toss/api/v1/prices/../orders'],
      ['GET', '/toss'],
      ['GET', '/'],
    ];
    for (const [method, path] of cases) {
      const res = await handle(req(path, { method }), env, f);
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(await code(res), `${method} ${path}`).toBe('proxy-path-blocked');
    }
    expect(f).not.toHaveBeenCalled();
  });

  it('blocks path-bypass attempts without calling upstream', async () => {
    const f = fakeFetch();
    const paths = [
      '/toss/api/v1/prices/',
      '/toss//api/v1/prices',
      '/toss/api/v1/PRICES',
      '/toss/api/v1%2Fprices',
      '/toss/%2e%2e/api/v1/orders',
    ];
    for (const path of paths) {
      const res = await handle(req(path), env, f);
      expect(res.status, path).toBe(403);
      expect(await code(res), path).toBe('proxy-path-blocked');
    }
    expect(f).not.toHaveBeenCalled();
  });

  it('allows every listed path', async () => {
    const allowed: Array<[string, string]> = [
      ['POST', '/toss/oauth2/token'],
      ['GET', '/toss/api/v1/prices'],
      ['GET', '/toss/api/v1/candles'],
      ['GET', '/toss/api/v1/stocks'],
      ['GET', '/toss/api/v1/market-calendar/KR'],
      ['GET', '/toss/api/v1/market-indicators/KOSPI/candles'],
      ['GET', '/toss/api/v1/market-indicators/KOSDAQ/candles'],
      ['GET', '/toss/api/v1/accounts'],
      ['GET', '/toss/api/v1/holdings'],
      ['GET', '/toss/api/v1/orders'],
      ['GET', '/toss/api/v1/sectors'],
      ['GET', '/toss/api/v1/sectors/100/stocks'],
      ['GET', '/toss/api/v1/sectors/ab_C-9/stocks'],
      ['POST', '/kis/oauth2/tokenP'],
      ...[
        'inquire-price',
        'inquire-daily-itemchartprice',
        'inquire-time-dailychartprice',
        'search-stock-info',
        'chk-holiday',
        'inquire-daily-indexchartprice',
        'inquire-time-indexchartprice',
      ].map((p): [string, string] => ['GET', `/kis/uapi/domestic-stock/v1/quotations/${p}`]),
    ];
    for (const [method, path] of allowed) {
      const f = fakeFetch();
      const res = await handle(req(path, { method, body: method === 'POST' ? '{}' : undefined }), env, f);
      expect(res.status, `${method} ${path}`).toBe(200);
      expect(f, `${method} ${path}`).toHaveBeenCalledTimes(1);
    }
  });
});

describe('forwarding', () => {
  it('forwards to the toss upstream URL with only allowed headers', async () => {
    const f = fakeFetch();
    await handle(
      req('/toss/api/v1/prices?symbols=005930', {
        headers: {
          authorization: 'Bearer t',
          'content-type': 'application/json',
          cookie: 'sid=1',
          'x-proxy-token': 's',
          'x-forwarded-for': '1.1.1.1',
          referer: 'https://x.example',
          appkey: 'k',
          appsecret: 'sec',
          tr_id: 'FHKST01010100',
          tr_cont: 'N',
          custtype: 'P',
          'x-tossinvest-account': '1',
        },
      }),
      { ...env, PROXY_TOKEN: 's' },
      f,
    );
    expect(String(f.mock.calls[0][0])).toBe(`${UPSTREAM.toss}/api/v1/prices?symbols=005930`);
    expect(f.mock.calls[0][1]?.method).toBe('GET');
    const sent = new Headers(f.mock.calls[0][1]?.headers);
    expect([...sent.keys()].sort()).toEqual(
      ['appkey', 'appsecret', 'authorization', 'content-type', 'custtype', 'tr_cont', 'tr_id', 'x-tossinvest-account'],
    );
    expect(sent.get('authorization')).toBe('Bearer t');
  });

  it('forwards kis requests to the 9443 upstream with query intact', async () => {
    const f = fakeFetch();
    await handle(
      req('/kis/uapi/domestic-stock/v1/quotations/inquire-price?FID_INPUT_ISCD=005930&FID_COND_MRKT_DIV_CODE=J'),
      env,
      f,
    );
    expect(String(f.mock.calls[0][0])).toBe(
      'https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/quotations/inquire-price?FID_INPUT_ISCD=005930&FID_COND_MRKT_DIV_CODE=J',
    );
  });

  it('forwards the POST body unchanged', async () => {
    const f = fakeFetch();
    const body = '{"grant_type":"client_credentials","appkey":"k"}';
    await handle(req('/kis/oauth2/tokenP', { method: 'POST', body, headers: { 'content-type': 'application/json' } }), env, f);
    const init = f.mock.calls[0][1]!;
    expect(init.method).toBe('POST');
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe(body);
  });

  it('passes upstream status, body and selected headers through with CORS', async () => {
    const f = fakeFetch(
      () =>
        new Response('{"msg":"slow down"}', {
          status: 429,
          headers: {
            'content-type': 'application/json',
            'retry-after': '2',
            'x-ratelimit-remaining': '0',
            tr_cont: 'M',
            'set-cookie': 'a=b',
            'x-secret': 'nope',
          },
        }),
    );
    const res = await handle(req('/toss/api/v1/prices'), env, f);
    expect(res.status).toBe(429);
    expect(await res.text()).toBe('{"msg":"slow down"}');
    expect(res.headers.get('retry-after')).toBe('2');
    expect(res.headers.get('x-ratelimit-remaining')).toBe('0');
    expect(res.headers.get('tr_cont')).toBe('M');
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(res.headers.get('x-secret')).toBeNull();
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(res.headers.get('vary')).toBe('Origin');
    expect(res.headers.get('access-control-expose-headers')).toBe('retry-after, x-ratelimit-remaining, tr_cont');
  });

  it('turns an upstream network failure into 502 upstream-unreachable', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const res = await handle(req('/toss/api/v1/prices'), env, f as unknown as typeof fetch);
    expect(res.status).toBe(502);
    expect(await code(res)).toBe('upstream-unreachable');
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
  });

  it('turns a slow upstream into 504 upstream-timeout when a timeout is set', async () => {
    const f = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
        }),
    );
    const res = await handle(req('/toss/api/v1/prices'), env, f as unknown as typeof fetch, { upstreamTimeoutMs: 20 });
    expect(res.status).toBe(504);
    expect(await code(res)).toBe('upstream-timeout');
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
  });
});
