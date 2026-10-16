// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import SectorPicker from './SectorPicker.svelte';

const sectors = [
  { code: '00013', name: '전기·전자', level: 1 as const },
  { code: '00016', name: '금융', level: 1 as const },
  { code: '00027', name: '제조', level: 2 as const },
  { code: '00099', name: '소분류', level: 3 as const },
];

describe('SectorPicker', () => {
  it('empty selection means every sector; level 1 is listed, level 2 is behind a button, level 3 never', async () => {
    render(SectorPicker, { sectors, selected: [], onchange: vi.fn() });
    expect(screen.getByText('전체 업종')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: '전기·전자' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: '제조' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: '중분류 펼치기' }));
    expect(screen.getByRole('checkbox', { name: '제조' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: '소분류' })).toBeNull();
  });

  it('checking adds the code, unchecking removes it, and the summary counts them', async () => {
    const onchange = vi.fn();
    const { rerender } = render(SectorPicker, { sectors, selected: [], onchange });
    await fireEvent.click(screen.getByRole('checkbox', { name: '금융' }));
    expect(onchange).toHaveBeenLastCalledWith(['00016']);
    await rerender({ sectors, selected: ['00016', '00013'], onchange });
    expect(screen.getByText('2개 선택')).toBeTruthy();
    await fireEvent.click(screen.getByRole('checkbox', { name: '금융' }));
    expect(onchange).toHaveBeenLastCalledWith(['00013']);
    await fireEvent.click(screen.getByRole('button', { name: '전체 업종으로' }));
    expect(onchange).toHaveBeenLastCalledWith([]);
  });

  it('with no sector list says so instead of an empty list', () => {
    render(SectorPicker, { sectors: [], selected: [], onchange: vi.fn() });
    expect(screen.getByText('업종 정보가 없어요')).toBeTruthy();
  });
});
