import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { handle, type ProxyEnv } from '../src/handler.js';

const PORT = 8787;

function toRequest(incoming: IncomingMessage): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(name, v));
    else if (value !== undefined) headers.set(name, value);
  }
  const method = incoming.method ?? 'GET';
  const init: RequestInit & { duplex?: 'half' } = { method, headers };
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = Readable.toWeb(incoming) as unknown as ReadableStream;
    init.duplex = 'half';
  }
  // Host 헤더는 신뢰하지 않고 고정 base로 URL을 만들어요.
  return new Request(new URL(incoming.url ?? '/', 'http://localhost'), init);
}

async function send(res: ServerResponse, response: Response): Promise<void> {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body) res.end(Buffer.from(await response.arrayBuffer()));
  else res.end();
}

export function createProxyServer(env: ProxyEnv): Server {
  return createServer((incoming, res) => {
    const started = Date.now();
    const method = incoming.method ?? 'GET';
    const path = (incoming.url ?? '/').split('?')[0];
    // 로그에는 method path status ms만 남깁니다. 헤더·본문·쿼리는 기록하지 않아요.
    const log = (status: number) => console.log(`${method} ${path} ${status} ${Date.now() - started}ms`);
    const fail = (status: number, code: string) => {
      if (!res.headersSent) res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code } }));
      log(status);
    };
    // toRequest도 프라미스 체인 안에서 실행해 변환 오류가 프로세스를 죽이지 않게 해요.
    Promise.resolve()
      .then(() => toRequest(incoming))
      .then(
        (request) =>
          handle(request, env).then(async (response) => {
            await send(res, response);
            log(response.status);
          }),
        () => fail(400, 'bad-request'),
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
