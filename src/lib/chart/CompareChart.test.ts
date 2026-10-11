// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionsForDay } from '../market/sessions';
import { kstEpoch } from '../time/kst';
import CompareChartFixture from './CompareChartFixture.svelte';
import { toChartTime, type ChartSeriesInput } from './lineData';
import { lwcCharts, lwcStubHooks, ResizeObserverStub } from './lwcStub';

vi.mock('lightweight-charts', async () => (await import('./lwcStub')).lwcModule());

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

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  lwcCharts.length = 0;
});
afterEach(() => {
  lwcStubHooks.crosshairOnSetData = null;
  vi.unstubAllGlobals();
});

describe('CompareChart crosshair during a rebuild', () => {
  it('a crosshair event fired inside setData neither loops nor makes the rebuild depend on scrub state', async () => {
    lwcStubHooks.crosshairOnSetData = { time: toChartTime(at('09:01')) };
    const { rerender } = render(CompareChartFixture, { series: [input('A', 1), input('B', 2)], sessions });
    await vi.waitFor(() => expect(lwcCharts[0]?.addSeriesCalls).toBe(4));
    // 콜백은 리빌드가 끝난 뒤 전달된다.
    await vi.waitFor(() => expect(screen.getByTestId('scrub').textContent).toMatch(new RegExp(`^${at('09:01')}\\|A,B\\|`)));
    await new Promise((r) => setTimeout(r, 20));
    expect(lwcCharts[0].addSeriesCalls).toBe(4);

    // 부모의 스크럽 상태가 바뀌어도 시리즈를 다시 만들지 않는다.
    await fireEvent.click(screen.getByRole('button', { name: 'scrub' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(lwcCharts[0].addSeriesCalls).toBe(4);

    // 입력이 바뀌면 한 번만 다시 만든다(이전 시리즈 제거 중의 이벤트도 루프를 만들지 않는다).
    await rerender({ series: [input('A', 1)], sessions });
    await new Promise((r) => setTimeout(r, 20));
    expect(lwcCharts[0].addSeriesCalls).toBe(6);
    expect(lwcCharts[0].series).toHaveLength(2);
  });
});

describe('CompareChart semantics', () => {
  it('labels the plot as a group, not an image, so the library’s focusable attribution link stays valid', () => {
    render(CompareChartFixture, { series: [input('A', 1)], sessions });
    expect(screen.getByRole('group', { name: '종목 비교 차트' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: '종목 비교 차트' })).toBeNull();
  });
});
