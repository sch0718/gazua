// 로컬 화면 시험 전용 진입점이다. 지어낸 공급자와 키를 쓰므로 절대 배포하지 않는다.
import type { SocialProvider } from '@sch0718/firebase-session/worker';
import type { SyncEnv } from '../src/env';
import { handle } from '../src/handler';
import { purge } from '../src/purge';
import { createFakeSocial } from './fakeSocial';

let current: { config: string; fake: ReturnType<typeof createFakeSocial> } | undefined;

// env는 요청 때 받는다. 같은 설정에서는 코드와 서명 키를 isolate 안에서 재사용한다.
function fakeFor(env: SyncEnv) {
  const clientIds = { kakao: env.KAKAO_CLIENT_ID?.trim() ?? '', naver: env.NAVER_CLIENT_ID?.trim() ?? '' };
  const clientSecrets = { kakao: env.KAKAO_CLIENT_SECRET?.trim() ?? '', naver: env.NAVER_CLIENT_SECRET?.trim() ?? '' };
  const config = JSON.stringify([clientIds, clientSecrets]);
  if (!current || current.config !== config) current = { config, fake: createFakeSocial({ clientIds, clientSecrets, now: Date.now }) };
  return current.fake;
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const headers = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
};
const badRequest = () => new Response('클라이언트 ID나 콜백 주소를 확인해 주세요.', { status: 400, headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' } });

function validate(provider: SocialProvider, params: URLSearchParams, env: SyncEnv) {
  const clientId = provider === 'kakao' ? env.KAKAO_CLIENT_ID : env.NAVER_CLIENT_ID;
  const redirectUri = params.get('redirect_uri');
  return !!clientId?.trim() && params.get('client_id') === clientId.trim() && !!redirectUri &&
    (env.SOCIAL_REDIRECT_URIS ?? '').split(',').map((s) => s.trim()).filter(Boolean).includes(redirectUri);
}

function redirect(params: URLSearchParams, result: Record<string, string>) {
  const url = new URL(params.get('redirect_uri')!);
  for (const key of ['code', 'state', 'error', 'error_description']) url.searchParams.delete(key);
  for (const [key, value] of Object.entries({ ...result, state: params.get('state') ?? '' })) url.searchParams.set(key, value);
  return new Response(null, { status: 302, headers: { ...headers, Location: url.href } });
}

function authorizePage(provider: SocialProvider, params: URLSearchParams) {
  const title = `가짜 ${provider === 'kakao' ? '카카오' : '네이버'} 로그인(개발용)`;
  const hidden = [...params].filter(([key]) => key !== 'sub' && key !== 'action').map(([key, value]) => `<input type="hidden" name="${escape(key)}" value="${escape(value)}">`).join('');
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>body{font-family:sans-serif;max-width:32rem;margin:3rem auto;padding:1rem;line-height:1.7}input,button{font:inherit;padding:.5rem}label{display:block}button{margin:.8rem .4rem 0 0}</style></head><body><h1>${escape(title)}</h1><p>실제 계정으로 로그인하지 않는 개발용 가짜 화면이에요. 운영에 배포하면 안 돼요.</p><form method="get" action="/__dev/social/${escape(provider)}/approve">${hidden}<label>테스트 계정 ID <input type="text" name="sub" value="dev-user" required></label><p>특수 값: error-503(공급자 장애), error-code(코드 오류), no-id-token(토큰 없음). ALLOWED_ACCOUNTS에 없는 ID는 403 화면을 보여 줘요.</p><button type="submit" name="action" value="login">로그인</button><button type="submit" name="action" value="cancel" formnovalidate>취소</button></form></body></html>`;
  return new Response(html, { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
}

export default {
  async fetch(req: Request, env: SyncEnv): Promise<Response> {
    const url = new URL(req.url);
    const route = /^\/__dev\/social\/(kakao|naver)\/(authorize|approve)$/.exec(url.pathname);
    if (req.method === 'GET' && route) {
      const provider = route[1] as SocialProvider;
      const params = url.searchParams;
      if (!validate(provider, params, env)) return badRequest();
      if (route[2] === 'authorize') return authorizePage(provider, params);
      if (params.get('action') === 'cancel') return redirect(params, { error: 'access_denied', error_description: '로그인을 취소했어요.' });
      try {
        const { code } = fakeFor(env).authorize(provider, params, params.get('sub') ?? 'dev-user');
        return redirect(params, { code });
      } catch {
        return redirect(params, { error: 'invalid_request' });
      }
    }
    const fake = fakeFor(env);
    return handle(req, env, {
      now: Date.now,
      certs: { key: async () => null },
      socialKeys: fake.keys,
      socialFetch: fake.fetch,
      random: (n) => crypto.getRandomValues(new Uint8Array(n)),
      uuid: () => crypto.randomUUID(),
      log: (line) => console.log(line),
    });
  },
  async scheduled(_controller: unknown, env: SyncEnv): Promise<void> {
    console.log(JSON.stringify(await purge(env, Date.now())));
  },
};
