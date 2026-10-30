// 테스트와 로컬 개발에서만 쓰는 공급자다. 실제 네트워크는 부르지 않는다.
import { generateKeyPair, SignJWT } from 'jose';
import { SOCIAL_PROVIDERS, type CertSource, type SocialProvider } from '@sch0718/firebase-session/worker';

export function createFakeSocial(o: { clientIds: Record<SocialProvider, string>; clientSecrets: Record<SocialProvider, string>; now: () => number; random?: (n: number) => Uint8Array }) {
  const pairs: Partial<Record<SocialProvider, ReturnType<typeof generateKeyPair>>> = {};
  const pair = (provider: SocialProvider) => pairs[provider] ??= generateKeyPair('RS256');
  const source = (provider: SocialProvider): CertSource & { fail: boolean } => ({
    fail: false,
    async key(kid) {
      if (this.fail) throw new Error('공개키를 받지 못했어요');
      return kid === `fake-${provider}` ? (await pair(provider)).publicKey : null;
    },
  });
  const keys = { kakao: source('kakao'), naver: source('naver') };
  const codes = new Map<string, { provider: SocialProvider; clientId: string; redirectUri: string; challenge: string; nonce: string; sub: string; createdAt: number }>();
  const calls: string[] = [];
  const random = o.random ?? ((n: number) => crypto.getRandomValues(new Uint8Array(n)));
  const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const invalid = () => Response.json({ error: 'invalid_grant' }, { status: 400 });
  return {
    keys,
    calls,
    authorize(provider: SocialProvider, params: URLSearchParams | Record<string, string>, sub: string): { code: string } {
      const p = new URLSearchParams(params);
      if (p.get('response_type') !== 'code' || p.get('client_id') !== o.clientIds[provider] || p.get('code_challenge_method') !== 'S256' || !p.get('code_challenge') || !p.get('state') || !p.get('nonce') || !p.get('redirect_uri') || (provider === 'naver' && p.get('scope') !== 'openid')) throw new Error('인가 요청을 확인해 주세요');
      const code = encode(random(32));
      codes.set(code, { provider, clientId: p.get('client_id')!, redirectUri: p.get('redirect_uri')!, challenge: p.get('code_challenge')!, nonce: p.get('nonce')!, sub, createdAt: o.now() });
      return { code };
    },
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      // jsdom 시험에서는 URLSearchParams·AbortSignal이 다른 realm이라 Node 22의 Request가 거부한다.
      const req = new Request(input, { method: init?.method, headers: init?.headers, body: init?.body == null ? init?.body : String(init.body) });
      const provider = (Object.keys(SOCIAL_PROVIDERS) as SocialProvider[]).find((p) => req.url === SOCIAL_PROVIDERS[p].tokenUrl);
      if (!provider) throw new TypeError('가짜 공급자 밖의 주소예요');
      calls.push(req.url);
      if (req.method !== 'POST' || req.headers.get('Content-Type')?.split(';')[0] !== 'application/x-www-form-urlencoded') return invalid();
      const form = new URLSearchParams(await req.text());
      const code = form.get('code') ?? '';
      const saved = codes.get(code);
      if (!saved || saved.provider !== provider || o.now() - saved.createdAt >= 10 * 60 * 1000 || form.get('grant_type') !== 'authorization_code' || form.get('client_id') !== saved.clientId || form.get('client_secret') !== o.clientSecrets[provider] || form.get('redirect_uri') !== saved.redirectUri) return invalid();
      const challenge = encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(form.get('code_verifier') ?? ''))));
      if (challenge !== saved.challenge) return invalid();
      if (!codes.delete(code)) return invalid();
      if (saved.sub === 'error-503') return Response.json({ error: 'server_error' }, { status: 500 });
      if (saved.sub === 'error-code') return invalid();
      if (saved.sub === 'no-id-token') return Response.json({ access_token: 'fake-access', token_type: 'bearer' });
      const sec = Math.floor(o.now() / 1000);
      const idToken = await new SignJWT({ nonce: saved.nonce, ...(provider === 'kakao' && { email: `${saved.sub}@example.test` }) })
        .setProtectedHeader({ alg: 'RS256', kid: `fake-${provider}` })
        .setIssuer(SOCIAL_PROVIDERS[provider].issuer).setAudience(saved.clientId).setSubject(saved.sub)
        .setIssuedAt(sec).setExpirationTime(sec + 3600).sign((await pair(provider)).privateKey);
      return Response.json({ access_token: 'fake-access', token_type: 'bearer', id_token: idToken });
    }) as typeof fetch,
  };
}
