import { ApiError, classify } from './errors';

export type ProxyProvider = 'kis' | 'toss';

export interface ProxyRequestOptions {
  query?: Record<string, string>;
  headers?: Record<string, string>;
  /** Plain object → JSON; URLSearchParams → form-urlencoded. */
  body?: unknown;
}

export interface ProxyResponse {
  status: number;
  headers: Headers;
  json: unknown;
}

export interface ProxyClient {
  request(
    provider: ProxyProvider,
    method: 'GET' | 'POST',
    path: string,
    opts?: ProxyRequestOptions,
  ): Promise<ProxyResponse>;
}

export interface ProxyClientConfig {
  baseUrl: string;
  proxyToken?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /**
   * fetch가 TypeError로 실패할 때의 코드. 앱에서는 프록시가 꺼졌거나 주소를 못 찾는 경우가 대부분이라
   * 기본은 proxy-unreachable이다. CORS 판정은 연결 진단(① no-cors로 프록시 생존을 확인한 뒤)이 한다.
   */
  typeErrorCode?: 'proxy-unreachable' | 'cors-blocked';
}

const DEFAULT_TIMEOUT_MS = 8000;

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function isAbort(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';
}

function retryAfterMs(headers: Headers): number | undefined {
  const raw = headers.get('retry-after');
  if (raw === null) return undefined;
  const seconds = Number.parseFloat(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : undefined;
}

/** `redirect: 'manual'`의 결과(opaqueredirect, status 0) 또는 읽을 수 있는 3xx. */
export function isRedirect(res: Response): boolean {
  return res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400);
}

async function readJson(res: Response): Promise<unknown> {
  const type = res.headers.get('content-type') ?? '';
  if (!/json/i.test(type)) return null;
  try {
    return JSON.parse(await res.text());
  } catch {
    return null;
  }
}

export function createProxyClient(cfg: ProxyClientConfig): ProxyClient {
  const base = cfg.baseUrl.replace(/\/+$/, '');
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async request(provider, method, path, opts = {}) {
      if (isOffline()) throw new ApiError('offline');

      const search = opts.query ? new URLSearchParams(opts.query).toString() : '';
      const url = `${base}/${provider}${path}${search ? `?${search}` : ''}`;

      const headers = new Headers(opts.headers);
      if (cfg.proxyToken) headers.set('x-proxy-token', cfg.proxyToken);

      let body: BodyInit | undefined;
      if (opts.body instanceof URLSearchParams) {
        headers.set('content-type', 'application/x-www-form-urlencoded');
        body = opts.body.toString();
      } else if (opts.body !== undefined) {
        headers.set('content-type', 'application/json; charset=utf-8');
        body = JSON.stringify(opts.body);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let res: Response;
        let json: unknown;
        try {
          // 리다이렉트는 따라가지 않는다: 다른 출처로 가면 증권사 키·프록시 토큰·토큰 발급 본문이 그대로 넘어간다.
          res = await (cfg.fetchImpl ?? fetch)(url, { method, headers, body, signal: controller.signal, redirect: 'manual' });
          if (isRedirect(res)) throw new ApiError('proxy-redirect');
          json = await readJson(res);
        } catch (e) {
          if (e instanceof ApiError) throw e;
          if (isAbort(e) || controller.signal.aborted) throw new ApiError('timeout');
          if (e instanceof TypeError) throw new ApiError(cfg.typeErrorCode ?? 'proxy-unreachable');
          throw new ApiError('proxy-unreachable');
        }
        if (res.status < 200 || res.status >= 300) {
          throw new ApiError(classify(res.status, json, provider), undefined, {
            status: res.status,
            retryAfterMs: retryAfterMs(res.headers),
          });
        }
        return { status: res.status, headers: res.headers, json };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
