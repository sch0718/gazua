import { describe, expect, it, vi } from 'vitest';
import type { Watchlists } from '../state/schema';
import type { MarketDataProvider } from '../providers/types';
import { compareTemplates } from './compareTemplates';
import type { loadSimData } from './loadSimData';
import { TEMPLATES } from './templates';
import { BASE, candlesFrom, D, stockOf } from './testInputs';

const wl = { groups: [{ id: 'g1', name: '반도체', items: [{ symbol: '005930' }] }, { id: 'g2', name: '빈 그룹', items: [] }] } as unknown as Watchlists;
const provider = {} as MarketDataProvider;

describe('compareTemplates', () => {
  it('한 번 받은 데이터로 프리셋을 모두 돌려 요약을 모은다', async () => {
    const load = vi.fn<typeof loadSimData>(async ({ strategy }) => ({
      ok: true,
      input: { strategy, days: D.slice(0, 9), stocks: [stockOf(0, candlesFrom(BASE))], index: null, benchmarkStock: null },
      failed: [],
      venueLabel: 'KRX 일봉',
      fetchedAt: 0,
      indexFailed: null,
      benchmarkFailed: false,
    }));
    const out = await compareTemplates({ provider, watchlists: wl, groupId: 'g1', now: 0, load });
    expect(load).toHaveBeenCalledTimes(1); // 일봉은 한 번만 받아 모든 프리셋이 같은 종목·거래일을 쓴다
    expect(load.mock.calls[0][0].symbols).toEqual(['005930']);
    // 워밍업은 가장 긴 규칙(52주 신고가 250일) 기준
    expect(load.mock.calls[0][0].strategy.rules.buy).toContainEqual({ conds: [{ kind: 'newHigh', days: 250 }] });
    expect(out.ok && out.rows.map((r) => r.template.id)).toEqual(TEMPLATES.map((t) => t.id));
  });

  it('종목이 없거나 받지 못하면 이유를 돌려준다', async () => {
    const load = vi.fn<typeof loadSimData>(async () => ({ ok: false, error: new Error('x') }));
    expect(await compareTemplates({ provider, watchlists: wl, groupId: 'g2', now: 0, load })).toEqual({ ok: false, reason: 'noSymbols' });
    expect(await compareTemplates({ provider, watchlists: wl, groupId: 'g1', now: 0, load })).toMatchObject({ ok: false, reason: 'error' });
  });
});
