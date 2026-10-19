import { isAllowed, isProvider, UPSTREAM } from './allowlist.js';

export { UPSTREAM };

export interface ProxyEnv {
  ALLOWED_ORIGINS: string; // comma separated, exact match
  PROXY_TOKEN?: string;
}

const ALLOW_HEADERS = 'authorization, appkey, appsecret, tr_id, tr_cont, custtype, content-type, x-proxy-token, x-tossinvest-account';
const EXPOSE_HEADERS = 'retry-after, x-ratelimit-remaining, tr_cont';
// x-tossinvest-account: 토스 보유 주식 조회에 쓰는 계좌 식별 키(accountSeq).
const FORWARD_REQUEST_HEADERS = ['authorization', 'content-type', 'appkey', 'appsecret', 'tr_id', 'tr_cont', 'custtype', 'x-tossinvest-account'];
const RETURN_RESPONSE_HEADERS = ['content-type', 'retry-after', 'x-ratelimit-remaining', 'tr_cont'];

function allowedOrigins(env: ProxyEnv): string[] {
  return (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function corsHeaders(origin: string): Headers {
  const h = new Headers();
  h.set('access-control-allow-origin', origin);
  h.set('vary', 'Origin');
  return h;
}

function errorResponse(status: number, code: string, origin: string | null): Response {
  const headers = origin ? corsHeaders(origin) : new Headers();
  headers.set('content-type', 'application/json');
  if (origin) headers.set('access-control-expose-headers', EXPOSE_HEADERS);
  return new Response(JSON.stringify({ error: { code } }), { status, headers });
}

/** 토큰 비교: SHA-256 해시(고정 길이) 둘을 XOR 누적으로 끝까지 비교해 달라지는 위치가 시간에 드러나지 않게 한다. */
export async function tokenMatches(given: string | null, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(given ?? '')),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = given === null ? 1 : 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export interface HandleOptions {
  /** 상류 응답을 기다리는 최대 시간. 넘으면 504 upstream-timeout. 없으면 기다린다(Worker는 플랫폼 제한을 따른다). */
  upstreamTimeoutMs?: number;
}

export async function handle(
  req: Request,
  env: ProxyEnv,
  fetchImpl: typeof fetch = fetch,
  opts: HandleOptions = {},
): Promise<Response> {
  const url = new URL(req.url);
  const origin = req.headers.get('origin');
  const originAllowed = origin !== null && allowedOrigins(env).includes(origin);

  if (url.pathname === '/health') {
    // 비밀값이 없는 응답이라 어느 출처에서나 읽게 한다. 앱 진단은 이걸로 "프록시까지 닿지 않음(터널 끊김)"과
    // "이 출처를 허용하지 않음"을 구분한다. 다른 경로는 그대로 허용한 출처만 받는다.
    const headers = originAllowed ? corsHeaders(origin) : new Headers({ 'access-control-allow-origin': '*' });
    headers.set('content-type', 'application/json');
    return new Response(JSON.stringify({ ok: true, providers: ['kis', 'toss'], originAllowed }), { status: 200, headers });
  }

  if (!originAllowed) return errorResponse(403, 'origin-not-allowed', null);

  if (req.method === 'OPTIONS') {
    const headers = corsHeaders(origin);
    headers.set('access-control-allow-methods', 'GET, POST, OPTIONS');
    headers.set('access-control-allow-headers', ALLOW_HEADERS);
    headers.set('access-control-max-age', '600');
    return new Response(null, { status: 204, headers });
  }

  if (env.PROXY_TOKEN && !(await tokenMatches(req.headers.get('x-proxy-token'), env.PROXY_TOKEN))) {
    return errorResponse(401, 'proxy-token-invalid', origin);
  }

  const [, provider, ...rest] = url.pathname.split('/');
  const upstreamPath = '/' + rest.join('/');
  if (!isProvider(provider) || !isAllowed(provider, upstreamPath, req.method)) {
    return errorResponse(403, 'proxy-path-blocked', origin);
  }

  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = req.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const init: RequestInit = { method: req.method, headers, redirect: 'manual' };
  if (req.method === 'POST') init.body = await req.arrayBuffer();
  if (opts.upstreamTimeoutMs !== undefined) init.signal = AbortSignal.timeout(opts.upstreamTimeoutMs);

  let upstream: Response;
  try {
    upstream = await fetchImpl(`${UPSTREAM[provider]}${upstreamPath}${url.search}`, init);
  } catch {
    if (init.signal?.aborted) return errorResponse(504, 'upstream-timeout', origin);
    return errorResponse(502, 'upstream-unreachable', origin);
  }

  const out = corsHeaders(origin);
  out.set('access-control-expose-headers', EXPOSE_HEADERS);
  for (const name of RETURN_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) out.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
