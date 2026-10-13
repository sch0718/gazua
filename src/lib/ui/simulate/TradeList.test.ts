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
    const gain = screen.getByRole('button', { name: '삼성전자 · ▲ +10.0% · 06.03 · 1단계 익절(80% 매도)' });
    expect(gain.querySelector('.val')?.className).toContain('up');
    const loss = screen.getByRole('button', { name: 'SK하이닉스 · ▼ −5.0% · 04.02 · 손절' });
    expect(loss.querySelector('.val')?.className).toContain('down');
  });

  it('손익이 반올림해서 0.0%면 화살표도 색도 없다', () => {
    setup((t) => (t[1].pnlPct = 0.04));
    const row = screen.getByRole('button', { name: 'SK하이닉스 · 0.0% · 04.02 · 손절' });
    expect(row.querySelector('.val')?.className).not.toMatch(/\b(up|down)\b/);
    expect(row.textContent).not.toMatch(/[▲▼]/);
  });

  it('해가 바뀌면 연도 구분선(첫 해 포함)', () => {
    setup((t) => t.push({ date: '2025-01-15', symbol: '005930', kind: 'buy', price: 71_000, qty: 10, fee: 1, tax: 0, reason: 'B 돌파' }));
    const list = screen.getByRole('list', { name: '거래 내역' });
    expect(within(list).getAllByRole('heading').map((h) => h.textContent)).toEqual(['2024년', '2025년']);
    // 구분선 다음 행이 그해 첫 거래
    const items = within(list).getAllByRole('listitem');
    expect(items.map((li) => li.querySelector('h2')?.textContent ?? text(li.querySelector('.sub')))).toEqual([
      '2024년',
      '03.14 · B 돌파 매수',
      '04.02 · 손절',
      '05.02 · 3일 연속 상승 매수',
      '06.03 · 1단계 익절(100% 매도)',
      '2025년',
      '01.15 · B 돌파 매수',
    ]);
  });

  it('행을 누르면 onTrade(trade)', async () => {
    const { trades, onTrade } = setup();
    await fireEvent.click(screen.getByRole('button', { name: /^SK하이닉스 · .* · 04\.02/ }));
    expect(onTrade).toHaveBeenCalledWith(trades[1]);
  });
});
