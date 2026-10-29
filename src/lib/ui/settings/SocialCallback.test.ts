// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentSnackbar, dismissSnackbar } from '@sch0718/ui-svelte';
import { SvelteMap } from 'svelte/reactivity';
import { tick } from 'svelte';
import type { SyncController } from '../../sync/controller.svelte';
import type { SocialOutcome, SocialReturn } from '../../sync/social';
import SocialCallback from './SocialCallback.svelte';

const RET: SocialReturn = { callback: { ok: false, provider: 'kakao', reason: 'cancelled' }, hadParams: true, returnHash: '#/settings', label: '내 폰' };
function fakeSync(outcome: SocialOutcome) {
  return {
    providers: { google: true, kakao: true, naver: true },
    busy: false,
    abandonSocialSignIn: vi.fn(),
    completeSocialSignIn: vi.fn(async () => outcome),
    signInWith: vi.fn(async () => {}),
  } as unknown as SyncController;
}

afterEach(() => { dismissSnackbar(); vi.useRealTimers(); });

describe('소셜 로그인 콜백 화면', () => {
  it('처리 중 공급자를 알리고 성공하면 원래 화면으로 돌아간다', async () => {
    const sync = fakeSync({ ok: true, provider: 'kakao' });
    const ondone = vi.fn();
    render(SocialCallback, { sync, ret: RET, ondone });
    expect(screen.getByRole('status').textContent).toContain('카카오로 로그인하는 중…');
    await waitFor(() => expect(ondone).toHaveBeenCalledWith('#/settings'));
    expect(sync.completeSocialSignIn).toHaveBeenCalledWith(RET, { onLate: expect.any(Function) });
    expect(currentSnackbar()?.message).toBe('카카오 계정으로 로그인했어요');
  });

  it('처리가 오래 걸리면 돌아갈 수 있다', async () => {
    vi.useFakeTimers();
    const sync = fakeSync({ ok: true, provider: 'kakao' });
    sync.completeSocialSignIn = vi.fn(() => new Promise<SocialOutcome>(() => {}));
    const ondone = vi.fn();
    const view = render(SocialCallback, { sync, ret: RET, ondone, escapeAfter: 100 });
    try {
      expect(screen.queryByRole('button', { name: '돌아가기' })).toBeNull();
      await vi.advanceTimersByTimeAsync(99);
      expect(screen.queryByRole('button', { name: '돌아가기' })).toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      await tick();
      expect(screen.getByText('시간이 걸리고 있어요. 돌아가서 다시 시도할 수 있어요.')).toBeTruthy();
      await fireEvent.click(screen.getByRole('button', { name: '돌아가기' }));
      expect(sync.abandonSocialSignIn).toHaveBeenCalledOnce();
      expect(ondone).toHaveBeenCalledWith('#/settings');
    } finally { view.unmount(); }
  });

  it('돌아간 뒤 늦은 결과는 무시하고 타이머를 남기지 않는다', async () => {
    vi.useFakeTimers();
    const sync = fakeSync({ ok: true, provider: 'kakao' });
    let resolve!: (result: SocialOutcome) => void;
    sync.completeSocialSignIn = vi.fn(() => new Promise<SocialOutcome>((done) => { resolve = done; }));
    const ondone = vi.fn();
    const before = vi.getTimerCount();
    const view = render(SocialCallback, { sync, ret: RET, ondone });
    expect(vi.getTimerCount()).toBe(before + 1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(before);
    resolve({ ok: true, provider: 'kakao' });
    await tick();
    expect(ondone).not.toHaveBeenCalled();
    expect(currentSnackbar()).toBeNull();
  });

  it('서버 응답 제한 시간이 지나면 다시 로그인할 수 있어요', async () => {
    render(SocialCallback, { sync: fakeSync({ ok: false, provider: 'kakao', reason: 'timeout' }), ret: RET, ondone: vi.fn() });
    await screen.findByRole('heading', { name: '동기화 서버의 응답이 늦어요' });
    expect(screen.getByRole('alert').textContent).toContain('결과가 오면 알려 드려요. 지금 다시 로그인할 수도 있어요.');
    expect(screen.getByRole('button', { name: '다시 로그인' })).toBeTruthy();
  });

  it.each([true, false])('타임아웃 화면에 늦은 결과를 반영하고 화면이 사라지면 무시해요: %s', async (ok) => {
    const sync = fakeSync({ ok: false, provider: 'kakao', reason: 'timeout' });
    let onLate: ((outcome: SocialOutcome) => void) | undefined;
    sync.completeSocialSignIn = vi.fn<SyncController['completeSocialSignIn']>(async (_ret, opts) => {
      onLate = opts?.onLate;
      return { ok: false, provider: 'kakao', reason: 'timeout' };
    });
    const ondone = vi.fn();
    const view = render(SocialCallback, { sync, ret: RET, ondone });
    await screen.findByRole('heading', { name: '동기화 서버의 응답이 늦어요' });
    expect(onLate).toBeTypeOf('function');
    onLate!(ok ? { ok: true, provider: 'kakao' } : { ok: false, provider: 'kakao', reason: 'not-allowed', account: 'kakao:stranger' });
    await tick();
    if (ok) expect(ondone).toHaveBeenCalledExactlyOnceWith(RET.returnHash);
    else {
      expect(ondone).not.toHaveBeenCalled();
      expect(screen.getByRole('heading').textContent).toBe('이 카카오 계정은 아직 허용 목록에 없어요');
      expect(screen.getByText('kakao:stranger')).toBeTruthy();
    }
    expect(currentSnackbar()).toBeNull();
    view.unmount();
    ondone.mockClear();
    onLate!({ ok: true, provider: 'kakao' });
    expect(ondone).not.toHaveBeenCalled();
    expect(currentSnackbar()).toBeNull();
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

  it('카카오 일반 브라우저에서는 재시도와 다른 계정 로그인을 따로 할 수 있어요', async () => {
    const sync = fakeSync({ ok: false, provider: 'kakao', reason: 'not-allowed', account: 'kakao:123' });
    render(SocialCallback, { sync, ret: RET, ondone: vi.fn(), userAgent: 'Mozilla/5.0 Chrome/120.0' });
    await fireEvent.click(await screen.findByRole('button', { name: '다시 로그인' }));
    expect(sync.signInWith).toHaveBeenNthCalledWith(1, 'kakao', '내 폰', '#/settings');
    await fireEvent.click(screen.getByRole('button', { name: '다른 계정으로 로그인' }));
    expect(sync.signInWith).toHaveBeenNthCalledWith(2, 'kakao', '내 폰', '#/settings', { reauth: true });
  });

  it.each([
    ['kakao', '카카오', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.4.0'],
    ['naver', '네이버', 'Mozilla/5.0 Chrome/120.0'],
  ] as const)('계정 선택을 강제할 수 없으면 공급자 로그아웃을 안내해요: %s', async (provider, name, userAgent) => {
    const sync = fakeSync({ ok: false, provider, reason: 'not-allowed' });
    render(SocialCallback, { sync, ret: RET, ondone: vi.fn(), userAgent });
    await screen.findByRole('heading', { name: `이 ${name} 계정은 아직 허용 목록에 없어요` });
    expect(screen.queryByRole('button', { name: '다른 계정으로 로그인' })).toBeNull();
    expect(screen.getByText(`다른 계정으로 로그인하려면 ${name}에서 로그아웃한 뒤 다시 로그인해 주세요.`)).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: '다시 로그인' }));
    expect(sync.signInWith).toHaveBeenCalledWith(provider, '내 폰', '#/settings');
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
