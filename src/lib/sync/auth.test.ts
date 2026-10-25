import { describe, expect, it, vi } from 'vitest';
import { firebaseAuth } from './auth';

const CFG = { apiKey: 'k', authDomain: 'gazua-test.firebaseapp.com', projectId: 'gazua-test', appId: 'a' };

describe('firebaseAuth', () => {
  // Codex 리뷰(PR #39) 4: SDK 조각을 한 번 못 불러와도(오프라인) 다음 시도에서 다시 불러온다.
  it('SDK를 불러오지 못한 뒤에는 다음 호출에서 다시 불러온다', async () => {
    const impl = { getAuthFor: () => ({}), ready: async () => null, signIn: async () => null, redirectResult: async () => null, signOut: async () => {}, idToken: async () => 'tok' };
    const load = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch dynamically imported module')).mockResolvedValue(impl);
    const auth = firebaseAuth(CFG, load);
    await expect(auth.ready()).rejects.toThrow();
    expect(await auth.idToken()).toBe('tok');
    expect(load).toHaveBeenCalledTimes(2);
  });
});
