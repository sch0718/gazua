// 토스 계좌 내역(내 성과): 종료 주문 목록과 보유 수량. 응답 모양은 공식 OpenAPI 1.2.24 명세를 따른다.
// orderId·accountSeq는 지어낸 값이다.
import { describe, expect, it } from 'vitest';
import { createRequestQueue } from '../data/requestQueue';
import { kstEpoch } from '../time/kst';
import { ApiError } from './errors';
import type { ProxyClient, ProxyResponse } from './http';
import { TOSS_QUEUE_RATES, createTossProvider } from './toss';
import type { TokenInfo, TokenStore } from './types';

const NOW = kstEpoch('2026-10-16', '10:00:00');

interface Call {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
}

const ok = (result: unknown) => ({ result });

function setup(routes: Record<string, (c: Call) => unknown>) {
  const calls: Call[] = [];
  const respond = (json: unknown, status = 200): ProxyResponse => ({ status, headers: new Headers(), json });
  const client: ProxyClient = {
    async request(_p, method, path, opts = {}) {
      if (method === 'POST' && path === '/oauth2/token') return respond({ access_token: 'tok', expires_in: 86400 });
      const call = { method, path, query: opts.query ?? {}, headers: opts.headers ?? {} };
      calls.push(call);
      const route = routes[path];
      if (!route) throw new Error(`unrouted ${path}`);
      const out = route(call);
      if (out instanceof ApiError) throw out;
      return respond(out);
    },
  };
  let token: TokenInfo | null = null;
  const tokenStore: TokenStore = { load: () => token, save: (t) => (token = t) };
  const provider = createTossProvider({
    client,
    queue: createRequestQueue({ ratesPerSec: { ...TOSS_QUEUE_RATES }, now: () => 0, sleep: async () => {} }),
    creds: { clientId: 'id', clientSecret: 'secret' },
    tokenStore,
    now: () => NOW,
  });
  return { provider, calls, account: provider.account! };
}

const ACCOUNTS = () =>
  ok([
    { accountNo: '1', accountSeq: 7, accountType: 'PENSION_SAVINGS' },
    { accountNo: '2', accountSeq: 3, accountType: 'BROKERAGE' },
  ]);

function order(id: string, over: Record<string, unknown> = {}, exec: Record<string, unknown> = {}) {
  return {
    orderId: id,
    symbol: '005930',
    side: 'BUY',
    orderType: 'LIMIT',
    timeInForce: 'DAY',
    status: 'FILLED',
    price: '70000',
    quantity: '10',
    orderAmount: null,
    currency: 'KRW',
    orderedAt: '2026-03-28T09:30:00+09:00',
    canceledAt: null,
    ...over,
    execution: {
      filledQuantity: '10',
      averageFilledPrice: '70000',
      filledAmount: '700000',
      commission: '105',
      tax: '0',
      filledAt: '2026-03-28T09:31:15+09:00',
      settlementDate: '2026-03-31',
      ...exec,
    },
  };
}

