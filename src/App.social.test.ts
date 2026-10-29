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
