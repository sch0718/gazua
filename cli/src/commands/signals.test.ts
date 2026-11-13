import { afterEach, describe, expect, it } from 'vitest';
import type { MarketDataProvider } from '../../../src/lib/providers/types';
import { ApiError } from '../../../src/lib/providers/errors';
import { fullStrategyV2 } from '../../../src/lib/sim/testStrategyV2';
import { barsFromCloses, tradingDates } from '../../../src/lib/sim/testBars';
import { addDays, kstDate } from '../../../src/lib/time/kst';
import { writeAuth } from '../config';
import { COMMANDS, run } from '../main';
import type { Built } from '../providers';
import { cleanupDirs, fakeFetch, makeIo, profileDoc, syncServer } from '../testing';
import { makeSignals } from './signals';

afterEach(() => {
  cleanupDirs();
});

const AUTH = { v: 1 as const, server: 'https://sync.example', token: `gzc_${'A'.repeat(43)}`, tokenId: 't1', label: 'gazua@mac', expiresAt: Date.UTC(2027, 0, 1) };
const ENV = { TOSS_CLIENT_ID: 'toss-client-id-1', TOSS_CLIENT_SECRET: 'toss-client-secret-1' };

function simpleDoc() {
  const d = profileDoc(2) as { strategies: ReturnType<typeof fullStrategyV2>[] };
  const s = d.strategies[0];
  s.rules.buy = [{ conds: [{ kind: 'maPrice', period: 3, side: 'above' }] }];
  s.rules.sell.signal = { on: false, groups: [] };
  return d;
}
const provider = (): MarketDataProvider =>
  ({
    id: 'kis',
    capabilities: { venues: ['KRX'], quoteBatchSize: 1, hasIndexCandles: false, indexMinutePastDays: false },
    getCandles: async (q: { symbol: string; from: string; to: string }) => barsFromCloses([10, 10, 10, 12], '2026-10-27').filter((c) => kstDate(c.t) >= q.from && kstDate(c.t) <= q.to),
    getTradingDays: async () => [],
  }) as unknown as MarketDataProvider;
const built: Built = { id: 'kis', provider: provider(), keyHash: 'kh' };

function setup(argv: string[], env: Record<string, string> = ENV, profiles: Parameters<typeof syncServer>[0] = { p1: { doc: simpleDoc() } }) {
  const t = makeIo({ fetch: syncServer(profiles), env });
  writeAuth(t.dir, AUTH);
  COMMANDS.signals = makeSignals(() => built);
  return { t, argv };
}

describe('gazua signals', () => {
  it('--strategy가 없으면 invalid-args(종료 2)', async () => {
    const { t } = setup(['signals']);
    expect(await run(['signals'], t.io)).toBe(2);
    expect(t.result().error.code).toBe('invalid-args');
  });

  it('전략을 이름으로 찾아 전략 종목(그룹 g0: 005930·000660)의 신호를 낸다', async () => {
    const { t } = setup([]);
    expect(await run(['signals', '--strategy', '골든크로스 추세'], t.io)).toBe(0);
    const d = t.result().data;
    expect(d).toMatchObject({ strategy: '골든크로스 추세', asOf: '2026-10-30', includesToday: false, venue: 'KRX', failed: [] });
    expect(d.signals.map((s: { symbol: string }) => s.symbol)).toEqual(['005930', '000660']);
    expect(d.signals[0]).toEqual({ symbol: '005930', buy: { match: true, reason: '종가 3일선 위', group: 1 }, sell: null });
    expect('holdings' in d).toBe(false);
    expect(d.notes).toContain('보유 기준 판정은 토스만 돼요');
  });

  it('없는 전략은 strategy-not-found', async () => {
    const { t } = setup([]);
    expect(await run(['signals', '--strategy', '없는 전략'], t.io)).toBe(1);
    expect(t.result().error.code).toBe('strategy-not-found');
  });

  it('첫 매수가 600거래일 전이어도 signals 명령은 성공하고 기간 청산에 도달한다', async () => {
    const { t } = setup([]);
    const dates = tradingDates('2024-01-02', 1000).filter((d) => d <= '2026-10-30');
    const first = dates[dates.length - 601];
    const toss: MarketDataProvider = {
      ...provider(),
      id: 'toss',
      async getTradingDays(from, to) {
        const open = dates.filter((d) => d >= from && d <= to);
        if (open.length > 500) throw new ApiError('upstream', 'Toss calendar needed too many requests');
        const days = [];
        for (let d = from; d <= to; d = addDays(d, 1)) days.push({ date: d, isOpen: open.includes(d) });
        return days;
      },
      account: {
        accountId: async () => 'test-account',
        holdings: async () => [{ symbol: '005930', name: '삼성전자', quantity: 10, avgPrice: 10 }],
        closedOrders: async () => [{ orderId: 'old-buy', symbol: '005930', side: 'BUY', status: 'FILLED', currency: 'KRW', orderedAt: `${first}T09:30:00+09:00`, filledAt: `${first}T09:30:05+09:00`, quantity: 10, price: 10, amount: 100, commission: 0, tax: 0 }],
      },
    };
    COMMANDS.signals = makeSignals(() => ({ id: 'toss', provider: toss, keyHash: 'old-holding' }));
    expect(await run(['signals', '--strategy', '골든크로스 추세'], t.io)).toBe(0);
    expect(t.result()).toMatchObject({ ok: true, data: { failed: [], holdings: [{ firstBuyDate: first, timeExit: { heldDays: 21, days: 20, hit: true } }] } });
  });

  it('프로필이 여럿이면 profile-required, --profile로 고른다', async () => {
    const two = { p1: { doc: simpleDoc() }, p2: { doc: { ...simpleDoc(), name: '회사' } } };
    const a = setup([], ENV, two);
    await run(['signals', '--strategy', '골든크로스 추세'], a.t.io);
    expect(a.t.result().error.code).toBe('profile-required');
    const b = setup([], ENV, two);
    expect(await run(['signals', '--strategy', '골든크로스 추세', '--profile', '회사'], b.t.io)).toBe(0);
  });

  it('실제 공급자를 쓰는 기본 명령은 키가 없으면 no-credentials', async () => {
    const t = makeIo({ fetch: syncServer({ p1: { doc: simpleDoc() } }) });
    writeAuth(t.dir, AUTH);
    COMMANDS.signals = makeSignals();
    expect(await run(['signals', '--strategy', '골든크로스 추세'], t.io)).toBe(1);
    expect(t.result().error.code).toBe('no-credentials');
  });

  it('signals는 등록돼 있다', async () => {
    expect(COMMANDS.signals).toBeTypeOf('function');
  });
});


