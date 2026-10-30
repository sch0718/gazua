import { describe, expect, it, vi } from 'vitest';
import { SESSION_HEADER, createSyncApi } from './api';

describe('createSyncApi', () => {
  it('지정한 세션만 철회할 때 현재 세션과 Google 토큰을 보내지 않아요', async () => {
    const creds = { idToken: vi.fn(async () => 'current-token'), sessionId: vi.fn(async () => 'current-session') };
    const fetchImpl = vi.fn(async () => new Response('{}'));
    const api = createSyncApi('https://sync.example.test', creds, fetchImpl);
    expect((await api.endSessionById('late-session')).ok).toBe(true);
    const [url, init] = vi.mocked(fetchImpl as typeof fetch).mock.calls[0];
    expect(String(url)).toBe('https://sync.example.test/v1/session');
    expect(init?.method).toBe('DELETE');
    const headers = new Headers(init?.headers);
    expect(headers.get(SESSION_HEADER)).toBe('late-session');
    expect(headers.has('Authorization')).toBe(false);
    expect(creds.idToken).not.toHaveBeenCalled();
    expect(creds.sessionId).not.toHaveBeenCalled();
  });

  // Codex 리뷰(PR #39) 3: 오프라인에서 토큰 갱신이 실패해도 예외로 새지 않고 실패 결과가 된다(엔진이 백오프·재시도로 넘어가게).
  it('ID 토큰을 받다 실패하면 offline 실패로 돌려준다', async () => {
    const fetchImpl = vi.fn();
    const api = createSyncApi('https://sync.example.test', { idToken: async () => Promise.reject(new Error('auth/network-request-failed')), sessionId: async () => 's' }, fetchImpl);
    expect(await api.listProfiles()).toEqual({ ok: false, kind: 'offline' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
