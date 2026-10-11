import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, classify, describeError, type ErrorCode } from './errors';
import { createProxyClient } from './http';

describe('classify', () => {
  const proxyErr = (code: string) => ({ error: { code } });
  const cases: Array<[string, number, unknown, 'kis' | 'toss', ErrorCode]> = [
    ['proxy-path-blocked', 403, proxyErr('proxy-path-blocked'), 'kis', 'path-blocked'],
    ['proxy-token-invalid', 401, proxyErr('proxy-token-invalid'), 'toss', 'proxy-token-invalid'],
    ['origin-not-allowed', 403, proxyErr('origin-not-allowed'), 'kis', 'origin-not-allowed'],
    ['upstream-unreachable', 502, proxyErr('upstream-unreachable'), 'kis', 'upstream'],
    ['toss ip-not-allowed', 403, proxyErr('ip-not-allowed'), 'toss', 'ip-not-allowed'],
    ['oauth access_denied', 403, { error: 'access_denied' }, 'toss', 'ip-not-allowed'],
    ['oauth invalid_client', 401, { error: 'invalid_client' }, 'toss', 'invalid-credentials'],
    ['other 401', 401, { error: { code: 'invalid-token' } }, 'toss', 'token-expired'],
    ['401 without body', 401, null, 'kis', 'token-expired'],
    ['KIS EGW00133', 403, { error_code: 'EGW00133', error_description: 'x' }, 'kis', 'token-throttled'],
    ['429', 429, null, 'kis', 'rate-limited'],
    ['500', 500, null, 'toss', 'upstream'],
    ['body msg_cd EGW00123 on HTTP 500', 500, { rt_cd: '1', msg_cd: 'EGW00123' }, 'kis', 'token-expired'],
    ['body msg_cd EGW00121 on HTTP 200', 200, { rt_cd: '1', msg_cd: 'EGW00121' }, 'kis', 'token-expired'],
    ['body msg_cd EGW00201', 500, { rt_cd: '1', msg_cd: 'EGW00201' }, 'kis', 'rate-limited'],
    ['inherited property name as proxy code', 500, { error: { code: 'toString' } }, 'kis', 'upstream'],
    ['inherited property name as proxy code (constructor)', 403, { error: { code: 'constructor' } }, 'toss', 'upstream'],
    ['404 other', 404, { message: 'x' }, 'kis', 'upstream'],
  ];
  it.each(cases)('%s', (_name, status, body, provider, expected) => {
    expect(classify(status, body, provider)).toBe(expected);
  });
});

describe('describeError', () => {
  const rows: Array<[ErrorCode, string, { label: string; target: string } | undefined]> = [
    ['proxy-unreachable', '프록시에 연결할 수 없어요', { label: '진단 열기', target: 'diagnostics' }],
    ['cors-blocked', '프록시가 이 주소를 허용하지 않아요', { label: '허용할 주소 복사', target: 'copy-origin' }],
    ['origin-not-allowed', '프록시가 이 주소를 허용하지 않아요', { label: '허용할 주소 복사', target: 'copy-origin' }],
    ['proxy-token-invalid', '프록시 토큰이 맞지 않아요', { label: '토큰 다시 입력', target: 'credentials' }],
    ['path-blocked', '이 요청은 프록시에서 막혀 있어요', undefined],
    ['ip-not-allowed', '토스에 프록시 IP가 등록되지 않았어요', { label: '진단 열기', target: 'diagnostics' }],
    ['invalid-credentials', '키가 맞지 않아요', { label: '키 다시 입력', target: 'credentials' }],
    ['token-expired', '토큰을 다시 받는 중이에요', undefined],
    ['token-throttled', 'KIS 토큰은 1분에 한 번만 받을 수 있어요', undefined],
    ['rate-limited', '잠시 천천히 불러오는 중', undefined],
    ['timeout', '응답이 늦어요', { label: '진단 열기', target: 'diagnostics' }],
    ['upstream', '증권사 서버에서 오류가 났어요', undefined],
    ['offline', '오프라인이에요', undefined],
  ];
  it.each(rows)('%s', (code, title, action) => {
    const d = describeError(code);
    expect(d.title).toBe(title);
    expect(d.action).toEqual(action);
  });
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string>) },
  });
}