describe('toss account: closed orders', () => {
  it('pages with cursor, sends the brokerage accountSeq, asks CLOSED with limit 100', async () => {
    const pages: Record<string, unknown> = {
      '': ok({ orders: [order('a1'), order('a2', { side: 'SELL' })], nextCursor: 'c2', hasNext: true }),
      c2: ok({ orders: [order('a3')], nextCursor: null, hasNext: false }),
    };
    const { account, calls } = setup({
      '/api/v1/accounts': ACCOUNTS,
      '/api/v1/orders': (c) => pages[c.query.cursor ?? ''],
    });
    const seen: number[] = [];
    const rows = await account.closedOrders({ onPage: (n) => seen.push(n) });
    expect(rows.map((r) => r.orderId)).toEqual(['a1', 'a2', 'a3']);
    expect(seen).toEqual([2, 3]);
    const orderCalls = calls.filter((c) => c.path === '/api/v1/orders');
    expect(orderCalls.map((c) => c.query)).toEqual([
      { status: 'CLOSED', limit: '100' },
      { status: 'CLOSED', limit: '100', cursor: 'c2' },
    ]);
    for (const c of orderCalls) {
      expect(c.method).toBe('GET');
      expect(c.headers['x-tossinvest-account']).toBe('3');
    }
  });

  it('passes from/to and maps fields to numbers', async () => {
    const { account, calls } = setup({
      '/api/v1/accounts': ACCOUNTS,
      '/api/v1/orders': () => ok({ orders: [order('a1', { side: 'SELL' }, { tax: '1400' })], nextCursor: null, hasNext: false }),
    });
    const rows = await account.closedOrders({ from: '2026-03-01', to: '2026-03-31' });
    expect(calls.find((c) => c.path === '/api/v1/orders')!.query).toEqual({
      status: 'CLOSED',
      limit: '100',
      from: '2026-03-01',
      to: '2026-03-31',
    });
    expect(rows).toEqual([
      {
        orderId: 'a1',
        symbol: '005930',
        side: 'SELL',
        status: 'FILLED',
        currency: 'KRW',
        orderedAt: '2026-03-28T09:30:00+09:00',
        filledAt: '2026-03-28T09:31:15+09:00',
        quantity: 10,
        price: 70000,
        amount: 700000,
        commission: 105,
        tax: 1400,
      },
    ]);
  });

  it('drops unfilled and *_REJECTED rows, fills missing price/amount/fees, keeps unknown statuses and partial cancels', async () => {
    const { account } = setup({
      '/api/v1/accounts': ACCOUNTS,
      '/api/v1/orders': () =>
        ok({
          orders: [
            order('zero', { status: 'CANCELED' }, { filledQuantity: '0', averageFilledPrice: null, filledAmount: null }),
            order('cr', { status: 'CANCEL_REJECTED' }),
            order('rr', { status: 'REPLACE_REJECTED' }),
            order('partial', { status: 'CANCELED' }, { filledQuantity: '3', averageFilledPrice: '70000', filledAmount: '210000' }),
            order('noprice', {}, { averageFilledPrice: null }),
            order('noamount', {}, { filledAmount: null, commission: null, tax: null }),
            order('nothing', {}, { averageFilledPrice: null, filledAmount: null }),
            order('weird', { status: 'SOMETHING_NEW', side: 'HOLD' }),
            order('future', { status: 'SOMETHING_NEW' }),
            { orderId: 'broken' },
          ],
          nextCursor: null,
          hasNext: false,
        }),
    });
    const rows = await account.closedOrders();
    expect(rows.map((r) => [r.orderId, r.status, r.quantity, r.price, r.amount, r.commission, r.tax])).toEqual([
      ['partial', 'CANCELED', 3, 70000, 210000, 105, 0],
      ['noprice', 'FILLED', 10, 70000, 700000, 105, 0],
      ['noamount', 'FILLED', 10, 70000, 700000, 0, 0],
      ['future', 'SOMETHING_NEW', 10, 70000, 700000, 105, 0],
    ]);
  });

  it('stops with upstream when the server repeats a cursor', async () => {
    const { account } = setup({
      '/api/v1/accounts': ACCOUNTS,
      '/api/v1/orders': () => ok({ orders: [order('a1')], nextCursor: 'same', hasNext: true }),
    });
    await expect(account.closedOrders()).rejects.toMatchObject({ code: 'upstream' });
  });

  it('rejects a malformed page', async () => {
    const { account } = setup({ '/api/v1/accounts': ACCOUNTS, '/api/v1/orders': () => ok({ nextCursor: null }) });
    await expect(account.closedOrders()).rejects.toMatchObject({ code: 'upstream' });
  });

  it('passes a blocked proxy path error through', async () => {
    const { account } = setup({
      '/api/v1/accounts': ACCOUNTS,
      '/api/v1/orders': () => new ApiError('proxy-path-blocked', undefined, { status: 403 }),
    });
    await expect(account.closedOrders()).rejects.toMatchObject({ code: 'proxy-path-blocked' });
  });
});

describe('toss account: holdings and id', () => {
  it('returns KR holdings with numeric quantity, and the account id is the accountSeq', async () => {
    const { account, calls } = setup({
      '/api/v1/accounts': ACCOUNTS,
      '/api/v1/holdings': () =>
        ok({
          items: [
            { symbol: '005930', name: '삼성전자', marketCountry: 'KR', currency: 'KRW', quantity: '12' },
            { symbol: 'AAPL', name: '애플', marketCountry: 'US', currency: 'USD', quantity: '3' },
            { symbol: '000660', name: '', marketCountry: 'KR', currency: 'KRW', quantity: 'x' },
          ],
        }),
    });
    expect(await account.holdings()).toEqual([{ symbol: '005930', name: '삼성전자', quantity: 12 }]);
    expect(calls.find((c) => c.path === '/api/v1/holdings')!.headers['x-tossinvest-account']).toBe('3');
    expect(await account.accountId()).toBe('3');
  });

  it('falls back to the first account when there is no brokerage account', async () => {
    const { account } = setup({ '/api/v1/accounts': () => ok([{ accountNo: '1', accountSeq: 9, accountType: 'OTHER' }]) });
    expect(await account.accountId()).toBe('9');
  });

  it('fails with upstream when there is no account', async () => {
    const { account } = setup({ '/api/v1/accounts': () => ok([]) });
    await expect(account.accountId()).rejects.toMatchObject({ code: 'upstream' });
  });
});
