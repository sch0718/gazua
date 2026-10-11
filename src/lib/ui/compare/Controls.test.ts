// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import type { ComponentProps } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import type { Venue } from '../../market/tradable';
import Controls from './Controls.svelte';

const KIS: Venue[] = ['KRX', 'NXT', 'UNIFIED'];
const TOSS: Venue[] = ['UNIFIED'];

function setup(over: Record<string, unknown> = {}) {
  const props = {
    period: { unit: 'D', n: 1 },
    venueMode: 'AUTO',
    venues: KIS,
    autoVenue: 'KRX',
    metricLabel: '등락률',
    onperiod: vi.fn(),
    onvenue: vi.fn(),
    onopenmetric: vi.fn(),
    ...over,
  };
  const r = render(Controls, props as unknown as ComponentProps<typeof Controls>);
  return { props, ...r };
}

const chipTexts = () =>
  screen
    .queryAllByRole('button')
    .map((b) => b.textContent?.trim())
    .filter((t) => /^\d+(주|개월)$/.test(t ?? ''));

describe('Controls', () => {
  it('일 has no count chips; choosing 주 asks for a 2-week period', async () => {
    const { props } = setup();
    expect(chipTexts()).toEqual([]);
    await fireEvent.click(screen.getByRole('radio', { name: '주' }));
    expect(props.onperiod).toHaveBeenCalledWith({ unit: 'W', n: 2 });
  });

  it('주 shows 1주 2주 3주 4주 chips; picking one sets n', async () => {
    const { props } = setup({ period: { unit: 'W', n: 2 } });
    expect(chipTexts()).toEqual(['1주', '2주', '3주', '4주']);
    expect(screen.getByRole('button', { name: '2주' }).getAttribute('aria-pressed')).toBe('true');
    await fireEvent.click(screen.getByRole('button', { name: '3주' }));
    expect(props.onperiod).toHaveBeenCalledWith({ unit: 'W', n: 3 });
  });

  it('월 shows six chips', () => {
    setup({ period: { unit: 'M', n: 3 } });
    expect(chipTexts()).toEqual(['1개월', '2개월', '3개월', '4개월', '5개월', '6개월']);
  });

  it('년 has no count chips', () => {
    setup({ period: { unit: 'Y', n: 1 } });
    expect(chipTexts()).toEqual([]);
  });

  it('switching unit keeps a valid n, otherwise picks the default', async () => {
    const w3 = setup({ period: { unit: 'W', n: 3 } });
    await fireEvent.click(screen.getByRole('radio', { name: '월' }));
    expect(w3.props.onperiod).toHaveBeenLastCalledWith({ unit: 'M', n: 3 });
    w3.unmount();

    const m5 = setup({ period: { unit: 'M', n: 5 } });
    await fireEvent.click(screen.getByRole('radio', { name: '주' }));
    expect(m5.props.onperiod).toHaveBeenLastCalledWith({ unit: 'W', n: 2 });
    await fireEvent.click(screen.getByRole('radio', { name: '년' }));
    expect(m5.props.onperiod).toHaveBeenLastCalledWith({ unit: 'Y', n: 1 });
    m5.unmount();

    const w1 = setup({ period: { unit: 'W', n: 1 } });
    await fireEvent.click(screen.getByRole('radio', { name: '월' }));
    expect(w1.props.onperiod).toHaveBeenLastCalledWith({ unit: 'M', n: 1 });
  });

  it('the metric chip opens the metric sheet', async () => {
    const { props } = setup({ metricLabel: '고점 대비 하락률' });
    await fireEvent.click(screen.getByRole('button', { name: '고점 대비 하락률' }));
    expect(props.onopenmetric).toHaveBeenCalledTimes(1);
  });

  it('auto mode shows the current venue as sub text and the KRX-first note', () => {
    setup({ autoVenue: 'NXT' });
    const auto = screen.getByRole('radio', { name: /자동/ });
    expect(auto.getAttribute('aria-checked')).toBe('true');
    expect(auto.querySelector('small')?.textContent).toBe('NXT');
    expect(screen.getByText('KRX 우선 · KRX가 쉴 때만 NXT')).toBeTruthy();
  });

  it('auto mode outside sessions shows — as sub text', () => {
    setup({ autoVenue: null });
    expect(screen.getByRole('radio', { name: /자동/ }).querySelector('small')?.textContent).toBe('—');
  });

  it('a manual venue has no sub text and no auto note', async () => {
    const { props } = setup({ venueMode: 'KRX' });
    expect(screen.getByRole('radio', { name: '자동' }).querySelector('small')).toBeNull();
    expect(screen.queryByText('KRX 우선 · KRX가 쉴 때만 NXT')).toBeNull();
    await fireEvent.click(screen.getByRole('radio', { name: 'NXT' }));
    expect(props.onvenue).toHaveBeenCalledWith('NXT');
  });

  it('Toss: KRX·NXT (and 자동) are disabled, 통합 is selected, with 토스는 통합 시세만 제공해요', async () => {
    const { props } = setup({ venues: TOSS, venueMode: 'AUTO' });
    for (const name of ['KRX', 'NXT', '자동']) {
      const opt = screen.getByRole('radio', { name });
      expect(opt.getAttribute('aria-disabled')).toBe('true');
      expect(opt.getAttribute('title')).toBe('토스는 통합 시세만 제공해요');
    }
    expect(screen.getByRole('radio', { name: '통합' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('토스는 통합 시세만 제공해요')).toBeTruthy();
    await fireEvent.click(screen.getByRole('radio', { name: 'KRX' }));
    expect(props.onvenue).not.toHaveBeenCalled();
  });
});
