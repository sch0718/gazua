// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createDriveAuth, DRIVE_SCOPE, GIS_SRC, loadGis, type GoogleOAuth2 } from './gis';

function fakeOAuth(reply: (cb: { callback: (r: any) => void; error_callback?: (e: any) => void }) => void, granted = true) {
  const requestAccessToken = vi.fn();
  const oauth2: GoogleOAuth2 = {
    initTokenClient: vi.fn((cfg) => ({ requestAccessToken: () => (requestAccessToken(), reply(cfg)) })),
    hasGrantedAllScopes: vi.fn(() => granted),
  };
  return { oauth2, requestAccessToken };
}

describe('createDriveAuth', () => {
  it('토큰을 받아 기억하고, 만료 1분 전까지는 다시 묻지 않는다', async () => {
    let now = 0;
    const { oauth2, requestAccessToken } = fakeOAuth(({ callback }) => callback({ access_token: 'tok', expires_in: 3600, scope: DRIVE_SCOPE }));
    const auth = createDriveAuth('cid', { now: () => now, oauth2: () => oauth2 });
    expect(await auth.token()).toEqual({ ok: true, token: 'tok' });
    now += 3600_000 - 61_000;
    expect(await auth.token()).toEqual({ ok: true, token: 'tok' });
    now += 2_000;
    await auth.token();
    expect(requestAccessToken).toHaveBeenCalledTimes(2);
    expect(oauth2.initTokenClient).toHaveBeenCalledWith(expect.objectContaining({ client_id: 'cid', scope: DRIVE_SCOPE }));
  });
  it('팝업을 닫으면 cancelled, 거절·범위 없음은 denied, 스크립트가 없으면 not-ready', async () => {
    const closed = fakeOAuth(({ error_callback }) => error_callback?.({ type: 'popup_closed' }));
    expect(await createDriveAuth('c', { oauth2: () => closed.oauth2 }).token()).toEqual({ ok: false, reason: 'cancelled' });
    const denied = fakeOAuth(({ callback }) => callback({ error: 'access_denied' }));
    expect(await createDriveAuth('c', { oauth2: () => denied.oauth2 }).token()).toEqual({ ok: false, reason: 'denied' });
    const noScope = fakeOAuth(({ callback }) => callback({ access_token: 't', expires_in: 3600 }), false);
    expect(await createDriveAuth('c', { oauth2: () => noScope.oauth2 }).token()).toEqual({ ok: false, reason: 'denied' });
    expect(await createDriveAuth('c', { oauth2: () => undefined }).token()).toEqual({ ok: false, reason: 'not-ready' });
  });
  it('requestAccessToken은 token()을 부른 그 호출 안에서 동기로 불린다(팝업 차단 방지)', () => {
    const { oauth2, requestAccessToken } = fakeOAuth(() => {});
    void createDriveAuth('c', { oauth2: () => oauth2 }).token();
    expect(requestAccessToken).toHaveBeenCalledTimes(1);
  });
  it('forget하면 다시 묻는다', async () => {
    const { oauth2, requestAccessToken } = fakeOAuth(({ callback }) => callback({ access_token: 't', expires_in: 3600 }));
    const auth = createDriveAuth('c', { now: () => 0, oauth2: () => oauth2 });
    await auth.token();
    auth.forget();
    await auth.token();
    expect(requestAccessToken).toHaveBeenCalledTimes(2);
  });
});

describe('loadGis', () => {
  it('스크립트 태그를 한 번만 넣는다', () => {
    void loadGis(document);
    void loadGis(document);
    expect(document.querySelectorAll(`script[src="${GIS_SRC}"]`)).toHaveLength(1);
  });
});
