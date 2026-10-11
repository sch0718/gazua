// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { MetricCtx } from './MetricSheet.svelte';
import MetricSheet from './MetricSheet.svelte';

const D1: MetricCtx = { period: { unit: 'D', n: 1 }, index: 'ok', hasShares: true };

function setup(ctx: MetricCtx = D1) {
  const onselect = vi.fn();
  const onclose = vi.fn();
  render(MetricSheet, { open: true, current: 'change', ctx, onselect, onclose });
  return { onselect, onclose };
}
const row = (label: string) => screen.getByRole('button', { name: new RegExp(`^${label.replace(/[()]/g, '\\$&')} `) });

describe('MetricSheet', () => {
  it('lists every metric with its description and a mini graph', () => {
    setup();
    expect(screen.getByRole('dialog', { name: '비교 지표' })).toBeTruthy();
    expect(screen.getByText('모든 종목을 같은 기준으로 한 축에 놓아요')).toBeTruthy();
    expect(screen.getByText('기간 중 최고가에서 얼마나 내려왔나')).toBeTruthy();
    expect(document.querySelectorAll('svg polyline')).toHaveLength(7);
    expect(row('등락률').getAttribute('aria-pressed')).toBe('true');
  });

  it('on 1 day, 변동성 and RSI(14) are disabled with the reason; choosing one does nothing', async () => {
    const { onselect, onclose } = setup();
    for (const label of ['변동성', 'RSI(14)']) {
      const b = row(label);
      expect(b.getAttribute('aria-disabled')).toBe('true');
      expect(b.textContent).toContain('1개월 이상에서 볼 수 있어요');
    }
    await fireEvent.click(row('변동성'));
    expect(onselect).not.toHaveBeenCalled();
    expect(onclose).not.toHaveBeenCalled();
  });

  it('choosing an available metric selects it and closes', async () => {
    const { onselect, onclose } = setup();
    await fireEvent.click(row('고점 대비 하락률'));
    expect(onselect).toHaveBeenCalledWith('drawdown');
    expect(onclose).toHaveBeenCalled();
  });

  it('explains why 시장 대비 초과수익 and 시가총액 are unavailable', () => {
    setup({ period: { unit: 'M', n: 3 }, index: 'none', hasShares: false });
    expect(row('시장 대비 초과수익').textContent).toContain('이 데이터 소스는 지수 데이터를 주지 않아요');
    expect(row('시가총액').getAttribute('aria-disabled')).toBe('true');
    expect(row('시가총액').textContent).toContain('발행주식수 정보가 없어요');
    expect(row('변동성').textContent).toContain('곧 추가될 예정이에요');
  });
});
