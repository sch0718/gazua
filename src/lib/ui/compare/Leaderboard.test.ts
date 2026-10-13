// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { kstEpoch } from '../../time/kst';
import Leaderboard from './Leaderboard.svelte';
import type { LeaderRow } from './rows';

const NOW = kstEpoch('2026-10-12', '17:42:00');

const row = (symbol: string, value: number | null, over: Partial<LeaderRow> = {}): LeaderRow => ({
  symbol,
  name: `종목${symbol}`,
  slot: 1,
  badges: [],
  value,
  price: 10_000,
  hidden: false,
  ...over,
});

function setup(rows: LeaderRow[], over: Record<string, unknown> = {}) {
  const props = {
    rows,
    frozenOrder: null,
    unit: '%' as const,
    conv: 'kr' as const,
    metricLabel: '등락률',
    count: rows.length,
    scrubLabel: null,
    now: NOW,
    onselect: vi.fn(),
    ontogglehidden: vi.fn(),
    onreorder: vi.fn(),
    onopenadd: vi.fn(),
    ...over,
  };
  const view = render(Leaderboard, props);
  return Object.assign(props, {
    component: view.component as { indexOf: (symbol: string) => number },
    unmount: () => view.unmount(),
    rerender: (next: Record<string, unknown>) => view.rerender({ ...props, ...next }),
  });
}

const order = () => screen.getAllByRole('listitem').map((li) => li.dataset.symbol);
const rowOf = (symbol: string) => screen.getAllByRole('listitem').find((li) => li.dataset.symbol === symbol)!;
const mainBtn = (symbol: string) => rowOf(symbol).querySelector<HTMLButtonElement>('button.main-btn')!;

// 포인터/키보드 구분은 모듈 전체가 나눠 쓴다. 테스트마다 키 입력으로 처음 상태(키보드)로 되돌린다.
beforeEach(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }));
});

