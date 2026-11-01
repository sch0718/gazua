// 테스트 전용: 화면에서 쓰는 SyncController 가짜.
import { vi } from 'vitest';
import type { SyncController } from '../../sync/controller.svelte';
import type { SyncStatus } from '../../sync/engine';

export const STATUS: SyncStatus = { enabled: false, phase: 'off', pending: 0, conflicts: [], rejected: [], lastSyncAt: null, notices: [], volatile: false };

export function fakeSync(over: Partial<Omit<SyncController, 'status'>> & { status?: Partial<SyncStatus> } = {}): SyncController {
  const { status, ...rest } = over;
  return {
    configured: true,
    providers: { google: true, kakao: false, naver: false },
    account: null,
    status: { ...STATUS, ...status },
    busy: false,
    error: null,
    api: null,
    attach: vi.fn(),
    onSyncableChange: vi.fn(),
    signIn: vi.fn(async () => {}),
    signInWith: vi.fn(async () => {}),
    completeSocialSignIn: vi.fn(async () => ({ ok: false, provider: null, reason: 'no-pending' })),
    signOut: vi.fn(async () => {}),
    preview: vi.fn(async () => ({ upload: ['내 프로필'], download: 2 })),
    setEnabled: vi.fn(async () => {}),
    syncNow: vi.fn(async () => {}),
    resolve: vi.fn(async () => {}),
    remoteProfiles: vi.fn(async () => []),
    restoreDeleted: vi.fn(async () => true),
    revisions: vi.fn(async () => []),
    restoreRevision: vi.fn(async () => null),
    sessions: vi.fn(async () => []),
    revokeSession: vi.fn(async () => true),
    shares: vi.fn(async () => []),
    createShare: vi.fn(async () => null),
    revokeShare: vi.fn(async () => true),
    cliApprove: vi.fn(async () => ({ ok: false, reason: 'error' })),
    cliTokens: vi.fn(async () => ({ ok: true, tokens: [] })),
    cliRevoke: vi.fn(async () => true),
    clearError: vi.fn(),
    clearNotices: vi.fn(),
    destroy: vi.fn(),
    // KeySync가 해제될 때 cancelReceive를 부른다(받기 확인 사이 평문을 버림). 화면이 부르는 메서드는 모두 vi.fn으로 둔다
    keys: {
      view: { support: true, vault: null, accountNotice: null, states: [], problem: null, remembered: false, persistent: true, uploaded: [] },
      createVault: vi.fn(async () => ({ ok: true, notes: [] })),
      unlockVault: vi.fn(async () => ({ ok: true, notes: [] })),
      enable: vi.fn(async () => ({ ok: true, notes: [] })),
      setProviders: vi.fn(async () => ({ ok: true, notes: [] })),
      prepareReceive: vi.fn(async () => ({ ok: true, overwrite: [] })),
      commitReceive: vi.fn(async () => ({ ok: true, notes: [] })),
      cancelReceive: vi.fn(),
      uploadLocal: vi.fn(async () => ({ ok: true, notes: [] })),
      disable: vi.fn(async () => ({ ok: true, notes: [] })),
      changePassphrase: vi.fn(async () => ({ ok: true, notes: [] })),
      wipe: vi.fn(async () => ({ ok: true, notes: [] })),
      forget: vi.fn(),
      dismiss: vi.fn(async () => {}),
      dismissAccount: vi.fn(async () => {}),
    } as unknown as SyncController['keys'],
    onSecretsChange: vi.fn(),
    onLock: vi.fn(),
    ...rest,
  } as SyncController;
}

