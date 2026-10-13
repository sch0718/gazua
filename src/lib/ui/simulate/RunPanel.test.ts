// @vitest-environment jsdom
import { configure, fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResizeObserverStub } from '../../chart/lwcStub';
import { ApiError } from '../../providers/errors';
import { doneState } from './resultFixture';
import RunPanel from './RunPanel.svelte';
import runPanelSource from './RunPanel.svelte?raw';
import resultViewSource from './ResultView.svelte?raw';
import type { RunState } from './runController.svelte';

vi.mock('lightweight-charts', async () => (await import('../../chart/lwcStub')).lwcModule());

// 늘 있는 라이브 영역(sr-only)은 보이는 문구와 같은 글을 담으므로 글 찾기에서 뺀다
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  configure({ defaultIgnore: 'script, style, [data-live]' });
});
afterEach(() => {
  vi.unstubAllGlobals();
  configure({ defaultIgnore: 'script, style' });
});

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
  const view = render(RunPanel, props);
  return { ...props, view, rerender: (next: Partial<typeof props>) => view.rerender({ ...props, ...next }) };
}

const live = () => document.querySelector('[data-live]') as HTMLElement;
const root = () => document.querySelector('.run-panel') as HTMLElement;
const loading = (done: number, waiting = false): RunState => ({ kind: 'loading', progress: { done, total: 10, waiting }, scope });

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

  it('결과가 오래되면 배너 + 다시 실행, 결과에 `이전 결과` 표시와 왼쪽 강조선(투명도 없음)', async () => {
    const p = setup(doneState(), { stale: true });
    expect(screen.getByText('규칙이 바뀌었어요. 다시 실행하면 결과에 반영돼요')).toBeTruthy();
    const result = screen.getByRole('region', { name: '시뮬레이션 결과' });
    expect(result.classList.contains('stale')).toBe(true);
    expect(within(result).getByText('이전 결과')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: '다시 실행' }));
    expect(p.onRetry).toHaveBeenCalledTimes(1);
  });

  it('오래된 결과도 흐리게(opacity) 하지 않는다: 글자 대비와 거래 차트 시트를 지킨다', () => {
    const css = (src: string) => src.slice(src.indexOf('<style>'));
    expect(css(runPanelSource)).not.toMatch(/opacity/);
    expect(css(resultViewSource)).not.toMatch(/opacity/);
    const stale = /\.result\.stale\s*\{([^}]*)\}/.exec(resultViewSource)?.[1] ?? '';
    expect(stale).toMatch(/border-left:[^;]*var\(--accent\)/);
  });

  it('최신 결과에는 배너도 이전 결과 표시도 없다', () => {
    setup(doneState());
    expect(screen.queryByText('규칙이 바뀌었어요. 다시 실행하면 결과에 반영돼요')).toBeNull();
    expect(screen.queryByText('이전 결과')).toBeNull();
    expect(screen.getByRole('region', { name: '시뮬레이션 결과' }).classList.contains('stale')).toBe(false);
  });

  describe('알림(라이브 영역 하나)', () => {
    it('받는 중: 시작·대기만 알리고, n/m이 늘 때는 알림 글이 그대로', async () => {
      const p = setup({ kind: 'idle' });
      expect(live().getAttribute('role')).toBe('status');
      await p.rerender({ state: loading(3) });
      expect(live().textContent).toBe('일봉 받는 중');
      // 보이는 진행 문구는 라이브 영역이 아니다
      expect(screen.getByText('일봉 받는 중 3/10').getAttribute('role')).toBeNull();
      await p.rerender({ state: loading(4) });
      expect(live().textContent).toBe('일봉 받는 중');
      await p.rerender({ state: loading(4, true) });
      expect(live().textContent).toBe('일봉 받는 중 · 잠시 대기 중');
    });

    it('대기가 풀리면(대기 중 → 받는 중) 다시 알리지 않고, 또 기다리면 다시 알린다', async () => {
      const p = setup({ kind: 'idle' });
      await p.rerender({ state: loading(3) });
      await p.rerender({ state: loading(4, true) });
      expect(live().textContent).toBe('일봉 받는 중 · 잠시 대기 중');
      await p.rerender({ state: loading(5) });
      expect(live().textContent).not.toBe('일봉 받는 중');
      expect(live().textContent).toBe('');
      await p.rerender({ state: loading(6, true) });
      expect(live().textContent).toBe('일봉 받는 중 · 잠시 대기 중');
    });

    it('다시 그려질 때(폰의 결과 버튼)는 비워 두고, 상태가 바뀔 때만 채운다', async () => {
      for (const state of [doneState(), loading(3), loading(3, true), { kind: 'crash' } as RunState]) {
        const p = setup(state);
        expect(live().textContent, state.kind).toBe('');
        // 같은 상태로 다시 그려도(n/m만 바뀜) 알리지 않는다
        if (state.kind === 'loading') {
          await p.rerender({ state: loading(4, state.progress.waiting) });
          expect(live().textContent).toBe('');
        }
        p.view.unmount();
      }
      const p = setup(loading(9));
      await p.rerender({ state: doneState() });
      expect(live().textContent).toBe('결과가 나왔어요');
    });

    it('결과가 나오면 결과가 나왔어요', async () => {
      const p = setup(loading(9));
      const el = live();
      await p.rerender({ state: doneState() });
      expect(live()).toBe(el); // 같은 영역(늘 있다)
      expect(el.textContent).toBe('결과가 나왔어요');
    });

    it('일부 실패는 질문 글, 데이터 없음·엔진 예외는 그 문구', async () => {
      const p = setup(loading(9));
      await p.rerender({ state: { kind: 'partial', failed: [{ symbol: '000660', name: 'SK하이닉스', reason: '받지 못했어요' }], proceed: vi.fn() } });
      expect(live().textContent).toBe('SK하이닉스 일봉을 받지 못했어요. 빼고 계속할까요?');
      await p.rerender({ state: { kind: 'noData', failed: [] } });
      expect(live().textContent).toBe('기간 안에 받은 데이터가 없어요');
      await p.rerender({ state: { kind: 'crash' } });
      expect(live().textContent).toBe('계산 중 문제가 생겼어요');
    });

    it('연결 오류는 Banner(alert) 하나만 알린다', async () => {
      const p = setup(loading(1));
      await p.rerender({ state: { kind: 'error', error: new ApiError('proxy-unreachable') } });
      expect(screen.getAllByRole('alert')).toHaveLength(1);
      expect(live().textContent).toBe('');
    });
  });

  describe('포커스: 누른 버튼이 사라지면 결과 자리로', () => {
    it('엔진 예외의 다시 실행 → 받는 중', async () => {
      const p = setup({ kind: 'crash' });
      screen.getByRole('button', { name: '다시 실행' }).focus();
      await p.rerender({ state: loading(0) });
      expect(document.activeElement).toBe(root());
    });

    it('연결 오류의 다시 시도 → 받는 중', async () => {
      const p = setup({ kind: 'error', error: new ApiError('proxy-unreachable') });
      screen.getByRole('button', { name: '다시 시도' }).focus();
      await p.rerender({ state: loading(0) });
      expect(document.activeElement).toBe(root());
    });

    it('빼고 계속 → 결과', async () => {
      const p = setup({ kind: 'partial', failed: [{ symbol: '000660', name: 'SK하이닉스', reason: '받지 못했어요' }], proceed: vi.fn() });
      screen.getByRole('button', { name: '빼고 계속' }).focus();
      await p.rerender({ state: doneState() });
      expect(document.activeElement).toBe(root());
    });

    it('오래된 결과 배너의 다시 실행 → 받는 중', async () => {
      const p = setup(doneState(), { stale: true });
      screen.getByRole('button', { name: '다시 실행' }).focus();
      await p.rerender({ state: loading(0), stale: false });
      expect(document.activeElement).toBe(root());
    });

    it('포커스가 패널 밖(편집기의 실행 버튼 등)에 있으면 가져오지 않는다', async () => {
      const outside = document.createElement('button');
      document.body.append(outside);
      try {
        const p = setup(loading(9));
        outside.focus();
        await p.rerender({ state: doneState() });
        expect(document.activeElement).toBe(outside);
      } finally {
        outside.remove();
      }
    });

    it('받는 중이면 포커스 받는 자리(결과 자리)의 이름이 보이는 진행 줄이다(폰에서 받는 중으로 새로 그려질 때 읽힌다)', async () => {
      const p = setup(loading(0));
      root().focus();
      const named = screen.getByRole('region', { name: '일봉 받는 중 0/10' });
      expect(named).toBe(root());
      expect(document.activeElement).toBe(named);
      // 받는 중이 아니면 이름 없는 자리(영역 역할도 없다)
      await p.rerender({ state: doneState() });
      expect(root().getAttribute('role')).toBeNull();
      expect(root().hasAttribute('aria-labelledby')).toBe(false);
    });

    it('처음 그릴 때는 포커스를 옮기지 않는다', () => {
      setup({ kind: 'idle' });
      expect(document.activeElement).toBe(document.body);
    });
  });
});
