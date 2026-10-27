// 테스트 하네스: 지어낸 RSA 키로 Firebase 모양 토큰을 만들고, 테스트용 D1 위에서 핸들러를 부른다.
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { CertSource } from '@sch0718/firebase-session/worker';
import type { SyncDeps, SyncEnv } from '../src/env';
import { handle } from '../src/handler';
import { createTestD1, type TestD1 } from './d1';

export const PROJECT = 'gazua-test';
export const ORIGIN = 'https://app.example.test';
export const ME = 'me@example.test';
export const OTHER = 'other@example.test';
export const BASE = 'https://sync.example.test';
export const T0 = Date.UTC(2026, 9, 25, 3, 0, 0);

const keys = await generateKeyPair('RS256', { extractable: true });
const otherKeys = await generateKeyPair('RS256', { extractable: true });
export { keys, otherKeys, exportJWK };

export interface Harness {
  env: SyncEnv & { DB: TestD1 };
  deps: SyncDeps;
  clock: { now: number };
  logs: string[];
  token(claims?: Record<string, unknown>, opts?: { kid?: string; key?: CryptoKey; alg?: string }): Promise<string>;
  call(method: string, path: string, o?: { token?: string | null; session?: string | null; body?: unknown; origin?: string | null; headers?: Record<string, string> }): Promise<Response>;
  /** 로그인해서 세션을 만든다. */
  login(email?: string, sub?: string, label?: string): Promise<{ token: string; session: string; as: Caller }>;
}

export type Caller = (method: string, path: string, body?: unknown) => Promise<Response>;

export function harness(opts: { allowed?: string } = {}): Harness {
  const clock = { now: T0 };
  const logs: string[] = [];
  let n = 0;
  const certs: CertSource = { key: async (kid) => (kid === 'k1' ? keys.publicKey : null) };
  const deps: SyncDeps = {
    now: () => clock.now,
    certs,
    random: (len) => crypto.getRandomValues(new Uint8Array(len)),
    uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    log: (l) => logs.push(l),
  };
  const env = { DB: createTestD1(), ALLOWED_ORIGINS: `${ORIGIN}, https://second.example.test`, FIREBASE_PROJECT_ID: PROJECT, ALLOWED_EMAILS: opts.allowed ?? `${ME},${OTHER.toUpperCase()}` };

  const token: Harness['token'] = async (claims = {}, o = {}) => {
    const sec = Math.floor(clock.now / 1000);
    const body = {
      iss: `https://securetoken.google.com/${PROJECT}`,
      aud: PROJECT,
      sub: 'uid-me',
      auth_time: sec,
      iat: sec,
      exp: sec + 3600,
      email: ME,
      email_verified: true,
      ...claims,
    };
    for (const [k, v] of Object.entries(body)) if (v === undefined) delete (body as Record<string, unknown>)[k];
    return new SignJWT(body).setProtectedHeader({ alg: o.alg ?? 'RS256', kid: o.kid ?? 'k1', typ: 'JWT' }).sign(o.key ?? keys.privateKey);
  };

  const call: Harness['call'] = (method, path, o = {}) => {
    const headers: Record<string, string> = { ...o.headers };
    if (o.origin !== null) headers.Origin = o.origin ?? ORIGIN;
    if (o.token) headers.Authorization = `Bearer ${o.token}`;
    if (o.session) headers['X-Gazua-Session'] = o.session;
    if (o.body !== undefined) headers['Content-Type'] = 'application/json';
    return handle(new Request(BASE + path, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) }), env, deps);
  };

  return {
    env,
    deps,
    clock,
    logs,
    token,
    call,
    async login(email = ME, sub = 'uid-me', label = '테스트 기기') {
      const t = await token({ email, sub });
      const res = await call('POST', '/v1/session', { token: t, body: { label } });
      if (res.status !== 200) throw new Error(`login ${res.status} ${await res.text()}`);
      const { sessionId } = (await res.json()) as { sessionId: string };
      const as: Caller = async (method, path, body) => call(method, path, { token: await token({ email, sub }), session: sessionId, body });
      return { token: t, session: sessionId, as };
    },
  };
}
