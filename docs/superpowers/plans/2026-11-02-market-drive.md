# 시장 파일 Drive 전달 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 맥에서 수집한 시장 파일을 본인 Google Drive `appDataFolder`에 올리고 D1에 manifest를 등록해, 다른 본인 기기가 설정 › 데이터에서 검증된 파일을 받게 한다.

**Architecture:** 설계는 [시장 파일 Drive 전달 설계](../specs/2026-11-02-market-drive-design.md)(이하 spec)다. `sync-worker`에 `market_files` 표·API와 CLI 토큰 범위 `market-upload`를 더한다. CLI(`cli/`)에 `gazua drive login|upload|status|logout`을 더하고(Google 루프백 OAuth + Drive REST), 수집 스크립트 `--drive`가 업로드를 부른다. 앱은 GIS 토큰 모델로 Drive에서 내려받아 크기·SHA-256을 manifest와 비교한 뒤 기존 `importFile`로 교체한다. 세 곳이 함께 쓰는 manifest 검사는 `src/lib/marketData/manifest.ts` 하나에 둔다.

**Tech Stack:** Svelte 5, TypeScript, vitest(+jsdom, testing-library, fake-indexeddb), Cloudflare Worker + D1(테스트는 `node:sqlite` 하네스), Node 22 CLI(esbuild 번들), `node --test`(수집 스크립트).

## Global Constraints

- 사용자에게 보이는 문구·주석·커밋 메시지는 한국어. 존댓말 「~요」체(기존 문구와 같게).
- 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- 비밀값(클라이언트 시크릿·갱신 토큰·접근 토큰·CLI 토큰)은 파일·로그·오류·출력에 쓰지 않는다. CLI는 `ctx.redact`에 넣는다.
- 시장 파일 본문(시세)은 D1·로그·공유에 넣지 않는다(KIS 약관 제5조 ③).
- D1 manifest 사용자당 10행(`MARKET_FILES_LIMIT = 10`), gzip 크기 상한 512 MiB(`MARKET_FILE_MAX_BYTES = 536870912`).
- CLI 토큰 범위 값은 `'read' | 'market-upload'`.
- Drive 범위는 `https://www.googleapis.com/auth/drive.appdata`, `appProperties` 표식은 `{ gazua: 'market-data', sha256 }`.
- CLI 환경변수: `GAZUA_DRIVE_CLIENT_ID`, `GAZUA_DRIVE_CLIENT_SECRET`, `GAZUA_DRIVE_PORT`(기본 53682). 앱 빌드 변수: `VITE_GOOGLE_DRIVE_CLIENT_ID`.
- CLI 파일: `~/.config/gazua/drive-auth.json`(market-upload 토큰, `AuthFile` 모양), `~/.config/gazua/drive.json`(`{ v: 1, clientId, refreshToken, createdAt }`). 둘 다 600.
- CLI 번들에 `import.meta.env`·`window.`·`navigator.locks`가 들어가면 빌드가 실패한다(`cli/build.mjs`). CLI가 import하는 앱 모듈(`manifest.ts`·`format.ts`)은 브라우저 전역을 쓰지 않는다.
- 검증 명령: 루트 `pnpm test`, `pnpm check`, `pnpm test:scripts`; `pnpm --filter sync-worker test`; `pnpm --filter gazua-cli test`, `pnpm --filter gazua-cli check`, `pnpm --filter gazua-cli build`.
- 운영 D1 마이그레이션 적용·Worker 배포·Google Cloud 콘솔 설정은 하지 않는다.

---

## 파일 구조

| 파일 | 할 일 |
|---|---|
| `src/lib/marketData/manifest.ts` (새) | manifest 타입·상수·검사(`checkMarketMeta`, `checkMarketBody`, `checkMarketFiles`). Worker·CLI·앱 공용 |
| `sync-worker/migrations/0006_market_files.sql` (새) | `cli_grants.scope`, `market_files` |
| `sync-worker/src/market.ts` (새) | manifest 목록·등록(upsert·한도)·삭제·전체 삭제 |
| `sync-worker/src/handler.ts` | 앱 세션 라우트 3개 |
| `sync-worker/src/cli.ts` | 기기 코드 scope, 토큰 scope, `cliScope` 범위별 허용, 토큰 목록 scope |
| `src/lib/sync/api.ts`, `src/lib/sync/controller.svelte.ts` | `marketFiles`·`wipeMarketFiles`, 승인·토큰 목록 scope |
| `src/lib/ui/settings/CliConnect.svelte`, `SyncManage.svelte` | 범위 문구 |
| `src/lib/marketData/store.ts` | `MarketDataInfo.sha256` |
| `src/lib/marketData/driveConfig.ts`, `gis.ts`, `driveClient.ts`, `driveSync.ts` (새) | 앱 Drive 받기 |
| `src/lib/ui/settings/MarketDrive.svelte` (새), `DataTools.svelte`, `src/routes/Settings.svelte` | 설정 화면 |
| `drive-csp.config.ts` (새), `vite.config.ts`, `src/vite-env.d.ts` | CSP·빌드 변수 |
| `.github/workflows/deploy.yml` | 저장소 Actions Variable을 앱 빌드 환경변수로 전달 |
| `cli/src/args.ts`, `errors.ts`, `config.ts`, `syncClient.ts`, `main.ts` | CLI 공통 |
| `cli/src/googleAuth.ts`, `driveApi.ts`, `marketFile.ts`, `commands/drive.ts` (새) | CLI Drive |
| `scripts/collect-market-data.mjs` | `--drive` |
| 문서 | 제안서·로드맵·`docs/development.md`·`sync-worker/README.md`·`cli/README.md`·`docs/live-check.md` |

---

### Task 1: 공용 manifest 검사

**Files:**
- Create: `src/lib/marketData/manifest.ts`
- Test: `src/lib/marketData/manifest.test.ts`

**Interfaces:**
- Produces:
  - `MARKET_FILE_MAX_BYTES = 512 * 1024 * 1024`, `MARKET_FILES_LIMIT = 10`, `DRIVE_FILE_ID_RE = /^[A-Za-z0-9_-]{10,128}$/`
  - `interface MarketFileMeta { name: string; sha256: string; size: number; version: number; collectedAt: string; range: { from: string; to: string }; stocks: number }`
  - `interface MarketFileBody extends MarketFileMeta { driveFileId: string }`
  - `interface MarketFileRow extends MarketFileBody { id: string; createdAt: number; updatedAt: number }`
  - `type ManifestCheck<T> = { ok: true; value: T } | { ok: false; code: 'invalid' | 'unknown-field'; path: string }`
  - `checkMarketMeta(v: unknown): ManifestCheck<MarketFileMeta>` — 키가 정확히 메타 7개
  - `checkMarketBody(v: unknown): ManifestCheck<MarketFileBody>` — 메타 7개 + `driveFileId`
  - `checkMarketFiles(v: unknown): MarketFileRow[] | null` — 서버 응답 `files` 배열 검사(행마다 `checkMarketBody` + `id` 문자열·`createdAt`/`updatedAt` 수)

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/lib/marketData/manifest.test.ts
import { describe, expect, it } from 'vitest';
import { checkMarketBody, checkMarketFiles, checkMarketMeta, MARKET_FILE_MAX_BYTES } from './manifest';

const meta = () => ({
  name: 'market-data-20261031.json.gz',
  sha256: 'a'.repeat(64),
  size: 1234,
  version: 4,
  collectedAt: '2026-10-31T18:00:00+09:00',
  range: { from: '2021-10-31', to: '2026-10-31' },
  stocks: 2600,
});
const body = () => ({ ...meta(), driveFileId: '1AbC_def-GHIjkl' });

describe('checkMarketMeta', () => {
  it('정상 메타를 그대로 돌려준다', () => {
    expect(checkMarketMeta(meta())).toEqual({ ok: true, value: meta() });
  });
  it('알 수 없는 키는 unknown-field, driveFileId도 메타에서는 모르는 키다', () => {
    expect(checkMarketMeta({ ...meta(), extra: 1 })).toEqual({ ok: false, code: 'unknown-field', path: 'extra' });
    expect(checkMarketMeta(body())).toEqual({ ok: false, code: 'unknown-field', path: 'driveFileId' });
  });
  it.each([
    ['name', '시장.json.gz'],
    ['name', 'market data.json.gz'],
    ['name', 'market-data.json'],
    ['name', `${'a'.repeat(94)}.json.gz`],
    ['sha256', 'A'.repeat(64)],
    ['size', 0],
    ['size', MARKET_FILE_MAX_BYTES + 1],
    ['size', 1.5],
    ['version', 0],
    ['version', 100],
    ['collectedAt', 'not a date'],
    ['collectedAt', `2026-10-31T18:00:00+09:00${' '.repeat(20)}`],
    ['stocks', -1],
    ['stocks', 100001],
  ])('%s=%j 는 invalid', (k, v) => {
    expect(checkMarketMeta({ ...meta(), [k]: v })).toEqual({ ok: false, code: 'invalid', path: k });
  });
  it.each([
    [{ from: '2026-02-30', to: '2026-10-31' }],
    [{ from: '2026-13-01', to: '2026-10-31' }],
    [{ from: '2026-00-10', to: '2026-10-31' }],
    [{ from: '2026-10-32', to: '2026-10-31' }],
    [{ from: '2026-01-01', to: '2026-13-01' }],
    [{ from: '2026-01-01', to: '2026-00-10' }],
    [{ from: '2026-01-01', to: '2026-10-32' }],
    [{ from: '2026-10-31', to: '2026-10-30' }],
    [{ from: '20261031', to: '2026-10-31' }],
    [{ from: '2026-10-31' }],
  ])('range %j 는 invalid', (range) => {
    expect(checkMarketMeta({ ...meta(), range })).toEqual({ ok: false, code: 'invalid', path: 'range' });
  });
  it('객체가 아니면 invalid', () => {
    expect(checkMarketMeta(null)).toEqual({ ok: false, code: 'invalid', path: '' });
  });
});

describe('checkMarketBody', () => {
  it('driveFileId 모양을 본다', () => {
    expect(checkMarketBody(body()).ok).toBe(true);
    expect(checkMarketBody({ ...body(), driveFileId: 'short' })).toEqual({ ok: false, code: 'invalid', path: 'driveFileId' });
    expect(checkMarketBody(meta())).toEqual({ ok: false, code: 'invalid', path: 'driveFileId' });
  });
});

