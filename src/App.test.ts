// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
});
