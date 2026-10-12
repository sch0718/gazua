// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { pullToRefresh } from './pullToRefresh';

function touch(node: HTMLElement, type: string, y?: number) {
  const e = new Event(type, { bubbles: true });
  Object.defineProperty(e, 'touches', { value: y === undefined ? [] : [{ clientY: y }] });
  node.dispatchEvent(e);
}

describe('pullToRefresh', () => {
  it('refreshes after pulling down more than 64px from the top', () => {
    const node = document.createElement('div');
    const onrefresh = vi.fn();
    const onpull = vi.fn();
    const action = pullToRefresh(node, { onrefresh, onpull });
    touch(node, 'touchstart', 100);
    touch(node, 'touchmove', 140);
    expect(onpull).toHaveBeenLastCalledWith(40);
    touch(node, 'touchmove', 170);
    touch(node, 'touchend');
    expect(onrefresh).toHaveBeenCalledTimes(1);
    expect(onpull).toHaveBeenLastCalledWith(0);
    action.destroy();
  });

  it('a short pull does nothing', () => {
    const node = document.createElement('div');
    const onrefresh = vi.fn();
    pullToRefresh(node, { onrefresh });
    touch(node, 'touchstart', 100);
    touch(node, 'touchmove', 150);
    touch(node, 'touchend');
    expect(onrefresh).not.toHaveBeenCalled();
  });

  it('does nothing when the content is scrolled', () => {
    const node = document.createElement('div');
    Object.defineProperty(node, 'scrollTop', { value: 50 });
    const onrefresh = vi.fn();
    pullToRefresh(node, { onrefresh });
    touch(node, 'touchstart', 100);
    touch(node, 'touchmove', 300);
    touch(node, 'touchend');
    expect(onrefresh).not.toHaveBeenCalled();
  });
});
