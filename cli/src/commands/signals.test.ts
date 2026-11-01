import { afterEach, describe, expect, it } from 'vitest';
import type { MarketDataProvider } from '../../../src/lib/providers/types';
import { fullStrategyV2 } from '../../../src/lib/sim/testStrategyV2';
import { barsFromCloses } from '../../../src/lib/sim/testBars';
import { kstDate } from '../../../src/lib/time/kst';
import { writeAuth } from '../config';
import { COMMANDS, run } from '../main';
import type { Built } from '../providers';
import { cleanupDirs, makeIo, profileDoc, syncServer } from '../testing';
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
