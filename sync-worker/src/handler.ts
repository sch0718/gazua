// 개인 동기화 Worker의 라우터. 증권사 호출은 없다(프록시와 분리). 로그에는 메서드·경로 패턴·상태·시간만 남긴다.
import {
  CertsUnavailableError,
  corsHeaders,
  errorBody,
  HttpError,
  json,
  matchOrigin,
  preflight,
  readJson,
  handleSessionRoute,
} from '@sch0718/firebase-session/worker';
import { KEY_BODY_MAX } from '../../src/lib/sync/keyWire';
import { checkKeyId, createVault, deleteKeyBlob, getKeyBlob, listKeys, putKeyBlob, rekey, wipeKeys } from './keys';
import { approveCli, cliEntry, handleCli, listCliTokens, revokeCliToken } from './cli';
import { ALLOWED_HEADERS, ALLOWED_METHODS } from './cors';
import type { SyncDeps, SyncEnv } from './env';
import {
  deleteProfile,
  getProfile,
  getRevision,
  listProfiles,
  listRevisions,
  putProfile,
  requestDocVersion,
  restoreProfile,
} from './profiles';
import { authenticate, sessions, type AuthContext } from './session';
import { deleteMarketFile, listMarketFiles, wipeMarketFiles } from './market';
import { listMembers, removeMember } from './members';
import { createShare, listShares, readShare, revokeShare } from './shares';

type Handler = (a: { req: Request; env: SyncEnv; deps: SyncDeps; params: string[]; url: URL }) => Promise<Response>;
type Authed = (a: { req: Request; env: SyncEnv; deps: SyncDeps; params: string[]; url: URL; ctx: AuthContext }) => Promise<Response>;

const ok = (body: unknown) => json(200, body);

const authed =
  (h: Authed): Handler =>
  async (a) =>
    h({ ...a, ctx: await authenticate(a.req, a.env, a.deps) });

const ROUTES: [string, RegExp, string, Handler][] = [
  ['GET', /^\/v1\/profiles$/, '/v1/profiles', authed(async ({ env, ctx }) => ok({ profiles: await listProfiles(env, ctx) }))],
  ['GET', /^\/v1\/profiles\/([^/]+)$/, '/v1/profiles/:id', authed(async ({ env, ctx, params, url }) => ok(await getProfile(env, ctx, params[0], requestDocVersion(url))))],
  [
    'PUT',
    /^\/v1\/profiles\/([^/]+)$/,
    '/v1/profiles/:id',
    authed(async ({ req, env, deps, ctx, params, url }) => ok(await putProfile(env, ctx, params[0], await readJson(req), deps.now(), requestDocVersion(url)))),
  ],
  [
    'DELETE',
    /^\/v1\/profiles\/([^/]+)$/,
    '/v1/profiles/:id',
    authed(async ({ req, env, deps, ctx, params, url }) => ok(await deleteProfile(env, ctx, params[0], await readJson(req), deps.now(), requestDocVersion(url)))),
  ],
  [
    'POST',
    /^\/v1\/profiles\/([^/]+)\/restore$/,
    '/v1/profiles/:id/restore',
    authed(async ({ req, env, deps, ctx, params, url }) => ok(await restoreProfile(env, ctx, params[0], await readJson(req), deps.now(), requestDocVersion(url)))),
  ],
  ['GET', /^\/v1\/profiles\/([^/]+)\/revisions$/, '/v1/profiles/:id/revisions', authed(async ({ env, ctx, params }) => ok({ revisions: await listRevisions(env, ctx, params[0]) }))],
  [
    'GET',
    /^\/v1\/profiles\/([^/]+)\/revisions\/([^/]+)$/,
    '/v1/profiles/:id/revisions/:rev',
    authed(async ({ env, ctx, params, url }) => ok(await getRevision(env, ctx, params[0], params[1], requestDocVersion(url)))),
  ],
  ['GET', /^\/v1\/keys$/, '/v1/keys', authed(async ({ env, ctx }) => ok(await listKeys(env, ctx)))],
  // 두 DELETE는 본문을 읽지 않는다(readJson은 본문이 없으면 400 bad-json)
  ['DELETE', /^\/v1\/keys$/, '/v1/keys', authed(async ({ env, ctx }) => ok(await wipeKeys(env, ctx)))],
  ['PUT', /^\/v1\/keys\/vault$/, '/v1/keys/vault', authed(async ({ req, env, deps, ctx }) => ok(await createVault(env, ctx, await readJson(req, KEY_BODY_MAX.vault), deps.now())))],
  ['POST', /^\/v1\/keys\/rekey$/, '/v1/keys/rekey', authed(async ({ req, env, deps, ctx }) => ok(await rekey(env, ctx, await readJson(req, KEY_BODY_MAX.rekey), deps.now())))],
  ['GET', /^\/v1\/keys\/([^/]+)$/, '/v1/keys/:id', authed(async ({ env, ctx, params }) => ok(await getKeyBlob(env, ctx, params[0])))],
  [
    'PUT',
    /^\/v1\/keys\/([^/]+)$/,
    '/v1/keys/:id',
    authed(async ({ req, env, deps, ctx, params }) => ok(await putKeyBlob(env, ctx, checkKeyId(params[0]), await readJson(req, KEY_BODY_MAX.blob), deps.now()))),
  ],
  ['DELETE', /^\/v1\/keys\/([^/]+)$/, '/v1/keys/:id', authed(async ({ env, deps, ctx, params }) => ok(await deleteKeyBlob(env, ctx, params[0], deps.now())))],
  ['GET', /^\/v1\/market\/files$/, '/v1/market/files', authed(async ({ env, ctx }) => ok({ files: await listMarketFiles(env, ctx) }))],
  ['DELETE', /^\/v1\/market\/files$/, '/v1/market/files', authed(async ({ env, ctx }) => ok(await wipeMarketFiles(env, ctx)))],
  ['DELETE', /^\/v1\/market\/files\/([^/]+)$/, '/v1/market/files/:id', authed(async ({ env, ctx, params }) => (await deleteMarketFile(env, ctx, params[0]), ok({ deleted: true })))],
  ['POST', /^\/v1\/shares$/, '/v1/shares', authed(async ({ req, env, deps, ctx }) => ok(await createShare(env, deps, ctx, await readJson(req, 110 * 1024))))],
  ['GET', /^\/v1\/shares$/, '/v1/shares', authed(async ({ env, ctx }) => ok({ shares: await listShares(env, ctx) }))],
  ['DELETE', /^\/v1\/shares\/([^/]+)$/, '/v1/shares/:id', authed(async ({ env, deps, ctx, params }) => (await revokeShare(env, ctx, params[0], deps.now()), ok({ revoked: true })))],
  ['POST', /^\/v1\/cli\/approve$/, '/v1/cli/approve', authed(async ({ req, env, deps, ctx }) => ok(await approveCli(env, deps, ctx, await readJson(req, 4096))))],
  ['GET', /^\/v1\/cli\/tokens$/, '/v1/cli/tokens', authed(async ({ env, deps, ctx }) => ok({ tokens: await listCliTokens(env, ctx, deps.now()) }))],
  ['DELETE', /^\/v1\/cli\/tokens\/([^/]+)$/, '/v1/cli/tokens/:id', authed(async ({ env, deps, ctx, params }) => (await revokeCliToken(env, ctx, params[0], deps.now()), ok({ revoked: true })))],
  ['GET', /^\/v1\/members$/, '/v1/members', authed(async ({ env, ctx }) => ok(await listMembers(env, ctx)))],
  ['DELETE', /^\/v1\/members\/([^/]+)$/, '/v1/members/:identity', authed(async ({ env, deps, ctx, params }) => ok(await removeMember(env, deps, ctx, params[0])))],
  ['GET', /^\/v1\/public\/share$/, '/v1/public/share', async ({ req, env, deps }) => ok(await readShare(env, req, deps.now()))],
];