describe('Leaderboard', () => {
  it('sorts by value, highest first; rows without a value go last', () => {
    setup([row('A', 1), row('B', 3), row('C', null), row('D', 2)]);
    expect(order()).toEqual(['B', 'D', 'A', 'C']);
  });

  it('keeps frozenOrder while scrubbing', () => {
    setup([row('A', 1), row('B', 3), row('C', null), row('D', 2)], { frozenOrder: ['C', 'A', 'D', 'B'] });
    expect(order()).toEqual(['C', 'A', 'D', 'B']);
  });

  it('leaderboard row shows 데이터 없음', () => {
    setup([row('A', null)]);
    expect(within(rowOf('A')).getByText('데이터 없음')).toBeTruthy();
  });

  it('a row with an error shows the error instead', () => {
    setup([row('A', null, { error: '불러오지 못했어요' })]);
    expect(within(rowOf('A')).getByText('불러오지 못했어요')).toBeTruthy();
    expect(within(rowOf('A')).queryByText('데이터 없음')).toBeNull();
  });

  it('formats the value with ▲▼ and a trend class, and the price in 원', () => {
    setup([row('A', 1.234, { price: 71_200 })]);
    const value = within(rowOf('A')).getByText('▲ +1.23%');
    expect(value.classList.contains('up')).toBe(true);
    expect(within(rowOf('A')).getByText('71,200원')).toBeTruthy();
  });

  it('hidden rows are dimmed and their color dot is aria-pressed=false; the dot toggles', async () => {
    const props = setup([row('A', 1, { hidden: true }), row('B', 2)]);
    expect(rowOf('A').classList.contains('dim')).toBe(true);
    expect(rowOf('B').classList.contains('dim')).toBe(false);
    const dotA = within(rowOf('A')).getByRole('button', { name: /보이기/ });
    expect(dotA.getAttribute('aria-pressed')).toBe('false');
    expect(within(rowOf('B')).getByRole('button', { name: /숨기기/ }).getAttribute('aria-pressed')).toBe('true');
    await fireEvent.click(dotA);
    expect(props.ontogglehidden).toHaveBeenCalledWith('A');
  });

  it('shows second-line badges such as KRX 대체 and the NXT badge next to the name', () => {
    setup([row('A', 1, { badges: ['ETF', 'KRX 대체'], nxt: true })]);
    const r = within(rowOf('A'));
    expect(r.getByText('KRX 대체')).toBeTruthy();
    expect(r.getByText('ETF')).toBeTruthy();
    expect(r.getByText('NXT')).toBeTruthy();
  });

  it('stale rows: 17:20 기준 badge with a spoken label, values as given', () => {
    const staleAt = kstEpoch('2026-10-12', '17:20:00');
    setup([row('A', 2.5, { staleAt, price: 70_000 })]);
    const badge = within(rowOf('A')).getByText('17:20 기준');
    expect(badge.closest('[aria-label]')?.getAttribute('aria-label')).toBe('17시 20분 기준 데이터, 새로 받지 못했어요');
    expect(within(rowOf('A')).getByText('▲ +2.50%')).toBeTruthy();
    expect(within(rowOf('A')).getByText('70,000원')).toBeTruthy();
  });

  it('stale from another day: 10/8 기준', () => {
    setup([row('A', 1, { staleAt: kstEpoch('2026-10-08', '17:20:00') })]);
    expect(within(rowOf('A')).getByText('10/8 기준')).toBeTruthy();
  });

  it('header: 등락률 순 · n/8 and ＋ 종목 추가; scrubbing adds the time', async () => {
    const props = setup([row('A', 1), row('B', 2)], { count: 4 });
    expect(screen.getByText('등락률 순 · 4/8')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: '＋ 종목 추가' }));
    expect(props.onopenadd).toHaveBeenCalledTimes(1);
  });

  it('header while scrubbing shows the scrub time value', () => {
    setup([row('A', 1)], { count: 1, scrubLabel: '14:32' });
    expect(screen.getByText('등락률 순 · 1/8 · 14:32 값')).toBeTruthy();
  });

  it('a re-sort that moves the focused row keeps focus on it', async () => {
    // 되돌린 행은 값이 없어 맨 뒤에 붙었다가 값이 들어오면 위로 옮겨진다. 옮겨도 포커스를 잃지 않는다.
    const props = setup([row('A', 3), row('B', 1), row('C', null)]);
    mainBtn('C').focus();
    await props.rerender({ rows: [row('A', 3), row('B', 1), row('C', 2)] });
    expect(order()).toEqual(['A', 'C', 'B']);
    expect(document.activeElement).toBe(mainBtn('C'));
    // 다른 행이 옮겨져도 마찬가지
    mainBtn('A').focus();
    await props.rerender({ rows: [row('A', 0), row('B', 1), row('C', 2)] });
    expect(order()).toEqual(['C', 'B', 'A']);
    expect(document.activeElement).toBe(mainBtn('A'));
  });

  it('onfocuswithin: the shown order when focus enters the list, null only when it leaves the list', async () => {
    const onfocuswithin = vi.fn();
    setup([row('A', 1), row('B', 3), row('C', 2)], { onfocuswithin });
    mainBtn('A').focus();
    expect(onfocuswithin).toHaveBeenCalledTimes(1);
    expect(onfocuswithin).toHaveBeenLastCalledWith(['B', 'C', 'A']);
    // 목록 안에서 옮기면 알리지 않는다
    within(rowOf('C')).getByRole('button', { name: /숨기기/ }).focus();
    expect(onfocuswithin).toHaveBeenCalledTimes(1);
    // 목록 밖(머리줄의 ＋ 종목 추가)으로 나가면 null
    screen.getByRole('button', { name: '＋ 종목 추가' }).focus();
    expect(onfocuswithin).toHaveBeenCalledTimes(2);
    expect(onfocuswithin).toHaveBeenLastCalledWith(null);
    // 포커스가 문서 밖으로 빠져도(relatedTarget 없음) null
    mainBtn('B').focus();
    expect(onfocuswithin).toHaveBeenLastCalledWith(['B', 'C', 'A']);
    await fireEvent.focusOut(mainBtn('B'), { relatedTarget: null });
    expect(onfocuswithin).toHaveBeenLastCalledWith(null);
  });

  it('onfocuswithin: focus after a pointer press does not report; focus after a key press does', async () => {
    const onfocuswithin = vi.fn();
    setup([row('A', 1), row('B', 3), row('C', 2)], { onfocuswithin });
    await fireEvent.pointerDown(mainBtn('A'), { clientX: 10, clientY: 10, pointerId: 1 });
    await fireEvent.pointerUp(mainBtn('A'), { clientX: 10, clientY: 10, pointerId: 1 });
    mainBtn('A').focus();
    expect(onfocuswithin).not.toHaveBeenCalled();
    // 색 점을 눌러도 마찬가지
    const dot = within(rowOf('C')).getByRole('button', { name: /숨기기/ });
    screen.getByRole('button', { name: '＋ 종목 추가' }).focus();
    await fireEvent.pointerDown(dot);
    dot.focus();
    expect(onfocuswithin).not.toHaveBeenCalled();
    // 키보드로 들어오면 고정
    screen.getByRole('button', { name: '＋ 종목 추가' }).focus();
    await fireEvent.keyDown(document, { key: 'Tab' });
    mainBtn('B').focus();
    expect(onfocuswithin).toHaveBeenCalledTimes(1);
    expect(onfocuswithin).toHaveBeenLastCalledWith(['B', 'C', 'A']);
  });

  it('a pointer press before the board mounts still counts: the focus it causes does not hold the order (mouse undo remount)', async () => {
    const onfocuswithin = vi.fn();
    const undo = document.createElement('button');
    document.body.append(undo);
    await fireEvent.pointerDown(undo, { pointerId: 1 });
    setup([row('A', 1), row('B', 3)], { onfocuswithin });
    mainBtn('A').focus();
    expect(onfocuswithin).not.toHaveBeenCalled();
    // 그 뒤 키 입력이 오면 다시 키보드로 본다.
    mainBtn('A').blur();
    await fireEvent.keyDown(document.body, { key: 'Tab' });
    mainBtn('B').focus();
    expect(onfocuswithin).toHaveBeenCalledTimes(1);
    undo.remove();
  });

  it('a pointer press inside an already held list does not release it (the click must land on the row it pressed)', async () => {
    const onfocuswithin = vi.fn();
    setup([row('A', 1), row('B', 3)], { onfocuswithin });
    mainBtn('A').focus();
    expect(onfocuswithin).toHaveBeenLastCalledWith(['B', 'A']);
    await fireEvent.pointerDown(mainBtn('B'), { clientX: 10, clientY: 10, pointerId: 1 });
    // 누르는 사이 포커스가 목록 밖으로 빠져도(Safari: 포커스를 안 줘서 relatedTarget 없음) 순서를 풀지 않는다
    mainBtn('A').blur();
    expect(onfocuswithin).toHaveBeenCalledTimes(1);
    mainBtn('B').focus();
    expect(onfocuswithin).toHaveBeenCalledTimes(1);
  });

  // Safari는 버튼을 눌러도 포커스를 주지 않아 pointerdown 직후 focusout(relatedTarget 없음)이 온다.
  // 떼는 순간 풀면 행이 옮겨져 그 행이 click을 못 받으므로(WebKit) click 뒤에 푼다.
  describe('a press inside the held list (Safari: focusout without a related target)', () => {
    const press = async (onfocuswithin: ReturnType<typeof vi.fn>, rows = [row('A', 1), row('B', 3)]) => {
      const props = setup(rows, { onfocuswithin });
      mainBtn('A').focus();
      expect(onfocuswithin).toHaveBeenLastCalledWith(['B', 'A']);
      await fireEvent.pointerDown(mainBtn('B'), { clientX: 10, clientY: 10, pointerId: 1 });
      mainBtn('A').blur();
      expect(onfocuswithin).toHaveBeenCalledTimes(1);
      return props;
    };
    beforeEach(() => void vi.useFakeTimers());
    afterEach(() => void vi.useRealTimers());

    it('keeps the order through pointerup and releases after the click', async () => {
      const onfocuswithin = vi.fn();
      await press(onfocuswithin);
      await fireEvent.pointerUp(mainBtn('B'), { clientX: 10, clientY: 10, pointerId: 1 });
      expect(onfocuswithin).toHaveBeenCalledTimes(1);
      await fireEvent.click(mainBtn('B'));
      // click 핸들러가 끝나기 전에는 풀지 않는다
      expect(onfocuswithin).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(0);
      expect(onfocuswithin).toHaveBeenCalledTimes(2);
      expect(onfocuswithin).toHaveBeenLastCalledWith(null);
    });

    it('releases after the fallback timer when no click follows', async () => {
      const onfocuswithin = vi.fn();
      await press(onfocuswithin);
      await fireEvent.pointerUp(document.body, { pointerId: 1 });
      vi.advanceTimersByTime(299);
      expect(onfocuswithin).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1);
      expect(onfocuswithin).toHaveBeenLastCalledWith(null);
    });

    it('releases right away on pointercancel', async () => {
      const onfocuswithin = vi.fn();
      await press(onfocuswithin);
      await fireEvent.pointerCancel(mainBtn('B'), { pointerId: 1 });
      expect(onfocuswithin).toHaveBeenCalledTimes(2);
      expect(onfocuswithin).toHaveBeenLastCalledWith(null);
    });

    it('releases right away when the next press starts after the pointerup', async () => {
      const onfocuswithin = vi.fn();
      await press(onfocuswithin);
      await fireEvent.pointerUp(mainBtn('B'), { pointerId: 1 });
      await fireEvent.pointerDown(document.body, { pointerId: 2 });
      expect(onfocuswithin).toHaveBeenLastCalledWith(null);
    });

    it('a key press ends the press: focus moving out afterwards releases normally', async () => {
      const onfocuswithin = vi.fn();
      await press(onfocuswithin);
      await fireEvent.keyDown(document.body, { key: 'Tab' });
      vi.advanceTimersByTime(0);
      // 포커스가 이미 목록 밖(body)이었으므로 키 직후 푼다
      expect(onfocuswithin).toHaveBeenLastCalledWith(null);
    });

    it('keeps the hold when focus is inside the list at release (Chromium focuses the row)', async () => {
      const onfocuswithin = vi.fn();
      await press(onfocuswithin);
      mainBtn('B').focus();
      await fireEvent.pointerUp(mainBtn('B'), { pointerId: 1 });
      await fireEvent.click(mainBtn('B'));
      vi.advanceTimersByTime(300);
      expect(onfocuswithin).toHaveBeenCalledTimes(1);
    });

    it('a re-sort while the press is down does not release it', async () => {
      const onfocuswithin = vi.fn();
      const props = await press(onfocuswithin);
      await props.rerender({ rows: [row('A', 2), row('B', 3)] });
      expect(onfocuswithin).toHaveBeenCalledTimes(1);
    });

    it('after the press has finished, focus leaving the list releases immediately again', async () => {
      const onfocuswithin = vi.fn();
      await press(onfocuswithin);
      await fireEvent.pointerUp(mainBtn('B'), { pointerId: 1 });
      await fireEvent.click(mainBtn('B'));
      vi.advanceTimersByTime(0);
      expect(onfocuswithin).toHaveBeenCalledTimes(2);
      mainBtn('A').focus();
      expect(onfocuswithin).toHaveBeenCalledTimes(2);
      await fireEvent.keyDown(document, { key: 'Tab' });
      mainBtn('A').focus();
      mainBtn('A').blur();
      expect(onfocuswithin).toHaveBeenLastCalledWith(null);
    });
  });

  it('onfocuswithin: the focused row disappearing (no focusout) or the board unmounting also reports null', async () => {
    const onfocuswithin = vi.fn();
    const props = setup([row('A', 1), row('B', 3)], { onfocuswithin });
    mainBtn('A').focus();
    expect(onfocuswithin).toHaveBeenLastCalledWith(['B', 'A']);
    await props.rerender({ rows: [row('B', 3)] });
    expect(onfocuswithin).toHaveBeenLastCalledWith(null);

    onfocuswithin.mockClear();
    mainBtn('B').focus();
    expect(onfocuswithin).toHaveBeenLastCalledWith(['B']);
    props.unmount();
    expect(onfocuswithin).toHaveBeenLastCalledWith(null);
  });

  it('indexOf reads the shown position of a row (-1 when absent)', () => {
    const { component } = setup([row('A', 1), row('B', 3), row('C', 2)], { frozenOrder: ['A', 'C', 'B'] });
    expect(component.indexOf('A')).toBe(0);
    expect(component.indexOf('B')).toBe(2);
    expect(component.indexOf('Z')).toBe(-1);
  });

  it('tapping a row selects it', async () => {
    const props = setup([row('A', 1)]);
    await fireEvent.click(mainBtn('A'));
    expect(props.onselect).toHaveBeenCalledWith('A');
  });

  it('Alt+ArrowUp/Down on a focused row moves it next to its neighbor', async () => {
    const props = setup([row('A', 3), row('B', 2), row('C', 1)]);
    await fireEvent.keyDown(mainBtn('B'), { key: 'ArrowDown', altKey: true });
    expect(props.onreorder).toHaveBeenCalledWith('B', 'C');
    await fireEvent.keyDown(mainBtn('B'), { key: 'ArrowUp', altKey: true });
    expect(props.onreorder).toHaveBeenLastCalledWith('B', 'A');
    await fireEvent.keyDown(mainBtn('A'), { key: 'ArrowUp', altKey: true });
    expect(props.onreorder).toHaveBeenCalledTimes(2);
  });

  it('long press (500ms) then drag onto another row reorders', async () => {
    vi.useFakeTimers();
    try {
      const props = setup([row('A', 3), row('B', 2), row('C', 1)]);
      const items = screen.getAllByRole('listitem');
      items.forEach((li, i) => {
        li.getBoundingClientRect = () => ({ top: i * 60, bottom: i * 60 + 60, left: 0, right: 300, height: 60, width: 300, x: 0, y: i * 60, toJSON: () => ({}) });
      });
      const handle = mainBtn('A');
      await fireEvent.pointerDown(handle, { clientX: 10, clientY: 30, pointerId: 1 });
      vi.advanceTimersByTime(500);
      await fireEvent.pointerMove(handle, { clientX: 10, clientY: 150, pointerId: 1 });
      await fireEvent.pointerUp(handle, { clientX: 10, clientY: 150, pointerId: 1 });
      expect(props.onreorder).toHaveBeenCalledWith('A', 'C');
      // 끌기가 끝난 직후의 click은 선택으로 보지 않는다.
      await fireEvent.click(handle);
      expect(props.onselect).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('after a touch drag that produced no click, the next tap still selects', async () => {
    vi.useFakeTimers();
    try {
      const props = setup([row('A', 3), row('B', 2)]);
      screen.getAllByRole('listitem').forEach((li, i) => {
        li.getBoundingClientRect = () => ({ top: i * 60, bottom: i * 60 + 60, left: 0, right: 300, height: 60, width: 300, x: 0, y: i * 60, toJSON: () => ({}) });
      });
      const handle = mainBtn('A');
      await fireEvent.pointerDown(handle, { clientX: 10, clientY: 30, pointerId: 1 });
      vi.advanceTimersByTime(500);
      await fireEvent.pointerMove(handle, { clientX: 10, clientY: 90, pointerId: 1 });
      await fireEvent.pointerUp(handle, { clientX: 10, clientY: 90, pointerId: 1 });
      expect(props.onreorder).toHaveBeenCalledWith('A', 'B');
      // 터치 끌기 뒤에는 브라우저가 click을 보내지 않는다. 다음 탭:
      await fireEvent.pointerDown(mainBtn('B'), { clientX: 10, clientY: 90, pointerId: 2 });
      await fireEvent.pointerUp(mainBtn('B'), { clientX: 10, clientY: 90, pointerId: 2 });
      await fireEvent.click(mainBtn('B'));
      expect(props.onselect).toHaveBeenCalledWith('B');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a short press does not start a drag', async () => {
    vi.useFakeTimers();
    try {
      const props = setup([row('A', 3), row('B', 2)]);
      const handle = mainBtn('A');
      await fireEvent.pointerDown(handle, { clientX: 10, clientY: 30, pointerId: 1 });
      vi.advanceTimersByTime(200);
      await fireEvent.pointerUp(handle, { clientX: 10, clientY: 30, pointerId: 1 });
      expect(props.onreorder).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
