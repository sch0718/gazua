// @vitest-environment jsdom
import { render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lwcCharts, ResizeObserverStub } from '../../chart/lwcStub';
import EquityChart from './EquityChart.svelte';
import { doneState } from './resultFixture';

vi.mock('lightweight-charts', async () => (await import('../../chart/lwcStub')).lwcModule());

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  lwcCharts.length = 0;
});
afterEach(() => vi.unstubAllGlobals());

describe('EquityChart', () => {
  it('선 4개: 첫째가 전략(굵기 2), 나머지는 얇게', async () => {
    const s = doneState();
    render(EquityChart, { equity: s.result.equity, initial: 10_000_000, labels: { benchmark: 'KODEX 200', index: 'KOSPI' } });
    await vi.waitFor(() => expect(lwcCharts[0]?.series).toHaveLength(4));
    const [strategy, ...rest] = lwcCharts[0].series;
    expect(strategy.options.lineWidth).toBe(2);
    for (const r of rest) expect(r.options.lineWidth).toBe(1);
    expect(rest[1].options.lineStyle).toBe(2);
    expect(rest[2].options.lineStyle).toBe(2);
    // 수익률(%)로 그린다
    expect(strategy.data.at(-1)).toEqual({ time: '2026-10-08', value: expect.closeTo(32.4, 5) });
  });

  it('지수가 없으면 3개', async () => {
    const s = doneState();
    const equity = s.result.equity.map((e) => ({ ...e, index: null }));
    render(EquityChart, { equity, initial: 10_000_000, labels: { benchmark: 'KODEX 200', index: 'KOSPI' } });
    await vi.waitFor(() => expect(lwcCharts[0]?.series).toHaveLength(3));
  });
});
