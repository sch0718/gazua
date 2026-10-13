import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../providers/errors';
import { newStrategy } from '../../sim/defaults';
import { simulate } from '../../sim/simulate';
import type { Strategy } from '../../sim/types';
import { createDemoProvider } from '../../providers/demo';
import type { MarketDataProvider } from '../../providers/types';
import type { App } from '../../state/app.svelte';
import { kstEpoch } from '../../time/kst';
import { createRunController, type RunState } from './runController.svelte';

vi.mock('../../sim/simulate', async (orig) => {
  const m = await orig<typeof import('../../sim/simulate')>();
  return { ...m, simulate: vi.fn(m.simulate) };
});

const NOW = kstEpoch('2026-10-12', '14:05:00');
const SYMBOLS = ['005930', '000660'];

function strat(patch: (s: Strategy) => void = () => {}): Strategy {
  const s = newStrategy(NOW, 'g1');
  s.period = { from: '2026-03-02', to: '2026-06-30' };
  s.benchmarks = { index: 'KOSPI', symbol: null };
  patch(s);
  return s;
}

type Calls = { candles: string[] };
function provider(over: Partial<MarketDataProvider> = {}, calls: Calls = { candles: [] }): MarketDataProvider {
  const base = createDemoProvider({ seed: 1, now: () => NOW });
  return {
    ...base,
    getStockMeta: (s) => base.getStockMeta(s),
    getCandles: async (q) => {
      calls.candles.push(q.symbol);
      return base.getCandles(q);
    },
    getIndexCandles: (...a) => base.getIndexCandles!(...a),
    ...over,
  };
}

function fakeApp(p: MarketDataProvider): { provider: MarketDataProvider; watchlists: App['watchlists'] } {
  return {
    provider: p,
    watchlists: { groups: [{ id: 'g1', name: '반도체', items: SYMBOLS.map((symbol, i) => ({ symbol, colorSlot: (i + 1) as 1, hidden: false, addedAt: 1 })) }] },
  };
}

const ctlFor = (app: ReturnType<typeof fakeApp>) => createRunController(app as unknown as App, { now: () => NOW });
const settled = (ctl: { state: RunState }) => vi.waitFor(() => expect(ctl.state.kind).not.toBe('loading'), { timeout: 5000 });

afterEach(() => {
  vi.mocked(simulate).mockClear();
  vi.restoreAllMocks();
});

