import { afterEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../../src/lib/providers/errors';
import type { MarketDataProvider, StockMeta } from '../../../src/lib/providers/types';
import { createSimMemo, loadSimData } from '../../../src/lib/sim/loadSimData';
import { simulate } from '../../../src/lib/sim/simulate';
import { randomWalk } from '../../../src/lib/sim/testInputs';
import { tradingDates } from '../../../src/lib/sim/testBars';
import { fullStrategyV2 } from '../../../src/lib/sim/testStrategyV2';
import type { Strategy } from '../../../src/lib/sim/types';
import { kstDate } from '../../../src/lib/time/kst';
import { writeAuth } from '../config';
import { COMMANDS, run } from '../main';
import type { Built } from '../providers';
import { cleanupDirs, makeIo, profileDoc, syncServer } from '../testing';
import { makeSimulate, simulateCmd } from './simulate';

const registeredSimulate = COMMANDS.simulate;

afterEach(() => {
  cleanupDirs();
  COMMANDS.simulate = simulateCmd;
});

const AUTH = { v: 1 as const, server: 'https://sync.example', token: `gzc_${'A'.repeat(43)}`, tokenId: 't1', label: 'gazua@mac', expiresAt: Date.UTC(2027, 0, 1) };
const DATES = tradingDates('2022-01-03', 1240);
const WALKS: Record<string, ReturnType<typeof randomWalk>> = { '005930': randomWalk(DATES, 11), '000660': randomWalk(DATES, 22), KOSPI: randomWalk(DATES, 33) };

function simpleStrategy(): Strategy {
  const s = fullStrategyV2();
  s.rules.buy = [{ conds: [{ kind: 'maCross', short: 5, long: 20, dir: 'golden' }] }];
  s.rules.sell.signal = { on: true, groups: [{ conds: [{ kind: 'maCross', short: 5, long: 20, dir: 'dead' }] }] };
  s.benchmarks = { index: 'KOSPI', symbol: null };
  return s;
}
const doc = () => ({ ...profileDoc(2), strategies: [simpleStrategy()] });

function stubProvider(over: Partial<MarketDataProvider> = {}): MarketDataProvider {
  const meta = (symbol: string): StockMeta => ({ symbol, name: symbol === '005930' ? '삼성전자' : 'SK하이닉스', market: 'KOSPI', securityType: 'STOCK', nxtSupported: false, krxSuspended: false, nxtSuspended: null, liquidationTrading: false });
  return {
    id: 'kis',
    capabilities: { venues: ['KRX'], quoteBatchSize: 1, hasIndexCandles: true, indexMinutePastDays: false },
    getStockMeta: async (symbols: string[]) => symbols.filter((s) => WALKS[s]).map(meta),
    getCandles: async (q: { symbol: string; from: string; to: string }) => (WALKS[q.symbol] ?? []).filter((c) => kstDate(c.t) >= q.from && kstDate(c.t) <= q.to),
    getIndexCandles: async (_i: string, _iv: string, from: string, to: string) => WALKS.KOSPI.filter((c) => kstDate(c.t) >= from && kstDate(c.t) <= to),
    getTradingDays: async () => [],
    ...over,
  } as unknown as MarketDataProvider;
}
const built = (over: Partial<MarketDataProvider> = {}): Built => ({ id: 'kis', provider: stubProvider(over), keyHash: 'kh' });

function setup(b: Built = built(), profile = doc()) {
  const t = makeIo({ fetch: syncServer({ p1: { doc: profile } }), env: { KIS_APP_KEY: 'k', KIS_APP_SECRET: 's' } });
  writeAuth(t.dir, AUTH);
  COMMANDS.simulate = makeSimulate(() => b);
  return t;
}
const r2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);

