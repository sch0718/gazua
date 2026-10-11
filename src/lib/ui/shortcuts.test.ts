// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindShortcuts, type ShortcutHandlers } from './shortcuts';

function handlers(): { [K in keyof ShortcutHandlers]: ReturnType<typeof vi.fn> } {
  return {
    search: vi.fn(),
    prevPeriod: vi.fn(),
    nextPeriod: vi.fn(),
    metric: vi.fn(),
    cycleVenue: vi.fn(),
    toggleHidden: vi.fn(),
    help: vi.fn(),
  };
}

const press = (target: EventTarget, key: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
};

let unbind: (() => void) | undefined;
beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  unbind?.();
  unbind = undefined;
});

describe('bindShortcuts', () => {
  it.each([
    ['/', 'search'],
    ['[', 'prevPeriod'],
    [']', 'nextPeriod'],
    ['m', 'metric'],
    ['M', 'metric'],
    ['v', 'cycleVenue'],
    ['h', 'toggleHidden'],
    ['?', 'help'],
  ] as const)('%s calls %s once and nothing else', (key, name) => {
    const h = handlers();
    unbind = bindShortcuts(document, h);
    const e = press(document.body, key);
    expect(h[name]).toHaveBeenCalledTimes(1);
    for (const [k, fn] of Object.entries(h)) if (k !== name) expect(fn).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);
  });

  it('ignores unrelated keys without preventing default', () => {
    const h = handlers();
    unbind = bindShortcuts(document, h);
    const e = press(document.body, 'x');
    expect(Object.values(h).every((fn) => fn.mock.calls.length === 0)).toBe(true);
    expect(e.defaultPrevented).toBe(false);
  });

  it.each(['input', 'textarea', 'select'])('ignores keys while a <%s> has focus', (tag) => {
    const h = handlers();
    unbind = bindShortcuts(document, h);
    const el = document.body.appendChild(document.createElement(tag));
    el.focus();
    const e = press(el, '/');
    expect(h.search).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it('ignores keys while a contenteditable element has focus', () => {
    const h = handlers();
    unbind = bindShortcuts(document, h);
    const el = document.body.appendChild(document.createElement('div'));
    el.setAttribute('contenteditable', 'true');
    el.tabIndex = 0;
    el.focus();
    press(el, 'm');
    expect(h.metric).not.toHaveBeenCalled();
  });

  it('ignores a key typed into an input even when the event target is the document', () => {
    const h = handlers();
    unbind = bindShortcuts(document, h);
    document.body.appendChild(document.createElement('input')).focus();
    press(document, 'h');
    expect(h.toggleHidden).not.toHaveBeenCalled();
  });

  it.each([{ ctrlKey: true }, { metaKey: true }, { altKey: true }])('ignores %o (browser/OS shortcuts)', (mod) => {
    const h = handlers();
    unbind = bindShortcuts(document, h);
    const e = press(document.body, 'm', mod);
    expect(h.metric).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it('ignores auto-repeat so a held key fires once', () => {
    const h = handlers();
    unbind = bindShortcuts(document, h);
    press(document.body, ']', { repeat: true });
    expect(h.nextPeriod).not.toHaveBeenCalled();
  });

  it('works on a button focus (not a text field)', () => {
    const h = handlers();
    unbind = bindShortcuts(document, h);
    const b = document.body.appendChild(document.createElement('button'));
    b.focus();
    press(b, ']');
    expect(h.nextPeriod).toHaveBeenCalledTimes(1);
  });

  it('the returned function unbinds', () => {
    const h = handlers();
    const off = bindShortcuts(document, h);
    off();
    press(document.body, '/');
    expect(h.search).not.toHaveBeenCalled();
  });
});
