// 토스에서 관심그룹 재료 가져오기(보유 주식·섹터). 응답 모양은 공식 OpenAPI 1.2.24 명세를 따른다.
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
  return { provider, calls, source: provider.groupImport! };
}

const holding = (symbol: string, name: string, marketCountry: string, amount: string) => ({
  symbol,
  name,
  marketCountry,
  currency: marketCountry === 'KR' ? 'KRW' : 'USD',
  quantity: '1',
  lastPrice: '1',
  averagePurchasePrice: '1',
  marketValue: { purchaseAmount: '1', amount, amountAfterCost: amount },
});

describe('toss group import: holdings', () => {
  it('reads the brokerage account, sends its accountSeq as X-Tossinvest-Account, keeps KR only by market value', async () => {
    const { source, calls } = setup({
      '/api/v1/accounts': () =>
        ok([
          { accountNo: '1', accountSeq: 7, accountType: 'PENSION_SAVINGS' },
          { accountNo: '2', accountSeq: 3, accountType: 'BROKERAGE' },
        ]),
      '/api/v1/holdings': () =>
        ok({
          items: [
            holding('005930', '삼성전자', 'KR', '1000000'),
            holding('AAPL', '애플', 'US', '9000000'),
            holding('000660', 'SK하이닉스', 'KR', '3000000'),
            holding('500023', '신한 콩 선물 ETN(H)', 'KR', 'x'),
          ],
        }),
    });
    expect(await source.holdings()).toEqual([
      { symbol: '000660', name: 'SK하이닉스' },
      { symbol: '005930', name: '삼성전자' },
      { symbol: '500023', name: '신한 콩 선물 ETN(H)' },
    ]);
    const h = calls.find((c) => c.path === '/api/v1/holdings')!;
    expect(h.method).toBe('GET');
    expect(h.headers['x-tossinvest-account']).toBe('3');
    expect(h.headers.authorization).toBe('Bearer tok');
  });

  it('fails with a clear upstream error when there is no account', async () => {
    const { source } = setup({ '/api/v1/accounts': () => ok([]) });
    await expect(source.holdings()).rejects.toMatchObject({ code: 'upstream', message: 'Toss has no brokerage account' });
  });
});

describe('toss group import: sectors', () => {
  it('lists sectors with their full path', async () => {
    const { source } = setup({
      '/api/v1/sectors': () =>
        ok({
          sectors: [
            { sectorId: '1', name: 'IT', depth: 0, parentSectorId: null },
            { sectorId: '10', name: '반도체', depth: 1, parentSectorId: '1' },
            { sectorId: '100', name: '메모리', depth: 2, parentSectorId: '10' },
          ],
        }),
    });
    expect(await source.sectors()).toEqual([
      { id: '1', name: 'IT', path: 'IT' },
      { id: '10', name: '반도체', path: 'IT › 반도체' },
      { id: '100', name: '메모리', path: 'IT › 반도체 › 메모리' },
    ]);
  });

  it('reads KR stocks of a sector in the order given (market cap, descending)', async () => {
    const { source, calls } = setup({
      '/api/v1/sectors/10/stocks': () =>
        ok({
          stocks: [
            { symbol: '005930', name: '삼성전자', marketCapitalization: '1', currency: 'KRW' },
            { symbol: '000660', name: 'SK하이닉스', marketCapitalization: '1', currency: 'KRW' },
          ],
        }),
    });
    expect(await source.sectorStocks('10')).toEqual([
      { symbol: '005930', name: '삼성전자' },
      { symbol: '000660', name: 'SK하이닉스' },
    ]);
    expect(calls[0].query).toEqual({ marketCountry: 'KR' });
  });

  it('rejects a sector id the proxy would not pass, without a request', async () => {
    const { source, calls } = setup({});
    await expect(source.sectorStocks('../orders')).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});
