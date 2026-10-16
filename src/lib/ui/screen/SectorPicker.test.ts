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
  it('같은 (레벨, 이름)의 업종은 시장이 달라도 한 줄이고, 고르면 그 코드를 모두 넣는다(R10)', async () => {
    const dup = [
      { code: '00013', name: '전기·전자', level: 1 as const },
      { code: '11028', name: '전기·전자', level: 1 as const },
      { code: '00016', name: '금융', level: 1 as const },
    ];
    const onchange = vi.fn();
    const { rerender } = render(SectorPicker, { sectors: dup, selected: [], onchange });
    expect(screen.getAllByRole('checkbox', { name: '전기·전자' })).toHaveLength(1);
    await fireEvent.click(screen.getByRole('checkbox', { name: '전기·전자' }));
    expect(onchange).toHaveBeenLastCalledWith(['00013', '11028']);
    // 코드 하나만 저장돼 있어도 체크로 보이고, 요약은 줄 수로 센다
    await rerender({ sectors: dup, selected: ['11028', '00016'], onchange });
    expect((screen.getByRole('checkbox', { name: '전기·전자' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText('2개 선택')).toBeTruthy();
    await fireEvent.click(screen.getByRole('checkbox', { name: '전기·전자' }));
    expect(onchange).toHaveBeenLastCalledWith(['00016']);
  });
});
