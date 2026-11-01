import { describe, expect, it, vi } from 'vitest';
import { UPSTREAM } from '../../proxy/src/allowlist';
import { ApiError } from '../../src/lib/providers/errors';
import { createDirectClient } from './direct';

const json = () => new Response('{"ok":1}', { status: 200, headers: { 'content-type': 'application/json' } });
const blocked = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof ApiError ? e.code : 'other';
  }
  return 'no-error';
};

describe('createDirectClient: 프록시와 같은 허용 목록', () => {
  it('토스 주문 생성·KIS 주문 TR 경로·없는 경로는 fetch 없이 path-blocked', async () => {
    const fetchImpl = vi.fn(async () => json());
    const c = createDirectClient(fetchImpl as unknown as typeof fetch);
    expect(await blocked(c.request('toss', 'POST', '/api/v1/orders', { body: { symbol: '005930' } }))).toBe('path-blocked');
    expect(await blocked(c.request('kis', 'POST', '/uapi/domestic-stock/v1/trading/order-cash', { body: {} }))).toBe('path-blocked');
    expect(await blocked(c.request('kis', 'GET', '/uapi/domestic-stock/v1/trading/inquire-balance'))).toBe('path-blocked');
    expect(await blocked(c.request('toss', 'GET', '/api/v1/unknown'))).toBe('path-blocked');
    expect(await blocked(c.request('toss', 'GET', '/api/v1/prices?symbols=005930'))).toBe('path-blocked');
    expect(await blocked(c.request('toss', 'POST', '/api/v1/prices'))).toBe('path-blocked');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('허용 경로는 UPSTREAM 주소로 보낸다(쿼리 포함)', async () => {
    const fetchImpl = vi.fn(async () => json());
    const c = createDirectClient(fetchImpl as unknown as typeof fetch);
    await c.request('toss', 'GET', '/api/v1/prices', { query: { symbols: '005930' } });
    await c.request('toss', 'GET', '/api/v1/orders', { query: { status: 'CLOSED' } });
    await c.request('kis', 'POST', '/oauth2/tokenP', { body: { grant_type: 'client_credentials' } });
    const urls = fetchImpl.mock.calls.map((x) => String((x as unknown as [string])[0]));
    expect(urls).toEqual([
      `${UPSTREAM.toss}/api/v1/prices?symbols=005930`,
      `${UPSTREAM.toss}/api/v1/orders?status=CLOSED`,
      `${UPSTREAM.kis}/oauth2/tokenP`,
    ]);
  });

  it('리다이렉트는 따라가지 않는다(proxy-redirect)', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://evil.example' } }));
    const c = createDirectClient(fetchImpl as unknown as typeof fetch);
    expect(await blocked(c.request('toss', 'GET', '/api/v1/prices'))).toBe('proxy-redirect');
    expect(fetchImpl).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ redirect: 'manual' }));
  });
});
