# 시장 파일 수집 계정 표시 구현 계획

> 실행: superpowers:subagent-driven-development. 각 Task는 TDD(실패 시험 → 최소 구현 → 통과 → 커밋).

설계: `docs/superpowers/specs/2026-11-03-market-owner-tag-design.md`

전제: 사용자 1명(+지인 테스터), 실수 방지 목적, 범위를 작게. 검토는 단계마다 cascade-fix 최대 2회.

## Task 1. 표시 계산 함수와 파일 형식

파일: `src/lib/marketData/owner.ts`(새), `owner.test.ts`(새), `format.ts`, `format.test.ts`

1. `owner.test.ts`: `marketOwnerTag('abc')`가 `sha256("gazua-market-owner/v1\nabc")` hex 앞 32자와 같다(node:crypto로 기대값 계산). `isOwnerTag`가 32자 소문자 hex만 참.
2. 구현: `export const OWNER_TAG_RE = /^[0-9a-f]{32}$/`, `export async function marketOwnerTag(sub: string): Promise<string>`(Web Crypto `crypto.subtle.digest`).
3. `format.test.ts`: `owner`가 있으면 모양이 맞을 때만 ok, 틀리면(숫자, 대문자, 31자) `format`. 없으면 지금처럼 ok.
4. `format.ts`: `MarketDataFileV1`에 `owner?: string`(주석: 수집 계정 표시, 설계 2절). `metaOk`에 `x.owner === undefined || (typeof x.owner === 'string' && OWNER_TAG_RE.test(x.owner))`.
5. 검증: `pnpm vitest run src/lib/marketData/owner.test.ts src/lib/marketData/format.test.ts`. 커밋.

## Task 2. 가져오기 거절(store·driveSync)

파일: `store.ts`, `store.test.ts`, `driveSync.ts`, `driveSync.test.ts`

1. `store.test.ts`(설계 5절 표 네 경우): 데모 파일 JSON에 `owner`를 넣어 gzip 없이 `decompress` 주입으로 넘긴다.
   - 표시 없음 + `owner` 주입 없음 → ok.
   - 표시 있음 + `owner: async () => 같은 값` → ok.
   - 표시 있음 + 다른 값 → `{ok:false, reason:'owner-mismatch'}`, 이전 데이터 유지.
   - 표시 있음 + `owner` 없음 또는 `async () => null` → `owner-signed-out`.
2. `store.ts`: `ImportDeps.owner?: () => Promise<string | null>`, `ImportResult` reason에 `'owner-mismatch' | 'owner-signed-out'`. `validateMarketData` 직후 `check.data.owner`가 있으면 `await deps.owner?.() ?? null`과 비교.
3. `driveSync.test.ts`: importFile이 `owner-mismatch`를 주면 `fetchFromDrive`가 같은 reason을 돌려준다. `DriveOutcome` reason에 두 값 추가.
4. 검증: 해당 테스트 파일 실행. 커밋.

## Task 3. 동기화 컨트롤러가 현재 계정 표시를 준다

파일: `src/lib/sync/controller.svelte.ts`, `controller.test.ts`

1. 시험: attach 전에 부르면 attach가 끝난 뒤 판정한다. 로그인 전 `marketOwner()`는 null, Google 로그인 뒤 `marketOwnerTag(uid)`, 소셜 로그인 뒤 `marketOwnerTag(sub)`, 로그아웃 뒤 null. 기존 controller 테스트의 로그인 헬퍼를 쓴다.
2. 구현: `SyncController`에 `marketOwner(): Promise<string | null>` — `await attached` 뒤 `account !== null && ownerId ? marketOwnerTag(ownerId) : null`.
3. 검증·커밋.

## Task 4. 화면 연결과 안내 문구

파일: `src/lib/ui/settings/DataTools.svelte`(+테스트), `MarketDrive.svelte`(+테스트)

1. 시험: DataTools에서 importFile이 `owner-mismatch`·`owner-signed-out`를 주면 설계 5절 문구의 스낵바. `importFile`에 넘긴 deps에 `owner` 함수가 있고 `sync.marketOwner`를 부른다(sync 없으면 null).
2. MarketDrive: `fetchFromDrive`의 `importDeps`에 `owner: () => sync.marketOwner()`. FAIL 표에 두 문구.
3. 검증: 두 컴포넌트 테스트. 커밋.