describe('signals 실제 프록시 공급자 진입점', () => {
  it.each(['managed', 'unmanaged', 'missing', 'kis'])('키 없이 %s 설정의 결과를 확인한다', { timeout: 15000 }, async (mode) => {
    const profile = simpleDoc();
    const sync = syncServer({ p1: { doc: profile } });
    const env = mode === 'missing' ? {} : { GAZUA_PROXY_URL: 'https://proxy.example', GAZUA_PROXY_TOKEN: 'test-proxy-token', GAZUA_PROXY_ORIGIN: 'https://app.example' };
    const f = fakeFetch(async (call) => {
      if (call.url.origin === AUTH.server) {
        const response = await sync(call.url, { headers: call.headers });
        return { status: response.status, body: await response.json() };
      }
      if (call.url.pathname === '/health') return { body: { ok: true, tossToken: mode === 'managed' } };
      if (call.url.pathname === '/toss/api/v1/accounts') return { body: { result: [{ accountType: 'BROKERAGE', accountSeq: 'test-account' }] } };
      if (call.url.pathname === '/toss/api/v1/holdings') return { body: { result: { items: [] } } };
      if (call.url.pathname === '/toss/api/v1/stocks') return { body: { result: ['005930', '000660'].map((symbol) => ({ symbol, name: symbol, market: 'KOSPI', securityType: 'STOCK' })) } };
      if (call.url.pathname.includes('/candles')) {
        const bars = barsFromCloses([10, 10, 10, 12], '2026-10-27');
        return { body: { result: { candles: bars.map((bar) => ({ timestamp: `${kstDate(bar.t)}T00:00:00+09:00`, openPrice: String(bar.o), highPrice: String(bar.h), lowPrice: String(bar.l), closePrice: String(bar.c), volume: '1000' })), nextBefore: null } } };
      }
    });
    const t = makeIo({ fetch: f, env });
    writeAuth(t.dir, AUTH);
    COMMANDS.signals = makeSignals();
    expect(await run(['signals', '--strategy', '골든크로스 추세', ...(mode === 'kis' ? ['--provider', 'kis'] : [])], t.io)).toBe(mode === 'managed' ? 0 : 1);
    if (mode !== 'managed') {
      expect(t.result().error.code).toBe(mode === 'unmanaged' ? 'invalid-credentials' : 'no-credentials');
      return;
    }
    expect(t.result().data.signals.length).toBeGreaterThan(0);
    const calls = f.calls.filter((call) => call.url.origin !== AUTH.server && call.url.pathname !== '/health');
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.url.origin).toBe('https://proxy.example');
      expect(call.url.pathname).toMatch(/^\/toss\/api\//);
      expect(call.headers.get('origin')).toBe('https://app.example');
      expect(call.headers.get('x-proxy-token')).toBe('test-proxy-token');
      expect(call.headers.has('authorization')).toBe(false);
    }
    expect(f.calls.some((call) => call.url.pathname.includes('/oauth2/'))).toBe(false);
  });
});
