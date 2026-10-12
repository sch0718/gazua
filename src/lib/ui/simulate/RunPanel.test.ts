// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResizeObserverStub } from '../../chart/lwcStub';
import { ApiError } from '../../providers/errors';
import RunPanel from './RunPanel.svelte';
import type { RunState } from './runController.svelte';

vi.mock('lightweight-charts', async () => (await import('../../chart/lwcStub')).lwcModule());

beforeEach(() => vi.stubGlobal('ResizeObserver', ResizeObserverStub));
afterEach(() => vi.unstubAllGlobals());

function setup(state: RunState) {
  const props = {
    state,
    colorConvention: 'kr' as const,
    onEdit: vi.fn(),
    onRetry: vi.fn(),
    onCancel: vi.fn(),
    onTrade: vi.fn(),
    onIssueAction: vi.fn(),
  };
  render(RunPanel, props);
  return props;
}

describe('RunPanel', () => {
  it('받는 중: 진행 막대 + 문구 + 취소', async () => {
    const p = setup({ kind: 'loading', progress: { done: 3, total: 10, waiting: false } });
    expect(screen.getByText('일봉 받는 중 3/10')).toBeTruthy();
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('3');
    expect(bar.getAttribute('aria-valuemax')).toBe('10');
    await fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(p.onCancel).toHaveBeenCalledTimes(1);
  });

  it('429로 기다리는 중이면 · 잠시 대기 중', () => {
    setup({ kind: 'loading', progress: { done: 4, total: 10, waiting: true } });
    expect(screen.getByText('일봉 받는 중 4/10 · 잠시 대기 중')).toBeTruthy();
  });

  it('일부 실패: 빼고 계속 · 취소', async () => {
    const proceed = vi.fn();
    const p = setup({
      kind: 'partial',
      failed: [
        { symbol: '000660', name: 'SK하이닉스', reason: '받지 못했어요' },
        { symbol: '035720', reason: '종목 정보를 받지 못했어요' },
      ],
      proceed,
      cancel: vi.fn(),
    });
    expect(screen.getByText('SK하이닉스, 035720 일봉을 받지 못했어요. 빼고 계속할까요?')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: '빼고 계속' }));
    expect(proceed).toHaveBeenCalledTimes(1);
    await fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(p.onCancel).toHaveBeenCalledTimes(1);
  });

  it('연결 오류: 기존 배너 문구와 해결 행동', async () => {
    const p = setup({ kind: 'error', error: new ApiError('proxy-unreachable') });
    expect(screen.getByText('프록시에 연결할 수 없어요')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: '진단 열기' }));
    expect(p.onIssueAction).toHaveBeenCalledWith('diagnostics');
    await fireEvent.click(screen.getByRole('button', { name: '다시 실행' }));
    expect(p.onRetry).toHaveBeenCalledTimes(1);
  });

  it('데이터 없음: 연결 배너 없이 안내와 규칙 고치기, 실패 목록', async () => {
    const p = setup({ kind: 'noData', failed: [{ symbol: '000660', name: 'SK하이닉스', reason: '받지 못했어요' }] });
    expect(screen.getByText('기간 안에 받은 데이터가 없어요')).toBeTruthy();
    expect(screen.getByText('SK하이닉스 (받지 못했어요)')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: '빼고 계속' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: '규칙 고치기' }));
    expect(p.onEdit).toHaveBeenCalledTimes(1);
  });

  it('엔진 예외: 계산 중 문제가 생겼어요 + 다시 실행', async () => {
    const p = setup({ kind: 'crash' });
    expect(screen.getByText('계산 중 문제가 생겼어요')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: '다시 실행' }));
    expect(p.onRetry).toHaveBeenCalledTimes(1);
  });
});
