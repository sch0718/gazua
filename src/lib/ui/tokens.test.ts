// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

const block = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
};

describe('tokens.css', () => {
  const light = block(':root');
  const darkAuto = block(":root:not([data-theme='light'])");
  const darkSet = block(":root[data-theme='dark']");

  it('defines the same token names in light and both dark blocks', () => {
    const names = (b: string) => [...b.matchAll(/(--[a-z0-9-]+):/g)].map((m) => m[1]);
    const themed = names(light).filter((n) => !/^--(font|fs-|r-|gutter|touch|ease|dur-)/.test(n));
    expect(names(darkAuto).sort()).toEqual(themed.sort());
    expect(names(darkSet).sort()).toEqual(themed.sort());
  });

  it('uses the spec 8.2 palette values', () => {
    expect(light).toContain('--bg: #f6f7f9');
    expect(light).toContain('--accent: #5b47e0');
    expect(light).toContain('--up: #e02e3c');
    expect(darkSet).toContain('--bg: #0e0f11');
    expect(darkSet).toContain('--accent: #8b7bff');
    expect(darkSet).toContain('--down: #4c8dff');
  });

  it('uses the spec 8.3 series colors (slot 1→8)', () => {
    const series = (b: string) => [...b.matchAll(/--s[1-8]: (#[0-9a-f]{6})/g)].map((m) => m[1]);
    expect(series(light)).toEqual(['#eb6834', '#1baf7a', '#4a3aa7', '#eda100', '#e87ba4', '#008300', '#2a78d6', '#e34948']);
    expect(series(darkSet)).toEqual(['#d95926', '#199e70', '#9085e9', '#c98500', '#d55181', '#008300', '#3987e5', '#e66767']);
    expect(series(darkAuto)).toEqual(series(darkSet));
  });

  it('html and body turn off the browser’s own pull-to-refresh (the app has its own)', () => {
    expect(block('html,\nbody')).toContain('overscroll-behavior-y: contain');
  });

  it('swaps up/down under .global-colors', () => {
    expect(block(':root.global-colors')).toMatch(/--up: #0ca30c/);
  });
});
