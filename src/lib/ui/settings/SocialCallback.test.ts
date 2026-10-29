// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentSnackbar, dismissSnackbar } from '@sch0718/ui-svelte';
import { SvelteMap } from 'svelte/reactivity';
import type { SyncController } from '../../sync/controller.svelte';
import type { SocialOutcome, SocialReturn } from '../../sync/social';
import SocialCallback from './SocialCallback.svelte';

const RET: SocialReturn = { callback: { ok: false, provider: 'kakao', reason: 'cancelled' }, hadParams: true, returnHash: '#/settings', label: '내 폰' };
function fakeSync(outcome: SocialOutcome) {
  return {
    providers: { google: true, kakao: true, naver: true },
    busy: false,
    completeSocialSignIn: vi.fn(async () => outcome),
    signInWith: vi.fn(async () => {}),
  } as unknown as SyncController;
}

afterEach(() => dismissSnackbar());

describe('소셜 로그인 콜백 화면', () => {
  it('처리 중 공급자를 알리고 성공하면 원래 화면으로 돌아간다', async () => {
    const sync = fakeSync({ ok: true, provider: 'kakao' });
    const ondone = vi.fn();
    render(SocialCallback, { sync, ret: RET, ondone });
    expect(screen.getByRole('status').textContent).toContain('카카오로 로그인하는 중…');
    await waitFor(() => expect(ondone).toHaveBeenCalledWith('#/settings'));
    expect(sync.completeSocialSignIn).toHaveBeenCalledWith(RET);
    expect(currentSnackbar()?.message).toBe('카카오 계정으로 로그인했어요');
  });

  it('허용 목록 밖 계정 값을 보여 주고 복사한다', async () => {
    const copy = vi.fn(async () => {});
    render(SocialCallback, { sync: fakeSync({ ok: false, provider: 'kakao', reason: 'not-allowed', account: 'kakao:123' }), ret: RET, ondone: vi.fn(), copy });
    await screen.findByRole('heading', { name: '이 카카오 계정은 아직 허용 목록에 없어요' });
    expect(screen.getByText('kakao:123').tagName).toBe('CODE');
    await fireEvent.click(screen.getByRole('button', { name: '계정 값 복사' }));
    expect(copy).toHaveBeenCalledWith('kakao:123');
    await screen.findByText('복사했어요');
  });

  it('복사하지 못하면 계정 값을 선택하고 직접 복사하도록 알린다', async () => {
    render(SocialCallback, { sync: fakeSync({ ok: false, provider: 'kakao', reason: 'not-allowed', account: 'kakao:123' }), ret: RET, ondone: vi.fn(), copy: vi.fn(async () => { throw new Error('거절'); }) });
    await fireEvent.click(await screen.findByRole('button', { name: '계정 값 복사' }));
    await screen.findByText('복사하지 못했어요. 값을 길게 눌러 복사해 주세요');
    expect(window.getSelection()?.toString()).toBe('kakao:123');
  });

  it('공급자 장애면 잠시 뒤 다시 시도하도록 알린다', async () => {
    render(SocialCallback, { sync: fakeSync({ ok: false, provider: 'naver', reason: 'limit' }), ret: RET, ondone: vi.fn() });
    expect((await screen.findByRole('alert')).textContent).toContain('잠시 뒤 다시 시도해 주세요.');
  });

  it('취소 뒤 다시 로그인하면 저장된 기기 이름과 원래 화면을 넘긴다', async () => {
    const sync = fakeSync({ ok: false, provider: 'kakao', reason: 'cancelled' });
    render(SocialCallback, { sync, ret: { ...RET, returnHash: '#/watchlist' }, ondone: vi.fn() });
    await screen.findByRole('heading', { name: '로그인을 취소했어요' });
    await fireEvent.click(screen.getByRole('button', { name: '다시 로그인' }));
    expect(sync.signInWith).toHaveBeenCalledWith('kakao', '내 폰', '#/watchlist');
  });

  it('공급자를 모르면 처리 중 상태와 설정 안내에 카카오·네이버를 표시한다', async () => {
    render(SocialCallback, { sync: fakeSync({ ok: false, provider: null, reason: 'not-configured' }), ret: { ...RET, callback: null }, ondone: vi.fn() });
    expect(screen.getByRole('status').textContent).toBe('카카오·네이버로 로그인하는 중…');
    await screen.findByRole('heading', { name: '이 빌드에는 카카오·네이버 로그인이 설정되지 않았어요' });
  });

  it('다시 로그인할 때 저장소를 쓸 수 없으면 새 오류를 보여 준다', async () => {
    const errors = new SvelteMap<string, string>();
    const sync = fakeSync({ ok: false, provider: 'kakao', reason: 'cancelled' });
    Object.defineProperty(sync, 'error', { get: () => errors.get('retry') ?? null });
    sync.signInWith = vi.fn(async () => {
      errors.set('retry', '이 브라우저에서는 로그인을 시작할 수 없어요. 저장소를 쓸 수 없어요(사생활 보호 모드 등). 다른 브라우저로 열어 주세요.');
    });
    render(SocialCallback, { sync, ret: RET, ondone: vi.fn() });
    await fireEvent.click(await screen.findByRole('button', { name: '다시 로그인' }));
    await waitFor(() => expect(screen.getAllByRole('alert').some((alert) => alert.textContent?.includes('저장소를 쓸 수 없어요'))).toBe(true));
  });

  it('진행 중인 요청이 없으면 브라우저 안내를 보이고 돌아갈 수 있다', async () => {
    const ondone = vi.fn();
    render(SocialCallback, { sync: fakeSync({ ok: false, provider: null, reason: 'no-pending' }), ret: { ...RET, callback: null }, ondone });
    await screen.findByRole('heading', { name: '이 브라우저에서 시작한 로그인이 아니에요' });
    expect(screen.getByRole('alert').textContent).toContain('다른 브라우저로 돌아오면 이어서 할 수 없어요.');
    expect(screen.queryByRole('button', { name: '다시 로그인' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: '돌아가기' }));
    expect(ondone).toHaveBeenCalledWith('#/settings');
  });

  it('이 빌드에서 꺼진 공급자의 다시 로그인은 숨긴다', async () => {
    const sync = fakeSync({ ok: false, provider: 'kakao', reason: 'not-configured' });
    sync.providers.kakao = false;
    render(SocialCallback, { sync, ret: RET, ondone: vi.fn() });
    await screen.findByRole('heading', { name: '이 빌드에는 카카오 로그인이 설정되지 않았어요' });
    expect(screen.queryByRole('button', { name: '다시 로그인' })).toBeNull();
  });
});
