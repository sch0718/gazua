// 테스트 전용: sync-worker 핸들러를 같은 프로세스에서 부르는 fetch. 테스트용 D1(node:sqlite)과 지어낸 서명 키를 쓴다.
import { harness, ME, ORIGIN, type Harness } from './harness';
import { createSyncApi, type Credentials, type SyncApi } from '../../src/lib/sync/api';

export const SYNC_BASE = 'https://sync.example.test';

export interface TestServer {
  h: Harness;
  /** 브라우저처럼 Origin을 붙여 핸들러로 보낸다. online=false면 네트워크 오류. */
  fetch: typeof fetch;
  online: boolean;
  /** 다음 요청의 응답을 잃는다(서버는 처리했지만 클라이언트는 오류를 받는다). */
  dropNextResponse: boolean;
  requests: { method: string; path: string }[];
}

export function testServer(): TestServer {
  const h = harness();
  const s: TestServer = {
    h,
    online: true,
    dropNextResponse: false,
    requests: [],
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!s.online) throw new TypeError('Failed to fetch');
      const req = new Request(input, init);
      const headers = new Headers(req.headers);
      headers.set('Origin', ORIGIN);
      const url = new URL(req.url);
      s.requests.push({ method: req.method, path: url.pathname });
      const res = await h.call(req.method, url.pathname + url.search, {
        origin: ORIGIN,
        token: headers.get('Authorization')?.replace(/^Bearer /, '') ?? null,
        session: headers.get('X-Gazua-Session'),
        headers: Object.fromEntries([...headers].filter(([k]) => !['authorization', 'x-gazua-session', 'origin'].includes(k))),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (s.dropNextResponse) {
        s.dropNextResponse = false;
        throw new TypeError('Failed to fetch');
      }
      return res;
    }) as typeof fetch,
  };
  return s;
}

/** 이 서버에 로그인한 기기 하나의 API 클라이언트(세션 포함). */
export async function deviceApi(s: TestServer, email = ME, sub = 'uid-me'): Promise<{ api: SyncApi; creds: Credentials & { session: string | null } }> {
  const creds = {
    session: null as string | null,
    idToken: async () => s.h.token({ email, sub }),
    sessionId: async () => creds.session,
  };
  const api = createSyncApi(SYNC_BASE, creds, s.fetch);
  const r = await api.createSession(await s.h.token({ email, sub }), '테스트 기기');
  if (!r.ok) throw new Error(`session ${r.kind}`);
  creds.session = r.data.sessionId;
  return { api, creds };
}
