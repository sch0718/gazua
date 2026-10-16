// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import SimulateTabs from './SimulateTabs.svelte';

function setup(tab: 'rules' | 'criteria' = 'rules') {
  const onselect = vi.fn();
  render(SimulateTabs, { tab, onselect });
  return { onselect, tabs: screen.getAllByRole('tab') };
}

describe('SimulateTabs', () => {
  it('shows 매매 규칙 and 선정 기준 in a tablist; the current one is selected and the only tab stop', () => {
    const { tabs } = setup('criteria');
    expect(screen.getByRole('tablist', { name: '시뮬레이션' })).toBeTruthy();
    expect(tabs.map((t) => t.textContent?.trim())).toEqual(['매매 규칙', '선정 기준']);
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true']);
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['-1', '0']);
  });

  it('ArrowRight/ArrowLeft move focus only (wrapping); Home/End jump; nothing is selected until Enter/Space (click)', async () => {
    const { tabs, onselect } = setup('rules');
    tabs[0].focus();
    await fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1].getAttribute('tabindex')).toBe('0');
    await fireEvent.keyDown(tabs[1], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tabs[0]);
    await fireEvent.keyDown(tabs[0], { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tabs[1]);
    await fireEvent.keyDown(tabs[1], { key: 'Home' });
    expect(document.activeElement).toBe(tabs[0]);
    await fireEvent.keyDown(tabs[0], { key: 'End' });
    expect(document.activeElement).toBe(tabs[1]);
    expect(onselect).not.toHaveBeenCalled();
    await fireEvent.click(tabs[1]);
    expect(onselect).toHaveBeenCalledWith('criteria');
  });

  it('ignores arrows with Alt/Ctrl/Meta so browser shortcuts keep working', async () => {
    const { tabs } = setup('rules');
    tabs[0].focus();
    for (const mod of ['altKey', 'ctrlKey', 'metaKey'] as const) {
      const ok = await fireEvent.keyDown(tabs[0], { key: 'ArrowRight', [mod]: true });
      expect(ok).toBe(true); // 막지 않았다
      expect(document.activeElement).toBe(tabs[0]);
    }
  });
});
