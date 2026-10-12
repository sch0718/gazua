import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NODE_LIMITS, createProxyServer } from './server.js';

let server: Server;
let port: number;

beforeAll(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  server = createProxyServer({ ALLOWED_ORIGINS: 'https://a.example' });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.restoreAllMocks();
});

function get(path: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return send(port, 'GET', path, headers);
}

function send(
  to: number,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: string | Buffer,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: to, path, method, headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

describe('node server', () => {
  it('ignores a malformed Host header and keeps serving', async () => {
    const bad = await get('/health', { host: 'a b' });
    expect(bad.status).toBe(200);
    expect(JSON.parse(bad.body)).toEqual({ ok: true, providers: ['kis', 'toss'] });
  });

  it('answers 400 bad-request when the request cannot be converted, and stays alive', async () => {
    const res = await get('//', { host: '127.0.0.1' });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: { code: 'bad-request' } });
    const health = await get('/health', { host: '127.0.0.1' });
    expect(health.status).toBe(200);
  });

  it('rejects a request body over 16 KB with 413 (declared or streamed), and stays alive', async () => {
    const origin = { origin: 'https://a.example', 'content-type': 'application/json' };
    const big = Buffer.alloc(16 * 1024 + 1, 'a');
    const declared = await send(port, 'POST', '/kis/oauth2/tokenP', { ...origin, 'content-length': String(big.length) }, big);
    expect(declared.status).toBe(413);
    expect(JSON.parse(declared.body)).toEqual({ error: { code: 'payload-too-large' } });
    const streamed = await send(port, 'POST', '/kis/oauth2/tokenP', { ...origin, 'transfer-encoding': 'chunked' }, big);
    expect(streamed.status).toBe(413);
    expect((await get('/health', { host: '127.0.0.1' })).status).toBe(200);
  });
});

describe('node server upstream timeout', () => {
  it('answers 504 upstream-timeout when the upstream does not answer in time', async () => {
    const hang = ((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      })) as typeof fetch;
    const slow = createProxyServer({ ALLOWED_ORIGINS: 'https://a.example' }, { fetchImpl: hang, upstreamTimeoutMs: 30 });
    await new Promise<void>((resolve) => slow.listen(0, '127.0.0.1', resolve));
    try {
      const res = await send((slow.address() as AddressInfo).port, 'GET', '/toss/api/v1/prices?symbols=005930', {
        origin: 'https://a.example',
      });
      expect(res.status).toBe(504);
      expect(JSON.parse(res.body)).toEqual({ error: { code: 'upstream-timeout' } });
    } finally {
      await new Promise<void>((resolve) => slow.close(() => resolve()));
    }
  });

  it('uses a 16 KB body cap and a 15 s upstream timeout by default', () => {
    expect(NODE_LIMITS).toEqual({ maxBodyBytes: 16 * 1024, upstreamTimeoutMs: 15_000 });
  });
});
