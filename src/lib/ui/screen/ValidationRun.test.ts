// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import ValidationRun from './ValidationRun.svelte';

describe('ValidationRun', () => {
  it('shows 재선정일 계산 중 14/48 in a status region with a cancel button', async () => {
    const oncancel = vi.fn();
    render(ValidationRun, { running: true, progress: { done: 14, total: 48 }, oncancel, onfix: () => {} });
    expect(screen.getByRole('status').textContent).toBe('재선정일 계산 중 14/48');
    await fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(oncancel).toHaveBeenCalledOnce();
  });

  it('shows no counts before the total is known', () => {
    render(ValidationRun, { running: true, progress: { done: 0, total: 0 }, oncancel: () => {}, onfix: () => {} });
    expect(screen.getByRole('status').textContent).toBe('재선정일 계산 중');
  });

  it('a NaN failure shows the failure screen instead of a result, with a way back to the criteria', async () => {
    const onfix = vi.fn();
    render(ValidationRun, { running: false, progress: { done: 0, total: 0 }, error: 'invalid-number', oncancel: () => {}, onfix });
    expect(screen.getByRole('alert').textContent).toBe('계산 중 잘못된 숫자가 나왔어요');
    expect(screen.queryByRole('button', { name: '취소' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: '기준 고치기' }));
    expect(onfix).toHaveBeenCalledOnce();
  });

  it.each([
    ['no-rebalance', '기간 안에 재선정일이 없어요'],
    ['missing-strategy', '매매 규칙 전략이 지워졌어요'],
    ['invalid-strategy', '매매 규칙 전략에 고칠 곳이 있어요'],
    ['no-macro', '이 데이터에는 환율·유가가 없어요'],
    ['crash', '계산 중 문제가 생겼어요'],
  ] as const)('error %s reads %s', (error, text) => {
    render(ValidationRun, { running: false, progress: { done: 0, total: 0 }, error, oncancel: () => {}, onfix: () => {} });
    expect(screen.getByRole('alert').textContent).toBe(text);
  });
});