describe('runController', () => {
  it('데모 공급자: loading(진행이 늘어남) → done', async () => {
    const seen: number[] = [];
    let ctl!: ReturnType<typeof createRunController>;
    const p = provider({
      getCandles: async (q) => {
        if (ctl.state.kind === 'loading') seen.push(ctl.state.progress.done);
        return createDemoProvider({ seed: 1, now: () => NOW }).getCandles(q);
      },
    });
    ctl = ctlFor(fakeApp(p));
    expect(ctl.state.kind).toBe('idle');
    ctl.run(strat());
    expect(ctl.state.kind).toBe('loading');
    await settled(ctl);
    expect(seen).toEqual([3, 4]);
    const st = ctl.state;
    if (st.kind !== 'done') throw new Error(st.kind);
    expect(st.meta.demo).toBe(true);
    expect(st.meta.venueLabel).toBe('KRX 일봉');
    expect(st.meta.from).toBe('2026-03-02');
    expect(st.meta.to).toBe('2026-06-30');
    expect(st.meta.fetchedAt).toBe(NOW);
    expect(st.meta.failed).toEqual([]);
    expect(Object.keys(st.meta.candles)).toEqual(SYMBOLS);
    expect(st.meta.names).toMatchObject({ '005930': '삼성전자', '000660': 'SK하이닉스' });
    expect(st.result.equity.length).toBeGreaterThan(50);
  });

  it('미래로 넘는 기간은 어제까지만: meta.to는 그 안의 실제 마지막 거래일', async () => {
    const ctl = ctlFor(fakeApp(provider()));
    ctl.run(strat((s) => (s.period = { from: '2026-09-01', to: '2026-12-31' })));
    await settled(ctl);
    const st = ctl.state;
    if (st.kind !== 'done') throw new Error(st.kind);
    expect(st.meta.to).toBe(st.result.equity.at(-1)!.date);
    expect(st.meta.to <= '2026-10-11').toBe(true);
  });

  it('데이터가 요청 시작일보다 늦게 시작하면 meta.from은 실제 첫 거래일', async () => {
    const ctl = ctlFor(fakeApp(provider()));
    ctl.run(strat((s) => (s.period = { from: '2023-10-12', to: '2026-06-30' })));
    await settled(ctl);
    const st = ctl.state;
    if (st.kind !== 'done') throw new Error(st.kind);
    expect(st.meta.from).toBe(st.result.equity[0].date);
    expect(st.meta.from >= '2025-01-01').toBe(true);
    expect(st.meta.strategy.period.from).toBe('2023-10-12');
  });

  it('종목 하나 실패 → partial, proceed()면 그 종목 빼고 done(meta.failed에 남음)', async () => {
    const base = provider();
    const p = provider({ getCandles: async (q) => (q.symbol === '000660' ? Promise.reject(new Error('x')) : base.getCandles(q)) });
    const ctl = ctlFor(fakeApp(p));
    ctl.run(strat());
    await settled(ctl);
    const st = ctl.state;
    if (st.kind !== 'partial') throw new Error(st.kind);
    expect(st.failed).toEqual([{ symbol: '000660', name: 'SK하이닉스', reason: '받지 못했어요', error: expect.any(Error) }]);
    st.proceed();
    const done = ctl.state;
    if (done.kind !== 'done') throw new Error(done.kind);
    expect(done.meta.failed).toEqual([{ symbol: '000660', name: 'SK하이닉스', reason: '받지 못했어요', error: expect.any(Error) }]);
    expect(done.result.perSymbol.map((r) => r.symbol)).toEqual(['005930']);
    expect(Object.keys(done.meta.candles)).toEqual(['005930']);
  });

  it('partial에서 cancel()하면 idle', async () => {
    const base = provider();
    const p = provider({ getCandles: async (q) => (q.symbol === '000660' ? Promise.reject(new Error('x')) : base.getCandles(q)) });
    const ctl = ctlFor(fakeApp(p));
    ctl.run(strat());
    await settled(ctl);
    if (ctl.state.kind !== 'partial') throw new Error(ctl.state.kind);
    ctl.state.cancel();
    expect(ctl.state.kind).toBe('idle');
  });

  it('메타 실패 → error', async () => {
    const boom = new Error('proxy');
    const ctl = ctlFor(fakeApp(provider({ getStockMeta: async () => Promise.reject(boom) })));
    ctl.run(strat());
    await settled(ctl);
    expect(ctl.state).toEqual({ kind: 'error', error: boom });
  });

  it('기간 안에 데이터가 없으면 noData', async () => {
    const ctl = ctlFor(fakeApp(provider()));
    ctl.run(strat((s) => (s.period = { from: '2026-10-11', to: '2026-10-11' })));
    await settled(ctl);
    expect(ctl.state).toEqual({ kind: 'noData', failed: expect.any(Array) });
  });

  it('지수도 없고 종목이 모두 실패(모두 받지 못했어요)하면 연결 문제 error', async () => {
    const ctl = ctlFor(
      fakeApp(provider({ getCandles: async () => Promise.reject(new Error('x')), getIndexCandles: async () => [] })),
    );
    ctl.run(strat());
    await settled(ctl);
    expect(ctl.state).toMatchObject({ kind: 'error' });
    expect(simulate).not.toHaveBeenCalled();
  });

  it('전략 종목이 모두 받지 못했어요(지수 날짜만 있어도)이면 연결 문제 error', async () => {
    const ctl = ctlFor(fakeApp(provider({ getCandles: async () => Promise.reject(new Error('x')) })));
    ctl.run(strat());
    await settled(ctl);
    expect(ctl.state).toMatchObject({ kind: 'error' });
    expect(simulate).not.toHaveBeenCalled();
  });

  it('모두 받지 못했어요: 던진 ApiError 중 먼저 고칠 것을 대표 오류로 싣는다', async () => {
    const errs: Record<string, ApiError> = { '005930': new ApiError('upstream'), '000660': new ApiError('proxy-unreachable') };
    const ctl = ctlFor(fakeApp(provider({ getCandles: async (q) => Promise.reject(errs[q.symbol]) })));
    ctl.run(strat());
    await settled(ctl);
    expect(ctl.state).toMatchObject({ kind: 'error', error: errs['000660'] });
  });

  it('모두 받지 못했어요: ApiError가 아니면 일봉 문구용 text', async () => {
    const ctl = ctlFor(fakeApp(provider({ getCandles: async () => Promise.reject(new Error('x')) })));
    ctl.run(strat());
    await settled(ctl);
    expect(ctl.state).toMatchObject({ kind: 'error', text: '종목 일봉을 받지 못했어요' });
  });

  it('남은 종목이 없어도 사유가 섞이면 noData + 실패 목록', async () => {
    const ctl = ctlFor(
      fakeApp(
        provider({
          getCandles: async (q) => (q.symbol === '005930' ? Promise.reject(new Error('x')) : []),
        }),
      ),
    );
    ctl.run(strat());
    await settled(ctl);
    expect(ctl.state).toEqual({
      kind: 'noData',
      failed: [
        { symbol: '005930', name: '삼성전자', reason: '받지 못했어요', error: expect.any(Error) },
        { symbol: '000660', name: 'SK하이닉스', reason: '기간 안에 데이터가 없어요' },
      ],
    });
  });

  it('loading 상태에 종목 수와 비교 종목 여부(scope)가 실린다', async () => {
    const ctl = ctlFor(fakeApp(provider()));
    ctl.run(strat((s) => (s.benchmarks = { index: 'KOSPI', symbol: '069500' })));
    expect(ctl.state).toMatchObject({ kind: 'loading', scope: { stocks: 2, benchmark: true } });
    await settled(ctl);
    ctl.run(strat());
    expect(ctl.state).toMatchObject({ kind: 'loading', scope: { stocks: 2, benchmark: false } });
    await settled(ctl);
  });

  it('simulate가 throw하면 crash, 콘솔 error 1회', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(simulate).mockImplementationOnce(() => {
      throw new Error('엔진');
    });
    const ctl = ctlFor(fakeApp(provider()));
    ctl.run(strat());
    await settled(ctl);
    expect(ctl.state).toEqual({ kind: 'crash' });
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('진행 중 cancel()하면 idle이고, 늦게 끝난 요청은 버린다', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const base = provider();
    const ctl = ctlFor(fakeApp(provider({ getCandles: async (q) => (await gate, base.getCandles(q)) })));
    ctl.run(strat());
    await vi.waitFor(() => expect(ctl.state.kind === 'loading' && ctl.state.progress.done).toBe(3));
    ctl.cancel();
    expect(ctl.state.kind).toBe('idle');
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(ctl.state.kind).toBe('idle');
    expect(simulate).not.toHaveBeenCalled();
  });

  it('메모는 같은 공급자에서 재사용하고, 공급자가 바뀌면 새로 만든다', async () => {
    const calls: Calls = { candles: [] };
    const app = fakeApp(provider({}, calls));
    const ctl = ctlFor(app);
    ctl.run(strat());
    await settled(ctl);
    expect(calls.candles).toHaveLength(2);
    ctl.run(strat());
    await settled(ctl);
    expect(calls.candles).toHaveLength(2);
    app.provider = provider({}, calls);
    ctl.run(strat());
    await settled(ctl);
    expect(calls.candles).toHaveLength(4);
  });

  it('실행은 전략을 바꾸지 않는다', async () => {
    const s = strat();
    const before = structuredClone(s);
    const ctl = ctlFor(fakeApp(provider()));
    ctl.run(s);
    await settled(ctl);
    expect(s).toEqual(before);
  });
});
