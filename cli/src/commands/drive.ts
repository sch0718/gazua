// cli/src/commands/drive.ts
// 시장 파일 Drive 전달(설계 2026-11-02-market-drive 6절). 업로드는 사람이 실행한 명령으로만 한다.
import { DRIVE_FILE_ID_RE, type MarketFileRow } from '../../../src/lib/marketData/manifest';
import { readDriveAuth, readDriveToken, removeDriveAuth, removeDriveToken, writeDriveAuth, writeDriveToken, type AuthFile } from '../config';
import type { Command, Ctx } from '../context';
import { createDriveApi, type DriveApi } from '../driveApi';
import { CliError, toCliError } from '../errors';
import { driveClientFrom, googleLogin, listenOnce, refreshAccess, revokeGoogle, type DriveClient, type WaitForCallback } from '../googleAuth';
import { readMarketFile } from '../marketFile';
import { resolveServer } from '../session';
import { createSyncClient, type SyncClient } from '../syncClient';

const INTERVAL_STEP_MS = 5000;
const INTERVAL_CAP_MS = 60_000;
const LABEL_MAX = 64;
const ORPHAN_AGE_MS = 60 * 60 * 1000;
const DEFAULT_KEEP = 2;

/** 테스트가 바꿔 끼운다 */
export const driveDeps: { waitForCallback: WaitForCallback } = { waitForCallback: listenOnce };

/**
 * drive 경로의 market-upload 토큰 오류는 gazua login(읽기 토큰, auth.json)으로 풀리지 않는다.
 * 서버가 401로 거절한 토큰은 drive-auth.json이 아직 만료 전이라 gazua drive login이 그대로 두므로(6.1) logout부터 안내한다
 */
function driveTokenError(e: unknown): unknown {
  const code = e instanceof CliError ? e.code : null;
  if (code === 'cli-token-revoked') return new CliError(code, 'Drive 업로드용 CLI 연결이 끊겼어요. gazua drive logout 뒤 gazua drive login을 다시 실행해 주세요');
  if (code === 'cli-token-expired') return new CliError(code, 'Drive 업로드용 CLI 로그인이 만료됐어요. gazua drive logout 뒤 gazua drive login을 다시 실행해 주세요');
  return e;
}

/** 서버 호출의 401을 drive 안내로 바꿔 낸다 */
function driveSyncClient(ctx: Ctx, auth: AuthFile): SyncClient {
  const s = createSyncClient({ server: auth.server, token: auth.token, fetchImpl: ctx.fetch });
  const guard =
    <A extends unknown[], R>(f: (...a: A) => Promise<R>) =>
    (...a: A): Promise<R> =>
      f(...a).catch((e: unknown) => {
        throw driveTokenError(e);
      });
  return { ...s, marketFiles: guard(s.marketFiles), registerMarketFile: guard(s.registerMarketFile), deleteMarketFile: guard(s.deleteMarketFile) };
}

function requireDriveAuth(ctx: Ctx): AuthFile {
  const { auth, warnings } = readDriveAuth(ctx.dir);
  for (const w of warnings) ctx.warn(w);
  if (!auth) throw new CliError('drive-login-required');
  ctx.redact.add(auth.token);
  if (auth.expiresAt <= ctx.now()) throw new CliError('cli-token-expired', 'Drive 업로드용 CLI 로그인이 만료됐어요(90일). gazua drive login을 다시 실행해 주세요');
  return auth;
}

function accessTokens(ctx: Ctx, c: DriveClient): (force?: boolean) => Promise<string> {
  const file = readDriveToken(ctx.dir);
  if (!file || file.clientId !== c.clientId) throw new CliError('drive-login-required');
  ctx.redact.add(file.refreshToken);
  let cached: string | null = null;
  return async (force = false) => {
    if (!cached || force) cached = await refreshAccess(ctx, c, file.refreshToken);
    return cached;
  };
}

