// @vitest-environment jsdom
import { render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lwcCharts, ResizeObserverStub } from '../../chart/lwcStub';
import type { ChartSeriesInput } from '../../chart/lineData';
import { sessionsForDay } from '../../market/sessions';
import { kstEpoch } from '../../time/kst';
import ChartPanel from './ChartPanel.svelte';

vi.mock('lightweight-charts', async () => (await import('../../chart/lwcStub')).lwcModule());

const DAY = '2026-10-12';
const at = (hhmm: string) => kstEpoch(DAY, `${hhmm}:00`);
const sessions = sessionsForDay({ date: DAY, isOpen: true });

const input = (id: string, slot: ChartSeriesInput['slot']): ChartSeriesInput => ({
  id,
  slot,
  label: id,
  points: [
    { t: at('09:00'), v: 1 },
    { t: at('09:01'), v: 2 },
  ],
  intervals: [{ start: at('09:00'), end: at('15:20'), venue: 'KRX', kind: 'continuous' }],
  hidden: false,
});

function setup(over: Record<string, unknown> = {}) {
  return render(ChartPanel, {
    series: [input('A', 1), input('B', 2)],
    mode: 'intraday',
    sessions,
    markers: false,
    unit: '%',
    openDays: [],
    progress: null,
    oncrosshair: vi.fn(),
    ...over,
  });
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  lwcCharts.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ChartPanel', () => {
  it('shows 불러오는 중 done/total while series are loading', () => {
    setup({ progress: { done: 2, total: 4 } });
    expect(screen.getByRole('status').textContent).toBe('불러오는 중 2/4');
  });

  it('no progress, no loading text', () => {
    setup();
    expect(screen.queryByText(/불러오는 중/)).toBeNull();
  });

  it('draws the series it is given (a failed stock is simply absent)', async () => {
    setup({ series: [input('A', 1), input('C', 3)], progress: { done: 3, total: 3 } });
    await vi.waitFor(() => expect(lwcCharts[0]?.series.length).toBeGreaterThan(0));
    // 종목마다 점선 + 실선
    expect(lwcCharts[0].series.length).toBe(4);
  });

  it('intraday legend: 거래 불가 · 단일가 · 거래 없음(마지막 값 유지)', () => {
    setup();
    for (const t of ['거래 불가', '단일가', '거래 없음(마지막 값 유지)']) expect(screen.getByText(t)).toBeTruthy();
  });

  it('daily legend with markers', () => {
    setup({ mode: 'daily', markers: true, sessions: [], openDays: [DAY] });
    for (const t of ['● 봉이 적어 점으로 표시', '거래정지', '휴장일은 축에서 빼요']) expect(screen.getByText(t)).toBeTruthy();
  });
});
