// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const { mount, take, calls } = vi.hoisted(() => ({ mount: vi.fn((_app: unknown, _options: unknown) => ({})), take: vi.fn(), calls: [] as string[] }));
vi.mock('svelte', () => ({ mount }));
vi.mock('./App.svelte', () => ({ default: {} }));
vi.mock('./lib/sync/socialFlow', () => ({ takeSocialCallback: take }));

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.doMock('./lib/sync/socialFlow', () => ({ takeSocialCallback: take }));
  calls.length = 0;
  history.replaceState(null, '', '/');
  document.body.innerHTML = '';
  document.head.querySelector('meta[name="referrer"]')?.remove();
});

describe('앱 시작의 소셜 콜백', () => {
  it('콜백을 읽고 주소를 지운 뒤 앱을 마운트한다', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    history.replaceState(null, '', '/auth/callback/?code=가짜&state=가짜');
    const ret = { callback: null, hadParams: true, returnHash: '#/settings', label: '' };
    take.mockImplementation(() => { calls.push('콜백'); history.replaceState(null, '', '/auth/callback/'); return ret; });
    mount.mockImplementation(() => { calls.push('마운트'); return {}; });
    await import('./main');
    await vi.waitFor(() => expect(mount).toHaveBeenCalled());
    expect(calls).toEqual(['콜백', '마운트']);
    expect(mount.mock.calls[0][1]).toMatchObject({ props: { socialReturn: ret } });
    expect(location.search).toBe('');
  });

  it('다른 경로에서는 콜백 모듈을 기다리지 않는다', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    await import('./main');
    expect(take).not.toHaveBeenCalled();
    expect(mount).toHaveBeenCalledTimes(1);
  });

  it('콜백 처리가 실패해도 쿼리를 지우고 앱을 연다', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    document.head.insertAdjacentHTML('beforeend', '<meta name="referrer" content="no-referrer">');
    history.replaceState(null, '', '/auth/callback/?code=가짜&state=가짜');
    take.mockImplementation(() => { throw new Error('모듈 오류'); });
    await import('./main');
    await vi.waitFor(() => expect(mount).toHaveBeenCalledTimes(1));
    expect(document.querySelector('meta[name="referrer"]')?.getAttribute('content')).toBe('strict-origin-when-cross-origin');
    expect(location.pathname).toBe('/');
    expect(location.search).toBe('');
    expect(mount.mock.calls[0][1]).toMatchObject({ props: { socialReturn: null } });
  });

  it('콜백 화면 없이 앱을 열어도 리퍼러 정책을 복구한다', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    document.head.insertAdjacentHTML('beforeend', '<meta name="referrer" content="no-referrer">');
    history.replaceState(null, '', '/auth/callback/');
    take.mockReturnValue(null);
    await import('./main');
    await vi.waitFor(() => expect(mount).toHaveBeenCalledTimes(1));
    expect(document.querySelector('meta[name="referrer"]')?.getAttribute('content')).toBe('strict-origin-when-cross-origin');
  });

  it.each([
    ['?code=가짜&state=가짜', ''],
    ['?keep=1&code=가짜&state=가짜&error=access_denied&error_description=설명&code=다른값#/settings', '?keep=1#/settings'],
  ])('청크를 기다리기 전에 콜백 쿼리만 지운다: %s', async (query, remaining) => {
    document.body.innerHTML = '<div id="app"></div>';
    history.replaceState({ keep: true }, '', '/auth/callback/' + query);
    const href = location.href;
    let release!: () => void;
    const loading = new Promise<void>((resolve) => { release = resolve; });
    vi.doMock('./lib/sync/socialFlow', async () => { await loading; return { takeSocialCallback: take }; });
    take.mockReturnValue({ callback: null, hadParams: true, returnHash: '#/settings', label: '' });
    const main = await import('./main');
    try {
      expect(take).not.toHaveBeenCalled();
      expect(location.search + location.hash).toBe(remaining);
      expect(history.state).toEqual({ keep: true });
    } finally { release(); await main.default; }
    expect(take).toHaveBeenCalledWith({ location: { href, pathname: '/auth/callback/' }, history });
  });
});
