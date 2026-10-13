// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResizeObserverStub } from '../../chart/lwcStub';
import { ApiError } from '../../providers/errors';
import { doneState } from './resultFixture';
import RunPanel from './RunPanel.svelte';
import runPanelSource from './RunPanel.svelte?raw';
import type { RunState } from './runController.svelte';

vi.mock('lightweight-charts', async () => (await import('../../chart/lwcStub')).lwcModule());

beforeEach(() => vi.stubGlobal('ResizeObserver', ResizeObserverStub));
afterEach(() => vi.unstubAllGlobals());

const scope = { stocks: 4, benchmark: true };

function setup(state: RunState, extra: { stale?: boolean } = {}) {
  const props = {
    state,
    ...extra,
    colorConvention: 'kr' as const,
    onEdit: vi.fn(),
    onRetry: vi.fn(),
    onCancel: vi.fn(),
    onIssueAction: vi.fn(),
  };
  render(RunPanel, props);
  return props;
}

describe('RunPanel', () => {
  it('받는 중: 진행 막대 + 문구 + 취소', async () => {
    const p = setup({ kind: 'loading', progress: { done: 3, total: 10, waiting: false }, scope });
    expect(screen.getByText('일봉 받는 중 3/10')).toBeTruthy();
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('3');
    expect(bar.getAttribute('aria-valuemax')).toBe('10');
    await fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(p.onCancel).toHaveBeenCalledTimes(1);
  });

  it('429로 기다리는 중이면 · 잠시 대기 중', () => {
    setup({ kind: 'loading', progress: { done: 4, total: 10, waiting: true }, scope });
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
    });
    // 종목 정보를 못 받은 종목은 따로(코드만 있으면 코드로)
    expect(screen.getByText('SK하이닉스 일봉을 받지 못했어요')).toBeTruthy();
    expect(screen.getByText('035720 종목 정보를 받지 못했어요. 빼고 계속할까요?')).toBeTruthy();
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
    await fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(p.onRetry).toHaveBeenCalledTimes(1);
  });

  it('모든 종목을 받지 못한 연결 문제: 던진 ApiError의 문구와 해결 행동', async () => {
    const p = setup({ kind: 'error', error: new ApiError('invalid-credentials'), text: '종목 일봉을 받지 못했어요' });
    expect(screen.getByText('키가 맞지 않아요')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: '키 다시 입력' }));
    expect(p.onIssueAction).toHaveBeenCalledWith('credentials');
    await fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(p.onRetry).toHaveBeenCalledTimes(1);
  });

  it('모든 종목을 받지 못함 + ApiError 아님: 종목 일봉 문구 + 진단 열기 + 다시 시도', async () => {
    const p = setup({ kind: 'error', error: new Error('all failed'), text: '종목 일봉을 받지 못했어요' });
    expect(screen.getByText('종목 일봉을 받지 못했어요')).toBeTruthy();
    expect(screen.queryByText('기간 안에 받은 데이터가 없어요')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: '진단 열기' }));
    expect(p.onIssueAction).toHaveBeenCalledWith('diagnostics');
    await fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
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

  it('일부 실패 문구: 받지 못한 종목만', () => {
    setup({ kind: 'partial', failed: [{ symbol: '000660', name: 'SK하이닉스', reason: '받지 못했어요' }], proceed: vi.fn() });
    expect(screen.getByText('SK하이닉스 일봉을 받지 못했어요. 빼고 계속할까요?')).toBeTruthy();
  });

  it('일부 실패 문구: 종목 정보를 받지 못한 종목만', () => {
    setup({ kind: 'partial', failed: [{ symbol: '035720', reason: '종목 정보를 받지 못했어요' }], proceed: vi.fn() });
    expect(screen.getByText('035720 종목 정보를 받지 못했어요. 빼고 계속할까요?')).toBeTruthy();
    expect(screen.queryByText(/일봉을 받지 못했어요/)).toBeNull();
  });

  it('일부 실패 문구: 기간 안 데이터 없음만', () => {
    setup({
      kind: 'partial',
      failed: [
        { symbol: '035720', name: '카카오', reason: '기간 안에 데이터가 없어요' },
        { symbol: '005930', name: '삼성전자', reason: '기간 안에 데이터가 없어요' },
      ],
      proceed: vi.fn(),
    });
    expect(screen.getByText('카카오, 삼성전자은(는) 이 기간에 데이터가 없어요. 빼고 계속할까요?')).toBeTruthy();
    expect(screen.queryByText(/일봉을 받지 못했어요/)).toBeNull();
  });

  it('일부 실패 문구: 섞이면 두 줄', () => {
    setup({
      kind: 'partial',
      failed: [
        { symbol: '000660', name: 'SK하이닉스', reason: '받지 못했어요' },
        { symbol: '035720', name: '카카오', reason: '기간 안에 데이터가 없어요' },
      ],
      proceed: vi.fn(),
    });
    expect(screen.getByText('SK하이닉스 일봉을 받지 못했어요')).toBeTruthy();
    expect(screen.getByText('카카오은(는) 이 기간에 데이터가 없어요. 빼고 계속할까요?')).toBeTruthy();
  });

  it('진행: 부가 줄에 종목 수 · 지수 · 비교 기준', () => {
    setup({ kind: 'loading', progress: { done: 0, total: 7, waiting: false }, scope });
    expect(screen.getByText('종목 4개 · 지수 · 비교 기준')).toBeTruthy();
  });

  it('진행: 비교 종목이 없으면 비교 기준 없이', () => {
    setup({ kind: 'loading', progress: { done: 1, total: 6, waiting: false }, scope: { stocks: 3, benchmark: false } });
    expect(screen.getByText('종목 3개 · 지수')).toBeTruthy();
  });

  it('진행: total이 0이면 숫자 없이 일봉 받는 중만', () => {
    setup({ kind: 'loading', progress: { done: 0, total: 0, waiting: false }, scope });
    expect(screen.getByText('일봉 받는 중')).toBeTruthy();
    expect(screen.queryByText(/0\/0/)).toBeNull();
  });

  it('진행 막대 트랙 색은 --line(.bar 규칙의 background)', () => {
    // jsdom은 컴포넌트 스타일을 계산하지 않으므로 소스의 .bar 규칙을 읽는다
    const rule = /\.bar\s*\{([^}]*)\}/.exec(runPanelSource)?.[1] ?? '';
    expect(rule).toMatch(/background:\s*var\(--line\)/);
    expect(rule).not.toMatch(/--surface2/);
  });

  it('글자 크기는 토큰, 좌우 여백은 --gutter(px 값 없음)', () => {
    const css = runPanelSource.slice(runPanelSource.indexOf('<style>'));
    expect(css).not.toMatch(/font-size:\s*\d+px/);
    for (const sel of ['.panel', '.hint']) {
      const body = new RegExp(`\\${sel}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
      expect(body, sel).toMatch(/padding:\s*24px var\(--gutter\)/);
    }
  });

  it('idle: 넓은 화면 안내 문구', () => {
    setup({ kind: 'idle' });
    expect(screen.getByText('규칙을 정하고 시뮬레이션 실행을 누르면 여기에 결과가 나와요')).toBeTruthy();
  });

  it('결과가 오래되면 배너 + 다시 실행, 본문은 흐리게', async () => {
    const p = setup(doneState(), { stale: true });
    expect(screen.getByText('규칙이 바뀌었어요. 다시 실행하면 결과에 반영돼요')).toBeTruthy();
    expect(document.querySelector('.dim')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: '다시 실행' }));
    expect(p.onRetry).toHaveBeenCalledTimes(1);
  });

  it('최신 결과에는 배너가 없다', () => {
    setup(doneState());
    expect(screen.queryByText('규칙이 바뀌었어요. 다시 실행하면 결과에 반영돼요')).toBeNull();
    expect(document.querySelector('.dim')).toBeNull();
  });
});
