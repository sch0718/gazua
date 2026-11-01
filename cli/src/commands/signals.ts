import { resolveSymbols } from '../../../src/lib/sim/validate';
import type { Command } from '../context';
import { chooseProvider, readCreds } from '../env';
import { CliError } from '../errors';
import { syncOrders } from '../orderCache';
import { findStrategy, pickProfile } from '../profileData';
import { buildProvider } from '../providers';
import { authedClient } from '../session';
import { runSignals } from '../signals';

/** 테스트가 공급자 조립을 바꿔 끼울 수 있게 팩토리로 둔다 */
export function makeSignals(build: typeof buildProvider = buildProvider): Command {
  return async (ctx) => {
    const ref = ctx.args.strategy;
    if (!ref) throw new CliError('invalid-args', '--strategy <이름|ID>가 필요해요');
    const profile = await pickProfile(authedClient(ctx), ctx.args.profile, ctx.now());
    const strategy = findStrategy(profile.strategies, ref);
    const creds = readCreds(ctx.env);
    const built = build(ctx, chooseProvider(creds, ctx.args.provider), creds);
    const account = built.provider.account;
    return runSignals({
      provider: built.provider,
      strategy,
      symbols: resolveSymbols(strategy, profile.watchlists),
      now: ctx.now(),
      today: ctx.args.today,
      ...(account
        ? { loadOrders: () => syncOrders({ dir: ctx.dir, keyHash: built.keyHash, account, now: ctx.now(), onSeq: (seq) => ctx.redact.add(seq), warn: ctx.warn }) }
        : {}),
    });
  };
}

export const signals: Command = makeSignals();
