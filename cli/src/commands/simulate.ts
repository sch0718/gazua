import { createSimMemo, loadSimData } from '../../../src/lib/sim/loadSimData';
import { simulate } from '../../../src/lib/sim/simulate';
import { resolveSymbols } from '../../../src/lib/sim/validate';
import type { Command } from '../context';
import { chooseProvider, readCreds } from '../env';
import { CliError, toCliError } from '../errors';
import { findStrategy, pickProfile } from '../profileData';
import { buildProvider, proxyOf } from '../providers';
import { authedClient } from '../session';

const r2 = (n: number | null): number | null => (n === null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);
const NO_DATA = '기간 안에 데이터가 없어요';

/** 앱과 같은 loadSimData → simulate를 쓴다. 테스트가 공급자 조립을 바꿔 끼울 수 있게 팩토리로 둔다 */
export function makeSimulate(build: typeof buildProvider = buildProvider): Command {
  return async (ctx) => {
    const ref = ctx.args.strategy;
    if (!ref) throw new CliError('invalid-args', '--strategy <이름|ID>가 필요해요');
    const profile = await pickProfile(authedClient(ctx), ctx.args.profile, ctx.now());
    const base = findStrategy(profile.strategies, ref);
    const period = { from: ctx.args.from ?? base.period.from, to: ctx.args.to ?? base.period.to };
    if (period.from > period.to) throw new CliError('invalid-args', '--from이 --to보다 뒤예요');
    const strategy = { ...base, period };
    const symbols = resolveSymbols(strategy, profile.watchlists);
    const creds = readCreds(ctx.env);
    const { provider } = build(ctx, chooseProvider(creds, ctx.args.provider, proxyOf(ctx)), creds);

    const empty = (failed: { symbol: string; name?: string; reason: string }[]) => ({
      strategy: strategy.name,
      period,
      // loadSimData는 데이터가 없을 때 라벨을 주지 않아 같은 venue 선택 규칙을 쓴다.
      venue: provider.capabilities.venues.length === 0 || provider.capabilities.venues.includes('KRX') ? 'KRX 일봉' : '통합 일봉',
      summary: null,
      benchmarks: null,
      perSymbol: [],
      failed,
      notes: [NO_DATA],
    });
    if (symbols.length === 0) return empty([]);

    const out = await loadSimData({ provider, strategy, symbols, now: ctx.now(), memo: createSimMemo(), onProgress: () => {}, isCancelled: () => false });
    if (!out.ok) {
      if ('noData' in out) return empty(out.failed.map((f) => ({ symbol: f.symbol, ...(f.name ? { name: f.name } : {}), reason: f.reason })));
      if ('error' in out) throw toCliError(out.error);
      throw new CliError('internal');
    }
    const result = simulate(out.input);
    const days = out.input.days;
    const s = result.summary;
    const notes: string[] = [];
    if (out.indexFailed) notes.push(`지수 비교를 못 했어요(${out.indexFailed})`);
    if (out.benchmarkFailed) notes.push('지정 종목 비교를 못 했어요');
    return {
      strategy: strategy.name,
      period: { from: days[0], to: days[days.length - 1] },
      venue: out.venueLabel,
      summary: { totalReturnPct: r2(s.totalReturnPct), cagrPct: r2(s.cagrPct), mddPct: r2(s.mddPct), winRatePct: r2(s.winRatePct), roundTrips: s.roundTrips, openPositions: s.openPositions },
      benchmarks: { holdReturnPct: r2(result.benchmarks.holdReturnPct), indexReturnPct: r2(result.benchmarks.indexReturnPct), benchmarkReturnPct: r2(result.benchmarks.benchmarkReturnPct) },
      perSymbol: result.perSymbol.map((p) => ({ symbol: p.symbol, pnl: p.pnl, roundTrips: p.roundTrips })),
      failed: out.failed.map((f) => ({ symbol: f.symbol, ...(f.name ? { name: f.name } : {}), reason: f.reason })),
      notes,
    };
  };
}

export const simulateCmd: Command = makeSimulate();
