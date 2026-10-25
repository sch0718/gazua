// 개인 동기화 Worker의 라우터. 증권사 호출은 없다(프록시와 분리). 로그에는 메서드·경로 패턴·상태·시간만 남긴다.
import { CertsUnavailableError } from './auth/certs';
import { corsHeaders, matchOrigin, preflight } from './cors';
import type { SyncDeps, SyncEnv } from './env';
import { errorBody, HttpError, json, readJson } from './http';
import { deleteProfile, getProfile, getRevision, listProfiles, listRevisions, putProfile, restoreProfile } from './profiles';
import { authenticate, createSession, listSessions, revokeSessions, type AuthContext } from './session';
import { createShare, listShares, readShare, revokeShare } from './shares';

type Handler = (a: { req: Request; env: SyncEnv; deps: SyncDeps; params: string[]; url: URL }) => Promise<Response>;
type Authed = (a: { req: Request; env: SyncEnv; deps: SyncDeps; params: string[]; url: URL; ctx: AuthContext }) => Promise<Response>;

const ok = (body: unknown) => json(200, body);

const authed =
  (h: Authed): Handler =>
  async (a) =>
    h({ ...a, ctx: await authenticate(a.req, a.env, a.deps) });

const ROUTES: [string, RegExp, string, Handler][] = [
  ['POST', /^\/v1\/session$/, '/v1/session', async ({ req, env, deps }) => ok(await createSession(req, env, deps, await readJson(req)))],
  ['DELETE', /^\/v1\/session$/, '/v1/session', authed(async ({ env, deps, ctx }) => ok({ revoked: await revokeSessions(env, ctx, deps.now(), 'current') }))],
  ['GET', /^\/v1\/sessions$/, '/v1/sessions', authed(async ({ env, deps, ctx }) => ok({ sessions: await listSessions(env, ctx, deps.now()) }))],
  [
    'DELETE',
    /^\/v1\/sessions$/,
    '/v1/sessions',
    authed(async ({ env, deps, ctx, url }) => {
      if (url.searchParams.get('others') !== '1') throw new HttpError(400, 'bad-request');
      return ok({ revoked: await revokeSessions(env, ctx, deps.now(), 'others') });
    }),
  ],
  ['DELETE', /^\/v1\/sessions\/([^/]+)$/, '/v1/sessions/:id', authed(async ({ env, deps, ctx, params }) => ok({ revoked: await revokeSessions(env, ctx, deps.now(), { id: params[0] }) }))],
  ['GET', /^\/v1\/profiles$/, '/v1/profiles', authed(async ({ env, ctx }) => ok({ profiles: await listProfiles(env, ctx) }))],
  ['GET', /^\/v1\/profiles\/([^/]+)$/, '/v1/profiles/:id', authed(async ({ env, ctx, params }) => ok(await getProfile(env, ctx, params[0])))],
  ['PUT', /^\/v1\/profiles\/([^/]+)$/, '/v1/profiles/:id', authed(async ({ req, env, deps, ctx, params }) => ok(await putProfile(env, ctx, params[0], await readJson(req), deps.now())))],
  ['DELETE', /^\/v1\/profiles\/([^/]+)$/, '/v1/profiles/:id', authed(async ({ req, env, deps, ctx, params }) => ok(await deleteProfile(env, ctx, params[0], await readJson(req), deps.now())))],
  [
    'POST',
    /^\/v1\/profiles\/([^/]+)\/restore$/,
    '/v1/profiles/:id/restore',
    authed(async ({ req, env, deps, ctx, params }) => ok(await restoreProfile(env, ctx, params[0], await readJson(req), deps.now()))),
  ],
  ['GET', /^\/v1\/profiles\/([^/]+)\/revisions$/, '/v1/profiles/:id/revisions', authed(async ({ env, ctx, params }) => ok({ revisions: await listRevisions(env, ctx, params[0]) }))],
  ['GET', /^\/v1\/profiles\/([^/]+)\/revisions\/([^/]+)$/, '/v1/profiles/:id/revisions/:rev', authed(async ({ env, ctx, params }) => ok(await getRevision(env, ctx, params[0], params[1])))],
  ['POST', /^\/v1\/shares$/, '/v1/shares', authed(async ({ req, env, deps, ctx }) => ok(await createShare(env, deps, ctx, await readJson(req, 110 * 1024))))],
  ['GET', /^\/v1\/shares$/, '/v1/shares', authed(async ({ env, ctx }) => ok({ shares: await listShares(env, ctx) }))],
  ['DELETE', /^\/v1\/shares\/([^/]+)$/, '/v1/shares/:id', authed(async ({ env, deps, ctx, params }) => (await revokeShare(env, ctx, params[0], deps.now()), ok({ revoked: true })))],
  ['GET', /^\/v1\/public\/share$/, '/v1/public/share', async ({ req, env, deps }) => ok(await readShare(env, req, deps.now()))],
];

function route(method: string, path: string): { h: Handler; params: string[]; pattern: string } | 'method' | null {
  let pathMatched = false;
  for (const [m, re, pattern, h] of ROUTES) {
    const hit = re.exec(path);
    if (!hit) continue;
    pathMatched = true;
    if (m === method) return { h, params: hit.slice(1).map((p) => decodeURIComponent(p)), pattern };
  }
  return pathMatched ? 'method' : null;
}

export async function handle(req: Request, env: SyncEnv, deps: SyncDeps): Promise<Response> {
  const started = deps.now();
  const url = new URL(req.url);
  const origin = matchOrigin(req, env.ALLOWED_ORIGINS);
  let pattern = 'unknown';
  let res: Response;
  if (!origin) {
    res = json(403, errorBody('origin'));
  } else if (req.method === 'OPTIONS') {
    res = preflight(origin);
    pattern = 'preflight';
  } else {
    const r = route(req.method, url.pathname);
    try {
      if (r === null) throw new HttpError(404, 'not-found');
      if (r === 'method') throw new HttpError(405, 'method');
      pattern = r.pattern;
      res = await r.h({ req, env, deps, params: r.params, url });
    } catch (e) {
      if (e instanceof HttpError) res = json(e.status, errorBody(e.code, e.extra));
      else if (e instanceof CertsUnavailableError) res = json(503, errorBody('certs-unavailable'));
      else {
        res = json(500, errorBody('internal'));
        deps.log(`${req.method} ${pattern} internal ${e instanceof Error ? e.name : 'error'}`);
      }
    }
    for (const [k, v] of Object.entries(corsHeaders(origin))) res.headers.set(k, v);
  }
  deps.log(`${req.method} ${pattern} ${res.status} ${deps.now() - started}ms`);
  return res;
}
