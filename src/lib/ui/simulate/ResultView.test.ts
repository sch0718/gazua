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

  it('머리줄: 요청 시작일이 일요일이라 월요일에 시작해도 요청 문구가 없다', () => {
    setup(
      doneState((s) => {
        s.meta.strategy.period.from = '2026-03-01';
        s.meta.from = '2026-03-02';
        s.meta.to = '2026-06-30';
      }),
    );
    expect(screen.queryByText(/\(요청/)).toBeNull();
  });

  it('종목별 탭: 모든 종목이 데이터 축 시작일에 시작했으면 참여 시작일을 보이지 않는다', async () => {
    setup(
      doneState((s) => {
        s.meta.from = '2025-01-02';
        s.result.equity[0].date = '2025-01-02';
        s.result.perSymbol = s.result.perSymbol.map((p) => ({ ...p, firstDate: '2025-01-02' }));
      }),
    );
    await fireEvent.click(tab('종목별'));
    expect(screen.queryByText(/부터 참여/)).toBeNull();
  });

  it('종목별 탭: 한 종목만 축보다 3개월 늦으면 그 행만 참여 시작일을 보인다', async () => {
    setup(
      doneState((s) => {
        s.result.perSymbol = [
          { symbol: '005930', name: '삼성전자', pnl: 141_000, roundTrips: 1, firstDate: '2023-10-11' },
          { symbol: '000660', name: 'SK하이닉스', pnl: -88_000, roundTrips: 1, firstDate: '2024-01-11' },
        ];
      }),
    );
    await fireEvent.click(tab('종목별'));
    expect(screen.getAllByText(/부터 참여/)).toHaveLength(1);
    const rows = within(screen.getByRole('list', { name: '종목별' })).getAllByRole('listitem');
    expect(rows[1].textContent).toContain('2024.01.11부터 참여');
    expect(rows[0].textContent).not.toContain('부터 참여');
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
    expect(within(items[0]).getByText('그냥 보유보다 +16.1%p')).toBeTruthy();
    expect(items[1].textContent).toContain('최대 낙폭');
    expect(items[1].textContent).toContain('−12.3%');
    expect(items[2].textContent).toContain('승률');
    expect(items[2].textContent).toContain('58.5%');
    expect(items[2].textContent).toContain('24승 17패');
    expect(items[3].textContent).toContain('거래 횟수');
    expect(items[3].textContent).toContain('41번');
    expect(items[3].textContent).toContain('끝난 41번 · 아직 보유 1종목 · 평균 19일');
  });

  it('요약 카드: 토큰 클래스 — 총수익률만 headline 크기, 나머지는 title 크기', () => {
    setup();
    const items = within(screen.getByRole('list', { name: '요약' })).getAllByRole('listitem');
    expect(items.every((li) => li.classList.contains('card'))).toBe(true);
    expect(items[0].querySelector('.value')?.classList.contains('main')).toBe(true);
    expect(items.slice(1).every((li) => !li.querySelector('.value')?.classList.contains('main'))).toBe(true);
    expect(items.every((li) => li.querySelector('.value')?.classList.contains('num'))).toBe(true);
    expect([...document.querySelectorAll('.cards small')].every((el) => el.classList.contains('num'))).toBe(true);
  });

  it('거래 카드: 보유 중이 없으면 그 구절을 뺀다', () => {
    setup(doneState((s) => (s.result.summary.openPositions = 0)));
    const items = within(screen.getByRole('list', { name: '요약' })).getAllByRole('listitem');
    expect(items[3].textContent).toContain('끝난 41번 · 평균 19일');
    expect(items[3].textContent).not.toContain('아직 보유');
  });

  it('총수익률이 반올림해서 0.0%면 화살표도 색도 없다', () => {
    setup(doneState((s) => (s.result.summary.totalReturnPct = 0.04)));
    const v = within(screen.getByRole('list', { name: '요약' })).getAllByRole('listitem')[0].querySelector('.value')!;
    expect(v.textContent).toBe('0.0%');
    expect(v.className).not.toMatch(/\b(up|down)\b/);
  });

  it('비교 목록 4줄과 ▲▼ 색', () => {
    setup();
    const rows = within(screen.getByRole('list', { name: '비교 기준' })).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      '내 전략 ▲ +32.4%',
      '같은 종목 사서 보유 ▲ +16.3%',
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
    expect(rows[2].textContent?.replace(/\s+/g, ' ').trim()).toBe('2024.08.05 삼성전자 현금이 모자랐어요');
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
    expect(screen.getByText('고점 대비 가장 크게 빠진 때도 8.2%라, 하락 조건(10% 이상)에 닿지 않았어요')).toBeTruthy();
    expect(screen.queryByRole('list', { name: '요약' })).toBeNull();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.getByText('배당 제외 · 가격 수익률만이에요')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: '규칙 고치기' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith(); // 클릭 이벤트가 구역으로 넘어가면 안 된다
  });

  it('건너뛴 신호 탭이 비면 안내 문구', async () => {
    setup(doneState((s) => (s.result.skipped = [])));
    await fireEvent.click(tab('건너뛴 신호 0'));
    expect(screen.getByText('건너뛴 신호가 없어요')).toBeTruthy();
    expect(screen.queryByRole('list', { name: '건너뛴 신호' })).toBeNull();
  });

  it('전부 건너뜀: 제목 · 사유별 개수 · 안내, 규칙 고치기는 기간·자금 구역을 연다', async () => {
    const { onEdit } = setup(
      doneState((s) =>
        noTrades(s, [
          { date: '2024-07-01', symbol: '000660', reason: '1주가 1회 금액보다 비쌈' },
          { date: '2024-07-02', symbol: '000660', reason: '현금 부족' },
          { date: '2024-08-05', symbol: '000660', reason: '1주가 1회 금액보다 비쌈' },
        ]),
      ),
    );
    expect(screen.getByText('매수 신호가 3번 났지만 한 번도 사지 못했어요')).toBeTruthy();
    const counts = within(screen.getByRole('list', { name: '건너뛴 이유' })).getAllByRole('listitem');
    expect(counts.map((r) => r.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['1주가 회당 금액보다 비싸요 2번', '현금이 모자랐어요 1번']);
    expect(screen.getByText('기간·자금에서 회당 비중이나 처음 자금을 늘려 보세요')).toBeTruthy();
    expect(within(screen.getByRole('list', { name: '건너뛴 신호' })).getAllByRole('listitem')).toHaveLength(3);
    await fireEvent.click(screen.getByRole('button', { name: '규칙 고치기' }));
    expect(onEdit).toHaveBeenCalledWith('capital');
  });

  it('전부 건너뜀: 가장 많은 사유가 거래 없음이면 자금 안내도 구역 열기도 없다', async () => {
    const { onEdit } = setup(doneState((s) => noTrades(s, [{ date: '2024-07-01', symbol: '000660', reason: '거래 없음' }])));
    expect(screen.queryByText(/기간·자금에서/)).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: '규칙 고치기' }));
    expect(onEdit).toHaveBeenCalledWith();
  });
});
