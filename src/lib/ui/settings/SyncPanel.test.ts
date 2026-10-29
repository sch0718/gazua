// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeTestApp } from '../../../sheets/testApp';
import type { App } from '../../state/app.svelte';
import type { SyncController } from '../../sync/controller.svelte';
import type { SyncStatus } from '../../sync/engine';
import { buildProfileDoc } from '../../sync/profileDoc';
import { createSafeStorage } from '../../state/storage';
import { memoryBacking } from '../../state/testStorage';
import SyncPanel from './SyncPanel.svelte';

const STATUS: SyncStatus = { enabled: false, phase: 'off', pending: 0, conflicts: [], rejected: [], lastSyncAt: null, notices: [], volatile: false };

function fakeSync(over: Partial<Omit<SyncController, 'status'>> & { status?: Partial<SyncStatus> } = {}): SyncController {
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
    clearError: vi.fn(),
    clearNotices: vi.fn(),
    destroy: vi.fn(),
    ...rest,
  } as SyncController;
}

let apps: App[] = [];
function app() {
  const a = makeTestApp({ groups: [{ id: 'g1', name: '내 관심', items: [] }], now: Date.UTC(2026, 9, 25) });
  apps.push(a);
  return a;
}
afterEach(() => {
  for (const a of apps) a.destroy();
  apps = [];
});

