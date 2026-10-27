// @vitest-environment jsdom
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import About from './About.svelte';

describe('About', () => {
  it('hides the donation row while no Ko-fi address is set', () => {
    render(About, { kofiUrl: '' });
    expect(screen.queryByRole('link', { name: '후원하기' })).toBeNull();
    expect(screen.getByRole('link', { name: '라이선스' }).getAttribute('href')).toBe(
      'https://github.com/sch0718/gazua/blob/main/LICENSE',
    );
  });

  it('shows the Ko-fi link as a plain new-tab link', () => {
    render(About, { kofiUrl: 'https://ko-fi.com/example' });
    const link = screen.getByRole('link', { name: '후원하기' });
    expect(link.getAttribute('href')).toBe('https://ko-fi.com/example');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('lists the chart attribution and the full license file', () => {
    render(About);
    expect(screen.getByRole('link', { name: 'tradingview.com' }).getAttribute('href')).toBe('https://www.tradingview.com/');
    expect(screen.getByRole('link', { name: '전체 오픈소스 라이선스 전문' }).getAttribute('href')).toMatch(/licenses\.txt$/);
  });
});
