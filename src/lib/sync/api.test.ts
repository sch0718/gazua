import { describe, expect, it, vi } from 'vitest';
import { createSyncApi } from './api';

describe('createSyncApi', () => {
  // Codex 리뷰(PR #39) 3: 오프라인에서 토큰 갱신이 실패해도 예외로 새지 않고 실패 결과가 된다(엔진이 백오프·재시도로 넘어가게).
  it('ID 토큰을 받다 실패하면 offline 실패로 돌려준다', async () => {
    const fetchImpl = vi.fn();
    const api = createSyncApi('https://sync.example.test', { idToken: async () => Promise.reject(new Error('auth/network-request-failed')), sessionId: async () => 's' }, fetchImpl);
    expect(await api.listProfiles()).toEqual({ ok: false, kind: 'offline' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