describe('SyncPanel', () => {
  it('설정이 없는 빌드면 안내만 보인다', () => {
    render(SyncPanel, { app: app(), sync: fakeSync({ configured: false }) });
    expect(screen.getByText('이 빌드에는 동기화가 설정되지 않았어요')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Google로 로그인' })).toBeNull();
  });

  it('로그인 전: 올리는 것·올리지 않는 것을 알리고 기기 이름과 함께 로그인한다', async () => {
    const sync = fakeSync();
    render(SyncPanel, { app: app(), sync });
    expect(screen.getByText(/키·계좌·주문 내역·성과·프록시 주소·테마는 올리지 않아요/)).toBeTruthy();
    await fireEvent.input(screen.getByLabelText('이 기기 이름(선택)'), { target: { value: '회사 노트북' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Google로 로그인' }));
    expect(sync.signIn).toHaveBeenCalledWith('회사 노트북');
  });

  it('처음 켤 때 올릴·받을 프로필을 확인받는다', async () => {
    const sync = fakeSync({ account: { provider: 'google', id: 'me@example.test', display: 'me@example.test' } });
    render(SyncPanel, { app: app(), sync });
    await fireEvent.click(screen.getByRole('button', { name: '동기화 켜기' }));
    await waitFor(() => expect(screen.getByRole('group', { name: '동기화 켜기 확인' })).toBeTruthy());
    expect(screen.getByText(/프로필 1개\(내 프로필\)를 올리고, 서버의 프로필\s+2개를/)).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: '켜기' }));
    expect(sync.setEnabled).toHaveBeenCalledWith(true);
  });

  it('켜져 있으면 상태·대기 수와 지금 동기화·끄기·로그아웃을 보인다', async () => {
    const sync = fakeSync({ account: { provider: 'google', id: 'me@example.test', display: 'me@example.test' }, status: { enabled: true, phase: 'offline', pending: 2 } });
    render(SyncPanel, { app: app(), sync });
    expect(screen.getByRole('status').textContent).toContain('오프라인이에요');
    expect(screen.getByRole('status').textContent).toContain('보낼 변경 2건');
    await fireEvent.click(screen.getByRole('button', { name: '지금 동기화' }));
    expect(sync.syncNow).toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: '로그아웃' }));
    expect(sync.signOut).toHaveBeenCalled();
  });

  it('수정 충돌은 세 가지, 삭제 충돌은 두 가지로 고른다', async () => {
    const a = app();
    const doc = buildProfileDoc(createSafeStorage(memoryBacking()), 'x', '내 프로필');
    const sync = fakeSync({
      account: { provider: 'google', id: 'me@example.test', display: 'me@example.test' },
      status: {
        enabled: true,
        phase: 'idle',
        conflicts: [
          { profileId: a.meta.activeProfileId, kind: 'edit', local: doc, remote: { ...doc, name: '서버 이름' }, remoteRevision: 3, detectedAt: 1 },
          { profileId: 'gone', kind: 'deleted', local: { ...doc, name: '지운 것' }, deletedAt: 1, purgeAt: Date.UTC(2026, 10, 24), remoteRevision: 4, detectedAt: 1 },
        ],
      },
    });
    render(SyncPanel, { app: a, sync });
    expect(screen.getByText('충돌한 프로필 2개')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: '둘 다 남기기' }));
    expect(sync.resolve).toHaveBeenCalledWith(a.meta.activeProfileId, 'keep-both');
    await fireEvent.click(screen.getByRole('button', { name: '이 기기 것 유지' }));
    await fireEvent.click(screen.getByRole('button', { name: '서버 것 받기' }));
    expect(sync.resolve).toHaveBeenCalledWith(a.meta.activeProfileId, 'keep-local');
    expect(sync.resolve).toHaveBeenCalledWith(a.meta.activeProfileId, 'take-remote');
    await fireEvent.click(screen.getByRole('button', { name: '복구하고 이 기기 것 올리기' }));
    expect(sync.resolve).toHaveBeenCalledWith('gone', 'restore');
    await fireEvent.click(screen.getByRole('button', { name: '이 기기에서도 지우기' }));
    expect(sync.resolve).toHaveBeenCalledWith('gone', 'delete-local');
  });

  it('관리 목록은 펼칠 때 읽고, 기기를 철회할 수 있다', async () => {
    const sync = fakeSync({
      account: { provider: 'google', id: 'me@example.test', display: 'me@example.test' },
      sessions: vi.fn(async () => [
        { id: 'aaaaaaaaaaaa', label: '이 노트북', createdAt: 1, lastUsedAt: 2, expiresAt: 3, current: true },
        { id: 'bbbbbbbbbbbb', label: '잃어버린 폰', createdAt: 1, lastUsedAt: 2, expiresAt: 3, current: false },
      ]),
    });
    render(SyncPanel, { app: app(), sync });
    expect(sync.sessions).not.toHaveBeenCalled();
    const details = screen.getByText('로그인한 기기').closest('details')!;
    details.open = true;
    await fireEvent(details, new Event('toggle'));
    await waitFor(() => expect(screen.getByText('잃어버린 폰')).toBeTruthy());
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await fireEvent.click(screen.getByRole('button', { name: '잃어버린 폰 로그아웃' }));
    expect(sync.revokeSession).toHaveBeenCalledWith('bbbbbbbbbbbb');
  });

  // Codex 리뷰(PR #39) 3차 2: 과거 버전 목록을 연 뒤 프로필을 바꾸면, 보이는 목록과 다른 프로필에서 복원하지 않는다.
  it('과거 버전은 목록을 불러온 프로필에서 복원하고, 프로필을 바꾸면 목록을 다시 읽는다', async () => {
    const a = app();
    const first = a.meta.activeProfileId;
    const sync = fakeSync({ account: { provider: 'google', id: 'me@example.test', display: 'me@example.test' }, status: { enabled: true, phase: 'idle' }, revisions: vi.fn(async () => [{ revision: 3, createdAt: 1, deleted: false }]) });
    render(SyncPanel, { app: a, sync });
    const details = screen.getByText('지금 프로필의 과거 버전').closest('details')!;
    details.open = true;
    await fireEvent(details, new Event('toggle'));
    const btn = await waitFor(() => screen.getByRole('button', { name: '버전 3을 새 프로필로 복원' }));
    const other = a.addProfile('다른 프로필');
    a.switchProfile(other.id);
    await fireEvent.click(btn);
    expect(sync.restoreRevision).not.toHaveBeenCalledWith(other.id, 3);
    await waitFor(() => expect(sync.revisions).toHaveBeenLastCalledWith(other.id));
    void first;
  });
});