async function pollMarketToken(ctx: Ctx, server: string): Promise<AuthFile> {
  const label = (ctx.args.label ?? `gazua-drive@${ctx.hostname()}`).trim().slice(0, LABEL_MAX);
  if (label === '') throw new CliError('invalid-args', '--label이 비어 있어요');
  const client = createSyncClient({ server, fetchImpl: ctx.fetch });
  const grant = await client.device(label, 'market-upload');
  ctx.redact.add(grant.deviceCode);
  ctx.say(`앱의 설정 › 동기화·공유 › CLI 연결에 이 코드를 넣어 주세요: ${grant.userCode} (${Math.round(grant.expiresIn / 60)}분)`);
  ctx.say(grant.verifyUrl);
  const deadline = ctx.now() + grant.expiresIn * 1000;
  let interval = grant.interval * 1000;
  for (;;) {
    await ctx.sleep(interval);
    if (ctx.now() >= deadline) throw new CliError('login-expired');
    const r = await client.token(grant.deviceCode);
    if (r.kind === 'pending') continue;
    if (r.kind === 'slow_down') {
      interval = Math.min(interval + INTERVAL_STEP_MS, INTERVAL_CAP_MS);
      continue;
    }
    ctx.redact.add(r.token);
    if (r.scope !== 'market-upload') {
      // 옛 Worker는 scope를 무시하고 읽기 토큰을 준다. 쓰지 않을 토큰이라 바로 끊는다
      await createSyncClient({ server, token: r.token, fetchImpl: ctx.fetch }).revoke().catch(() => {});
      throw new CliError('server-outdated');
    }
    return { v: 1, server, token: r.token, tokenId: r.tokenId, label, expiresAt: r.expiresAt };
  }
}

async function login(ctx: Ctx) {
  const c = driveClientFrom(ctx.env);
  ctx.redact.add(c.clientSecret);
  const current = readDriveAuth(ctx.dir).auth;
  let sync: 'kept' | 'new' = 'kept';
  if (!current || current.expiresAt <= ctx.now()) {
    writeDriveAuth(ctx.dir, await pollMarketToken(ctx, resolveServer(ctx)));
    sync = 'new';
  }
  const token = readDriveToken(ctx.dir);
  let google: 'kept' | 'new' = 'kept';
  let needGoogle = !token || token.clientId !== c.clientId;
  if (token && !needGoogle) {
    // 철회·만료로 갱신 토큰이 무효면 남은 파일을 믿지 않고 다시 로그인한다
    try {
      await refreshAccess(ctx, c, token.refreshToken);
    } catch (e) {
      if (toCliError(e).code === 'drive-login-required') needGoogle = true;
      else ctx.warn('Google 토큰을 확인하지 못해 기존 로그인을 그대로 둬요');
    }
  }
  if (needGoogle) {
    const refreshToken = await googleLogin(ctx, c, driveDeps.waitForCallback);
    writeDriveToken(ctx.dir, { v: 1, clientId: c.clientId, refreshToken, createdAt: ctx.now() });
    google = 'new';
  }
  return { sync, google };
}

/** 수집 시각 값(오프셋을 푼 시각) 내림차순, 같으면 등록 순서 내림차순 */
const newestFirst = (rows: MarketFileRow[]): MarketFileRow[] =>
  [...rows].sort((a, b) => Date.parse(b.collectedAt) - Date.parse(a.collectedAt) || b.createdAt - a.createdAt);

/** keep 밖 manifest 행과 Drive 파일, 1시간 지난 고아 표식 파일을 지운다. 지운 행 수를 돌려준다 */
async function prune(ctx: Ctx, sync: SyncClient, api: DriveApi, keep: number): Promise<number> {
  let removed = 0;
  try {
    const rows = newestFirst(await sync.marketFiles());
    for (const r of rows.slice(keep)) {
      await sync.deleteMarketFile(r.id);
      await api.remove(r.driveFileId);
      removed++;
    }
    const kept = new Set(rows.slice(0, keep).map((r) => r.driveFileId));
    for (const f of await api.listMarket()) {
      const age = f.createdTime ? ctx.now() - Date.parse(f.createdTime) : 0;
      if (!kept.has(f.id) && age > ORPHAN_AGE_MS) await api.remove(f.id);
    }
  } catch {
    ctx.warn('Drive 정리를 끝내지 못했어요. 다음 업로드 때 다시 정리해요');
  }
  return removed;
}

