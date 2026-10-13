// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newStrategy } from './lib/sim/defaults';
import App from './App.svelte';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(
    'gazua:v1:meta',
    JSON.stringify({ schemaVersion: 1, activeProfileId: 'p1', profiles: [{ id: 'p1', name: '내 프로필', createdAt: 1 }] }),
  );
  localStorage.setItem('gazua:v1:p:p1:settings', JSON.stringify({ onboarded: true }));
  localStorage.setItem('gazua:v1:p:p1:watchlists', JSON.stringify({ groups: [{ id: 'g1', name: '내 관심', items: [] }] }));
  location.hash = '#/compare/g1';
});
afterEach(() => localStorage.clear());

describe('App bar', () => {
  it('has a 시뮬레이션 button before 설정 that opens #/simulate', async () => {
    render(App);
    await screen.findAllByRole('button', { name: '시뮬레이션' });
    const bar = document.querySelector('header.bar') as HTMLElement;
    const sim = within(bar).getByRole('button', { name: '시뮬레이션' });
    const set = within(bar).getByRole('button', { name: '설정' });
    expect(sim.compareDocumentPosition(set) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await fireEvent.click(sim);
    expect(location.hash).toBe('#/simulate');
  });

  it('marks the 시뮬레이션 icon as the current page only on simulate routes', async () => {
    render(App);
    await screen.findAllByRole('button', { name: '시뮬레이션' });
    const iconIn = () => within(document.querySelector('header.bar') as HTMLElement).getByRole('button', { name: '시뮬레이션' });
    // 비교 화면: 현재 위치가 아니다. className 부분 문자열('icon-btn'에 'on'이 있다)이 아니라 클래스 목록으로 본다.
    expect(iconIn().getAttribute('aria-current')).toBeNull();
    expect(iconIn().classList.contains('on')).toBe(false);
    await fireEvent.click(iconIn());
    // 경로가 바뀌면 시뮬레이션 화면의 새 머리줄이 그려진다
    await waitFor(() => expect(iconIn().getAttribute('aria-current')).toBe('page'));
    expect(iconIn().classList.contains('on')).toBe(true);
  });

  it('keeps the status chip on the compare bar', async () => {
    render(App);
    await screen.findAllByRole('button', { name: '시뮬레이션' });
    const bar = document.querySelector('header.bar') as HTMLElement;
    expect(bar.querySelector('.chip, [class*="chip"]')).toBeTruthy();
  });
});

describe('route notice', () => {
  it('shows 전략을 찾을 수 없어요 when switching to a profile that lacks the routed strategy', async () => {
    localStorage.setItem(
      'gazua:v1:meta',
      JSON.stringify({
        schemaVersion: 1,
        activeProfileId: 'p1',
        profiles: [
          { id: 'p1', name: '내 프로필', createdAt: 1 },
          { id: 'p2', name: '둘째', createdAt: 2 },
        ],
      }),
    );
    localStorage.setItem('gazua:v1:p:p2:settings', JSON.stringify({ onboarded: true }));
    localStorage.setItem('gazua:v1:p:p2:watchlists', JSON.stringify({ groups: [{ id: 'g1', name: '내 관심', items: [] }] }));
    localStorage.setItem(
      'gazua:v1:p:p1:strategies',
      JSON.stringify({ strategies: [{ ...newStrategy(1, 'g1', '눌림목'), id: 's1' }] }),
    );
    location.hash = '#/simulate/s1';
    render(App);
    await fireEvent.click(await screen.findByRole('button', { name: /둘째/ }));
    await waitFor(() => expect(screen.getByText('전략을 찾을 수 없어요')).toBeTruthy());
    expect(location.hash).toBe('#/simulate');
  });
});
