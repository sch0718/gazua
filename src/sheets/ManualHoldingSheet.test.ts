// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import ManualHoldingSheet, { type Draft } from './ManualHoldingSheet.svelte';

const draft: Draft = { id: null, symbol: '005930', name: '삼성전자', qty: null, avgPrice: null, account: '기타' };

function setup() {
  const onsave = vi.fn();
  render(ManualHoldingSheet, { open: true, draft, labels: ['ISA'], onsave, ondelete: vi.fn(), onclose: vi.fn() });
  return onsave;
}

describe('ManualHoldingSheet', () => {
  it('수량·평단·라벨을 숫자와 문자로 넘긴다(평단은 비워 둘 수 있다)', async () => {
    const onsave = setup();
    await fireEvent.input(screen.getByLabelText('수량(주)'), { target: { value: '5' } });
    await fireEvent.input(screen.getByLabelText('계좌 라벨'), { target: { value: '연금저축' } });
    await fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(onsave).toHaveBeenCalledWith({ ...draft, qty: 5, avgPrice: null, account: '연금저축' });
  });

  it('평단을 넣으면 숫자로 넘긴다', async () => {
    const onsave = setup();
    await fireEvent.input(screen.getByLabelText('수량(주)'), { target: { value: '3' } });
    await fireEvent.input(screen.getByLabelText(/평균 매수가/), { target: { value: '70000' } });
    await fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(onsave).toHaveBeenCalledWith(expect.objectContaining({ qty: 3, avgPrice: 70000 }));
  });

  it('수량이 없으면 저장하지 않고 알린다', async () => {
    const onsave = setup();
    await fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(onsave).not.toHaveBeenCalled();
  });
});
