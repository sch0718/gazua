import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { DATES, mkFile, mkStock, offCriteria } from '../../src/lib/screen/testData';
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
    let answered = false;
    const req = request({ host: '127.0.0.1', port: to, path, method, headers }, (res) => {
      answered = true;
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    // 큰 본문은 서버가 413을 준 뒤 연결을 닫아 남은 쓰기가 끊길 수 있다. 응답을 받았으면 그 응답으로 판정한다
    req.on('error', (e) => {
      if (!answered) reject(e);
    });
    req.end(body);
  });
}

describe('node server', () => {
  it('ignores a malformed Host header and keeps serving', async () => {
    const bad = await get('/health', { host: 'a b' });
    expect(bad.status).toBe(200);
    expect(JSON.parse(bad.body)).toEqual({ ok: true, providers: ['kis', 'toss'], originAllowed: false });
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


describe('시장 본문 제한', () => {
  it('정상 screen 요청은 16 KB를 넘어도 받고 1 MiB를 넘으면 거절하며 다른 경로는 16 KB를 유지한다', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gazua-body-'));
    const data = mkFile([mkStock('000001', Array(10).fill(100))], 10);
    await writeFile(join(directory, 'market-data-20261112.json.gz'), gzipSync(JSON.stringify(data)));
    const large = createProxyServer({ ALLOWED_ORIGINS: 'https://a.example', PROXY_TOKEN: 'test-token' }, {
      marketDataDir: directory, orderEnv: { ORDER_AUDIT_LOG: join(directory, 'orders.jsonl'), ORDER_STOP_FILE: join(directory, 'stop') },
      fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new Error('가짜 fetch에 없는 경로예요')),
    });
    await new Promise<void>((resolve) => large.listen(0, '127.0.0.1', resolve));
    try {
      const to = (large.address() as AddressInfo).port;
      const headers = { origin: 'https://a.example', 'x-proxy-token': 'test-token', 'content-type': 'application/json' };
      const criteria = offCriteria();
      criteria.period = { from: DATES[1], to: DATES[9] };
      criteria.name = '가'.repeat(8000);
      const body = JSON.stringify({ type: 'preview', id: 3, input: { criteria, strategies: [] } });
      expect(Buffer.byteLength(body)).toBeGreaterThan(16 * 1024);
      const accepted = await send(to, 'POST', '/market/screen', headers, body);
      expect(accepted.status).toBe(200);
      expect(JSON.parse(accepted.body)).toMatchObject({ type: 'preview', id: 3 });
      // 선언된 길이로 거절할 때는 서버가 본문을 읽지 않고 닫으므로 본문을 조금만 보낸다(남은 쓰기가 EPIPE로 끊기지 않게)
      for (const [encoding, payload] of [
        [{ 'content-length': String(1024 * 1024 + 1) }, Buffer.from('a')],
        [{ 'transfer-encoding': 'chunked' }, Buffer.alloc(1024 * 1024 + 1, 'a')],
      ] as const) {
        const rejected = await send(to, 'POST', '/market/screen', { ...headers, ...encoding }, payload);
        expect(rejected.status).toBe(413);
        expect(JSON.parse(rejected.body)).toEqual({ error: { code: 'payload-too-large' } });
      }
      for (const path of ['/kis/oauth2/tokenP', '/market/other', '/market/screen/extra']) {
        expect((await send(to, 'POST', path, headers, body)).status).toBe(413);
      }
    } finally {
      await new Promise<void>((resolve) => large.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('서버 토큰이 없으면 두 시장 경로에 처리기를 붙이지 않는다', async () => {
    const headers = { origin: 'https://a.example' };
    expect(JSON.parse((await get('/market/meta', headers)).body)).toEqual({ error: { code: 'market-unavailable' } });
    expect(JSON.parse((await send(port, 'POST', '/market/screen', headers, '{}')).body)).toEqual({ error: { code: 'market-unavailable' } });
  });
});

describe('서버 주문 처리기', () => {
  it('서버 토큰이 있으면 주문 상태 처리기를 주입하고 없으면 404다', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gazua-server-order-'));
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('실제 API는 부르지 않아요'));
    const orders = createProxyServer({ ALLOWED_ORIGINS: 'https://a.example', PROXY_TOKEN: 'fake-token' }, {
      marketDataDir: directory, fetchImpl, now: () => Date.parse('2026-11-12T10:00:00+09:00'),
      orderEnv: { ORDER_ENABLED: 'true', ORDER_MAX_AMOUNT: '100', ORDER_AUDIT_LOG: join(directory, 'orders.jsonl'), ORDER_STOP_FILE: join(directory, 'stop') },
    });
    try {
      await new Promise<void>((resolve, reject) => { orders.once('error', reject); orders.listen(0, '127.0.0.1', resolve); });
      const headers = { origin: 'https://a.example', 'x-proxy-token': 'fake-token' };
      const status = await send((orders.address() as AddressInfo).port, 'GET', '/order/status', headers);
      expect(status.status).toBe(200);
      expect(JSON.parse(status.body)).toMatchObject({ maxAmount: 100 });
      const unavailable = await get('/order/status', headers);
      expect(unavailable.status).toBe(404);
      expect(JSON.parse(unavailable.body)).toEqual({ error: { code: 'order-unavailable' } });
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      if (orders.listening) await new Promise<void>((resolve) => orders.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  });
});
