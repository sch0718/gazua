// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import TradeList from './TradeList.svelte';
import { doneState } from './resultFixture';

const names = { '005930': '삼성전자', '000660': 'SK하이닉스' };

function setup(patch?: (t: ReturnType<typeof doneState>['result']['trades']) => void) {
  const trades = structuredClone(doneState().result.trades);
  patch?.(trades);
  const onTrade = vi.fn();
  render(TradeList, { trades, names, onTrade });
  return { trades, onTrade };
}

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim();

describe('TradeList', () => {
  it('매수 행: 1줄 종목명 + 오른쪽 값(수량 · 가격원), 2줄 날짜 · 사유, 끝에 ›', () => {
    setup();
    const row = screen.getByRole('button', { name: 'SK하이닉스 · 12주 · 132,400원 · 03.14 · B 돌파 매수' });
    expect(text(row.querySelector('.nm'))).toBe('SK하이닉스');
    expect(text(row.querySelector('.val'))).toBe('12주 · 132,400원');
    expect(row.querySelector('.val')?.classList.contains('num')).toBe(true);
    expect(text(row.querySelector('.sub'))).toBe('03.14 · B 돌파 매수');
    const chev = row.querySelector('.chev');
    expect(chev?.textContent).toBe('›');
    expect(chev?.getAttribute('aria-hidden')).toBe('true');
  });

  it('추가 매수 행', () => {
    setup((t) => t.splice(1, 0, { date: '2024-03-20', symbol: '000660', kind: 'add', price: 130_000, qty: 3, fee: 1, tax: 0, reason: '추가 매수' }));
    expect(screen.getByRole('button', { name: 'SK하이닉스 · 3주 · 130,000원 · 03.20 · 추가 매수' })).toBeTruthy();
  });

  it('매도 행: 값은 ▲▼ 수익률(trendReturn), 색은 returnClass, 익절 사유는 (N% 매도)', () => {
    setup((t) => {
      t[3].pnlPct = 10;
      t[3].reason = '1단계 익절 80%';
      t[1].pnlPct = -5;
    });
    const gain = screen.getByRole('button', { name: '삼성전자 · ▲ +10.0% · 06.03 · 1단계 익절(80% 매도) · 평단 대비' });
    expect(gain.querySelector('.val')?.className).toContain('up');
    const loss = screen.getByRole('button', { name: 'SK하이닉스 · ▼ −5.0% · 04.02 · 손절 · 평단 대비' });
    expect(loss.querySelector('.val')?.className).toContain('down');
  });

  it('손익이 반올림해서 0.0%면 화살표도 색도 없다', () => {
    setup((t) => (t[1].pnlPct = 0.04));
    const row = screen.getByRole('button', { name: 'SK하이닉스 · 0.0% · 04.02 · 손절 · 평단 대비' });
    expect(row.querySelector('.val')?.className).not.toMatch(/\b(up|down)\b/);
    expect(row.textContent).not.toMatch(/[▲▼]/);
  });

  it('해마다 연도 제목(h2) + 그해 거래 목록. 목록 항목 수는 거래 수와 같다', () => {
    setup((t) => t.push({ date: '2025-01-15', symbol: '005930', kind: 'buy', price: 71_000, qty: 10, fee: 1, tax: 0, reason: 'B 돌파' }));
    const group = screen.getByRole('group', { name: '거래 내역' });
    expect(within(group).getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['2024년', '2025년']);
    const y2024 = within(group).getByRole('list', { name: '2024년' });
    expect(within(y2024).getAllByRole('listitem').map((li) => text(li.querySelector('.sub')))).toEqual([
      '03.14 · B 돌파 매수',
      '04.02 · 손절 · 평단 대비',
      '05.02 · 3일 연속 상승 매수',
      '06.03 · 1단계 익절(100% 매도) · 평단 대비',
    ]);
    const y2025 = within(group).getByRole('list', { name: '2025년' });
    expect(within(y2025).getAllByRole('listitem').map((li) => text(li.querySelector('.sub')))).toEqual(['01.15 · B 돌파 매수']);
    // 연도 제목은 목록 항목이 아니다
    expect(within(group).getAllByRole('listitem')).toHaveLength(5);
  });

  it('매도 행 2줄과 접근 이름에만 `평단 대비`가 사유 뒤에 붙는다(매수·추가 행에는 없다)', () => {
    setup((t) => t.splice(1, 0, { date: '2024-03-20', symbol: '000660', kind: 'add', price: 130_000, qty: 3, fee: 1, tax: 0, reason: '추가 매수' }));
    const sell = screen.getByRole('button', { name: /04\.02/ });
    expect(text(sell.querySelector('.sub'))).toBe('04.02 · 손절 · 평단 대비');
    expect(sell.getAttribute('aria-label')).toMatch(/ · 04\.02 · 손절 · 평단 대비$/);
    for (const name of [/03\.14/, /03\.20/]) {
      const buy = screen.getByRole('button', { name });
      expect(text(buy.querySelector('.sub'))).not.toContain('평단 대비');
      expect(buy.getAttribute('aria-label')).not.toContain('평단 대비');
    }
  });

  it('안내 한 줄은 매도 행이 하나라도 있을 때만 보이고, 매수만 있으면 없다', () => {
    const NOTE = '매도 줄 %는 평균 단가 대비예요(수수료·세금 제외). 포지션 결과는 행을 눌러 확인해 주세요';
    const { unmount } = render(TradeList, { trades: structuredClone(doneState().result.trades), names, onTrade: vi.fn() });
    const note = screen.getByText(NOTE);
    expect(note.tagName).toBe('P');
    unmount();
    const buys = structuredClone(doneState().result.trades).filter((t) => t.kind === 'buy' || t.kind === 'add');
    render(TradeList, { trades: buys, names, onTrade: vi.fn() });
    expect(screen.queryByText(NOTE)).toBeNull();
    expect(screen.queryByText(/평단 대비/)).toBeNull();
  });

  it('행을 누르면 onTrade(trade)', async () => {
    const { trades, onTrade } = setup();
    await fireEvent.click(screen.getByRole('button', { name: /^SK하이닉스 · .* · 04\.02/ }));
    expect(onTrade).toHaveBeenCalledWith(trades[1]);
  });
});
