import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createProxyServer } from './server.js';

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
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
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
});
