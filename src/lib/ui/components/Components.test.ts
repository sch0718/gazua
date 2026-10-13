// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Badge from './Badge.svelte';
import Banner from './Banner.svelte';
import Chip from './Chip.svelte';
import Toggle from './Toggle.svelte';
import toggleSource from './Toggle.svelte?raw';

const text = (t: string) => createRawSnippet(() => ({ render: () => `<span>${t}</span>` }));

describe('Chip', () => {
  it('toggles aria-pressed and calls onclick', async () => {
    const onclick = vi.fn();
    render(Chip, { selected: true, onclick, children: text('1주') });
    const chip = screen.getByRole('button', { name: '1주' });
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    await fireEvent.click(chip);
    expect(onclick).toHaveBeenCalledTimes(1);
  });
});

describe('Badge', () => {
  it('renders its text', () => {
    render(Badge, { tone: 'nxt', children: text('NXT') });
    expect(screen.getByText('NXT')).toBeTruthy();
  });
});

describe('Banner', () => {
  it('renders a message and an optional action', async () => {
    const onaction = vi.fn();
    render(Banner, { message: '데모 데이터를 보고 있어요', actionLabel: '연결하기', onaction });
    expect(screen.getByText('데모 데이터를 보고 있어요')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: '연결하기' }));
    expect(onaction).toHaveBeenCalledTimes(1);
  });
});

describe('Banner roles', () => {
  it('uses role=alert only for the error tone', () => {
    const { unmount } = render(Banner, { message: '연결에 실패했어요', tone: 'error' });
    expect(screen.getByRole('alert').textContent).toContain('연결에 실패했어요');
    unmount();
    render(Banner, { message: '안내', tone: 'warn' });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('live={false}면 alert·status 없이 글만(포커스로 읽히는 경고용)', () => {
    render(Banner, { message: '고쳐 주세요', tone: 'error', live: false, id: 'b1' });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(document.getElementById('b1')?.textContent).toContain('고쳐 주세요');
    expect(document.getElementById('b1')?.getAttribute('tabindex')).toBe('-1');
  });
});

describe('Toggle', () => {
  it('is a labelled switch', async () => {
    const onchange = vi.fn();
    render(Toggle, { checked: false, label: '암호로 잠그기', onchange });
    const sw = screen.getByRole('switch', { name: '암호로 잠그기' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    await fireEvent.click(sw);
    expect(onchange).toHaveBeenCalledExactlyOnceWith(true);
  });

  // 컴포넌트의 <style>만 문서에 넣어 계산된 스타일로 확인한다(Svelte 스코프 클래스는 없다).
  // jsdom은 var()를 풀지 않으므로 토큰 이름이 그대로 나온다.
  const styles: HTMLStyleElement[] = [];
  afterEach(() => {
    for (const s of styles.splice(0)) s.remove();
  });
  function draw(checked: boolean) {
    const style = document.createElement('style');
    styles.push(style);
    style.textContent = /<style>([\s\S]*)<\/style>/.exec(toggleSource)![1];
    document.head.append(style);
    const { container } = render(Toggle, { checked, label: '토글', onchange: vi.fn() });
    const track = container.querySelector('.track')!;
    const thumb = container.querySelector('.thumb')!;
    return { track, thumb, bg: (el: Element) => getComputedStyle(el).background };
  }

  it('off: the track is --t3 and the thumb is white (non-text 3:1)', () => {
    const v = draw(false);
    expect(v.track.classList.contains('on')).toBe(false);
    expect(v.bg(v.track)).toBe('var(--t3)');
    expect(v.bg(v.thumb)).toBe('rgb(255, 255, 255)');
  });

  it('on: the track is --accent and the thumb is --on-accent', () => {
    const v = draw(true);
    expect(v.track.classList.contains('on')).toBe(true);
    expect(v.bg(v.track)).toBe('var(--accent)');
    expect(v.bg(v.thumb)).toBe('var(--on-accent)');
  });
});
