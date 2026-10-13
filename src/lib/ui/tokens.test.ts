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
      ['light', light],
      ['dark (system)', darkAuto],
      ['dark (data-theme)', darkSet],
    ])('%s: 자산 곡선 비교 종목 선(--line-bench)은 --bg 위 3:1 이상(그래픽)', (_, b) => {
      expect(ratio(token(b, 'line-bench'), token(b, 'bg'))).toBeGreaterThanOrEqual(3);
      expect(ratio(token(b, 'line-bench'), token(b, 'surface'))).toBeGreaterThanOrEqual(3);
    });

    it('카드 안 세그먼트: 라이트는 기본 모양(트랙 --surface2·선택 --surface), 다크는 트랙 --bg·선택 --surface2', () => {
      const v = (b: string, name: string) => b.match(new RegExp(`--${name}: ([^;]+);`))![1].trim();
      expect([v(light, 'seg-card-track'), v(light, 'seg-card-on')]).toEqual(['var(--surface2)', 'var(--surface)']);
      for (const d of [darkAuto, darkSet]) expect([v(d, 'seg-card-track'), v(d, 'seg-card-on')]).toEqual(['var(--bg)', 'var(--surface2)']);
      // 선택 항목과 트랙의 차이가 기본 세그먼트보다 작아지지 않는다(라이트 1.13, 다크 1.19)
      expect(ratio(token(light, 'surface'), token(light, 'surface2'))).toBeGreaterThan(1.1);
      expect(ratio(token(darkSet, 'surface2'), token(darkSet, 'bg'))).toBeGreaterThan(1.15);
    });

    it.each([
      ['light', light],
      ['dark (system)', darkAuto],
      ['dark (data-theme)', darkSet],
    ])('%s: 토글(비텍스트 3:1) — 켬 손잡이·트랙, 끔 손잡이·트랙', (_, b) => {
      // 켬: 손잡이 --on-accent 대 트랙 --accent. 끔: 손잡이 #fff 대 트랙 --t3, 트랙 --t3 대 면
      expect(ratio(token(b, 'on-accent'), token(b, 'accent')), 'on-accent on accent').toBeGreaterThanOrEqual(3);
      expect(ratio('#ffffff', token(b, 't3')), 'thumb on off-track').toBeGreaterThanOrEqual(3);
      for (const bg of SURFACES) expect(ratio(token(b, 't3'), token(b, bg)), `off-track on ${bg}`).toBeGreaterThanOrEqual(3);
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
