// Google Identity Services 토큰 모델(설계 D1·D8). 접근 토큰은 탭 메모리에만 두고 저장하지 않는다.
export const GIS_SRC = 'https://accounts.google.com/gsi/client';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const RENEW_BEFORE_MS = 60_000;

interface TokenResponse { access_token?: string; expires_in?: number; scope?: string; error?: string }
interface TokenClientConfig { client_id: string; scope: string; callback: (r: TokenResponse) => void; error_callback?: (e: { type?: string }) => void }
export interface GoogleOAuth2 {
  initTokenClient(cfg: TokenClientConfig): { requestAccessToken(o?: { prompt?: string }): void };
  hasGrantedAllScopes(r: TokenResponse, ...scopes: string[]): boolean;
}
export type TokenResult = { ok: true; token: string } | { ok: false; reason: 'cancelled' | 'denied' | 'not-ready' };
export interface DriveAuth {
  /** 클릭 처리기 안에서 곧바로 부른다(팝업). await 앞에서 requestAccessToken까지 동기로 간다 */
  token(): Promise<TokenResult>;
  forget(): void;
}

const globalOAuth2 = (): GoogleOAuth2 | undefined =>
  (globalThis as { google?: { accounts?: { oauth2?: GoogleOAuth2 } } }).google?.accounts?.oauth2;

let loading: Promise<void> | null = null;
/** GIS 스크립트를 한 번만 넣는다. Drive 영역이 보일 때 미리 부른다 */
export function loadGis(doc: Document = document): Promise<void> {
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const s = doc.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      s.remove();
      reject(new Error('gis-load'));
    };
    doc.head.append(s);
  });
  return loading;
}

export function createDriveAuth(clientId: string, deps: { now?: () => number; oauth2?: () => GoogleOAuth2 | undefined } = {}): DriveAuth {
  const now = deps.now ?? Date.now;
  const oauth2 = deps.oauth2 ?? globalOAuth2;
  let cached: { token: string; expiresAt: number } | null = null;
  return {
    token() {
      if (cached && cached.expiresAt - RENEW_BEFORE_MS > now()) return Promise.resolve({ ok: true, token: cached.token });
      const g = oauth2();
      if (!g) return Promise.resolve({ ok: false, reason: 'not-ready' });
      return new Promise<TokenResult>((resolve) => {
        const client = g.initTokenClient({
          client_id: clientId,
          scope: DRIVE_SCOPE,
          callback: (r) => {
            if (r.error || !r.access_token || !g.hasGrantedAllScopes(r, DRIVE_SCOPE)) return resolve({ ok: false, reason: 'denied' });
            cached = { token: r.access_token, expiresAt: now() + (r.expires_in ?? 3600) * 1000 };
            resolve({ ok: true, token: r.access_token });
          },
          error_callback: (e) => resolve({ ok: false, reason: e.type === 'popup_closed' ? 'cancelled' : 'denied' }),
        });
        client.requestAccessToken({ prompt: '' });
      });
    },
    forget() {
      cached = null;
    },
  };
}