describe('gazua simulate', () => {
  it('앱과 같은 loadSimData → simulate의 요약을 낸다', async () => {
    const t = setup();
    expect(await run(['simulate', '--strategy', '골든크로스 추세'], t.io)).toBe(0);
    const d = t.result().data;
    const strategy = simpleStrategy();
    const out = await loadSimData({ provider: stubProvider(), strategy, symbols: ['005930', '000660'], now: t.clock.now, memo: createSimMemo(), onProgress: () => {}, isCancelled: () => false });
    if (!out.ok) throw new Error('loadSimData 실패');
    const want = simulate(out.input);
    expect(d.strategy).toBe('골든크로스 추세');
    expect(d.venue).toBe('KRX 일봉');
    expect(d.period).toEqual({ from: out.input.days[0], to: out.input.days[out.input.days.length - 1] });
    expect(d.summary).toEqual({
      totalReturnPct: r2(want.summary.totalReturnPct),
      cagrPct: r2(want.summary.cagrPct),
      mddPct: r2(want.summary.mddPct),
      winRatePct: r2(want.summary.winRatePct),
      roundTrips: want.summary.roundTrips,
      openPositions: want.summary.openPositions,
    });
    expect(d.benchmarks).toEqual({ holdReturnPct: r2(want.benchmarks.holdReturnPct), indexReturnPct: r2(want.benchmarks.indexReturnPct), benchmarkReturnPct: null });
    expect(d.perSymbol).toEqual(want.perSymbol.map((p) => ({ symbol: p.symbol, pnl: p.pnl, roundTrips: p.roundTrips })));
    expect(d.failed).toEqual([]);
    expect(want.summary.roundTrips).toBeGreaterThan(0);
  });

  it('--from/--to로 기간을 바꾼다. from이 to보다 뒤면 invalid-args', async () => {
    const t = setup();
    expect(await run(['simulate', '--strategy', '골든크로스 추세', '--from', '2024-01-02', '--to', '2024-12-30'], t.io)).toBe(0);
    const p = t.result().data.period;
    expect(p.from >= '2024-01-02' && p.from <= '2024-01-10').toBe(true);
    expect(p.to <= '2024-12-30' && p.to >= '2024-12-20').toBe(true);
    const u = setup();
    expect(await run(['simulate', '--strategy', '골든크로스 추세', '--from', '2025-01-01', '--to', '2024-01-01'], u.io)).toBe(2);
    expect(u.result().error.code).toBe('invalid-args');
  });

  it('받지 못한 종목은 failed로 낸다', async () => {
    const t = setup(built({ getStockMeta: async (symbols: string[]) => symbols.filter((s) => s === '005930').map((s) => ({ symbol: s, name: '삼성전자', market: 'KOSPI', securityType: 'STOCK', nxtSupported: false, krxSuspended: false, nxtSuspended: null, liquidationTrading: false }) as StockMeta) }));
    expect(await run(['simulate', '--strategy', '골든크로스 추세'], t.io)).toBe(0);
    expect(t.result().data.failed).toEqual([{ symbol: '000660', reason: '종목 정보를 받지 못했어요' }]);
    expect(t.result().data.perSymbol.map((p: { symbol: string }) => p.symbol)).toEqual(['005930']);
  });

  it('기간 안에 데이터가 없으면 summary: null과 notes 및 venue', async () => {
    const t = setup(built({ getCandles: async () => [], getIndexCandles: async () => [] }));
    expect(await run(['simulate', '--strategy', '골든크로스 추세'], t.io)).toBe(0);
    expect(t.result().data).toMatchObject({ venue: 'KRX 일봉', summary: null, benchmarks: null, perSymbol: [], notes: ['기간 안에 데이터가 없어요'] });
  });

  it('연결 문제(첫 요청부터 실패)는 CLI 오류 코드로 낸다', async () => {
    const t = setup(built({ getStockMeta: async () => Promise.reject(new ApiError('proxy-unreachable')) }));
    expect(await run(['simulate', '--strategy', '골든크로스 추세'], t.io)).toBe(1);
    expect(t.result().error.code).toBe('network');
  });

  it('--strategy가 없으면 invalid-args, 없는 전략은 strategy-not-found', async () => {
    const a = setup();
    expect(await run(['simulate'], a.io)).toBe(2);
    expect(a.result().error.code).toBe('invalid-args');
    const b = setup();
    await run(['simulate', '--strategy', '없는 전략'], b.io);
    expect(b.result().error.code).toBe('strategy-not-found');
  });

  it('기본 simulate 명령을 등록한다', () => {
    expect(registeredSimulate).toBe(simulateCmd);
  });

  it('대상 종목이 없어도 기간과 통합 venue를 돌려준다', async () => {
    const profile = doc();
    profile.strategies[0].universe = { kind: 'symbols', symbols: [] };
    const t = setup(built({
      capabilities: { venues: ['UNIFIED'], quoteBatchSize: 1, hasIndexCandles: true, indexMinutePastDays: false },
      getStockMeta: async () => { throw new Error('종목이 없으면 요청하지 않아요'); },
    }), profile);
    expect(await run(['simulate', '--strategy', '골든크로스 추세'], t.io)).toBe(0);
    expect(t.result().data).toEqual({ strategy: '골든크로스 추세', period: profile.strategies[0].period, venue: '통합 일봉', summary: null, benchmarks: null, perSymbol: [], failed: [], notes: ['기간 안에 데이터가 없어요'] });
  });

  it('지수와 지정 종목 비교를 받지 못하면 notes에 남긴다', async () => {
    const profile = doc();
    profile.strategies[0].benchmarks.symbol = '069500';
    const t = setup(built({ getIndexCandles: async () => { throw new ApiError('upstream'); } }), profile);
    expect(await run(['simulate', '--strategy', '골든크로스 추세'], t.io)).toBe(0);
    expect(t.result().data.benchmarks).toMatchObject({ indexReturnPct: null, benchmarkReturnPct: null });
    expect(t.result().data.notes).toEqual(['지수 비교를 못 했어요(받지 못했어요)', '지정 종목 비교를 못 했어요']);
  });
});
