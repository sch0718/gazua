// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App.svelte';

vi.mock('./lib/sync/config', () => ({
  readSyncConfig: () => ({ apiUrl: 'https://sync.example.test', firebase: null, social: { kakao: { clientId: '시험용' } } }),
}));

afterEach(() => {
  document.head.querySelector('meta[name="referrer"]')?.remove();
  localStorage.clear();
  history.replaceState(null, '', '/');
});

describe('앱의 소셜 로그인 콜백', () => {
  it('콜백 청크를 못 받아도 안내를 보고 리퍼러 정책을 복원하며 돌아갈 수 있어요', async () => {
    document.head.insertAdjacentHTML('beforeend', '<meta name="referrer" content="no-referrer">');
    history.replaceState(null, '', '/auth/callback/');
    const loadSocialCallback = vi.fn(() => Promise.reject(new Error('chunk')));
    render(App, { socialReturn: { callback: null, hadParams: true, returnHash: '#/settings', label: '' }, loadSocialCallback });
    await screen.findByRole('heading', { name: '로그인 화면을 불러오지 못했어요' });
    expect(screen.getByRole('alert').textContent).toContain('인터넷 연결을 확인하고 돌아가서 다시 시도해 주세요.');
    expect(loadSocialCallback).toHaveBeenCalledOnce();
    await fireEvent.click(screen.getByRole('button', { name: '돌아가기' }));
    await waitFor(() => expect(location.href).toMatch(/\/#\/settings$/));
    expect(document.querySelector('meta[name="referrer"]')?.getAttribute('content')).toBe('strict-origin-when-cross-origin');
    expect(loadSocialCallback).toHaveBeenCalledOnce();
  });

  it('진행 중인 로그인이 없으면 콜백 안내를 보이고 설정으로 돌아간다', async () => {
    document.head.insertAdjacentHTML('beforeend', '<meta name="referrer" content="no-referrer">');
    history.replaceState(null, '', '/auth/callback/');
    localStorage.setItem('gazua:v1:meta', JSON.stringify({ schemaVersion: 1, activeProfileId: 'p1', profiles: [{ id: 'p1', name: '내 프로필', createdAt: 1 }] }));
    localStorage.setItem('gazua:v1:p:p1:settings', JSON.stringify({ onboarded: true }));
    render(App, { socialReturn: { callback: null, hadParams: true, returnHash: '#/settings', label: '' } });
    await screen.findByRole('heading', { name: '이 브라우저에서 시작한 로그인이 아니에요' });
    expect(screen.queryByText('시작하기')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: '돌아가기' }));
    await waitFor(() => expect(location.href).toMatch(/\/#\/settings$/));
    expect(location.pathname).toBe('/');
    expect(document.querySelector('meta[name="referrer"]')?.getAttribute('content')).toBe('strict-origin-when-cross-origin');
    await screen.findByText('동기화·공유');
  });
});
