import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
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
  return new Request(`http://${incoming.headers.host ?? 'localhost'}${incoming.url ?? '/'}`, init);
}

async function send(res: ServerResponse, response: Response): Promise<void> {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body) res.end(Buffer.from(await response.arrayBuffer()));
  else res.end();
}

const env: ProxyEnv = {
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS ?? '',
  PROXY_TOKEN: process.env.PROXY_TOKEN || undefined,
};

const server = createServer((incoming, res) => {
  const started = Date.now();
  const method = incoming.method ?? 'GET';
  const path = (incoming.url ?? '/').split('?')[0];
  // 로그에는 method path status ms만 남깁니다. 헤더·본문·쿼리는 기록하지 않아요.
  const log = (status: number) => console.log(`${method} ${path} ${status} ${Date.now() - started}ms`);
  handle(toRequest(incoming), env)
    .then(async (response) => {
      await send(res, response);
      log(response.status);
    })
    .catch(() => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end('{"error":{"code":"proxy-internal-error"}}');
      log(500);
    });
});

server.listen(PORT, () => console.log(`gazua proxy listening on :${PORT}`));
