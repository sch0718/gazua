// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lwcCharts, ResizeObserverStub } from '../../chart/lwcStub';
import { doneState, noTrades } from './resultFixture';
import ResultView from './ResultView.svelte';
import type { DoneState } from './runController.svelte';

vi.mock('lightweight-charts', async () => (await import('../../chart/lwcStub')).lwcModule());

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  lwcCharts.length = 0;
});
afterEach(() => vi.unstubAllGlobals());

function setup(state: DoneState = doneState()) {
  const onEdit = vi.fn();
  const onTrade = vi.fn();
  render(ResultView, { state, colorConvention: 'kr', onEdit, onTrade });
  return { onEdit, onTrade };
}

const tab = (name: string | RegExp) => screen.getByRole('radio', { name });

describe('ResultView', () => {
  it('머리줄: 기간 · 일봉 종류 · 받은 시각, 데모 배지', () => {
    setup();
    expect(screen.getByText('2023.10.11 ~ 2026.10.11 · KRX 일봉 · 10/12 14:05 받음')).toBeTruthy();
    expect(screen.getByText('데모 데이터')).toBeTruthy();
  });

  it('머리줄: 데이터가 요청보다 늦게 시작하면 실제 기간과 요청 시작일', () => {
    setup(
      doneState((s) => {
        s.meta.from = '2025-01-02';
        s.meta.to = '2026-10-08';
      }),
    );
    expect(screen.getByText('2025.01.02 ~ 2026.10.08 (요청 2023.10.11부터) · KRX 일봉 · 10/12 14:05 받음')).toBeTruthy();
  });

  it('종목별 탭: 모든 종목이 같은 날 시작해도 요청 시작일보다 늦으면 참여 시작일을 보인다', async () => {
    setup(
      doneState((s) => {
        s.meta.from = '2025-01-02';
        s.result.equity[0].date = '2025-01-02';
        s.result.perSymbol = s.result.perSymbol.map((p) => ({ ...p, firstDate: '2025-01-02' }));
      }),
    );
    await fireEvent.click(tab('종목별'));
    expect(screen.getAllByText('2025.01.02부터 참여')).toHaveLength(2);
  });

  it('데모가 아니면 배지가 없다', () => {
    setup(doneState((s) => (s.meta.demo = false)));
    expect(screen.queryByText('데모 데이터')).toBeNull();
  });

  it('요약 카드 4개', () => {
    setup();
    const cards = screen.getByRole('list', { name: '요약' });
    const items = within(cards).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items[0].textContent).toContain('총수익률');
    expect(within(items[0]).getByText('▲ +32.4%').className).toContain('up');
    expect(within(items[0]).getByText('보유 대비 +16.1%p')).toBeTruthy();
    expect(items[1].textContent).toContain('최대 낙폭');
    expect(items[1].textContent).toContain('−12.3%');
    expect(items[2].textContent).toContain('승률');
    expect(items[2].textContent).toContain('58.5%');
    expect(items[2].textContent).toContain('24승 17패');
    expect(items[3].textContent).toContain('거래 횟수');
    expect(items[3].textContent).toContain('41번');
    expect(items[3].textContent).toContain('평균 19일 보유');
  });

  it('비교 목록 4줄과 ▲▼ 색', () => {
    setup();
    const rows = within(screen.getByRole('list', { name: '비교 기준' })).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      '내 전략 ▲ +32.4%',
      '같은 종목 보유 ▲ +16.3%',
      'KODEX 200 ▼ −2.5%',
      'KOSPI ▲ +11.0%',
    ]);
    expect(within(rows[2]).getByText('▼ −2.5%').className).toContain('down');
  });

  it('지수·지정 종목 실패면 그 줄에 사유', () => {
    setup(
      doneState((s) => {
        s.meta.indexFailed = '기간 일부만 받았어요';
        s.meta.benchmarkFailed = true;
        s.result.benchmarks = { holdReturnPct: 16.3, indexReturnPct: null, benchmarkReturnPct: null };
      }),
    );
    const rows = within(screen.getByRole('list', { name: '비교 기준' })).getAllByRole('listitem');
    expect(rows[2].textContent).toContain('받지 못했어요');
    expect(rows[3].textContent).toContain('KOSPI');
    expect(rows[3].textContent).toContain('기간 일부만 받았어요');
  });

  it('지정 종목이 없으면 3줄', () => {
    setup(doneState((s) => (s.meta.strategy.benchmarks.symbol = null)));
    expect(within(screen.getByRole('list', { name: '비교 기준' })).getAllByRole('listitem')).toHaveLength(3);
  });

  it('세그먼트와 거래 내역: 매도 행은 ▲▼ + 색, 행을 누르면 onTrade', async () => {
    const { onTrade } = setup();
    expect(tab('거래 내역')).toBeTruthy();
    expect(tab('종목별')).toBeTruthy();
    expect(tab('건너뛴 신호 3')).toBeTruthy();
    const loss = screen.getByText('▼5.6%');
    expect(loss.className).toContain('down');
    expect(screen.getByText('▲15.0%').className).toContain('up');
    await fireEvent.click(screen.getByRole('button', { name: /03\.14 SK하이닉스/ }));
    expect(onTrade).toHaveBeenCalledWith(expect.objectContaining({ date: '2024-03-14', symbol: '000660' }));
  });

  it('거래 행을 누르면 그 종목의 거래 차트 시트가 열린다', async () => {
    setup();
    await fireEvent.click(screen.getByRole('button', { name: /04\.02 SK하이닉스/ }));
    expect(screen.getByRole('dialog', { name: 'SK하이닉스' })).toBeTruthy();
  });

  it('종목별 탭: 손익·참여 시작일·제외', async () => {
    setup();
    await fireEvent.click(tab('종목별'));
    expect(screen.getByText('2024.03.02부터 참여')).toBeTruthy();
    expect(screen.queryByText('2023.10.11부터 참여')).toBeNull();
    expect(screen.getByText('제외: 카카오 (기간 안에 데이터가 없어요)')).toBeTruthy();
    expect(screen.getByText('▼ −88,000원').className).toContain('down');
  });

  it('건너뛴 신호 탭: 날짜·종목·사유', async () => {
    setup();
    await fireEvent.click(tab('건너뛴 신호 3'));
    const rows = within(screen.getByRole('list', { name: '건너뛴 신호' })).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[2].textContent?.replace(/\s+/g, ' ').trim()).toBe('2024.08.05 삼성전자 현금 부족');
  });

  it('한계 안내 3줄', () => {
    setup();
    expect(screen.getByText('배당 제외 · 가격 수익률만이에요')).toBeTruthy();
    expect(screen.getByText('지금 관심종목만 넣을 수 있어서 상장폐지 종목이 빠져요(생존 편향)')).toBeTruthy();
    expect(screen.getByText('일봉으로 계산해서 하루 안의 순서는 시가→저가→고가→종가로 가정해요')).toBeTruthy();
  });

  it('거래 0건·건너뜀 0 → 신호 없음 안내와 규칙 고치기', async () => {
    const { onEdit } = setup(doneState((s) => noTrades(s)));
    expect(screen.getByText('기간 동안 매수 신호가 한 번도 나지 않았어요')).toBeTruthy();
    expect(screen.getByText('가장 크게 빠진 때도 8.2%였어요(조건 10%)')).toBeTruthy();
    expect(screen.queryByRole('list', { name: '요약' })).toBeNull();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.getByText('배당 제외 · 가격 수익률만이에요')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: '규칙 고치기' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('all-skipped result shows the dominant skip reason', () => {
    setup(
      doneState((s) =>
        noTrades(s, [
          { date: '2024-07-01', symbol: '000660', reason: '1주가 1회 금액보다 비쌈' },
          { date: '2024-07-02', symbol: '000660', reason: '현금 부족' },
          { date: '2024-08-05', symbol: '000660', reason: '1주가 1회 금액보다 비쌈' },
        ]),
      ),
    );
    expect(screen.getByText('매수 신호 3번이 모두 건너뛰어졌어요')).toBeTruthy();
    expect(screen.getByText('가장 많은 이유: 1주가 1회 금액보다 비쌈')).toBeTruthy();
    expect(within(screen.getByRole('list', { name: '건너뛴 신호' })).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('button', { name: '규칙 고치기' })).toBeTruthy();
  });
});
