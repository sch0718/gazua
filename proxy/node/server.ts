import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import { handle, type ProxyEnv } from '../src/handler.js';

const PORT = 8787;

/**
 * 집 NAS 컨테이너용 제한. 본문은 토큰 발급 POST에만 필요해 작게 두고(16 KB, 넘으면 413),
 * 상류가 15초 안에 답하지 않으면 504로 끊어요. Origin은 브라우저 밖에서 위조될 수 있어 서버에서 막아요.
 */
export const NODE_LIMITS = { maxBodyBytes: 16 * 1024, upstreamTimeoutMs: 15_000 };

export interface ServerOptions {
  maxBodyBytes?: number;
  upstreamTimeoutMs?: number;
  /** 테스트용 */
  fetchImpl?: typeof fetch;
}

class PayloadTooLarge extends Error {}

/** 본문을 최대 max 바이트까지만 읽어요. 선언된 길이나 실제로 받은 길이가 넘으면 PayloadTooLarge. */
async function readBody(incoming: IncomingMessage, max: number): Promise<Buffer> {
  const declared = Number(incoming.headers['content-length']);
  if (Number.isFinite(declared) && declared > max) throw new PayloadTooLarge();
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of incoming as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > max) throw new PayloadTooLarge();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function toRequest(incoming: IncomingMessage, maxBodyBytes: number): Promise<Request> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(name, v));
    else if (value !== undefined) headers.set(name, value);
  }
  const method = incoming.method ?? 'GET';
  const init: RequestInit = { method, headers };
  if (method !== 'GET' && method !== 'HEAD') init.body = await readBody(incoming, maxBodyBytes);
  // Host 헤더는 신뢰하지 않고 고정 base로 URL을 만들어요.
  return new Request(new URL(incoming.url ?? '/', 'http://localhost'), init);
}

async function send(res: ServerResponse, response: Response): Promise<void> {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body) res.end(Buffer.from(await response.arrayBuffer()));
  else res.end();
}

export function createProxyServer(env: ProxyEnv, opts: ServerOptions = {}): Server {
  const maxBodyBytes = opts.maxBodyBytes ?? NODE_LIMITS.maxBodyBytes;
  const upstreamTimeoutMs = opts.upstreamTimeoutMs ?? NODE_LIMITS.upstreamTimeoutMs;
  const fetchImpl = opts.fetchImpl ?? fetch;
  return createServer((incoming, res) => {
    const started = Date.now();
    const method = incoming.method ?? 'GET';
    const path = (incoming.url ?? '/').split('?')[0];
    // 로그에는 method path status ms만 남깁니다. 헤더·본문·쿼리는 기록하지 않아요.
    const log = (status: number) => console.log(`${method} ${path} ${status} ${Date.now() - started}ms`);
    const fail = (status: number, code: string, extra: Record<string, string> = {}) => {
      if (!res.headersSent) res.writeHead(status, { 'content-type': 'application/json', ...extra });
      res.end(JSON.stringify({ error: { code } }));
      log(status);
    };
    // toRequest도 프라미스 체인 안에서 실행해 변환 오류가 프로세스를 죽이지 않게 해요.
    Promise.resolve()
      .then(() => toRequest(incoming, maxBodyBytes))
      .then(
        (request) =>
          handle(request, env, fetchImpl, { upstreamTimeoutMs }).then(async (response) => {
            await send(res, response);
            log(response.status);
          }),
        (e: unknown) => {
          if (!(e instanceof PayloadTooLarge)) return fail(400, 'bad-request');
          // 남은 본문은 쌓지 않고 버리며, 응답 뒤 연결을 닫아요.
          incoming.resume();
          fail(413, 'payload-too-large', { connection: 'close' });
        },
      )
      .catch(() => fail(500, 'proxy-internal-error'));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env: ProxyEnv = {
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS ?? '',
    PROXY_TOKEN: process.env.PROXY_TOKEN || undefined,
  };
  createProxyServer(env).listen(PORT, () => console.log(`gazua proxy listening on :${PORT}`));
}
