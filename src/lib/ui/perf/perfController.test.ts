import { describe, expect, it, vi } from 'vitest';
import { createMemoryOrderCache } from '../../perf/orderCache';
import { createDemoProvider } from '../../providers/demo';
import { ApiError } from '../../providers/errors';
import type { MarketDataProvider } from '../../providers/types';
import { kstEpoch } from '../../time/kst';
import { createPerfController, type PerfState } from './perfController.svelte';

const NOW = kstEpoch('2026-10-16', '10:00:00');

function setup(over: (base: MarketDataProvider) => Partial<MarketDataProvider> = () => ({})) {
  const base = createDemoProvider({ seed: 1, now: () => NOW });
  const calls: string[] = [];
  const provider: MarketDataProvider = {
    ...base,
    getCandles: async (q) => {
      calls.push(q.symbol);
      return base.getCandles(q);
    },
    getIndexCandles: async (...a) => {
      calls.push(`INDEX:${a[0]}`);
      return base.getIndexCandles!(...a);
    },
    ...over(base),
  };
  const orderCache = createMemoryOrderCache();
  const app = { provider, orderCache, profileId: 'p1' };
  const ctl = createPerfController(app, { now: () => NOW });
  return { ctl, calls, orderCache, app };
}

const done = async (ctl: { readonly state: PerfState }) => {
  await vi.waitFor(() => expect(['done', 'error', 'empty', 'unsupported']).toContain(ctl.state.kind));
  return ctl.state;
};

describe('perfController', () => {
  it('is unsupported without an account source', async () => {
    const { ctl } = setup(() => ({ account: undefined }));
    ctl.load('AUTO');
    expect((await done(ctl)).kind).toBe('unsupported');
  });

  it('loads orders, then prices (each stock and the two indexes for auto), and reconciles holdings', async () => {
    const { ctl, calls } = setup();
    const seen: string[] = [];
    ctl.load('AUTO');
    seen.push(ctl.state.kind === 'loading' ? ctl.state.stage : ctl.state.kind);
    const s = await done(ctl);
    if (s.kind !== 'done') throw new Error(s.kind);
    expect(seen).toEqual(['orders']);
    expect(s.data.demo).toBe(true);
    expect(s.data.trades).toHaveLength(14);
    expect(s.data.foreign).toBe(1);
    expect([...s.data.stocks.keys()].sort()).toEqual(['000660', '000990', '005930', '042700']);
    expect([...s.data.series.keys()].sort()).toEqual(['KOSDAQ', 'KOSPI']);
    expect(calls.filter((c) => c.startsWith('INDEX:')).sort()).toEqual(['INDEX:KOSDAQ', 'INDEX:KOSPI']);
    expect(s.data.reconcile.mismatches).toBe(1);
    expect(s.data.reconcile.bySymbol.get('042700')?.status).toBe('more');
    expect(s.data.syncedAt).toBe(NOW);
  });

  it('fetches an ETF only when it is chosen, once', async () => {
    const { ctl, calls } = setup();
    ctl.load('AUTO');
    await done(ctl);
    expect(calls).not.toContain('069500');
    ctl.useBench('069500');
    await vi.waitFor(() => expect(ctl.state.kind === 'done' && ctl.state.data.series.has('069500')).toBe(true));
    ctl.useBench('KOSPI');
    ctl.useBench('069500');
    expect(calls.filter((c) => c === '069500')).toHaveLength(1);
  });

  it('marks a benchmark it could not fetch as failed and keeps going', async () => {
    const { ctl } = setup((base) => ({
      getCandles: async (q) => {
        if (q.symbol === '229200') throw new ApiError('timeout');
        return base.getCandles(q);
      },
    }));
    ctl.load('229200');
    const s = await done(ctl);
    if (s.kind !== 'done') throw new Error(s.kind);
    expect(s.data.failedBench).toEqual(['229200']);
    expect(s.data.series.has('229200')).toBe(false);
  });

  it('keeps stocks whose prices failed out of the series and names them', async () => {
    const { ctl } = setup((base) => ({
      getCandles: async (q) => {
        if (q.symbol === '000990') throw new ApiError('timeout');
        return base.getCandles(q);
      },
    }));
    ctl.load('AUTO');
    const s = await done(ctl);
    if (s.kind !== 'done') throw new Error(s.kind);
    expect(s.data.stocks.has('000990')).toBe(false);
    expect(s.data.names.get('000990')).toBe('DB하이텍');
  });

  it('uses the order cache for a real account but not for the demo', async () => {
    const real = setup((base) => ({ id: 'toss', account: base.account }));
    real.ctl.load('AUTO');
    await done(real.ctl);
    expect(await real.orderCache.get('p1|toss|demo')).toMatchObject({ syncedAt: NOW });
    const demo = setup();
    demo.ctl.load('AUTO');
    await done(demo.ctl);
    expect(await demo.orderCache.get('p1|demo|demo')).toBeUndefined();
  });

  it('shows a connection error from the order list', async () => {
    const { ctl } = setup((base) => ({
      account: { ...base.account!, closedOrders: async () => Promise.reject(new ApiError('path-blocked', undefined, { status: 403 })) },
    }));
    ctl.load('AUTO');
    const s = await done(ctl);
    expect(s.kind).toBe('error');
    if (s.kind === 'error') expect((s.error as ApiError).code).toBe('path-blocked');
  });

  it('is empty without domestic fills, counting foreign ones', async () => {
    const { ctl } = setup((base) => ({
      account: {
        ...base.account!,
        closedOrders: async () => (await base.account!.closedOrders()).filter((o) => o.currency !== 'KRW'),
      },
    }));
    ctl.load('AUTO');
    expect(await done(ctl)).toEqual({ kind: 'empty', foreign: 1 });
  });

  it('cannot reconcile when holdings fail, but still computes', async () => {
    const { ctl } = setup((base) => ({
      account: { ...base.account!, holdings: async () => Promise.reject(new ApiError('timeout')) },
    }));
    ctl.load('AUTO');
    const s = await done(ctl);
    if (s.kind !== 'done') throw new Error(s.kind);
    expect(s.data.reconcile.bySymbol.get('005930')?.status).toBe('unknown');
  });

  it('ignores a load that was cancelled', async () => {
    const { ctl } = setup();
    ctl.load('AUTO');
    ctl.cancel();
    expect(ctl.state.kind).toBe('idle');
    await new Promise((r) => setTimeout(r, 50));
    expect(ctl.state.kind).toBe('idle');
  });

  // PR 리뷰: 화면을 떠난(취소한) 뒤 늦게 끝난 주문 응답이 계좌 내역을 다시 저장하면 안 된다
  it('does not save orders that arrive after the load was cancelled', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const { ctl, orderCache } = setup((base) => ({
      id: 'toss',
      account: {
        ...base.account!,
        closedOrders: async (o) => {
          await gate;
          return base.account!.closedOrders(o);
        },
      },
    }));
    ctl.load('AUTO');
    await vi.waitFor(() => expect(ctl.state.kind).toBe('loading'));
    ctl.cancel();
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(ctl.state.kind).toBe('idle');
    expect(await orderCache.get('p1|toss|demo')).toBeUndefined();
  });
});