async function upload(ctx: Ctx) {
  const path = ctx.args.positionals[1];
  if (!path) throw new CliError('invalid-args', '올릴 파일 경로가 필요해요. 예: gazua drive upload ~/gazua-data/market-data-20261031.json.gz');
  const keep = ctx.args.keep ?? DEFAULT_KEEP;
  const local = readMarketFile(path);
  const c = driveClientFrom(ctx.env);
  ctx.redact.add(c.clientSecret);
  const auth = requireDriveAuth(ctx);
  const api = createDriveApi(ctx, accessTokens(ctx, c));
  const sync = driveSyncClient(ctx, auth);

  const rows = await sync.marketFiles();
  // 이 파일보다 새 수집이 keep개 이상이면 올려도 정리가 바로 지운다(최신 keep개 보관, 설계 D5)
  const at = Date.parse(local.meta.collectedAt);
  const newer = rows.filter((r) => r.sha256 !== local.meta.sha256 && Date.parse(r.collectedAt) > at).length;
  if (newer >= keep) throw new CliError('market-file-invalid', `Drive에 이 파일보다 새로 수집한 파일이 ${newer}개 있어 올려도 바로 정리돼요. 이 파일을 남기려면 --keep을 ${newer + 1} 이상으로 주세요`);
  const same = rows.find((r) => r.sha256 === local.meta.sha256);
  if (same) {
    const there = await api.get(same.driveFileId);
    if (there && there.trashed !== true) return { uploaded: false, file: same, removed: await prune(ctx, sync, api, keep) };
  }

  ctx.say(`Drive에 올려요: ${local.meta.name} (${(local.meta.size / 1048576).toFixed(1)} MB)`);
  const put = await api.upload({ name: local.meta.name, sha256: local.meta.sha256 }, local.bytes);
  const drop = () => api.remove(put.id).catch(() => {});
  if (put.md5Checksum !== local.md5 || Number(put.size) !== local.meta.size) {
    await drop();
    throw new CliError('drive-failed', 'Drive에 올린 파일이 로컬과 달라요');
  }
  if (!DRIVE_FILE_ID_RE.test(put.id)) {
    await drop();
    throw new CliError('drive-failed', 'Drive 파일 ID 모양이 맞지 않아요');
  }
  const body = { ...local.meta, driveFileId: put.id };
  let file: MarketFileRow;
  try {
    file = await sync.registerMarketFile(body);
  } catch (e) {
    if (toCliError(e).code !== 'market-limit') {
      await drop();
      throw e;
    }
    await prune(ctx, sync, api, keep);
    try {
      file = await sync.registerMarketFile(body);
    } catch (e2) {
      await drop();
      throw e2;
    }
  }
  return { uploaded: true, file, removed: await prune(ctx, sync, api, keep) };
}

async function status(ctx: Ctx) {
  const { auth, warnings } = readDriveAuth(ctx.dir);
  for (const w of warnings) ctx.warn(w);
  const google = readDriveToken(ctx.dir) !== null;
  let files: MarketFileRow[] | null = null;
  if (auth) {
    ctx.redact.add(auth.token);
    try {
      files = await driveSyncClient(ctx, auth).marketFiles();
    } catch (e) {
      ctx.warn(toCliError(e).message);
    }
  }
  return { sync: auth ? { label: auth.label, expiresAt: auth.expiresAt } : null, google, files };
}

async function logout(ctx: Ctx) {
  const { auth } = readDriveAuth(ctx.dir);
  const token = readDriveToken(ctx.dir);
  let serverRevoked = false;
  if (auth) {
    ctx.redact.add(auth.token);
    try {
      await createSyncClient({ server: auth.server, token: auth.token, fetchImpl: ctx.fetch }).revoke();
      serverRevoked = true;
    } catch (e) {
      const code = toCliError(e).code;
      serverRevoked = code === 'cli-token-revoked' || code === 'cli-token-expired';
      if (!serverRevoked) ctx.warn('서버 연결은 앱에서 끊어 주세요(설정 › 동기화·공유 › 로그인한 기기)');
    }
  }
  let googleRevoked = false;
  if (token) {
    googleRevoked = await revokeGoogle(ctx, token.refreshToken);
    if (!googleRevoked) ctx.warn('Google 계정의 보안 › 서드 파티 연결에서 접근을 지워 주세요');
  }
  const a = removeDriveAuth(ctx.dir);
  const b = removeDriveToken(ctx.dir);
  return { serverRevoked, googleRevoked, filesRemoved: a || b };
}

export const drive: Command = async (ctx) => {
  const sub = ctx.args.positionals[0];
  if (sub === 'login') return login(ctx);
  if (sub === 'upload') return upload(ctx);
  if (sub === 'status') return status(ctx);
  if (sub === 'logout') return logout(ctx);
  throw new CliError('invalid-args', 'drive 하위 명령은 login · upload · status · logout이에요');
};
