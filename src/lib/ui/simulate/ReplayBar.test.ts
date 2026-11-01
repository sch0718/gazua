// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../share/testAxe';
import { createReplay } from './replay.svelte';
import ReplayBar from './ReplayBar.svelte';

const dates = ['2024-03-11', '2024-03-12', '2024-03-13', '2024-03-14', '2024-03-15'];
// 프레임을 부르지 않는 시계: 재생 상태만 바뀌고 날짜는 움직이지 않는다
const setup = () => {
  const replay = createReplay({ length: dates.length, now: () => 0, raf: () => 1, caf: () => {} });
  const r = render(ReplayBar, { replay, dates });
  return { replay, ...r };
};
const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim();

describe('ReplayBar', () => {
  it('처음: 재생 버튼, 마지막 날 날짜 줄, 안내 문구, range는 마지막 날', () => {
    const { container } = setup();
    const bar = screen.getByRole('group', { name: '재생' });
    expect(within(bar).getByRole('button', { name: '재생' })).toBeTruthy();
    expect(text(container.querySelector('.when'))).toBe('2024.03.15(금) · 5/5거래일');
    expect(within(bar).getByText('일봉 기준이라 하루 단위로 움직여요')).toBeTruthy();
    const range = within(bar).getByRole('slider', { name: '거래일' }) as HTMLInputElement;
    expect([range.min, range.max, range.step, range.value]).toEqual(['0', '4', '1', '4']);
    expect(range.getAttribute('aria-valuetext')).toBe('2024.03.15(금)');
  });

  it('▶을 누르면 처음으로 돌아가 재생, 버튼이 일시정지로 바뀌고 다시 누르면 멈춘다', async () => {
    const { replay, container } = setup();
    await fireEvent.click(screen.getByRole('button', { name: '재생' }));
    expect([replay.playing, replay.index]).toEqual([true, 0]);
    expect(text(container.querySelector('.when'))).toBe('2024.03.11(월) · 1/5거래일');
    await fireEvent.click(screen.getByRole('button', { name: '일시정지' }));
    expect(replay.playing).toBe(false);
    expect(screen.getByRole('button', { name: '재생' })).toBeTruthy();
  });

  it('배속: 1×·2×·4×·8×·16×, 누르면 바뀐다', async () => {
    const { replay } = setup();
    const speed = screen.getByRole('radiogroup', { name: '배속' });
    expect(within(speed).getAllByRole('radio').map((b) => b.textContent?.trim())).toEqual(['1×', '2×', '4×', '8×', '16×']);
    expect(within(speed).getByRole('radio', { name: '1×' }).getAttribute('aria-checked')).toBe('true');
    await fireEvent.click(within(speed).getByRole('radio', { name: '8×' }));
    expect(replay.speed).toBe(8);
    expect(within(speed).getByRole('radio', { name: '8×' }).getAttribute('aria-checked')).toBe('true');
  });

  it('range를 옮기면 그날로 이동하고 일시정지', async () => {
    const { replay, container } = setup();
    replay.play();
    // 이벤트 밖에서 바꾼 상태를 먼저 DOM에 반영한다(안 하면 남은 반영이 input 값을 0으로 덮어 seek(0)이 된다)
    flushSync();
    await fireEvent.input(screen.getByRole('slider', { name: '거래일' }), { target: { value: '2' } });
    expect([replay.index, replay.playing, replay.touched]).toEqual([2, false, true]);
    expect(text(container.querySelector('.when'))).toBe('2024.03.13(수) · 3/5거래일');
    expect(screen.getByRole('slider', { name: '거래일' }).getAttribute('aria-valuetext')).toBe('2024.03.13(수)');
  });

  it('range에서 Space는 재생/일시정지를 한 번만 바꾸고 기본 동작을 막는다', async () => {
    const { replay } = setup();
    const range = screen.getByRole('slider', { name: '거래일' });
    const notPrevented = await fireEvent.keyDown(range, { key: ' ' });
    expect(notPrevented).toBe(false);
    expect(replay.playing).toBe(true);
    await fireEvent.keyDown(range, { key: ' ' });
    expect(replay.playing).toBe(false);
  });

  it('멈췄을 때만 날짜를 live 영역으로 알린다', async () => {
    const { container } = setup();
    const live = container.querySelector('[aria-live="polite"]')!;
    expect(text(live)).toBe('2024.03.15(금)');
    await fireEvent.click(screen.getByRole('button', { name: '재생' }));
    expect(text(live)).toBe('');
  });

  it('axe 위반이 없다', async () => {
    const { container } = setup();
    await expectNoAxeViolations(container);
  });
});
