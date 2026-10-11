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

  it('has identical values in the system-dark and data-theme=dark blocks', () => {
    const values = (b: string) =>
      Object.fromEntries(
        [...b.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
      );
    expect(values(darkAuto)).toEqual(values(darkSet));
  });

  it('uses the spec 8.2 palette values', () => {
    expect(light).toContain('--bg: #f6f7f9');
    expect(light).toContain('--accent: #5b47e0');
    expect(light).toContain('--up: #d4202f'); // 스펙 8.2의 #e02e3c에서 AA 대비를 맞추려고 조정
    expect(darkSet).toContain('--bg: #0e0f11');
    expect(darkSet).toContain('--accent: #a093ff'); // 스펙 8.2의 #8b7bff에서 AA 대비를 맞추려고 조정
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
    expect(block(':root.global-colors')).toMatch(/--up: #0a7d0a/);
  });

  describe('text contrast (WCAG AA 4.5:1) on bg, surface and surface 2', () => {
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const lum = (hex: string) => {
      const [r, g, b] = rgb(hex).map((v) => v / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: string, b: string) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const token = (b: string, name: string) => b.match(new RegExp(`--${name}: (#[0-9a-f]{6})`))![1];
    /** `color`를 alpha만큼 `under` 위에 올린 색 */
    const over = (color: string, alpha: number, under: string) =>
      '#' + rgb(color).map((c, i) => Math.round(c * alpha + rgb(under)[i] * (1 - alpha)).toString(16).padStart(2, '0')).join('');
    const SURFACES = ['bg', 'surface', 'surface2'];

    it.each([
      ['light', light],
      ['dark (system)', darkAuto],
      ['dark (data-theme)', darkSet],
    ])('%s: text tokens and kr up/down', (_, b) => {
      for (const bg of SURFACES) {
        for (const fg of ['t2', 't3', 'ok', 'warn', 'err', 'accent', 'up', 'down']) {
          expect(ratio(token(b, fg), token(b, bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    it.each([
      ['light', light, ':root.global-colors'],
      ['dark', darkSet, ":root.global-colors:not([data-theme='light'])"],
    ])('%s: global-colors up/down', (_, theme, selector) => {
      const g = block(selector);
      for (const bg of SURFACES) {
        for (const fg of ['up', 'down']) {
          expect(ratio(token(g, fg), token(theme, bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    it.each([
      ['light', light, 0.1],
      ['dark', darkSet, 0.14],
    ])('%s: accent text on its own tint (NXT badge) over every surface', (_, b, alpha) => {
      for (const bg of SURFACES) {
        const tint = over(token(b, 'accent'), alpha, token(b, bg));
        expect(ratio(token(b, 'accent'), tint), `accent on accent-soft over ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  });
});