describe('createProxyClient', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('builds the URL, query, token header and parses JSON', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: 1 }));
    const client = createProxyClient({ baseUrl: 'https://p.example/', proxyToken: 'tok', fetchImpl });
    const res = await client.request('kis', 'GET', '/uapi/x', {
      query: { a: '1', b: '가' },
      headers: { authorization: 'Bearer z' },
    });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: 1 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://p.example/kis/uapi/x?a=1&b=%EA%B0%80');
    expect(init.method).toBe('GET');
    const h = new Headers(init.headers);
    expect(h.get('x-proxy-token')).toBe('tok');
    expect(h.get('authorization')).toBe('Bearer z');
    expect(init.body).toBeUndefined();
  });

  it('omits the token header when none is configured', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    const client = createProxyClient({ baseUrl: 'https://p.example', fetchImpl });
    await client.request('toss', 'GET', '/y');
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).has('x-proxy-token')).toBe(false);
  });

  it('sends plain objects as JSON', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    const client = createProxyClient({ baseUrl: 'https://p.example', fetchImpl });
    await client.request('kis', 'POST', '/oauth2/tokenP', { body: { grant_type: 'client_credentials' } });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get('content-type')).toBe('application/json; charset=utf-8');
    expect(init.body).toBe('{"grant_type":"client_credentials"}');
  });

  it('sends URLSearchParams as form-urlencoded', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    const client = createProxyClient({ baseUrl: 'https://p.example', fetchImpl });
    await client.request('toss', 'POST', '/oauth2/token', {
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
    });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(String(init.body)).toBe('grant_type=client_credentials');
  });

  it('returns null json for non-JSON content', async () => {
    const fetchImpl = vi.fn(async () => new Response('hi', { status: 200, headers: { 'content-type': 'text/plain' } }));
    const client = createProxyClient({ baseUrl: 'https://p.example', fetchImpl });
    expect((await client.request('kis', 'GET', '/x')).json).toBeNull();
  });

  it('throws a classified ApiError for non-2xx with status and retryAfterMs', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: 'slow' }, { status: 429, headers: { 'retry-after': '2' } }));
    const client = createProxyClient({ baseUrl: 'https://p.example', fetchImpl });
    const err = await client.request('kis', 'GET', '/x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('rate-limited');
    expect(err.status).toBe(429);
    expect(err.retryAfterMs).toBe(2000);
  });

  it('classifies proxy error bodies', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { code: 'proxy-path-blocked' } }, { status: 403 }));
    const client = createProxyClient({ baseUrl: 'https://p.example', fetchImpl });
    const err = await client.request('kis', 'GET', '/x').catch((e) => e);
    expect(err.code).toBe('path-blocked');
    expect(err.status).toBe(403);
    expect(err.retryAfterMs).toBeUndefined();
  });

  it('maps a bare fetch TypeError to proxy-unreachable in the app (proxy down, DNS)', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const client = createProxyClient({ baseUrl: 'https://p.example', fetchImpl });
    const err = await client.request('kis', 'GET', '/x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('proxy-unreachable');
  });

  it('maps fetch TypeError to cors-blocked when asked (diagnostics, after ① proved the proxy is up)', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const client = createProxyClient({ baseUrl: 'https://p.example', fetchImpl, typeErrorCode: 'cors-blocked' });
    const err = await client.request('kis', 'GET', '/x').catch((e) => e);
    expect(err.code).toBe('cors-blocked');
  });

  it('maps navigator.onLine === false to offline without calling fetch', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    const client = createProxyClient({ baseUrl: 'https://p.example', fetchImpl });
    const err = await client.request('kis', 'GET', '/x').catch((e) => e);
    expect(err.code).toBe('offline');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('times out via AbortController', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    ) as unknown as typeof fetch;
    const client = createProxyClient({ baseUrl: 'https://p.example', fetchImpl, timeoutMs: 1000 });
    const pending = client.request('kis', 'GET', '/x').catch((e) => e);
    await vi.advanceTimersByTimeAsync(1000);
    const err = await pending;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('timeout');
  });

  it('never leaks secrets into error messages', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: 'invalid_client', detail: 'SECRET-VALUE' }, { status: 401 }),
    );
    const client = createProxyClient({ baseUrl: 'https://p.example', proxyToken: 'TOKEN-VALUE', fetchImpl });
    const err = await client
      .request('toss', 'POST', '/oauth2/token', {
        query: { k: 'QUERY-SECRET' },
        headers: { appsecret: 'HEADER-SECRET' },
        body: { s: 'BODY-SECRET' },
      })
      .catch((e) => e);
    for (const s of ['SECRET-VALUE', 'TOKEN-VALUE', 'QUERY-SECRET', 'HEADER-SECRET', 'BODY-SECRET']) {
      expect(err.message).not.toContain(s);
    }
  });
});