describe('checkMarketFiles', () => {
  it('행 배열만 받는다', () => {
    const row = { ...body(), id: 'r1', createdAt: 1, updatedAt: 2 };
    expect(checkMarketFiles([row])).toEqual([row]);
    expect(checkMarketFiles([{ ...row, sha256: 'x' }])).toBeNull();
    expect(checkMarketFiles({})).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run src/lib/marketData/manifest.test.ts`
Expected: FAIL (`./manifest`를 찾지 못함)

- [ ] **Step 3: 구현**

```ts
// src/lib/marketData/manifest.ts
// 시장 파일 manifest(설계 2026-11-02-market-drive 5.2). sync-worker·CLI·앱이 같은 규칙을 쓴다.
// 시세는 담지 않는다(파일 이름·해시·크기·형식·수집 시각·기간·종목 수만).

export const MARKET_FILE_MAX_BYTES = 512 * 1024 * 1024;
export const MARKET_FILES_LIMIT = 10;
export const DRIVE_FILE_ID_RE = /^[A-Za-z0-9_-]{10,128}$/;
const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;
const SHA_RE = /^[0-9a-f]{64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface MarketFileMeta {
  name: string;
  sha256: string;
  size: number;
  version: number;
  collectedAt: string;
  range: { from: string; to: string };
  stocks: number;
}
export interface MarketFileBody extends MarketFileMeta {
  driveFileId: string;
}
export interface MarketFileRow extends MarketFileBody {
  id: string;
  createdAt: number;
  updatedAt: number;
}
export type ManifestCheck<T> = { ok: true; value: T } | { ok: false; code: 'invalid' | 'unknown-field'; path: string };

const META_KEYS = ['name', 'sha256', 'size', 'version', 'collectedAt', 'range', 'stocks'] as const;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const intIn = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
/** 달력에 있는 YYYY-MM-DD(2026-02-30은 아니다) */
const realDate = (d: unknown): d is string => {
  if (typeof d !== 'string' || !DATE_RE.test(d)) return false;
  const time = Date.parse(`${d}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === d;
};
const bad = (path: string) => ({ ok: false as const, code: 'invalid' as const, path });

function metaFields(v: Record<string, unknown>): ManifestCheck<MarketFileMeta> {
  if (typeof v.name !== 'string' || !NAME_RE.test(v.name) || !v.name.endsWith('.json.gz')) return bad('name');
  if (typeof v.sha256 !== 'string' || !SHA_RE.test(v.sha256)) return bad('sha256');
  if (!intIn(v.size, 1, MARKET_FILE_MAX_BYTES)) return bad('size');
  if (!intIn(v.version, 1, 99)) return bad('version');
  if (typeof v.collectedAt !== 'string' || v.collectedAt.length > 40 || Number.isNaN(Date.parse(v.collectedAt))) return bad('collectedAt');
  const r = v.range;
  if (!isRecord(r) || Object.keys(r).length !== 2 || !realDate(r.from) || !realDate(r.to) || r.from > r.to) return bad('range');
  if (!intIn(v.stocks, 0, 100000)) return bad('stocks');
  return {
    ok: true,
    value: { name: v.name, sha256: v.sha256, size: v.size as number, version: v.version as number, collectedAt: v.collectedAt, range: { from: r.from, to: r.to }, stocks: v.stocks as number },
  };
}

function check(v: unknown, keys: readonly string[]): ManifestCheck<Record<string, unknown>> {
  if (!isRecord(v)) return bad('');
  for (const k of Object.keys(v)) if (!keys.includes(k)) return { ok: false, code: 'unknown-field', path: k };
  return { ok: true, value: v };
}

export function checkMarketMeta(v: unknown): ManifestCheck<MarketFileMeta> {
  const c = check(v, META_KEYS);
  return c.ok ? metaFields(c.value) : c;
}

export function checkMarketBody(v: unknown): ManifestCheck<MarketFileBody> {
  const c = check(v, [...META_KEYS, 'driveFileId']);
  if (!c.ok) return c;
  if (typeof c.value.driveFileId !== 'string' || !DRIVE_FILE_ID_RE.test(c.value.driveFileId)) return bad('driveFileId');
  const m = metaFields(c.value);
  return m.ok ? { ok: true, value: { ...m.value, driveFileId: c.value.driveFileId } } : m;
}

/** 서버 응답의 files 배열. 하나라도 모양이 다르면 null */
export function checkMarketFiles(v: unknown): MarketFileRow[] | null {
  if (!Array.isArray(v)) return null;
  const out: MarketFileRow[] = [];
  for (const row of v) {
    if (!isRecord(row) || typeof row.id !== 'string' || typeof row.createdAt !== 'number' || typeof row.updatedAt !== 'number') return null;
    const { id, createdAt, updatedAt, ...rest } = row;
    const b = checkMarketBody(rest);
    if (!b.ok) return null;
    out.push({ ...b.value, id, createdAt, updatedAt });
  }
  return out;
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run src/lib/marketData/manifest.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/marketData/manifest.ts src/lib/marketData/manifest.test.ts
git commit -m "feat(market-drive): Worker·CLI·앱이 함께 쓰는 시장 파일 manifest 검사를 더함"
```

---

### Task 2: D1 0006과 manifest API(앱 세션)

**Files:**
- Create: `sync-worker/migrations/0006_market_files.sql`, `sync-worker/src/market.ts`, `sync-worker/src/market.test.ts`
- Modify: `sync-worker/src/handler.ts` (ROUTES에 3줄), `sync-worker/src/cli.test.ts:32-37` (cli_grants 열 목록에 `scope`)

**Interfaces:**
- Consumes: Task 1 `checkMarketBody`, `MARKET_FILES_LIMIT`, `MarketFileRow`, `MarketFileBody`
- Produces (Task 3이 CLI 분기에서 부른다):
  - `listMarketFiles(env: SyncEnv, ctx: AuthContext): Promise<MarketFileRow[]>`
  - `putMarketFile(env: SyncEnv, deps: SyncDeps, ctx: AuthContext, body: unknown): Promise<MarketFileRow>`
  - `deleteMarketFile(env: SyncEnv, ctx: AuthContext, id: string): Promise<void>` (없거나 남의 것 → 404 `not-found`)
  - `wipeMarketFiles(env: SyncEnv, ctx: AuthContext): Promise<{ deleted: number }>`

- [ ] **Step 1: 마이그레이션 작성**

```sql
-- sync-worker/migrations/0006_market_files.sql
-- 시장 파일 Drive 전달(설계 2026-11-02-market-drive). 파일 본문은 Drive appDataFolder에만 있고 여기에는 manifest만 둔다.
ALTER TABLE cli_grants ADD COLUMN scope TEXT NOT NULL DEFAULT 'read'; -- 'read' | 'market-upload'

CREATE TABLE market_files (
  id TEXT PRIMARY KEY,                        -- uuid
  user_id TEXT NOT NULL REFERENCES users(id),
  drive_file_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sha256 TEXT NOT NULL,                       -- gzip 바이트의 SHA-256 hex
  size INTEGER NOT NULL,                      -- gzip 바이트
  format_version INTEGER NOT NULL,
  collected_at TEXT NOT NULL,                 -- 파일의 collectedAt(ISO)
  range_from TEXT NOT NULL,                   -- YYYY-MM-DD
  range_to TEXT NOT NULL,
  stocks INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, sha256)
);
CREATE INDEX market_files_user ON market_files(user_id, collected_at);
```

`sync-worker/src/cli.test.ts`의 「cli_grants 열 이름이 스펙과 같다」 기대 배열 끝에 `'scope'`를 더한다.

- [ ] **Step 2: 실패하는 테스트 작성**

```ts
// sync-worker/src/market.test.ts
import { describe, expect, it } from 'vitest';
import { FORBIDDEN_KEYS } from '../../src/lib/sync/forbidden';
import { harness, OTHER } from '../test/harness';

const j = async (r: Response) => ({ status: r.status, body: (await r.json()) as Record<string, any> });
const body = (n = 0, extra: Record<string, unknown> = {}) => ({
  driveFileId: `drive-file-${String(n).padStart(4, '0')}`,
  name: `market-data-202610${String(10 + n).padStart(2, '0')}.json.gz`,
  sha256: n.toString(16).padStart(64, '0'),
  size: 1000 + n,
  version: 4,
  collectedAt: `2026-10-${String(10 + n).padStart(2, '0')}T18:00:00+09:00`,
  range: { from: '2021-10-01', to: `2026-10-${String(10 + n).padStart(2, '0')}` },
  stocks: 2600,
  ...extra,
});
// 앱 세션은 POST를 못 하므로 테스트는 하네스 DB에 putMarketFile을 직접 부른다
import { putMarketFile } from './market';
async function seed(h: ReturnType<typeof harness>, userEmail: string, n: number) {
  const me = await h.login(userEmail, `uid-${userEmail}`);
  const user = h.env.DB.raw.prepare('SELECT id FROM users WHERE email = ?').get(userEmail) as { id: string };
  const ctx = { userId: user.id, sessionHash: '', user: { sub: `uid-${userEmail}`, email: userEmail, authTime: 0 } } as never;
  for (let i = 0; i < n; i++) await putMarketFile(h.env, h.deps, ctx, body(i));
  return { me, ctx };
}

describe('0006 마이그레이션', () => {
  it('market_files 열과 cli_grants.scope 기본값', () => {
    const h = harness();
    const cols = (h.env.DB.raw.prepare('PRAGMA table_info(market_files)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(['id', 'user_id', 'drive_file_id', 'name', 'sha256', 'size', 'format_version', 'collected_at', 'range_from', 'range_to', 'stocks', 'created_at', 'updated_at']);
    const scope = (h.env.DB.raw.prepare('PRAGMA table_info(cli_grants)').all() as { name: string; dflt_value: string }[]).find((c) => c.name === 'scope');
    expect(scope?.dflt_value).toBe("'read'");
  });
});

describe('putMarketFile', () => {
  it('등록하면 행을 돌려주고 같은 sha256은 drive_file_id·name·updatedAt만 갱신한다', async () => {
    const h = harness();
    const { ctx } = await seed(h, 'me@example.test', 1);
    h.clock.now += 1000;
    const again = await putMarketFile(h.env, h.deps, ctx, body(0, { driveFileId: 'drive-file-new0', name: 'renamed.json.gz' }));
    expect(again).toMatchObject({ driveFileId: 'drive-file-new0', name: 'renamed.json.gz', sha256: body(0).sha256, updatedAt: h.clock.now });
    expect(again.createdAt).toBe(h.clock.now - 1000);
    expect(h.env.DB.raw.prepare('SELECT count(*) AS n FROM market_files').get()).toEqual({ n: 1 });
  });
  it('9행에서 새 등록은 성공, 10행에서 새 sha256은 429 market-limit, 같은 sha256 갱신은 성공하고 10행 유지', async () => {
    const h = harness();
    const { ctx } = await seed(h, 'me@example.test', 9);
    await putMarketFile(h.env, h.deps, ctx, body(9));
    await expect(putMarketFile(h.env, h.deps, ctx, body(10))).rejects.toMatchObject({ status: 429, code: 'market-limit' });
    await expect(putMarketFile(h.env, h.deps, ctx, body(3, { driveFileId: 'drive-file-again' }))).resolves.toMatchObject({ driveFileId: 'drive-file-again' });
    expect(h.env.DB.raw.prepare('SELECT count(*) AS n FROM market_files').get()).toEqual({ n: 10 });
  });
  it('본문 검사: 알 수 없는 키 422 unknown-field, 모양 422 invalid, 금지 키 먼저', async () => {
    const h = harness();
    const { ctx } = await seed(h, 'me@example.test', 0);
    await expect(putMarketFile(h.env, h.deps, ctx, body(0, { extra: 1 }))).rejects.toMatchObject({ status: 422, code: 'unknown-field', extra: { path: 'extra' } });
    await expect(putMarketFile(h.env, h.deps, ctx, body(0, { sha256: 'x' }))).rejects.toMatchObject({ status: 422, code: 'invalid', extra: { path: 'sha256' } });
    await expect(putMarketFile(h.env, h.deps, ctx, body(0, { [FORBIDDEN_KEYS[0]]: 'k' }))).rejects.toMatchObject({ status: 422, code: 'forbidden-field' });
  });
});

describe('앱 세션 라우트', () => {
  it('GET은 내 행만 수집 시각 내림차순으로, POST는 405', async () => {
    const h = harness();
    const { me } = await seed(h, 'me@example.test', 3);
    await seed(h, OTHER, 1);
    const r = await j(await me.as('GET', '/v1/market/files'));
    expect(r.status).toBe(200);
    expect(r.body.files.map((f: any) => f.name)).toEqual([body(2).name, body(1).name, body(0).name]);
    expect(r.body.files[0]).toEqual({ id: expect.any(String), ...body(2), createdAt: h.clock.now, updatedAt: h.clock.now });
    expect((await me.as('POST', '/v1/market/files', body(5))).status).toBe(405);
  });
  it('DELETE /:id는 내 행만 지우고 남의 행·없는 행은 404, DELETE 전체는 개수를 돌려준다', async () => {
    const h = harness();
    const { me } = await seed(h, 'me@example.test', 2);
    const other = await seed(h, OTHER, 1);
    const mine = (await j(await me.as('GET', '/v1/market/files'))).body.files;
    const theirs = (await j(await other.me.as('GET', '/v1/market/files'))).body.files;
    expect((await me.as('DELETE', `/v1/market/files/${theirs[0].id}`)).status).toBe(404);
    expect((await me.as('DELETE', '/v1/market/files/nope')).status).toBe(404);
    expect((await me.as('DELETE', `/v1/market/files/${mine[0].id}`)).status).toBe(200);
    expect(await j(await me.as('DELETE', '/v1/market/files'))).toEqual({ status: 200, body: { deleted: 1 } });
    expect((await j(await other.me.as('GET', '/v1/market/files'))).body.files).toHaveLength(1);
  });
  it('로그에 Drive 파일 ID·해시가 없다', async () => {
    const h = harness();
    const { me } = await seed(h, 'me@example.test', 1);
    await me.as('GET', '/v1/market/files');
    expect(h.logs.join('\n')).not.toContain(body(0).driveFileId);
    expect(h.logs.join('\n')).not.toContain(body(0).sha256);
  });
});
```

`HttpError`의 필드 이름(`status`·`code`·`extra`)은 `@sch0718/firebase-session/worker`의 `HttpError` 정의(`node_modules/@sch0718/firebase-session/dist/worker/http.d.ts`)를 열어 맞춘다. 금지 키 오류 코드 `forbidden-field`는 `src/lib/sync/dto.ts:94`와 같다.

- [ ] **Step 3: 실패 확인**

Run: `pnpm --filter sync-worker test -- market`
Expected: FAIL (`./market` 없음, 0006 없음)

- [ ] **Step 4: 구현**

```ts
// sync-worker/src/market.ts
// 시장 파일 manifest(설계 2026-11-02-market-drive 5절). 파일 본문은 사용자 Drive appDataFolder에 있다.
// 로그에는 Drive 파일 ID·해시·이름을 남기지 않는다(handler가 경로 패턴만 남긴다).
import { HttpError } from '@sch0718/firebase-session/worker';
import { checkMarketBody, MARKET_FILES_LIMIT, type MarketFileRow } from '../../src/lib/marketData/manifest';
import { findForbidden } from '../../src/lib/sync/forbidden';
import type { SyncDeps, SyncEnv } from './env';
import type { AuthContext } from './session';

const ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const COLUMNS = `id, drive_file_id AS driveFileId, name, sha256, size, format_version AS version, collected_at AS collectedAt,
  range_from AS rangeFrom, range_to AS rangeTo, stocks, created_at AS createdAt, updated_at AS updatedAt`;
type Raw = Omit<MarketFileRow, 'range'> & { rangeFrom: string; rangeTo: string };
const toRow = ({ rangeFrom, rangeTo, ...r }: Raw): MarketFileRow => ({ ...r, range: { from: rangeFrom, to: rangeTo } });

export async function listMarketFiles(env: SyncEnv, ctx: AuthContext): Promise<MarketFileRow[]> {
  const { results } = await env.DB.prepare(`SELECT ${COLUMNS} FROM market_files WHERE user_id = ? ORDER BY collected_at DESC, created_at DESC`)
    .bind(ctx.userId)
    .all<Raw>();
  return results.map(toRow);
}

/** 같은 sha256이면 갱신(한도에 세지 않는다), 새 sha256이면 사용자당 10행까지 */
export async function putMarketFile(env: SyncEnv, deps: SyncDeps, ctx: AuthContext, body: unknown): Promise<MarketFileRow> {
  const hit = findForbidden(body);
  if (hit) throw new HttpError(422, 'forbidden-field', { path: hit });
  const c = checkMarketBody(body);
  if (!c.ok) throw new HttpError(422, c.code, { path: c.path });
  const b = c.value;
  const now = deps.now();
  const r = await env.DB.prepare(
    `INSERT INTO market_files (id, user_id, drive_file_id, name, sha256, size, format_version, collected_at, range_from, range_to, stocks, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     WHERE (SELECT count(*) FROM market_files WHERE user_id = ?) < ? OR EXISTS (SELECT 1 FROM market_files WHERE user_id = ? AND sha256 = ?)
     ON CONFLICT (user_id, sha256) DO UPDATE SET drive_file_id = excluded.drive_file_id, name = excluded.name, updated_at = excluded.updated_at`,
  )
    .bind(deps.uuid(), ctx.userId, b.driveFileId, b.name, b.sha256, b.size, b.version, b.collectedAt, b.range.from, b.range.to, b.stocks, now, now,
      ctx.userId, MARKET_FILES_LIMIT, ctx.userId, b.sha256)
    .run();
  if (r.meta.changes === 0) throw new HttpError(429, 'market-limit');
  const row = await env.DB.prepare(`SELECT ${COLUMNS} FROM market_files WHERE user_id = ? AND sha256 = ?`).bind(ctx.userId, b.sha256).first<Raw>();
  if (!row) throw new Error('market: row missing after upsert');
  return toRow(row);
}

export async function deleteMarketFile(env: SyncEnv, ctx: AuthContext, id: string): Promise<void> {
  if (!ID_RE.test(id)) throw new HttpError(404, 'not-found');
  const r = await env.DB.prepare('DELETE FROM market_files WHERE id = ? AND user_id = ?').bind(id, ctx.userId).run();
  if (r.meta.changes === 0) throw new HttpError(404, 'not-found');
}

export async function wipeMarketFiles(env: SyncEnv, ctx: AuthContext): Promise<{ deleted: number }> {
  const r = await env.DB.prepare('DELETE FROM market_files WHERE user_id = ?').bind(ctx.userId).run();
  return { deleted: r.meta.changes };
}
```

`sync-worker/src/handler.ts`: import를 더하고 ROUTES의 `/v1/shares` 줄들 앞에 넣는다. 본문 없는 DELETE는 `readJson`을 부르지 않는다.

```ts
import { deleteMarketFile, listMarketFiles, wipeMarketFiles } from './market';
// …ROUTES 안
  ['GET', /^\/v1\/market\/files$/, '/v1/market/files', authed(async ({ env, ctx }) => ok({ files: await listMarketFiles(env, ctx) }))],
  ['DELETE', /^\/v1\/market\/files$/, '/v1/market/files', authed(async ({ env, ctx }) => ok(await wipeMarketFiles(env, ctx)))],
  ['DELETE', /^\/v1\/market\/files\/([^/]+)$/, '/v1/market/files/:id', authed(async ({ env, ctx, params }) => (await deleteMarketFile(env, ctx, params[0]), ok({ deleted: true })))],
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm --filter sync-worker test`
Expected: PASS (기존 테스트 포함)

- [ ] **Step 6: 커밋**

```bash
git add sync-worker/migrations/0006_market_files.sql sync-worker/src/market.ts sync-worker/src/market.test.ts sync-worker/src/handler.ts sync-worker/src/cli.test.ts
git commit -m "feat(sync-worker): 시장 파일 manifest 표(0006)와 목록·삭제 API를 더함"
```

---

### Task 3: CLI 토큰 범위 `market-upload`

**Files:**
- Modify: `sync-worker/src/cli.ts`
- Test: `sync-worker/src/cli.test.ts`

**Interfaces:**
- Consumes: Task 2 `listMarketFiles`, `putMarketFile`, `deleteMarketFile`
- Produces:
  - `POST /v1/cli/device` 본문 `{ label, scope? }` (`'read'` 기본, 그 밖은 422 `invalid` `path: 'scope'`)
  - `approveCli` 응답에 `scope`(조회·결정 모두)
  - `pollToken` 응답 `{ token, tokenId, expiresAt, scope }`
  - `cliScope(method: string, url: URL, scope: string): 'profiles' | 'profile' | 'logout' | 'market-list' | 'market-put' | 'market-delete' | null`
  - `listCliTokens` 행에 `scope`

- [ ] **Step 1: 실패하는 테스트 작성** (`sync-worker/src/cli.test.ts` 끝에 추가)

```ts
describe('market-upload 범위', () => {
  const marketBody = {
    driveFileId: 'drive-file-0001', name: 'market-data-20261031.json.gz', sha256: 'b'.repeat(64), size: 10, version: 4,
    collectedAt: '2026-10-31T18:00:00+09:00', range: { from: '2021-10-31', to: '2026-10-31' }, stocks: 1,
  };
  async function connectScoped(h: Harness, scope?: string) {
    const me = await h.login();
    const d = (await j(await cliCall(h, 'POST', '/v1/cli/device', { body: scope ? { label: 'gazua-drive@mac', scope } : { label: 'gazua@mac' }, ip: '203.0.113.5' }))).body;
    const look = (await j(await me.as('POST', '/v1/cli/approve', { userCode: d.userCode }))).body;
    await me.as('POST', '/v1/cli/approve', { userCode: d.userCode, approve: true });
    h.clock.now += 5000;
    const t = (await j(await poll(h, d.deviceCode))).body;
    return { me, look, t };
  }

  it('scope 없이 요청하면 read, market-upload면 승인 조회·토큰 응답·토큰 목록에 범위가 보인다', async () => {
    const h = harness();
    const read = await connectScoped(h);
    expect(read.look.scope).toBe('read');
    expect(read.t.scope).toBe('read');
    const up = await connectScoped(h, 'market-upload');
    expect(up.look.scope).toBe('market-upload');
    expect(up.t.scope).toBe('market-upload');
    expect(rows(h, 'SELECT scope FROM cli_tokens ORDER BY created_at').map((r) => r.scope)).toEqual(['read', 'market-upload']);
    const list = (await j(await up.me.as('GET', '/v1/cli/tokens'))).body.tokens;
    expect(list.map((t: any) => t.scope).sort()).toEqual(['market-upload', 'read']);
  });

  it('알 수 없는 scope는 422 invalid path scope', async () => {
    const h = harness();
    const r = await j(await cliCall(h, 'POST', '/v1/cli/device', { body: { label: 'x', scope: 'write' }, ip: '203.0.113.5' }));
    expect(r).toMatchObject({ status: 422, body: { error: 'invalid', path: 'scope' } });
  });

  it('market-upload 토큰은 manifest 목록·등록·삭제와 로그아웃만 된다', async () => {
    const h = harness();
    const { t } = await connectScoped(h, 'market-upload');
    const put = await j(await cliCall(h, 'POST', '/v1/market/files', { token: t.token, body: marketBody }));
    expect(put.status).toBe(200);
    expect((await j(await cliCall(h, 'GET', '/v1/market/files', { token: t.token }))).body.files).toHaveLength(1);
    for (const [m, p] of [['GET', '/v1/profiles'], ['GET', '/v1/profiles/p1?docVersion=2'], ['DELETE', '/v1/market/files'], ['GET', '/v1/keys']] as const) {
      expect((await j(await cliCall(h, m, p, { token: t.token }))).body.error, `${m} ${p}`).toBe('cli-scope');
    }
    expect((await cliCall(h, 'DELETE', `/v1/market/files/${put.body.id}`, { token: t.token })).status).toBe(200);
    expect((await cliCall(h, 'DELETE', '/v1/cli/token', { token: t.token })).status).toBe(200);
  });

  it('read 토큰은 market 경로가 403 cli-scope', async () => {
    const h = harness();
    const { t } = await connectScoped(h);
    for (const [m, p] of [['GET', '/v1/market/files'], ['POST', '/v1/market/files'], ['DELETE', '/v1/market/files/x']] as const) {
      expect((await j(await cliCall(h, m, p, { token: t.token, body: m === 'POST' ? marketBody : undefined }))).body.error).toBe('cli-scope');
    }
  });

  it('market-upload 등록 한도 429 market-limit', async () => {
    const h = harness();
    const { t } = await connectScoped(h, 'market-upload');
    for (let i = 0; i < 10; i++) {
      const b = { ...marketBody, sha256: i.toString(16).padStart(64, '0') };
      expect((await cliCall(h, 'POST', '/v1/market/files', { token: t.token, body: b })).status).toBe(200);
    }
    const over = await j(await cliCall(h, 'POST', '/v1/market/files', { token: t.token, body: { ...marketBody, sha256: 'f'.repeat(64) } }));
    expect(over).toMatchObject({ status: 429, body: { error: 'market-limit' } });
  });
});
```

기존 `sync-worker/src/cli.test.ts`의 정확 일치(`toEqual`) 기대값도 기본 범위에 맞춰 고친다.

- 승인 조회 테스트(`조회는 상태를 바꾸지 않고 label·createdAt·geo를 돌려준다`, 현재 209행)의 응답 기대값에 `scope: 'read'`를 더한다. 기존 `geo`와 상태 불변 검사는 유지한다.
- 승인 결정 테스트(`approve:true는 … 응답은 {label, createdAt}`, 현재 225행)는 `{ label, createdAt, scope: 'read' }`로 기대값을 고친다.
- 토큰 목록 테스트(`살아 있는 내 토큰만 목록에 나오고 원문은 없다`, 현재 531행)의 행 기대값에 `scope: 'read'`를 더한다. 기존 토큰 메타데이터와 원문 비노출 검사는 유지한다.

흐름 테스트(`흐름: device → …`)의 토큰 응답 검사는 `scope: 'read'`를 더해도 `toBe`가 아니라 개별 필드 검사라 그대로 둔다.

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter sync-worker test -- cli`
Expected: FAIL (scope 없음)

- [ ] **Step 3: 구현** (`sync-worker/src/cli.ts`)

1. 상수·검사 추가:

```ts
import { deleteMarketFile, listMarketFiles, putMarketFile } from './market';

export const CLI_SCOPES = ['read', 'market-upload'] as const;
export type CliTokenScope = (typeof CLI_SCOPES)[number];
const MARKET_FILES_RE = /^\/v1\/market\/files$/;
const MARKET_FILE_RE = /^\/v1\/market\/files\/([^/]+)$/;

function checkScope(body: unknown): CliTokenScope {
  const s = isRecord(body) ? body.scope : undefined;
  if (s === undefined) return 'read';
  if (typeof s === 'string' && (CLI_SCOPES as readonly string[]).includes(s)) return s as CliTokenScope;
  throw new HttpError(422, 'invalid', { path: 'scope' });
}
```

2. `INSERT_GRANT`에 `scope` 열을 넣는다(`… geo, created_at, expires_at, scope) SELECT ?, …, ?, ?, ?, ?`). `createDevice`에서 `const scope = checkScope(body);`를 `checkLabel` 뒤에 두고 bind의 `now + CLI_GRANT_TTL` 다음에 `scope`를 넣는다(INSERT 열 순서와 바인딩 순서를 맞춘다).

3. `pollToken`: grant SELECT에 `scope`를 더하고, cli_tokens INSERT의 `'read'`를 `?`로 바꿔 `g.scope`를 바인딩한다. 반환을 `{ token, tokenId, expiresAt, scope: g.scope }`로.

4. `cliScope`:

```ts
export function cliScope(method: string, url: URL, scope: string): 'profiles' | 'profile' | 'logout' | 'market-list' | 'market-put' | 'market-delete' | null {
  const path = url.pathname;
  if (method === 'DELETE' && LOGOUT_RE.test(path)) return 'logout';
  if (scope === 'market-upload') {
    if (url.search !== '') return null;
    if (method === 'GET' && MARKET_FILES_RE.test(path)) return 'market-list';
    if (method === 'POST' && MARKET_FILES_RE.test(path)) return 'market-put';
    if (method === 'DELETE' && MARKET_FILE_RE.test(path)) return 'market-delete';
    return null;
  }
  if (scope !== 'read') return null;
  if (method === 'GET' && PROFILES_RE.test(path)) return 'profiles';
  if (method === 'GET' && PROFILE_RE.test(path)) {
    const v = url.searchParams.getAll('docVersion');
    return v.length === 1 && v[0] === '2' ? 'profile' : null;
  }
  return null;
}
```

5. `handleCliToken`: 토큰 SELECT에 `t.scope`를 더하고(`TokenRow.scope: string`), `cliScope(req.method, url, row.scope)`. `ctx` 만든 뒤:

```ts
  if (scope === 'market-list') return json(200, { files: await listMarketFiles(env, ctx) });
  if (scope === 'market-put') return json(200, await putMarketFile(env, deps, ctx, await readJson(req, 4096)));
  if (scope === 'market-delete') {
    await deleteMarketFile(env, ctx, decodeURIComponent(MARKET_FILE_RE.exec(url.pathname)![1]));
    return json(200, { deleted: true });
  }
```

6. `listCliTokens` SELECT에 `scope`를 더하고 결과 타입에 `scope: string`.

7. `approveCli`: 조회 SELECT에 `scope`를 더해 조회 응답 `{ label, createdAt, geo, scope }`, 결정 응답 `{ label, createdAt, scope }`.

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter sync-worker test`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add sync-worker/src/cli.ts sync-worker/src/cli.test.ts
git commit -m "feat(sync-worker): CLI 토큰에 시장 파일 올리기 전용 범위(market-upload)를 더함"
```

---

### Task 4: 앱 API·컨트롤러·승인 화면 범위 표시

**Files:**
- Modify: `src/lib/sync/api.ts`, `src/lib/sync/controller.svelte.ts`, `src/lib/ui/settings/CliConnect.svelte`, `src/lib/ui/settings/SyncManage.svelte`
- Test: `src/lib/sync/api.test.ts`, `src/lib/sync/controller.test.ts`, `src/lib/ui/settings/CliConnect.test.ts`, `src/lib/ui/settings/SyncPanel.test.ts`(SyncManage 토큰 목록 테스트가 있는 파일)

**Interfaces:**
- Consumes: Task 1 `checkMarketFiles`, `MarketFileRow`
- Produces:
  - `SyncApi.marketFiles(): Promise<ApiResult<{ files: unknown }>>`, `SyncApi.wipeMarketFiles(): Promise<ApiResult<{ deleted: number }>>`
  - `CliApproveInfo.scope?: 'read' | 'market-upload'`, `CliTokenRow.scope?: string`
  - `type MarketFilesResult = { ok: true; files: MarketFileRow[] } | { ok: false; reason: 'signed-out' | 'outdated' | 'error' }`
  - `SyncController.marketFiles(): Promise<MarketFilesResult>`, `SyncController.wipeMarketFiles(): Promise<boolean>`
  - `CliApproveResult` 성공 `info`에 `scope: 'read' | 'market-upload'`(서버가 안 주면 `'read'`)

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/sync/api.test.ts`에 (기존 가짜 fetch 패턴을 따른다):

```ts
it('marketFiles·wipeMarketFiles는 /v1/market/files를 GET·DELETE한다', async () => {
  const calls: [string, string][] = [];
  const api = createSyncApi('https://sync.test', creds(), async (url, init) => {
    calls.push([init?.method ?? 'GET', String(url)]);
    return new Response(JSON.stringify(init?.method === 'DELETE' ? { deleted: 2 } : { files: [] }), { status: 200 });
  });
  expect(await api.marketFiles()).toMatchObject({ ok: true, data: { files: [] } });
  expect(await api.wipeMarketFiles()).toMatchObject({ ok: true, data: { deleted: 2 } });
  expect(calls).toEqual([['GET', 'https://sync.test/v1/market/files'], ['DELETE', 'https://sync.test/v1/market/files']]);
});
```

(`creds()`는 같은 파일에 이미 있는 자격 증명 도우미 이름을 쓴다. 없으면 파일 위쪽의 `createSyncApi` 호출 예를 그대로 따른다.)

기존 정확 일치(`toEqual`) 기대값도 함께 고친다.

- `src/lib/sync/api.test.ts`의 `CLI 연결: 조회 → 거절·승인 → 토큰 목록 → 끊기` 테스트에서 승인 조회·승인 결정 응답의 `data` 기대값(현재 61·63행)에 각각 `scope: 'read'`를 더한다. 이 테스트는 실제 테스트 서버를 사용하므로 Task 3에서 바뀐 응답을 그대로 받는다.
- `src/lib/sync/controller.test.ts`의 `CLI 연결: 조회·승인·목록·끊기와 실패 사유` 테스트에서 승인 조회 결과의 `info` 기대값(현재 323행)에 `scope: 'read'`를 더한다. 기존 `geo`는 유지하고 Task 4의 컨트롤러 반환값과 맞춘다.

`src/lib/sync/controller.test.ts`에:

```ts
describe('marketFiles', () => {
  it('로그인 전에는 signed-out, 서버 404·500은 outdated, 모양이 틀리면 error, 맞으면 행', async () => {
    // 기존 controller 테스트의 로그인 도우미로 api를 붙인 컨트롤러를 만든다(파일 안 다른 describe의 setup 재사용)
  });
});
```

위 케이스를 파일 안의 기존 `setup`/`signedIn` 도우미로 채운다. 기대값: 로그인 전 `{ ok: false, reason: 'signed-out' }`; `api.marketFiles`가 `{ ok: false, kind: 'not-found' }` 또는 `{ ok: false, kind: 'server', status: 500 }`이면 `{ ok: false, reason: 'outdated' }`이며 전역 오류를 남기지 않는다(spec 9절의 0006 미적용 응답 포함); `{ files: [{}] }`면 `{ ok: false, reason: 'error' }`; 정상 행 하나면 `{ ok: true, files: [row] }`. `wipeMarketFiles`는 성공 시 `true`. 설정이 있어 `api`가 생성됐어도 로그인 전·로그아웃 뒤(`account === null`)에는 `marketFiles`가 `signed-out`, `wipeMarketFiles`가 `false`를 돌려주며, 두 API 메서드를 호출하지 않는지 확인한다. `api`는 로그인 상태가 아니라 설정 유무로 생성되므로 두 메서드 모두 `account`도 검사한다.

`src/lib/ui/settings/CliConnect.test.ts`에:

```ts
it('시장 파일 올리기 범위면 제목과 설명이 다르다', async () => {
  setup(() => ({ ok: true, info: { label: 'gazua-drive@mac', createdAt: NOW - 60_000, geo: null, scope: 'market-upload' } }));
  await type('bcdfghjk');
  await fireEvent.click(confirmBtn());
  await screen.findByText('시장 파일 올리기를 허락할까요?');
  expect(body()).toContain('시장 파일 목록을 올리고 지울 수 있어요. 관심 그룹·전략·키는 읽지 못해요.');
});
```

기존 `found()` 도우미는 `scope: 'read'`를 넣도록 고친다.

SyncManage 토큰 목록 테스트에: `scope: 'market-upload'`인 행은 `<small>시장 파일 올리기 CLI</small>`, 그 밖은 `읽기 전용 CLI`.

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run src/lib/sync src/lib/ui/settings/CliConnect.test.ts src/lib/ui/settings/SyncPanel.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

`api.ts`:

```ts
export interface CliApproveInfo {
  label: string;
  createdAt: number;
  geo?: string | null;
  /** 0006 이전 서버는 주지 않는다(= read) */
  scope?: 'read' | 'market-upload';
}
export interface CliTokenRow {
  id: string;
  label: string;
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number;
  scope?: string;
}
// SyncApi에
  marketFiles(): Promise<ApiResult<{ files: unknown }>>;
  /** 본문 없음 */
  wipeMarketFiles(): Promise<ApiResult<{ deleted: number }>>;
// createSyncApi 반환 객체에
    marketFiles: () => send('GET', '/v1/market/files'),
    wipeMarketFiles: () => send('DELETE', '/v1/market/files'),
```

`controller.svelte.ts`:

```ts
import { checkMarketFiles, type MarketFileRow } from '../marketData/manifest';
export type MarketFilesResult = { ok: true; files: MarketFileRow[] } | { ok: false; reason: 'signed-out' | 'outdated' | 'error' };
export type CliApproveResult =
  | { ok: true; info: { label: string; createdAt: number; geo: string | null; scope: 'read' | 'market-upload' } }
  | { ok: false; reason: 'invalid-code' | 'outdated' | 'error' };
// SyncController 인터페이스에
  /** 시장 파일 manifest(설계 2026-11-02-market-drive). 404는 옛 Worker */
  marketFiles(): Promise<MarketFilesResult>;
  wipeMarketFiles(): Promise<boolean>;
// 구현 객체에
    marketFiles: () =>
      guarded<MarketFilesResult>(
        async () => {
          if (!api || account === null) return { ok: false, reason: 'signed-out' };
          const r = await api.marketFiles();
          if (r.ok) {
            const files = checkMarketFiles(r.data.files);
            return files ? { ok: true, files } : { ok: false, reason: 'error' };
          }
          if (r.kind === 'not-found' || (r.kind === 'server' && r.status === 500)) return { ok: false, reason: 'outdated' };
          ok(r);
          return { ok: false, reason: 'error' };
        },
        { ok: false, reason: 'error' },
      ),
    wipeMarketFiles: () => guarded(async () => (api && account !== null ? ok(await api.wipeMarketFiles()) !== null : false), false),
```

`cliApprove` 성공 분기를 `{ ok: true, info: { label, createdAt, geo: r.data.geo ?? null, scope: r.data.scope === 'market-upload' ? 'market-upload' : 'read' } }`로 바꾼다.

`CliConnect.svelte`: `Info`에 `scope`를 더하고

```svelte
<Sheet open={info !== null} title={info?.scope === 'market-upload' ? '시장 파일 올리기를 허락할까요?' : '읽기 전용 접근을 허락할까요?'} onclose={() => (info = null)}>
  {#if info}
    <div class="sheet-form">
      {#if info.scope === 'market-upload'}
        <p><code>{info.label}</code>에서 요청했어요({detail}). 시장 파일 목록을 올리고 지울 수 있어요. 관심 그룹·전략·키는 읽지 못해요. 직접 실행한 명령에서 나온 코드만 승인하세요.</p>
      {:else}
        <p><code>{info.label}</code>에서 요청했어요({detail}). 관심 그룹·전략을 읽을 수 있고, 바꾸거나 주문할 수는 없어요. 직접 실행한 명령에서 나온 코드만 승인하세요.</p>
      {/if}
      <!-- actions 그대로 -->
```

`SyncManage.svelte` 108행: `<small>{t.scope === 'market-upload' ? '시장 파일 올리기 CLI' : '읽기 전용 CLI'}</small>`.

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run src/lib/sync src/lib/ui/settings && pnpm check`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/sync src/lib/ui/settings/CliConnect.svelte src/lib/ui/settings/CliConnect.test.ts src/lib/ui/settings/SyncManage.svelte src/lib/ui/settings/SyncPanel.test.ts
git commit -m "feat(sync): 시장 파일 manifest 조회·비우기와 CLI 범위 표시를 앱에 더함"
```

---

### Task 5: `importFile`이 SHA-256을 남긴다

**Files:**
- Modify: `src/lib/marketData/store.ts`
- Test: `src/lib/marketData/store.test.ts`

**Interfaces:**
- Produces: `MarketDataInfo.sha256?: string`(gzip Blob 바이트의 SHA-256 소문자 hex), `sha256Hex(blob: Blob): Promise<string>`(export)

- [ ] **Step 1: 실패하는 테스트 작성** (store.test.ts에 기존 가져오기 테스트 도우미로)

```ts
it('가져온 Blob의 SHA-256을 요약에 남긴다', async () => {
  const blob = new Blob([gz]); // 파일 안 다른 테스트가 쓰는 gzip 픽스처 변수
  const res = await store.importFile(blob, deps);
  const expected = createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('hex');
  expect(res).toMatchObject({ ok: true, info: { sha256: expected } });
  expect((await store.info())?.sha256).toBe(expected);
});
```

(`createHash`는 `node:crypto`에서 import한다. 픽스처·`deps` 이름은 파일 안의 기존 import 테스트를 따라 맞춘다.)

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run src/lib/marketData/store.test.ts`
Expected: FAIL (`sha256` 없음)

- [ ] **Step 3: 구현**

```ts
/** Blob 바이트의 SHA-256 소문자 hex. Drive 받기 비교와 같은 파일 판별에 쓴다 */
export async function sha256Hex(blob: Blob): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
```

`MarketDataInfo`에 `/** 가져온 gzip 파일의 SHA-256. 이 필드가 생기기 전 요약에는 없다. */ sha256?: string;`. `importFile`의 `next` 객체를 만들기 전에 `let sha256: string | undefined; try { sha256 = await sha256Hex(file); } catch { sha256 = undefined; }`를 두고 `next`에 `...(sha256 && { sha256 })`를 넣는다(검증이 끝난 뒤, 공간 검사 앞).

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run src/lib/marketData src/lib/ui/settings/DataTools.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/marketData/store.ts src/lib/marketData/store.test.ts
git commit -m "feat(market-data): 가져온 시장 파일의 SHA-256을 요약에 남김"
```

---

### Task 6: 앱 Drive 모듈(GIS 토큰·다운로드·검증 교체·비우기)

**Files:**
- Create: `src/lib/marketData/driveConfig.ts`, `gis.ts`, `driveClient.ts`, `driveSync.ts` 와 각 `*.test.ts`
- Modify: `src/vite-env.d.ts` (`VITE_GOOGLE_DRIVE_CLIENT_ID?: string`)

**Interfaces:**
- Consumes: Task 1 `MarketFileRow`; Task 5 `sha256Hex`, `MarketDataStore`, `ImportDeps`, `MarketDataInfo`
- Produces:
  - `readDriveClientId(env?: Record<string, unknown>): string | null`
  - `GIS_SRC`, `DRIVE_SCOPE`, `loadGis(doc?: Document): Promise<void>`, `type GoogleOAuth2`, `type DriveAuth = { token(): Promise<TokenResult>; forget(): void }`, `type TokenResult = { ok: true; token: string } | { ok: false; reason: 'cancelled' | 'denied' | 'not-ready' }`, `createDriveAuth(clientId: string, deps?: { now?: () => number; oauth2?: () => GoogleOAuth2 | undefined }): DriveAuth`
  - `type DriveFail = { ok: false; kind: 'auth' | 'not-found' | 'quota' | 'offline' | 'failed' }`, `downloadFile(f: typeof fetch, token: string, id: string, onProgress?: (done: number, total: number | null) => void): Promise<{ ok: true; blob: Blob } | DriveFail>`, `deleteFile(f, token, id): Promise<{ ok: true } | DriveFail>`, `listMarketFileIds(f, token): Promise<{ ok: true; ids: string[] } | DriveFail>`
  - `type DriveOutcome = { ok: true; info: MarketDataInfo; persisted?: boolean } | { ok: false; reason: 'cancelled' | 'denied' | 'not-ready' | 'auth' | 'not-found' | 'quota' | 'offline' | 'failed' | 'mismatch' | 'format' | 'version-newer' | 'corrupt'; neededMb?: number } | { ok: false; reason: 'quota-device'; neededMb?: number }`
  - `fetchFromDrive(row: MarketFileRow, deps: DriveDeps, onProgress?): Promise<DriveOutcome>`, `wipeDrive(files: MarketFileRow[], deps: DriveDeps & { wipeManifest: () => Promise<boolean> }): Promise<{ ok: true } | { ok: false; reason: string }>`
  - `interface DriveDeps { fetch: typeof fetch; auth: DriveAuth; store: MarketDataStore; importDeps?: ImportDeps; digest?: (b: Blob) => Promise<string> }`

`importFile`의 `quota`(기기 공간 부족)는 Drive 쿼터와 섞이지 않게 `quota-device`로 바꿔 돌려준다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/lib/marketData/driveConfig.test.ts
import { expect, it } from 'vitest';
import { readDriveClientId } from './driveConfig';
it('빈 값·공백은 null, 값은 다듬어 돌려준다', () => {
  expect(readDriveClientId({})).toBeNull();
  expect(readDriveClientId({ VITE_GOOGLE_DRIVE_CLIENT_ID: '  ' })).toBeNull();
  expect(readDriveClientId({ VITE_GOOGLE_DRIVE_CLIENT_ID: ' abc.apps.googleusercontent.com ' })).toBe('abc.apps.googleusercontent.com');
});
```

```ts
// src/lib/marketData/gis.test.ts
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
```

```ts
// src/lib/marketData/driveClient.test.ts
import { describe, expect, it } from 'vitest';
import { deleteFile, downloadFile, listMarketFileIds } from './driveClient';

const respond = (status: number, body: BodyInit | null = null, headers: Record<string, string> = {}) => async () => new Response(body, { status, headers });

describe('downloadFile', () => {
  it('alt=media로 받아 Blob과 진행률을 준다', async () => {
    const seen: string[] = [];
    const progress: [number, number | null][] = [];
    const f = (async (url: string, init?: RequestInit) => {
      seen.push(`${url} ${new Headers(init?.headers).get('Authorization')}`);
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-length': '3' } });
    }) as typeof fetch;
    const r = await downloadFile(f, 'tok', 'FILEID12345', (d, t) => progress.push([d, t]));
    expect(r.ok && r.blob.size).toBe(3);
    expect(seen).toEqual(['https://www.googleapis.com/drive/v3/files/FILEID12345?alt=media Bearer tok']);
    expect(progress.at(-1)).toEqual([3, 3]);
  });
  it.each([
    [401, 'auth'],
    [404, 'not-found'],
    [429, 'quota'],
    [500, 'failed'],
  ])('%i → %s', async (status, kind) => {
    expect(await downloadFile(respond(status) as unknown as typeof fetch, 't', 'FILEID12345')).toEqual({ ok: false, kind });
  });
  it('403 storageQuotaExceeded·rateLimitExceeded는 quota, 그 밖 403은 failed, 네트워크 실패는 offline', async () => {
    const q = JSON.stringify({ error: { errors: [{ reason: 'rateLimitExceeded' }] } });
    expect(await downloadFile(respond(403, q) as unknown as typeof fetch, 't', 'FILEID12345')).toEqual({ ok: false, kind: 'quota' });
    expect(await downloadFile(respond(403, '{}') as unknown as typeof fetch, 't', 'FILEID12345')).toEqual({ ok: false, kind: 'failed' });
    const off = (async () => { throw new TypeError('fail'); }) as unknown as typeof fetch;
    expect(await downloadFile(off, 't', 'FILEID12345')).toEqual({ ok: false, kind: 'offline' });
  });
});

describe('deleteFile·listMarketFileIds', () => {
  it('삭제 404는 성공으로 본다', async () => {
    expect(await deleteFile(respond(404) as unknown as typeof fetch, 't', 'FILEID12345')).toEqual({ ok: true });
    expect(await deleteFile(respond(204) as unknown as typeof fetch, 't', 'FILEID12345')).toEqual({ ok: true });
  });
  it('appDataFolder에서 gazua 표식 파일 ID를 페이지를 넘기며 모은다', async () => {
    const urls: URL[] = [];
    const f = (async (url: string) => {
      const u = new URL(url);
      urls.push(u);
      const body = u.searchParams.get('pageToken') ? { files: [{ id: 'B' }] } : { files: [{ id: 'A' }], nextPageToken: 'n' };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    expect(await listMarketFileIds(f, 't')).toEqual({ ok: true, ids: ['A', 'B'] });
    expect(urls[0].searchParams.get('spaces')).toBe('appDataFolder');
    expect(urls[0].searchParams.get('q')).toBe("appProperties has { key='gazua' and value='market-data' }");
  });
});
```

```ts
// src/lib/marketData/driveSync.test.ts
import { describe, expect, it, vi } from 'vitest';
import type { MarketFileRow } from './manifest';
import { fetchFromDrive, wipeDrive, type DriveDeps } from './driveSync';

const row = (o: Partial<MarketFileRow> = {}): MarketFileRow => ({
  id: 'r1', driveFileId: 'FILEID12345', name: 'market-data-20261031.json.gz', sha256: 'c'.repeat(64), size: 3, version: 4,
  collectedAt: '2026-10-31T18:00:00+09:00', range: { from: '2021-10-31', to: '2026-10-31' }, stocks: 1, createdAt: 1, updatedAt: 1, ...o,
});
function deps(o: Partial<DriveDeps> = {}) {
  const importFile = vi.fn(async () => ({ ok: true as const, info: { collectedAt: 'x', stocks: 1, range: { from: 'a', to: 'b' }, sha256: 'c'.repeat(64) } }));
  const d: DriveDeps = {
    fetch: (async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })) as typeof fetch,
    auth: { token: async () => ({ ok: true, token: 't' }), forget: vi.fn() },
    store: { importFile } as unknown as DriveDeps['store'],
    digest: async () => 'c'.repeat(64),
    ...o,
  };
  return { d, importFile };
}

describe('fetchFromDrive', () => {
  it('크기·해시가 맞으면 importFile로 교체한다', async () => {
    const { d, importFile } = deps();
    expect(await fetchFromDrive(row(), d)).toMatchObject({ ok: true });
    expect(importFile).toHaveBeenCalledTimes(1);
  });
  it('크기나 해시가 다르면 mismatch이고 저장하지 않는다', async () => {
    const a = deps();
    expect(await fetchFromDrive(row({ size: 4 }), a.d)).toEqual({ ok: false, reason: 'mismatch' });
    const b = deps({ digest: async () => 'd'.repeat(64) });
    expect(await fetchFromDrive(row(), b.d)).toEqual({ ok: false, reason: 'mismatch' });
    expect(a.importFile).not.toHaveBeenCalled();
    expect(b.importFile).not.toHaveBeenCalled();
  });
  it('토큰 실패는 그대로, Drive 401은 토큰을 잊고 auth', async () => {
    const c = deps({ auth: { token: async () => ({ ok: false, reason: 'cancelled' }), forget: vi.fn() } });
    expect(await fetchFromDrive(row(), c.d)).toEqual({ ok: false, reason: 'cancelled' });
    const forget = vi.fn();
    const u = deps({ fetch: (async () => new Response(null, { status: 401 })) as typeof fetch, auth: { token: async () => ({ ok: true, token: 't' }), forget } });
    expect(await fetchFromDrive(row(), u.d)).toEqual({ ok: false, reason: 'auth' });
    expect(forget).toHaveBeenCalled();
  });
  it('importFile의 기기 공간 부족은 quota-device로 바꾼다', async () => {
    const { d } = deps({ store: { importFile: async () => ({ ok: false, reason: 'quota', neededMb: 90 }) } as unknown as DriveDeps['store'] });
    expect(await fetchFromDrive(row(), d)).toEqual({ ok: false, reason: 'quota-device', neededMb: 90 });
  });
});

describe('wipeDrive', () => {
  it('manifest의 파일과 표식 파일을 모두 지우고 manifest를 비운다', async () => {
    const deleted: string[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return (deleted.push(new URL(url).pathname.split('/').pop()!), new Response(null, { status: 204 }));
      return new Response(JSON.stringify({ files: [{ id: 'ORPHAN12345' }, { id: 'FILEID12345' }] }), { status: 200 });
    }) as typeof fetch;
    const wipeManifest = vi.fn(async () => true);
    const { d } = deps({ fetch: f });
    expect(await wipeDrive([row()], { ...d, wipeManifest })).toEqual({ ok: true });
    expect(deleted.sort()).toEqual(['FILEID12345', 'ORPHAN12345']);
    expect(wipeManifest).toHaveBeenCalled();
  });
  it('Drive 삭제가 실패하면 manifest를 비우지 않는다', async () => {
    const f = (async (_u: string, init?: RequestInit) => (init?.method === 'DELETE' ? new Response(null, { status: 500 }) : new Response(JSON.stringify({ files: [] }), { status: 200 }))) as typeof fetch;
    const wipeManifest = vi.fn(async () => true);
    const { d } = deps({ fetch: f });
    expect(await wipeDrive([row()], { ...d, wipeManifest })).toEqual({ ok: false, reason: 'failed' });
    expect(wipeManifest).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run src/lib/marketData`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현**

```ts
// src/lib/marketData/driveConfig.ts
// Drive 전달(선택 기능)은 빌드 변수 VITE_GOOGLE_DRIVE_CLIENT_ID가 있을 때만 켜진다(설계 8.1).
export function readDriveClientId(env: Record<string, unknown> = import.meta.env): string | null {
  const v = env.VITE_GOOGLE_DRIVE_CLIENT_ID;
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}
```

```ts
// src/lib/marketData/gis.ts
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
```

```ts
// src/lib/marketData/driveClient.ts
// Drive REST(appDataFolder). 실패를 화면 문구용 종류로만 바꾼다. 응답 본문·토큰은 남기지 않는다.
const API = 'https://www.googleapis.com/drive/v3/files';
export const MARKET_QUERY = "appProperties has { key='gazua' and value='market-data' }";
export type DriveFail = { ok: false; kind: 'auth' | 'not-found' | 'quota' | 'offline' | 'failed' };

async function failOf(res: Response): Promise<DriveFail> {
  if (res.status === 401) return { ok: false, kind: 'auth' };
  if (res.status === 404) return { ok: false, kind: 'not-found' };
  if (res.status === 429) return { ok: false, kind: 'quota' };
  if (res.status === 403) {
    const text = await res.text().catch(() => '');
    if (/storageQuotaExceeded|rateLimitExceeded|userRateLimitExceeded/.test(text)) return { ok: false, kind: 'quota' };
  }
  return { ok: false, kind: 'failed' };
}

async function send(f: typeof fetch, url: string, token: string, init: RequestInit = {}): Promise<Response | DriveFail> {
  try {
    return await f(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
  } catch {
    return { ok: false, kind: 'offline' };
  }
}

export async function downloadFile(f: typeof fetch, token: string, id: string, onProgress?: (done: number, total: number | null) => void): Promise<{ ok: true; blob: Blob } | DriveFail> {
  const res = await send(f, `${API}/${encodeURIComponent(id)}?alt=media`, token);
  if (!(res instanceof Response)) return res;
  if (!res.ok) return failOf(res);
  const len = Number(res.headers.get('content-length'));
  const total = Number.isFinite(len) && len > 0 ? len : null;
  if (!res.body) return { ok: true, blob: await res.blob() };
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let done = 0;
  try {
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      parts.push(r.value);
      done += r.value.byteLength;
      onProgress?.(done, total);
    }
  } catch {
    return { ok: false, kind: 'offline' };
  }
  return { ok: true, blob: new Blob(parts) };
}

export async function deleteFile(f: typeof fetch, token: string, id: string): Promise<{ ok: true } | DriveFail> {
  const res = await send(f, `${API}/${encodeURIComponent(id)}`, token, { method: 'DELETE' });
  if (!(res instanceof Response)) return res;
  return res.ok || res.status === 404 ? { ok: true } : failOf(res);
}

export async function listMarketFileIds(f: typeof fetch, token: string): Promise<{ ok: true; ids: string[] } | DriveFail> {
  const ids: string[] = [];
  let page: string | undefined;
  do {
    const u = new URL(API);
    u.searchParams.set('spaces', 'appDataFolder');
    u.searchParams.set('q', MARKET_QUERY);
    u.searchParams.set('fields', 'nextPageToken,files(id)');
    u.searchParams.set('pageSize', '100');
    if (page) u.searchParams.set('pageToken', page);
    const res = await send(f, u.toString(), token);
    if (!(res instanceof Response)) return res;
    if (!res.ok) return failOf(res);
    const body = (await res.json().catch(() => null)) as { files?: { id?: unknown }[]; nextPageToken?: unknown } | null;
    for (const x of body?.files ?? []) if (typeof x.id === 'string') ids.push(x.id);
    page = typeof body?.nextPageToken === 'string' ? body.nextPageToken : undefined;
  } while (page);
  return { ok: true, ids };
}
```

```ts
// src/lib/marketData/driveSync.ts
// Drive에서 받은 파일을 manifest(크기·SHA-256)와 맞춰 본 뒤 기존 importFile로 교체한다(설계 D7).
import { deleteFile, downloadFile, listMarketFileIds } from './driveClient';
import type { DriveAuth } from './gis';
import type { MarketFileRow } from './manifest';
import { sha256Hex, type ImportDeps, type MarketDataInfo, type MarketDataStore } from './store';

export interface DriveDeps {
  fetch: typeof fetch;
  auth: DriveAuth;
  store: MarketDataStore;
  importDeps?: ImportDeps;
  digest?: (b: Blob) => Promise<string>;
}
export type DriveOutcome =
  | { ok: true; info: MarketDataInfo; persisted?: boolean }
  | { ok: false; reason: 'cancelled' | 'denied' | 'not-ready' | 'auth' | 'not-found' | 'quota' | 'offline' | 'failed' | 'mismatch' | 'format' | 'version-newer' | 'corrupt' | 'quota-device'; neededMb?: number };

/** 클릭 처리기에서 곧바로 부른다. 첫 await가 auth.token()이라 팝업이 막히지 않는다 */
export async function fetchFromDrive(row: MarketFileRow, deps: DriveDeps, onProgress?: (done: number, total: number | null) => void): Promise<DriveOutcome> {
  const t = await deps.auth.token();
  if (!t.ok) return { ok: false, reason: t.reason };
  const dl = await downloadFile(deps.fetch, t.token, row.driveFileId, onProgress);
  if (!dl.ok) {
    if (dl.kind === 'auth') deps.auth.forget();
    return { ok: false, reason: dl.kind };
  }
  if (dl.blob.size !== row.size || (await (deps.digest ?? sha256Hex)(dl.blob)) !== row.sha256) return { ok: false, reason: 'mismatch' };
  const r = await deps.store.importFile(dl.blob, deps.importDeps);
  if (r.ok) return r;
  return r.reason === 'quota' ? { ok: false, reason: 'quota-device', neededMb: r.neededMb } : { ok: false, reason: r.reason };
}

/** Drive의 manifest 파일과 표식 파일을 모두 지운 뒤에만 manifest를 비운다 */
export async function wipeDrive(files: MarketFileRow[], deps: DriveDeps & { wipeManifest: () => Promise<boolean> }): Promise<{ ok: true } | { ok: false; reason: string }> {
  const t = await deps.auth.token();
  if (!t.ok) return { ok: false, reason: t.reason };
  const listed = await listMarketFileIds(deps.fetch, t.token);
  if (!listed.ok) return { ok: false, reason: listed.kind };
  for (const id of new Set([...files.map((f) => f.driveFileId), ...listed.ids])) {
    const r = await deleteFile(deps.fetch, t.token, id);
    if (!r.ok) {
      if (r.kind === 'auth') deps.auth.forget();
      return { ok: false, reason: r.kind };
    }
  }
  return (await deps.wipeManifest()) ? { ok: true } : { ok: false, reason: 'server' };
}
```

`src/vite-env.d.ts`의 `ImportMetaEnv`에 `readonly VITE_GOOGLE_DRIVE_CLIENT_ID?: string;`(파일에 `ImportMetaEnv`가 없으면 기존 `VITE_*` 선언 방식을 따른다).

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run src/lib/marketData && pnpm check`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/marketData src/vite-env.d.ts
git commit -m "feat(market-drive): 앱의 GIS 토큰·Drive 받기·검증 교체·비우기 모듈을 더함"
```

---

### Task 7: 설정 화면 Drive 영역과 CSP

**Files:**
- Create: `src/lib/ui/settings/MarketDrive.svelte`, `src/lib/ui/settings/MarketDrive.test.ts`, `drive-csp.config.ts`, `drive-csp.config.test.ts`
- Modify: `src/lib/ui/settings/DataTools.svelte` (props에 `sync?`, `driveClientId?`, `drive?`), `src/routes/Settings.svelte:128` (`<DataTools {app} {sync} />`), `vite.config.ts:8,25` (플러그인), `vitest.config.ts` (Drive CSP 테스트 포함), `tsconfig.json` (Drive CSP 구현·테스트 포함), `.github/workflows/deploy.yml` (`pnpm build`의 env)

**Interfaces:**
- Consumes: Task 4 `SyncController.marketFiles/wipeMarketFiles`, `account`; Task 6 `createDriveAuth`, `loadGis`, `fetchFromDrive`, `wipeDrive`, `readDriveClientId`, `DriveOutcome`; Task 5 `MarketDataInfo.sha256`
- Produces:
  - `MarketDrive.svelte` props: `{ sync: SyncController; marketData: MarketDataStore; localInfo: MarketDataInfo | null; onImported: (info: MarketDataInfo) => void; clientId: string; fetchImpl?: typeof fetch; auth?: DriveAuth; importDeps?: ImportDeps; preload?: () => Promise<void>; confirmFn?: (msg: string) => boolean }`
  - `driveCsp(html: string, enabled: boolean): string`, `driveCspPlugin(): Plugin`, `DRIVE_SCRIPT_SOURCES = ['https://accounts.google.com/gsi/client']`

화면 문구(spec 8.3):

| 상태 | `<p>` 문구 | 버튼 |
|---|---|---|
| 로그인 안 함(`sync.account === null`) | `동기화에 로그인하면 맥에서 올린 시장 파일을 받을 수 있어요` | 없음 |
| 읽는 중 | `Drive 목록을 확인하는 중…` | 없음 |
| `outdated` | `서버 업데이트가 필요해요` | 없음 |
| `error` | `Drive 목록을 확인하지 못했어요` | `다시 확인` |
| 비어 있음 | `Drive에 올린 시장 파일이 없어요. 맥에서 pnpm collect -- --drive로 올려요` | 없음 |
| 최신 sha256 == 이 기기 sha256 | `Drive 최신 파일과 같아요 · 수집 {YYYY-MM-DD}` | `Drive 보관본 지우기` |
| 이 기기 파일 없음 | `Drive에 시장 파일이 있어요 · 수집 {날짜} · {N}종목 · {M} MB` | `Drive에서 받기`, `Drive 보관본 지우기` |
| 다름(이 기기 수집이 더 새것이면 앞 문장을 `이 기기 파일이 더 새것이에요`로) | `Drive에 새 파일이 있어요 · 수집 {날짜} · {N}종목 · {M} MB` | `Drive에서 받기`, `Drive 보관본 지우기` |
| 받는 중 | `받는 중… {n}%`(전체 크기 모르면 `받는 중…`) | 모두 비활성 |

두 번째 행이 있으면 `<details><summary>이전 파일</summary>` 안에 `수집 {날짜} · {N}종목` + `이전 파일 받기` 버튼. `{M} MB`는 `(size / 1048576).toFixed(1)`. 날짜는 `collectedAt.slice(0, 10)`.

실패 문구(`role="alert"`): `denied` → `Google에서 Drive 권한을 허용해야 받을 수 있어요`; `not-ready` → `Google 로그인 준비 중이에요. 한 번 더 눌러 주세요`; `not-found` → `Drive에서 파일을 찾지 못했어요. 맥에서 올린 Google 계정과 같은지 확인해 주세요`; `mismatch` → `받은 파일이 손상됐어요. 다시 받아 주세요`; `auth` → `Google 로그인이 끝났어요. 다시 눌러 주세요`; `quota` → `Drive 요청 한도에 걸렸어요. 잠시 뒤 다시 시도해 주세요`; `offline` → `Drive에 연결할 수 없어요`; `quota-device` → `기기 공간이 부족해요(약 {neededMb} MB 필요)`; `version-newer` → `앱보다 새 형식의 파일이에요. 앱을 새로 고쳐 주세요`; `format`·`corrupt` → `시장 데이터 파일 형식이 아니에요`; `failed`·그 밖 → `Drive에서 받지 못했어요`; `cancelled` → 문구 없음. 성공하면 `onImported(info)` 후 `status` 문구 `Drive에서 받았어요`. `fetchFromDrive`가 예외를 던지면(예: `importFile`의 용량 초과 외 쓰기 오류) `busy`를 풀고 `Drive에서 받지 못했어요`를 띄운다.

지우기: `confirmFn('Drive의 시장 파일을 모두 지울까요? 이 기기의 시장 데이터는 남아요.')`가 참일 때 `wipeDrive(files, { …, wipeManifest: () => sync.wipeMarketFiles() })` → 성공 `Drive 보관본을 지웠어요`, 실패는 위 실패 문구(서버 실패와 예외는 `Drive 목록을 비우지 못했어요`, 예외 때도 `busy`를 푼다). 끝나면 목록을 다시 읽는다.

목록 읽기: `sync.account`를 `$effect`로 관찰해, 이미 로그인한 채 화면을 열었거나 같은 화면에서 로그인하면 `load()`를 부른다. `untrack`으로 목록 읽기 내부의 상태가 effect의 의존성에 섞이지 않게 한다. 로그인 전에는 목록을 읽지 않는다.

GIS 미리 불러오기: 목록에 행이 있으면 `$effect`로 `preload()`(기본 `loadGis`)를 한 번 부르고 실패는 무시한다. 받기·지우기 클릭 결과가 `not-ready`이면 `preload()`를 다시 부르고, 완료(실패 포함) 뒤 `busy`를 풀고 「Google 로그인 준비 중이에요. 한 번 더 눌러 주세요」를 보인다(설계 D8). 로딩 뒤 토큰 요청을 자동으로 재시도하지 않는다. 다음 클릭에서 `auth.token()`을 바로 불러 팝업을 연다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/lib/ui/settings/MarketDrive.test.ts
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../share/testAxe';
import type { MarketFileRow } from '../../marketData/manifest';
import type { MarketDataInfo, MarketDataStore } from '../../marketData/store';
import type { SyncController, MarketFilesResult } from '../../sync/controller.svelte';
import MarketDrive from './MarketDrive.svelte';

afterEach(cleanup);
const row = (n: number, o: Partial<MarketFileRow> = {}): MarketFileRow => ({
  id: `r${n}`, driveFileId: `FILEID1234${n}`, name: `market-data-2026103${n}.json.gz`, sha256: String(n).repeat(64), size: 3 * 1048576, version: 4,
  collectedAt: `2026-10-3${n}T18:00:00+09:00`, range: { from: '2021-10-31', to: `2026-10-3${n}` }, stocks: 2600, createdAt: 1, updatedAt: 1, ...o,
});
const local = (o: Partial<MarketDataInfo> = {}): MarketDataInfo => ({ collectedAt: '2026-10-30T18:00:00+09:00', stocks: 2600, range: { from: '2021-10-30', to: '2026-10-30' }, ...o });

function setup(o: { files?: MarketFilesResult; account?: unknown; info?: MarketDataInfo | null; token?: any; fetchImpl?: typeof fetch; confirm?: boolean; digest?: (b: Blob) => Promise<string>; preload?: () => Promise<void> } = {}) {
  const marketFiles = vi.fn(async () => o.files ?? { ok: true as const, files: [row(1), row(0)] });
  const wipeMarketFiles = vi.fn(async () => true);
  const sync = { account: o.account === undefined ? { provider: 'google', id: 'me', display: 'me' } : o.account, marketFiles, wipeMarketFiles } as unknown as SyncController;
  const importFile = vi.fn(async () => ({ ok: true as const, info: local({ sha256: row(1).sha256, collectedAt: row(1).collectedAt }) }));
  const onImported = vi.fn();
  const forget = vi.fn();
  const auth = { token: vi.fn(async () => o.token ?? { ok: true, token: 't' }), forget };
  const preload = vi.fn(o.preload ?? (async () => {}));
  const fetchImpl = o.fetchImpl ?? ((async () => new Response(new Uint8Array(3 * 1048576), { status: 200 })) as typeof fetch);
  render(MarketDrive, {
    sync, marketData: { importFile } as unknown as MarketDataStore, localInfo: o.info === undefined ? local() : o.info, onImported, clientId: 'cid',
    fetchImpl, auth, preload, confirmFn: () => o.confirm ?? true, digest: o.digest ?? (async () => row(1).sha256),
  });
  return { marketFiles, wipeMarketFiles, importFile, onImported, auth, preload };
}

describe('MarketDrive', () => {
  it('로그인 전에는 안내만 보이고 목록을 읽지 않는다', async () => {
    const { marketFiles } = setup({ account: null });
    expect(await screen.findByText('동기화에 로그인하면 맥에서 올린 시장 파일을 받을 수 있어요')).toBeTruthy();
    expect(marketFiles).not.toHaveBeenCalled();
  });
  it('새 파일이 있으면 받기 버튼과 크기·종목 수를 보이고 GIS를 미리 부른다', async () => {
    const { preload } = setup();
    expect(await screen.findByText('Drive에 새 파일이 있어요 · 수집 2026-10-31 · 2,600종목 · 3.0 MB')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Drive에서 받기' })).toBeTruthy();
    await waitFor(() => expect(preload).toHaveBeenCalledTimes(1));
    await expectNoAxeViolations(document.body);
  });
  it.each(['Drive에서 받기', 'Drive 보관본 지우기'])('%s: GIS 미리 불러오기 실패 뒤 클릭으로 불러오고 다음 클릭에서 진행한다', async (buttonName) => {
    let finishLoading!: () => void;
    const retry = new Promise<void>((resolve) => { finishLoading = resolve; });
    const preload = vi.fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('gis-load'))
      .mockReturnValueOnce(retry);
    const fetchImpl = (async (_u: string, init?: RequestInit) => init?.method === 'DELETE'
      ? new Response(null, { status: 204 })
      : new Response(new Uint8Array(3 * 1048576), { status: 200 })) as typeof fetch;
    const { auth, importFile, wipeMarketFiles } = setup({ preload, fetchImpl });
    await waitFor(() => expect(preload).toHaveBeenCalledTimes(1));
    auth.token.mockResolvedValueOnce({ ok: false, reason: 'not-ready' });
    const button = await screen.findByRole('button', { name: buttonName });
    await fireEvent.click(button);
    await waitFor(() => expect(preload).toHaveBeenCalledTimes(2));
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(auth.token).toHaveBeenCalledTimes(1);
    expect(importFile).not.toHaveBeenCalled();
    expect(wipeMarketFiles).not.toHaveBeenCalled();
    finishLoading();
    expect((await screen.findByRole('alert')).textContent).toBe('Google 로그인 준비 중이에요. 한 번 더 눌러 주세요');
    const retryButton = await screen.findByRole('button', { name: buttonName });
    expect((retryButton as HTMLButtonElement).disabled).toBe(false);
    expect(auth.token).toHaveBeenCalledTimes(1);
    await fireEvent.click(retryButton);
    await waitFor(() => expect(buttonName === 'Drive에서 받기' ? importFile : wipeMarketFiles).toHaveBeenCalledTimes(1));
    expect(auth.token).toHaveBeenCalledTimes(2);
    expect(preload).toHaveBeenCalledTimes(2);
  });
  it('같은 sha256이면 같다고 보이고 받기 버튼이 없다', async () => {
    setup({ info: local({ sha256: row(1).sha256 }) });
    expect(await screen.findByText('Drive 최신 파일과 같아요 · 수집 2026-10-31')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Drive에서 받기' })).toBeNull();
  });
  it('이 기기에 파일이 없을 때·이 기기가 더 새것일 때 문구', async () => {
    setup({ info: null });
    expect(await screen.findByText('Drive에 시장 파일이 있어요 · 수집 2026-10-31 · 2,600종목 · 3.0 MB')).toBeTruthy();
    cleanup();
    setup({ info: local({ collectedAt: '2026-11-01T18:00:00+09:00', sha256: 'x' }) });
    expect(await screen.findByText('이 기기 파일이 더 새것이에요 · 수집 2026-10-31 · 2,600종목 · 3.0 MB')).toBeTruthy();
  });
  it('비어 있음·옛 서버·오류 문구', async () => {
    setup({ files: { ok: true, files: [] } });
    expect(await screen.findByText('Drive에 올린 시장 파일이 없어요. 맥에서 pnpm collect -- --drive로 올려요')).toBeTruthy();
    cleanup();
    setup({ files: { ok: false, reason: 'outdated' } });
    expect(await screen.findByText('서버 업데이트가 필요해요')).toBeTruthy();
    cleanup();
    setup({ files: { ok: false, reason: 'error' } });
    expect(await screen.findByRole('button', { name: '다시 확인' })).toBeTruthy();
  });
  it('받기를 누르면 토큰을 받고 교체한 뒤 알린다', async () => {
    const { importFile, onImported, auth } = setup();
    await fireEvent.click(await screen.findByRole('button', { name: 'Drive에서 받기' }));
    await waitFor(() => expect(onImported).toHaveBeenCalled());
    expect(auth.token).toHaveBeenCalledTimes(1);
    expect(importFile).toHaveBeenCalledTimes(1);
    expect((await screen.findByRole('status')).textContent).toBe('Drive에서 받았어요');
  });
  it('404면 계정 확인 안내', async () => {
    setup({ fetchImpl: (async () => new Response(null, { status: 404 })) as typeof fetch });
    await fireEvent.click(await screen.findByRole('button', { name: 'Drive에서 받기' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Drive에서 파일을 찾지 못했어요. 맥에서 올린 Google 계정과 같은지 확인해 주세요');
  });
  it('이전 파일 받기는 두 번째 행을 받는다', async () => {
    const { importFile } = setup({ info: local({ sha256: row(1).sha256 }), digest: async () => row(0).sha256 });
    await fireEvent.click(await screen.findByRole('button', { name: '이전 파일 받기' }));
    await waitFor(() => expect(importFile).toHaveBeenCalled());
  });
  it('지우기는 확인 뒤 Drive와 manifest를 비우고 목록을 다시 읽는다', async () => {
    const fetchImpl = (async (_u: string, init?: RequestInit) => (init?.method === 'DELETE' ? new Response(null, { status: 204 }) : new Response(JSON.stringify({ files: [] }), { status: 200 }))) as typeof fetch;
    const { wipeMarketFiles, marketFiles } = setup({ fetchImpl });
    await fireEvent.click(await screen.findByRole('button', { name: 'Drive 보관본 지우기' }));
    await waitFor(() => expect(wipeMarketFiles).toHaveBeenCalled());
    expect((await screen.findByRole('status')).textContent).toBe('Drive 보관본을 지웠어요');
    expect(marketFiles).toHaveBeenCalledTimes(2);
  });
});
```

`MarketDrive`는 테스트용 `digest?: (b: Blob) => Promise<string>` prop도 받아 `fetchFromDrive` deps로 넘긴다(Produces 목록에 더한다).

```ts
// drive-csp.config.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { driveCsp, driveCspPlugin } from './drive-csp.config';
import { kakaoCsp } from './kakao-csp.config';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const directive = (doc: string, name: string) => new RegExp(`${name} ([^;"]*)`).exec(doc)?.[1].trim().split(/\s+/) ?? null;

describe('CSP and Google Identity Services', () => {
  it('클라이언트 ID가 없으면 그대로', () => {
    expect(driveCsp(html, false)).toBe(html);
  });
  it('있으면 script-src에 GIS 스크립트 하나만 더하고 다른 지시어는 그대로', () => {
    const out = driveCsp(html, true);
    expect(directive(out, 'script-src')).toEqual(["'self'", 'https://accounts.google.com/gsi/client']);
    expect(directive(out, 'frame-src')).toBeNull();
    expect(directive(out, 'connect-src')).toEqual(["'self'", 'https:']);
  });
  it('카카오와 함께 쓴다', () => {
    expect(directive(driveCsp(kakaoCsp(html, true), true), 'script-src')).toEqual(["'self'", 'https://accounts.google.com/gsi/client', 'https://t1.kakaocdn.net']);
  });
  it('빌드 변수 VITE_GOOGLE_DRIVE_CLIENT_ID를 읽는다', () => {
    const plugin = driveCspPlugin();
    (plugin.configResolved as (c: unknown) => void)({ env: { VITE_GOOGLE_DRIVE_CLIENT_ID: 'cid' } });
    expect(directive((plugin.transformIndexHtml as (h: string) => string)(html), 'script-src')).toContain('https://accounts.google.com/gsi/client');
  });
});
```

`vitest.config.ts`의 기존 `test.include` 배열에 `'drive-csp.config.test.ts'`를 더한다. 루트 설정 테스트는 개별 파일로 등록하므로 Step 2의 실행 전에 포함해야 CSP 테스트가 실제로 실행된다. 기존 항목은 유지한다.

`tsconfig.json`의 기존 `include` 배열에 `"drive-csp.config.ts"`, `"drive-csp.config.test.ts"`를 더한다. 기존 카카오 CSP 파일처럼 `pnpm check`의 검사 대상에 포함한다.

`DataTools.test.ts`에: `sync`가 없거나 `driveClientId`가 없으면 `Drive에서 받기` 영역이 없다는 테스트 한 개(`screen.queryByText(/Drive/)`가 null).

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run src/lib/ui/settings drive-csp.config.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

```ts
// drive-csp.config.ts
// Google Identity Services 토큰 모델의 CSP(설계 D9). 토큰 모델은 팝업이라 script-src만 더한다.
// frame-src·style-src는 One Tap·로그인 버튼용이라 넣지 않는다. connect-src는 이미 https:를 허용한다.
import type { Plugin } from 'vite';

export const DRIVE_SCRIPT_SOURCES = ['https://accounts.google.com/gsi/client'];

export function driveCsp(html: string, enabled: boolean): string {
  if (!enabled) return html;
  const script = "script-src 'self'";
  if (!html.includes(script)) throw new Error(`index.html CSP has no "${script}"`);
  return html.replace(script, `${script} ${DRIVE_SCRIPT_SOURCES.join(' ')}`);
}

export function driveCspPlugin(): Plugin {
  let enabled = false;
  return {
    name: 'gazua-drive-csp',
    configResolved(c) {
      const v = c.env.VITE_GOOGLE_DRIVE_CLIENT_ID;
      enabled = typeof v === 'string' && v.trim() !== '';
    },
    transformIndexHtml: (html) => driveCsp(html, enabled),
  };
}
```

`vite.config.ts`: `import { driveCspPlugin } from './drive-csp.config';`, plugins 배열에서 `kakaoCspPlugin()` 앞에 `driveCspPlugin()`.

`.github/workflows/deploy.yml`: `pnpm build` 단계의 기존 `env`에 다음 항목을 더한다. spec 12-4의 공개 client ID는 저장소 Actions Variables에 설정하며, 워크플로가 이를 빌드 환경변수로 전달해야 Drive 영역과 CSP가 활성화된다. 값이 비면 기존 설계대로 Drive 기능이 꺼진다.

```yaml
          VITE_GOOGLE_DRIVE_CLIENT_ID: ${{ vars.VITE_GOOGLE_DRIVE_CLIENT_ID }}
```

`MarketDrive.svelte`(DataTools의 `.row`·`.btn` 스타일을 그대로 복사해 쓴다):

```svelte
<script lang="ts">
  // 시장 파일 Drive 전달(설계 2026-11-02-market-drive 8.3). 맥에서 올린 파일을 받기만 한다.
  import { untrack } from 'svelte';
  import { fetchFromDrive, wipeDrive, type DriveOutcome } from '../../marketData/driveSync';
  import { createDriveAuth, loadGis, type DriveAuth } from '../../marketData/gis';
  import type { MarketFileRow } from '../../marketData/manifest';
  import type { ImportDeps, MarketDataInfo, MarketDataStore } from '../../marketData/store';
  import type { SyncController } from '../../sync/controller.svelte';

  let {
    sync, marketData, localInfo, onImported, clientId,
    fetchImpl = (...a: Parameters<typeof fetch>) => fetch(...a),
    auth = createDriveAuth(clientId),
    importDeps, preload = () => loadGis(), confirmFn = (m: string) => confirm(m), digest,
  }: {
    sync: SyncController; marketData: MarketDataStore; localInfo: MarketDataInfo | null; onImported: (info: MarketDataInfo) => void; clientId: string;
    fetchImpl?: typeof fetch; auth?: DriveAuth; importDeps?: ImportDeps; preload?: () => Promise<void>; confirmFn?: (m: string) => boolean; digest?: (b: Blob) => Promise<string>;
  } = $props();

  type View = { kind: 'loading' } | { kind: 'outdated' } | { kind: 'error' } | { kind: 'files'; files: MarketFileRow[] };
  let view = $state<View>({ kind: 'loading' });
  let busy = $state(false);
  let progress = $state<number | null>(null);
  let note = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);
  let preloaded = false;

  const FAIL: Record<string, string> = {
    denied: 'Google에서 Drive 권한을 허용해야 받을 수 있어요',
    'not-ready': 'Google 로그인 준비 중이에요. 한 번 더 눌러 주세요',
    'not-found': 'Drive에서 파일을 찾지 못했어요. 맥에서 올린 Google 계정과 같은지 확인해 주세요',
    mismatch: '받은 파일이 손상됐어요. 다시 받아 주세요',
    auth: 'Google 로그인이 끝났어요. 다시 눌러 주세요',
    quota: 'Drive 요청 한도에 걸렸어요. 잠시 뒤 다시 시도해 주세요',
    offline: 'Drive에 연결할 수 없어요',
    'version-newer': '앱보다 새 형식의 파일이에요. 앱을 새로 고쳐 주세요',
    format: '시장 데이터 파일 형식이 아니에요',
    corrupt: '시장 데이터 파일 형식이 아니에요',
    server: 'Drive 목록을 비우지 못했어요',
  };
  const failText = (o: { reason: string; neededMb?: number }) =>
    o.reason === 'quota-device' ? `기기 공간이 부족해요(약 ${o.neededMb ?? '?'} MB 필요)` : (FAIL[o.reason] ?? 'Drive에서 받지 못했어요');

  async function load() {
    if (!sync.account) return;
    view = { kind: 'loading' };
    const r = await sync.marketFiles();
    view = r.ok ? { kind: 'files', files: r.files } : r.reason === 'outdated' ? { kind: 'outdated' } : { kind: 'error' };
  }
  $effect(() => {
    if (sync.account) untrack(() => void load());
  });
  $effect(() => {
    if (!preloaded && view.kind === 'files' && view.files.length > 0) {
      preloaded = true;
      preload().catch(() => {});
    }
  });

  const day = (iso: string) => iso.slice(0, 10);
  const mb = (n: number) => (n / 1048576).toFixed(1);
  const detail = (f: MarketFileRow) => `수집 ${day(f.collectedAt)} · ${f.stocks.toLocaleString('ko-KR')}종목 · ${mb(f.size)} MB`;
  function headline(latest: MarketFileRow): string {
    if (!localInfo) return `Drive에 시장 파일이 있어요 · ${detail(latest)}`;
    if (localInfo.sha256 === latest.sha256) return `Drive 최신 파일과 같아요 · 수집 ${day(latest.collectedAt)}`;
    if (Date.parse(localInfo.collectedAt) > Date.parse(latest.collectedAt)) return `이 기기 파일이 더 새것이에요 · ${detail(latest)}`;
    return `Drive에 새 파일이 있어요 · ${detail(latest)}`;
  }

  // 클릭 처리기에서 await 전에 fetchFromDrive를 불러야 팝업이 막히지 않는다
  function receive(row: MarketFileRow) {
    if (busy) return;
    busy = true;
    note = null;
    progress = null;
    fetchFromDrive(row, { fetch: fetchImpl, auth, store: marketData, importDeps, digest }, (done, total) => {
      progress = total ? Math.floor((done / total) * 100) : null;
    }).then(async (r: DriveOutcome) => {
      if (!r.ok && r.reason === 'not-ready') await preload().catch(() => {});
      busy = false;
      if (r.ok) {
        onImported(r.info);
        note = { kind: 'ok', text: 'Drive에서 받았어요' };
      } else if (r.reason !== 'cancelled') note = { kind: 'error', text: failText(r) };
    }).catch(() => {
      // importFile은 용량 초과가 아닌 쓰기 오류를 다시 던진다. 받는 중 상태에 멈추지 않게 푼다
      busy = false;
      note = { kind: 'error', text: 'Drive에서 받지 못했어요' };
    });
  }

  function wipe() {
    if (busy || view.kind !== 'files') return;
    if (!confirmFn('Drive의 시장 파일을 모두 지울까요? 이 기기의 시장 데이터는 남아요.')) return;
    busy = true;
    note = null;
    wipeDrive(view.files, { fetch: fetchImpl, auth, store: marketData, wipeManifest: () => sync.wipeMarketFiles() }).then(async (r) => {
      if (!r.ok && r.reason === 'not-ready') await preload().catch(() => {});
      busy = false;
      if (r.ok) note = { kind: 'ok', text: 'Drive 보관본을 지웠어요' };
      else if (r.reason !== 'cancelled') note = { kind: 'error', text: failText(r) };
      await load();
    }).catch(() => {
      busy = false;
      note = { kind: 'error', text: 'Drive 목록을 비우지 못했어요' };
    });
  }
</script>

<div class="row col" role="group" aria-label="Drive 전달">
  <div class="text">
    <b>Drive 전달</b>
    {#if !sync.account}
      <p>동기화에 로그인하면 맥에서 올린 시장 파일을 받을 수 있어요</p>
    {:else if view.kind === 'loading'}
      <p>Drive 목록을 확인하는 중…</p>
    {:else if view.kind === 'outdated'}
      <p>서버 업데이트가 필요해요</p>
    {:else if view.kind === 'error'}
      <p>Drive 목록을 확인하지 못했어요</p>
    {:else if view.files.length === 0}
      <p>Drive에 올린 시장 파일이 없어요. 맥에서 pnpm collect -- --drive로 올려요</p>
    {:else}
      <p class="num">{busy && progress !== null ? `받는 중… ${progress}%` : busy ? '받는 중…' : headline(view.files[0])}</p>
    {/if}
  </div>
  {#if sync.account && view.kind === 'error'}
    <button type="button" class="btn" onclick={load}>다시 확인</button>
  {/if}
  {#if sync.account && view.kind === 'files' && view.files.length > 0}
    <div class="line">
      {#if localInfo?.sha256 !== view.files[0].sha256}
        <button type="button" class="btn primary" disabled={busy} onclick={() => view.kind === 'files' && receive(view.files[0])}>Drive에서 받기</button>
      {/if}
      <button type="button" class="btn" disabled={busy} onclick={wipe}>Drive 보관본 지우기</button>
    </div>
    {#if view.files[1]}
      {@const prev = view.files[1]}
      <details>
        <summary>이전 파일</summary>
        <p class="num">수집 {day(prev.collectedAt)} · {prev.stocks.toLocaleString('ko-KR')}종목</p>
        <button type="button" class="btn" disabled={busy} onclick={() => receive(prev)}>이전 파일 받기</button>
      </details>
    {/if}
  {/if}
  {#if note}
    <p class={note.kind === 'error' ? 'warn' : 'done'} role={note.kind === 'error' ? 'alert' : 'status'}>{note.text}</p>
  {/if}
</div>
```

`DataTools.svelte`: props에 `sync?: SyncController`, `driveClientId = readDriveClientId()`를 더하고, 「시장 데이터」 `.row` 바로 뒤에

```svelte
  {#if sync && driveClientId}
    <MarketDrive {sync} {marketData} localInfo={marketInfo} onImported={(i) => (marketInfo = i)} clientId={driveClientId} />
  {/if}
```

`Settings.svelte` 128행: `<DataTools {app} {sync} />`.

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run src/lib/ui/settings drive-csp.config.test.ts kakao-csp.config.test.ts && pnpm check`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/ui/settings/MarketDrive.svelte src/lib/ui/settings/MarketDrive.test.ts src/lib/ui/settings/DataTools.svelte src/lib/ui/settings/DataTools.test.ts src/routes/Settings.svelte drive-csp.config.ts drive-csp.config.test.ts vite.config.ts vitest.config.ts tsconfig.json .github/workflows/deploy.yml
git commit -m "feat(settings): 설정 › 데이터에 Drive에서 시장 파일 받기와 보관본 지우기를 더함"
```

---

### Task 8: CLI 공통(오류 코드·인자·저장 파일·동기화 클라이언트)

**Files:**
- Modify: `cli/src/errors.ts`, `cli/src/args.ts`, `cli/src/config.ts`, `cli/src/syncClient.ts`, `cli/src/main.ts:30`
- Test: `cli/src/errors.test.ts`, `cli/src/args.test.ts`(없으면 `main.test.ts`의 인자 테스트 자리), `cli/src/config.test.ts`, `cli/src/syncClient.test.ts`

**Interfaces:**
- Consumes: Task 1 `MarketFileBody`, `MarketFileRow`, `checkMarketFiles`
- Produces:
  - `MESSAGES`에 새 코드 8개(아래 문구 그대로)
  - `Args.keep?: number`(`--keep`, 1~5 정수, 아니면 `invalid-args` `--keep은 1~5 사이 정수예요`)
  - `driveAuthPath(dir)`, `readDriveAuth(dir): { auth: AuthFile | null; warnings: string[] }`, `writeDriveAuth(dir, auth)`, `removeDriveAuth(dir): boolean`
  - `interface DriveTokenFile { v: 1; clientId: string; refreshToken: string; createdAt: number }`, `readDriveToken(dir): DriveTokenFile | null`, `writeDriveToken(dir, t)`, `removeDriveToken(dir): boolean`
  - `SyncClient.device(label: string, scope?: 'market-upload')`, `PollResult` 토큰 분기에 `scope?: string`
  - `SyncClient.marketFiles(): Promise<MarketFileRow[]>`, `SyncClient.registerMarketFile(b: MarketFileBody): Promise<MarketFileRow>`, `SyncClient.deleteMarketFile(id: string): Promise<void>`
  - `SECRET_ENV`에 `'GAZUA_DRIVE_CLIENT_SECRET'`

새 오류 문구:

```ts
  'drive-not-configured': 'Drive 설정이 없어요. GAZUA_DRIVE_CLIENT_ID·GAZUA_DRIVE_CLIENT_SECRET를 알려 주세요',
  'drive-login-required': 'Drive 로그인이 필요해요. gazua drive login을 실행해 주세요',
  'drive-login-timeout': 'Google 로그인을 기다리다 시간이 지났어요(5분). gazua drive login을 다시 실행해 주세요',
  'drive-denied': 'Google에서 Drive 권한을 허용하지 않았어요',
  'drive-quota': 'Drive 공간이나 요청 한도에 걸렸어요. 잠시 뒤 다시 시도해 주세요',
  'drive-failed': 'Drive 요청이 실패했어요',
  'market-file-invalid': '올릴 수 없는 시장 파일이에요',
  'market-limit': 'Drive 보관본이 서버 한도(10개)에 찼어요. 앱 설정 › 데이터의 「Drive 보관본 지우기」로 비운 뒤 다시 올려 주세요',
```

- [ ] **Step 1: 실패하는 테스트 작성**

`syncClient.test.ts`에(기존 `fakeFetch` 사용):

```ts
it('device에 scope를 주면 본문에 넣고, 토큰 응답의 scope를 돌려준다', async () => {
  const f = fakeFetch((c) => (c.url.pathname === '/v1/cli/device'
    ? { body: { deviceCode: 'd', userCode: 'BCDF-GHJK', verifyUrl: 'u', interval: 5, expiresIn: 600 } }
    : { body: { token: 'gzc_x', tokenId: 'id', expiresAt: 9, scope: 'market-upload' } }));
  const c = createSyncClient({ server: 'https://s.test', fetchImpl: f });
  await c.device('gazua-drive@mac', 'market-upload');
  expect(f.calls[0].body).toEqual({ label: 'gazua-drive@mac', scope: 'market-upload' });
  expect(await c.token('d')).toEqual({ kind: 'token', token: 'gzc_x', tokenId: 'id', expiresAt: 9, scope: 'market-upload' });
  await c.device('gazua@mac');
  expect(f.calls[2].body).toEqual({ label: 'gazua@mac' });
});
it('market 메서드: 목록 검사, 등록, 삭제, 429 market-limit, 422 market-file-invalid', async () => {
  const row = { id: 'r1', driveFileId: 'drive-file-0001', name: 'market-data-20261031.json.gz', sha256: 'a'.repeat(64), size: 1, version: 4, collectedAt: '2026-10-31T18:00:00+09:00', range: { from: '2021-10-31', to: '2026-10-31' }, stocks: 1, createdAt: 1, updatedAt: 1 };
  let mode = 'ok';
  const f = fakeFetch((c) => {
    if (c.method === 'GET') return { body: { files: [row] } };
    if (c.method === 'DELETE') return { body: { deleted: true } };
    if (mode === 'limit') return { status: 429, body: { error: 'market-limit' } };
    if (mode === 'bad') return { status: 422, body: { error: 'invalid', path: 'name' } };
    return { body: row };
  });
  const c = createSyncClient({ server: 'https://s.test', token: 'gzc_t', fetchImpl: f });
  expect(await c.marketFiles()).toEqual([row]);
  const { id, createdAt, updatedAt, ...body } = row;
  expect(await c.registerMarketFile(body)).toEqual(row);
  await c.deleteMarketFile('r1');
  expect(f.calls.at(-1)?.url.pathname).toBe('/v1/market/files/r1');
  mode = 'limit';
  await expect(c.registerMarketFile(body)).rejects.toMatchObject({ code: 'market-limit' });
  mode = 'bad';
  await expect(c.registerMarketFile(body)).rejects.toMatchObject({ code: 'market-file-invalid' });
});
```

`syncClient.test.ts`에 회귀 검증을 더한다. `fakeFetch`로 `/v1/market/files`에 HTTP 500을 돌려주고 `marketFiles()`가 `{ code: 'drive-failed' }`로 실패하는지 확인한다(spec 9절, 0006 미적용). 같은 500을 기존 `profiles()`에 돌려주면 `{ code: 'internal' }`을 유지하는지도 확인한다.

`config.test.ts`에: `writeDriveToken` → 파일 모드 600, `readDriveToken`이 같은 값, 모양이 틀리면 null, `removeDriveToken` true/false. `writeDriveAuth`/`readDriveAuth`가 `drive-auth.json`을 쓰고 `auth.json`과 섞이지 않는다.

`args` 테스트에: `--keep 3` → `keep: 3`, `--keep 0`·`--keep 6`·`--keep x` → `invalid-args`.

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter gazua-cli test`
Expected: FAIL

- [ ] **Step 3: 구현**

`errors.ts`: 위 8개를 `MESSAGES`의 `internal` 앞에 더한다.

`args.ts`: `Args`에 `keep?: number`, `options`에 `keep: { type: 'string' }`, 검사:

```ts
  const keepRaw = v.keep as string | undefined;
  let keep: number | undefined;
  if (keepRaw !== undefined) {
    keep = Number(keepRaw);
    if (!Number.isInteger(keep) || keep < 1 || keep > 5) throw bad('--keep은 1~5 사이 정수예요');
  }
  // 반환 객체에 ...(keep !== undefined && { keep }),
```

`config.ts`:

```ts
export const driveAuthPath = (dir: string): string => join(dir, 'drive-auth.json');
export const driveTokenPath = (dir: string): string => join(dir, 'drive.json');

function readAuthAt(dir: string, file: string): { auth: AuthFile | null; warnings: string[] } {
  const raw = readJsonFile<Partial<AuthFile>>(join(dir, file));
  const valid =
    raw !== null && raw.v === 1 && typeof raw.server === 'string' && typeof raw.token === 'string' && typeof raw.tokenId === 'string' && typeof raw.label === 'string' && typeof raw.expiresAt === 'number';
  return { auth: valid ? (raw as AuthFile) : null, warnings: permissionWarnings(dir, [file]) };
}
export const readAuth = (dir: string) => readAuthAt(dir, 'auth.json');
export const readDriveAuth = (dir: string) => readAuthAt(dir, 'drive-auth.json');
export const writeDriveAuth = (dir: string, auth: AuthFile): void => writeJsonFile(driveAuthPath(dir), auth);
function removeAt(path: string): boolean {
  if (!existsSync(path)) return false;
  rmSync(path, { force: true });
  return true;
}
export const removeDriveAuth = (dir: string): boolean => removeAt(driveAuthPath(dir));

export interface DriveTokenFile {
  v: 1;
  clientId: string;
  refreshToken: string;
  createdAt: number;
}
export function readDriveToken(dir: string): DriveTokenFile | null {
  const raw = readJsonFile<Partial<DriveTokenFile>>(driveTokenPath(dir));
  return raw !== null && raw.v === 1 && typeof raw.clientId === 'string' && typeof raw.refreshToken === 'string' && typeof raw.createdAt === 'number' ? (raw as DriveTokenFile) : null;
}
export const writeDriveToken = (dir: string, t: DriveTokenFile): void => writeJsonFile(driveTokenPath(dir), t);
export const removeDriveToken = (dir: string): boolean => removeAt(driveTokenPath(dir));
```

(기존 `readAuth`·`removeAuth`는 위 도우미로 바꿔도 동작이 같아야 한다.)

`syncClient.ts`:

```ts
import { checkMarketFiles, type MarketFileBody, type MarketFileRow } from '../../src/lib/marketData/manifest';
export type PollResult = { kind: 'token'; token: string; tokenId: string; expiresAt: number; scope?: string } | { kind: 'pending' } | { kind: 'slow_down' };
// SyncClient에
  device(label: string, scope?: 'market-upload'): Promise<DeviceGrant>;
  marketFiles(): Promise<MarketFileRow[]>;
  registerMarketFile(b: MarketFileBody): Promise<MarketFileRow>;
  deleteMarketFile(id: string): Promise<void>;
// Where에 'market' 추가. failFrom의 code 선언 뒤, 기존 상태 분기 앞에
  if (where === 'market' && status === 500) return new CliError('drive-failed');
  if (where === 'market' && status === 429 && code === 'market-limit') return new CliError('market-limit');
  if (where === 'market' && status === 422) return new CliError('market-file-invalid', `서버가 시장 파일 정보를 받지 않았어요(${typeof body.path === 'string' ? body.path : code || '422'})`);
// 구현
    async device(label, scope) {
      const b = await must('device', 'POST', '/v1/cli/device', scope ? { label, scope } : { label });
      // …기존 검사 그대로
    },
    // token: 반환에 ...(typeof b.scope === 'string' && { scope: b.scope })
    async marketFiles() {
      const files = checkMarketFiles((await must('market', 'GET', '/v1/market/files')).files);
      if (!files) throw internal();
      return files;
    },
    async registerMarketFile(body) {
      const b = await must('market', 'POST', '/v1/market/files', body);
      const [row] = checkMarketFiles([b]) ?? [];
      if (!row) throw internal();
      return row;
    },
    async deleteMarketFile(id) {
      await must('market', 'DELETE', `/v1/market/files/${encodeURIComponent(id)}`);
    },
```

404(`where === 'market'`)는 기존 규칙대로 `server-outdated`가 된다. 500은 spec 9절에 따라 `drive-failed`로 매핑한다(0006 미적용 포함). 다른 요청의 기존 오류 매핑은 유지한다.

`main.ts`: `SECRET_ENV`에 `'GAZUA_DRIVE_CLIENT_SECRET'`.

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter gazua-cli test && pnpm --filter gazua-cli check`
Expected: `readme.test.ts`의 「모든 오류 코드가 표에 있다」만 FAIL. `cli/README.md` 오류 코드 표에 새 8개 코드 행을 더해(문구는 MESSAGES와 같게) 다시 돌려 PASS.

- [ ] **Step 5: 커밋**

```bash
git add cli/src cli/README.md
git commit -m "feat(cli): Drive 오류 코드·--keep·Drive 저장 파일과 manifest 동기화 클라이언트를 더함"
```

---

### Task 9: CLI Google 로그인(루프백)·토큰 갱신·철회

**Files:**
- Create: `cli/src/googleAuth.ts`, `cli/src/googleAuth.test.ts`

**Interfaces:**
- Consumes: Task 8 오류 코드, `Ctx`
- Produces:
  - `DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata'`
  - `interface DriveClient { clientId: string; clientSecret: string; port: number }`
  - `driveClientFrom(env: Record<string, string | undefined>): DriveClient` (없으면 `drive-not-configured`, 포트는 1024~65535 정수 아니면 `invalid-args`)
  - `redirectUri(c: DriveClient): string` → `http://127.0.0.1:<port>/`
  - `type WaitForCallback = (port: number, timeoutMs: number) => Promise<URLSearchParams | null>` (null = 시간 초과)
  - `googleLogin(ctx: Ctx, c: DriveClient, wait?: WaitForCallback): Promise<string>` (갱신 토큰)
  - `refreshAccess(ctx: Ctx, c: DriveClient, refreshToken: string): Promise<string>` (접근 토큰)
  - `revokeGoogle(ctx: Ctx, token: string): Promise<boolean>`
  - `listenOnce: WaitForCallback` (기본 구현, `node:http`)

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// cli/src/googleAuth.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import { DRIVE_SCOPE, driveClientFrom, googleLogin, refreshAccess, revokeGoogle } from './googleAuth';
import { cleanupDirs, fakeFetch, makeIo } from './testing';
import type { Ctx } from './context';
import { createRedactor } from './output';
import { parseArgv } from './args';

afterEach(cleanupDirs);
const env = { GAZUA_DRIVE_CLIENT_ID: 'cid.apps.googleusercontent.com', GAZUA_DRIVE_CLIENT_SECRET: 'csecret' };
function ctxWith(fetchImpl: typeof fetch) {
  const { io, err } = makeIo({ env, fetch: fetchImpl });
  const said: string[] = [];
  const ctx: Ctx = {
    args: parseArgv(['drive', 'login']), env: io.env, fetch: io.fetch, now: io.now, sleep: io.sleep, hostname: io.hostname, dir: io.dir!,
    say: (l) => said.push(l), log: () => {}, warn: () => {}, redact: createRedactor(),
  };
  return { ctx, said, err };
}

describe('driveClientFrom', () => {
  it('두 값이 없으면 drive-not-configured, 포트 기본 53682', () => {
    expect(() => driveClientFrom({})).toThrow(expect.objectContaining({ code: 'drive-not-configured' }));
    expect(driveClientFrom(env)).toEqual({ clientId: env.GAZUA_DRIVE_CLIENT_ID, clientSecret: 'csecret', port: 53682 });
    expect(() => driveClientFrom({ ...env, GAZUA_DRIVE_PORT: '80' })).toThrow(expect.objectContaining({ code: 'invalid-args' }));
  });
});

describe('googleLogin', () => {
  it('state·PKCE로 코드를 받아 교환하고 갱신 토큰을 돌려준다', async () => {
    let authUrl: URL | null = null;
    const f = fakeFetch((c) => {
      expect(c.url.toString()).toBe('https://oauth2.googleapis.com/token');
      const p = new URLSearchParams(c.body as string);
      expect(p.get('grant_type')).toBe('authorization_code');
      expect(p.get('code')).toBe('the-code');
      expect(p.get('redirect_uri')).toBe('http://127.0.0.1:53682/');
      expect(p.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43}$/);
      return { body: { access_token: 'a', refresh_token: 'r-token', scope: DRIVE_SCOPE } };
    });
    const { ctx, said } = ctxWith(f);
    const rt = await googleLogin(ctx, driveClientFrom(env), async (port) => {
      expect(port).toBe(53682);
      authUrl = new URL(said.find((l) => l.startsWith('https://accounts.google.com/'))!);
      return new URLSearchParams({ code: 'the-code', state: authUrl.searchParams.get('state')! });
    });
    expect(rt).toBe('r-token');
    expect(authUrl!.searchParams.get('scope')).toBe(DRIVE_SCOPE);
    expect(authUrl!.searchParams.get('access_type')).toBe('offline');
    expect(authUrl!.searchParams.get('code_challenge_method')).toBe('S256');
    expect(ctx.redact.apply('r-token csecret')).not.toContain('r-token');
  });
  it('state가 다르거나 error면 drive-denied, 시간 초과는 drive-login-timeout', async () => {
    const { ctx } = ctxWith(fakeFetch(() => undefined));
    await expect(googleLogin(ctx, driveClientFrom(env), async () => new URLSearchParams({ code: 'c', state: 'wrong' }))).rejects.toMatchObject({ code: 'drive-denied' });
    await expect(googleLogin(ctx, driveClientFrom(env), async () => new URLSearchParams({ error: 'access_denied' }))).rejects.toMatchObject({ code: 'drive-denied' });
    await expect(googleLogin(ctx, driveClientFrom(env), async () => null)).rejects.toMatchObject({ code: 'drive-login-timeout' });
  });
  it('refresh_token이 없거나 범위가 없으면 drive-denied', async () => {
    for (const body of [{ access_token: 'a', scope: DRIVE_SCOPE }, { access_token: 'a', refresh_token: 'r', scope: 'openid' }]) {
      const { ctx, said } = ctxWith(fakeFetch(() => ({ body })));
      await expect(
        googleLogin(ctx, driveClientFrom(env), async () => new URLSearchParams({ code: 'c', state: new URL(said.find((l) => l.startsWith('https://'))!).searchParams.get('state')! })),
      ).rejects.toMatchObject({ code: 'drive-denied' });
    }
  });
});

describe('refreshAccess·revokeGoogle', () => {
  it('갱신 성공·invalid_grant는 drive-login-required·그 밖은 drive-failed', async () => {
    const ok = ctxWith(fakeFetch(() => ({ body: { access_token: 'acc', expires_in: 3599 } })));
    expect(await refreshAccess(ok.ctx, driveClientFrom(env), 'r')).toBe('acc');
    const bad = ctxWith(fakeFetch(() => ({ status: 400, body: { error: 'invalid_grant' } })));
    await expect(refreshAccess(bad.ctx, driveClientFrom(env), 'r')).rejects.toMatchObject({ code: 'drive-login-required' });
    const down = ctxWith(fakeFetch(() => ({ status: 500, body: {} })));
    await expect(refreshAccess(down.ctx, driveClientFrom(env), 'r')).rejects.toMatchObject({ code: 'drive-failed' });
  });
  it('철회는 성공·실패를 불리언으로', async () => {
    expect(await revokeGoogle(ctxWith(fakeFetch(() => ({ body: {} }))).ctx, 'r')).toBe(true);
    expect(await revokeGoogle(ctxWith(fakeFetch(() => ({ status: 400, body: {} }))).ctx, 'r')).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter gazua-cli test -- googleAuth`
Expected: FAIL

- [ ] **Step 3: 구현**

```ts
// cli/src/googleAuth.ts
// Google OAuth(웹 클라이언트, 루프백 리디렉션 + PKCE + 클라이언트 시크릿)로 drive.appdata 갱신 토큰을 받는다(설계 6.3).
// 시크릿·코드·토큰은 출력 거르기에 넣고 파일에는 갱신 토큰만 둔다(config.ts writeDriveToken).
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { Ctx } from './context';
import { CliError } from './errors';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 15_000;

export interface DriveClient {
  clientId: string;
  clientSecret: string;
  port: number;
}
export type WaitForCallback = (port: number, timeoutMs: number) => Promise<URLSearchParams | null>;

export function driveClientFrom(env: Record<string, string | undefined>): DriveClient {
  const clientId = env.GAZUA_DRIVE_CLIENT_ID?.trim() ?? '';
  const clientSecret = env.GAZUA_DRIVE_CLIENT_SECRET?.trim() ?? '';
  if (!clientId || !clientSecret) throw new CliError('drive-not-configured');
  const raw = env.GAZUA_DRIVE_PORT?.trim();
  const port = raw ? Number(raw) : 53682;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new CliError('invalid-args', 'GAZUA_DRIVE_PORT는 1024~65535 사이 정수예요');
  return { clientId, clientSecret, port };
}

export const redirectUri = (c: DriveClient): string => `http://127.0.0.1:${c.port}/`;
const b64url = (b: Buffer) => b.toString('base64url');

/** 127.0.0.1:<port>에서 첫 요청 하나만 받는다. 시간이 지나면 null */
export const listenOnce: WaitForCallback = (port, timeoutMs) =>
  new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const params = new URL(req.url ?? '/', `http://127.0.0.1:${port}`).searchParams;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('<!doctype html><meta charset="utf-8"><title>gazua</title><p>터미널로 돌아가세요</p>');
      clearTimeout(timer);
      server.close();
      resolve(params);
    });
    const timer = setTimeout(() => {
      server.close();
      resolve(null);
    }, timeoutMs);
    server.on('error', (e) => {
      clearTimeout(timer);
      reject(new CliError('invalid-args', `127.0.0.1:${port}를 열 수 없어요(${(e as NodeJS.ErrnoException).code ?? 'error'})`));
    });
    server.listen(port, '127.0.0.1');
  });

async function postForm(ctx: Ctx, url: string, form: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    const res = await ctx.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, body: typeof body === 'object' && body !== null ? body : {} };
  } catch {
    throw new CliError('network');
  }
}

export async function googleLogin(ctx: Ctx, c: DriveClient, wait: WaitForCallback = listenOnce): Promise<string> {
  ctx.redact.add(c.clientSecret);
  const state = b64url(randomBytes(32));
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const u = new URL(AUTH_URL);
  for (const [k, v] of Object.entries({
    response_type: 'code', client_id: c.clientId, redirect_uri: redirectUri(c), scope: DRIVE_SCOPE,
    access_type: 'offline', prompt: 'consent', code_challenge: challenge, code_challenge_method: 'S256', state,
  })) u.searchParams.set(k, v);
  ctx.say('브라우저에서 아래 주소를 열어 Google 계정으로 Drive 앱 데이터 접근을 허락해 주세요(5분)');
  ctx.say(u.toString());
  const params = await wait(c.port, LOGIN_TIMEOUT_MS);
  if (params === null) throw new CliError('drive-login-timeout');
  const code = params.get('code');
  if (params.get('error') || params.get('state') !== state || !code) throw new CliError('drive-denied');
  ctx.redact.add(code);
  const r = await postForm(ctx, TOKEN_URL, {
    grant_type: 'authorization_code', code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: redirectUri(c), code_verifier: verifier,
  });
  const rt = r.body.refresh_token;
  if (typeof r.body.access_token === 'string') ctx.redact.add(r.body.access_token);
  if (r.status !== 200) throw new CliError('drive-failed');
  // 동의 화면에서 범위를 빼고 허락했거나 갱신 토큰을 주지 않았다
  if (typeof rt !== 'string' || !String(r.body.scope ?? '').split(' ').includes(DRIVE_SCOPE)) throw new CliError('drive-denied');
  ctx.redact.add(rt);
  return rt;
}

export async function refreshAccess(ctx: Ctx, c: DriveClient, refreshToken: string): Promise<string> {
  ctx.redact.add(c.clientSecret);
  ctx.redact.add(refreshToken);
  const r = await postForm(ctx, TOKEN_URL, { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: c.clientId, client_secret: c.clientSecret });
  if (r.status === 400 && r.body.error === 'invalid_grant') throw new CliError('drive-login-required');
  if (r.status !== 200 || typeof r.body.access_token !== 'string') throw new CliError('drive-failed');
  ctx.redact.add(r.body.access_token);
  return r.body.access_token;
}

export async function revokeGoogle(ctx: Ctx, token: string): Promise<boolean> {
  ctx.redact.add(token);
  try {
    return (await postForm(ctx, REVOKE_URL, { token })).status === 200;
  } catch {
    return false;
  }
}
```


- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter gazua-cli test && pnpm --filter gazua-cli check`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add cli/src/googleAuth.ts cli/src/googleAuth.test.ts
git commit -m "feat(cli): Google 루프백 로그인(PKCE)과 Drive 접근 토큰 갱신·철회를 더함"
```

---

### Task 10: CLI Drive REST와 시장 파일 읽기

**Files:**
- Create: `cli/src/driveApi.ts`, `cli/src/driveApi.test.ts`, `cli/src/marketFile.ts`, `cli/src/marketFile.test.ts`

**Interfaces:**
- Consumes: Task 1 `checkMarketMeta`, `MARKET_FILE_MAX_BYTES`, `MarketFileMeta`; `validateMarketData`(`src/lib/marketData/format.ts`); Task 8 오류 코드
- Produces:
  - `interface DriveFileInfo { id: string; md5Checksum?: string; size?: string; trashed?: boolean; createdTime?: string }`
  - `interface DriveApi { get(id: string): Promise<DriveFileInfo | null>; upload(meta: { name: string; sha256: string }, bytes: Uint8Array): Promise<DriveFileInfo>; remove(id: string): Promise<void>; listMarket(): Promise<DriveFileInfo[]> }`
  - `createDriveApi(ctx: Ctx, token: (force?: boolean) => Promise<string>): DriveApi`
  - `interface LocalMarketFile { bytes: Uint8Array; md5: string; meta: MarketFileMeta }`
  - `readMarketFile(path: string): LocalMarketFile` (실패는 `market-file-invalid`, 메시지에 이유)

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// cli/src/marketFile.test.ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { readMarketFile } from './marketFile';
import { cleanupDirs, tempDir } from './testing';

afterEach(cleanupDirs);
export const tinyMarket = (o: Record<string, unknown> = {}) => ({
  format: 'gazua-market-data', version: 1, collectedAt: '2026-10-31T18:00:00+09:00', source: 'kis', adjusted: true,
  range: { from: '2026-10-30', to: '2026-10-31' }, sectors: [],
  stocks: [{ s: '005930', n: '삼성전자', m: 'KOSPI', t: 'STOCK', sec: ['', '', ''], shares: 1, managed: false, halted: false, d: ['20261030', '20261031'], o: [1, 1], h: [1, 1], l: [1, 1], c: [1, 1], v: [1, 1], tv: [1, 1] }],
  indices: [], ...o,
});
const write = (name: string, data: unknown) => {
  const p = join(tempDir(), name);
  writeFileSync(p, gzipSync(Buffer.from(JSON.stringify(data))));
  return p;
};

describe('readMarketFile', () => {
  it('해시·크기·메타를 만든다', () => {
    const p = write('market-data-20261031.json.gz', tinyMarket());
    const f = readMarketFile(p);
    expect(f.meta).toMatchObject({ name: 'market-data-20261031.json.gz', version: 1, collectedAt: '2026-10-31T18:00:00+09:00', range: { from: '2026-10-30', to: '2026-10-31' }, stocks: 1, size: f.bytes.byteLength });
    expect(f.meta.sha256).toBe(createHash('sha256').update(f.bytes).digest('hex'));
    expect(f.md5).toBe(createHash('md5').update(f.bytes).digest('hex'));
  });
  it.each([
    ['시장.json.gz', tinyMarket()],
    ['market-data.json.gz', tinyMarket({ range: { from: '2026-10-31', to: '2026-10-30' } })],
    ['market-data.json.gz', tinyMarket({ collectedAt: 'yesterday' })],
    ['market-data.json.gz', { hello: 1 }],
  ])('%s 는 market-file-invalid', (name, data) => {
    expect(() => readMarketFile(write(name, data))).toThrow(expect.objectContaining({ code: 'market-file-invalid' }));
  });
  it('gzip이 아니거나 없는 파일도 market-file-invalid', () => {
    const p = join(tempDir(), 'x.json.gz');
    writeFileSync(p, 'not gzip');
    expect(() => readMarketFile(p)).toThrow(expect.objectContaining({ code: 'market-file-invalid' }));
    expect(() => readMarketFile(join(tempDir(), 'none.json.gz'))).toThrow(expect.objectContaining({ code: 'market-file-invalid' }));
  });
});
```

(`validateMarketData`가 위 최소 v1 파일을 받는지 `src/lib/marketData/format.test.ts`의 픽스처를 보고 필드를 맞춘다. 맞지 않으면 그 픽스처 생성 도우미를 import한다.)

```ts
// cli/src/driveApi.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import { createDriveApi } from './driveApi';
import { cleanupDirs, fakeFetch, makeIo } from './testing';
import { createRedactor } from './output';
import { parseArgv } from './args';
import type { Ctx } from './context';

afterEach(cleanupDirs);
function ctxWith(f: typeof fetch) {
  const { io } = makeIo({ fetch: f });
  const ctx: Ctx = { args: parseArgv(['drive', 'upload', 'x']), env: {}, fetch: io.fetch, now: io.now, sleep: io.sleep, hostname: io.hostname, dir: io.dir!, say: () => {}, log: () => {}, warn: () => {}, redact: createRedactor() };
  return ctx;
}
const tokens = () => {
  const calls: boolean[] = [];
  return { calls, token: async (force?: boolean) => (calls.push(!!force), force ? 'fresh' : 'old') };
};

describe('createDriveApi', () => {
  it('resumable 업로드: 메타데이터 POST → Location에 PUT, appDataFolder·표식', async () => {
    const f = fakeFetch((c) => {
      if (c.method === 'POST') return { headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=u1' }, body: {} };
      return { body: { id: 'NEWID12345', md5Checksum: 'm', size: '3' } };
    });
    const t = tokens();
    const api = createDriveApi(ctxWith(f), t.token);
    expect(await api.upload({ name: 'a.json.gz', sha256: 's' }, new Uint8Array([1, 2, 3]))).toEqual({ id: 'NEWID12345', md5Checksum: 'm', size: '3' });
    expect(f.calls[0].url.searchParams.get('uploadType')).toBe('resumable');
    expect(f.calls[0].body).toEqual({ name: 'a.json.gz', parents: ['appDataFolder'], mimeType: 'application/gzip', appProperties: { gazua: 'market-data', sha256: 's' } });
    expect(f.calls[1].method).toBe('PUT');
    expect(f.calls[1].headers.get('Authorization')).toBe('Bearer old');
  });
  it('401이면 토큰을 한 번 새로 받아 다시 한다', async () => {
    let n = 0;
    const f = fakeFetch(() => (n++ === 0 ? { status: 401, body: {} } : { body: { id: 'X1234567890' } }));
    const t = tokens();
    expect(await createDriveApi(ctxWith(f), t.token).get('X1234567890')).toEqual({ id: 'X1234567890' });
    expect(t.calls).toEqual([false, true]);
  });
  it('429·5xx는 1·2·4초 백오프로 세 번까지, 그래도 429면 drive-quota', async () => {
    const f = fakeFetch(() => ({ status: 429, body: {} }));
    const ctx = ctxWith(f);
    const slept: number[] = [];
    ctx.sleep = async (ms) => void slept.push(ms);
    await expect(createDriveApi(ctx, tokens().token).get('X1234567890')).rejects.toMatchObject({ code: 'drive-quota' });
    expect(slept).toEqual([1000, 2000, 4000]);
    expect(f.calls).toHaveLength(4);
  });
  it('get 404는 null, remove 404는 성공, 403 storageQuotaExceeded는 drive-quota, 그 밖은 drive-failed', async () => {
    expect(await createDriveApi(ctxWith(fakeFetch(() => ({ status: 404, body: {} }))), tokens().token).get('X1234567890')).toBeNull();
    await createDriveApi(ctxWith(fakeFetch(() => ({ status: 404, body: {} }))), tokens().token).remove('X1234567890');
    const q = fakeFetch(() => ({ status: 403, body: { error: { errors: [{ reason: 'storageQuotaExceeded' }] } } }));
    await expect(createDriveApi(ctxWith(q), tokens().token).upload({ name: 'a', sha256: 's' }, new Uint8Array())).rejects.toMatchObject({ code: 'drive-quota' });
    await expect(createDriveApi(ctxWith(fakeFetch(() => ({ status: 400, body: {} }))), tokens().token).get('X1234567890')).rejects.toMatchObject({ code: 'drive-failed' });
  });
  it('listMarket은 표식 쿼리로 페이지를 넘긴다', async () => {
    const f = fakeFetch((c) => (c.url.searchParams.get('pageToken') ? { body: { files: [{ id: 'B', createdTime: 't2' }] } } : { body: { files: [{ id: 'A', createdTime: 't1' }], nextPageToken: 'n' } }));
    expect(await createDriveApi(ctxWith(f), tokens().token).listMarket()).toEqual([{ id: 'A', createdTime: 't1' }, { id: 'B', createdTime: 't2' }]);
    expect(f.calls[0].url.searchParams.get('spaces')).toBe('appDataFolder');
    expect(f.calls[0].url.searchParams.get('q')).toBe("appProperties has { key='gazua' and value='market-data' }");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter gazua-cli test -- driveApi marketFile`
Expected: FAIL

- [ ] **Step 3: 구현**

```ts
// cli/src/marketFile.ts
// 올릴 시장 파일을 읽어 앱과 같은 형식 검사와 서버와 같은 manifest 검사를 업로드 전에 한다(설계 6.4-1).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { validateMarketData } from '../../src/lib/marketData/format';
import { checkMarketMeta, MARKET_FILE_MAX_BYTES, type MarketFileMeta } from '../../src/lib/marketData/manifest';
import { CliError } from './errors';

export interface LocalMarketFile {
  bytes: Uint8Array;
  md5: string;
  meta: MarketFileMeta;
}
const invalid = (why: string) => new CliError('market-file-invalid', `올릴 수 없는 시장 파일이에요(${why})`);

export function readMarketFile(path: string): LocalMarketFile {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch {
    throw invalid('파일을 읽을 수 없어요');
  }
  if (bytes.byteLength > MARKET_FILE_MAX_BYTES) throw invalid('512 MiB를 넘어요');
  let parsed: unknown;
  try {
    parsed = JSON.parse(gunzipSync(bytes).toString('utf8'));
  } catch {
    throw invalid('gzip JSON이 아니에요');
  }
  const v = validateMarketData(parsed);
  if (!v.ok) throw invalid(`형식 ${v.reason}`);
  const meta = {
    name: basename(path),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.byteLength,
    version: v.data.version,
    collectedAt: v.data.collectedAt,
    range: { from: v.data.range.from, to: v.data.range.to },
    stocks: v.data.stocks.length,
  };
  const c = checkMarketMeta(meta);
  if (!c.ok) throw invalid(c.path);
  return { bytes: new Uint8Array(bytes), md5: createHash('md5').update(bytes).digest('hex'), meta: c.value };
}
```

```ts
// cli/src/driveApi.ts
// Drive REST v3(appDataFolder). 401은 토큰을 한 번 새로 받아 다시, 429·5xx는 1·2·4초 백오프로 세 번까지 다시 한다(설계 6.4).
import type { Ctx } from './context';
import { CliError } from './errors';

const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const QUERY = "appProperties has { key='gazua' and value='market-data' }";
const BACKOFF_MS = [1000, 2000, 4000];
const TIMEOUT_MS = 10 * 60 * 1000; // 수백 MB 업로드

export interface DriveFileInfo {
  id: string;
  md5Checksum?: string;
  size?: string;
  trashed?: boolean;
  createdTime?: string;
}
export interface DriveApi {
  get(id: string): Promise<DriveFileInfo | null>;
  upload(meta: { name: string; sha256: string }, bytes: Uint8Array): Promise<DriveFileInfo>;
  remove(id: string): Promise<void>;
  listMarket(): Promise<DriveFileInfo[]>;
}

export function createDriveApi(ctx: Ctx, token: (force?: boolean) => Promise<string>): DriveApi {
  async function call(method: string, url: string, init: { headers?: Record<string, string>; body?: BodyInit } = {}): Promise<Response> {
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const t = await token(refreshed);
      let res: Response;
      try {
        res = await ctx.fetch(url, { method, body: init.body, headers: { ...init.headers, Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch {
        throw new CliError('network');
      }
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < BACKOFF_MS.length) {
        await ctx.sleep(BACKOFF_MS[attempt]);
        continue;
      }
      return res;
    }
  }
  async function failOf(res: Response): Promise<CliError> {
    if (res.status === 401) return new CliError('drive-login-required');
    const text = await res.text().catch(() => '');
    if (res.status === 429 || (res.status === 403 && /storageQuotaExceeded|rateLimitExceeded|userRateLimitExceeded/.test(text))) return new CliError('drive-quota');
    return new CliError('drive-failed', `Drive 요청이 실패했어요(HTTP ${res.status})`);
  }
  const json = async (res: Response) => (await res.json()) as Record<string, unknown>;

  return {
    async get(id) {
      const res = await call('GET', `${FILES}/${encodeURIComponent(id)}?fields=id,md5Checksum,size,trashed`);
      if (res.status === 404) return null;
      if (!res.ok) throw await failOf(res);
      return (await json(res)) as unknown as DriveFileInfo;
    },
    async upload(meta, bytes) {
      const start = await call('POST', `${UPLOAD}?uploadType=resumable&fields=id,md5Checksum,size`, {
        headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/gzip', 'X-Upload-Content-Length': String(bytes.byteLength) },
        body: JSON.stringify({ name: meta.name, parents: ['appDataFolder'], mimeType: 'application/gzip', appProperties: { gazua: 'market-data', sha256: meta.sha256 } }),
      });
      if (!start.ok) throw await failOf(start);
      const session = start.headers.get('Location');
      if (!session?.startsWith('https://www.googleapis.com/')) throw new CliError('drive-failed', 'Drive 업로드 주소를 받지 못했어요');
      const put = await call('PUT', session, { headers: { 'Content-Type': 'application/gzip' }, body: bytes });
      if (!put.ok) throw await failOf(put);
      return (await json(put)) as unknown as DriveFileInfo;
    },
    async remove(id) {
      const res = await call('DELETE', `${FILES}/${encodeURIComponent(id)}`);
      if (!res.ok && res.status !== 404) throw await failOf(res);
    },
    async listMarket() {
      const out: DriveFileInfo[] = [];
      let page: string | undefined;
      do {
        const u = new URL(FILES);
        u.searchParams.set('spaces', 'appDataFolder');
        u.searchParams.set('q', QUERY);
        u.searchParams.set('fields', 'nextPageToken,files(id,createdTime)');
        u.searchParams.set('pageSize', '100');
        if (page) u.searchParams.set('pageToken', page);
        const res = await call('GET', u.toString());
        if (!res.ok) throw await failOf(res);
        const b = await json(res);
        for (const f of (b.files as DriveFileInfo[] | undefined) ?? []) if (typeof f.id === 'string') out.push(f);
        page = typeof b.nextPageToken === 'string' ? b.nextPageToken : undefined;
      } while (page);
      return out;
    },
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter gazua-cli test && pnpm --filter gazua-cli check && pnpm --filter gazua-cli build`
Expected: PASS(빌드가 브라우저 전용 문자열을 찾지 않음)

- [ ] **Step 5: 커밋**

```bash
git add cli/src/driveApi.ts cli/src/driveApi.test.ts cli/src/marketFile.ts cli/src/marketFile.test.ts
git commit -m "feat(cli): Drive appDataFolder REST와 올릴 시장 파일 사전 검사를 더함"
```

---

### Task 11: `gazua drive` 명령(login·upload·status·logout)

**Files:**
- Create: `cli/src/commands/drive.ts`, `cli/src/commands/drive.test.ts`
- Modify: `cli/src/main.ts` (`COMMANDS`에 `drive`), `cli/README.md`(명령 표·환경변수·배포 순서)
- Modify: `cli/src/testing.ts` (`fakeFetch`의 204 응답 본문을 `null`로 생성)

**Interfaces:**
- Consumes: Task 8 `readDriveAuth`/`writeDriveAuth`/`removeDriveAuth`/`readDriveToken`/`writeDriveToken`/`removeDriveToken`, `SyncClient.device/token/marketFiles/registerMarketFile/deleteMarketFile/revoke`; Task 9 `driveClientFrom`, `googleLogin`, `refreshAccess`, `revokeGoogle`, `WaitForCallback`; Task 10 `createDriveApi`, `readMarketFile`
- Produces: `drive: Command`; 테스트 주입용 `driveDeps = { waitForCallback: listenOnce as WaitForCallback }`(테스트가 바꿔 끼운다); 업로드 결과 `{ uploaded: boolean; file: MarketFileRow; removed: number }`; 로그인 결과 `{ sync: 'kept' | 'new'; google: 'kept' | 'new' }`; 상태 결과 `{ sync: { label, expiresAt } | null; google: boolean; files: MarketFileRow[] | null }`; 로그아웃 결과 `{ serverRevoked: boolean; googleRevoked: boolean; filesRemoved: boolean }`

동작(spec 6.1·6.4·5.3):

- `drive login`: `driveClientFrom(ctx.env)` 먼저(설정 없으면 바로 실패). ① `readDriveAuth`가 없거나 만료면 기존 `login` 명령과 같은 폴링을 `client.device(label, 'market-upload')`로 한다(라벨 기본 `gazua-drive@<호스트>`, 안내 문구는 `앱의 설정 › 동기화·공유 › CLI 연결에 이 코드를 넣어 주세요: …`). 토큰 응답 `scope !== 'market-upload'`면 받은 토큰으로 `revoke()`를 시도(실패 무시)하고 `server-outdated`. 맞으면 `writeDriveAuth`. ② `readDriveToken`이 없거나 `clientId`가 다르면 `googleLogin` → `writeDriveToken({ v: 1, clientId, refreshToken, createdAt: ctx.now() })`.
- `drive upload <파일>`: `positionals[1]`이 없으면 `invalid-args`(`올릴 파일 경로가 필요해요. 예: gazua drive upload ~/gazua-data/market-data-20261031.json.gz`). 순서: `readMarketFile` → `readDriveAuth`(없으면 `drive-login-required`, 만료면 `cli-token-expired`) → `readDriveToken`(없거나 clientId 다르면 `drive-login-required`) → 접근 토큰(`refreshAccess`, `force` 때만 다시) → `marketFiles()` → 같은 sha256 행이 있고 `api.get(id)`가 있고 `trashed !== true`면 업로드 생략 → 아니면 `api.upload` 후 `md5Checksum`·`size` 비교(다르면 `api.remove` 시도 후 `drive-failed` `Drive에 올린 파일이 로컬과 달라요`) → `driveFileId`를 `DRIVE_FILE_ID_RE`로 검사(실패하면 `api.remove` 시도 후 `drive-failed`) → `registerMarketFile`(429 `market-limit`이면 정리 한 번 후 재시도 한 번, 그래도 실패면 올린 파일 삭제 시도 후 던짐; 그 밖 실패도 올린 파일 삭제 시도 후 던짐) → 정리(spec 6.4-6: keep 밖 행 삭제 → Drive 삭제, 남은 manifest에 없는 표식 파일 중 `createdTime`이 1시간 넘게 지난 것 삭제; 정리 중 오류는 `ctx.warn('Drive 정리를 끝내지 못했어요. 다음 업로드 때 다시 정리해요')`).
- `drive status`: 파일 상태와(`drive-auth.json` 있으면) `marketFiles()`. 서버 실패는 `files: null`과 경고.
- `drive logout`: 서버 토큰 `revoke()`(401 revoked·expired는 성공), Google `revokeGoogle(refreshToken)`, 두 파일 삭제. 철회 실패는 경고(`서버 연결은 앱에서 끊어 주세요(설정 › 동기화·공유 › 로그인한 기기)` / `Google 계정의 보안 › 서드 파티 연결에서 접근을 지워 주세요`).
- 그 밖 하위 명령은 `invalid-args`(`drive 하위 명령은 login · upload · status · logout이에요`).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// cli/src/commands/drive.test.ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { readDriveAuth, readDriveToken, writeDriveAuth, writeDriveToken } from '../config';
import { run } from '../main';
import { tinyMarket } from '../marketFile.test';
import { cleanupDirs, fakeFetch, makeIo, tempDir, type FakeCall } from '../testing';
import { driveDeps } from './drive';

afterEach(cleanupDirs);
const ENV = { GAZUA_DRIVE_CLIENT_ID: 'cid', GAZUA_DRIVE_CLIENT_SECRET: 'csecret', GAZUA_SYNC_URL: 'https://sync.test' };
const SERVER = 'https://sync.test';

function marketFile(name = 'market-data-20261031.json.gz') {
  const p = join(tempDir(), name);
  const bytes = gzipSync(Buffer.from(JSON.stringify(tinyMarket())));
  writeFileSync(p, bytes);
  return { p, bytes, sha: createHash('sha256').update(bytes).digest('hex'), md5: createHash('md5').update(bytes).digest('hex') };
}
function loggedIn(dir: string, now: number) {
  writeDriveAuth(dir, { v: 1, server: SERVER, token: 'gzc_' + 'a'.repeat(43), tokenId: 't1', label: 'gazua-drive@testhost', expiresAt: now + 1e9 });
  writeDriveToken(dir, { v: 1, clientId: 'cid', refreshToken: 'refresh-1', createdAt: 0 });
}
const rowOf = (o: Record<string, unknown>) => ({ id: 'r-new', createdAt: 1, updatedAt: 1, ...o });

/** 동기화 서버 + Google 토큰 + Drive를 함께 흉내 낸다 */
function world(o: { files?: any[]; driveFiles?: { id: string; createdTime: string }[]; putStatus?: number[]; md5?: string; existing?: Record<string, { trashed?: boolean } | null> } = {}) {
  const files = [...(o.files ?? [])];
  const drive = [...(o.driveFiles ?? [])];
  const putStatus = [...(o.putStatus ?? [])];
  const deletedDrive: string[] = [];
  const deletedRows: string[] = [];
  const f = fakeFetch((c: FakeCall) => {
    const u = c.url;
    if (u.href === 'https://oauth2.googleapis.com/token') return { body: { access_token: 'acc', expires_in: 3600 } };
    if (u.origin === SERVER && u.pathname === '/v1/market/files' && c.method === 'GET') return { body: { files } };
    if (u.origin === SERVER && u.pathname === '/v1/market/files' && c.method === 'POST') {
      const s = putStatus.shift() ?? 200;
      if (s !== 200) return { status: s, body: { error: s === 429 ? 'market-limit' : 'invalid' } };
      const b = c.body as Record<string, unknown>;
      const row = rowOf(b);
      files.unshift(row);
      return { body: row };
    }
    const del = /^\/v1\/market\/files\/(.+)$/.exec(u.pathname);
    if (u.origin === SERVER && del && c.method === 'DELETE') {
      deletedRows.push(del[1]);
      files.splice(files.findIndex((x) => x.id === del[1]), 1);
      return { body: { deleted: true } };
    }
    if (u.pathname.startsWith('/upload/drive/v3/files') && c.method === 'POST') return { headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=u1' }, body: {} };
    if (u.pathname.startsWith('/upload/drive/v3/files') && c.method === 'PUT') {
      const bytes = c.body as Uint8Array;
      return { body: { id: 'DRIVENEW123', md5Checksum: o.md5 ?? createHash('md5').update(bytes).digest('hex'), size: String(bytes.byteLength) } };
    }
    const one = /^\/drive\/v3\/files\/(.+)$/.exec(u.pathname);
    if (one && c.method === 'DELETE') return (deletedDrive.push(one[1]), { status: 204, body: {} });
    if (one && c.method === 'GET') {
      const e = o.existing?.[one[1]];
      return e === null || e === undefined ? { status: 404, body: {} } : { body: { id: one[1], ...e } };
    }
    if (u.pathname === '/drive/v3/files' && c.method === 'GET') return { body: { files: drive } };
    return undefined;
  });
  return { f, files, deletedDrive, deletedRows };
}

describe('gazua drive upload', () => {
  it('올리고 등록하고 결과를 낸다', async () => {
    const m = marketFile();
    const w = world();
    const { io, dir, result, clock } = makeIo({ env: { ...ENV }, fetch: w.f });
    loggedIn(dir, clock.now);
    expect(await run(['drive', 'upload', m.p], io)).toBe(0);
    expect(result()).toMatchObject({ ok: true, data: { uploaded: true, removed: 0, file: { driveFileId: 'DRIVENEW123', sha256: m.sha, name: 'market-data-20261031.json.gz' } } });
    expect(JSON.stringify(result())).not.toContain('refresh-1');
  });
  it('검증 실패 파일은 토큰 갱신·Drive 요청 없이 market-file-invalid', async () => {
    const p = join(tempDir(), '시장.json.gz');
    writeFileSync(p, gzipSync(Buffer.from(JSON.stringify(tinyMarket()))));
    const w = world();
    const { io, dir, result, clock } = makeIo({ env: { ...ENV }, fetch: w.f });
    loggedIn(dir, clock.now);
    expect(await run(['drive', 'upload', p], io)).toBe(1);
    expect(result().error.code).toBe('market-file-invalid');
    expect(w.f.calls).toHaveLength(0);
  });
  it('같은 sha256이 manifest에 있고 Drive에도 있으면 올리지 않는다', async () => {
    const m = marketFile();
    const w = world({ files: [rowOf({ id: 'r1', driveFileId: 'DRIVEOLD123', name: 'market-data-20261031.json.gz', sha256: m.sha, size: m.bytes.byteLength, version: 1, collectedAt: '2026-10-31T18:00:00+09:00', range: { from: '2026-10-30', to: '2026-10-31' }, stocks: 1 })], existing: { DRIVEOLD123: {} } });
    const { io, dir, result, clock } = makeIo({ env: { ...ENV }, fetch: w.f });
    loggedIn(dir, clock.now);
    expect(await run(['drive', 'upload', m.p], io)).toBe(0);
    expect(result().data.uploaded).toBe(false);
    expect(w.f.calls.some((c) => c.method === 'PUT')).toBe(false);
  });
  it('md5가 다르면 올린 파일을 지우고 drive-failed', async () => {
    const m = marketFile();
    const w = world({ md5: 'different' });
    const { io, dir, result, clock } = makeIo({ env: { ...ENV }, fetch: w.f });
    loggedIn(dir, clock.now);
    expect(await run(['drive', 'upload', m.p], io)).toBe(1);
    expect(result().error.code).toBe('drive-failed');
    expect(w.deletedDrive).toEqual(['DRIVENEW123']);
  });
  it('등록 429면 정리 후 한 번 다시 하고, 그래도 막히면 올린 파일을 지우고 market-limit', async () => {
    const m = marketFile();
    const old = (n: number) => rowOf({ id: `r${n}`, driveFileId: `DRIVEOLD${n}00`, name: `market-data-2026100${n}.json.gz`, sha256: String(n).repeat(64), size: 1, version: 1, collectedAt: `2026-10-0${n}T18:00:00+09:00`, range: { from: '2026-10-01', to: `2026-10-0${n}` }, stocks: 1 });
    const ok = world({ files: [old(3), old(2), old(1)], putStatus: [429, 200] });
    const a = makeIo({ env: { ...ENV }, fetch: ok.f });
    loggedIn(a.dir, a.clock.now);
    expect(await run(['drive', 'upload', m.p], a.io)).toBe(0);
    expect(ok.deletedRows).toContain('r1');
    const stuck = world({ putStatus: [429, 429] });
    const b = makeIo({ env: { ...ENV }, fetch: stuck.f });
    loggedIn(b.dir, b.clock.now);
    expect(await run(['drive', 'upload', m.p], b.io)).toBe(1);
    expect(b.result().error.code).toBe('market-limit');
    expect(stuck.deletedDrive).toContain('DRIVENEW123');
  });
  it('정리는 keep 밖 행과 1시간 지난 고아 파일만 지운다', async () => {
    const m = marketFile();
    const old = (n: number) => rowOf({ id: `r${n}`, driveFileId: `DRIVEOLD${n}00`, name: `market-data-2026100${n}.json.gz`, sha256: String(n).repeat(64), size: 1, version: 1, collectedAt: `2026-10-0${n}T18:00:00+09:00`, range: { from: '2026-10-01', to: `2026-10-0${n}` }, stocks: 1 });
    const { io, dir, result, clock } = makeIo({ env: { ...ENV } });
    const w = world({
      files: [old(2), old(1)],
      driveFiles: [{ id: 'ORPHANOLD12', createdTime: new Date(clock.now - 2 * 3600_000).toISOString() }, { id: 'ORPHANNEW12', createdTime: new Date(clock.now - 60_000).toISOString() }],
    });
    io.fetch = w.f;
    loggedIn(dir, clock.now);
    expect(await run(['drive', 'upload', m.p, '--keep', '2'], io)).toBe(0);
    expect(w.deletedRows).toEqual(['r1']);
    expect(w.deletedDrive.sort()).toEqual(['DRIVEOLD100', 'ORPHANOLD12']);
    expect(result().data.removed).toBe(1);
  });
  it('로그인 파일이 없으면 drive-login-required', async () => {
    const m = marketFile();
    const { io, result } = makeIo({ env: { ...ENV }, fetch: world().f });
    expect(await run(['drive', 'upload', m.p], io)).toBe(1);
    expect(result().error.code).toBe('drive-login-required');
  });
});

describe('gazua drive login', () => {
  it('market-upload 기기 코드와 Google 로그인을 하고 두 파일을 쓴다', async () => {
    driveDeps.waitForCallback = async () => new URLSearchParams({ code: 'c', state: 'STATE' });
    const f = fakeFetch((c) => {
      if (c.url.pathname === '/v1/cli/device') return { body: { deviceCode: 'd'.repeat(43), userCode: 'BCDF-GHJK', verifyUrl: 'u', interval: 5, expiresIn: 600 } };
      if (c.url.pathname === '/v1/cli/token') return { body: { token: 'gzc_' + 'b'.repeat(43), tokenId: 'tid', expiresAt: 9e15, scope: 'market-upload' } };
      if (c.url.href === 'https://oauth2.googleapis.com/token') return { body: { access_token: 'a', refresh_token: 'rt', scope: 'https://www.googleapis.com/auth/drive.appdata' } };
      return undefined;
    });
    const { io, dir, err } = makeIo({ env: { ...ENV }, fetch: f });
    // googleLogin이 출력한 주소의 state를 받아 돌려준다
    driveDeps.waitForCallback = async () => {
      const url = err.join('').split('\n').find((l) => l.startsWith('https://accounts.google.com/'))!;
      return new URLSearchParams({ code: 'c', state: new URL(url).searchParams.get('state')! });
    };
    expect(await run(['drive', 'login'], io)).toBe(0);
    expect(f.calls[0].body).toEqual({ label: 'gazua-drive@testhost', scope: 'market-upload' });
    expect(readDriveAuth(dir).auth?.tokenId).toBe('tid');
    expect(readDriveToken(dir)).toMatchObject({ clientId: 'cid', refreshToken: 'rt' });
    expect(err.join('')).not.toContain('csecret');
  });
  it('옛 Worker가 scope 없이 토큰을 주면 저장하지 않고 철회를 시도하고 server-outdated', async () => {
    const f = fakeFetch((c) => {
      if (c.url.pathname === '/v1/cli/device') return { body: { deviceCode: 'd'.repeat(43), userCode: 'BCDF-GHJK', verifyUrl: 'u', interval: 5, expiresIn: 600 } };
      if (c.url.pathname === '/v1/cli/token' && c.method === 'POST') return { body: { token: 'gzc_' + 'c'.repeat(43), tokenId: 'tid', expiresAt: 9e15 } };
      if (c.url.pathname === '/v1/cli/token' && c.method === 'DELETE') return { body: { revoked: true } };
      return undefined;
    });
    const { io, dir, result } = makeIo({ env: { ...ENV }, fetch: f });
    expect(await run(['drive', 'login'], io)).toBe(1);
    expect(result().error.code).toBe('server-outdated');
    expect(readDriveAuth(dir).auth).toBeNull();
    expect(f.calls.some((c) => c.method === 'DELETE' && c.url.pathname === '/v1/cli/token')).toBe(true);
  });
  it('설정이 없으면 drive-not-configured', async () => {
    const { io, result } = makeIo({ env: { GAZUA_SYNC_URL: SERVER } });
    expect(await run(['drive', 'login'], io)).toBe(1);
    expect(result().error.code).toBe('drive-not-configured');
  });
});

describe('gazua drive logout·status', () => {
  it('logout은 서버·Google 철회 후 두 파일을 지운다', async () => {
    const f = fakeFetch((c) => (c.url.pathname === '/v1/cli/token' || c.url.href === 'https://oauth2.googleapis.com/revoke' ? { body: {} } : undefined));
    const { io, dir, result, clock } = makeIo({ env: { ...ENV }, fetch: f });
    loggedIn(dir, clock.now);
    expect(await run(['drive', 'logout'], io)).toBe(0);
    expect(result().data).toEqual({ serverRevoked: true, googleRevoked: true, filesRemoved: true });
    expect(readDriveAuth(dir).auth).toBeNull();
    expect(readDriveToken(dir)).toBeNull();
  });
  it('status는 로그인 상태와 목록을 낸다', async () => {
    const w = world();
    const { io, dir, result, clock } = makeIo({ env: { ...ENV }, fetch: w.f });
    loggedIn(dir, clock.now);
    expect(await run(['drive', 'status'], io)).toBe(0);
    expect(result().data).toMatchObject({ google: true, files: [], sync: { label: 'gazua-drive@testhost' } });
  });
  it('모르는 하위 명령은 invalid-args', async () => {
    const { io, result } = makeIo({ env: { ...ENV } });
    expect(await run(['drive', 'nope'], io)).toBe(2);
    expect(result().error.code).toBe('invalid-args');
  });
});
```

(`makeIo`가 `env`를 그대로 쓰므로 `{ ...ENV }`로 복사해 넘긴다. `fakeFetch`는 `PUT` 본문을 바이트 그대로 `body`에 둔다.)

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter gazua-cli test -- drive`
Expected: FAIL

- [ ] **Step 3: 구현**

```ts
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

function requireDriveAuth(ctx: Ctx): AuthFile {
  const { auth, warnings } = readDriveAuth(ctx.dir);
  for (const w of warnings) ctx.warn(w);
  if (!auth) throw new CliError('drive-login-required');
  ctx.redact.add(auth.token);
  if (auth.expiresAt <= ctx.now()) throw new CliError('cli-token-expired');
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
  if (!token || token.clientId !== c.clientId) {
    const refreshToken = await googleLogin(ctx, c, driveDeps.waitForCallback);
    writeDriveToken(ctx.dir, { v: 1, clientId: c.clientId, refreshToken, createdAt: ctx.now() });
    google = 'new';
  }
  return { sync, google };
}

/** keep 밖 manifest 행과 Drive 파일, 1시간 지난 고아 표식 파일을 지운다. 지운 행 수를 돌려준다 */
async function prune(ctx: Ctx, sync: SyncClient, api: DriveApi, keep: number): Promise<number> {
  let removed = 0;
  try {
    const rows = [...(await sync.marketFiles())].sort((a, b) => b.collectedAt.localeCompare(a.collectedAt) || b.createdAt - a.createdAt);
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
  const sync = createSyncClient({ server: auth.server, token: auth.token, fetchImpl: ctx.fetch });

  const same = (await sync.marketFiles()).find((r) => r.sha256 === local.meta.sha256);
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
      files = await createSyncClient({ server: auth.server, token: auth.token, fetchImpl: ctx.fetch }).marketFiles();
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
```

주의: `parseArgv`는 `command`가 첫 위치 인자이므로 `gazua drive upload <파일>`에서 `positionals`는 `['upload', '<파일>']`이다(위 코드가 `[0]`·`[1]`을 쓰는 이유).

`cli/src/testing.ts`의 `fakeFetch`에서 응답 생성 줄을 아래로 바꾼다. 204는 본문이 없어야 하므로 JSON 문자열을 넘기면 `Response` 생성자가 던지고, `createDriveApi`가 이를 `network` 오류로 처리한다. 위 `world`의 DELETE 응답(204)과 정리 테스트의 기대값은 유지한다.

```ts
    const status = reply.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(reply.body ?? {}), { status, headers: { 'content-type': 'application/json', ...reply.headers } });
```

`main.ts`: `import { drive } from './commands/drive';`, `COMMANDS`에 `drive`.

`cli/README.md`: 명령 표에 `gazua drive login`·`gazua drive upload <파일> [--keep N]`·`gazua drive status`·`gazua drive logout` 행, 환경변수 절에 `GAZUA_DRIVE_CLIENT_ID`·`GAZUA_DRIVE_CLIENT_SECRET`·`GAZUA_DRIVE_PORT`, 옵션 절에 `--keep`, 「Drive 전달」 절(spec 12절 1~7단계 요약, 리디렉션 URI `http://127.0.0.1:53682/`, 포트를 바꾸면 그 주소도 등록, `0006_market_files.sql` 적용 → Worker 배포 → 앱 배포 순서, 이 토큰은 시장 파일 목록만 올리고 지우며 프로필·키는 읽지 못함). `readme.test.ts`에 `--keep`·`GAZUA_DRIVE_CLIENT_ID`·`0006_market_files.sql` 포함 검사를 한 줄 더한다.

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter gazua-cli test && pnpm --filter gazua-cli check && pnpm --filter gazua-cli build`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add cli/src cli/README.md
git commit -m "feat(cli): gazua drive login·upload·status·logout으로 시장 파일을 Drive에 올림"
```

---

### Task 12: 수집 스크립트 `--drive`

**Files:**
- Modify: `scripts/collect-market-data.mjs` (`parseArgs`, `main`, 새 export `runDriveUpload`)
- Test: `tests/collect-market-data.test.mjs`

**Interfaces:**
- Consumes: Task 11 `gazua drive upload` (자식 프로세스)
- Produces: `parseArgs`의 `o.drive: boolean`; `runDriveUpload(file: string, summary: { failed: string[] }, deps?: { spawn?: typeof spawnSync; env?: NodeJS.ProcessEnv; cliPath?: string; exists?: (p: string) => boolean; log?: (s: string) => void; error?: (s: string) => void }): number` (0 성공, 1 실패)

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// tests/collect-market-data.test.mjs 끝에
import { runDriveUpload } from '../scripts/collect-market-data.mjs';

test('--drive 플래그를 읽는다', () => {
  assert.equal(parseArgs(['--drive']).drive, true);
  assert.equal(parseArgs([]).drive, false);
});

test('runDriveUpload: 일봉 실패가 있으면 올리지 않고 1', () => {
  const calls = [];
  const errs = [];
  const code = runDriveUpload('/tmp/m.json.gz', { failed: ['005930'] }, { spawn: (...a) => (calls.push(a), { status: 0 }), exists: () => true, error: (s) => errs.push(s) });
  assert.equal(code, 1);
  assert.equal(calls.length, 0);
  assert.match(errs.join('\n'), /일봉 실패 1종목이 있어 Drive에 올리지 않았어요/);
  assert.match(errs.join('\n'), /gazua drive upload \/tmp\/m\.json\.gz/);
});

test('runDriveUpload: CLI 번들이 없으면 빌드 안내와 1', () => {
  const errs = [];
  assert.equal(runDriveUpload('/tmp/m.json.gz', { failed: [] }, { exists: () => false, error: (s) => errs.push(s) }), 1);
  assert.match(errs.join('\n'), /pnpm -C cli build/);
});

test('runDriveUpload: KIS 키는 빼고 Drive 값은 넘겨 CLI를 부른다', () => {
  let seen;
  const code = runDriveUpload('/tmp/m.json.gz', { failed: [] }, {
    exists: () => true,
    cliPath: '/repo/cli/dist/gazua.mjs',
    env: { KIS_APP_KEY: 'k', KIS_APP_SECRET: 's', GAZUA_DRIVE_CLIENT_ID: 'cid', GAZUA_DRIVE_CLIENT_SECRET: 'cs', PATH: '/bin' },
    spawn: (cmd, args, opts) => ((seen = { cmd, args, opts }), { status: 0 }),
  });
  assert.equal(code, 0);
  assert.equal(seen.cmd, process.execPath);
  assert.deepEqual(seen.args, ['/repo/cli/dist/gazua.mjs', 'drive', 'upload', '/tmp/m.json.gz']);
  assert.equal(seen.opts.stdio, 'inherit');
  assert.equal(seen.opts.env.KIS_APP_KEY, undefined);
  assert.equal(seen.opts.env.KIS_APP_SECRET, undefined);
  assert.equal(seen.opts.env.GAZUA_DRIVE_CLIENT_ID, 'cid');
  assert.equal(seen.opts.env.GAZUA_DRIVE_CLIENT_SECRET, 'cs');
});

test('runDriveUpload: 업로드가 실패하면 다시 올리는 방법을 알리고 1', () => {
  const errs = [];
  assert.equal(runDriveUpload('/tmp/m.json.gz', { failed: [] }, { exists: () => true, spawn: () => ({ status: 1 }), error: (s) => errs.push(s) }), 1);
  assert.match(errs.join('\n'), /파일은 \/tmp\/m\.json\.gz에 있어요\. `gazua drive upload \/tmp\/m\.json\.gz`로 다시 올릴 수 있어요/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test:scripts`
Expected: FAIL (`runDriveUpload` 없음, `drive` 옵션 모름)

- [ ] **Step 3: 구현**

```js
// 파일 위 import에 spawnSync 추가
import { spawnSync } from 'node:child_process';

// parseArgs: 기본값에 drive: false, 분기에
    else if (a === '--drive') o.drive = true;

/**
 * --drive: 수집이 끝난 파일을 CLI(gazua drive upload)로 본인 Drive에 올린다(설계 2026-11-02-market-drive 7절, D11).
 * 일봉을 받지 못한 종목이 있으면 올리지 않는다. KIS 키는 자식에 넘기지 않는다.
 */
export function runDriveUpload(file, summary, deps = {}) {
  const { spawn = spawnSync, env = process.env, cliPath = join(REPO_ROOT, 'cli', 'dist', 'gazua.mjs'), exists = existsSync, error = (s) => console.error(s) } = deps;
  const retry = `파일은 ${file}에 있어요. \`gazua drive upload ${file}\`로 다시 올릴 수 있어요`;
  if (summary.failed.length > 0) {
    error(`일봉 실패 ${summary.failed.length}종목이 있어 Drive에 올리지 않았어요. --update로 다시 받거나, 이대로 올리려면 \`gazua drive upload ${file}\`를 실행해 주세요`);
    return 1;
  }
  if (!exists(cliPath)) {
    error(`먼저 pnpm -C cli build를 실행해 주세요. ${retry}`);
    return 1;
  }
  const childEnv = { ...env };
  delete childEnv.KIS_APP_KEY;
  delete childEnv.KIS_APP_SECRET;
  const r = spawn(process.execPath, [cliPath, 'drive', 'upload', file], { stdio: 'inherit', env: childEnv });
  if (r.status === 0) return 0;
  error(retry);
  return 1;
}
```

`main`의 `await collect(…)` 줄을 `const { summary } = await collect(…);`로 바꾸고 뒤에:

```js
  if (opts.drive) process.exitCode = runDriveUpload(summary.path, summary);
```

(`collect`가 돌려주는 `file`은 시장 데이터 본문 객체이고, 저장한 파일 경로는 `summary.path`다. `assertOutAllowed`가 `resolve(out)`으로 만든 출력 디렉터리에 파일 이름을 붙이므로 `summary.path`는 이미 절대 경로다. 파일 머리 주석에 `--drive` 사용 예 한 줄: `//   GAZUA_DRIVE_CLIENT_ID=... GAZUA_DRIVE_CLIENT_SECRET=... pnpm collect -- --update <파일> --drive`.)

- [ ] **Step 4: 통과 확인**

Run: `pnpm test:scripts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add scripts/collect-market-data.mjs tests/collect-market-data.test.mjs
git commit -m "feat(collect): --drive로 수집이 끝난 파일을 본인 Drive에 올림(일봉 실패가 있으면 올리지 않음)"
```

---

### Task 13: 문서와 구현 현황

**Files:**
- Modify: `docs/proposals/2026-10-25-server-and-db.md`, `docs/roadmap.md`, `docs/development.md`, `sync-worker/README.md`, `docs/live-check.md`, `cli/src/readme.test.ts`(sync-worker README 검사에 `/v1/market/files`·`0006_market_files.sql`)

- [ ] **Step 1: 실패하는 문서 검사 더하기**

`cli/src/readme.test.ts`의 `sync-worker/README.md` describe에:

```ts
  it('시장 파일 manifest 경로와 0006, market-upload 범위를 적는다', () => {
    for (const s of ['/v1/market/files', '0006_market_files.sql', 'market-upload']) expect(workerReadme, s).toContain(s);
  });
```

Run: `pnpm --filter gazua-cli test -- readme` → FAIL

- [ ] **Step 2: 문서 고치기**

- `sync-worker/README.md`: 경로 표에 `GET/DELETE /v1/market/files`, `DELETE /v1/market/files/:id`(앱 세션), CLI `market-upload` 범위(`GET`·`POST /v1/market/files`, `DELETE /v1/market/files/:id`), 마이그레이션 목록에 `0006_market_files.sql`, 배포 순서(0006 적용 → Worker 배포 → 앱 배포).
- `docs/development.md` 시장 데이터 절: 「Drive 전달(선택)」 소절 — `gazua drive login`, `pnpm collect -- --drive`, 앱 설정 › 데이터 › Drive 전달, 일봉 실패 시 올리지 않음, 보관 2개 기본.
- `docs/live-check.md`: 새 항목 「Drive 받기: GIS 팝업이 열리고 CSP 위반이 없다, 받은 파일 크기·해시가 맞는다, 다른 Google 계정이면 404 안내」(번호는 기존 마지막 다음).
- 제안서 `docs/proposals/2026-10-25-server-and-db.md`: 7절 2단계 첫머리에 「구현 현황(2026-11-02)」 문단 — 수동 가져오기 유지(끝남), 정리 Cron(끝남), 키 E2EE(키만 끝남, PR #59), Drive 전달·D1 manifest·수집 스크립트 업로드(이번 PR, [설계](../superpowers/specs/2026-11-02-market-drive-design.md)). 프록시 토큰·주문 캐시·성과 이력 E2EE는 남음. 5절 표 「시장 데이터 공통 보관」 행의 개선 방식 끝에 「(구현 2026-11-02, 설정 › 데이터 › Drive 전달)」. 8절 8번 끝에 「일봉 실패가 있는 수집 파일은 자동 업로드하지 않는다(설계 D11)」.
- `docs/roadmap.md`: 기준일을 2026-11-02로, 「다음 우선순위」의 「서버·DB 2단계 남은 것(Drive 전달, D1 manifest), 3단계…」를 「서버·DB 3단계(공동 그룹·정기 계산·알림·성과 이력)」로, 「증권사 키 종단 간 암호화 동기화 — 진행 중」은 PR #59로 끝났으므로 지운다. 구현 현황 표의 서버·DB 2단계 행을 `5/5 | 없음`으로, 표 위 조사일을 2026-11-02로.

- [ ] **Step 3: 통과 확인**

Run: `pnpm --filter gazua-cli test && pnpm test`
Expected: PASS

- [ ] **Step 4: 커밋**

```bash
git add docs sync-worker/README.md cli/src/readme.test.ts
git commit -m "docs(market-drive): 제안서·로드맵 구현 현황과 Drive 전달 사용·배포 문서를 갱신함"
```

---

### Task 14: 전체 검증

- [ ] **Step 1: 전체 실행**

```bash
pnpm test
pnpm check
pnpm test:scripts
pnpm --filter sync-worker test
pnpm --filter gazua-cli check
pnpm --filter gazua-cli test
pnpm --filter gazua-cli build
pnpm build
```

Expected: 모두 성공. `pnpm build`는 `VITE_GOOGLE_DRIVE_CLIENT_ID` 없이도 성공하고 `dist/index.html`의 CSP에 `accounts.google.com`이 없다(`grep -c accounts.google.com dist/index.html` → 0). `VITE_GOOGLE_DRIVE_CLIENT_ID=x pnpm build` 뒤에는 1 이상.

- [ ] **Step 2: 실패가 있으면 해당 Task로 돌아가 고치고 커밋한다**
