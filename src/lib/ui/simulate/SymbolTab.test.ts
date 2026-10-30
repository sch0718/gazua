// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import SymbolTab from './SymbolTab.svelte';
import { doneState } from './resultFixture';

describe('SymbolTab 자금 대비 %', () => {
  it('누락은 —로, 실제 0은 0.00%로 표시하고 금액은 노출하지 않는다', () => {
    render(SymbolTab, { perSymbol: doneState().result.perSymbol, axisFrom: '2023-10-11', failed: [], colorConvention: 'kr', pnlPct: { '005930': 0 } });
    const rows = within(screen.getByRole('list', { name: '종목별' })).getAllByRole('listitem');
    expect(within(rows[0]).getByText('자금 대비 0.00%')).toBeTruthy();
    expect(within(rows[1]).getByText('—')).toBeTruthy();
    expect(rows[1].textContent).not.toContain('원');
    expect(rows[1].querySelector('.num')?.className).not.toMatch(/\b(up|down)\b/);
  });
});
