// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { SnackbarHost } from '@sch0718/ui-svelte';
import { dismissSnackbar } from '@sch0718/ui-svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { HELP_PAGES } from '../lib/help/content';
import type { App } from '../lib/state/app.svelte';
import type { Route } from '../lib/state/routes';
import { makeTestApp } from '../sheets/testApp';
import Help from './Help.svelte';

const barEnd = createRawSnippet(() => ({ render: () => '<span></span>' }));

let apps: App[] = [];
function setup(route: Route, theme: 'system' | 'light' | 'dark' = 'system') {
  const app = makeTestApp({ groups: [{ id: 'g1', name: '반도체', items: [] }], now: Date.UTC(2026, 9, 16), settings: { theme } });
  apps.push(app);
  app.navigate(route);
  const view = render(Help, { app, barEnd });
  return { app, view };
}

afterEach(() => {
  for (const a of apps) a.destroy();
  apps = [];
  dismissSnackbar();
});

describe('Help', () => {
  it('lists every menu and opens one', async () => {
    const { app } = setup({ name: 'help' });
    expect(screen.getByRole('heading', { level: 1, name: '도움말' })).toBeTruthy();
    const list = screen.getByRole('list', { name: '메뉴별 도움말' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(HELP_PAGES.length);
    await fireEvent.click(within(list).getByRole('button', { name: /비교 차트/ }));
    expect(app.route).toEqual({ name: 'help', helpId: 'compare' });
  });

  it('a page shows the moving picture, the steps and the tips, with links to the next menu', async () => {
    const { app } = setup({ name: 'help', helpId: 'compare' });
    expect(screen.getByRole('heading', { level: 1, name: '비교 차트' })).toBeTruthy();
    const img = screen.getByRole('img', { name: /비교 차트 사용법/ }) as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/help/img/compare-light.svg');
    // 시스템 테마면 다크 모드에서 다크 그림을 고르게 한다.
    expect(img.closest('picture')!.querySelector('source')!.getAttribute('srcset')).toBe('/help/img/compare-dark.svg');
    expect(within(screen.getByRole('list', { name: '이렇게 써요' })).getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByRole('list', { name: '알아 두면 좋아요' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /이전:/ })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: '다음: 종목 추가 →' }));
    expect(app.route).toEqual({ name: 'help', helpId: 'add' });
    expect(screen.getByRole('heading', { level: 1, name: '종목 추가' })).toBeTruthy();
  });

  it('follows a fixed dark theme, and links in tips open GitHub in a new tab', () => {
    setup({ name: 'help', helpId: 'criteria' }, 'dark');
    const img = screen.getByRole('img', { name: /선정 기준 검증 사용법/ });
    expect(img.getAttribute('src')).toBe('/help/img/criteria-dark.svg');
    expect(img.closest('picture')!.querySelector('source')).toBeNull();
    const link = screen.getByRole('link', { name: '개발 문서' });
    expect(link.getAttribute('href')).toMatch(/^https:\/\/github\.com\/sch0718\/gazua\/blob\/main\/docs\/development\.md#/);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('back goes to the list from a page, and to compare from the list', async () => {
    const { app } = setup({ name: 'help', helpId: 'settings' });
    await fireEvent.click(screen.getByRole('button', { name: '도움말 목록으로' }));
    expect(app.route).toEqual({ name: 'help' });
    await fireEvent.click(screen.getByRole('button', { name: '비교로 돌아가기' }));
    expect(app.route.name).toBe('compare');
  });

  // Codex 리뷰(PR #36) 2: PC(≥1024)에서는 .main이 스크롤 칸이다. 다음 메뉴는 그 칸도 맨 위부터 보인다.
  it('next/previous scrolls the content pane back to the top', async () => {
    setup({ name: 'help', helpId: 'compare' });
    const pane = document.querySelector('main') as HTMLElement;
    pane.style.overflowY = 'auto';
    pane.scrollTop = 400;
    await fireEvent.click(screen.getByRole('button', { name: '다음: 종목 추가 →' }));
    expect(pane.scrollTop).toBe(0);
  });

  // Codex 리뷰(PR #36) 3: 없는 도움말 주소는 도움말 화면에서 알리고 비운다(다른 화면으로 넘어가지 않게).
  it('an unknown help page tells why on the help list and clears the notice', async () => {
    const app = makeTestApp({ groups: [{ id: 'g1', name: '반도체', items: [] }], now: Date.UTC(2026, 9, 16) });
    apps.push(app);
    render(SnackbarHost);
    app.navigate({ name: 'help', helpId: 'nope' });
    render(Help, { app, barEnd });
    await waitFor(() => expect(screen.getByText('도움말을 찾을 수 없어요')).toBeTruthy());
    expect(app.routeNotice).toBeNull();
  });
});
