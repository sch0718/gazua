// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import Badge from './Badge.svelte';
import Banner from './Banner.svelte';
import Chip from './Chip.svelte';
import Toggle from './Toggle.svelte';

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

describe('Toggle', () => {
  it('is a labelled switch', async () => {
    const onchange = vi.fn();
    render(Toggle, { checked: false, label: '암호로 잠그기', onchange });
    const sw = screen.getByRole('switch', { name: '암호로 잠그기' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    await fireEvent.click(sw);
    expect(onchange).toHaveBeenCalledExactlyOnceWith(true);
  });
});
