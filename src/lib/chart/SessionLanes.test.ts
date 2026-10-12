// @vitest-environment jsdom
import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { sessionsForDay } from '../market/sessions';
import { tradableIntervals, type TradableMeta } from '../market/tradable';
import { kstEpoch } from '../time/kst';
import type { ChartSeriesInput } from './lineData';
import SessionLanes from './SessionLanes.svelte';

const DAY = '2026-10-08';
const sessions = sessionsForDay({ date: DAY, isOpen: true });
const dayStart = kstEpoch(DAY, '08:00:00');
// 1px per minute over 08:00..20:00
const xOf = (t: number) => {
  const x = (t - dayStart) / 60_000;
  return x < 0 || x > 720 ? null : x;
};

const nxtStock: TradableMeta = { securityType: 'STOCK', nxtSupported: true, krxSuspended: false, nxtSuspended: false };
const krxOnlyEtf: TradableMeta = { securityType: 'ETF', nxtSupported: false, krxSuspended: false, nxtSuspended: null };

const input = (id: string, slot: ChartSeriesInput['slot'], meta: TradableMeta, extra: Partial<ChartSeriesInput> = {}): ChartSeriesInput => ({
  id,
  slot,
  label: id,
  points: [],
  intervals: tradableIntervals(sessions, meta, 'AUTO'),
  hidden: false,
  ...extra,
});

const lanes = (container: HTMLElement) =>
  [...container.querySelectorAll('g[data-lane]')].map((g) =>
    [...g.querySelectorAll('rect[aria-label]')].map((r) => ({
      label: r.getAttribute('aria-label'),
      fill: r.getAttribute('fill'),
    })),
  );

describe('SessionLanes', () => {
  it('draws a NXT stock in AUTO as filled sessions with auction hatches and no gaps', () => {
    const { container } = render(SessionLanes, {
      series: [input('삼성전자', 1, nxtStock)],
      xOf,
      width: 720,
    });
    expect(lanes(container)).toEqual([
      [
        { label: 'NXT 08:00–08:50', fill: 'var(--s1)' },
        { label: 'KRX 단일가 08:50–09:00', fill: 'url(#lane-auction)' },
        { label: 'KRX 09:00–15:20', fill: 'var(--s1)' },
        { label: 'KRX 단일가 15:20–15:30', fill: 'url(#lane-auction)' },
        { label: 'NXT 단일가 15:30–15:40', fill: 'url(#lane-auction)' },
        { label: 'NXT 15:40–16:00', fill: 'var(--s1)' },
        { label: 'KRX 16:00–20:00', fill: 'var(--s1)' },
      ],
    ]);
  });

  it('hatches the untradable gaps of a KRX-only ETF within 08:00–20:00', () => {
    const { container } = render(SessionLanes, {
      series: [input('KODEX 200', 5, krxOnlyEtf)],
      xOf,
      width: 720,
    });
    expect(lanes(container)).toEqual([
      [
        { label: '거래 불가 08:00–08:30', fill: 'url(#lane-hatch)' },
        { label: 'KRX 단일가 08:30–09:00', fill: 'url(#lane-auction)' },
        { label: 'KRX 09:00–15:20', fill: 'var(--s5)' },
        { label: 'KRX 단일가 15:20–15:30', fill: 'url(#lane-auction)' },
        { label: '거래 불가 15:30–20:00', fill: 'url(#lane-hatch)' },
      ],
    ]);
  });

  it('stacks one lane per visible series, skipping hidden ones', () => {
    const { container } = render(SessionLanes, {
      series: [
        input('삼성전자', 1, nxtStock),
        input('숨김', 2, nxtStock, { hidden: true }),
        input('KODEX 200', 3, krxOnlyEtf),
      ],
      xOf,
      width: 720,
    });
    const rows = container.querySelectorAll('g[data-lane]');
    expect(rows).toHaveLength(2);
    expect(rows[0].getAttribute('aria-label')).toBe('삼성전자');
    expect(rows[1].getAttribute('aria-label')).toBe('KODEX 200');
    const y = (g: Element) => Number(g.querySelector('rect')!.getAttribute('y'));
    expect(y(rows[1]) - y(rows[0])).toBe(11); // 6px lane + 5px gap
  });

  it('places rects by xOf and labels wide continuous runs with the venue', () => {
    const { container } = render(SessionLanes, {
      series: [input('삼성전자', 1, nxtStock)],
      xOf,
      width: 720,
    });
    const regular = container.querySelector('rect[aria-label="KRX 09:00–15:20"]')!;
    expect(Number(regular.getAttribute('x'))).toBeCloseTo(60.5);
    expect(Number(regular.getAttribute('width'))).toBeCloseTo(379);
    const texts = [...container.querySelectorAll('text')].map((t) => t.textContent);
    expect(texts).toEqual(['NXT', 'KRX', 'KRX']); // 08:00–08:50, 09:00–15:20, 16:00–20:00; 15:40–16:00 is under 28px
  });

  it('fades KRX fallback intervals of a NXT-mode stock without NXT support', () => {
    const krxOnlyStock: TradableMeta = { ...krxOnlyEtf, securityType: 'STOCK' };
    const { container } = render(SessionLanes, {
      series: [input('한미반도체', 2, krxOnlyStock, { intervals: tradableIntervals(sessions, krxOnlyStock, 'NXT') })],
      xOf,
      width: 720,
    });
    const regular = container.querySelector('rect[aria-label="KRX 09:00–15:20"]')!;
    expect(regular.getAttribute('opacity')).toBe('0.55');
  });

  it('labels UNIFIED intervals as 통합', () => {
    const { container } = render(SessionLanes, {
      series: [input('삼성전자', 1, nxtStock, { intervals: tradableIntervals(sessions, nxtStock, 'UNIFIED') })],
      xOf,
      width: 720,
    });
    expect(container.querySelector('rect[aria-label="통합 08:00–08:50"]')).not.toBeNull();
    expect(container.querySelector('rect[aria-label="통합 단일가 15:20–15:40"]')).not.toBeNull();
  });

  it('hatches the whole day for a series without intervals when the day is given', () => {
    const { container } = render(SessionLanes, {
      series: [input('정지', 4, nxtStock, { intervals: [] })],
      xOf,
      width: 720,
      day: DAY,
    });
    expect(lanes(container)).toEqual([[{ label: '거래 불가 08:00–20:00', fill: 'url(#lane-hatch)' }]]);
  });
});
