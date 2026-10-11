// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { applyColorConvention, applyTheme } from './theme';

const root = document.documentElement;

afterEach(() => {
  root.removeAttribute('data-theme');
  root.classList.remove('global-colors');
});

describe('applyTheme', () => {
  it('sets data-theme for light and dark', () => {
    applyTheme('dark');
    expect(root.getAttribute('data-theme')).toBe('dark');
    applyTheme('light');
    expect(root.getAttribute('data-theme')).toBe('light');
  });
  it('removes data-theme for system', () => {
    applyTheme('dark');
    applyTheme('system');
    expect(root.hasAttribute('data-theme')).toBe(false);
  });
});

describe('applyColorConvention', () => {
  it('toggles the global-colors class', () => {
    applyColorConvention('global');
    expect(root.classList.contains('global-colors')).toBe(true);
    applyColorConvention('kr');
    expect(root.classList.contains('global-colors')).toBe(false);
  });
});
