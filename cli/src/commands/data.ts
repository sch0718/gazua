import { resolveSymbols } from '../../../src/lib/sim/validate';
import { buyRulesSummary, sellRulesSummary, sizingText } from '../../../src/lib/ui/simulate/simText';
import type { Command } from '../context';
import { loadAllProfiles, pickProfile } from '../profileData';
import { authedClient } from '../session';

export const profiles: Command = async (ctx) => {
  const list = await loadAllProfiles(authedClient(ctx), ctx.now());
  return { profiles: list.map((p) => ({ id: p.id, name: p.name, revision: p.revision, groups: p.watchlists.groups.length, strategies: p.strategies.length })) };
};

export const watchlists: Command = async (ctx) => {
  const p = await pickProfile(authedClient(ctx), ctx.args.profile, ctx.now());
  return {
    profile: p.name,
    groups: p.watchlists.groups.map((g) => ({ id: g.id, name: g.name, symbols: g.items.map((i) => ({ symbol: i.symbol, hidden: i.hidden })) })),
  };
};

export const strategies: Command = async (ctx) => {
  const p = await pickProfile(authedClient(ctx), ctx.args.profile, ctx.now());
  return {
    strategies: p.strategies.map((s) => ({
      id: s.id,
      name: s.name,
      universe: s.universe.kind === 'group' ? { kind: 'group', groupId: s.universe.groupId, symbols: resolveSymbols(s, p.watchlists) } : { kind: 'symbols', symbols: resolveSymbols(s, p.watchlists) },
      buy: buyRulesSummary(s),
      sell: sellRulesSummary(s),
      sizing: sizingText(s),
      ...(ctx.args.raw ? { rules: s.rules } : {}),
    })),
  };
};
