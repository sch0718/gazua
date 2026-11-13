import { UPSTREAM } from '../src/allowlist.js';

export interface TossTokenKeeper {
  get(): Promise<string>;
  invalidate(token: string): boolean;
}

export function readTossKeys(env: Record<string, string | undefined>): { clientId: string; clientSecret: string } | undefined {
  const clientId = env.TOSS_CLIENT_ID?.trim();
  const clientSecret = env.TOSS_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
}

export function createTossTokenKeeper(
  keys: { clientId: string; clientSecret: string },
  deps: { fetchImpl: typeof fetch; now: () => number; timeoutMs: number; log?: (line: string) => void },
): TossTokenKeeper {
  let cached: { token: string; expiresAt: number; issuedAt: number } | undefined;
  let pending: Promise<string> | undefined;

  async function issue(): Promise<string> {
    let status = 0;
    try {
      const response = await deps.fetchImpl(`${UPSTREAM.toss}/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials', client_id: keys.clientId, client_secret: keys.clientSecret,
        }),
        redirect: 'manual',
        signal: AbortSignal.timeout(deps.timeoutMs),
      });
      status = response.status;
      if (!response.ok) throw new Error();
      const body: unknown = await response.json();
      if (!body || typeof body !== 'object' || !('access_token' in body) || !('expires_in' in body)
        || typeof body.access_token !== 'string' || !body.access_token.trim()
        || typeof body.expires_in !== 'number' || !Number.isFinite(body.expires_in) || body.expires_in <= 0) {
        throw new Error();
      }
      const issuedAt = deps.now();
      cached = { token: body.access_token, issuedAt, expiresAt: issuedAt + body.expires_in * 1000 };
      return cached.token;
    } catch {
      deps.log?.(`toss-token: issue failed ${status}`);
      throw new Error('토스 토큰을 받지 못했어요');
    }
  }

  return {
    get() {
      if (pending) return pending;
      if (cached && deps.now() < cached.expiresAt - 60_000) return Promise.resolve(cached.token);
      pending = issue().finally(() => { pending = undefined; });
      return pending;
    },
    invalidate(token) {
      if (!cached || cached.token !== token || deps.now() - cached.issuedAt < 60_000) return false;
      cached = undefined;
      return true;
    },
  };
}
