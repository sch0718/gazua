// @vitest-environment jsdom
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { kstEpoch } from '../../time/kst';
import Headline from './Headline.svelte';

const TODAY = '2026-10-12';
const at = (hhmm: string, ss = '00') => kstEpoch(TODAY, `${hhmm}:${ss}`);

function setup(over: Record<string, unknown> = {}) {
  const { container } = render(Headline, {
    period: { unit: 'D', n: 1 },
    metricLabel: '등락률',
    scrubT: null,
    tradingDate: TODAY,
    today: TODAY,
    baseDate: null,
    now: at('17:42', '05'),
    inSession: true,
    closeAt: at('20:00'),
    anyStale: false,
    ...over,
  });
  return container;
}

const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim();

describe('Headline', () => {
  it('today in session: 오늘 · 등락률 · 기준 전일 종가 and ● 실시간', () => {
    const c = setup();
    expect(screen.getByText('오늘 · 등락률 · 기준 전일 종가')).toBeTruthy();
    expect(text(c.querySelector('.fresh'))).toBe('● 실시간 17:42:05');
  });

  it('after the close: ◌ 20:00 기준 (장 마감)', () => {
    const c = setup({ inSession: false, now: at('21:00') });
    expect(text(c.querySelector('.fresh'))).toBe('◌ 20:00 기준 (장 마감)');
  });

  it('holiday: last trading day label', () => {
    setup({ tradingDate: '2026-10-08', inSession: false, closeAt: kstEpoch('2026-10-08', '20:00:00') });
    expect(screen.getByText('10/8(목) · 등락률')).toBeTruthy();
  });

  it('scrubbing shows the time', () => {
    setup({ scrubT: at('14:32') });
    expect(screen.getByText('14:32 · 등락률')).toBeTruthy();
  });

  it('any stale row adds 일부 종목은 이전 데이터예요', () => {
    const c = setup({ anyStale: true });
    expect(text(c.querySelector('.fresh'))).toBe('● 실시간 17:42:05 · 일부 종목은 이전 데이터예요');
  });

  it('a failed last load hides ● 실시간 and says when the shown data is from', () => {
    const c = setup({ loadFailed: true, lastOkAt: at('17:20') });
    expect(text(c.querySelector('.fresh'))).toBe('◌ 17:20 기준 · 새로 받지 못했어요');
    expect(c.querySelector('.live')).toBeNull();
  });

  it('a failed first load (nothing shown yet) has no ● 실시간 either', () => {
    const c = setup({ loadFailed: true, lastOkAt: null, tradingDate: null });
    expect(text(c.querySelector('.fresh'))).toBe('◌ 새로 받지 못했어요');
  });
});