## Task 5. 서버 `GET /v1/cli/owner`

파일: `sync-worker/src/cli.ts`, `cli.test.ts`

1. 시험: read·market-upload 토큰 모두 `GET /v1/cli/owner` → 200 `{ owner: marketOwnerTag(firebase_sub) }`. 쿼리가 붙으면 403 `cli-scope`. 다른 메서드 403.
2. 구현: `OWNER_RE = /^\/v1\/cli\/owner$/`, `cliScope`가 두 범위 모두에서 `GET` + 빈 쿼리면 `'owner'`. `handleCliToken`에서 `json(200, { owner: await marketOwnerTag(row.sub) })`.
3. `sync-worker/README.md`의 CLI 토큰 허용 경로 표에 `GET /v1/cli/owner`.
4. 검증: `pnpm -C sync-worker test`, `pnpm -C sync-worker check`. 커밋.

## Task 6. CLI `gazua owner`

파일: `cli/src/commands/owner.ts`(새)·`owner.test.ts`(새), `cli/src/syncClient.ts`, `cli/src/execute.ts`·`execute.test.ts`(명령 목록), `cli/src/mcp/tools.ts`·`tools.test.ts`(MCP 제외 목록에 `owner`. 수집 스크립트 전용이라 MCP에 내보내지 않는다), `cli/README.md`

1. 시험: 만료 전 drive-auth.json → auth.json 순서로 `GET /v1/cli/owner`, 첫 토큰이 401이면 다음 파일로 한 번 더, 쓸 파일이 없으면 `not-logged-in`. 시도한 토큰이 있으면 남은 파일이 없을 때 마지막 401 오류를 그대로, 처음부터 파일이 없을 때만 `not-logged-in`. 서버 403 `cli-scope`면 기존 `server-outdated`(`Where`에 `'owner'`, 새 오류 코드 없음). 결과 `{ owner }`.
2. 구현: `syncClient.owner()`, 명령은 `readDriveAuth` → `readAuth` 순서. 만료 지난 파일은 건너뛴다. `cli/README.md` 명령 표에 `gazua owner`(readme.test.ts가 요구).
3. 검증: `pnpm -C cli test`, `pnpm -C cli check`(있으면). 커밋.

## Task 7. 수집 스크립트

파일: `scripts/collect-market-data.mjs`, `tests/collect-market-data.test.mjs`

1. 시험:
   - `parseArgs(['--no-owner'])` → `owner: false`, 기본 `true`.
   - `fetchOwner(deps)`: CLI 번들이 없거나 옛 빌드(`invalid-args`)면 `pnpm -C cli build` 안내로 던짐, spawn 출력 JSON `{ok:true,data:{owner}}`면 값, `ok:false`면 그 메시지로 던짐, KIS 키를 자식 env에서 뺀다.
   - `collect({ owner: 'aa…' })`이면 파일에 `owner`가 들어가고, 없으면 필드가 없다.
2. 구현: `fetchOwner`(spawnSync `node cli/dist/gazua.mjs owner`, stdout JSON 해석), `main()`이 수집 전에 부르고(옵션 `--no-owner`면 건너뜀) `collect`에 넘김. `file`에 `...(owner && { owner })`.
3. 검증: `pnpm test:scripts`. 커밋.

## Task 8. 문서와 전체 검증

파일: `docs/help/settings.md`(시장 데이터 절), `docs/development.md`(수집 절)

1. 도움말: 「수집한 계정으로 로그인한 앱에서만 가져올 수 있어요」, 거절 문구 두 개의 뜻.
2. development.md: 수집 전에 `gazua login` 또는 `gazua drive login`, `--no-owner`, 배포 순서(Worker → CLI 빌드 → 앱).
3. 전체: `pnpm test`, `pnpm check`, `pnpm test:scripts`, `pnpm -C sync-worker test`, `pnpm -C cli test`, 시장 데이터 가져오기 e2e(`pnpm e2e tests/e2e/screen.spec.ts`).
4. 커밋.
