// 프리셋 비교: 일봉을 한 번 받아(워밍업은 가장 긴 규칙 기준) 같은 종목·거래일로 프리셋을 모두 돌리고 요약만 모은다.
import type { MarketDataProvider } from '../providers/types';
import type { Watchlists } from '../state/schema';
import { createSimMemo, loadSimData, type LoadProgress } from './loadSimData';
import { simulate } from './simulate';
import { fromTemplate, TEMPLATES, type StrategyTemplate } from './templates';
import type { SimResult } from './types';
import { resolveSymbols } from './validate';

export interface CompareRow {
  template: StrategyTemplate;
  summary: SimResult['summary'];
}

export type CompareOutcome =
  | { ok: true; rows: CompareRow[]; from: string; to: string; symbols: number; failed: number }
  | { ok: false; reason: 'noSymbols' | 'noData' | 'error' | 'cancelled'; error?: unknown };

export async function compareTemplates(args: {
  provider: MarketDataProvider;
  watchlists: Watchlists;
  groupId: string;
  now: number;
  onProgress?: (p: LoadProgress) => void;
  isCancelled?: () => boolean;
  load?: typeof loadSimData;
}): Promise<CompareOutcome> {
  const { provider, watchlists, groupId, now } = args;
  const load = args.load ?? loadSimData;
  const isCancelled = args.isCancelled ?? (() => false);
  const strategies = TEMPLATES.map((t) => fromTemplate(t, now, groupId, t.name));
  const symbols = resolveSymbols(strategies[0], watchlists);
  if (symbols.length === 0) return { ok: false, reason: 'noSymbols' };
  // 받기용 전략: 기간·비교 대상은 모두 같고, 매수 묶음을 모두 모아 가장 긴 워밍업을 받는다
  const loader = { ...strategies[0], rules: { ...strategies[0].rules, buy: strategies.flatMap((x) => [...x.rules.buy, ...(x.rules.sell.signal.on ? x.rules.sell.signal.groups : [])]) } };
  const out = await load({
    provider,
    strategy: loader,
    symbols,
    now,
    memo: createSimMemo(),
    onProgress: (p) => args.onProgress?.(p),
    isCancelled,
  });
  if (isCancelled()) return { ok: false, reason: 'cancelled' };
  if (!out.ok) {
    if ('cancelled' in out) return { ok: false, reason: 'cancelled' };
    if ('error' in out) return { ok: false, reason: 'error', error: out.error };
    return { ok: false, reason: 'noData' };
  }
  const { input } = out;
  if (input.stocks.length === 0) return { ok: false, reason: 'noData' };
  const rows = TEMPLATES.map((template, i) => ({ template, summary: simulate({ ...input, strategy: strategies[i] }).summary }));
  return { ok: true, rows, from: input.days[0], to: input.days[input.days.length - 1], symbols: input.stocks.length, failed: out.failed.length };
}
