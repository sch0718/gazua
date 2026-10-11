// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import Sheet from './Sheet.svelte';

const body = createRawSnippet(() => ({
  render: () => `<div><button id="first">첫째</button><button id="second">둘째</button></div>`,
}));

function setup(props: Record<string, unknown> = {}) {
  const onclose = vi.fn();
  const view = render(Sheet, { open: true, title: '지표 선택', onclose, children: body, ...props });
  return { onclose, ...view };
}

describe('Sheet', () => {
  it('renders nothing while closed', () => {
    setup({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is a labelled modal dialog', () => {
    setup();
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const labelId = dialog.getAttribute('aria-labelledby')!;
    expect(document.getElementById(labelId)?.textContent).toBe('지표 선택');
  });

  it('closes once on Escape', async () => {
    const { onclose } = setup();
    await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onclose).toHaveBeenCalledTimes(1);
  });

  it('closes on scrim click but not on dialog click', async () => {
    const { onclose, container } = setup();
    await fireEvent.click(screen.getByRole('dialog'));
    expect(onclose).not.toHaveBeenCalled();
    await fireEvent.click(container.ownerDocument.querySelector('.scrim')!);
    expect(onclose).toHaveBeenCalledTimes(1);
  });

  it('focuses the first focusable element on open', async () => {
    setup();
    await tick();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('닫기');
  });

  it('prefers a [data-autofocus] element over the first focusable', async () => {
    const withInput = createRawSnippet(() => ({
      render: () => `<div><input data-autofocus aria-label="검색" /></div>`,
    }));
    setup({ children: withInput });
    await tick();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('검색');
  });

  it('restores focus to the previously focused element on close', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { rerender } = setup();
    await tick();
    expect(document.activeElement).not.toBe(opener);
    await rerender({ open: false });
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('traps Tab inside the dialog', async () => {
    setup();
    await tick();
    const dialog = screen.getByRole('dialog');
    const focusables = dialog.querySelectorAll<HTMLElement>('button');
    const last = focusables[focusables.length - 1];
    last.focus();
    await fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(focusables[0]);
    await fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('closes on a downward drag of more than 80px on the grab handle', async () => {
    const { onclose, container } = setup();
    const grab = container.ownerDocument.querySelector('.grab')!;
    await fireEvent.pointerDown(grab, { pointerId: 1, clientY: 100 });
    await fireEvent.pointerMove(grab, { pointerId: 1, clientY: 150 });
    await fireEvent.pointerUp(grab, { pointerId: 1, clientY: 150 });
    expect(onclose).not.toHaveBeenCalled();
    await fireEvent.pointerDown(grab, { pointerId: 1, clientY: 100 });
    await fireEvent.pointerMove(grab, { pointerId: 1, clientY: 200 });
    await fireEvent.pointerUp(grab, { pointerId: 1, clientY: 200 });
    expect(onclose).toHaveBeenCalledTimes(1);
  });
});
