// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import TradeList from './TradeList.svelte';
import { doneState } from './resultFixture';

const names = { '005930': '삼성전자', '000660': 'SK하이닉스' };

function setup(patch?: (t: ReturnType<typeof doneState>['result']['trades']) => void) {
  const trades = structuredClone(doneState().result.trades);
  patch?.(trades);
  const onTrade = vi.fn();
  render(TradeList, { trades, names, colorConvention: 'kr', onTrade });
  return { trades, onTrade };
}

describe('TradeList', () => {
  it('매수 행 문구', () => {
    setup();
    expect(screen.getByRole('button', { name: '03.14 SK하이닉스 · B 돌파 매수 · 12주 @ 132,400' })).toBeTruthy();
  });

  it('추가 매수 행', () => {
    setup((t) => t.splice(1, 0, { date: '2024-03-20', symbol: '000660', kind: 'add', price: 130_000, qty: 3, fee: 1, tax: 0, reason: '분할 매수' }));
    expect(screen.getByRole('button', { name: '03.20 SK하이닉스 · 추가 매수 · 3주 @ 130,000' })).toBeTruthy();
  });

  it('매도 행: 사유 + ▲▼ 손익, 색은 trendClass', () => {
    setup((t) => {
      t[3].pnlPct = 10;
      t[3].reason = '1단계 익절 50%';
      t[1].pnlPct = -5;
    });
    const gain = screen.getByRole('button', { name: '06.03 삼성전자 · 1단계 익절 50% · ▲10.0%' });
    expect(gain.querySelector('.pnl')?.className).toContain('up');
    const loss = screen.getByRole('button', { name: /04\.02 SK하이닉스 · 손절 · ▼5\.0%/ });
    expect(loss.querySelector('.pnl')?.className).toContain('down');
  });

  it('행을 누르면 onTrade(trade)', async () => {
    const { trades, onTrade } = setup();
    await fireEvent.click(screen.getByRole('button', { name: /04\.02 SK하이닉스/ }));
    expect(onTrade).toHaveBeenCalledWith(trades[1]);
  });
});