describe('로그인 공급자', () => {
  it.each([
    [{ google: true, kakao: true, naver: true }, ['Google로 로그인', '카카오로 로그인', '네이버로 로그인']],
    [{ google: false, kakao: true, naver: true }, ['카카오로 로그인', '네이버로 로그인']],
    [{ google: false, kakao: false, naver: true }, ['네이버로 로그인']],
    [{ google: false, kakao: false, naver: false }, []],
  ])('설정된 공급자의 단추만 순서대로 보여 준다: %j', (providers, names) => {
    render(SyncPanel, { app: app(), sync: fakeSync({ providers }) });
    expect(screen.queryAllByRole('button', { name: /로 로그인$/ }).map((b) => b.textContent)).toEqual(names);
    if (!names.length) expect(screen.getByText('이 빌드에는 로그인 방법이 설정되지 않았어요')).toBeTruthy();
  });

  it('카카오로 로그인할 때 입력한 기기 이름을 넘긴다', async () => {
    const sync = fakeSync({ providers: { google: false, kakao: true, naver: false } });
    render(SyncPanel, { app: app(), sync });
    expect(screen.getByText(/카카오 중 쓸 수 있는 계정으로 로그인하면/)).toBeTruthy();
    expect(screen.queryByText(/Google/)).toBeNull();
    await fireEvent.input(screen.getByLabelText('이 기기 이름(선택)'), { target: { value: '내 폰' } });
    await fireEvent.click(screen.getByRole('button', { name: '카카오로 로그인' }));
    expect(sync.signInWith).toHaveBeenCalledWith('kakao', '내 폰');
  });

  it('네이버 로그인도 기기 이름을 넘기고 처리 중에는 모든 단추를 막는다', async () => {
    const sync = fakeSync({ providers: { google: true, kakao: true, naver: true } });
    const view = render(SyncPanel, { app: app(), sync });
    await fireEvent.input(screen.getByLabelText('이 기기 이름(선택)'), { target: { value: '집 PC' } });
    await fireEvent.click(screen.getByRole('button', { name: '네이버로 로그인' }));
    expect(sync.signInWith).toHaveBeenCalledWith('naver', '집 PC');
    await view.rerender({ app: app(), sync: { ...sync, busy: true } });
    for (const button of screen.getAllByRole('button', { name: /로 로그인$/ })) expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it.each([true, false])('인앱 브라우저에서 카카오 설정에 맞춰 안내한다: %s', (kakao) => {
    render(SyncPanel, { app: app(), sync: fakeSync({ providers: { google: true, kakao, naver: false } }), userAgent: 'KAKAOTALK Android' });
    expect(screen.getByText(/카카오톡·네이버 앱 안의 브라우저에서는 Google 로그인이 막혀요/).textContent).toContain('다른 브라우저로 열어 주세요.');
    expect(screen.queryByText(/카카오로 로그인을 쓰거나/)!==null).toBe(kakao);
  });

  it('Google이 꺼진 인앱 브라우저에는 Google 안내를 보이지 않는다', () => {
    render(SyncPanel, { app: app(), sync: fakeSync({ providers: { google: false, kakao: true, naver: true } }), userAgent: 'NAVER(inapp; search)' });
    expect(screen.queryByText(/Google 로그인이 막혀요/)).toBeNull();
  });

  it('소셜 계정은 표시값과 공급자·허용 목록 값을 함께 보여 준다', () => {
    render(SyncPanel, { app: app(), sync: fakeSync({ account: { provider: 'kakao', id: 'kakao:123', display: 'me@example.test' } }) });
    expect(screen.getByText('me@example.test')).toBeTruthy();
    expect(screen.getByText('카카오 계정으로 로그인됨')).toBeTruthy();
    expect(screen.getByText('kakao:123')).toBeTruthy();
  });
});