function route(method: string, path: string): { h: Handler; params: string[]; pattern: string } | 'method' | null {
  let pathMatched = false;
  for (const [m, re, pattern, h] of ROUTES) {
    const hit = re.exec(path);
    if (!hit) continue;
    pathMatched = true;
    if (m === method) {
      try {
        return { h, params: hit.slice(1).map((p) => decodeURIComponent(p)), pattern };
      } catch {
        throw new HttpError(404, 'not-found');
      }
    }
  }
  return pathMatched ? 'method' : null;
}

// 패키지 로그를 기존 내부 오류 형식으로 맞춘다.
function legacyInternal(message: string): string {
  const prefix = '@sch0718/firebase-session: ';
  const detail = message.slice(prefix.length);
  return detail.startsWith('internal ') ? detail : `internal Error ${message}`;
}

/** 핸들러가 던진 오류를 응답으로 바꾼다(앱 분기와 CLI 분기가 같이 쓴다) */
async function guard(req: Request, deps: SyncDeps, pattern: () => string, fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, errorBody(e.code, e.extra));
    if (e instanceof CertsUnavailableError) return json(503, errorBody('certs-unavailable'));
    // 패키지의 설정 안내(예: 0002 마이그레이션 누락)만 문구를 남긴다. 그 밖의 오류는 이름만 남긴다(요청 정보가 섞일 수 있어서).
    const hint = e instanceof Error && e.message.startsWith('@sch0718/firebase-session:') ? ` ${e.message}` : '';
    deps.log(`${req.method} ${pattern()} internal ${e instanceof Error ? e.name : 'error'}${hint}`);
    return json(500, errorBody('internal'));
  }
}

export async function handle(req: Request, env: SyncEnv, deps: SyncDeps): Promise<Response> {
  const started = deps.now();
  const url = new URL(req.url);
  const origin = matchOrigin(req, env.ALLOWED_ORIGINS);
  let pattern = 'unknown';
  let res: Response;
  if (!origin) {
    // CLI(Node)는 Origin을 보내지 않는다. Origin 헤더가 아예 없을 때만 CLI 분기로 받는다(틀린 Origin은 그대로 403)
    const cli = req.headers.has('Origin') ? null : cliEntry(req, url);
    if (cli === null) {
      res = json(403, errorBody('origin'));
    } else {
      pattern = cli;
      res = await guard(req, deps, () => pattern, () => handleCli(req, env, deps, url));
    }
  } else if (req.method === 'OPTIONS') {
    res = preflight(origin, { methods: ALLOWED_METHODS, headers: ALLOWED_HEADERS });
    pattern = 'preflight';
  } else {
    res = (await handleSessionRoute(req, sessions(env, deps), {
      onRoute: (p) => { pattern = p; },
      log: (m) => deps.log(`${req.method} ${pattern} ${legacyInternal(m)}`),
    })) ?? await guard(req, deps, () => pattern, async () => {
      const r = route(req.method, url.pathname);
      if (r === null) throw new HttpError(404, 'not-found');
      if (r === 'method') throw new HttpError(405, 'method');
      pattern = r.pattern;
      return r.h({ req, env, deps, params: r.params, url });
    });
    for (const [k, v] of Object.entries(corsHeaders(origin))) res.headers.set(k, v);
  }
  deps.log(`${req.method} ${pattern} ${res.status} ${deps.now() - started}ms`);
  return res;
}
