# 읽기 전용 CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 도구(터미널 에이전트)가 가즈아 데이터를 읽고 계산하는 읽기 전용 CLI `gazua`를 만든다. 동기화한 관심 그룹·전략을 읽고, 증권사 시세·토스 보유를 읽고, 전략 신호와 시뮬레이션을 앱 엔진 그대로 계산한다. 어떤 경로로도 주문·쓰기를 하지 않는다.
**Architecture:** (1) `sync-worker`에 기기 코드 로그인(`/v1/cli/*`)과 읽기 전용 CLI 토큰 인증을 더한다(라우터 앞 분기, 정규식 허용 목록). (2) 앱에 CLI 연결 승인·토큰 철회 화면을 더한다. (3) 공급자·평가기에 작은 선택 인자를 더한다. (4) `cli/` 워크스페이스 패키지(esbuild 단일 번들)가 앱 엔진(`src/lib/sim/*`, `src/lib/providers/*`)을 상대 경로로 재사용하고, 증권사는 프록시 없이 직접 부르되 `proxy/src/allowlist.ts`의 `isAllowed`로 주문 경로를 막는다.
**Tech Stack:** TypeScript, Cloudflare Workers + D1(테스트는 `node:sqlite` 위의 `sync-worker/test/d1.ts`), Svelte 5 + vitest + jsdom + axe, Node ≥ 22, esbuild 0.25.12, pnpm 워크스페이스(`corepack pnpm`).

스펙: `docs/superpowers/specs/2026-11-01-readonly-cli-design.md` (사용자 승인됨). 이 계획의 Task는 스펙 §11 파일 표와 §8 테스트를 모두 덮는다. 한 PR로 낸다.

## Global Constraints

스펙의 프로젝트 전역 값이다. 어느 Task에서든 이 값과 다르게 쓰지 않는다.

- 런타임: Node ≥ 22(`cli/package.json` `engines.node: ">=22"`, 루트와 같음). 패키지 관리자는 `corepack pnpm`. 루트 테스트는 `TZ=America/New_York`로 돈다(KST 산술이 기기 시간대에 의존하지 않는지 확인하려는 것이라 CLI 테스트 스크립트도 같게 한다).
- 마이그레이션: `sync-worker/migrations/0005_cli.sql`(번호 `0005`). 테이블 `cli_grants`·`cli_tokens`.
  - `cli_grants` 열: `id`(PK, uuid), `device_hash`(NOT NULL UNIQUE, 기기 코드 SHA-256 hex), `user_code`(NOT NULL UNIQUE, 정규화한 8자·하이픈 없음), `label`(NOT NULL, 64자), `ip_hash`(NOT NULL, HMAC-SHA256 hex), `status`(NOT NULL, `'pending'|'approved'|'denied'|'consumed'`), `user_id`(`users(id)` 참조), `interval_ms`(NOT NULL), `last_polled_at`, `consumed_token_hash`, `geo`, `created_at`(NOT NULL), `expires_at`(NOT NULL, `created_at + 10분`). 인덱스 `cli_grants_expires(expires_at)`, `cli_grants_ip(ip_hash, created_at)`.
  - `cli_tokens` 열: `id`(PK, uuid), `token_hash`(NOT NULL UNIQUE, SHA-256 hex), `user_id`(NOT NULL, `users(id)` 참조), `label`(NOT NULL), `scope`(NOT NULL DEFAULT `'read'`), `created_at`(NOT NULL), `last_used_at`(NOT NULL), `expires_at`(NOT NULL, `created_at + 90일`), `revoked_at`. 인덱스 `cli_tokens_user(user_id)`.
  - 기기 코드·CLI 토큰 원문은 서버에 저장하지 않는다(SHA-256 hex만). 사용자 코드는 8자 그대로 저장한다.
- 코드 모양: 기기 코드 = `base64url(32바이트 무작위)`(43자). CLI 토큰 = `gzc_` + `base64url(32바이트 무작위)`, 정규식 `^gzc_[A-Za-z0-9_-]{43}$`. 사용자 코드 = 자음 20자 `BCDFGHJKLMNPQRSTVWXZ` 중 8자(화면 표기 `XXXX-XXXX`), 받을 때 대문자로 바꾸고 하이픈·공백을 뺀다. 겹치면(UNIQUE 위반) 다시 만든다.
- 헤더: CLI 요청은 `Authorization: Gazua-CLI <토큰>`. `Origin` 헤더가 없는 요청만 CLI 분기로 받는다. CORS 허용 헤더(`cors.ts`)는 바꾸지 않는다.
- CLI 토큰으로 허용하는 요청(라우터 전, 정확 일치. 그 밖은 403 `cli-scope`, `HEAD`·끝 슬래시 포함):
  - `GET ^/v1/profiles$`(쿼리를 보지 않음)
  - `GET ^/v1/profiles/([^/]+)$` + `docVersion`이 정확히 `2`
  - `DELETE ^/v1/cli/token$`(그 토큰만 철회)
- 만료·시간: CLI 토큰 90일 고정(쓰는 동안 늘지 않음). 승인 대기 10분(`expiresIn: 600`). `last_used_at`은 하루에 한 번만 갱신. 정리(`purge.ts`): `cli_grants`는 `expires_at`이 하루 지난 행, `cli_tokens`는 만료·철회 뒤 30일(`KEEP_AFTER_END`) 지난 행, 한 번에 `PURGE_ROWS_PER_RUN`(500)개까지.
- 폴링: 간격 5초(`interval: 5`, `interval_ms = 5000`). `slow_down`이면 CLI와 서버가 각각 5초씩 늘린다. 서버는 `interval_ms < 60000`일 때만 늘리고 60초 이상이면 늘리지 않고 `slow_down`만 답한다(상한 60초). `pending` 폴링은 조건부 UPDATE 한 문장(`last_polled_at IS NULL OR last_polled_at + interval_ms <= now`)으로 `last_polled_at`을 쓰고 바뀐 행이 0이면 `slow_down`.
- 횟수 제한(D1 `INSERT … SELECT … WHERE (SELECT count(*) …) < ?`로 넣기 문장 안에서 센다): `POST /v1/cli/device`는 같은 `ip_hash`로 최근 10분 5건, 전체 `pending`(만료 전) 50건. 넘으면 429 `rate-limited` + `Retry-After: 60`.
- IP: `CF-Connecting-IP`를 정규화(IPv6는 `::`를 펼쳐 앞 4그룹 /64, IPv4-mapped `::ffff:a.b.c.d`는 IPv4, 헤더 없음은 `'unknown'`)한 뒤 시크릿 `CLI_IP_SALT`로 HMAC-SHA256 hex. 원 IP는 저장하지 않는다. `CLI_IP_SALT`가 없으면 `POST /v1/cli/device`는 503 `cli-disabled`. `geo` = `request.cf`의 `country`·`city`를 `'KR · Seoul'`처럼 이은 문자열, 64자까지만 저장, 없으면 `NULL`.
- 엔드포인트와 Worker 오류 코드:

  | 메서드·경로 | 인증 | 요청 | 성공 응답 | 오류 |
  |---|---|---|---|---|
  | `POST /v1/cli/device` | 없음(횟수 제한), Origin 없음 | `{ label }`(1~64자) | `{ deviceCode, userCode: 'XXXX-XXXX', verifyUrl, interval: 5, expiresIn: 600 }` | 422 `invalid`, 429 `rate-limited`, 503 `cli-disabled` |
  | `POST /v1/cli/token` | 없음(기기 코드), Origin 없음 | `{ deviceCode }` | `{ token, tokenId, expiresAt }`(한 번만) | 400 `pending`·`slow_down`, 410 `expired`, 403 `denied`, 404 `unknown-device` |
  | `POST /v1/cli/approve` | 앱 세션 | `{ userCode, approve?: boolean }` | `approve` 없으면 `{ label, createdAt, geo }`(상태 그대로), 있으면 `{ label, createdAt }` | 422 `invalid-code` |
  | `GET /v1/cli/tokens` | 앱 세션 | — | `{ tokens: [{ id, label, createdAt, lastUsedAt, expiresAt }] }`(살아 있는 것만) | — |
  | `DELETE /v1/cli/tokens/:id` | 앱 세션 | — | `{ revoked: true }` | 404 `not-found`(남의 것 포함) |
  | `GET /v1/profiles`, `GET /v1/profiles/:id?docVersion=2` | CLI 토큰 | — | 지금과 같음 | 401 `cli-token`·`cli-token-revoked`·`cli-token-expired`, 403 `cli-scope`·`not-allowed` |
  | `DELETE /v1/cli/token` | CLI 토큰 | — | `{ revoked: true }` | 401 |

  `verifyUrl` = `${ALLOWED_ORIGINS의 첫 출처}/#/settings/sync`. 앱의 `DELETE /v1/cli/token`은 `ROUTES`에 넣지 않아 허용 Origin+세션에서는 404.
- CLI 토큰 인증 순서: 토큰 모양(정규식) 아니면 401 `cli-token` → `cli_tokens`를 `token_hash`로 찾아 없음·철회는 401 `cli-token-revoked`, 만료는 401 `cli-token-expired` → 사용자 허용 목록(`users.firebase_sub`가 `kakao:`·`naver:`로 시작하면 `parseAccountList(env.ALLOWED_ACCOUNTS)`, 아니면 `users.email`이 `parseAllowList(env.ALLOWED_EMAILS)`)에 없으면 403 `not-allowed` → 허용 목록(위) 밖이면 403 `cli-scope` → `last_used_at` 갱신 → 핸들러.
- 토큰 한 번만 주기: 승인된 기기 코드를 폴링하면 새 토큰 `T`/해시 `H`로 batch(`UPDATE cli_grants SET status='consumed', consumed_token_hash=? WHERE id=? AND status='approved' AND consumed_token_hash IS NULL AND expires_at>?` + `INSERT INTO cli_tokens … SELECT … WHERE EXISTS (SELECT 1 FROM cli_grants WHERE id=? AND consumed_token_hash=?)`) 뒤 `consumed_token_hash`를 다시 읽어 `H`와 같을 때만 `T`를 돌려준다. 다르면 410 `expired`. `consumed`·만료 뒤 폴링은 410 `expired`.
- 「다른 기기 모두 로그아웃」(`DELETE /v1/sessions?others=1`)은 CLI 토큰을 지우지 않는다. CLI 토큰 목록·철회는 앱 화면에서 따로 한다.
- 저장 경로: `~/.config/gazua/`(`XDG_CONFIG_HOME`이 있으면 `$XDG_CONFIG_HOME/gazua/`). 디렉터리 권한 700, 파일 600, 읽을 때 더 넓으면 `warnings`로 경고(`auth.json`·토큰 파일·주문 캐시를 읽을 때 모두, Windows는 검사 생략). 파일: `auth.json`(`{ v:1, server, token, tokenId, label, expiresAt }`), `tokens-kis.json`·`tokens-toss.json`(공급자마다 하나: `{ v:1, keyHash, accessToken, expiresAt, issuedAt }`, `keyHash` = 키 앞 값 SHA-256 앞 16자. 각자의 공급자 잠금 안에서만 갱신), `kis.lock`·`toss.lock`, `orders-<keyHash>-<accountSeq 해시 앞 8자>.json`. 쓰기는 임시 파일 → rename. 원문 `accountSeq`는 파일 이름에도 내용에도 쓰지 않는다.
- 환경변수 이름: `KIS_APP_KEY`·`KIS_APP_SECRET`, `TOSS_CLIENT_ID`·`TOSS_CLIENT_SECRET`, `GAZUA_SYNC_URL`, `XDG_CONFIG_HOME`, 빌드 때 `VITE_SYNC_API_URL`(esbuild `define`으로 상수 `__GAZUA_DEFAULT_SERVER__` 하나만 넣는다. `import.meta.env` 전체는 정의하지 않는다), Worker 시크릿 `CLI_IP_SALT`. 옵션: `--profile <이름|ID>`, `--pretty`, `--verbose`, `--env-file <경로>`, `--provider kis|toss`, `--label`, `--server`, `--strategy <이름|ID>`, `--today`, `--from`, `--to`, `--raw`.
- 서버 주소 우선순위: `--server` > `GAZUA_SYNC_URL` > 빌드 기본값. 로그인한 뒤에는 `auth.json`의 `server`. `https`만(로컬 개발 `localhost`·`127.0.0.1`·`[::1]`의 `http`만 예외).
- 토큰 잠금(`TokenLock`): 파일 `~/.config/gazua/<provider>.lock`, 내용 `{ pid, hostname, nonce, createdAt }`, `open(path,'wx')`(`O_EXCL`)로 만들고 이미 있으면 200ms마다 재시도. **회수 잠금(`.break`)과 시간 기준 회수는 없다**(파일 시스템에 원자적 「비교 후 삭제」가 없어 새 경합을 만든다). 잠금을 읽어 **같은 hostname이고 `process.kill(pid, 0)`이 ESRCH(프로세스 없음)일 때만** 회수: 지우기 직전에 다시 읽어 nonce가 같으면 `unlink` 후 `wx` 재시도. pid가 살아 있거나(EPERM 포함) 다른 host이거나 내용이 깨졌으면 회수하지 않고 기다린다. 해제는 자기 nonce일 때만 `unlink`. 전체 대기 상한 30초, 넘으면 `token-busy`. 남는 좁은 경합(두 회수자가 같은 죽은 잠금을 동시에 볼 때)의 결과는 토큰을 한 번 더 발급하는 것뿐이고 토스 `token-revoked`·KIS 재시도로 복구된다. 잠금 안에서 토큰 파일을 다시 읽는다(`TokenStore.load()`는 메모리에 담지 않고 매번 읽는다). 토스에도 `IssuedAtStore`(파일)를 연결해 재발급 간격(60초)을 실행을 넘어 지킨다.
- 토스 키 분리: 앱과 같은 토스 키를 쓰면 한쪽이 토큰을 새로 받을 때 다른 쪽 토큰이 무효가 된다. CLI용 토스 앱(다른 client ID·secret)을 따로 만들게 README에 경고한다.
- 증권사 허용 목록: 증권사 호출 전에 `proxy/src/allowlist.ts`의 `isAllowed(provider, path, method)`(쿼리를 뺀 경로)로 막고, 어긋나면 `ApiError('path-blocked')`. 주소는 `UPSTREAM[provider]`.
- venue 마감: `KRX` 15:30 KST, 통합(`UNIFIED`, NXT 포함) 20:00 KST. venue는 `loadSimData`와 같은 규칙(공급자 `venues`가 비었거나 `KRX`를 포함하면 `KRX`, 아니면 첫 venue). 토스는 `venues: ['UNIFIED']`라 늘 20:00. 기준 봉: `--today`가 없거나 마감 전이면 어제까지(`addDays(kstDate(now), -1)`), `--today`이고 마감 뒤이며 오늘이 거래일이면 오늘까지. 휴장일(`getTradingDays`의 `isOpen: false`)이면 오늘 포함 안 함.
- 출력: 표준 출력에는 JSON 한 줄(`--pretty`면 들여쓰기), 진행 안내는 표준 오류(`--verbose`일 때만, 로그인 안내는 항상). 성공 `{ "ok": true, "data": … }`, 실패 `{ "ok": false, "error": { "code", "message" }, "data"?: … }`, 경고가 있으면 최상위 `warnings: string[]`. 종료 코드: 성공 0, `ok: false` 1, 인자 오류(`invalid-args`) 2.
- 비밀값 출력 금지: 출력 직전에 키 이름이 `SECRET_KEYS`(`appKey`·`appSecret`·`clientId`·`clientSecret`·`accessToken`·`refreshToken`·`token`·`proxyToken`·`accountSeq`·`deviceCode`·`secrets`, 대소문자 무시)이면 값을 `"[숨김]"`으로 바꾸고, 문자열 값에 지금 실행의 비밀값(환경변수 키, CLI 토큰, 접근 토큰, `accountSeq`)이 들어 있으면 그 부분을 `[숨김]`으로 바꾼다(6자 미만 값은 문자열 치환에서 제외). 오류 메시지도 같은 거르기를 거친다. 동기화의 `FORBIDDEN_KEYS`(`src/lib/sync/forbidden.ts`)는 쓰지 않는다.
- CLI 오류 코드(`message`는 사람이 읽는 한국어 한 줄, 비밀값 없음): `invalid-args`(종료 2)·`not-logged-in`·`cli-token-revoked`·`cli-token-expired`·`cli-scope`·`not-allowed`·`server-outdated`(CLI 경로 404, Origin 없는 요청을 막는 옛 Worker의 403 `origin`)·`login-expired`·`login-denied`·`rate-limited`·`network`(공급자 `ApiError`의 `proxy-unreachable`·`offline`도 여기로)·`profile-required`(`data.profiles`)·`profile-not-found`·`strategy-not-found`·`ambiguous-strategy`(`data.matches`)·`no-credentials`·`provider-unsupported`·`path-blocked`·`ip-not-allowed`·`invalid-credentials`·`token-throttled`·`token-contended`·`upstream`·`timeout`(이 여섯은 공급자 `ApiError` 코드 그대로)·`token-busy`(같은 기기의 다른 CLI 실행이 쥔 토큰 잠금을 30초 안에 못 얻음)·`app-outdated`(서버 문서가 이 CLI보다 높은 버전, 422 `앱을 새로 고쳐 주세요`)·`internal`.
- 읽기 전용은 세 곳에서 따로 지킨다: 서버 허용 목록(위), 증권사 `isAllowed`, CLI 명령 목록(쓰기·주문 명령 없음).
- 앱 문구는 해요체, 커밋 메시지는 한국어(`feat(scope): …함`). 커밋마다 이 저장소 관례의 `Co-Authored-By:` 줄을 끝에 붙인다(`git log -3`로 확인).
- 검증 명령(전체): 루트 `corepack pnpm test`, `corepack pnpm check`; `cd sync-worker && npx vitest run && npx tsc -p tsconfig.json --noEmit`; CLI는 `corepack pnpm --filter gazua-cli test`, `corepack pnpm --filter gazua-cli check`, `corepack pnpm --filter gazua-cli build`.

---

## 파일 구조

| 파일 | 만들기/고치기 | 책임 |
|---|---|---|
| `sync-worker/migrations/0005_cli.sql` | 새 파일 | `cli_grants`·`cli_tokens` 표 |
| `sync-worker/src/cli.ts` | 새 파일 | 기기 코드 발급·승인·토큰 폴링·CLI 토큰 인증·읽기 전용 허용 목록·앱용 목록/철회·IP HMAC·횟수 제한 |
| `sync-worker/src/cli.test.ts` | 새 파일 | Worker 테스트(스펙 §8.1) |
| `sync-worker/src/env.ts` | 고침 | `SyncEnv.CLI_IP_SALT?` |
| `sync-worker/src/handler.ts` | 고침 | `guard` 분리, Origin 없는 CLI 분기, 앱 경로 3개 |
| `sync-worker/src/purge.ts`, `purge.test.ts`, `worker.ts` | 고침 | grant·토큰 정리, 로그 |
| `sync-worker/test/harness.ts` | 고침 | `CLI_IP_SALT` 기본값, `call`의 `cf` 옵션 |
| `sync-worker/wrangler.toml`, `sync-worker/README.md` | 고침 | 시크릿 주석, 배포·계약 문서 |
| `src/lib/providers/http.ts`(+`http.test.ts`) | 고침 | 선택 인자 `urlFor` |
| `src/lib/providers/types.ts`, `toss.ts`(+`toss.account.test.ts`) | 고침 | `AccountHolding.avgPrice?` |
| `src/lib/providers/kis.ts`(+`kis.test.ts`) | 고침 | 선택 `tokenLock` |
| `src/lib/sim/rules.ts`(+`rules.test.ts`) | 고침 | `signal()` 결과에 선택 필드 `group` |
| `src/lib/state/routes.ts`(+`routes.test.ts`) | 고침 | `parseHash('#/settings/sync')` |
| `src/lib/sync/cliCode.ts`(+`cliCode.test.ts`) | 새 파일 | 사용자 코드 입력 정규화·표기·상대 시각 |
| `src/lib/sync/api.ts`, `controller.svelte.ts` | 고침 | `cliApprove`·`cliTokens`·`cliRevoke` |
| `src/lib/ui/settings/CliConnect.svelte`(+`.test.ts`) | 새 파일 | CLI 연결 승인 화면 |
| `src/lib/ui/settings/SyncPanel.svelte`, `SyncManage.svelte`(+`SyncPanel.test.ts`) | 고침 | 화면 배치, CLI 토큰 목록·철회 |
| `src/lib/ui/settings/testSync.ts` | 새 파일 | 테스트 공용 `fakeSync` |
| `src/routes/Settings.svelte`(+`Settings.test.ts`) | 고침 | `section: 'sync'`이면 CLI 코드 칸에 초점 |
| `pnpm-workspace.yaml`, `pnpm-lock.yaml` | 고침 | `'cli'` |
| `cli/package.json`, `tsconfig.json`, `vitest.config.ts`, `build.mjs` | 새 파일 | 패키지 골격, esbuild 번들, 빌드 뒤 검사 |
| `cli/src/main.ts`, `args.ts`, `context.ts`, `output.ts`, `errors.ts`, `config.ts`, `env.ts` | 새 파일 | 인자·분기·출력·오류·저장 파일·환경변수 |
| `cli/src/syncClient.ts`, `session.ts`, `profileData.ts` | 새 파일 | 동기화 API, 로그인 세션 읽기, 프로필·전략 읽기 |
| `cli/src/fileLock.ts`, `tokenFiles.ts`, `direct.ts`, `providers.ts`, `orderCache.ts` | 새 파일 | 증권사 직접 호출 계층 |
| `cli/src/signals.ts`, `commands/*.ts` | 새 파일 | 신호 계산, 명령(`login`·`logout`·`profiles`·`watchlists`·`strategies`·`quote`·`holdings`·`signals`·`simulate`) |
| `cli/README.md` | 새 파일 | 사용법·토스 키 분리 경고·배포 순서 |

---

## Task 1: D1 `0005` 마이그레이션과 `CLI_IP_SALT`, 하네스 기본값

**Files:**
- Create: `sync-worker/migrations/0005_cli.sql`
- Create: `sync-worker/src/cli.test.ts`
- Modify: `sync-worker/src/env.ts` (`SOCIAL_REDIRECT_URIS?: string;` 바로 아래, 현재 24행 근처)
- Modify: `sync-worker/test/harness.ts` (`Harness.call` 타입 `:31` 근처, `env` 만드는 줄 `:55` 근처, `call` 구현 `:79-87` 근처)
- Modify: `sync-worker/wrangler.toml` (시크릿 주석 줄)

**Interfaces:**
- Consumes: 기존 `createTestD1()`(`sync-worker/test/d1.ts`)가 `migrations/*.sql`을 이름순으로 적용한다 → 새 파일은 자동으로 적용된다.
- Produces:
  - `SyncEnv.CLI_IP_SALT?: string`
  - `Harness['call']`의 옵션에 `cf?: { country?: string; city?: string }`(요청 객체의 `cf` 속성으로 붙는다)
  - 하네스 기본 `env.CLI_IP_SALT = 'test-cli-ip-salt'`

- [ ] **Step 1: 실패하는 테스트 쓰기**

`sync-worker/src/cli.test.ts`를 새로 만든다.

```ts
import { describe, expect, it } from 'vitest';
import { harness } from '../test/harness';

const columns = (h: ReturnType<typeof harness>, table: string) =>
  (h.env.DB.raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

describe('0005 마이그레이션', () => {
  it('cli_grants 열 이름이 스펙과 같다', () => {
    expect(columns(harness(), 'cli_grants')).toEqual([
      'id', 'device_hash', 'user_code', 'label', 'ip_hash', 'status', 'user_id', 'interval_ms',
      'last_polled_at', 'consumed_token_hash', 'geo', 'created_at', 'expires_at',
    ]);
  });

  it('cli_tokens 열 이름이 스펙과 같다', () => {
    expect(columns(harness(), 'cli_tokens')).toEqual([
      'id', 'token_hash', 'user_id', 'label', 'scope', 'created_at', 'last_used_at', 'expires_at', 'revoked_at',
    ]);
  });

  it('device_hash·user_code·token_hash는 UNIQUE다', () => {
    const h = harness();
    const ins = (id: string, device: string, code: string) =>
      h.env.DB.raw
        .prepare(
          `INSERT INTO cli_grants (id, device_hash, user_code, label, ip_hash, status, interval_ms, created_at, expires_at)
           VALUES (?, ?, ?, 'l', 'ip', 'pending', 5000, 1, 2)`,
        )
        .run(id, device, code);
    ins('a', 'd1', 'BBBBBBBB');
    expect(() => ins('b', 'd1', 'CCCCCCCC')).toThrow(/UNIQUE/);
    expect(() => ins('c', 'd2', 'BBBBBBBB')).toThrow(/UNIQUE/);
  });

  it('하네스 env에 CLI_IP_SALT 기본값이 있다', () => {
    expect(harness().env.CLI_IP_SALT).toBe('test-cli-ip-salt');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd sync-worker && npx vitest run src/cli.test.ts`
Expected: FAIL — `columns(...)` 결과가 `[]`이라 `expected [] to deeply equal [...]`, 마지막 테스트는 `expected undefined to be 'test-cli-ip-salt'`. (타입 오류로 `CLI_IP_SALT`가 없다는 메시지가 먼저 나올 수 있다. 같은 이유다.)

- [ ] **Step 3: 최소 구현**

`sync-worker/migrations/0005_cli.sql`:

```sql
-- 읽기 전용 CLI(설계 2026-11-01-readonly-cli). 기기 코드 승인 대기와 CLI 토큰. 원문 코드·토큰은 저장하지 않는다(SHA-256 hex만).
CREATE TABLE cli_grants (
  id TEXT PRIMARY KEY,                -- uuid
  device_hash TEXT NOT NULL UNIQUE,   -- 기기 코드의 SHA-256 hex
  user_code TEXT NOT NULL UNIQUE,     -- 사람이 치는 코드(정규화한 8자, 하이픈 없음)
  label TEXT NOT NULL,                -- CLI가 보낸 이름(예: 'gazua@macbook'), 64자
  ip_hash TEXT NOT NULL,              -- 요청 IP의 HMAC-SHA256 hex(시크릿 CLI_IP_SALT, IPv6는 /64로 줄인 뒤). 횟수 제한용, 원 IP는 두지 않음
  status TEXT NOT NULL,               -- 'pending' | 'approved' | 'denied' | 'consumed'
  user_id TEXT REFERENCES users(id),  -- 승인한 사용자
  interval_ms INTEGER NOT NULL,       -- 폴링 간격(slow_down이면 늘린다)
  last_polled_at INTEGER,
  consumed_token_hash TEXT,           -- 폴링이 토큰을 만들 때 그 토큰의 해시(한 번만 주기)
  geo TEXT,                           -- 요청 위치 '국가 · 도시'(request.cf, 승인 화면용). 없으면 NULL
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL         -- created_at + 10분
);
CREATE INDEX cli_grants_expires ON cli_grants(expires_at);
CREATE INDEX cli_grants_ip ON cli_grants(ip_hash, created_at);

CREATE TABLE cli_tokens (
  id TEXT PRIMARY KEY,                -- uuid(목록·철회에 쓰는 공개 ID)
  token_hash TEXT NOT NULL UNIQUE,    -- 토큰의 SHA-256 hex
  user_id TEXT NOT NULL REFERENCES users(id),
  label TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'read', -- 지금은 'read'만
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,        -- created_at + 90일(고정, 쓰는 동안 늘지 않음)
  revoked_at INTEGER
);
CREATE INDEX cli_tokens_user ON cli_tokens(user_id);
```

`sync-worker/src/env.ts`에서 `SOCIAL_REDIRECT_URIS?: string;` 줄 바로 아래에 더한다.

```ts
  /** CLI 요청 IP를 해시하는 솔트(secret, 32바이트 무작위). 없으면 POST /v1/cli/device가 503 cli-disabled. */
  CLI_IP_SALT?: string;
```

`sync-worker/test/harness.ts`를 고친다.

1. `Harness` 인터페이스의 `call` 줄을 바꾼다.

```ts
  call(method: string, path: string, o?: { token?: string | null; session?: string | null; body?: unknown; origin?: string | null; headers?: Record<string, string>; cf?: { country?: string; city?: string } }): Promise<Response>;
```

2. `const env: Harness['env'] = { … }` 객체 리터럴 끝(`ALLOWED_EMAILS: …` 뒤)에 `CLI_IP_SALT: 'test-cli-ip-salt'`를 더한다.

```ts
  const env: Harness['env'] = { DB: createTestD1(), ALLOWED_ORIGINS: `${ORIGIN}, https://second.example.test`, FIREBASE_PROJECT_ID: PROJECT, ALLOWED_EMAILS: opts.allowed ?? `${ME},${OTHER.toUpperCase()}`, CLI_IP_SALT: 'test-cli-ip-salt' };
```

3. `call` 구현의 마지막 `return handle(new Request(...), env, deps);`를 바꾼다.

```ts
    const request = new Request(BASE + path, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
    // Cloudflare가 붙여 주는 request.cf를 흉내 낸다(Node의 Request는 init의 cf를 버린다)
    if (o.cf) Object.defineProperty(request, 'cf', { value: o.cf });
    return handle(request, env, deps);
```

`sync-worker/wrangler.toml`의 시크릿 안내 주석(`# wrangler secret put으로 넣는다: …` 줄)에 `CLI_IP_SALT`를 더한다.

```toml
# wrangler secret put으로 넣는다: ALLOWED_ACCOUNTS, KAKAO_CLIENT_ID, KAKAO_CLIENT_SECRET, NAVER_CLIENT_ID, NAVER_CLIENT_SECRET, CLI_IP_SALT(읽기 전용 CLI, 32바이트 무작위)
```

- [ ] **Step 4: 통과 확인**

Run: `cd sync-worker && npx vitest run && npx tsc -p tsconfig.json --noEmit`
Expected: PASS(기존 테스트 포함 전부), tsc 오류 없음.

- [ ] **Step 5: 커밋**

```bash
git add sync-worker/migrations/0005_cli.sql sync-worker/src/cli.test.ts sync-worker/src/env.ts sync-worker/test/harness.ts sync-worker/wrangler.toml
git commit -m "feat(sync-worker): CLI 승인·토큰 표와 CLI_IP_SALT 환경값을 더함"
```

---

## Task 2: 기기 코드 발급 `POST /v1/cli/device`

**Files:**
- Create: `sync-worker/src/cli.ts`
- Modify: `sync-worker/src/cli.test.ts`(테스트 더하기)
- Modify: `sync-worker/src/handler.ts` (import 줄, `handle` 함수 전체 `:84-122`)

**Interfaces:**
- Consumes: `deps.random(n): Uint8Array`, `deps.uuid()`, `deps.now()`; 패키지의 `base64url`, `sha256Hex`, `HttpError`, `json`, `errorBody`, `readJson`(`@sch0718/firebase-session/worker`); `SyncEnv.CLI_IP_SALT`.
- Produces(`sync-worker/src/cli.ts`):
  ```ts
  export const CLI_GRANT_TTL: number;          // 10 * 60 * 1000
  export const POLL_INTERVAL_MS: number;       // 5000
  export const IP_LIMIT: number;               // 5
  export const IP_WINDOW_MS: number;           // 10 * 60 * 1000
  export const PENDING_LIMIT: number;          // 50
  export const USER_CODE_ALPHABET: string;     // 'BCDFGHJKLMNPQRSTVWXZ'
  export function normalizeIp(raw: string | null): string;
  export function ipHash(salt: string, ip: string): Promise<string>;
  export function makeUserCode(random: (n: number) => Uint8Array): string;
  export function normalizeUserCode(raw: string): string | null;
  export function formatUserCode(code: string): string;
  export function createDevice(req: Request, env: SyncEnv, deps: SyncDeps, body: unknown): Promise<Response>;
  export function cliEntry(req: Request, url: URL): string | null;   // CLI 분기면 로그용 패턴, 아니면 null
  export function handleCli(req: Request, env: SyncEnv, deps: SyncDeps, url: URL): Promise<Response>;
  ```
  - `handler.ts`: `Origin` 헤더가 **없고** `cliEntry`가 패턴을 주면 `handleCli`로 받는다. 그 밖은 지금처럼 403 `origin`.

- [ ] **Step 1: 실패하는 테스트 쓰기**

`sync-worker/src/cli.test.ts`의 맨 위 import를 아래로 바꾸고, 파일 끝에 테스트를 더한다.

```ts
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { harness, ORIGIN, type Harness } from '../test/harness';
import { IP_LIMIT, normalizeIp, PENDING_LIMIT } from './cli';

const j = async (r: Response) => ({ status: r.status, body: (await r.json()) as Record<string, any> });
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** Origin 없이(CLI처럼) 부른다 */
function cliCall(
  h: Harness,
  method: string,
  path: string,
  o: { token?: string; body?: unknown; ip?: string; cf?: { country?: string; city?: string }; headers?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = { ...o.headers };
  if (o.token) headers.Authorization = `Gazua-CLI ${o.token}`;
  if (o.ip) headers['CF-Connecting-IP'] = o.ip;
  return h.call(method, path, { origin: null, token: null, headers, body: o.body, cf: o.cf });
}
const device = (h: Harness, ip = '203.0.113.5', label = 'gazua@mac', cf?: { country?: string; city?: string }) =>
  cliCall(h, 'POST', '/v1/cli/device', { body: { label }, ip, cf });
const rows = (h: Harness, sql: string) => h.env.DB.raw.prepare(sql).all() as Record<string, any>[];
```

(Task 1에서 만든 `describe('0005 마이그레이션', …)` 블록은 그대로 둔다. 위 import가 앞의 두 import를 대체한다.)

```ts
describe('normalizeIp', () => {
  it.each([
    ['203.0.113.5', '203.0.113.5'],
    ['::ffff:203.0.113.5', '203.0.113.5'],
    ['2001:db8::2', 'v6:2001:0db8:0000:0000'],
    ['2001:0db8:0000:0000:aaaa::1', 'v6:2001:0db8:0000:0000'],
    ['2001:DB8:0:0:1:2:3:4', 'v6:2001:0db8:0000:0000'],
    ['::1', 'v6:0000:0000:0000:0000'],
    ['', 'unknown'],
    [null, 'unknown'],
  ])('%s → %s', (raw, want) => expect(normalizeIp(raw as string | null)).toBe(want));
});

describe('POST /v1/cli/device', () => {
  it('무인증으로 코드를 받고 DB에는 해시만 둔다', async () => {
    const h = harness();
    const r = await j(await device(h, '203.0.113.5', 'gazua@mac', { country: 'KR', city: 'Seoul' }));
    expect(r.status).toBe(200);
    expect(r.body.deviceCode).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r.body.userCode).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    expect(r.body.verifyUrl).toBe(`${ORIGIN}/#/settings/sync`);
    expect(r.body.interval).toBe(5);
    expect(r.body.expiresIn).toBe(600);
    const [row] = rows(h, 'SELECT * FROM cli_grants');
    expect(row).toMatchObject({
      device_hash: sha(r.body.deviceCode),
      user_code: (r.body.userCode as string).replace('-', ''),
      label: 'gazua@mac',
      status: 'pending',
      user_id: null,
      interval_ms: 5000,
      last_polled_at: null,
      consumed_token_hash: null,
      geo: 'KR · Seoul',
      created_at: h.clock.now,
      expires_at: h.clock.now + 600_000,
    });
    expect(row.ip_hash).toMatch(/^[0-9a-f]{64}$/);
    const dump = JSON.stringify(rows(h, 'SELECT * FROM cli_grants'));
    expect(dump).not.toContain(r.body.deviceCode);
    expect(dump).not.toContain('203.0.113.5');
    expect(h.logs.join('\n')).not.toContain(r.body.deviceCode);
  });

  it('위치 정보가 없으면 geo는 NULL, 길면 64자로 자른다', async () => {
    const h = harness();
    await device(h);
    await device(h, '203.0.113.6', 'gazua@mac', { country: 'KR', city: 'x'.repeat(100) });
    const geos = rows(h, 'SELECT geo FROM cli_grants ORDER BY created_at, rowid').map((r) => r.geo);
    expect(geos[0]).toBeNull();
    expect(geos[1]).toHaveLength(64);
  });

  it('label은 1~64자 문자열만 받는다(422 invalid)', async () => {
    const h = harness();
    for (const label of [undefined, '', '   ', 7, 'x'.repeat(65), 'a\nb']) {
      const r = await j(await cliCall(h, 'POST', '/v1/cli/device', { body: { label }, ip: '203.0.113.5' }));
      expect(r.status).toBe(422);
      expect(r.body.error).toBe('invalid');
    }
    expect((await device(h, '203.0.113.5', 'x'.repeat(64))).status).toBe(200);
  });

  it('CLI_IP_SALT가 없으면 503 cli-disabled', async () => {
    const h = harness();
    delete h.env.CLI_IP_SALT;
    const r = await j(await device(h));
    expect(r.status).toBe(503);
    expect(r.body.error).toBe('cli-disabled');
  });

  it('허용 Origin으로 부르면 404, Origin 없는 다른 요청은 지금처럼 403 origin', async () => {
    const h = harness();
    expect((await h.call('POST', '/v1/cli/device', { body: { label: 'x' } })).status).toBe(404);
    const other = await j(await h.call('GET', '/v1/profiles', { origin: null, token: 'abc' }));
    expect(other.status).toBe(403);
    expect(other.body.error).toBe('origin');
    const wrongOrigin = await j(await h.call('POST', '/v1/cli/device', { origin: 'https://evil.example.test', body: { label: 'x' } }));
    expect(wrongOrigin.status).toBe(403);
  });

  it('같은 IP 6번째는 429 rate-limited + Retry-After', async () => {
    const h = harness();
    for (let i = 0; i < IP_LIMIT; i++) expect((await device(h)).status).toBe(200);
    const sixth = await device(h);
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get('Retry-After')).toBe('60');
    expect((await sixth.json()).error).toBe('rate-limited');
    expect((await device(h, '203.0.113.99')).status).toBe(200);
    h.clock.now += 10 * 60_000 + 1;
    expect((await device(h)).status).toBe(200);
  });

  it('전체 pending 51번째는 429', async () => {
    const h = harness();
    for (let i = 0; i < PENDING_LIMIT; i++) expect((await device(h, `198.51.100.${i}`)).status).toBe(200);
    expect((await device(h, '198.51.100.200')).status).toBe(429);
    h.clock.now += 10 * 60_000 + 1; // 모두 만료
    expect((await device(h, '198.51.100.200')).status).toBe(200);
  });

  it('겹친 넣기도 한도를 넘지 않는다', async () => {
    const h = harness();
    for (let i = 0; i < IP_LIMIT - 1; i++) await device(h);
    const statuses = (await Promise.all([device(h), device(h), device(h)])).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 429, 429]);
    expect(rows(h, 'SELECT count(*) AS n FROM cli_grants')[0].n).toBe(IP_LIMIT);
  });

  it('같은 IPv6 /64와 IPv4-mapped는 같은 묶음, 헤더가 없으면 unknown 묶음', async () => {
    const h = harness();
    await device(h, '2001:0db8:0000:0000:aaaa::1');
    await device(h, '2001:db8::2');
    await device(h, '2001:DB8:0:0:1:2:3:4');
    await device(h, '::ffff:203.0.113.5');
    await device(h, '203.0.113.5');
    await cliCall(h, 'POST', '/v1/cli/device', { body: { label: 'x' } });
    await device(h, '2001:db8:0:1::1');
    const counts = rows(h, 'SELECT count(*) AS n FROM cli_grants GROUP BY ip_hash ORDER BY n DESC').map((r) => r.n);
    expect(counts).toEqual([3, 2, 1, 1]);
  });

  it('사용자 코드가 겹치면 다시 만든다', async () => {
    const h = harness();
    // random 호출 순서: 기기 코드(1), 사용자 코드(2) / 기기 코드(3), 사용자 코드(4: 겹침), 사용자 코드(5)
    const script = [1, 0, 2, 0, 5].map((v) => new Uint8Array(32).fill(v));
    let n = 0;
    h.deps.random = () => script[n++];
    expect((await j(await device(h, '203.0.113.5'))).body.userCode).toBe('BBBB-BBBB');
    expect((await j(await device(h, '203.0.113.6'))).body.userCode).toBe('HHHH-HHHH');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd sync-worker && npx vitest run src/cli.test.ts`
Expected: FAIL — `./cli`를 찾을 수 없다(`Failed to resolve import "./cli"`).

- [ ] **Step 3: 최소 구현**

`sync-worker/src/cli.ts`를 새로 만든다.

```ts
// 읽기 전용 CLI(설계 2026-11-01-readonly-cli): 기기 코드 로그인, CLI 토큰 인증, 읽기 전용 허용 목록.
// 원문 기기 코드·토큰은 D1에 두지 않는다(SHA-256 hex만). 원 IP도 두지 않는다(HMAC-SHA256 hex만).
import { base64url, errorBody, HttpError, json, readJson, sha256Hex } from '@sch0718/firebase-session/worker';
import type { SyncDeps, SyncEnv } from './env';

export const CLI_GRANT_TTL = 10 * 60 * 1000;
export const POLL_INTERVAL_MS = 5000;
export const IP_LIMIT = 5;
export const IP_WINDOW_MS = 10 * 60 * 1000;
export const PENDING_LIMIT = 50;
export const CLI_LABEL_MAX = 64;
export const GEO_MAX = 64;
export const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
const USER_CODE_RE = /^[BCDFGHJKLMNPQRSTVWXZ]{8}$/;

type Row = Record<string, unknown>;
const isRecord = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v);

function expandV6(ip: string): string[] | null {
  const parts = ip.split('::');
  if (parts.length > 2) return null;
  const side = (s: string) => (s === '' ? [] : s.split(':'));
  const head = side(parts[0]);
  const tail = parts.length === 2 ? side(parts[1]) : [];
  const fill = 8 - head.length - tail.length;
  if (parts.length === 1 ? head.length !== 8 : fill < 0) return null;
  const groups = parts.length === 1 ? head : [...head, ...Array<string>(fill).fill('0'), ...tail];
  return groups.every((g) => /^[0-9a-f]{1,4}$/.test(g)) ? groups : null;
}

/** 횟수 제한 묶음 키. IPv6는 앞 4그룹(/64), IPv4-mapped는 IPv4, 없으면 'unknown' */
export function normalizeIp(raw: string | null): string {
  const ip = (raw ?? '').trim().toLowerCase().replace(/%.*$/, '');
  if (ip === '') return 'unknown';
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mapped) return mapped[1];
  if (!ip.includes(':')) return ip;
  const groups = expandV6(ip);
  return groups ? `v6:${groups.slice(0, 4).map((g) => g.padStart(4, '0')).join(':')}` : ip;
}

export async function ipHash(salt: string, ip: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(salt), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ip));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 자음 20자에서 8자. 바이트 240 이상은 버려 치우침을 없앤다 */
export function makeUserCode(random: (n: number) => Uint8Array): string {
  let out = '';
  while (out.length < 8) {
    for (const b of random(32)) {
      if (b < 240 && out.length < 8) out += USER_CODE_ALPHABET[b % USER_CODE_ALPHABET.length];
    }
  }
  return out;
}

export function normalizeUserCode(raw: string): string | null {
  const code = raw.toUpperCase().replace(/[\s-]/g, '');
  return USER_CODE_RE.test(code) ? code : null;
}

export const formatUserCode = (code: string): string => `${code.slice(0, 4)}-${code.slice(4)}`;

function geoOf(req: Request): string | null {
  const cf = (req as Request & { cf?: { country?: unknown; city?: unknown } }).cf;
  const parts = [cf?.country, cf?.city].filter((p): p is string => typeof p === 'string' && p !== '');
  return parts.length ? parts.join(' · ').slice(0, GEO_MAX) : null;
}

function verifyUrl(env: SyncEnv): string {
  const first = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).find(Boolean) ?? '';
  return `${first.replace(/\/+$/, '')}/#/settings/sync`;
}

function checkLabel(body: unknown): string {
  const label = isRecord(body) && typeof body.label === 'string' ? body.label.trim() : '';
  // eslint-disable-next-line no-control-regex
  if (label === '' || label.length > CLI_LABEL_MAX || /[\u0000-\u001f\u007f]/.test(label)) throw new HttpError(422, 'invalid', { path: 'label' });
  return label;
}

const INSERT_GRANT = `
  INSERT INTO cli_grants (id, device_hash, user_code, label, ip_hash, status, user_id, interval_ms, last_polled_at, consumed_token_hash, geo, created_at, expires_at)
  SELECT ?, ?, ?, ?, ?, 'pending', NULL, ?, NULL, NULL, ?, ?, ?
  WHERE (SELECT count(*) FROM cli_grants WHERE ip_hash = ? AND created_at > ?) < ?
    AND (SELECT count(*) FROM cli_grants WHERE status = 'pending' AND expires_at > ?) < ?`;

const isUserCodeCollision = (e: unknown) => e instanceof Error && /UNIQUE constraint failed: cli_grants\.user_code/i.test(e.message);

/** 기기 코드와 사용자 코드를 만든다. 한도는 넣기 문장 안에서 센다(겹친 요청 둘이 함께 지나가지 않게) */
export async function createDevice(req: Request, env: SyncEnv, deps: SyncDeps, body: unknown): Promise<Response> {
  const salt = env.CLI_IP_SALT;
  if (!salt) throw new HttpError(503, 'cli-disabled');
  const label = checkLabel(body);
  const now = deps.now();
  const ip = await ipHash(salt, normalizeIp(req.headers.get('CF-Connecting-IP')));
  const deviceCode = base64url(deps.random(32));
  const deviceHash = await sha256Hex(deviceCode);
  const geo = geoOf(req);
  for (let attempt = 0; attempt < 5; attempt++) {
    const userCode = makeUserCode(deps.random);
    try {
      const r = await env.DB.prepare(INSERT_GRANT)
        .bind(deps.uuid(), deviceHash, userCode, label, ip, POLL_INTERVAL_MS, geo, now, now + CLI_GRANT_TTL, ip, now - IP_WINDOW_MS, IP_LIMIT, now, PENDING_LIMIT)
        .run();
      if (r.meta.changes === 0) return json(429, errorBody('rate-limited'), { 'Retry-After': '60' });
      return json(200, { deviceCode, userCode: formatUserCode(userCode), verifyUrl: verifyUrl(env), interval: POLL_INTERVAL_MS / 1000, expiresIn: CLI_GRANT_TTL / 1000 });
    } catch (e) {
      if (!isUserCodeCollision(e)) throw e;
    }
  }
  throw new Error('cli: user code collision');
}

/** Origin 없는 요청 중 CLI 분기로 받을 것이면 로그에 남길 패턴, 아니면 null */
export function cliEntry(req: Request, url: URL): string | null {
  if (req.method === 'POST' && url.pathname === '/v1/cli/device') return '/v1/cli/device';
  return null;
}

export async function handleCli(req: Request, env: SyncEnv, deps: SyncDeps, url: URL): Promise<Response> {
  void url;
  return createDevice(req, env, deps, await readJson(req, 4096));
}
```

`sync-worker/src/handler.ts`를 고친다.

1. import에 `./cli`를 더한다(`import { ALLOWED_HEADERS, … } from './cors';` 바로 위).

```ts
import { cliEntry, handleCli } from './cli';
```

2. `handle` 함수 전체(`export async function handle(` 부터 파일 끝까지)를 아래로 바꾼다. 오류를 응답으로 바꾸는 부분을 `guard`로 빼서 CLI 분기와 앱 분기가 함께 쓴다. 앱 경로의 동작은 그대로다.

```ts
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
    const r = route(req.method, url.pathname);
    res = await guard(req, deps, () => pattern, async () => {
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
```

- [ ] **Step 4: 통과 확인**

Run: `cd sync-worker && npx vitest run && npx tsc -p tsconfig.json --noEmit`
Expected: PASS(기존 테스트 포함 전부 — 앱 경로 동작이 그대로인지 `session.test.ts`·`profiles.test.ts`가 확인한다), tsc 오류 없음.

- [ ] **Step 5: 커밋**

```bash
git add sync-worker/src/cli.ts sync-worker/src/cli.test.ts sync-worker/src/handler.ts
git commit -m "feat(sync-worker): CLI 기기 코드 발급(POST /v1/cli/device)을 더함"
```

---

## Task 3: 승인 `POST /v1/cli/approve`(조회·승인 두 단계)

**Files:**
- Modify: `sync-worker/src/cli.ts`(끝에 함수 더하기, import 줄에 `AuthContext` 더하기)
- Modify: `sync-worker/src/handler.ts`(import 줄, `ROUTES` 끝 `['GET', /^\/v1\/public\/share$/ …]` 줄 바로 위)
- Modify: `sync-worker/src/cli.test.ts`

**Interfaces:**
- Consumes: Task 2의 `normalizeUserCode`; `authed()`가 만드는 `AuthContext`(`ctx.userId`); `HttpError`.
- Produces:
  ```ts
  export function approveCli(env: SyncEnv, deps: SyncDeps, ctx: AuthContext, body: unknown):
    Promise<{ label: string; createdAt: number; geo: string | null } | { label: string; createdAt: number }>;
  ```
  - `body.approve`가 없으면 조회(상태 그대로, `{ label, createdAt, geo }`). `true`/`false`면 `pending`일 때만 `approved`/`denied`로 바꾸고 `user_id`를 기록, 응답 `{ label, createdAt }`. 없음·만료·이미 처리·모양 틀림이면 422 `invalid-code`.
  - 앱 라우트 `POST /v1/cli/approve`(`authed`, 본문 4096바이트 상한).

- [ ] **Step 1: 실패하는 테스트 쓰기**

`cli.test.ts` 끝에 더한다.

```ts
describe('POST /v1/cli/approve', () => {
  async function pending(h: Harness, cf?: { country?: string; city?: string }) {
    const me = await h.login();
    const d = (await j(await device(h, '203.0.113.5', 'gazua@macbook', cf))).body;
    return { me, d };
  }

  it('조회는 상태를 바꾸지 않고 label·createdAt·geo를 돌려준다', async () => {
    const h = harness();
    const { me, d } = await pending(h, { country: 'KR', city: 'Seoul' });
    const r = await j(await me.as('POST', '/v1/cli/approve', { userCode: d.userCode }));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ label: 'gazua@macbook', createdAt: h.clock.now, geo: 'KR · Seoul' });
    expect(rows(h, 'SELECT status, user_id FROM cli_grants')).toEqual([{ status: 'pending', user_id: null }]);
  });

  it('소문자·하이픈 없는 코드도 받는다. geo가 없으면 null', async () => {
    const h = harness();
    const { me, d } = await pending(h);
    const typed = (d.userCode as string).replace('-', '').toLowerCase();
    const r = await j(await me.as('POST', '/v1/cli/approve', { userCode: typed }));
    expect(r.body.geo).toBeNull();
  });

  it('approve:true는 approved + 승인한 사용자를 기록, 응답은 {label, createdAt}', async () => {
    const h = harness();
    const { me, d } = await pending(h);
    const r = await j(await me.as('POST', '/v1/cli/approve', { userCode: d.userCode, approve: true }));
    expect(r.body).toEqual({ label: 'gazua@macbook', createdAt: h.clock.now });
    const userId = (rows(h, 'SELECT id FROM users')[0] as { id: string }).id;
    expect(rows(h, 'SELECT status, user_id FROM cli_grants')).toEqual([{ status: 'approved', user_id: userId }]);
  });

  it('approve:false는 denied', async () => {
    const h = harness();
    const { me, d } = await pending(h);
    expect((await me.as('POST', '/v1/cli/approve', { userCode: d.userCode, approve: false })).status).toBe(200);
    expect(rows(h, 'SELECT status FROM cli_grants')).toEqual([{ status: 'denied' }]);
  });

  it('없는 코드·틀린 모양·이미 처리·만료는 422 invalid-code', async () => {
    const h = harness();
    const { me, d } = await pending(h);
    for (const userCode of ['ZZZZ-ZZZZ', 'abc', 'AEIO-UAEI', '']) {
      const r = await j(await me.as('POST', '/v1/cli/approve', { userCode }));
      expect(r).toMatchObject({ status: 422, body: { error: 'invalid-code' } });
    }
    await me.as('POST', '/v1/cli/approve', { userCode: d.userCode, approve: true });
    expect((await me.as('POST', '/v1/cli/approve', { userCode: d.userCode, approve: false })).status).toBe(422);
    expect((await me.as('POST', '/v1/cli/approve', { userCode: d.userCode })).status).toBe(422);
    const h2 = harness();
    const p2 = await pending(h2);
    h2.clock.now += 600_000;
    expect((await p2.me.as('POST', '/v1/cli/approve', { userCode: p2.d.userCode, approve: true })).status).toBe(422);
  });

  it('approve가 불리언이 아니면 422 invalid', async () => {
    const h = harness();
    const { me, d } = await pending(h);
    const r = await j(await me.as('POST', '/v1/cli/approve', { userCode: d.userCode, approve: 'yes' }));
    expect(r).toMatchObject({ status: 422, body: { error: 'invalid' } });
  });

  it('앱 세션 없이는 승인하지 못한다', async () => {
    const h = harness();
    const d = (await j(await device(h))).body;
    expect((await h.call('POST', '/v1/cli/approve', { body: { userCode: d.userCode, approve: true } })).status).toBe(401);
    expect(rows(h, 'SELECT status FROM cli_grants')).toEqual([{ status: 'pending' }]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd sync-worker && npx vitest run src/cli.test.ts -t "approve"`
Expected: FAIL — 라우트가 없어 모두 `expected 404 to be 200` 같은 상태 불일치.

- [ ] **Step 3: 최소 구현**

`cli.ts` 상단 import에 `AuthContext`를 더한다.

```ts
import type { SyncDeps, SyncEnv } from './env';
import type { AuthContext } from './session';
```

`cli.ts` 끝에(`cliEntry` 위든 아래든 상관없이) 더한다.

```ts
/**
 * 앱 세션 사용자가 코드를 확인(approve 없음: 조회만)하거나 승인·거절한다.
 * 없음·만료·이미 처리된 코드는 모두 422 invalid-code(어느 경우인지 알려 주지 않는다).
 */
export async function approveCli(env: SyncEnv, deps: SyncDeps, ctx: AuthContext, body: unknown) {
  const b = isRecord(body) ? body : {};
  if (typeof b.userCode !== 'string') throw new HttpError(422, 'invalid', { path: 'userCode' });
  const code = normalizeUserCode(b.userCode);
  if (code === null) throw new HttpError(422, 'invalid-code');
  if (b.approve !== undefined && typeof b.approve !== 'boolean') throw new HttpError(422, 'invalid', { path: 'approve' });
  const now = deps.now();
  const row = await env.DB.prepare(
    `SELECT id, label, created_at AS createdAt, geo FROM cli_grants WHERE user_code = ? AND status = 'pending' AND expires_at > ?`,
  )
    .bind(code, now)
    .first<{ id: string; label: string; createdAt: number; geo: string | null }>();
  if (!row) throw new HttpError(422, 'invalid-code');
  if (b.approve === undefined) return { label: row.label, createdAt: row.createdAt, geo: row.geo };
  const r = await env.DB.prepare(`UPDATE cli_grants SET status = ?, user_id = ? WHERE id = ? AND status = 'pending' AND expires_at > ?`)
    .bind(b.approve ? 'approved' : 'denied', ctx.userId, row.id, now)
    .run();
  if (r.meta.changes === 0) throw new HttpError(422, 'invalid-code');
  return { label: row.label, createdAt: row.createdAt };
}
```

`handler.ts`: import를 고치고 라우트를 더한다.

```ts
import { approveCli, cliEntry, handleCli } from './cli';
```

`ROUTES`에서 `['GET', /^\/v1\/public\/share$/ …` 줄 바로 위에 더한다.

```ts
  ['POST', /^\/v1\/cli\/approve$/, '/v1/cli/approve', authed(async ({ req, env, deps, ctx }) => ok(await approveCli(env, deps, ctx, await readJson(req, 4096))))],
```

- [ ] **Step 4: 통과 확인**

Run: `cd sync-worker && npx vitest run && npx tsc -p tsconfig.json --noEmit`
Expected: PASS, tsc 오류 없음.

- [ ] **Step 5: 커밋**

```bash
git add sync-worker/src/cli.ts sync-worker/src/handler.ts sync-worker/src/cli.test.ts
git commit -m "feat(sync-worker): CLI 연결 승인(POST /v1/cli/approve)을 두 단계로 더함"
```

---

## Task 4: 폴링 `POST /v1/cli/token`(한 번만 주기)

**Files:**
- Modify: `sync-worker/src/cli.ts`(상수·함수 더하기, `cliEntry`·`handleCli` 바꾸기)
- Modify: `sync-worker/src/cli.test.ts`

**Interfaces:**
- Consumes: Task 2·3의 상수, `deps.random`, `deps.uuid`, `sha256Hex`, `base64url`, `DAY`(`./env`).
- Produces:
  ```ts
  export const TOKEN_TTL: number;           // 90 * DAY
  export const INTERVAL_STEP_MS: number;    // 5000
  export const INTERVAL_CAP_MS: number;     // 60000
  export function pollToken(env: SyncEnv, deps: SyncDeps, body: unknown): Promise<{ token: string; tokenId: string; expiresAt: number }>;
  ```
  - 응답 규칙(순서): 기기 코드 모양이 아니면 422 `invalid`(`path: 'deviceCode'`); 모르는 코드 404 `unknown-device`; `consumed` 또는 `expires_at <= now` 410 `expired`; `denied` 403 `denied`; `pending`은 조건부 UPDATE로 간격 확인 → 바뀐 행이 있으면 400 `pending`, 없으면 400 `slow_down`(`interval_ms < 60000`이면 `interval_ms += 5000`, 본문 `{ error: 'slow_down', interval: <초> }`); `approved`는 토큰 만들기(한 번만).
  - `cliEntry`는 `POST /v1/cli/token`도 받는다.

- [ ] **Step 1: 실패하는 테스트 쓰기**

`cli.test.ts`의 import에 `TOKEN_TTL`을 더하고(`import { IP_LIMIT, normalizeIp, PENDING_LIMIT, TOKEN_TTL } from './cli';`) 끝에 더한다.

```ts
const poll = (h: Harness, deviceCode: string) => cliCall(h, 'POST', '/v1/cli/token', { body: { deviceCode } });

describe('POST /v1/cli/token', () => {
  async function approved(h: Harness) {
    const me = await h.login();
    const d = (await j(await device(h))).body;
    await me.as('POST', '/v1/cli/approve', { userCode: d.userCode, approve: true });
    return { me, d };
  }

  it('흐름: device → pending → 조회 → 승인 → 토큰 한 번 → 다시 410', async () => {
    const h = harness();
    const me = await h.login();
    const d = (await j(await device(h))).body;
    expect(await j(await poll(h, d.deviceCode))).toMatchObject({ status: 400, body: { error: 'pending' } });
    await me.as('POST', '/v1/cli/approve', { userCode: d.userCode }); // 조회: 상태 그대로
    h.clock.now += 5000;
    expect((await j(await poll(h, d.deviceCode))).body.error).toBe('pending');
    await me.as('POST', '/v1/cli/approve', { userCode: d.userCode, approve: true });
    const t = await j(await poll(h, d.deviceCode));
    expect(t.status).toBe(200);
    expect(t.body.token).toMatch(/^gzc_[A-Za-z0-9_-]{43}$/);
    expect(t.body.expiresAt).toBe(h.clock.now + TOKEN_TTL);
    expect(typeof t.body.tokenId).toBe('string');
    const [tok] = rows(h, 'SELECT * FROM cli_tokens');
    expect(tok).toMatchObject({ id: t.body.tokenId, token_hash: sha(t.body.token), label: 'gazua@mac', scope: 'read', revoked_at: null, last_used_at: h.clock.now });
    expect(JSON.stringify(rows(h, 'SELECT * FROM cli_tokens'))).not.toContain(t.body.token);
    expect(JSON.stringify(rows(h, 'SELECT * FROM cli_grants'))).not.toContain(t.body.token);
    expect(await j(await poll(h, d.deviceCode))).toMatchObject({ status: 410, body: { error: 'expired' } });
    expect(rows(h, 'SELECT count(*) AS n FROM cli_tokens')[0].n).toBe(1);
    expect(h.logs.join('\n')).not.toContain(t.body.token);
  });

  it('거절하면 403 denied', async () => {
    const h = harness();
    const me = await h.login();
    const d = (await j(await device(h))).body;
    await me.as('POST', '/v1/cli/approve', { userCode: d.userCode, approve: false });
    expect(await j(await poll(h, d.deviceCode))).toMatchObject({ status: 403, body: { error: 'denied' } });
    expect(rows(h, 'SELECT count(*) AS n FROM cli_tokens')[0].n).toBe(0);
  });

  it('모르는 기기 코드는 404 unknown-device, 모양이 틀리면 422', async () => {
    const h = harness();
    expect(await j(await poll(h, 'A'.repeat(43)))).toMatchObject({ status: 404, body: { error: 'unknown-device' } });
    expect((await j(await poll(h, 'short'))).status).toBe(422);
    expect((await j(await cliCall(h, 'POST', '/v1/cli/token', { body: {} }))).status).toBe(422);
  });

  it('10분이 지나면 410 expired(승인 전·승인 뒤 모두), approve는 422', async () => {
    const h = harness();
    const me = await h.login();
    const a = (await j(await device(h, '203.0.113.5'))).body;
    const b = (await j(await device(h, '203.0.113.6'))).body;
    await me.as('POST', '/v1/cli/approve', { userCode: b.userCode, approve: true });
    h.clock.now += 600_000;
    expect((await j(await poll(h, a.deviceCode))).status).toBe(410);
    expect((await j(await poll(h, b.deviceCode))).status).toBe(410);
    expect(rows(h, 'SELECT count(*) AS n FROM cli_tokens')[0].n).toBe(0);
    expect((await me.as('POST', '/v1/cli/approve', { userCode: a.userCode, approve: true })).status).toBe(422);
  });

  it('간격 안의 두 번째 폴링은 400 slow_down이고 저장 간격이 5초 늘어난다', async () => {
    const h = harness();
    const d = (await j(await device(h))).body;
    expect((await j(await poll(h, d.deviceCode))).body.error).toBe('pending');
    const slow = await j(await poll(h, d.deviceCode));
    expect(slow).toMatchObject({ status: 400, body: { error: 'slow_down', interval: 10 } });
    expect(rows(h, 'SELECT interval_ms FROM cli_grants')).toEqual([{ interval_ms: 10_000 }]);
    h.clock.now += 5000; // 늘어난 간격(10초) 전이라 아직 빠르다
    expect((await j(await poll(h, d.deviceCode))).body.error).toBe('slow_down');
    h.clock.now += 20_000;
    expect((await j(await poll(h, d.deviceCode))).body.error).toBe('pending');
  });

  it('interval_ms가 60000 이상이면 slow_down만 답하고 간격은 그대로', async () => {
    const h = harness();
    const d = (await j(await device(h))).body;
    h.env.DB.raw.prepare('UPDATE cli_grants SET interval_ms = 60000').run();
    await poll(h, d.deviceCode);
    const slow = await j(await poll(h, d.deviceCode));
    expect(slow).toMatchObject({ status: 400, body: { error: 'slow_down', interval: 60 } });
    expect(rows(h, 'SELECT interval_ms FROM cli_grants')).toEqual([{ interval_ms: 60_000 }]);
    h.env.DB.raw.prepare('UPDATE cli_grants SET interval_ms = 57000').run();
    h.clock.now += 100_000;
    await poll(h, d.deviceCode);
    await poll(h, d.deviceCode);
    expect(rows(h, 'SELECT interval_ms FROM cli_grants')).toEqual([{ interval_ms: 62_000 }]);
  });

  it('겹친 폴링 둘 중 하나만 토큰을 받고 cli_tokens 행은 1개, 다른 하나는 410', async () => {
    const h = harness();
    const { d } = await approved(h);
    // 첫 폴링이 batch를 실행하기 직전에 두 번째 폴링을 끝까지 끼워 넣는다(둘 다 approved 상태를 읽은 뒤)
    const realBatch = h.env.DB.batch.bind(h.env.DB);
    let second: Promise<Response> | null = null;
    h.env.DB.batch = async (statements) => {
      if (second === null) {
        second = poll(h, d.deviceCode);
        await second;
      }
      return realBatch(statements);
    };
    const first = await poll(h, d.deviceCode);
    const results = [await j(first), await j(await second!)];
    expect(results.map((r) => r.status).sort()).toEqual([200, 410]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rows(h, 'SELECT count(*) AS n FROM cli_tokens')[0].n).toBe(1);
    const winner = results.find((r) => r.status === 200)!.body;
    expect(rows(h, 'SELECT token_hash FROM cli_tokens')[0].token_hash).toBe(sha(winner.token));
    expect(rows(h, 'SELECT consumed_token_hash, status FROM cli_grants')).toEqual([{ consumed_token_hash: sha(winner.token), status: 'consumed' }]);
  });

  it('읽은 뒤 batch 직전에 만료되면 토큰을 만들지 않는다(UPDATE의 만료 조건)', async () => {
    const h = harness();
    const { d } = await approved(h);
    const realBatch = h.env.DB.batch.bind(h.env.DB);
    h.env.DB.batch = async (statements) => {
      // pollToken이 grant를 읽은 뒤 batch가 실행되기 전에 만료 시각이 지금이 됐다고 본다(expires_at > now가 거짓)
      h.env.DB.raw.prepare('UPDATE cli_grants SET expires_at = ?').run(h.clock.now);
      return realBatch(statements);
    };
    expect(await j(await poll(h, d.deviceCode))).toMatchObject({ status: 410, body: { error: 'expired' } });
    expect(rows(h, 'SELECT count(*) AS n FROM cli_tokens')[0].n).toBe(0);
    expect(rows(h, 'SELECT status, consumed_token_hash FROM cli_grants')).toEqual([{ status: 'approved', consumed_token_hash: null }]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd sync-worker && npx vitest run src/cli.test.ts -t "token"`
Expected: FAIL — `TOKEN_TTL`을 `./cli`에서 가져오지 못하거나(`undefined`), `POST /v1/cli/token`이 403 `origin`을 돌려줘 상태 불일치.

- [ ] **Step 3: 최소 구현**

`cli.ts`의 import를 고친다.

```ts
import { DAY, type SyncDeps, type SyncEnv } from './env';
```

상수를 더한다(`GEO_MAX` 근처).

```ts
export const TOKEN_TTL = 90 * DAY;
export const INTERVAL_STEP_MS = 5000;
export const INTERVAL_CAP_MS = 60_000;
```

`cli.ts`에 함수를 더한다.

```ts
/**
 * 기기 코드를 폴링한다. 승인된 코드를 받으면 토큰을 만든다. 겹친 폴링 둘 중 하나만 받도록 세 단계로 한다:
 * ① batch(조건부 UPDATE로 consumed 표시 + EXISTS 조건 INSERT) ② consumed_token_hash를 다시 읽어 내 해시일 때만 ③ 아니면 410.
 */
export async function pollToken(env: SyncEnv, deps: SyncDeps, body: unknown): Promise<{ token: string; tokenId: string; expiresAt: number }> {
  const b = isRecord(body) ? body : {};
  if (typeof b.deviceCode !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(b.deviceCode)) throw new HttpError(422, 'invalid', { path: 'deviceCode' });
  const now = deps.now();
  const g = await env.DB.prepare(
    `SELECT id, status, user_id AS userId, label, interval_ms AS intervalMs, expires_at AS expiresAt FROM cli_grants WHERE device_hash = ?`,
  )
    .bind(await sha256Hex(b.deviceCode))
    .first<{ id: string; status: string; userId: string | null; label: string; intervalMs: number; expiresAt: number }>();
  if (!g) throw new HttpError(404, 'unknown-device');
  if (g.status === 'consumed' || g.expiresAt <= now) throw new HttpError(410, 'expired');
  if (g.status === 'denied') throw new HttpError(403, 'denied');

  if (g.status === 'pending') {
    // 간격이 지났으면 last_polled_at을 지금으로. 바뀐 행이 0이면 너무 빠른 폴링이다
    const r = await env.DB.prepare(
      `UPDATE cli_grants SET last_polled_at = ? WHERE id = ? AND status = 'pending' AND (last_polled_at IS NULL OR last_polled_at + interval_ms <= ?)`,
    )
      .bind(now, g.id, now)
      .run();
    if (r.meta.changes > 0) throw new HttpError(400, 'pending');
    const grow = g.intervalMs < INTERVAL_CAP_MS;
    if (grow) await env.DB.prepare('UPDATE cli_grants SET interval_ms = interval_ms + ? WHERE id = ? AND interval_ms < ?').bind(INTERVAL_STEP_MS, g.id, INTERVAL_CAP_MS).run();
    throw new HttpError(400, 'slow_down', { interval: (g.intervalMs + (grow ? INTERVAL_STEP_MS : 0)) / 1000 });
  }

  const token = `gzc_${base64url(deps.random(32))}`;
  const hash = await sha256Hex(token);
  const tokenId = deps.uuid();
  const expiresAt = now + TOKEN_TTL;
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE cli_grants SET status = 'consumed', consumed_token_hash = ? WHERE id = ? AND status = 'approved' AND consumed_token_hash IS NULL AND expires_at > ?`,
    ).bind(hash, g.id, now),
    env.DB.prepare(
      `INSERT INTO cli_tokens (id, token_hash, user_id, label, scope, created_at, last_used_at, expires_at, revoked_at)
       SELECT ?, ?, ?, ?, 'read', ?, ?, ?, NULL WHERE EXISTS (SELECT 1 FROM cli_grants WHERE id = ? AND consumed_token_hash = ?)`,
    ).bind(tokenId, hash, g.userId, g.label, now, now, expiresAt, g.id, hash),
  ]);
  const mine = await env.DB.prepare('SELECT consumed_token_hash AS hash FROM cli_grants WHERE id = ?').bind(g.id).first<{ hash: string | null }>();
  if (mine?.hash !== hash) throw new HttpError(410, 'expired');
  return { token, tokenId, expiresAt };
}
```

`cliEntry`·`handleCli`를 아래로 바꾼다.

```ts
/** Origin 없는 요청 중 CLI 분기로 받을 것이면 로그에 남길 패턴, 아니면 null */
export function cliEntry(req: Request, url: URL): string | null {
  if (req.method === 'POST' && url.pathname === '/v1/cli/device') return '/v1/cli/device';
  if (req.method === 'POST' && url.pathname === '/v1/cli/token') return '/v1/cli/token';
  return null;
}

export async function handleCli(req: Request, env: SyncEnv, deps: SyncDeps, url: URL): Promise<Response> {
  if (req.method === 'POST' && url.pathname === '/v1/cli/device') return createDevice(req, env, deps, await readJson(req, 4096));
  return json(200, await pollToken(env, deps, await readJson(req, 4096)));
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd sync-worker && npx vitest run && npx tsc -p tsconfig.json --noEmit`
Expected: PASS, tsc 오류 없음. (겹친 폴링 테스트가 불안정하면 `h.env.DB.batch` 가로채기가 첫 `batch`에서만 한 번 끼어드는지부터 본다.)

- [ ] **Step 5: 커밋**

```bash
git add sync-worker/src/cli.ts sync-worker/src/cli.test.ts
git commit -m "feat(sync-worker): CLI 토큰 폴링(POST /v1/cli/token)을 한 번만 주도록 더함"
```

---

## Task 5: CLI 토큰 인증·읽기 전용 강제·자기 토큰 철회·앱용 목록/철회·정리

**Files:**
- Modify: `sync-worker/src/cli.ts`(import, 함수, `cliEntry`·`handleCli` 바꾸기)
- Modify: `sync-worker/src/handler.ts`(import, `ROUTES`에 두 줄)
- Modify: `sync-worker/src/purge.ts`(정리 문장 + 반환 타입)
- Modify: `sync-worker/src/purge.test.ts`(`:41`의 `toEqual`, 새 테스트)
- Modify: `sync-worker/src/worker.ts`(로그 줄)
- Modify: `sync-worker/src/cli.test.ts`

**Interfaces:**
- Consumes: `listProfiles(env, ctx)`, `getProfile(env, ctx, id, docVersion)`, `requestDocVersion(url)`(`./profiles`); `parseAccountList`·`parseAllowList`(`@sch0718/firebase-session/worker`); `AuthContext`.
- Produces:
  ```ts
  export const CLI_TOUCH_INTERVAL: number;   // DAY
  export const CLI_TOKEN_RE: RegExp;         // /^gzc_[A-Za-z0-9_-]{43}$/
  export function cliScope(method: string, url: URL): 'profiles' | 'profile' | 'logout' | null;
  export function listCliTokens(env: SyncEnv, ctx: AuthContext, now: number): Promise<{ id: string; label: string; createdAt: number; lastUsedAt: number; expiresAt: number }[]>;
  export function revokeCliToken(env: SyncEnv, ctx: AuthContext, id: string, now: number): Promise<void>;
  // purge()의 반환에 cliGrants, cliTokens 추가
  export function purge(env: SyncEnv, now: number): Promise<{ profiles: number; shares: number; sessions: number; cliGrants: number; cliTokens: number }>;
  ```
  - `cliEntry`는 `Authorization`이 `Gazua-CLI `로 시작하면 패턴 `'cli-token'`을 준다.

- [ ] **Step 1: 실패하는 테스트 쓰기**

`cli.test.ts` 끝에 더한다.

```ts
async function connect(h: Harness, who?: { as: (m: string, p: string, b?: unknown) => Promise<Response> }, label = 'gazua@mac') {
  const me = who ?? (await h.login());
  const d = (await j(await cliCall(h, 'POST', '/v1/cli/device', { body: { label }, ip: '203.0.113.5' }))).body;
  await me.as('POST', '/v1/cli/approve', { userCode: d.userCode, approve: true });
  h.clock.now += 5000;
  const t = (await j(await poll(h, d.deviceCode))).body;
  return { me, token: t.token as string, tokenId: t.tokenId as string };
}

describe('CLI 토큰 인증과 읽기 전용 강제', () => {
  async function ready() {
    const h = harness();
    const c = await connect(h);
    await c.me.as('PUT', '/v1/profiles/p1', { opId: 'op-1', expectedRevision: 0, doc: doc() });
    return { h, ...c };
  }

  it('허용된 두 GET은 200', async () => {
    const { h, token } = await ready();
    const list = await j(await cliCall(h, 'GET', '/v1/profiles', { token }));
    expect(list.status).toBe(200);
    expect(list.body.profiles).toHaveLength(1);
    expect((await cliCall(h, 'GET', '/v1/profiles/p1?docVersion=2', { token })).status).toBe(200);
  });

  it('허용 밖은 라우터 전에 403 cli-scope', async () => {
    const { h, token } = await ready();
    const cases: [string, string][] = [
      ['GET', '/v1/profiles/p1'],
      ['GET', '/v1/profiles/p1?docVersion=1'],
      ['GET', '/v1/profiles/p1?docVersion=02'],
      ['GET', '/v1/profiles/p1?docVersion=2&docVersion=3'],
      ['HEAD', '/v1/profiles'],
      ['GET', '/v1/profiles/'],
      ['GET', '/v1/profiles/p1/revisions'],
      ['PUT', '/v1/profiles/p1?docVersion=2'],
      ['DELETE', '/v1/profiles/p1?docVersion=2'],
      ['GET', '/v1/keys'],
      ['POST', '/v1/shares'],
      ['GET', '/v1/sessions'],
      ['GET', '/v1/cli/tokens'],
      ['DELETE', '/v1/cli/tokens/x'],
      ['POST', '/v1/cli/approve'],
      ['DELETE', '/v1/cli/token/'],
    ];
    for (const [method, path] of cases) {
      const r = await j(await cliCall(h, method, path, { token, body: method === 'PUT' || method === 'POST' ? {} : undefined }));
      expect({ method, path, status: r.status, error: r.body.error }).toEqual({ method, path, status: 403, error: 'cli-scope' });
    }
  });

  it('토큰 모양이 틀리면 401 cli-token', async () => {
    const { h } = await ready();
    for (const token of ['x', 'gzc_short', `gzc_${'A'.repeat(44)}`, `abc_${'A'.repeat(43)}`]) {
      const r = await j(await cliCall(h, 'GET', '/v1/profiles', { token }));
      expect(r).toMatchObject({ status: 401, body: { error: 'cli-token' } });
    }
  });

  it('모르는 토큰·앱에서 철회한 토큰은 401 cli-token-revoked', async () => {
    const { h, token, tokenId, me } = await ready();
    expect(await j(await cliCall(h, 'GET', '/v1/profiles', { token: `gzc_${'A'.repeat(43)}` }))).toMatchObject({ status: 401, body: { error: 'cli-token-revoked' } });
    expect((await me.as('DELETE', `/v1/cli/tokens/${tokenId}`)).status).toBe(200);
    expect(await j(await cliCall(h, 'GET', '/v1/profiles', { token }))).toMatchObject({ status: 401, body: { error: 'cli-token-revoked' } });
  });

  it('만료 90일 직전까지는 200, 90일이 되면 401 cli-token-expired', async () => {
    const { h, token } = await ready();
    h.clock.now += 90 * DAY - 1;
    expect((await cliCall(h, 'GET', '/v1/profiles', { token })).status).toBe(200);
    h.clock.now += 1;
    expect(await j(await cliCall(h, 'GET', '/v1/profiles', { token }))).toMatchObject({ status: 401, body: { error: 'cli-token-expired' } });
  });

  it('DELETE /v1/cli/token은 요청에 쓴 그 토큰만 철회한다', async () => {
    const { h, token, me } = await ready();
    const second = await connect(h, me, 'gazua@pc');
    const r = await j(await cliCall(h, 'DELETE', '/v1/cli/token', { token }));
    expect(r).toMatchObject({ status: 200, body: { revoked: true } });
    expect((await cliCall(h, 'GET', '/v1/profiles', { token })).status).toBe(401);
    expect((await cliCall(h, 'GET', '/v1/profiles', { token: second.token })).status).toBe(200);
    expect((await cliCall(h, 'DELETE', '/v1/cli/token', { token })).status).toBe(401); // 이미 끊김
  });

  it('허용 Origin+세션으로 DELETE /v1/cli/token은 404', async () => {
    const { me } = await ready();
    expect((await me.as('DELETE', '/v1/cli/token')).status).toBe(404);
  });

  it('Origin이 있는 요청의 Gazua-CLI 헤더는 CLI 경로로 가지 않는다(세션 인증 실패)', async () => {
    const { h, token } = await ready();
    const r = await h.call('GET', '/v1/profiles', { token: null, headers: { Authorization: `Gazua-CLI ${token}` } });
    expect(r.status).toBe(401);
    expect(rows(h, 'SELECT count(*) AS n FROM cli_tokens WHERE revoked_at IS NULL')[0].n).toBe(1);
  });

  it('「다른 기기 모두 로그아웃」 뒤에도 CLI 토큰은 살아 있다', async () => {
    const { h, token, me } = await ready();
    await h.login(); // 두 번째 앱 세션
    const out = await j(await me.as('DELETE', '/v1/sessions?others=1'));
    expect(out.body.revoked).toBe(1);
    expect((await cliCall(h, 'GET', '/v1/profiles', { token })).status).toBe(200);
  });

  it('허용 목록에서 빠진 사용자는 403 not-allowed(이메일, kakao 소셜)', async () => {
    const h = harness();
    const { token } = await connect(h);
    h.env.ALLOWED_EMAILS = 'someone-else@example.test';
    expect(await j(await cliCall(h, 'GET', '/v1/profiles', { token }))).toMatchObject({ status: 403, body: { error: 'not-allowed' } });

    const s = harness({ social: true });
    const kakao = await s.socialLogin('kakao', 'kakao-me');
    const c = await connect(s, kakao);
    expect((await cliCall(s, 'GET', '/v1/profiles', { token: c.token })).status).toBe(200);
    s.env.ALLOWED_ACCOUNTS = 'kakao:someone-else';
    expect(await j(await cliCall(s, 'GET', '/v1/profiles', { token: c.token }))).toMatchObject({ status: 403, body: { error: 'not-allowed' } });
  });

  it('last_used_at은 하루에 한 번만 갱신한다', async () => {
    const { h, token } = await ready();
    const first = h.clock.now;
    h.clock.now += DAY - 1;
    await cliCall(h, 'GET', '/v1/profiles', { token });
    expect(rows(h, 'SELECT last_used_at FROM cli_tokens')[0].last_used_at).toBeLessThan(first + 1);
    h.clock.now += 1;
    await cliCall(h, 'GET', '/v1/profiles', { token });
    expect(rows(h, 'SELECT last_used_at FROM cli_tokens')[0].last_used_at).toBe(h.clock.now);
  });
});

describe('앱용 CLI 토큰 목록·철회', () => {
  it('살아 있는 내 토큰만 목록에 나오고 원문은 없다', async () => {
    const h = harness();
    const a = await connect(h);
    const b = await connect(h, a.me, 'gazua@pc');
    await a.me.as('DELETE', `/v1/cli/tokens/${b.tokenId}`);
    const r = await j(await a.me.as('GET', '/v1/cli/tokens'));
    expect(r.body.tokens).toEqual([{ id: a.tokenId, label: 'gazua@mac', createdAt: expect.any(Number), lastUsedAt: expect.any(Number), expiresAt: expect.any(Number) }]);
    expect(JSON.stringify(r.body)).not.toContain(a.token);
  });

  it('남의 토큰을 철회하면 404, 이미 철회했으면 그대로 200', async () => {
    const h = harness();
    const a = await connect(h);
    const other = await h.login('other@example.test', 'uid-other');
    expect((await other.as('DELETE', `/v1/cli/tokens/${a.tokenId}`)).status).toBe(404);
    expect((await a.me.as('DELETE', `/v1/cli/tokens/${a.tokenId}`)).status).toBe(200);
    expect((await a.me.as('DELETE', `/v1/cli/tokens/${a.tokenId}`)).status).toBe(200);
    expect((await a.me.as('DELETE', '/v1/cli/tokens/nope')).status).toBe(404);
    expect((await j(await other.as('GET', '/v1/cli/tokens'))).body.tokens).toEqual([]); // 남의 토큰은 목록에도 없다
  });
});
```

`cli.test.ts`의 import 줄에 `DAY`와 `doc`을 더한다.

```ts
import { DAY } from './env';
import { doc } from '../test/docs';
```

`purge.test.ts`의 `:41`을 바꾸고 새 테스트를 더한다.

```ts
    expect(await purge(h.env, h.clock.now + 30 * DAY)).toEqual({ profiles: 0, shares: 0, sessions: 0, cliGrants: 0, cliTokens: 0 });
```

`purge.test.ts` 맨 아래 `describe` 안에 더한다(맨 위 import에 `DAY`가 이미 있다).

```ts
  it('하루 지난 CLI grant와 만료·철회 30일 지난 CLI 토큰을 지운다', async () => {
    const h = harness();
    const me = await h.login();
    const userId = (h.env.DB.raw.prepare('SELECT id FROM users').get() as { id: string }).id;
    const grant = (id: string, expires: number) =>
      h.env.DB.raw
        .prepare(`INSERT INTO cli_grants (id, device_hash, user_code, label, ip_hash, status, interval_ms, created_at, expires_at) VALUES (?, ?, ?, 'l', 'ip', 'pending', 5000, 1, ?)`)
        .run(id, `d-${id}`, `C${id}`.padEnd(8, 'B'), expires);
    const token = (id: string, expires: number, revoked: number | null) =>
      h.env.DB.raw
        .prepare(`INSERT INTO cli_tokens (id, token_hash, user_id, label, created_at, last_used_at, expires_at, revoked_at) VALUES (?, ?, ?, 'l', 1, 1, ?, ?)`)
        .run(id, `h-${id}`, userId, expires, revoked);
    const now = h.clock.now;
    grant('g1', now - DAY - 1); // 지움
    grant('g2', now - DAY + 1); // 남김
    token('t1', now - 31 * DAY, null); // 만료 31일: 지움
    token('t2', now + 5 * DAY, now - 31 * DAY); // 철회 31일: 지움
    token('t3', now - 29 * DAY, null); // 남김
    token('t4', now + 5 * DAY, now - 29 * DAY); // 남김
    token('t5', now + 5 * DAY, null); // 남김
    void me;
    expect(await purge(h.env, now)).toMatchObject({ cliGrants: 1, cliTokens: 2 });
    expect(rows2(h, 'SELECT id FROM cli_grants')).toEqual(['g2']);
    expect(rows2(h, 'SELECT id FROM cli_tokens ORDER BY id')).toEqual(['t3', 't4', 't5']);
  });
```

`purge.test.ts` 맨 위 `n` 도우미 아래에 `rows2`를 더한다.

```ts
const rows2 = (h: ReturnType<typeof harness>, sql: string) => (h.env.DB.raw.prepare(sql).all() as { id: string }[]).map((r) => r.id);
```

- [ ] **Step 2: 실패 확인**

Run: `cd sync-worker && npx vitest run src/cli.test.ts src/purge.test.ts`
Expected: FAIL — `Authorization: Gazua-CLI`가 403 `origin`으로 거절되고, `/v1/cli/tokens` 라우트가 없고, `purge` 결과에 `cliGrants`가 없다.

- [ ] **Step 3: 최소 구현**

`cli.ts` import를 고친다.

```ts
import { base64url, errorBody, HttpError, json, parseAccountList, parseAllowList, readJson, sha256Hex } from '@sch0718/firebase-session/worker';
import { DAY, type SyncDeps, type SyncEnv } from './env';
import { getProfile, listProfiles, requestDocVersion } from './profiles';
import type { AuthContext } from './session';
```

`cli.ts`에 더한다.

```ts
export const CLI_TOUCH_INTERVAL = DAY;
export const CLI_TOKEN_RE = /^gzc_[A-Za-z0-9_-]{43}$/;
const ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const PROFILES_RE = /^\/v1\/profiles$/;
const PROFILE_RE = /^\/v1\/profiles\/([^/]+)$/;
const LOGOUT_RE = /^\/v1\/cli\/token$/;

/**
 * CLI 토큰으로 허용하는 요청(라우터 전, 정확 일치). 그 밖은 null → 403 cli-scope.
 * 메서드는 req.method 그대로 비교한다(HEAD를 GET으로 보지 않는다). 쿼리는 docVersion이 정확히 하나, 정확히 '2'일 때만.
 */
export function cliScope(method: string, url: URL): 'profiles' | 'profile' | 'logout' | null {
  const path = url.pathname;
  if (method === 'GET' && PROFILES_RE.test(path)) return 'profiles';
  if (method === 'GET' && PROFILE_RE.test(path)) {
    const v = url.searchParams.getAll('docVersion');
    return v.length === 1 && v[0] === '2' ? 'profile' : null;
  }
  if (method === 'DELETE' && LOGOUT_RE.test(path)) return 'logout';
  return null;
}

interface TokenRow {
  id: string;
  userId: string;
  expiresAt: number;
  revokedAt: number | null;
  lastUsedAt: number;
  sub: string;
  email: string;
}

/** 지금 허용 목록에 있는 사용자인가(세션 인증과 같은 정책, 요청마다 다시 본다) */
function stillAllowed(env: SyncEnv, row: TokenRow): boolean {
  if (/^(kakao|naver):/.test(row.sub)) return parseAccountList(env.ALLOWED_ACCOUNTS).has(row.sub);
  return parseAllowList(env.ALLOWED_EMAILS).has(row.email.toLowerCase());
}

/** Authorization: Gazua-CLI <토큰> 요청을 인증하고 읽기 전용 허용 목록만 통과시킨다 */
async function handleCliToken(req: Request, env: SyncEnv, deps: SyncDeps, url: URL): Promise<Response> {
  const token = (req.headers.get('Authorization') ?? '').slice('Gazua-CLI '.length);
  if (!CLI_TOKEN_RE.test(token)) throw new HttpError(401, 'cli-token');
  const row = await env.DB.prepare(
    `SELECT t.id, t.user_id AS userId, t.expires_at AS expiresAt, t.revoked_at AS revokedAt, t.last_used_at AS lastUsedAt, u.firebase_sub AS sub, u.email
     FROM cli_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?`,
  )
    .bind(await sha256Hex(token))
    .first<TokenRow>();
  const now = deps.now();
  if (!row || row.revokedAt !== null) throw new HttpError(401, 'cli-token-revoked');
  if (row.expiresAt <= now) throw new HttpError(401, 'cli-token-expired');
  if (!stillAllowed(env, row)) throw new HttpError(403, 'not-allowed');
  const scope = cliScope(req.method, url);
  if (scope === null) throw new HttpError(403, 'cli-scope');
  if (now - row.lastUsedAt >= CLI_TOUCH_INTERVAL) {
    await env.DB.prepare('UPDATE cli_tokens SET last_used_at = ? WHERE id = ?').bind(now, row.id).run();
  }
  if (scope === 'logout') {
    await env.DB.prepare('UPDATE cli_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').bind(now, row.id).run();
    return json(200, { revoked: true });
  }
  // 읽기 전용 호출은 기존 핸들러를 그대로 부른다(세션이 없어 sessionHash는 비운다)
  const ctx = { userId: row.userId, sessionHash: '', user: { sub: row.sub, email: row.email, authTime: now } } as AuthContext;
  if (scope === 'profiles') return json(200, { profiles: await listProfiles(env, ctx) });
  const id = decodeURIComponent(PROFILE_RE.exec(url.pathname)![1]);
  return json(200, await getProfile(env, ctx, id, requestDocVersion(url)));
}

export async function listCliTokens(env: SyncEnv, ctx: AuthContext, now: number) {
  const { results } = await env.DB.prepare(
    `SELECT id, label, created_at AS createdAt, last_used_at AS lastUsedAt, expires_at AS expiresAt
     FROM cli_tokens WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_used_at DESC, created_at DESC`,
  )
    .bind(ctx.userId, now)
    .all<{ id: string; label: string; createdAt: number; lastUsedAt: number; expiresAt: number }>();
  return results;
}

/** 이미 철회했으면 그대로 성공, 남의 것이거나 없으면 404(있는지 알려 주지 않는다) */
export async function revokeCliToken(env: SyncEnv, ctx: AuthContext, id: string, now: number): Promise<void> {
  if (!ID_RE.test(id)) throw new HttpError(404, 'not-found');
  const r = await env.DB.prepare('UPDATE cli_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL').bind(now, id, ctx.userId).run();
  if (r.meta.changes > 0) return;
  const mine = await env.DB.prepare('SELECT 1 AS x FROM cli_tokens WHERE id = ? AND user_id = ?').bind(id, ctx.userId).first();
  if (!mine) throw new HttpError(404, 'not-found');
}
```

`cliEntry`·`handleCli`를 최종형으로 바꾼다.

```ts
/** Origin 없는 요청 중 CLI 분기로 받을 것이면 로그에 남길 패턴, 아니면 null */
export function cliEntry(req: Request, url: URL): string | null {
  if (req.method === 'POST' && url.pathname === '/v1/cli/device') return '/v1/cli/device';
  if (req.method === 'POST' && url.pathname === '/v1/cli/token') return '/v1/cli/token';
  return (req.headers.get('Authorization') ?? '').startsWith('Gazua-CLI ') ? 'cli-token' : null;
}

export async function handleCli(req: Request, env: SyncEnv, deps: SyncDeps, url: URL): Promise<Response> {
  if (req.method === 'POST' && url.pathname === '/v1/cli/device') return createDevice(req, env, deps, await readJson(req, 4096));
  if (req.method === 'POST' && url.pathname === '/v1/cli/token') return json(200, await pollToken(env, deps, await readJson(req, 4096)));
  return handleCliToken(req, env, deps, url);
}
```

`handler.ts`: import와 라우트.

```ts
import { approveCli, cliEntry, handleCli, listCliTokens, revokeCliToken } from './cli';
```

`ROUTES`의 `approve` 줄 아래에 더한다.

```ts
  ['GET', /^\/v1\/cli\/tokens$/, '/v1/cli/tokens', authed(async ({ env, deps, ctx }) => ok({ tokens: await listCliTokens(env, ctx, deps.now()) }))],
  ['DELETE', /^\/v1\/cli\/tokens\/([^/]+)$/, '/v1/cli/tokens/:id', authed(async ({ env, deps, ctx, params }) => (await revokeCliToken(env, ctx, params[0], deps.now()), ok({ revoked: true })))],
```

`purge.ts`: 반환 타입과 문장을 바꾼다.

```ts
export async function purge(env: SyncEnv, now: number): Promise<{ profiles: number; shares: number; sessions: number; cliGrants: number; cliTokens: number }> {
```

`const sessions = await purgeSessions(...)` 줄 아래, `return` 앞에 더한다.

```ts
  // CLI: 승인 대기(grant)는 만료 하루 뒤, 토큰은 만료·철회 30일 뒤에 지운다
  const grants = await db
    .prepare(`DELETE FROM cli_grants WHERE id IN (SELECT id FROM cli_grants WHERE expires_at <= ? LIMIT ?)`)
    .bind(now - DAY, PURGE_ROWS_PER_RUN)
    .run();
  const cliTokens = await db
    .prepare(`DELETE FROM cli_tokens WHERE id IN (SELECT id FROM cli_tokens WHERE expires_at <= ? OR (revoked_at IS NOT NULL AND revoked_at <= ?) LIMIT ?)`)
    .bind(old, old, PURGE_ROWS_PER_RUN)
    .run();
  return { profiles: due.length, shares: shares.meta.changes, sessions, cliGrants: grants.meta.changes, cliTokens: cliTokens.meta.changes };
```

(기존 `return { profiles: due.length, shares: …, sessions };` 줄은 지운다.)

`worker.ts`의 로그 줄을 바꾼다.

```ts
    console.log(`purge profiles=${r.profiles} shares=${r.shares} sessions=${r.sessions} cliGrants=${r.cliGrants} cliTokens=${r.cliTokens}`);
```

- [ ] **Step 4: 통과 확인**

Run: `cd sync-worker && npx vitest run && npx tsc -p tsconfig.json --noEmit`
Expected: PASS(기존 테스트 포함), tsc 오류 없음. `user` 필드 타입이 `VerifiedUser`와 맞지 않아 tsc가 불평하면 `as AuthContext`가 이미 있으니 `as unknown as AuthContext`로만 바꾼다(필드 값은 그대로).

- [ ] **Step 5: 커밋**

```bash
git add sync-worker/src sync-worker/test
git commit -m "feat(sync-worker): CLI 토큰 인증과 읽기 전용 강제, 자기 토큰 철회, 토큰 목록·정리를 더함"
```

---

## Task 6: 앱 화면 — CLI 연결 승인, 로그인한 기기의 CLI 토큰, `#/settings/sync`

**Files:**
- Modify: `src/lib/state/routes.ts`(`parseHash`의 `/^#\/settings\/?$/` 줄, `:73` 근처), `src/lib/state/routes.test.ts`
- Create: `src/lib/sync/cliCode.ts`, `src/lib/sync/cliCode.test.ts`
- Modify: `src/lib/sync/api.ts`(타입 2개, `SyncApi` 인터페이스 3줄, `createSyncApi` 반환 객체 3줄), `src/lib/sync/api.test.ts`
- Modify: `src/lib/sync/controller.svelte.ts`(`SyncController` 인터페이스 `revokeShare` 줄 아래 `:152` 근처, `ctl` 객체 `revokeShare` 줄 아래 `:981` 근처, import 줄 `:7`), `src/lib/sync/controller.test.ts`
- Create: `src/lib/ui/settings/CliConnect.svelte`, `src/lib/ui/settings/CliConnect.test.ts`
- Create: `src/lib/ui/settings/testSync.ts`(공용 `fakeSync`. 지금 `SyncPanel.test.ts` 안에 있는 것을 옮긴다)
- Modify: `src/lib/ui/settings/SyncPanel.svelte`(import, `<KeySync …/>` 아래), `src/lib/ui/settings/SyncManage.svelte`, `src/lib/ui/settings/SyncPanel.test.ts`
- Modify: `src/routes/Settings.svelte`(`$effect`, `:34-41`), `src/routes/Settings.test.ts`

**Interfaces:**
- Consumes: Worker 계약(Global Constraints 표): `POST /v1/cli/approve`, `GET /v1/cli/tokens`, `DELETE /v1/cli/tokens/:id`. 기존 `createSessionClient`의 `send`(404 → `{ ok:false, kind:'not-found' }`, 422 → `{ ok:false, kind:'invalid', code }`), `Sheet`(`@sch0718/ui-svelte`: `open`, `title`, `onclose`, `children`), `expectNoAxeViolations`(`src/lib/share/testAxe.ts`).
- Produces:
  ```ts
  // src/lib/sync/api.ts
  export interface CliApproveInfo { label: string; createdAt: number; geo?: string | null }
  export interface CliTokenRow { id: string; label: string; createdAt: number; lastUsedAt: number; expiresAt: number }
  // SyncApi
  cliApprove(userCode: string, approve?: boolean): Promise<ApiResult<CliApproveInfo>>;
  cliTokens(): Promise<ApiResult<{ tokens: CliTokenRow[] }>>;
  cliRevoke(id: string): Promise<ApiResult<{ revoked: boolean }>>;

  // src/lib/sync/controller.svelte.ts
  export type CliApproveResult =
    | { ok: true; info: { label: string; createdAt: number; geo: string | null } }
    | { ok: false; reason: 'invalid-code' | 'outdated' | 'error' };
  export type CliTokensResult = { ok: true; tokens: CliTokenRow[] } | { ok: false; reason: 'outdated' | 'error' };
  // SyncController
  cliApprove(userCode: string, approve?: boolean): Promise<CliApproveResult>;
  cliTokens(): Promise<CliTokensResult>;
  cliRevoke(id: string): Promise<boolean>;

  // src/lib/sync/cliCode.ts
  export function formatCliCode(raw: string): string;          // 'bcdf ghjk' → 'BCDF-GHJK', 영문자만, 8자까지
  export function cliCodeComplete(display: string): boolean;   // /^[자음20]{4}-[자음20]{4}$/
  export function agoText(createdAt: number, now: number): string; // '방금' | 'N분 전' | 'N시간 전'

  // src/lib/ui/settings/testSync.ts
  export const STATUS: SyncStatus;
  export function fakeSync(over?: Partial<Omit<SyncController, 'status'>> & { status?: Partial<SyncStatus> }): SyncController;
  ```
  - `CliConnect.svelte` props: `{ sync: SyncController; now?: () => number }`. 입력 칸 `id="cli-code"`, `aria-label="CLI 코드"`.
  - `parseHash('#/settings/sync')` = `{ name: 'settings', section: 'sync' }`. `hashFor`는 그대로 `#/settings`.

- [ ] **Step 1: 실패하는 테스트 쓰기**

`src/lib/state/routes.test.ts` 끝에 더한다.

```ts
describe('settings routes', () => {
  it('#/settings/sync는 동기화 구역으로 연다', () => {
    expect(parseHash('#/settings/sync')).toEqual({ name: 'settings', section: 'sync' });
    expect(parseHash('#/settings/sync/')).toEqual({ name: 'settings', section: 'sync' });
    expect(parseHash('#/settings')).toEqual({ name: 'settings' });
    expect(parseHash('#/settings/other')).toBeNull();
  });

  it('hashFor는 section이 있어도 #/settings를 낸다(일회성 구역 이동은 해시에 남기지 않는다)', () => {
    expect(hashFor({ name: 'settings', section: 'sync' })).toBe('#/settings');
    expect(hashFor({ name: 'settings' })).toBe('#/settings');
  });
});
```

`src/lib/sync/cliCode.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { agoText, cliCodeComplete, formatCliCode } from './cliCode';

describe('formatCliCode', () => {
  it.each([
    ['', ''],
    ['b', 'B'],
    ['bcdf', 'BCDF'],
    ['bcdfg', 'BCDF-G'],
    ['bcdf ghjk', 'BCDF-GHJK'],
    ['bcdf-ghjk', 'BCDF-GHJK'],
    ['bcdfghjklmn', 'BCDF-GHJK'],
    ['12bc!', 'BC'],
  ])('%j → %j', (raw, want) => expect(formatCliCode(raw)).toBe(want));
});

describe('cliCodeComplete', () => {
  it('자음 20자로 된 XXXX-XXXX만 완성으로 본다', () => {
    expect(cliCodeComplete('BCDF-GHJK')).toBe(true);
    expect(cliCodeComplete('BCDF-GHJ')).toBe(false);
    expect(cliCodeComplete('BCDFGHJK')).toBe(false);
    expect(cliCodeComplete('ABCD-EFGH')).toBe(false); // A·E는 코드에 없는 글자
  });
});

describe('agoText', () => {
  it('방금 · N분 전 · N시간 전', () => {
    expect(agoText(1000, 1000)).toBe('방금');
    expect(agoText(0, 59_999)).toBe('방금');
    expect(agoText(0, 120_000)).toBe('2분 전');
    expect(agoText(0, 2 * 3600_000)).toBe('2시간 전');
    expect(agoText(5000, 1000)).toBe('방금'); // 시계가 어긋나도 음수가 되지 않는다
  });
});
```

`src/lib/sync/api.test.ts`의 `describe('createSyncApi', …)` 안, 마지막 `it` 뒤에 더한다.

```ts
  it('CLI 연결: 조회 → 거절·승인 → 토큰 목록 → 끊기', async () => {
    const s = testServer();
    const { api } = await deviceApi(s);
    const dev = (await (await s.h.call('POST', '/v1/cli/device', { origin: null, token: null, body: { label: 'gazua@mac' }, headers: { 'CF-Connecting-IP': '203.0.113.5' } })).json()) as { userCode: string; deviceCode: string };
    expect(await api.cliApprove(dev.userCode)).toEqual({ ok: true, data: { label: 'gazua@mac', createdAt: s.h.clock.now, geo: null } });
    expect(await api.cliApprove('ZZZZ-ZZZZ')).toMatchObject({ ok: false, kind: 'invalid', code: 'invalid-code' });
    expect(await api.cliApprove(dev.userCode, true)).toEqual({ ok: true, data: { label: 'gazua@mac', createdAt: s.h.clock.now } });
    const tok = (await (await s.h.call('POST', '/v1/cli/token', { origin: null, token: null, body: { deviceCode: dev.deviceCode } })).json()) as { tokenId: string };
    const list = await api.cliTokens();
    expect(list).toMatchObject({ ok: true, data: { tokens: [{ id: tok.tokenId, label: 'gazua@mac' }] } });
    expect(await api.cliRevoke(tok.tokenId)).toEqual({ ok: true, data: { revoked: true } });
    expect(await api.cliTokens()).toEqual({ ok: true, data: { tokens: [] } });
    expect(await api.cliRevoke('nope')).toMatchObject({ ok: false, kind: 'not-found' });
  });

  it('CLI 경로가 없는 옛 Worker는 not-found로 읽는다', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"error":"not-found"}', { status: 404 }));
    const api = createSyncApi('https://sync.example.test', { idToken: async () => 't', sessionId: async () => 's' }, fetchImpl);
    expect(await api.cliApprove('BCDF-GHJK')).toMatchObject({ ok: false, kind: 'not-found' });
    expect(await api.cliTokens()).toMatchObject({ ok: false, kind: 'not-found' });
  });
```

`src/lib/sync/controller.test.ts`의 `describe('SyncController', …)` 끝(마지막 `it` 뒤)에 더한다.

```ts
  it('CLI 연결: 조회·승인·목록·끊기와 실패 사유', async () => {
    const s = testServer();
    const { sync } = await setup(s);
    await sync.signIn();
    const dev = (await (await s.h.call('POST', '/v1/cli/device', { origin: null, token: null, body: { label: 'gazua@mac' }, headers: { 'CF-Connecting-IP': '203.0.113.5' }, cf: { country: 'KR', city: 'Seoul' } })).json()) as { userCode: string; deviceCode: string };
    expect(await sync.cliApprove(dev.userCode)).toEqual({ ok: true, info: { label: 'gazua@mac', createdAt: s.h.clock.now, geo: 'KR · Seoul' } });
    expect(await sync.cliApprove('ZZZZ-ZZZZ')).toEqual({ ok: false, reason: 'invalid-code' });
    expect(sync.error).toBeNull();
    expect((await sync.cliApprove(dev.userCode, true)).ok).toBe(true);
    const tok = (await (await s.h.call('POST', '/v1/cli/token', { origin: null, token: null, body: { deviceCode: dev.deviceCode } })).json()) as { tokenId: string };
    const list = await sync.cliTokens();
    expect(list).toMatchObject({ ok: true, tokens: [{ id: tok.tokenId, label: 'gazua@mac' }] });
    expect(await sync.cliRevoke(tok.tokenId)).toBe(true);
    expect(await sync.cliTokens()).toEqual({ ok: true, tokens: [] });
  });

  it('CLI 경로가 없는 옛 Worker는 outdated로 알린다', async () => {
    const s = testServer();
    const real = s.fetch;
    s.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
      new URL(new Request(input, init).url).pathname.startsWith('/v1/cli/') ? new Response('{"error":"not-found"}', { status: 404 }) : real(input, init)) as typeof fetch;
    const { sync } = await setup(s);
    await sync.signIn();
    expect(await sync.cliApprove('BCDF-GHJK')).toEqual({ ok: false, reason: 'outdated' });
    expect(await sync.cliTokens()).toEqual({ ok: false, reason: 'outdated' });
  });
```

`src/lib/ui/settings/CliConnect.test.ts`:

```ts
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../share/testAxe';
import type { CliApproveResult, SyncController } from '../../sync/controller.svelte';
import CliConnect from './CliConnect.svelte';

afterEach(cleanup);

const NOW = Date.UTC(2026, 10, 1, 3, 2, 0);
const found = (geo: string | null = 'KR · Seoul'): CliApproveResult => ({ ok: true, info: { label: 'gazua@macbook', createdAt: NOW - 120_000, geo } });

function setup(handler: (code: string, approve?: boolean) => CliApproveResult) {
  const cliApprove = vi.fn(async (code: string, approve?: boolean) => handler(code, approve));
  const sync = { cliApprove } as unknown as SyncController;
  const view = render(CliConnect, { sync, now: () => NOW });
  return { cliApprove, ...view };
}
const input = () => screen.getByLabelText('CLI 코드') as HTMLInputElement;
const type = (value: string) => fireEvent.input(input(), { target: { value } });
const confirmBtn = () => screen.getByRole('button', { name: '확인' }) as HTMLButtonElement;
const body = () => document.body.textContent ?? '';

describe('CliConnect', () => {
  it('소문자·하이픈 없는 입력을 XXXX-XXXX로 보이고, 8자가 되기 전에는 확인이 꺼져 있다', async () => {
    setup(() => found());
    await type('bcdfghj');
    expect(input().value).toBe('BCDF-GHJ');
    expect(confirmBtn().disabled).toBe(true);
    await type('bcdfghjk');
    expect(input().value).toBe('BCDF-GHJK');
    expect(confirmBtn().disabled).toBe(false);
    expect(input().getAttribute('autocomplete')).toBe('off');
  });

  it('확인을 누르면 조회만 하고(approve 없음) 확인 대화상자를 연다', async () => {
    const { cliApprove } = setup(() => found());
    await type('bcdfghjk');
    await fireEvent.click(confirmBtn());
    await screen.findByText('읽기 전용 접근을 허락할까요?');
    expect(cliApprove).toHaveBeenCalledTimes(1);
    expect(cliApprove).toHaveBeenCalledWith('BCDF-GHJK');
    expect(body()).toContain('gazua@macbook');
    expect(body()).toContain('에서 요청했어요(KR · Seoul, 2분 전). 관심 그룹·전략을 읽을 수 있고, 바꾸거나 주문할 수는 없어요. 직접 실행한 명령에서 나온 코드만 승인하세요.');
  });

  it('허락하면 approve:true로 보내고 터미널로 돌아가라고 알린다', async () => {
    const { cliApprove } = setup(() => found());
    await type('bcdfghjk');
    await fireEvent.click(confirmBtn());
    await fireEvent.click(await screen.findByRole('button', { name: '허락' }));
    await waitFor(() => expect(cliApprove).toHaveBeenLastCalledWith('BCDF-GHJK', true));
    expect((await screen.findByRole('status')).textContent).toBe('연결했어요. 터미널로 돌아가세요');
    expect(input().value).toBe('');
  });

  it('거절하면 approve:false로 보낸다', async () => {
    const { cliApprove } = setup(() => found());
    await type('bcdfghjk');
    await fireEvent.click(confirmBtn());
    await fireEvent.click(await screen.findByRole('button', { name: '거절' }));
    await waitFor(() => expect(cliApprove).toHaveBeenLastCalledWith('BCDF-GHJK', false));
    expect((await screen.findByRole('status')).textContent).toBe('거절했어요');
  });

  it('위치가 없으면 괄호 안에 시각만 보인다', async () => {
    setup(() => found(null));
    await type('bcdfghjk');
    await fireEvent.click(confirmBtn());
    await screen.findByText('읽기 전용 접근을 허락할까요?');
    expect(body()).toContain('에서 요청했어요(2분 전).');
  });

  it('422 invalid-code와 404(옛 서버)를 각각의 문구로 알린다', async () => {
    const view = setup(() => ({ ok: false, reason: 'invalid-code' }));
    await type('bcdfghjk');
    await fireEvent.click(confirmBtn());
    expect((await screen.findByRole('alert')).textContent).toBe('코드가 맞지 않거나 시간이 지났어요. `gazua login`을 다시 실행해 주세요');
    view.unmount();
    setup(() => ({ ok: false, reason: 'outdated' }));
    await type('bcdfghjk');
    await fireEvent.click(confirmBtn());
    expect((await screen.findByRole('alert')).textContent).toBe('서버 업데이트가 필요해요');
  });

  it('입력을 바꾸면 조회 결과(대화상자)가 사라지고, 옛 코드로는 승인할 수 없다', async () => {
    const { cliApprove } = setup(() => found());
    await type('bcdfghjk');
    await fireEvent.click(confirmBtn());
    await screen.findByRole('button', { name: '허락' });
    await type('bcdfghjl');
    await waitFor(() => expect(screen.queryByRole('button', { name: '허락' })).toBeNull());
    expect(cliApprove).toHaveBeenCalledTimes(1); // 조회 한 번뿐, 승인·거절 호출 없음
  });

  it('조회하는 사이 입력이 바뀌면 옛 코드의 정보를 보여 주지 않는다', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const cliApprove = vi.fn(async () => {
      await gate;
      return found();
    });
    render(CliConnect, { sync: { cliApprove } as unknown as SyncController, now: () => NOW });
    await type('bcdfghjk');
    await fireEvent.click(confirmBtn());
    await type('bcdfghjl');
    release();
    await waitFor(() => expect(cliApprove).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('읽기 전용 접근을 허락할까요?')).toBeNull();
  });

  it('axe 위반 0: 기본, 오류, 확인 대화상자', async () => {
    const { container } = setup(() => found());
    await expectNoAxeViolations(container);
    await type('bcdfghjk');
    await fireEvent.click(confirmBtn());
    await screen.findByText('읽기 전용 접근을 허락할까요?');
    await expectNoAxeViolations(document.body);
  });
});
```

`src/lib/ui/settings/testSync.ts`를 만든다(지금 `SyncPanel.test.ts` 맨 위의 `STATUS`와 `fakeSync` 정의를 옮기고 CLI 세 줄을 더한다).

```ts
// 테스트 전용: SyncController 가짜. 화면이 부르는 메서드는 모두 vi.fn으로 둔다.
import { vi } from 'vitest';
import type { SyncController } from '../../sync/controller.svelte';
import type { SyncStatus } from '../../sync/engine';

export const STATUS: SyncStatus = { enabled: false, phase: 'off', pending: 0, conflicts: [], rejected: [], lastSyncAt: null, notices: [], volatile: false };

export function fakeSync(over: Partial<Omit<SyncController, 'status'>> & { status?: Partial<SyncStatus> } = {}): SyncController {
  const { status, ...rest } = over;
  return {
    configured: true,
    providers: { google: true, kakao: false, naver: false },
    account: null,
    status: { ...STATUS, ...status },
    busy: false,
    error: null,
    api: null,
    attach: vi.fn(),
    onSyncableChange: vi.fn(),
    signIn: vi.fn(async () => {}),
    signInWith: vi.fn(async () => {}),
    completeSocialSignIn: vi.fn(async () => ({ ok: false, provider: null, reason: 'no-pending' })),
    signOut: vi.fn(async () => {}),
    preview: vi.fn(async () => ({ upload: ['내 프로필'], download: 2 })),
    setEnabled: vi.fn(async () => {}),
    syncNow: vi.fn(async () => {}),
    resolve: vi.fn(async () => {}),
    remoteProfiles: vi.fn(async () => []),
    restoreDeleted: vi.fn(async () => true),
    revisions: vi.fn(async () => []),
    restoreRevision: vi.fn(async () => null),
    sessions: vi.fn(async () => []),
    revokeSession: vi.fn(async () => true),
    shares: vi.fn(async () => []),
    createShare: vi.fn(async () => null),
    revokeShare: vi.fn(async () => true),
    cliApprove: vi.fn(async () => ({ ok: false, reason: 'error' })),
    cliTokens: vi.fn(async () => ({ ok: true, tokens: [] })),
    cliRevoke: vi.fn(async () => true),
    clearError: vi.fn(),
    clearNotices: vi.fn(),
    destroy: vi.fn(),
    // KeySync가 해제될 때 cancelReceive를 부른다(받기 확인 사이 평문을 버림). 화면이 부르는 메서드는 모두 vi.fn으로 둔다
    keys: {
      view: { support: true, vault: null, accountNotice: null, states: [], problem: null, remembered: false, persistent: true, uploaded: [] },
      createVault: vi.fn(async () => ({ ok: true, notes: [] })),
      unlockVault: vi.fn(async () => ({ ok: true, notes: [] })),
      enable: vi.fn(async () => ({ ok: true, notes: [] })),
      setProviders: vi.fn(async () => ({ ok: true, notes: [] })),
      prepareReceive: vi.fn(async () => ({ ok: true, overwrite: [] })),
      commitReceive: vi.fn(async () => ({ ok: true, notes: [] })),
      cancelReceive: vi.fn(),
      uploadLocal: vi.fn(async () => ({ ok: true, notes: [] })),
      disable: vi.fn(async () => ({ ok: true, notes: [] })),
      changePassphrase: vi.fn(async () => ({ ok: true, notes: [] })),
      wipe: vi.fn(async () => ({ ok: true, notes: [] })),
      forget: vi.fn(),
      dismiss: vi.fn(async () => {}),
      dismissAccount: vi.fn(async () => {}),
    } as unknown as SyncController['keys'],
    onSecretsChange: vi.fn(),
    onLock: vi.fn(),
    ...rest,
  } as SyncController;
}
```

`src/lib/ui/settings/SyncPanel.test.ts`에서 위 `STATUS` 상수와 `fakeSync` 함수 정의(파일 맨 위 `const STATUS …`부터 `fakeSync`의 닫는 `}`까지)를 지우고, import를 더한다.

```ts
import { fakeSync, STATUS } from './testSync';
```

(`SyncStatus`·`SyncController` 타입 import가 더는 안 쓰이면 지운다. `STATUS`가 이 파일에서 안 쓰이면 import에서 뺀다.)

`SyncPanel.test.ts`의 `describe` 안에 CLI 묶음 테스트를 더한다.

```ts
  describe('CLI 연결', () => {
    const SESSION = { id: 'aaaaaaaaaaaa', label: '이 노트북', createdAt: 1, lastUsedAt: 2, expiresAt: Date.UTC(2026, 11, 1), current: true };
    const OTHER = { ...SESSION, id: 'bbbbbbbbbbbb', label: '잃어버린 폰', current: false };
    const TOKEN = { id: 't1', label: 'gazua@macbook', createdAt: 1, lastUsedAt: Date.UTC(2026, 10, 1), expiresAt: Date.UTC(2027, 1, 1) };
    const signedIn = { account: { provider: 'google' as const, id: 'me@example.test', display: 'me@example.test' }, status: { enabled: true, phase: 'idle' as const } };
    const open = async () => {
      const details = screen.getByText('로그인한 기기').closest('details')!;
      details.open = true;
      await fireEvent(details, new Event('toggle'));
    };

    it('동기화가 켜져 있으면 CLI 연결 칸을 보이고, 꺼져 있으면 보이지 않는다', () => {
      render(SyncPanel, { app: app(), sync: fakeSync(signedIn) });
      expect(screen.getByLabelText('CLI 코드')).toBeTruthy();
      cleanup();
      render(SyncPanel, { app: app(), sync: fakeSync({ account: signedIn.account }) });
      expect(screen.queryByLabelText('CLI 코드')).toBeNull();
    });

    it('로그인한 기기 아래에 CLI 묶음을 보이고 연결 끊기는 확인 뒤에 철회한다', async () => {
      const cliTokens = vi.fn(async () => ({ ok: true as const, tokens: [TOKEN] }));
      const sync = fakeSync({ ...signedIn, sessions: vi.fn(async () => [SESSION, OTHER]), cliTokens });
      render(SyncPanel, { app: app(), sync });
      await open();
      await waitFor(() => expect(screen.getByText('gazua@macbook')).toBeTruthy());
      expect(screen.getByText('읽기 전용 CLI')).toBeTruthy();
      expect(screen.getByText('CLI 연결은 따로 끊어요')).toBeTruthy();
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      await fireEvent.click(screen.getByRole('button', { name: 'gazua@macbook CLI 연결 끊기' }));
      expect(sync.cliRevoke).toHaveBeenCalledWith('t1');
      await waitFor(() => expect(cliTokens).toHaveBeenCalledTimes(2));
    });

    it('서버가 CLI 경로를 모르면 「서버 업데이트가 필요해요」를 보인다', async () => {
      const sync = fakeSync({ ...signedIn, sessions: vi.fn(async () => [SESSION]), cliTokens: vi.fn(async () => ({ ok: false as const, reason: 'outdated' as const })) });
      render(SyncPanel, { app: app(), sync });
      await open();
      await waitFor(() => expect(screen.getAllByText('서버 업데이트가 필요해요').length).toBeGreaterThan(0));
    });

    it('axe 위반 0: 기기·CLI 목록을 펼친 상태', async () => {
      const sync = fakeSync({ ...signedIn, sessions: vi.fn(async () => [SESSION, OTHER]), cliTokens: vi.fn(async () => ({ ok: true as const, tokens: [TOKEN] })) });
      const { container } = render(SyncPanel, { app: app(), sync });
      await open();
      await waitFor(() => expect(screen.getByText('gazua@macbook')).toBeTruthy());
      await expectNoAxeViolations(container);
    });
  });
```

`SyncPanel.test.ts` 맨 위 import에 `expectNoAxeViolations`를 더한다.

```ts
import { expectNoAxeViolations } from '../../share/testAxe';
```

`src/routes/Settings.test.ts`에 더한다(import와 테스트).

```ts
import { fakeSync } from '../lib/ui/settings/testSync';
```

```ts
describe('Settings 동기화 구역', () => {
  const account = { provider: 'google' as const, id: 'me@example.test', display: 'me@example.test' };

  function setupSync(enabled: boolean) {
    const app = makeTestApp({ groups: [{ id: 'g1', name: '내 관심', items: [] }], now: NOW });
    apps.push(app);
    app.navigate({ name: 'settings', section: 'sync' });
    render(Settings, { app, barEnd, sync: fakeSync({ account, status: { enabled, phase: 'idle' } }) });
  }

  it('section이 sync이면 CLI 코드 칸에 초점을 둔다(`gazua login`의 verifyUrl)', async () => {
    setupSync(true);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('CLI 코드')));
  });

  it('CLI 코드 칸이 없으면(동기화 꺼짐) 구역 제목에 초점을 둔다', async () => {
    setupSync(false);
    await waitFor(() => expect(document.activeElement?.textContent).toBe('동기화·공유'));
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `corepack pnpm exec vitest run src/lib/state/routes.test.ts src/lib/sync/cliCode.test.ts src/lib/sync/api.test.ts src/lib/sync/controller.test.ts src/lib/ui/settings/CliConnect.test.ts src/lib/ui/settings/SyncPanel.test.ts src/routes/Settings.test.ts`
Expected: FAIL — `cliCode`·`CliConnect.svelte`·`testSync`를 찾을 수 없고, `parseHash('#/settings/sync')`가 `null`이고, `api.cliApprove`가 없다.

- [ ] **Step 3: 최소 구현**

`src/lib/state/routes.ts`의 `if (/^#\/settings\/?$/.test(hash)) return { name: 'settings' };` 줄 바로 위에 더한다.

```ts
  // `gazua login`의 verifyUrl. 설정을 열고 동기화·공유 구역으로 간다. hashFor는 이 구역을 해시에 남기지 않는다(일회성 이동).
  if (/^#\/settings\/sync\/?$/.test(hash)) return { name: 'settings', section: 'sync' };
```

`src/lib/sync/cliCode.ts`:

```ts
// CLI 연결 코드(`gazua login`이 보여 주는 XXXX-XXXX) 입력 도우미. 코드 알파벳은 sync-worker/src/cli.ts의 USER_CODE_ALPHABET과 같다.
const LETTERS = 'BCDFGHJKLMNPQRSTVWXZ';
const COMPLETE = new RegExp(`^[${LETTERS}]{4}-[${LETTERS}]{4}$`);

/** 영문자만 남겨 대문자로, 8자까지, 4자 뒤에 하이픈 */
export function formatCliCode(raw: string): string {
  const letters = raw.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8);
  return letters.length > 4 ? `${letters.slice(0, 4)}-${letters.slice(4)}` : letters;
}

export const cliCodeComplete = (display: string): boolean => COMPLETE.test(display);

/** 승인 대화상자의 「2분 전」 */
export function agoText(createdAt: number, now: number): string {
  const sec = Math.max(0, Math.floor((now - createdAt) / 1000));
  if (sec < 60) return '방금';
  const min = Math.floor(sec / 60);
  return min < 60 ? `${min}분 전` : `${Math.floor(min / 60)}시간 전`;
}
```

`src/lib/sync/api.ts`: 타입을 `ShareRow` 아래에 더한다.

```ts
export interface CliApproveInfo {
  label: string;
  createdAt: number;
  /** 조회 응답에만 있다. 요청 위치('국가 · 도시'), 모르면 null */
  geo?: string | null;
}
export interface CliTokenRow {
  id: string;
  label: string;
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number;
}
```

`SyncApi` 인터페이스의 `revokeShare` 줄 아래:

```ts
  /** approve 없이 부르면 조회만(상태 그대로), true/false면 승인·거절. 코드가 맞지 않으면 422 invalid-code */
  cliApprove(userCode: string, approve?: boolean): Promise<ApiResult<CliApproveInfo>>;
  cliTokens(): Promise<ApiResult<{ tokens: CliTokenRow[] }>>;
  cliRevoke(id: string): Promise<ApiResult<{ revoked: boolean }>>;
```

`createSyncApi`가 돌려주는 객체의 `revokeShare` 줄 아래:

```ts
    cliApprove: (userCode, approve) => send('POST', '/v1/cli/approve', { body: approve === undefined ? { userCode } : { userCode, approve } }),
    cliTokens: () => send('GET', '/v1/cli/tokens'),
    cliRevoke: (id) => send('DELETE', `/v1/cli/tokens/${enc(id)}`),
```

`src/lib/sync/controller.svelte.ts`: 7번째 줄 import에 타입을 더한다.

```ts
import { createSyncApi, type ApiFail, type CliTokenRow, type DeviceSession, type IndexRow, type ShareRow, type SyncApi } from './api';
```

`SyncController` 인터페이스 위(예: `export interface SyncController` 선언 바로 위)에 타입을 더하고, `revokeShare(id: string): Promise<boolean>;` 줄 아래에 메서드 선언을 더한다.

```ts
export type CliApproveResult =
  | { ok: true; info: { label: string; createdAt: number; geo: string | null } }
  | { ok: false; reason: 'invalid-code' | 'outdated' | 'error' };
export type CliTokensResult = { ok: true; tokens: CliTokenRow[] } | { ok: false; reason: 'outdated' | 'error' };
```

```ts
  /** approve 없이 부르면 조회만. 422 invalid-code·404(옛 Worker)는 배너 없이 사유로 돌려준다 */
  cliApprove(userCode: string, approve?: boolean): Promise<CliApproveResult>;
  cliTokens(): Promise<CliTokensResult>;
  cliRevoke(id: string): Promise<boolean>;
```

`ctl` 객체의 `revokeShare: …` 줄 아래:

```ts
    cliApprove: (userCode, approve) =>
      guarded<CliApproveResult>(
        async () => {
          if (!api) return { ok: false, reason: 'error' };
          const r = await api.cliApprove(userCode, approve);
          if (r.ok) return { ok: true, info: { label: r.data.label, createdAt: r.data.createdAt, geo: r.data.geo ?? null } };
          if (r.kind === 'invalid' && r.code === 'invalid-code') return { ok: false, reason: 'invalid-code' };
          if (r.kind === 'not-found') return { ok: false, reason: 'outdated' };
          ok(r); // 세션 문제는 다른 관리 요청처럼 로그인 필요 상태로 돌리고, 그 밖은 배너에 보인다
          return { ok: false, reason: 'error' };
        },
        { ok: false, reason: 'error' },
      ),
    cliTokens: () =>
      guarded<CliTokensResult>(
        async () => {
          if (!api) return { ok: false, reason: 'error' };
          const r = await api.cliTokens();
          if (r.ok) return { ok: true, tokens: r.data.tokens };
          if (r.kind === 'not-found') return { ok: false, reason: 'outdated' };
          ok(r);
          return { ok: false, reason: 'error' };
        },
        { ok: false, reason: 'error' },
      ),
    cliRevoke: (id) => guarded(async () => (api ? ok(await api.cliRevoke(id)) !== null : false), false),
```

`src/lib/ui/settings/CliConnect.svelte`:

```svelte
<script lang="ts">
  // 설정 › 동기화·공유 › CLI 연결: 터미널의 `gazua login`이 보여 준 코드를 넣어 읽기 전용 접근을 승인한다.
  // 코드를 바로 승인하지 않고, 먼저 조회해서 요청한 CLI의 이름·시각·위치를 보인 뒤 허락·거절을 받는다(피싱 방어).
  import { Sheet } from '@sch0718/ui-svelte';
  import type { SyncController } from '../../sync/controller.svelte';
  import { agoText, cliCodeComplete, formatCliCode } from '../../sync/cliCode';

  let { sync, now = () => Date.now() }: { sync: SyncController; now?: () => number } = $props();

  /** 조회한 코드와 그 코드의 정보. 승인·거절은 늘 이 코드로만 보낸다 */
  type Info = { code: string; label: string; createdAt: number; geo: string | null };
  const FAIL_TEXT = {
    'invalid-code': '코드가 맞지 않거나 시간이 지났어요. `gazua login`을 다시 실행해 주세요',
    outdated: '서버 업데이트가 필요해요',
    error: '확인하지 못했어요. 잠시 뒤 다시 시도해 주세요',
  } as const;

  let code = $state('');
  let info = $state<Info | null>(null);
  let note = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);
  let busy = $state(false);
  const detail = $derived(info ? (info.geo ? `${info.geo}, ${agoText(info.createdAt, now())}` : agoText(info.createdAt, now())) : '');

  async function lookup(e: Event) {
    e.preventDefault();
    if (busy || !cliCodeComplete(code)) return;
    busy = true;
    note = null;
    const asked = code;
    const r = await sync.cliApprove(asked);
    busy = false;
    if (code !== asked) return; // 조회하는 사이 입력이 바뀌었다. 옛 코드의 정보를 보여 주지 않는다
    if (r.ok) info = { code: asked, ...r.info };
    else note = { kind: 'error', text: FAIL_TEXT[r.reason] };
  }

  async function decide(approve: boolean) {
    if (busy || !info) return;
    busy = true;
    const target = info.code; // 화면에 보인 정보의 코드로만 보낸다
    const r = await sync.cliApprove(target, approve);
    busy = false;
    info = null;
    if (r.ok) {
      note = { kind: 'ok', text: approve ? '연결했어요. 터미널로 돌아가세요' : '거절했어요' };
      if (code === target) code = '';
    } else {
      note = { kind: 'error', text: FAIL_TEXT[r.reason] };
    }
  }
</script>

<div class="row col" role="group" aria-label="CLI 연결">
  <div class="text">
    <b>CLI 연결</b>
    <p>터미널에서 <code>gazua login</code>을 실행하면 나오는 코드를 넣어 주세요.</p>
  </div>
  <form class="line" onsubmit={lookup}>
    <input
      id="cli-code"
      aria-label="CLI 코드"
      autocomplete="off"
      autocapitalize="characters"
      spellcheck="false"
      maxlength="9"
      placeholder="XXXX-XXXX"
      value={code}
      oninput={(e) => {
        code = formatCliCode(e.currentTarget.value);
        e.currentTarget.value = code;
        if (info && info.code !== code) info = null; // 입력이 바뀌면 조회 결과를 버린다
      }}
    />
    <button type="submit" class="btn primary" disabled={busy || !cliCodeComplete(code)}>확인</button>
  </form>
  {#if note}
    <p class={note.kind === 'error' ? 'warn' : 'done'} role={note.kind === 'error' ? 'alert' : 'status'}>{note.text}</p>
  {/if}
</div>

<Sheet open={info !== null} title="읽기 전용 접근을 허락할까요?" onclose={() => (info = null)}>
  {#if info}
    <div class="sheet-form">
      <p><code>{info.label}</code>에서 요청했어요({detail}). 관심 그룹·전략을 읽을 수 있고, 바꾸거나 주문할 수는 없어요. 직접 실행한 명령에서 나온 코드만 승인하세요.</p>
      <div class="actions">
        <button type="button" class="btn" disabled={busy} onclick={() => decide(false)}>거절</button>
        <button type="button" class="btn primary" disabled={busy} onclick={() => decide(true)}>허락</button>
      </div>
    </div>
  {/if}
</Sheet>

<style>
  .row {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 0;
    border-bottom: 1px solid var(--line);
  }
  .text b {
    font-size: var(--fs-body);
  }
  .text p,
  .sheet-form p {
    font-size: var(--fs-sub);
    color: var(--t2);
    margin-top: 2px;
  }
  code {
    font-family: var(--mono, ui-monospace, monospace);
    overflow-wrap: anywhere;
  }
  .line {
    display: flex;
    gap: 8px;
  }
  input {
    flex: 1;
    min-width: 0;
    min-height: var(--touch);
    border-radius: 10px;
    border: 1px solid var(--line);
    padding: 0 10px;
    background: var(--surface);
    color: var(--t1);
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .btn {
    flex: none;
    min-height: var(--touch);
    padding: 0 14px;
    border-radius: 12px;
    background: var(--surface2);
    color: var(--t1);
    font-weight: 700;
  }
  .btn.primary {
    background: var(--accent);
    color: var(--on-accent, #fff);
  }
  .btn:disabled {
    opacity: 0.5;
  }
  .warn {
    font-size: var(--fs-sub);
    color: var(--warn);
  }
  .done {
    font-size: var(--fs-sub);
    color: var(--t1);
  }
  .sheet-form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }
</style>
```

`src/lib/ui/settings/SyncPanel.svelte`: import 한 줄과 배치.

```ts
  import CliConnect from './CliConnect.svelte';
```

`{#if status.enabled}\n      <KeySync {app} {sync} />\n    {/if}` 를 바꾼다.

```svelte
    {#if status.enabled}
      <KeySync {app} {sync} />
      <CliConnect {sync} />
    {/if}
```

`src/lib/ui/settings/SyncManage.svelte`: `<script>`의 import와 상태를 더한다.

```ts
  import type { CliTokenRow, DeviceSession, IndexRow, ShareRow } from '../../sync/api';
```

(기존 `import type { DeviceSession, IndexRow, ShareRow } from '../../sync/api';` 줄을 위 줄로 바꾼다.)

```ts
  let cli = $state<CliTokenRow[] | 'outdated' | null>(null);
```

`const loadDevices = …` 줄을 바꾼다.

```ts
  const loadDevices = async () => {
    devices = await sync.sessions();
    const r = await sync.cliTokens();
    cli = r.ok ? r.tokens : r.reason === 'outdated' ? 'outdated' : null;
  };
```

`revokeOthers` 함수 아래에 더한다.

```ts
  async function revokeCli(t: CliTokenRow) {
    if (!confirmFn(`「${t.label}」 CLI 연결을 끊을까요? 그 CLI는 다시 로그인해야 읽을 수 있어요.`)) return;
    if (await sync.cliRevoke(t.id)) await loadDevices();
  }
```

「로그인한 기기」 `<details>`의 `{#if devices.length > 1}…{/if}` 줄을 아래로 바꾸고, 그 아래(같은 `{:else}` 가지 안, `{/if}` 앞)에 CLI 묶음을 더한다.

```svelte
      {#if devices.length > 1}
        <button type="button" class="btn" onclick={revokeOthers}>다른 기기 모두 로그아웃</button>
        <p class="muted">CLI 연결은 따로 끊어요</p>
      {/if}
      <p class="group"><b>CLI</b></p>
      {#if cli === 'outdated'}
        <p class="muted">서버 업데이트가 필요해요</p>
      {:else if cli !== null && cli.length === 0}
        <p class="muted">연결한 CLI가 없어요.</p>
      {:else if cli !== null}
        <ul>
          {#each cli as t (t.id)}
            <li>
              <span><b>{t.label}</b> <small>읽기 전용 CLI</small><br /><small>마지막 사용 {fmt(t.lastUsedAt)} · {fmt(t.expiresAt)}에 만료</small></span>
              <button type="button" class="btn" aria-label="{t.label} CLI 연결 끊기" onclick={() => revokeCli(t)}>연결 끊기</button>
            </li>
          {/each}
        </ul>
      {/if}
```

`<style>`에 더한다.

```css
  .group {
    padding-top: 8px;
    font-size: var(--fs-sub);
    color: var(--t2);
  }
```

`src/routes/Settings.svelte`의 `$effect`를 바꾼다.

```ts
  $effect(() => {
    const section = app.route.section;
    if (!section) return;
    const h = document.getElementById(SECTION_IDS[section]);
    if (!h) return;
    // 동기화 구역은 CLI 코드 칸이 있으면 거기에 초점을 둔다(`gazua login`의 verifyUrl이 여기로 온다). 없으면 제목.
    const target = (section === 'sync' ? document.getElementById('cli-code') : null) ?? h;
    target.scrollIntoView?.({ block: 'start' });
    target.focus({ preventScroll: true });
  });
```

- [ ] **Step 4: 통과 확인**

Run: `corepack pnpm exec vitest run src/lib/state src/lib/sync src/lib/ui/settings src/routes/Settings.test.ts && corepack pnpm check`
Expected: PASS, svelte-check 오류 없음. (`SyncPanel.test.ts`의 기존 테스트에서 `getByRole('button', { name: '확인' })`가 CLI 연결의 「확인」과 겹쳐 실패하면 그 테스트의 쿼리를 `within(screen.getByRole('group', { name: '동기화 켜기 확인' }))`로 좁힌다. 동작은 바꾸지 않는다.)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/state src/lib/sync src/lib/ui/settings src/routes
git commit -m "feat(settings): CLI 연결 승인 화면과 CLI 토큰 철회, #/settings/sync 해시를 더함"
```

---

## Task 7: 공급자·평가기 준비 — `urlFor`, `tokenLock`, `avgPrice`, `group`

**Files:**
- Modify: `src/lib/providers/http.ts`(`ProxyClientConfig`, `request` 안의 `const url = …`), `src/lib/providers/http.test.ts`
- Modify: `src/lib/providers/types.ts`(`AccountHolding`), `src/lib/providers/toss.ts`(`holdings()`), `src/lib/providers/toss.account.test.ts`
- Modify: `src/lib/providers/kis.ts`(import 줄, `KisDeps`, `createTokenManager` 호출), `src/lib/providers/kis.test.ts`
- Modify: `src/lib/providers/toss.ts`(`TossDeps`에 선택 `issuedAt`, `:238`의 `createTokenManager(issueToken, deps.tokenStore, now, undefined, deps.tokenLock)`), `src/lib/providers/toss.contention.test.ts`
- Modify: `src/lib/sim/rules.ts`(`RuleEvaluator.signal` 타입, `signal` 구현), `src/lib/sim/rules.test.ts`(`:126`, `:139`과 새 테스트)

**Interfaces:**
- Produces:
  ```ts
  // http.ts
  ProxyClientConfig.urlFor?: (provider: ProxyProvider, path: string) => string;   // 쿼리는 뺀 주소. 없으면 `${baseUrl}/${provider}${path}`
  // types.ts
  AccountHolding.avgPrice?: number;                                               // 토스 averagePurchasePrice
  // kis.ts
  KisDeps.tokenLock?: TokenLock;                                                  // createTokenManager의 다섯 번째 인자로
  TossDeps.issuedAt?: IssuedAtStore;                                              // createTokenManager의 네 번째 인자로(지금은 undefined 고정). 실행을 넘는 재발급 간격용
  // rules.ts
  RuleEvaluator.signal(i): { reason: string; snapshot?: PatternSnapshot; group?: number } | null;  // group = 맞은 묶음 번호(1부터)
  ```
- 앱 동작은 바뀌지 않는다(앱은 `urlFor`·`tokenLock`을 안 넘기고, 엔진은 `group`을 안 쓴다).

- [ ] **Step 1: 실패하는 테스트 쓰기**

`src/lib/providers/http.test.ts`의 `describe('createProxyClient', …)` 안, `omits the token header …` 테스트 뒤에 더한다.

```ts
  it('urlFor가 없으면 지금 주소, 있으면 그 주소에 쿼리를 붙인다', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    await createProxyClient({ baseUrl: 'https://p.example', fetchImpl }).request('kis', 'GET', '/x', { query: { a: '1' } });
    await createProxyClient({ baseUrl: '', fetchImpl, urlFor: (p, path) => `https://upstream.example/${p}-direct${path}` }).request('toss', 'GET', '/y', { query: { b: '2' } });
    const urls = fetchImpl.mock.calls.map((c) => String((c as unknown as [string])[0]));
    expect(urls).toEqual(['https://p.example/kis/x?a=1', 'https://upstream.example/toss-direct/y?b=2']);
  });
```

`src/lib/providers/toss.account.test.ts`의 `describe('toss account: holdings and id', …)` 안, 첫 `it` 뒤에 더한다.

```ts
  it('보유의 평균 매수가(averagePurchasePrice)를 avgPrice로 읽고, 없거나 숫자가 아니면 뺀다', async () => {
    const { account } = setup({
      '/api/v1/accounts': ACCOUNTS,
      '/api/v1/holdings': () =>
        ok({
          items: [
            { symbol: '005930', name: '삼성전자', marketCountry: 'KR', currency: 'KRW', quantity: '10', averagePurchasePrice: '68500' },
            { symbol: '000660', name: 'SK하이닉스', marketCountry: 'KR', currency: 'KRW', quantity: '2' },
            { symbol: '035420', name: 'NAVER', marketCountry: 'KR', currency: 'KRW', quantity: '1', averagePurchasePrice: 'x' },
          ],
        }),
    });
    expect(await account.holdings()).toEqual([
      { symbol: '005930', name: '삼성전자', quantity: 10, avgPrice: 68500 },
      { symbol: '000660', name: 'SK하이닉스', quantity: 2 },
      { symbol: '035420', name: 'NAVER', quantity: 1 },
    ]);
  });
```

`src/lib/providers/kis.test.ts`: import 줄을 고치고 테스트를 더한다.

```ts
import type { IssuedAtStore, MarketDataProvider, TokenInfo, TokenLock, TokenStore } from './types';
```

파일 끝(마지막 `describe` 밖)에 더한다.

```ts
describe('KIS tokenLock', () => {
  function build(tokenLock?: TokenLock) {
    const events: string[] = [];
    const inner = fakeClient();
    const client: ProxyClient = {
      request: (provider, method, path, opts) => {
        if (path === '/oauth2/tokenP') events.push('issue');
        return inner.request(provider, method, path, opts);
      },
    };
    const provider = createKisProvider({
      client,
      queue: fastQueue(),
      creds: { appKey: APP_KEY, appSecret: APP_SECRET },
      tokenStore: memoryStore(),
      now: () => SUN,
      ...(tokenLock ? { tokenLock } : {}),
    });
    return { provider, events };
  }

  it('tokenLock을 넘기면 토큰 발급이 잠금 안에서 일어난다', async () => {
    const events: string[] = [];
    const lock: TokenLock = async (fn) => {
      events.push('lock');
      try {
        return await fn();
      } finally {
        events.push('unlock');
      }
    };
    const { provider, events: calls } = build(async (fn) => {
      const out = await lock(fn);
      return out;
    });
    await provider.getQuotes(['005930'], 'KRX');
    expect(calls).toEqual(['issue']);
    expect(events).toEqual(['lock', 'unlock']);
  });

  it('tokenLock을 안 넘기면 지금처럼 잠금 없이 발급한다', async () => {
    const { provider, events } = build();
    await provider.getQuotes(['005930'], 'KRX');
    expect(events).toEqual(['issue']);
  });
});
```

`src/lib/providers/toss.contention.test.ts` 파일 끝에 더한다(같은 파일의 `tossServer`·`memoryStore`·`START`·`RATES`·`createRequestQueue`·`createTossProvider` import를 그대로 쓴다).

```ts
describe('토스 issuedAt(실행을 넘는 재발급 간격)', () => {
  it('issuedAt 저장소가 최근 발급 시각을 알면, 재시작한 실행은 캐시 토큰이 거절돼도 다시 발급하지 않고 token-contended', async () => {
    const clock = { now: START };
    const { client, issuedAt } = tossServer(clock);
    const store = memoryStore();
    store.save({ accessToken: 'old-cached', expiresAt: START + 86_400_000 }); // 서버가 모르는(무효가 된) 토큰
    let saved: number | null = START - 5_000; // 5초 전에 다른 실행이 발급
    const provider = createTossProvider({
      client,
      queue: createRequestQueue({ ratesPerSec: RATES, now: () => 0, sleep: async () => {} }),
      creds: { clientId: 'id', clientSecret: 'secret' },
      tokenStore: store,
      issuedAt: { load: () => saved, save: (t) => void (saved = t) },
      now: () => clock.now,
    });
    await expect(provider.getQuotes(['005930'], 'UNIFIED')).rejects.toMatchObject({ code: 'token-contended' });
    expect(issuedAt).toEqual([]); // 토큰 발급 요청을 보내지 않았다
  });

  it('issuedAt을 안 넘기면(앱) 지금처럼 곧바로 다시 발급한다', async () => {
    const clock = { now: START };
    const { client, issuedAt } = tossServer(clock);
    const store = memoryStore();
    store.save({ accessToken: 'old-cached', expiresAt: START + 86_400_000 });
    const provider = createTossProvider({
      client,
      queue: createRequestQueue({ ratesPerSec: RATES, now: () => 0, sleep: async () => {} }),
      creds: { clientId: 'id', clientSecret: 'secret' },
      tokenStore: store,
      now: () => clock.now,
    });
    expect((await provider.getQuotes(['005930'], 'UNIFIED'))[0].price).toBe(72000);
    expect(issuedAt).toEqual([START]);
  });
});
```

`src/lib/sim/rules.test.ts`에서 기존 두 줄을 바꾼다.

`:126`:

```ts
      expect(a).toEqual(b ? { reason: b.reason, snapshot: b.snapshot, group: 1 } : null);
```

`:139`:

```ts
    expect(ev.signal(3)).toEqual({ reason: '종가 2일선 위', group: 1 });
```

새 테스트를 `describe('조건 판정(§5.2)', …)` 뒤에 더한다.

```ts
describe('signal의 group(맞은 묶음 번호)', () => {
  const c = closes([10, 10, 10, 12, 8, 10]);
  it('처음 맞은 묶음이 1부터 센 번호로 온다', () => {
    const groups: CondGroup[] = [{ conds: [{ kind: 'maPrice', period: 3, side: 'below' }] }, { conds: [{ kind: 'maPrice', period: 3, side: 'above' }] }];
    const ev = createRuleEvaluator(c, groups, 0);
    expect(ev.signal(3)).toEqual({ reason: '종가 3일선 위', group: 2 });
    expect(ev.signal(4)).toEqual({ reason: '종가 3일선 아래', group: 1 });
    expect(ev.signal(0)).toBeNull();
  });
  it('빈 묶음은 건너뛰되 번호는 묶음 위치 그대로다', () => {
    const groups: CondGroup[] = [{ conds: [] }, { conds: [{ kind: 'maPrice', period: 3, side: 'above' }] }];
    expect(createRuleEvaluator(c, groups, 0).signal(3)).toEqual({ reason: '종가 3일선 위', group: 2 });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `corepack pnpm exec vitest run src/lib/providers/http.test.ts src/lib/providers/toss.account.test.ts src/lib/providers/kis.test.ts src/lib/sim/rules.test.ts`
Expected: FAIL — `urlFor` 무시로 URL 불일치, `avgPrice` 없음, `tokenLock` 무시로 `events`가 `[]`, `group` 필드 없음(`rules.test.ts` 새 테스트·바꾼 두 줄).

- [ ] **Step 3: 최소 구현**

`src/lib/providers/http.ts`:

`ProxyClientConfig`의 `typeErrorCode?` 아래에 더한다.

```ts
  /**
   * 요청 주소(쿼리 제외)를 직접 만든다. 없으면 `${baseUrl}/${provider}${path}`.
   * CLI가 프록시 없이 증권사 원 주소를 부를 때 쓴다(같은 시간 제한·오류 분류·retry-after를 그대로 쓰려고).
   */
  urlFor?: (provider: ProxyProvider, path: string) => string;
```

`request` 안의 `const url = …` 줄을 바꾼다.

```ts
      const target = cfg.urlFor ? cfg.urlFor(provider, path) : `${base}/${provider}${path}`;
      const url = `${target}${search ? `?${search}` : ''}`;
```

`src/lib/providers/types.ts`의 `AccountHolding`:

```ts
export interface AccountHolding {
  symbol: string;
  name: string;
  quantity: number;
  /** 평균 매수가(토스 averagePurchasePrice). 응답에 없거나 숫자가 아니면 빠진다 */
  avgPrice?: number;
}
```

`src/lib/providers/toss.ts`의 `holdings()` 안 `return [{ symbol: …, quantity }];`를 바꾼다.

```ts
        const avgPrice = toNumber(r.averagePurchasePrice);
        return [{ symbol: text(r.symbol), name: text(r.name) || text(r.symbol), quantity, ...(avgPrice !== undefined ? { avgPrice } : {}) }];
```

`src/lib/providers/toss.ts`: import 줄(`TokenLock,` 옆)에 `IssuedAtStore,`를 더하고, `TossDeps`의 `tokenLock?` 아래에 더한 뒤 `createTokenManager` 호출을 바꾼다.

```ts
  /** 마지막 발급 시각 저장소(실행을 넘는 재발급 간격). 앱은 넘기지 않는다. CLI는 파일 저장소를 넘긴다 */
  issuedAt?: IssuedAtStore;
```

```ts
  const tokens = createTokenManager(issueToken, deps.tokenStore, now, deps.issuedAt, deps.tokenLock);
```

`src/lib/providers/kis.ts`:

import 줄:

```ts
import type { CandleQuery, IssuedAtStore, MarketDataProvider, Quote, StockMeta, TokenInfo, TokenLock, TokenStore } from './types';
```

`KisDeps`의 `issuedAt?` 아래:

```ts
  /** 같은 저장소를 쓰는 실행끼리 토큰 발급을 하나로 묶는 잠금(CLI의 병렬 실행). 앱은 넘기지 않는다 */
  tokenLock?: TokenLock;
```

`const tokens = createTokenManager(issueToken, deps.tokenStore, now, deps.issuedAt);`:

```ts
  const tokens = createTokenManager(issueToken, deps.tokenStore, now, deps.issuedAt, deps.tokenLock);
```

`src/lib/sim/rules.ts`:

```ts
  /** i번째 봉 종가로 묶음을 판정한다. 처음 맞은 묶음의 사유와 번호(group, 1부터. 패턴 블록이 맞았으면 스냅샷도). 상태는 바꾸지 않는다. 엔진은 group을 쓰지 않는다(CLI signals가 쓴다) */
  signal(i: number): { reason: string; snapshot?: PatternSnapshot; group?: number } | null;
```

`signal(t)` 구현을 바꾼다.

```ts
    signal(t) {
      for (const [gi, g] of compiled.entries()) {
        if (g.length === 0) continue; // 빈 묶음은 맞지 않는다(실행은 경고가 막는다)
        const parts: string[] = [];
        let snapshot: PatternSnapshot | undefined;
        let ok = true;
        for (const x of g) {
          if (x.tracker) {
            const s = x.tracker.signal(t);
            if (!s) {
              ok = false;
              break;
            }
            snapshot ??= s.snapshot;
            parts.push(s.reason);
          } else if (x.check(t)) parts.push(condReason(x.cond));
          else {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        const reason = cut(parts.join(' + '));
        return snapshot ? { reason, snapshot, group: gi + 1 } : { reason, group: gi + 1 };
      }
      return null;
    },
```

- [ ] **Step 4: 통과 확인(앱 동작 무변화 포함)**

Run: `corepack pnpm test && corepack pnpm check`
Expected: PASS(루트 전체). `simulate.golden.test.ts`·`simulate.rules.test.ts`·`provider contract` 테스트가 그대로 통과하는 것이 「앱 동작 무변화」의 확인이다. 깨지면 `group` 필드가 새는 곳(`toEqual`로 신호를 비교하는 테스트)을 찾아 `group: N`을 기대값에 더한다. 엔진 출력(`Trade`, `DayFrame`)에 `group`이 나타나면 구현 쪽을 고친다.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/providers src/lib/sim/rules.ts src/lib/sim/rules.test.ts
git commit -m "feat(cli): 공급자에 urlFor·tokenLock·avgPrice를, 평가기에 group을 선택 필드로 더함"
```

---

## Task 8: `cli/` 워크스페이스 골격 — 번들, JSON 출력, 오류 코드, 비밀값 거르기, 설정 파일

**Files:**
- Modify: `pnpm-workspace.yaml`(`- 'cli'` 더하기), `pnpm-lock.yaml`(설치가 갱신)
- Create: `cli/package.json`, `cli/tsconfig.json`, `cli/vitest.config.ts`, `cli/build.mjs`, `cli/build.d.mts`
- Create: `cli/src/main.ts`, `cli/src/args.ts`, `cli/src/context.ts`, `cli/src/output.ts`, `cli/src/errors.ts`, `cli/src/config.ts`, `cli/src/testing.ts`
- Create(테스트): `cli/src/output.test.ts`, `cli/src/errors.test.ts`, `cli/src/config.test.ts`, `cli/src/main.test.ts`, `cli/src/bundle.test.ts`

**Interfaces:**
- Consumes: `ApiError`·`ErrorCode`(`src/lib/providers/errors.ts`).
- Produces:
  ```ts
  // errors.ts
  export type CliErrorCode = 'invalid-args' | 'not-logged-in' | … | 'internal';   // Global Constraints의 코드 전부
  export const MESSAGES: Record<CliErrorCode, string>;
  export class CliError extends Error { readonly code: CliErrorCode; readonly data?: unknown; constructor(code: CliErrorCode, message?: string, data?: unknown) }
  export function fromApiError(e: ApiError): CliError;      // proxy-unreachable·offline → network, 여섯 코드는 그대로, 그 밖은 upstream
  export function toCliError(e: unknown): CliError;         // CliError 그대로, ApiError 변환, 나머지 internal
  export function exitCodeOf(code: CliErrorCode): 1 | 2;

  // output.ts
  export const HIDDEN = '[숨김]';
  export const SECRET_KEYS: ReadonlySet<string>;            // 소문자
  export interface Redactor { add(value: string | undefined): void; apply<T>(value: T): T }
  export function createRedactor(): Redactor;
  export type Result = { ok: true; data: unknown; warnings?: string[] } | { ok: false; error: { code: string; message: string }; data?: unknown; warnings?: string[] };
  export function ok(data: unknown, warnings?: string[]): Result;
  export function fail(code: string, message: string, data?: unknown, warnings?: string[]): Result;
  export function render(r: Result, redactor: Redactor, pretty: boolean): string;   // JSON + '\n'

  // args.ts
  export interface Args { command: string; positionals: string[]; profile?: string; provider?: 'kis' | 'toss'; label?: string; server?: string; strategy?: string; envFile?: string; from?: string; to?: string; pretty: boolean; verbose: boolean; today: boolean; raw: boolean }
  export function parseArgv(argv: string[]): Args;

  // context.ts
  export interface Ctx { args: Args; env: Record<string, string | undefined>; fetch: typeof fetch; now: () => number; sleep: (ms: number) => Promise<void>; hostname: () => string; dir: string; say: (line: string) => void; log: (line: string) => void; warn: (message: string) => void; redact: Redactor }
  export type Command = (ctx: Ctx) => Promise<unknown>;
  export interface Io { stdout(text: string): void; stderr(text: string): void; env: Record<string, string | undefined>; fetch: typeof fetch; now(): number; sleep(ms: number): Promise<void>; hostname(): string; dir?: string }

  // config.ts
  export function configDir(env: Record<string, string | undefined>, home?: string): string;
  export function ensureDir(dir: string): void;                       // 새로 만들면 700
  export function readJsonFile<T>(path: string): T | null;
  export function writeJsonFile(path: string, value: unknown): void; // 임시 파일(600) → rename
  export function permissionWarnings(dir: string, files: string[]): string[];
  export interface AuthFile { v: 1; server: string; token: string; tokenId: string; label: string; expiresAt: number }
  export const authPath: (dir: string) => string;
  export function readAuth(dir: string): { auth: AuthFile | null; warnings: string[] };
  export function writeAuth(dir: string, auth: AuthFile): void;
  export function removeAuth(dir: string): boolean;

  // main.ts
  export const COMMANDS: Record<string, Command>;
  export function run(argv: string[], io: Io): Promise<number>;       // 종료 코드를 돌려준다(0·1·2)

  // testing.ts (테스트 전용, 번들에 들어가지 않는다)
  export function tempDir(): string;  export function cleanupDirs(): void;
  export function makeIo(o?: { env?: Record<string, string | undefined>; fetch?: typeof fetch; dir?: string; now?: number }): { io: Io; out: string[]; err: string[]; clock: { now: number }; dir: string; result(): any };
  export interface FakeCall { method: string; url: URL; headers: Headers; body: unknown }
  export type FakeReply = { status?: number; body?: unknown; headers?: Record<string, string> } | Error;
  export function fakeFetch(handler: (call: FakeCall) => FakeReply | undefined | Promise<FakeReply | undefined>): typeof fetch & { calls: FakeCall[] };
  ```

- [ ] **Step 1: 골격 파일 만들고 설치**

`pnpm-workspace.yaml`:

```yaml
packages:
  - 'proxy'
  - 'sync-worker'
  - 'cli'
```

`cli/package.json`(esbuild 버전은 lockfile의 vite 6이 쓰는 `0.25.12`로 고정):

```json
{
  "name": "gazua-cli",
  "private": true,
  "version": "0.7.0",
  "license": "PolyForm-Noncommercial-1.0.0",
  "type": "module",
  "bin": { "gazua": "dist/gazua.mjs" },
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "node build.mjs",
    "test": "TZ=America/New_York vitest run",
    "check": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": {
    "@types/node": "^22.20.5",
    "esbuild": "0.25.12",
    "typescript": "^5.9.3",
    "vitest": "^3.2.7"
  }
}
```

`cli/tsconfig.json`(앱의 `src/lib`를 상대 경로로 가져오므로 DOM 타입과 `vite/client` 타입은 sync-worker와 같게 둔다):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["node", "vite/client"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*.ts"]
}
```

`cli/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['src/**/*.test.ts'], environment: 'node' } });
```

Run: `corepack pnpm install --prefer-offline`
Expected: `pnpm-lock.yaml`에 `importers: cli:`가 생기고 `esbuild 0.25.12`·`vitest`가 `cli/node_modules`에 연결된다. 설치가 네트워크로 막히면 `--offline`을 쓰고, 그래도 안 되면 멈추고 사용자에게 알린다.

- [ ] **Step 2: 실패하는 테스트 쓰기**

`cli/src/output.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createRedactor, fail, HIDDEN, ok, render, SECRET_KEYS } from './output';

describe('비밀값 거르기', () => {
  it('SECRET_KEYS 이름의 키는 값을 숨긴다(대소문자 무시, 중첩·배열 안까지)', () => {
    const r = createRedactor();
    const out = r.apply({
      ok: true,
      data: { appKey: 'a', AppSecret: 'b', clientId: 'c', clientSecret: 'd', accessToken: 'e', refreshToken: 'f', token: 'g', proxyToken: 'h', accountSeq: 7, deviceCode: 'i', secrets: { x: 1 }, list: [{ TOKEN: 'z', keep: 1 }], tokenId: '3f2c', symbol: '005930' },
    });
    expect(out.data).toEqual({
      appKey: HIDDEN, AppSecret: HIDDEN, clientId: HIDDEN, clientSecret: HIDDEN, accessToken: HIDDEN, refreshToken: HIDDEN, token: HIDDEN, proxyToken: HIDDEN, accountSeq: HIDDEN, deviceCode: HIDDEN, secrets: HIDDEN,
      list: [{ TOKEN: HIDDEN, keep: 1 }], tokenId: '3f2c', symbol: '005930',
    });
    expect([...SECRET_KEYS].sort()).toEqual(['accesstoken', 'accountseq', 'appkey', 'appsecret', 'clientid', 'clientsecret', 'devicecode', 'proxytoken', 'refreshtoken', 'secrets', 'token']);
  });

  it('등록한 비밀값이 문자열 안에 있으면 그 부분만 바꾼다(긴 값 먼저, 6자 미만은 제외)', () => {
    const r = createRedactor();
    r.add('KEY-1234567890');
    r.add('KEY-12');
    r.add('abc');
    r.add(undefined);
    expect(r.apply({ message: 'bad KEY-1234567890 and KEY-12 and abc', arr: ['x KEY-12'] })).toEqual({
      message: `bad ${HIDDEN} and ${HIDDEN} and abc`,
      arr: [`x ${HIDDEN}`],
    });
  });

  it('원본을 바꾸지 않는다', () => {
    const src = { token: 'secret-token-1' };
    createRedactor().apply(src);
    expect(src.token).toBe('secret-token-1');
  });
});

describe('결과 모양', () => {
  it('ok·fail·warnings', () => {
    expect(ok({ a: 1 })).toEqual({ ok: true, data: { a: 1 } });
    expect(ok({ a: 1 }, ['경고'])).toEqual({ ok: true, data: { a: 1 }, warnings: ['경고'] });
    expect(fail('profile-required', '메시지', { profiles: [] })).toEqual({ ok: false, error: { code: 'profile-required', message: '메시지' }, data: { profiles: [] } });
    expect(fail('internal', '메시지')).toEqual({ ok: false, error: { code: 'internal', message: '메시지' } });
  });

  it('render는 JSON 한 줄 + 줄바꿈, --pretty면 들여쓴다. 오류 메시지도 거른다', () => {
    const r = createRedactor();
    r.add('SUPERSECRET-VALUE');
    const line = render(fail('upstream', '키 SUPERSECRET-VALUE 로 실패'), r, false);
    expect(line.endsWith('\n')).toBe(true);
    expect(line.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(line)).toEqual({ ok: false, error: { code: 'upstream', message: `키 ${HIDDEN} 로 실패` } });
    expect(render(ok({ a: 1 }), r, true).split('\n').length).toBeGreaterThan(3);
  });
});
```

`cli/src/errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ApiError, type ErrorCode } from '../../src/lib/providers/errors';
import { CliError, exitCodeOf, fromApiError, MESSAGES, toCliError } from './errors';

describe('공급자 오류 → CLI 오류 코드', () => {
  it.each<[ErrorCode, string]>([
    ['proxy-unreachable', 'network'],
    ['offline', 'network'],
    ['ip-not-allowed', 'ip-not-allowed'],
    ['invalid-credentials', 'invalid-credentials'],
    ['token-throttled', 'token-throttled'],
    ['token-contended', 'token-contended'],
    ['upstream', 'upstream'],
    ['timeout', 'timeout'],
    ['rate-limited', 'rate-limited'],
    ['path-blocked', 'path-blocked'],
    ['token-expired', 'upstream'],
    ['proxy-redirect', 'upstream'],
    ['cors-blocked', 'upstream'],
  ])('%s → %s', (api, want) => expect(fromApiError(new ApiError(api)).code).toBe(want));

  it('toCliError는 CliError를 그대로 두고, 모르는 오류는 internal(원문 메시지를 내보내지 않는다)', () => {
    const e = new CliError('profile-not-found');
    expect(toCliError(e)).toBe(e);
    const x = toCliError(new Error('내부 비밀 KEY-123'));
    expect(x.code).toBe('internal');
    expect(x.message).toBe(MESSAGES.internal);
    expect(toCliError(new ApiError('timeout')).code).toBe('timeout');
  });

  it('메시지는 코드마다 있고 기본 메시지를 쓴다. 종료 코드는 invalid-args만 2', () => {
    for (const [code, message] of Object.entries(MESSAGES)) {
      expect(message.length).toBeGreaterThan(3);
      expect(new CliError(code as keyof typeof MESSAGES).message).toBe(message);
    }
    expect(exitCodeOf('invalid-args')).toBe(2);
    expect(exitCodeOf('network')).toBe(1);
    expect(new CliError('profile-required', undefined, { profiles: [] }).data).toEqual({ profiles: [] });
  });
});
```

`cli/src/config.test.ts`:

```ts
import { chmodSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { authPath, configDir, ensureDir, permissionWarnings, readAuth, readJsonFile, removeAuth, writeAuth, writeJsonFile } from './config';
import { cleanupDirs, tempDir } from './testing';

afterEach(cleanupDirs);
const posix = it.skipIf(process.platform === 'win32');
const mode = (p: string) => statSync(p).mode & 0o777;
const AUTH = { v: 1 as const, server: 'https://sync.example', token: 'gzc_x', tokenId: 'id1', label: 'gazua@mac', expiresAt: 1770000000000 };

describe('configDir', () => {
  it('XDG_CONFIG_HOME이 있으면 거기의 gazua, 없으면 ~/.config/gazua', () => {
    expect(configDir({ XDG_CONFIG_HOME: '/x/cfg' }, '/home/u')).toBe('/x/cfg/gazua');
    expect(configDir({}, '/home/u')).toBe('/home/u/.config/gazua');
    expect(configDir({ XDG_CONFIG_HOME: '  ' }, '/home/u')).toBe('/home/u/.config/gazua');
  });
});

describe('파일 쓰기·읽기', () => {
  posix('새 디렉터리는 700, 파일은 600이고 rename으로 쓴다(임시 파일이 남지 않는다)', () => {
    const dir = join(tempDir(), 'a', 'gazua');
    writeJsonFile(join(dir, 'x.json'), { v: 1 });
    expect(mode(dir)).toBe(0o700);
    expect(mode(join(dir, 'x.json'))).toBe(0o600);
    expect(readdirSync(dir)).toEqual(['x.json']);
    expect(readJsonFile(join(dir, 'x.json'))).toEqual({ v: 1 });
    writeJsonFile(join(dir, 'x.json'), { v: 2 });
    expect(readJsonFile(join(dir, 'x.json'))).toEqual({ v: 2 });
    expect(readdirSync(dir)).toEqual(['x.json']);
  });

  it('없거나 깨진 파일은 null', () => {
    const dir = tempDir();
    expect(readJsonFile(join(dir, 'none.json'))).toBeNull();
    writeFileSync(join(dir, 'bad.json'), '{');
    expect(readJsonFile(join(dir, 'bad.json'))).toBeNull();
  });

  posix('이미 있는 디렉터리 권한은 바꾸지 않는다', () => {
    const dir = join(tempDir(), 'existing');
    mkdirSync(dir, { mode: 0o755 });
    chmodSync(dir, 0o755);
    ensureDir(dir);
    expect(mode(dir)).toBe(0o755);
  });

  posix('권한이 넓으면 경고한다(파일 600·디렉터리 700 기준)', () => {
    const dir = tempDir();
    chmodSync(dir, 0o755);
    writeAuth(dir, AUTH);
    chmodSync(authPath(dir), 0o644);
    const { auth, warnings } = readAuth(dir);
    expect(auth).toEqual(AUTH);
    expect(warnings).toHaveLength(2);
    expect(warnings.join('\n')).toContain('auth.json');
    chmodSync(authPath(dir), 0o600);
    chmodSync(dir, 0o700);
    expect(readAuth(dir).warnings).toEqual([]);
    expect(permissionWarnings(dir, ['nope.json'])).toEqual([]);
  });
});

describe('auth.json', () => {
  it('쓰기·읽기·지우기', () => {
    const dir = tempDir();
    expect(readAuth(dir)).toEqual({ auth: null, warnings: [] });
    writeAuth(dir, AUTH);
    expect(readAuth(dir).auth).toEqual(AUTH);
    expect(removeAuth(dir)).toBe(true);
    expect(existsSync(authPath(dir))).toBe(false);
    expect(removeAuth(dir)).toBe(false);
  });

  it('모양이 틀리면 없는 것으로 본다', () => {
    const dir = tempDir();
    writeJsonFile(authPath(dir), { v: 1, server: 'https://x', token: 5 });
    expect(readAuth(dir).auth).toBeNull();
    writeJsonFile(authPath(dir), { ...AUTH, v: 2 });
    expect(readAuth(dir).auth).toBeNull();
  });
});
```

`cli/src/main.test.ts`:

```ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseArgv } from './args';
import { CliError } from './errors';
import { COMMANDS, run } from './main';
import { cleanupDirs, makeIo, tempDir } from './testing';

afterEach(() => {
  cleanupDirs();
  delete COMMANDS.__echo;
  delete process.env.GAZUA_TEST_FROM_ENV_FILE;
});

describe('parseArgv', () => {
  it('명령·위치 인자·옵션', () => {
    expect(parseArgv(['quote', '005930', '000660', '--provider', 'kis', '--pretty'])).toMatchObject({ command: 'quote', positionals: ['005930', '000660'], provider: 'kis', pretty: true, verbose: false, today: false, raw: false });
    expect(parseArgv(['signals', '--strategy', '전략', '--today', '--from', '2025-01-01', '--to', '2025-12-31', '--env-file', '.env', '--profile', 'p', '--label', 'l', '--server', 'https://s', '--raw', '--verbose'])).toMatchObject({
      command: 'signals', strategy: '전략', today: true, from: '2025-01-01', to: '2025-12-31', envFile: '.env', profile: 'p', label: 'l', server: 'https://s', raw: true, verbose: true,
    });
    expect(parseArgv([]).command).toBe('');
  });

  it.each([['--nope'], ['--provider', 'x'], ['--from', '2025/01/01'], ['--to', '내일'], ['--profile']])('틀린 인자 %j는 invalid-args', (...argv) => {
    expect(() => parseArgv(argv)).toThrow(CliError);
    try {
      parseArgv(argv);
    } catch (e) {
      expect((e as CliError).code).toBe('invalid-args');
    }
  });
});

describe('run', () => {
  it('성공은 JSON 한 줄 + 종료 코드 0', async () => {
    COMMANDS.__echo = async (ctx) => ({ positionals: ctx.args.positionals, dir: ctx.dir });
    const t = makeIo();
    expect(await run(['__echo', 'a', 'b'], t.io)).toBe(0);
    expect(t.out.join('').trim().split('\n')).toHaveLength(1);
    expect(t.result()).toEqual({ ok: true, data: { positionals: ['a', 'b'], dir: t.dir } });
    expect(t.err).toEqual([]);
  });

  it('모르는 명령·빈 명령·틀린 인자는 invalid-args + 종료 코드 2', async () => {
    for (const argv of [['bogus'], [], ['--nope']]) {
      const t = makeIo();
      expect(await run(argv, t.io)).toBe(2);
      expect(t.result()).toMatchObject({ ok: false, error: { code: 'invalid-args' } });
    }
  });

  it('CliError는 코드·데이터와 함께 종료 코드 1, 모르는 오류는 internal(메시지 원문 없음)', async () => {
    COMMANDS.__echo = async () => {
      throw new CliError('profile-required', undefined, { profiles: [{ id: '1', name: 'a' }] });
    };
    const t = makeIo();
    expect(await run(['__echo'], t.io)).toBe(1);
    expect(t.result()).toMatchObject({ ok: false, error: { code: 'profile-required' }, data: { profiles: [{ id: '1', name: 'a' }] } });
    COMMANDS.__echo = async () => {
      throw new Error('SECRET-INSIDE-ERROR');
    };
    const u = makeIo();
    expect(await run(['__echo'], u.io)).toBe(1);
    expect(u.result().error.code).toBe('internal');
    expect(u.out.join('')).not.toContain('SECRET-INSIDE-ERROR');
  });

  it('출력 직전에 비밀값을 거르고, warnings를 붙인다', async () => {
    COMMANDS.__echo = async (ctx) => {
      ctx.redact.add('SUPERSECRET123');
      ctx.warn('경고 하나');
      return { token: 'x', accountSeq: '7', note: 'has SUPERSECRET123 inside', fine: 1 };
    };
    const t = makeIo();
    await run(['__echo'], t.io);
    expect(t.result()).toEqual({ ok: true, data: { token: '[숨김]', accountSeq: '[숨김]', note: 'has [숨김] inside', fine: 1 }, warnings: ['경고 하나'] });
  });

  it('진행 로그는 --verbose일 때만 표준 오류로, say는 늘 표준 오류로 나간다', async () => {
    COMMANDS.__echo = async (ctx) => {
      ctx.log('자세히');
      ctx.say('안내');
      return {};
    };
    const quiet = makeIo();
    await run(['__echo'], quiet.io);
    expect(quiet.err.join('')).toBe('안내\n');
    const loud = makeIo();
    await run(['__echo', '--verbose'], loud.io);
    expect(loud.err.join('')).toBe('자세히\n안내\n');
    expect(loud.out.join('')).not.toContain('자세히');
  });

  it('환경변수 키는 명령 검증보다 먼저 등록돼, 틀린 명령·표준 오류 출력에서도 나가지 않는다', async () => {
    const SECRET = 'super-secret-key-1';
    const env = { TOSS_CLIENT_SECRET: SECRET };
    const a = makeIo({ env });
    expect(await run([SECRET], a.io)).toBe(2); // 명령 이름 자리에 키가 들어온 경우
    expect(a.out.join('')).not.toContain(SECRET);
    expect(a.out.join('')).toContain('[숨김]');
    COMMANDS.__echo = async (ctx) => {
      ctx.log(`로그 ${SECRET}`);
      ctx.say(`안내 ${SECRET}`);
      return { note: SECRET };
    };
    const b = makeIo({ env });
    await run(['__echo', '--verbose'], b.io);
    expect(b.out.join('') + b.err.join('')).not.toContain(SECRET);
  });

  it('같은 경고는 한 번만 붙는다', async () => {
    COMMANDS.__echo = async (ctx) => {
      ctx.warn('같은 경고');
      ctx.warn('같은 경고');
      return {};
    };
    const t = makeIo();
    await run(['__echo'], t.io);
    expect(t.result().warnings).toEqual(['같은 경고']);
  });

  it('--pretty는 들여쓴 JSON', async () => {
    COMMANDS.__echo = async () => ({ a: 1 });
    const t = makeIo();
    await run(['__echo', '--pretty'], t.io);
    expect(t.out.join('').split('\n').length).toBeGreaterThan(3);
  });

  it('--env-file을 읽어 환경변수로 쓴다(이미 있는 값은 덮어쓰지 않는다). 없는 파일은 invalid-args', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, '.env'), 'GAZUA_TEST_FROM_ENV_FILE=hello\n');
    COMMANDS.__echo = async (ctx) => ({ v: ctx.env.GAZUA_TEST_FROM_ENV_FILE });
    const t = makeIo({ env: process.env });
    await run(['__echo', '--env-file', join(dir, '.env')], t.io);
    expect(t.result().data).toEqual({ v: 'hello' });
    const u = makeIo({ env: process.env });
    expect(await run(['__echo', '--env-file', join(dir, 'missing.env')], u.io)).toBe(2);
  });
});
```

`cli/src/bundle.test.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bundle, FORBIDDEN } from '../build.mjs';
import { cleanupDirs, tempDir } from './testing';

afterEach(cleanupDirs);
/** 테스트마다 따로 임시 출력 경로에 빌드한다(병렬 실행되는 다른 테스트와 dist/gazua.mjs를 덮어쓰지 않게) */
const build = (env: Record<string, string | undefined> = {}) => bundle(join(tempDir(), 'gazua.mjs'), env);

describe('번들', () => {
  it('빌드되고 브라우저 전용 문자열이 없다', { timeout: 60_000 }, async () => {
    const out = await build();
    const text = readFileSync(out, 'utf8');
    expect(text.startsWith('#!/usr/bin/env node')).toBe(true);
    expect(FORBIDDEN).toEqual(['import.meta.env', 'window.', 'navigator.locks']);
    for (const s of FORBIDDEN) expect(text, s).not.toContain(s);
    if (process.platform !== 'win32') expect(statSync(out).mode & 0o111).not.toBe(0);
  });

  it('실행하면 JSON 한 줄을 내고 종료 코드를 지킨다', { timeout: 60_000 }, async () => {
    const r = spawnSync(process.execPath, [await build(), 'bogus'], { encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: false, error: { code: 'invalid-args' } });
  });
});
```

`cli/build.d.mts`(`build.mjs`의 타입. 테스트가 `../build.mjs`를 가져올 수 있게):

```ts
export const FORBIDDEN: string[];
export function findForbidden(text: string): string[];
export function bundle(outfile?: string, env?: Record<string, string | undefined>): Promise<string>;
```

- [ ] **Step 3: 실패 확인**

Run: `corepack pnpm --filter gazua-cli test`
Expected: FAIL — `./output`, `./errors`, `./config`, `./main`, `./testing` 등을 찾을 수 없다.

- [ ] **Step 4: 최소 구현**

`cli/src/errors.ts`:

```ts
// CLI 오류 코드(스펙 §6.6). message는 사람이 읽는 한국어 한 줄이고 비밀값이 없다.
import { ApiError, type ErrorCode } from '../../src/lib/providers/errors';

export const MESSAGES = {
  'invalid-args': '인자가 맞지 않아요',
  'not-logged-in': '로그인하지 않았어요. gazua login을 먼저 실행해 주세요',
  'cli-token-revoked': 'CLI 연결이 끊겼어요. gazua login을 다시 실행해 주세요',
  'cli-token-expired': 'CLI 로그인이 만료됐어요(90일). gazua login을 다시 실행해 주세요',
  'cli-scope': '서버가 읽기 전용 밖의 요청이라며 거절했어요',
  'not-allowed': '이 계정은 허용 목록에 없어요',
  'server-outdated': '서버가 CLI를 아직 지원하지 않아요. 서버(Worker)를 업데이트해 주세요',
  'login-expired': '로그인 코드가 만료됐어요. gazua login을 다시 실행해 주세요',
  'login-denied': '앱에서 연결을 거절했어요',
  'rate-limited': '요청이 너무 많아요. 잠시 뒤 다시 시도해 주세요',
  network: '서버에 연결할 수 없어요',
  'profile-required': '프로필이 여럿이에요. --profile로 골라 주세요',
  'profile-not-found': '프로필을 찾을 수 없어요',
  'strategy-not-found': '전략을 찾을 수 없어요',
  'ambiguous-strategy': '같은 이름의 전략이 여럿이에요. ID로 골라 주세요',
  'no-credentials': '증권사 키가 없어요. 환경변수(KIS_APP_KEY·KIS_APP_SECRET 또는 TOSS_CLIENT_ID·TOSS_CLIENT_SECRET)나 --env-file로 알려 주세요',
  'provider-unsupported': '이 공급자로는 할 수 없는 명령이에요',
  'path-blocked': '허용되지 않은 증권사 경로라서 막았어요',
  'ip-not-allowed': '증권사가 이 기기의 IP를 허용하지 않아요. 개발자 콘솔에 등록해 주세요',
  'invalid-credentials': '증권사 키가 맞지 않아요',
  'token-throttled': '증권사 토큰 발급 제한에 걸렸어요. 1분 뒤 다시 시도해 주세요',
  'token-contended': '다른 실행이나 앱이 같은 키로 토큰을 쓰고 있어요. 토스는 CLI용 앱 키를 따로 쓰세요',
  'token-busy': '다른 gazua 실행이 토큰을 받는 중이에요. 잠시 뒤 다시 시도해 주세요',
  upstream: '증권사 응답에 문제가 있어요',
  timeout: '증권사 응답이 늦어요',
  'app-outdated': '서버 문서가 이 CLI보다 새로워요. CLI를 업데이트해 주세요',
  internal: '예상하지 못한 오류예요',
} as const;

export type CliErrorCode = keyof typeof MESSAGES;

export class CliError extends Error {
  readonly code: CliErrorCode;
  readonly data?: unknown;
  constructor(code: CliErrorCode, message: string = MESSAGES[code], data?: unknown) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    if (data !== undefined) this.data = data;
  }
}

const PASS_THROUGH: readonly ErrorCode[] = ['ip-not-allowed', 'invalid-credentials', 'token-throttled', 'token-contended', 'upstream', 'timeout', 'rate-limited', 'path-blocked'];

/** CLI는 프록시를 쓰지 않아 proxy-unreachable·offline이라는 이름이 맞지 않는다 → network */
export function fromApiError(e: ApiError): CliError {
  if (e.code === 'proxy-unreachable' || e.code === 'offline') return new CliError('network');
  if (PASS_THROUGH.includes(e.code)) return new CliError(e.code as CliErrorCode);
  return new CliError('upstream');
}

/** 모르는 오류의 원문은 내보내지 않는다(요청 정보가 섞일 수 있다) */
export function toCliError(e: unknown): CliError {
  if (e instanceof CliError) return e;
  if (e instanceof ApiError) return fromApiError(e);
  return new CliError('internal');
}

export const exitCodeOf = (code: CliErrorCode): 1 | 2 => (code === 'invalid-args' ? 2 : 1);
```

`cli/src/output.ts`:

```ts
// 출력: 표준 출력에는 JSON 한 줄만. 비밀값은 출력 직전에 한 번 더 거른다(스펙 §6.4).
export const HIDDEN = '[숨김]';

/** 동기화의 FORBIDDEN_KEYS는 쓰지 않는다. holdings·provider·orders처럼 CLI가 정상으로 내는 키가 있어서다 */
export const SECRET_KEYS: ReadonlySet<string> = new Set([
  'appkey', 'appsecret', 'clientid', 'clientsecret', 'accesstoken', 'refreshtoken', 'token', 'proxytoken', 'accountseq', 'devicecode', 'secrets',
]);

/** 이보다 짧은 값은 문자열 치환에서 뺀다(짧은 accountSeq가 출력 전체를 망가뜨리지 않게). 키 이름 거르기는 그대로 적용된다 */
const MIN_SECRET_LENGTH = 6;

export interface Redactor {
  /** 지금 실행의 비밀값(환경변수 키, CLI 토큰, 접근 토큰, accountSeq)을 등록한다 */
  add(value: string | undefined): void;
  apply<T>(value: T): T;
}

export function createRedactor(): Redactor {
  const secrets = new Set<string>();
  const scrub = (s: string): string => {
    let out = s;
    for (const v of [...secrets].sort((a, b) => b.length - a.length)) out = out.split(v).join(HIDDEN);
    return out;
  };
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return scrub(v);
    if (Array.isArray(v)) return v.map(walk);
    if (typeof v === 'object' && v !== null) {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET_KEYS.has(k.toLowerCase()) ? HIDDEN : walk(x)]));
    }
    return v;
  };
  return {
    add(value) {
      if (value !== undefined && value.length >= MIN_SECRET_LENGTH) secrets.add(value);
    },
    apply: <T>(value: T) => walk(value) as T,
  };
}

export type Result =
  | { ok: true; data: unknown; warnings?: string[] }
  | { ok: false; error: { code: string; message: string }; data?: unknown; warnings?: string[] };

export function ok(data: unknown, warnings: string[] = []): Result {
  return warnings.length ? { ok: true, data, warnings } : { ok: true, data };
}

export function fail(code: string, message: string, data?: unknown, warnings: string[] = []): Result {
  return { ok: false, error: { code, message }, ...(data !== undefined ? { data } : {}), ...(warnings.length ? { warnings } : {}) };
}

export const render = (r: Result, redactor: Redactor, pretty: boolean): string => `${JSON.stringify(redactor.apply(r), null, pretty ? 2 : undefined)}\n`;
```

`cli/src/args.ts`:

```ts
import { parseArgs } from 'node:util';
import { CliError } from './errors';

export interface Args {
  command: string;
  positionals: string[];
  profile?: string;
  provider?: 'kis' | 'toss';
  label?: string;
  server?: string;
  strategy?: string;
  envFile?: string;
  from?: string;
  to?: string;
  pretty: boolean;
  verbose: boolean;
  today: boolean;
  raw: boolean;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const bad = (message: string) => new CliError('invalid-args', message);

export function parseArgv(argv: string[]): Args {
  const parsed = (() => {
    try {
      return parseArgs({
        args: argv,
        allowPositionals: true,
        strict: true,
        options: {
          profile: { type: 'string' },
          provider: { type: 'string' },
          label: { type: 'string' },
          server: { type: 'string' },
          strategy: { type: 'string' },
          'env-file': { type: 'string' },
          from: { type: 'string' },
          to: { type: 'string' },
          pretty: { type: 'boolean' },
          verbose: { type: 'boolean' },
          today: { type: 'boolean' },
          raw: { type: 'boolean' },
        },
      });
    } catch {
      throw bad('알 수 없는 옵션이거나 값이 빠졌어요');
    }
  })();
  const v = parsed.values as Record<string, string | boolean | undefined>;
  const provider = v.provider as string | undefined;
  if (provider !== undefined && provider !== 'kis' && provider !== 'toss') throw bad('--provider는 kis 또는 toss예요');
  for (const k of ['from', 'to'] as const) {
    const d = v[k];
    if (typeof d === 'string' && !DATE.test(d)) throw bad(`--${k}는 YYYY-MM-DD 모양이어야 해요`);
  }
  const [command = '', ...positionals] = parsed.positionals;
  const str = (k: string) => (typeof v[k] === 'string' ? (v[k] as string) : undefined);
  return {
    command,
    positionals,
    ...(provider !== undefined && { provider }),
    ...(str('profile') !== undefined && { profile: str('profile') }),
    ...(str('label') !== undefined && { label: str('label') }),
    ...(str('server') !== undefined && { server: str('server') }),
    ...(str('strategy') !== undefined && { strategy: str('strategy') }),
    ...(str('env-file') !== undefined && { envFile: str('env-file') }),
    ...(str('from') !== undefined && { from: str('from') }),
    ...(str('to') !== undefined && { to: str('to') }),
    pretty: v.pretty === true,
    verbose: v.verbose === true,
    today: v.today === true,
    raw: v.raw === true,
  };
}
```


`cli/src/context.ts`:

```ts
import type { Args } from './args';
import type { Redactor } from './output';

/** 명령 하나가 받는 것. 시계·잠·네트워크를 주입받아 테스트에서 바꿔 끼운다 */
export interface Ctx {
  args: Args;
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  hostname: () => string;
  /** 저장 파일 디렉터리(~/.config/gazua) */
  dir: string;
  /** 사람이 읽을 안내(표준 오류, 늘 나간다) */
  say: (line: string) => void;
  /** 진행 로그(표준 오류, --verbose일 때만) */
  log: (line: string) => void;
  /** 결과의 warnings에 붙는다 */
  warn: (message: string) => void;
  redact: Redactor;
}

/** 돌려준 값이 { ok: true, data }의 data가 된다. 실패는 CliError를 던진다 */
export type Command = (ctx: Ctx) => Promise<unknown>;

export interface Io {
  stdout(text: string): void;
  stderr(text: string): void;
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  now(): number;
  sleep(ms: number): Promise<void>;
  hostname(): string;
  /** 저장 디렉터리 덮어쓰기(테스트) */
  dir?: string;
}
```

`cli/src/config.ts`:

```ts
// ~/.config/gazua/ 저장 파일. 디렉터리 700, 파일 600, 쓰기는 임시 파일 → rename. 비밀번호·증권사 키는 두지 않는다.
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

export const DIR_MODE = 0o700;
export const FILE_MODE = 0o600;

export function configDir(env: Record<string, string | undefined>, home: string = homedir()): string {
  const xdg = env.XDG_CONFIG_HOME?.trim();
  return join(xdg ? xdg : join(home, '.config'), 'gazua');
}

/** 새로 만들 때만 700으로 한다(이미 있는 디렉터리의 권한은 바꾸지 않고, 읽을 때 경고한다) */
export function ensureDir(dir: string): void {
  if (existsSync(dir)) return;
  mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  chmodSync(dir, DIR_MODE);
}

export function readJsonFile<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

export function writeJsonFile(path: string, value: unknown): void {
  ensureDir(dirname(path));
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, JSON.stringify(value), { mode: FILE_MODE });
  chmodSync(tmp, FILE_MODE); // umask와 상관없이 600
  renameSync(tmp, path);
}

/** 디렉터리가 700보다, 파일이 600보다 넓으면 경고 문구를 돌려준다. Windows는 검사하지 않는다 */
export function permissionWarnings(dir: string, files: string[]): string[] {
  if (process.platform === 'win32') return [];
  const out: string[] = [];
  const loose = (p: string) => (statSync(p).mode & 0o077) !== 0;
  if (existsSync(dir) && loose(dir)) out.push(`${basename(dir)} 디렉터리 권한이 넓어요. chmod 700으로 줄여 주세요`);
  for (const f of files) {
    const p = join(dir, f);
    if (existsSync(p) && loose(p)) out.push(`${f} 권한이 넓어요. chmod 600으로 줄여 주세요`);
  }
  return out;
}

export interface AuthFile {
  v: 1;
  server: string;
  token: string;
  tokenId: string;
  label: string;
  expiresAt: number;
}

export const authPath = (dir: string): string => join(dir, 'auth.json');

export function readAuth(dir: string): { auth: AuthFile | null; warnings: string[] } {
  const raw = readJsonFile<Partial<AuthFile>>(authPath(dir));
  const valid =
    raw !== null && raw.v === 1 && typeof raw.server === 'string' && typeof raw.token === 'string' && typeof raw.tokenId === 'string' && typeof raw.label === 'string' && typeof raw.expiresAt === 'number';
  return { auth: valid ? (raw as AuthFile) : null, warnings: valid ? permissionWarnings(dir, ['auth.json']) : [] };
}

export const writeAuth = (dir: string, auth: AuthFile): void => writeJsonFile(authPath(dir), auth);

export function removeAuth(dir: string): boolean {
  if (!existsSync(authPath(dir))) return false;
  rmSync(authPath(dir), { force: true });
  return true;
}
```

`cli/src/main.ts`:

```ts
// gazua 진입점: 인자 해석 → 명령 분기 → JSON 한 줄. 읽기 전용이라 쓰기·주문 명령은 없다.
import { realpathSync } from 'node:fs';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgv } from './args';
import { configDir } from './config';
import type { Command, Ctx, Io } from './context';
import { CliError, exitCodeOf, toCliError } from './errors';
import { createRedactor, fail, ok, render, type Result } from './output';

export const COMMANDS: Record<string, Command> = {
  // 명령은 Task마다 여기에 더한다
};

/** 증권사 키를 담는 환경변수. 명령 검증보다 먼저 출력 거르기에 등록해, 인자 오류 메시지가 입력을 되풀이해도 키가 나가지 않게 한다 */
const SECRET_ENV = ['KIS_APP_KEY', 'KIS_APP_SECRET', 'TOSS_CLIENT_ID', 'TOSS_CLIENT_SECRET'] as const;

function loadEnvFile(path: string): void {
  try {
    process.loadEnvFile(path); // 이미 있는 환경변수는 덮어쓰지 않는다
  } catch {
    throw new CliError('invalid-args', '--env-file을 읽을 수 없어요');
  }
}

export async function run(argv: string[], io: Io): Promise<number> {
  const redact = createRedactor();
  const warnings: string[] = [];
  let pretty = false;
  let verbose = false;
  const emit = (r: Result) => io.stdout(render(r, redact, pretty));
  const registerEnvSecrets = () => {
    for (const name of SECRET_ENV) redact.add(io.env[name]?.trim());
  };
  registerEnvSecrets();
  try {
    const args = parseArgv(argv);
    pretty = args.pretty;
    verbose = args.verbose;
    if (args.envFile) {
      loadEnvFile(args.envFile);
      registerEnvSecrets(); // --env-file로 들어온 키도
    }
    const cmd = Object.hasOwn(COMMANDS, args.command) ? COMMANDS[args.command] : undefined;
    if (!cmd) {
      const names = Object.keys(COMMANDS).join(' · ');
      throw new CliError('invalid-args', args.command ? `알 수 없는 명령이에요: ${args.command} (${names})` : `명령이 필요해요: ${names}`);
    }
    const ctx: Ctx = {
      args,
      env: io.env,
      fetch: io.fetch,
      now: io.now,
      sleep: io.sleep,
      hostname: io.hostname,
      dir: io.dir ?? configDir(io.env),
      say: (line) => io.stderr(`${redact.apply(line)}\n`),
      log: (line) => {
        if (verbose) io.stderr(`${redact.apply(line)}\n`);
      },
      warn: (message) => {
        if (!warnings.includes(message)) warnings.push(message); // 같은 경고는 한 번만
      },
      redact,
    };
    emit(ok(await cmd(ctx), warnings));
    return 0;
  } catch (e) {
    const err = toCliError(e);
    if (verbose && !(e instanceof CliError)) io.stderr(`${redact.apply(e instanceof Error ? (e.stack ?? e.message) : String(e))}\n`);
    emit(fail(err.code, err.message, err.data, warnings));
    return exitCodeOf(err.code);
  }
}

/** bin으로 실행됐을 때만 돈다(테스트가 import해도 실행되지 않게). 링크로 실행해도 실제 경로로 비교한다 */
function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMain()) {
  run(process.argv.slice(2), {
    stdout: (s) => void process.stdout.write(s),
    stderr: (s) => void process.stderr.write(s),
    env: process.env,
    fetch: (...a) => fetch(...a),
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    hostname,
  }).then((code) => {
    process.exitCode = code;
  });
}
```

`cli/src/testing.ts`(테스트 전용. 번들 진입점에서 import하지 않는다):

```ts
// 테스트 전용 도우미. main.ts가 import하지 않으므로 번들에 들어가지 않는다.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Io } from './context';

const dirs: string[] = [];
export function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'gazua-cli-test-'));
  dirs.push(d);
  return d;
}
export function cleanupDirs(): void {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
}

export function makeIo(o: { env?: Record<string, string | undefined>; fetch?: typeof fetch; dir?: string; now?: number } = {}) {
  const dir = o.dir ?? tempDir();
  const clock = { now: o.now ?? Date.UTC(2026, 10, 2, 3, 0, 0) };
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    stdout: (s) => void out.push(s),
    stderr: (s) => void err.push(s),
    env: o.env ?? {},
    fetch: o.fetch ?? ((async () => {
      throw new TypeError('테스트에는 네트워크가 없어요');
    }) as typeof fetch),
    now: () => clock.now,
    sleep: async (ms) => {
      clock.now += ms;
    },
    hostname: () => 'testhost',
    dir,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { io, out, err, clock, dir, result: (): any => JSON.parse(out.join('')) };
}

export interface FakeCall {
  method: string;
  url: URL;
  headers: Headers;
  /** JSON 본문은 파싱해서, 그 밖(폼)은 문자열 그대로 */
  body: unknown;
}
export type FakeReply = { status?: number; body?: unknown; headers?: Record<string, string> } | Error;

export function fakeFetch(handler: (call: FakeCall) => FakeReply | undefined | Promise<FakeReply | undefined>): typeof fetch & { calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = init?.body;
    let body: unknown = raw ?? undefined;
    if (typeof raw === 'string') {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    }
    const call: FakeCall = { method: init?.method ?? 'GET', url: new URL(String(input)), headers: new Headers(init?.headers), body };
    calls.push(call);
    const r = await handler(call);
    if (r instanceof Error) throw r;
    const reply = r ?? { status: 404, body: { error: 'unrouted' } };
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200, headers: { 'content-type': 'application/json', ...reply.headers } });
  }) as typeof fetch;
  return Object.assign(f, { calls });
}
```

`cli/build.mjs`:

```js
// 읽기 전용 CLI 번들: src/main.ts → dist/gazua.mjs (esbuild 단일 파일, Node 22).
// 앱 코드를 상대 경로로 묶으므로 브라우저 전용 코드(import.meta.env, window, navigator.locks)가 딸려 들어오면 빌드를 실패시킨다.
import { build } from 'esbuild';
import { chmodSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

/** 번들에 있으면 안 되는 문자열 */
export const FORBIDDEN = ['import.meta.env', 'window.', 'navigator.locks'];

export const findForbidden = (text) => FORBIDDEN.filter((s) => text.includes(s));

export async function bundle(outfile = join(root, 'dist', 'gazua.mjs'), env = process.env) {
  await build({
    entryPoints: [join(root, 'src', 'main.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    banner: { js: '#!/usr/bin/env node' },
    // import.meta.env 전체가 아니라 기본 서버 주소 상수 하나만 넣는다(src/main에서 typeof로 읽는다)
    define: { __GAZUA_DEFAULT_SERVER__: JSON.stringify((env.VITE_SYNC_API_URL ?? '').trim().replace(/\/+$/, '')) },
    logLevel: 'warning',
  });
  chmodSync(outfile, 0o755);
  const hits = findForbidden(readFileSync(outfile, 'utf8'));
  if (hits.length) throw new Error(`번들에 브라우저 전용 코드가 들어왔어요: ${hits.join(', ')}`);
  return outfile;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  bundle().then(
    (file) => console.log(`built ${file}`),
    (e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    },
  );
}
```

- [ ] **Step 5: 통과 확인**

Run: `corepack pnpm --filter gazua-cli test && corepack pnpm --filter gazua-cli check`
Expected: PASS. 번들 검사에서 `window.` 등이 걸리면 어느 모듈이 끌려 들어왔는지 `cli/dist/gazua.mjs`에서 찾아 import를 고친다(검사 목록을 느슨하게 하지 않는다). `bundle.test.ts`의 `build.mjs` 직접 실행이 `parseArgs` 형식 문제로 실패하면 `node cli/build.mjs`를 손으로 돌려 메시지를 본다.

- [ ] **Step 6: 커밋**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml cli
git commit -m "feat(cli): gazua-cli 워크스페이스 골격과 JSON 출력·오류 코드·설정 파일을 더함"
```

---

## Task 9: `gazua login`·`gazua logout`

**Files:**
- Create: `cli/src/syncClient.ts`, `cli/src/session.ts`, `cli/src/commands/login.ts`
- Create(테스트): `cli/src/syncClient.test.ts`, `cli/src/commands/login.test.ts`
- Modify: `cli/src/main.ts`(import와 `COMMANDS`), `cli/src/commands/login.test.ts`(빌드 기본 서버 주소 검사. 이 값을 읽는 `session.ts`가 이 Task에서 생긴다)

**Interfaces:**
- Consumes: Task 8의 `Ctx`, `Command`, `CliError`, `readAuth`/`writeAuth`/`removeAuth`, `fakeFetch`, `makeIo`; Worker 계약(Global Constraints).
- Produces:
  ```ts
  // syncClient.ts
  export const DOC_VERSION = 2;                                // 앱 PROFILE_DOC_VERSION과 같아야 한다(테스트가 확인)
  export const APP_OUTDATED_CODE = '앱을 새로 고쳐 주세요';      // 앱 APP_OUTDATED_CODE와 같아야 한다(테스트가 확인)
  export interface DeviceGrant { deviceCode: string; userCode: string; verifyUrl: string; interval: number; expiresIn: number }
  export type PollResult = { kind: 'token'; token: string; tokenId: string; expiresAt: number } | { kind: 'pending' } | { kind: 'slow_down' };
  export interface ProfileIndexRow { profileId: string; revision: number; updatedAt: number; deletedAt: number | null; purgeAt: number | null }
  export interface SyncClient {
    device(label: string): Promise<DeviceGrant>;
    token(deviceCode: string): Promise<PollResult>;
    profiles(): Promise<ProfileIndexRow[]>;
    profile(id: string): Promise<{ revision: number; doc: unknown }>;   // GET /v1/profiles/:id?docVersion=2
    revoke(): Promise<void>;                                            // DELETE /v1/cli/token
  }
  export function createSyncClient(o: { server: string; token?: string; fetchImpl: typeof fetch; timeoutMs?: number }): SyncClient;
  // session.ts
  export function normalizeServer(raw: string): string;          // https만(localhost·127.0.0.1·[::1]의 http 예외), origin으로
  export function resolveServer(ctx: Ctx): string;               // --server > GAZUA_SYNC_URL > 빌드 기본값
  export function requireAuth(ctx: Ctx): AuthFile;               // not-logged-in, 로컬 만료면 cli-token-expired, 토큰을 redact에 등록
  export function authedClient(ctx: Ctx): SyncClient;
  // commands/login.ts
  export const login: Command;   // data: { label, expiresAt }
  export const logout: Command;  // data: { serverRevoked: boolean, fileRemoved: boolean }
  ```

- [ ] **Step 1: 실패하는 테스트 쓰기**

`cli/src/syncClient.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PROFILE_DOC_VERSION, APP_OUTDATED_CODE as APP_CODE } from '../../src/lib/sync/dto';
import { CliError, type CliErrorCode } from './errors';
import { APP_OUTDATED_CODE, createSyncClient, DOC_VERSION } from './syncClient';
import { fakeFetch, type FakeReply } from './testing';

const TOKEN = `gzc_${'A'.repeat(43)}`;
/** token을 null로 주면 무인증(Authorization 없음). undefined는 기본 토큰이 되므로 쓰지 않는다 */
const client = (reply: FakeReply | ((path: string) => FakeReply), token: string | null = TOKEN) => {
  const f = fakeFetch((c) => (typeof reply === 'function' ? reply(c.url.pathname + c.url.search) : reply));
  return { c: createSyncClient({ server: 'https://sync.example', ...(token === null ? {} : { token }), fetchImpl: f }), f };
};
const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (e) {
    return (e as CliError).code;
  }
  return 'no-error';
};

describe('앱과 같은 값', () => {
  it('문서 버전과 앱 갱신 코드가 앱과 같다(번들에 앱의 dto.ts를 끌어오지 않으려고 따로 둔 값)', () => {
    expect(DOC_VERSION).toBe(PROFILE_DOC_VERSION);
    expect(APP_OUTDATED_CODE).toBe(APP_CODE);
  });
});

describe('요청', () => {
  it('Authorization: Gazua-CLI 헤더, Origin 없음, docVersion=2', async () => {
    const { c, f } = client({ body: { revision: 3, doc: { v: 2 } } });
    await c.profile('p 1');
    const call = f.calls[0];
    expect(call.url.href).toBe('https://sync.example/v1/profiles/p%201?docVersion=2');
    expect(call.method).toBe('GET');
    expect(call.headers.get('authorization')).toBe(`Gazua-CLI ${TOKEN}`);
    expect(call.headers.has('origin')).toBe(false);
  });

  it('토큰이 없는 클라이언트는 Authorization을 보내지 않는다(device·token)', async () => {
    const { c, f } = client({ body: { deviceCode: 'd', userCode: 'BCDF-GHJK', verifyUrl: 'https://app/#/settings/sync', interval: 5, expiresIn: 600 } }, null);
    expect(await c.device('gazua@mac')).toMatchObject({ userCode: 'BCDF-GHJK', interval: 5 });
    expect(f.calls[0]).toMatchObject({ method: 'POST', body: { label: 'gazua@mac' } });
    expect(f.calls[0].headers.has('authorization')).toBe(false);
  });

  it('profiles는 색인을, revoke는 DELETE /v1/cli/token을 부른다', async () => {
    const rows = [{ profileId: 'p1', revision: 2, updatedAt: 1, deletedAt: null, purgeAt: null }];
    const a = client({ body: { profiles: rows } });
    expect(await a.c.profiles()).toEqual(rows);
    const b = client({ body: { revoked: true } });
    await b.c.revoke();
    expect(b.f.calls[0]).toMatchObject({ method: 'DELETE' });
    expect(b.f.calls[0].url.pathname).toBe('/v1/cli/token');
  });

  it('token 폴링은 pending·slow_down을 결과로, 200은 토큰으로 돌려준다', async () => {
    expect(await client({ status: 400, body: { error: 'pending' } }, null).c.token('d')).toEqual({ kind: 'pending' });
    expect(await client({ status: 400, body: { error: 'slow_down', interval: 10 } }, null).c.token('d')).toEqual({ kind: 'slow_down' });
    expect(await client({ body: { token: TOKEN, tokenId: 'id1', expiresAt: 5 } }, null).c.token('d')).toEqual({ kind: 'token', token: TOKEN, tokenId: 'id1', expiresAt: 5 });
  });
});

describe('응답 → 오류 코드', () => {
  const cases: [string, FakeReply, CliErrorCode][] = [
    ['401 cli-token-revoked', { status: 401, body: { error: 'cli-token-revoked' } }, 'cli-token-revoked'],
    ['401 cli-token-expired', { status: 401, body: { error: 'cli-token-expired' } }, 'cli-token-expired'],
    ['401 cli-token', { status: 401, body: { error: 'cli-token' } }, 'cli-token-revoked'],
    ['403 cli-scope', { status: 403, body: { error: 'cli-scope' } }, 'cli-scope'],
    ['403 not-allowed', { status: 403, body: { error: 'not-allowed' } }, 'not-allowed'],
    ['403 origin(옛 Worker)', { status: 403, body: { error: 'origin' } }, 'server-outdated'],
    ['404', { status: 404, body: { error: 'not-found' } }, 'server-outdated'],
    ['422 앱 갱신', { status: 422, body: { error: APP_OUTDATED_CODE } }, 'app-outdated'],
    ['422 그 밖', { status: 422, body: { error: 'invalid' } }, 'internal'],
    ['429', { status: 429, body: { error: 'rate-limited' } }, 'rate-limited'],
    ['503 cli-disabled', { status: 503, body: { error: 'cli-disabled' } }, 'server-outdated'],
    ['500', { status: 500, body: { error: 'internal' } }, 'internal'],
    ['연결 실패', new TypeError('fetch failed'), 'network'],
    ['리다이렉트', { status: 307, body: {} }, 'internal'],
  ];
  it.each(cases)('%s', async (_n, reply, want) => {
    expect(await codeOf(client(reply).c.profiles())).toBe(want);
  });

  it('profile(id)가 404 not-found면 profile-not-found, token의 410·403 denied·404 unknown-device', async () => {
    expect(await codeOf(client({ status: 404, body: { error: 'not-found' } }).c.profile('x'))).toBe('profile-not-found');
    expect(await codeOf(client({ status: 410, body: { error: 'expired' } }, null).c.token('d'))).toBe('login-expired');
    expect(await codeOf(client({ status: 410, body: { error: 'gone' } }).c.profile('p1'))).toBe('profile-not-found'); // 목록을 본 뒤 다른 기기에서 지운 프로필
    expect(await codeOf(client({ status: 410, body: { error: 'gone' } }).c.profiles())).toBe('internal');
    expect(await codeOf(client({ status: 403, body: { error: 'denied' } }, null).c.token('d'))).toBe('login-denied');
    expect(await codeOf(client({ status: 404, body: { error: 'unknown-device' } }, null).c.token('d'))).toBe('login-expired');
  });

  it('성공 응답의 모양이 틀리면 internal', async () => {
    expect(await codeOf(client({ body: { profiles: 'x' } }).c.profiles())).toBe('internal');
    expect(await codeOf(client({ body: { revision: 'x' } }).c.profile('p'))).toBe('internal');
    expect(await codeOf(client({ body: {} }, null).c.device('l'))).toBe('internal');
  });
});
```

`cli/src/commands/login.test.ts`:

```ts
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bundle } from '../../build.mjs';
import { authPath, readAuth, writeAuth } from '../config';
import { COMMANDS, run } from '../main';
import { cleanupDirs, fakeFetch, makeIo, tempDir, type FakeCall, type FakeReply } from '../testing';

afterEach(cleanupDirs);

const GRANT = { deviceCode: 'D'.repeat(43), userCode: 'BCDF-GHJK', verifyUrl: 'https://app.example/#/settings/sync', interval: 5, expiresIn: 600 };
const TOKEN = `gzc_${'T'.repeat(43)}`;

/** 폴링 응답을 차례로 돌려주는 가짜 서버 */
function server(polls: FakeReply[]) {
  let n = 0;
  return fakeFetch((c: FakeCall) => {
    if (c.url.pathname === '/v1/cli/device') return { body: GRANT };
    if (c.url.pathname === '/v1/cli/token') return polls[Math.min(n++, polls.length - 1)];
    return undefined;
  });
}
const pending: FakeReply = { status: 400, body: { error: 'pending' } };
const slow: FakeReply = { status: 400, body: { error: 'slow_down', interval: 10 } };
const granted: FakeReply = { body: { token: TOKEN, tokenId: 'tid-1', expiresAt: 1770000000000 } };

describe('gazua login', () => {
  it('device → pending → slow_down(간격 +5초) → 토큰, auth.json(600)에 쓰고 토큰은 출력하지 않는다', async () => {
    const f = server([pending, slow, granted]);
    const t = makeIo({ fetch: f, env: { GAZUA_SYNC_URL: 'https://sync.example/' } });
    const start = t.clock.now;
    expect(await run(['login'], t.io)).toBe(0);
    expect(t.result()).toEqual({ ok: true, data: { label: 'gazua@testhost', expiresAt: 1770000000000 } });
    expect(t.clock.now - start).toBe(5000 + 5000 + 10_000); // 5초 → pending, 5초 → slow_down, 10초 → 토큰
    expect(readAuth(t.dir).auth).toEqual({ v: 1, server: 'https://sync.example', token: TOKEN, tokenId: 'tid-1', label: 'gazua@testhost', expiresAt: 1770000000000 });
    if (process.platform !== 'win32') expect(statSync(authPath(t.dir)).mode & 0o777).toBe(0o600);
    expect(t.out.join('')).not.toContain(TOKEN);
    expect(t.err.join('')).toContain('BCDF-GHJK');
    expect(t.err.join('')).toContain(GRANT.verifyUrl);
    expect(t.err.join('')).not.toContain(GRANT.deviceCode);
    expect(f.calls[0].body).toEqual({ label: 'gazua@testhost' });
    expect(f.calls.slice(1).every((c) => (c.body as { deviceCode: string }).deviceCode === GRANT.deviceCode)).toBe(true);
  });

  it('간격은 60초를 넘지 않는다', async () => {
    let polls = 0;
    const f = fakeFetch((c) => {
      if (c.url.pathname === '/v1/cli/device') return { body: { ...GRANT, expiresIn: 100_000 } };
      return ++polls <= 14 ? slow : granted;
    });
    const t = makeIo({ fetch: f, env: { GAZUA_SYNC_URL: 'https://sync.example' } });
    const sleeps: number[] = [];
    t.io.sleep = async (ms) => {
      sleeps.push(ms);
      t.clock.now += ms;
    };
    expect(await run(['login'], t.io)).toBe(0);
    expect(Math.max(...sleeps)).toBe(60_000);
  });

  it('expired·denied는 login-expired·login-denied', async () => {
    const a = makeIo({ fetch: server([{ status: 410, body: { error: 'expired' } }]), env: { GAZUA_SYNC_URL: 'https://sync.example' } });
    expect(await run(['login'], a.io)).toBe(1);
    expect(a.result().error.code).toBe('login-expired');
    const b = makeIo({ fetch: server([pending, { status: 403, body: { error: 'denied' } }]), env: { GAZUA_SYNC_URL: 'https://sync.example' } });
    await run(['login'], b.io);
    expect(b.result().error.code).toBe('login-denied');
    expect(existsSync(authPath(b.dir))).toBe(false);
  });

  it('승인이 없이 10분이 지나면 login-expired(CLI 쪽 시한)', async () => {
    const t = makeIo({ fetch: server([pending]), env: { GAZUA_SYNC_URL: 'https://sync.example' } });
    await run(['login'], t.io);
    expect(t.result().error.code).toBe('login-expired');
  });

  it('서버 주소 우선순위: --server > GAZUA_SYNC_URL. 없으면 invalid-args', async () => {
    const f = server([granted]);
    const t = makeIo({ fetch: f, env: { GAZUA_SYNC_URL: 'https://from-env.example' } });
    await run(['login', '--server', 'https://from-flag.example/'], t.io);
    expect(f.calls[0].url.origin).toBe('https://from-flag.example');
    expect(readAuth(t.dir).auth?.server).toBe('https://from-flag.example');
    const none = makeIo();
    expect(await run(['login'], none.io)).toBe(2);
    expect(none.result().error.code).toBe('invalid-args');
  });

  it('https가 아니면 거절하고, localhost의 http만 허용한다', async () => {
    const bad = makeIo({ fetch: server([granted]) });
    expect(await run(['login', '--server', 'http://sync.example'], bad.io)).toBe(2);
    expect(await run(['login', '--server', 'not a url'], makeIo({ fetch: server([granted]) }).io)).toBe(2);
    const local = makeIo({ fetch: server([granted]) });
    expect(await run(['login', '--server', 'http://localhost:8787'], local.io)).toBe(0);
  });

  it('--label을 쓰고 64자로 자른다', async () => {
    const f = server([granted]);
    await run(['login', '--server', 'https://s.example', '--label', 'x'.repeat(80)], makeIo({ fetch: f }).io);
    expect((f.calls[0].body as { label: string }).label).toHaveLength(64);
  });

  it('login·logout은 등록돼 있다', () => {
    expect(COMMANDS.login).toBeTypeOf('function');
    expect(COMMANDS.logout).toBeTypeOf('function');
  });
});

describe('빌드에 넣은 기본 서버 주소', () => {
  it('VITE_SYNC_API_URL이 번들에 상수로 들어가고(끝 슬래시는 뗀다), 없으면 빈 문자열이다', { timeout: 60_000 }, async () => {
    const withUrl = await bundle(join(tempDir(), 'gazua.mjs'), { VITE_SYNC_API_URL: 'https://sync.example.test/' }); // 테스트마다 따로 임시 경로
    const text = readFileSync(withUrl, 'utf8');
    expect(text).toContain('https://sync.example.test');
    expect(text).not.toContain('https://sync.example.test/"');
    const without = await bundle(join(tempDir(), 'gazua.mjs'), { VITE_SYNC_API_URL: '' });
    expect(readFileSync(without, 'utf8')).not.toContain('https://sync.example.test');
  });
});

describe('gazua logout', () => {
  const AUTH = { v: 1 as const, server: 'https://sync.example', token: TOKEN, tokenId: 'tid-1', label: 'gazua@mac', expiresAt: 1770000000000 };

  it('서버에서 토큰을 끊고 auth.json을 지운다', async () => {
    const f = fakeFetch(() => ({ body: { revoked: true } }));
    const t = makeIo({ fetch: f });
    writeAuth(t.dir, AUTH);
    expect(await run(['logout'], t.io)).toBe(0);
    expect(t.result()).toEqual({ ok: true, data: { serverRevoked: true, fileRemoved: true } });
    expect(f.calls[0]).toMatchObject({ method: 'DELETE' });
    expect(f.calls[0].url.href).toBe('https://sync.example/v1/cli/token');
    expect(f.calls[0].headers.get('authorization')).toBe(`Gazua-CLI ${TOKEN}`);
    expect(existsSync(authPath(t.dir))).toBe(false);
  });

  it.each([['cli-token-revoked'], ['cli-token-expired']])('서버가 401 %s면 이미 끊긴 것이라 성공(경고 없음)', async (error) => {
    const t = makeIo({ fetch: fakeFetch(() => ({ status: 401, body: { error } })) });
    writeAuth(t.dir, AUTH);
    await run(['logout'], t.io);
    const r = t.result();
    expect(r).toEqual({ ok: true, data: { serverRevoked: true, fileRemoved: true } });
    expect(existsSync(authPath(t.dir))).toBe(false);
  });

  it('서버에 닿지 않아도 파일은 지우고 warnings를 붙인다', async () => {
    const t = makeIo({ fetch: fakeFetch(() => new TypeError('fetch failed')) });
    writeAuth(t.dir, AUTH);
    expect(await run(['logout'], t.io)).toBe(0);
    const r = t.result();
    expect(r.data).toEqual({ serverRevoked: false, fileRemoved: true });
    expect(r.warnings).toEqual(['서버 연결은 앱에서 끊어 주세요(설정 › 동기화·공유 › 로그인한 기기)']);
    expect(existsSync(authPath(t.dir))).toBe(false);
  });

  it('로그인하지 않았으면 아무것도 하지 않고 성공', async () => {
    const f = fakeFetch(() => ({ body: {} }));
    const t = makeIo({ fetch: f });
    await run(['logout'], t.io);
    expect(t.result().data).toEqual({ serverRevoked: false, fileRemoved: false });
    expect(f.calls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `corepack pnpm --filter gazua-cli test -- syncClient login`
Expected: FAIL — `./syncClient`, `./commands/login`을 찾을 수 없다.

- [ ] **Step 3: 최소 구현**

`cli/src/syncClient.ts`:

```ts
// 동기화 API 클라이언트: /v1/cli/*, /v1/profiles. CLI 토큰은 Authorization: Gazua-CLI 헤더로 보낸다(Origin은 보내지 않는다).
// 앱 dto.ts(전략 검증기까지 끌어오는 모듈)를 번들에 넣지 않으려고 두 값을 여기에 따로 두고, 같은지는 테스트가 확인한다.
import { CliError } from './errors';

export const DOC_VERSION = 2;
export const APP_OUTDATED_CODE = '앱을 새로 고쳐 주세요';
const TIMEOUT_MS = 15_000;

export interface DeviceGrant {
  deviceCode: string;
  userCode: string;
  verifyUrl: string;
  interval: number;
  expiresIn: number;
}
export type PollResult = { kind: 'token'; token: string; tokenId: string; expiresAt: number } | { kind: 'pending' } | { kind: 'slow_down' };
export interface ProfileIndexRow {
  profileId: string;
  revision: number;
  updatedAt: number;
  deletedAt: number | null;
  purgeAt: number | null;
}
export interface SyncClient {
  device(label: string): Promise<DeviceGrant>;
  token(deviceCode: string): Promise<PollResult>;
  profiles(): Promise<ProfileIndexRow[]>;
  profile(id: string): Promise<{ revision: number; doc: unknown }>;
  revoke(): Promise<void>;
}

type Where = 'device' | 'token' | 'profiles' | 'profile' | 'revoke';
type Body = Record<string, unknown>;
const isRecord = (v: unknown): v is Body => typeof v === 'object' && v !== null && !Array.isArray(v);
const internal = (message = '서버 응답 모양이 맞지 않아요') => new CliError('internal', message);

function failFrom(status: number, body: Body, where: Where): CliError {
  const code = typeof body.error === 'string' ? body.error : '';
  if (status === 401) return new CliError(code === 'cli-token-expired' ? 'cli-token-expired' : 'cli-token-revoked');
  if (status === 403) {
    if (code === 'denied') return new CliError('login-denied');
    if (code === 'not-allowed') return new CliError('not-allowed');
    if (code === 'cli-scope') return new CliError('cli-scope');
    return new CliError('server-outdated'); // Origin 없는 요청을 403 origin으로 막는 옛 Worker
  }
  if (status === 404) {
    if (where === 'profile' && code === 'not-found') return new CliError('profile-not-found');
    if (where === 'token' && code === 'unknown-device') return new CliError('login-expired');
    return new CliError('server-outdated');
  }
  // 410: 기기 코드 폴링의 expired만 로그인 만료. 삭제된 프로필 조회의 410 gone은 프로필을 못 찾는 것
  if (status === 410) return where === 'token' ? new CliError('login-expired') : where === 'profile' ? new CliError('profile-not-found') : internal(`서버 오류예요(HTTP ${status})`);
  if (status === 422) return code === APP_OUTDATED_CODE ? new CliError('app-outdated') : internal(`서버가 요청을 받지 않았어요(${code || '422'})`);
  if (status === 429) return new CliError('rate-limited');
  if (status === 503 && code === 'cli-disabled') return new CliError('server-outdated');
  return internal(`서버 오류예요(HTTP ${status})`);
}

export function createSyncClient(o: { server: string; token?: string; fetchImpl: typeof fetch; timeoutMs?: number }): SyncClient {
  async function call(method: string, path: string, body?: unknown): Promise<{ status: number; body: Body }> {
    const headers: Record<string, string> = {};
    if (o.token) headers.Authorization = `Gazua-CLI ${o.token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    try {
      const res = await o.fetchImpl(`${o.server}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(o.timeoutMs ?? TIMEOUT_MS),
        redirect: 'manual', // 토큰이 다른 출처로 넘어가지 않게
      });
      const text = await res.text();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        /* 본문이 JSON이 아니면 빈 객체로 본다 */
      }
      return { status: res.status, body: isRecord(parsed) ? parsed : {} };
    } catch {
      throw new CliError('network');
    }
  }
  const must = async (where: Where, method: string, path: string, body?: unknown): Promise<Body> => {
    const r = await call(method, path, body);
    if (r.status !== 200) throw failFrom(r.status, r.body, where);
    return r.body;
  };

  return {
    async device(label) {
      const b = await must('device', 'POST', '/v1/cli/device', { label });
      if (typeof b.deviceCode !== 'string' || typeof b.userCode !== 'string' || typeof b.verifyUrl !== 'string' || typeof b.interval !== 'number' || typeof b.expiresIn !== 'number') throw internal();
      return { deviceCode: b.deviceCode, userCode: b.userCode, verifyUrl: b.verifyUrl, interval: b.interval, expiresIn: b.expiresIn };
    },
    async token(deviceCode) {
      const r = await call('POST', '/v1/cli/token', { deviceCode });
      if (r.status === 400 && r.body.error === 'pending') return { kind: 'pending' };
      if (r.status === 400 && r.body.error === 'slow_down') return { kind: 'slow_down' };
      if (r.status !== 200) throw failFrom(r.status, r.body, 'token');
      const b = r.body;
      if (typeof b.token !== 'string' || typeof b.tokenId !== 'string' || typeof b.expiresAt !== 'number') throw internal();
      return { kind: 'token', token: b.token, tokenId: b.tokenId, expiresAt: b.expiresAt };
    },
    async profiles() {
      const b = await must('profiles', 'GET', '/v1/profiles');
      if (!Array.isArray(b.profiles)) throw internal();
      return b.profiles as ProfileIndexRow[];
    },
    async profile(id) {
      const b = await must('profile', 'GET', `/v1/profiles/${encodeURIComponent(id)}?docVersion=${DOC_VERSION}`);
      if (typeof b.revision !== 'number' || !('doc' in b)) throw internal();
      return { revision: b.revision, doc: b.doc };
    },
    async revoke() {
      await must('revoke', 'DELETE', '/v1/cli/token');
    },
  };
}
```

`cli/src/session.ts`:

```ts
// 로그인 세션: 서버 주소 정하기, auth.json 읽기, 인증된 동기화 클라이언트.
import { readAuth, type AuthFile } from './config';
import type { Ctx } from './context';
import { CliError } from './errors';
import { createSyncClient, type SyncClient } from './syncClient';

// 빌드 때 esbuild define이 넣는 기본 서버 주소(VITE_SYNC_API_URL). 정의되지 않은 환경(테스트)에서는 ''.
declare const __GAZUA_DEFAULT_SERVER__: string | undefined;
const DEFAULT_SERVER = typeof __GAZUA_DEFAULT_SERVER__ === 'string' ? __GAZUA_DEFAULT_SERVER__ : '';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** https만. 로컬 개발(localhost·127.0.0.1·[::1])의 http만 예외. 경로·쿼리는 버리고 origin으로 */
export function normalizeServer(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new CliError('invalid-args', '서버 주소가 올바른 URL이 아니에요');
  }
  if (u.protocol === 'https:' || (u.protocol === 'http:' && LOCAL_HOSTS.has(u.hostname))) return u.origin;
  throw new CliError('invalid-args', '서버 주소는 https여야 해요(로컬 개발의 localhost만 http를 써요)');
}

export function resolveServer(ctx: Ctx): string {
  const raw = ctx.args.server ?? ctx.env.GAZUA_SYNC_URL ?? DEFAULT_SERVER;
  if (raw.trim() === '') throw new CliError('invalid-args', '서버 주소가 없어요. --server 또는 GAZUA_SYNC_URL로 알려 주세요');
  return normalizeServer(raw);
}

/** 로그인했는지 보고 auth.json을 돌려준다. 토큰은 출력 거르기에 등록한다 */
export function requireAuth(ctx: Ctx): AuthFile {
  const { auth, warnings } = readAuth(ctx.dir);
  for (const w of warnings) ctx.warn(w);
  if (!auth) throw new CliError('not-logged-in');
  ctx.redact.add(auth.token);
  if (auth.expiresAt <= ctx.now()) throw new CliError('cli-token-expired');
  return auth;
}

export function authedClient(ctx: Ctx): SyncClient {
  const auth = requireAuth(ctx);
  return createSyncClient({ server: auth.server, token: auth.token, fetchImpl: ctx.fetch });
}
```

`cli/src/commands/login.ts`:

```ts
import { readAuth, removeAuth, writeAuth } from '../config';
import type { Command } from '../context';
import { CliError, toCliError } from '../errors';
import { resolveServer } from '../session';
import { createSyncClient } from '../syncClient';

const INTERVAL_STEP_MS = 5000;
const INTERVAL_CAP_MS = 60_000;
const LABEL_MAX = 64;

/** 기기 코드 흐름(스펙 §6.8). 사람이 앱에서 승인해야 끝나므로 AI 도구가 대신 할 수 없다 */
export const login: Command = async (ctx) => {
  const server = resolveServer(ctx);
  const label = (ctx.args.label ?? `gazua@${ctx.hostname()}`).trim().slice(0, LABEL_MAX);
  if (label === '') throw new CliError('invalid-args', '--label이 비어 있어요');
  const client = createSyncClient({ server, fetchImpl: ctx.fetch });
  const grant = await client.device(label);
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
    writeAuth(ctx.dir, { v: 1, server, token: r.token, tokenId: r.tokenId, label, expiresAt: r.expiresAt });
    return { label, expiresAt: r.expiresAt };
  }
};

/** 서버 토큰을 끊고 auth.json을 지운다. 이미 끊긴 토큰(401 revoked·expired)은 성공으로 본다 */
export const logout: Command = async (ctx) => {
  const { auth, warnings } = readAuth(ctx.dir);
  for (const w of warnings) ctx.warn(w);
  if (!auth) return { serverRevoked: false, fileRemoved: false };
  ctx.redact.add(auth.token);
  let serverRevoked = true;
  try {
    await createSyncClient({ server: auth.server, token: auth.token, fetchImpl: ctx.fetch }).revoke();
  } catch (e) {
    const err = toCliError(e);
    if (err.code !== 'cli-token-revoked' && err.code !== 'cli-token-expired') {
      serverRevoked = false;
      ctx.warn('서버 연결은 앱에서 끊어 주세요(설정 › 동기화·공유 › 로그인한 기기)');
    }
  }
  removeAuth(ctx.dir);
  return { serverRevoked, fileRemoved: true };
};
```

`cli/src/main.ts`: import를 더하고 `COMMANDS`를 바꾼다.

```ts
import { login, logout } from './commands/login';
```

```ts
export const COMMANDS: Record<string, Command> = {
  login,
  logout,
};
```

- [ ] **Step 4: 통과 확인**

Run: `corepack pnpm --filter gazua-cli test && corepack pnpm --filter gazua-cli check`
Expected: PASS. (`login.test.ts`의 「간격은 60초를 넘지 않는다」는 서버 응답을 `f.calls.length`로 갈라 쓰므로, 불안정하면 `slow` 응답 14번 뒤에 `granted`를 주는 단순 카운터로 바꾼다. 확인할 것은 `sleep` 인자의 최댓값이 60000이라는 점뿐이다. `login.test.ts` 마지막 테스트의 `readFileSync` 줄은 쓰지 않는 import를 지우면서 같이 지운다.)

- [ ] **Step 5: 커밋**

```bash
git add cli
git commit -m "feat(cli): gazua login(기기 코드)과 logout(서버 철회)을 더함"
```

---

## Task 10: 데이터 명령 `profiles`·`watchlists`·`strategies`

**Files:**
- Create: `cli/src/profileData.ts`, `cli/src/commands/data.ts`
- Modify: `cli/src/testing.ts`(끝에 도우미 더하기)
- Modify: `cli/src/main.ts`(import, `COMMANDS`)
- Create(테스트): `cli/src/profileData.test.ts`, `cli/src/commands/data.test.ts`

**Interfaces:**
- Consumes: Task 9의 `authedClient`·`SyncClient`; 앱의 `sanitizeStrategiesV1`·`toV2`(`src/lib/sim/strategyV1.ts`), `sanitizeStrategiesV2`·`StrategyV2`(`strategyV2.ts`), `resolveSymbols`(`src/lib/sim/validate.ts`), `buyRulesSummary`·`sellRulesSummary`·`sizingText`(`src/lib/ui/simulate/simText.ts`), `Watchlists`·`WatchItem` 타입(`src/lib/state/schema.ts`).
- Produces:
  ```ts
  // profileData.ts
  export interface ProfileData { id: string; name: string; revision: number; watchlists: Watchlists; strategies: StrategyV2[] }
  export function normalizeDoc(doc: unknown, now: number): { name: string; watchlists: Watchlists; strategies: StrategyV2[] };
  export function loadAllProfiles(client: SyncClient, now: number): Promise<ProfileData[]>;           // 삭제 안 된 것 전부
  export function pickProfile(client: SyncClient, flag: string | undefined, now: number): Promise<ProfileData>;
  export function findStrategy(strategies: StrategyV2[], ref: string): StrategyV2;
  // commands/data.ts
  export const profiles: Command;     // data: { profiles: [{ id, name, revision, groups, strategies }] }
  export const watchlists: Command;   // data: { profile, groups: [{ id, name, symbols: [{ symbol, hidden }] }] }
  export const strategies: Command;   // data: { strategies: [{ id, name, universe, buy, sell, sizing, rules? }] }
  ```
  - `pickProfile`: 삭제 안 된 프로필이 0개면 `profile-not-found`; `flag`가 있으면 ID 정확 일치 → 없으면 이름 정확 일치(여럿이면 `profile-required`); `flag`가 없고 1개면 그것, 여럿이면 `profile-required`(`data.profiles = [{ id, name }]`).
  - `findStrategy`: 이름 정확 일치 → 없으면 ID. 같은 이름이 여럿이면 `ambiguous-strategy`(`data.matches = [{ id, name }]`), 없으면 `strategy-not-found`.
  - 서버 문서가 v1이면 `sanitizeStrategiesV1` → `toV2`로 옮겨 읽는다(저장하지 않는다). `v > 2`는 `app-outdated`.

- [ ] **Step 1: 실패하는 테스트 쓰기**

`cli/src/testing.ts` 끝에 더한다(맨 위 import에 두 줄 추가: `import { newStrategyV1 } from '../../src/lib/sim/strategyV1';`, `import { fullStrategyV2 } from '../../src/lib/sim/testStrategyV2';`).

```ts
/** 서버가 돌려주는 프로필 문서 모양(v1 또는 v2). 그룹 g0에 005930·000660, 전략 하나 */
export function profileDoc(v: 1 | 2, name = '내 프로필'): Record<string, unknown> {
  return {
    v,
    name,
    settings: { period: { unit: 'D', n: 1 }, metric: 'change', benchmark: 'AUTO', perfBenchmark: null, colorConvention: 'kr', boardOrder: 'value' },
    watchlists: {
      groups: [
        {
          id: 'g0',
          name: '반도체',
          items: [
            { symbol: '005930', colorSlot: 1, hidden: false, addedAt: 1 },
            { symbol: '000660', colorSlot: 2, hidden: true, addedAt: 1 },
          ],
        },
      ],
    },
    strategies: v === 1 ? [{ ...newStrategyV1(1, 'g0', '눌림목'), id: 's1' }] : [fullStrategyV2()],
    criteria: [],
    baskets: [],
  };
}

/** /v1/profiles와 /v1/profiles/:id?docVersion=2를 흉내 내는 가짜 동기화 서버 */
export function syncServer(profiles: Record<string, { doc: unknown; revision?: number; deleted?: boolean }>) {
  return fakeFetch((c) => {
    if (c.url.pathname === '/v1/profiles') {
      return {
        body: {
          profiles: Object.entries(profiles).map(([profileId, p]) => ({ profileId, revision: p.revision ?? 1, updatedAt: 1, deletedAt: p.deleted ? 5 : null, purgeAt: p.deleted ? 9 : null })),
        },
      };
    }
    const m = /^\/v1\/profiles\/([^/]+)$/.exec(c.url.pathname);
    if (m && c.url.searchParams.get('docVersion') === '2') {
      const p = profiles[decodeURIComponent(m[1])];
      return p ? { body: { revision: p.revision ?? 1, doc: p.doc } } : { status: 404, body: { error: 'not-found' } };
    }
    return undefined;
  });
}
```

`cli/src/profileData.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CliError } from './errors';
import { createSyncClient } from './syncClient';
import { findStrategy, loadAllProfiles, normalizeDoc, pickProfile } from './profileData';
import { profileDoc, syncServer } from './testing';
import { fullStrategyV2 } from '../../src/lib/sim/testStrategyV2';

const NOW = Date.UTC(2026, 10, 2);
const clientFor = (profiles: Parameters<typeof syncServer>[0]) => createSyncClient({ server: 'https://sync.example', token: `gzc_${'A'.repeat(43)}`, fetchImpl: syncServer(profiles) });
const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return { code: (e as CliError).code, data: (e as CliError).data };
  }
  return { code: 'no-error', data: undefined };
};

describe('normalizeDoc', () => {
  it('v1 문서는 전략을 v2로 옮겨 읽는다(매수 조건은 반등 패턴 블록 하나)', () => {
    const d = normalizeDoc(profileDoc(1), NOW);
    expect(d.name).toBe('내 프로필');
    expect(d.strategies).toHaveLength(1);
    expect(d.strategies[0]).toMatchObject({ v: 2, id: 's1', name: '눌림목' });
    expect(d.strategies[0].rules.buy[0].conds[0].kind).toBe('pattern');
    expect(d.watchlists.groups[0].items.map((i) => [i.symbol, i.hidden])).toEqual([['005930', false], ['000660', true]]);
  });

  it('v2 문서는 그대로', () => {
    const d = normalizeDoc(profileDoc(2), NOW);
    expect(d.strategies[0]).toEqual(fullStrategyV2());
  });

  it('v가 2보다 높으면 app-outdated, 모양이 이상하면 internal', () => {
    expect(() => normalizeDoc({ ...profileDoc(2), v: 3 }, NOW)).toThrow(expect.objectContaining({ code: 'app-outdated' }));
    expect(() => normalizeDoc('x', NOW)).toThrow(expect.objectContaining({ code: 'internal' }));
  });
});

describe('pickProfile', () => {
  const two = { p1: { doc: profileDoc(2, '내 프로필'), revision: 12 }, p2: { doc: profileDoc(2, '회사'), revision: 3 }, gone: { doc: profileDoc(2, '지운 것'), deleted: true } };

  it('삭제 안 된 프로필이 하나면 --profile 없이 그것', async () => {
    const p = await pickProfile(clientFor({ p1: two.p1, gone: two.gone }), undefined, NOW);
    expect(p).toMatchObject({ id: 'p1', name: '내 프로필', revision: 12 });
  });

  it('여럿인데 --profile이 없으면 profile-required(목록은 삭제 안 된 것만)', async () => {
    expect(await codeOf(pickProfile(clientFor(two), undefined, NOW))).toEqual({
      code: 'profile-required',
      data: { profiles: [{ id: 'p1', name: '내 프로필' }, { id: 'p2', name: '회사' }] },
    });
  });

  it('--profile은 ID가 먼저, 아니면 이름', async () => {
    expect((await pickProfile(clientFor(two), 'p2', NOW)).name).toBe('회사');
    expect((await pickProfile(clientFor(two), '회사', NOW)).id).toBe('p2');
    expect((await codeOf(pickProfile(clientFor(two), '없는 이름', NOW))).code).toBe('profile-not-found');
    expect((await codeOf(pickProfile(clientFor(two), 'gone', NOW))).code).toBe('profile-not-found'); // 삭제한 프로필은 고를 수 없다
  });

  it('같은 이름이 둘이면 profile-required, 프로필이 없으면 profile-not-found', async () => {
    const same = { a: { doc: profileDoc(2, '같은') }, b: { doc: profileDoc(2, '같은') } };
    expect((await codeOf(pickProfile(clientFor(same), '같은', NOW))).code).toBe('profile-required');
    expect((await codeOf(pickProfile(clientFor({}), undefined, NOW))).code).toBe('profile-not-found');
  });

  it('loadAllProfiles는 삭제 안 된 프로필 전부', async () => {
    expect((await loadAllProfiles(clientFor(two), NOW)).map((p) => p.id)).toEqual(['p1', 'p2']);
  });
});

describe('findStrategy', () => {
  const a = { ...fullStrategyV2(), id: 'a', name: '같은 이름' };
  const b = { ...fullStrategyV2(), id: 'b', name: '같은 이름' };
  const c = { ...fullStrategyV2(), id: 'c', name: '다른 이름' };

  it('이름 정확 일치가 먼저, 없으면 ID', () => {
    expect(findStrategy([a, c], '다른 이름').id).toBe('c');
    expect(findStrategy([a, c], 'a').id).toBe('a');
  });

  it('같은 이름이 여럿이면 ambiguous-strategy(후보 ID), 없으면 strategy-not-found', () => {
    expect(() => findStrategy([a, b, c], '같은 이름')).toThrow(expect.objectContaining({ code: 'ambiguous-strategy', data: { matches: [{ id: 'a', name: '같은 이름' }, { id: 'b', name: '같은 이름' }] } }));
    expect(() => findStrategy([a], 'zzz')).toThrow(expect.objectContaining({ code: 'strategy-not-found' }));
    expect(findStrategy([a, b], 'b').id).toBe('b'); // ID로는 고를 수 있다
  });
});
```

`cli/src/commands/data.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { writeAuth } from '../config';
import { run } from '../main';
import { cleanupDirs, makeIo, profileDoc, syncServer } from '../testing';

afterEach(cleanupDirs);
const TOKEN = `gzc_${'A'.repeat(43)}`;
const AUTH = { v: 1 as const, server: 'https://sync.example', token: TOKEN, tokenId: 't1', label: 'gazua@mac', expiresAt: Date.UTC(2027, 0, 1) };

function setup(profiles: Parameters<typeof syncServer>[0], loggedIn = true) {
  const f = syncServer(profiles);
  const t = makeIo({ fetch: f });
  if (loggedIn) writeAuth(t.dir, AUTH);
  return { f, t };
}

describe('로그인 확인', () => {
  it('로그인하지 않았으면 not-logged-in, 토큰이 로컬에서 만료됐으면 cli-token-expired(요청 없음)', async () => {
    const a = setup({ p1: { doc: profileDoc(2) } }, false);
    expect(await run(['profiles'], a.t.io)).toBe(1);
    expect(a.t.result().error.code).toBe('not-logged-in');
    const b = setup({ p1: { doc: profileDoc(2) } });
    b.t.clock.now = AUTH.expiresAt + 1;
    await run(['profiles'], b.t.io);
    expect(b.t.result().error.code).toBe('cli-token-expired');
    expect(b.f.calls).toHaveLength(0);
  });
});

describe('gazua profiles', () => {
  it('프로필 목록(ID·이름·리비전·그룹·전략 수)', async () => {
    const { t } = setup({ p1: { doc: profileDoc(2, '내 프로필'), revision: 12 }, p2: { doc: profileDoc(1, '회사'), revision: 3 }, gone: { doc: profileDoc(2), deleted: true } });
    expect(await run(['profiles'], t.io)).toBe(0);
    expect(t.result()).toEqual({
      ok: true,
      data: { profiles: [{ id: 'p1', name: '내 프로필', revision: 12, groups: 1, strategies: 1 }, { id: 'p2', name: '회사', revision: 3, groups: 1, strategies: 1 }] },
    });
  });

  it('토큰은 Gazua-CLI 헤더로만 보내고 출력에 없다', async () => {
    const { f, t } = setup({ p1: { doc: profileDoc(2) } });
    await run(['profiles'], t.io);
    expect(f.calls.every((c) => c.headers.get('authorization') === `Gazua-CLI ${TOKEN}`)).toBe(true);
    expect(t.out.join('')).not.toContain(TOKEN);
  });
});

describe('gazua watchlists', () => {
  it('그룹과 종목(숨김 여부 포함)', async () => {
    const { t } = setup({ p1: { doc: profileDoc(2, '내 프로필') } });
    await run(['watchlists'], t.io);
    expect(t.result()).toEqual({
      ok: true,
      data: { profile: '내 프로필', groups: [{ id: 'g0', name: '반도체', symbols: [{ symbol: '005930', hidden: false }, { symbol: '000660', hidden: true }] }] },
    });
  });

  it('프로필이 여럿이면 profile-required(+목록), --profile로 고른다', async () => {
    const { t } = setup({ p1: { doc: profileDoc(2, '내 프로필') }, p2: { doc: profileDoc(2, '회사') } });
    expect(await run(['watchlists'], t.io)).toBe(1);
    expect(t.result()).toMatchObject({ ok: false, error: { code: 'profile-required' }, data: { profiles: [{ id: 'p1', name: '내 프로필' }, { id: 'p2', name: '회사' }] } });
    const u = setup({ p1: { doc: profileDoc(2, '내 프로필') }, p2: { doc: profileDoc(2, '회사') } });
    expect(await run(['watchlists', '--profile', '회사'], u.t.io)).toBe(0);
    expect(u.t.result().data.profile).toBe('회사');
  });
});

describe('gazua strategies', () => {
  it('전략 목록과 규칙 요약(앱의 문구를 그대로 쓴다). 그룹 전략은 종목을 풀어 준다', async () => {
    const { t } = setup({ p1: { doc: profileDoc(2) } });
    await run(['strategies'], t.io);
    const s = t.result().data.strategies[0];
    expect(s).toMatchObject({ id: 's2', name: '골든크로스 추세', universe: { kind: 'group', groupId: 'g0', symbols: ['005930', '000660'] }, sizing: '회당 총자산 10%' });
    expect(s.buy).toContain('반등 패턴');
    expect(s.sell).toContain('익절');
    expect(s.sell).toContain('손절');
    expect(s.rules).toBeUndefined();
  });

  it('--raw면 원 규칙(rules)도 함께 낸다', async () => {
    const { t } = setup({ p1: { doc: profileDoc(2) } });
    await run(['strategies', '--raw'], t.io);
    expect(t.result().data.strategies[0].rules.sell.stopLoss).toEqual({ on: true, pct: 7, basis: 'avgAlways' });
  });

  it('v1 문서의 전략도 v2로 옮겨 읽는다', async () => {
    const { t } = setup({ p1: { doc: profileDoc(1) } });
    await run(['strategies'], t.io);
    expect(t.result().data.strategies[0]).toMatchObject({ id: 's1', name: '눌림목' });
  });
});
```

(`sizing: '회당 총자산 10%'`·`'반등 패턴'` 문구는 `simText.ts`의 `sizingText`/`patternSummary`/`condReason` 출력이다. 실제 값이 다르면 테스트 기대값을 `simText`가 주는 문자열로 맞춘다. 앱 문구 자체는 바꾸지 않는다.)

- [ ] **Step 2: 실패 확인**

Run: `corepack pnpm --filter gazua-cli test -- profileData data`
Expected: FAIL — `./profileData`, `../commands/data`가 없고 `COMMANDS`에 `profiles`가 없어 `invalid-args`.

- [ ] **Step 3: 최소 구현**

`cli/src/profileData.ts`:

```ts
// 서버 프로필 문서 읽기: v1이면 v2로 옮겨 읽고(저장하지 않는다), 프로필·전략을 이름이나 ID로 찾는다.
import { sanitizeStrategiesV1, toV2 } from '../../src/lib/sim/strategyV1';
import { sanitizeStrategiesV2, type StrategyV2 } from '../../src/lib/sim/strategyV2';
import type { WatchItem, Watchlists } from '../../src/lib/state/schema';
import { CliError } from './errors';
import type { SyncClient } from './syncClient';

export interface ProfileData {
  id: string;
  name: string;
  revision: number;
  watchlists: Watchlists;
  strategies: StrategyV2[];
}

type Row = Record<string, unknown>;
const isRecord = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 서버가 이미 검증한 문서라 필요한 필드만 방어적으로 읽는다(색 칸·추가 시각은 CLI가 쓰지 않는다) */
function readWatchlists(raw: unknown): Watchlists {
  const groups = isRecord(raw) && Array.isArray(raw.groups) ? raw.groups.filter(isRecord) : [];
  return {
    groups: groups.map((g) => ({
      id: String(g.id),
      name: String(g.name),
      items: (Array.isArray(g.items) ? g.items.filter(isRecord) : [])
        .filter((i) => typeof i.symbol === 'string')
        .map((i): WatchItem => ({ symbol: i.symbol as string, colorSlot: 1, hidden: i.hidden === true, addedAt: typeof i.addedAt === 'number' ? i.addedAt : 0 })),
    })),
  };
}

export function normalizeDoc(doc: unknown, now: number): { name: string; watchlists: Watchlists; strategies: StrategyV2[] } {
  if (!isRecord(doc) || typeof doc.v !== 'number') throw new CliError('internal', '프로필 문서 모양이 맞지 않아요');
  if (doc.v > 2) throw new CliError('app-outdated');
  const strategies =
    doc.v === 1
      ? sanitizeStrategiesV1({ strategies: doc.strategies }, now).strategies.map(toV2)
      : sanitizeStrategiesV2({ strategies: doc.strategies }, now).strategies;
  return { name: typeof doc.name === 'string' ? doc.name : '(이름 없음)', watchlists: readWatchlists(doc.watchlists), strategies };
}

async function read(client: SyncClient, id: string, now: number): Promise<ProfileData> {
  const r = await client.profile(id);
  return { id, revision: r.revision, ...normalizeDoc(r.doc, now) };
}

const liveRows = async (client: SyncClient) => (await client.profiles()).filter((r) => r.deletedAt === null);

/** 삭제 안 된 프로필 전부(서버 색인에는 이름이 없어 문서를 하나씩 읽는다) */
export async function loadAllProfiles(client: SyncClient, now: number): Promise<ProfileData[]> {
  return Promise.all((await liveRows(client)).map((r) => read(client, r.profileId, now)));
}

export async function pickProfile(client: SyncClient, flag: string | undefined, now: number): Promise<ProfileData> {
  const rows = await liveRows(client);
  if (rows.length === 0) throw new CliError('profile-not-found', '서버에 프로필이 없어요. 앱에서 동기화를 켜 주세요');
  if (flag !== undefined) {
    const byId = rows.find((r) => r.profileId === flag);
    if (byId) return read(client, byId.profileId, now);
  } else if (rows.length === 1) {
    return read(client, rows[0].profileId, now);
  }
  const all = await Promise.all(rows.map((r) => read(client, r.profileId, now)));
  const list = all.map((p) => ({ id: p.id, name: p.name }));
  if (flag === undefined) throw new CliError('profile-required', undefined, { profiles: list });
  const hits = all.filter((p) => p.name === flag);
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) throw new CliError('profile-required', '같은 이름의 프로필이 여럿이에요. ID로 골라 주세요', { profiles: hits.map((p) => ({ id: p.id, name: p.name })) });
  throw new CliError('profile-not-found');
}

/** 이름 정확 일치가 먼저, 없으면 ID */
export function findStrategy(strategies: StrategyV2[], ref: string): StrategyV2 {
  const byName = strategies.filter((s) => s.name === ref);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) {
    const byId = strategies.find((s) => s.id === ref);
    if (byId) return byId;
    throw new CliError('ambiguous-strategy', undefined, { matches: byName.map((s) => ({ id: s.id, name: s.name })) });
  }
  const byId = strategies.find((s) => s.id === ref);
  if (byId) return byId;
  throw new CliError('strategy-not-found');
}
```

`cli/src/commands/data.ts`:

```ts
import { resolveSymbols } from '../../../src/lib/sim/validate';
import { buyRulesSummary, sellRulesSummary, sizingText } from '../../../src/lib/ui/simulate/simText';
import type { Command } from '../context';
import { loadAllProfiles, pickProfile } from '../profileData';
import { authedClient } from '../session';

export const profiles: Command = async (ctx) => {
  const list = await loadAllProfiles(authedClient(ctx), ctx.now());
  return { profiles: list.map((p) => ({ id: p.id, name: p.name, revision: p.revision, groups: p.watchlists.groups.length, strategies: p.strategies.length })) };
};

export const watchlists: Command = async (ctx) => {
  const p = await pickProfile(authedClient(ctx), ctx.args.profile, ctx.now());
  return {
    profile: p.name,
    groups: p.watchlists.groups.map((g) => ({ id: g.id, name: g.name, symbols: g.items.map((i) => ({ symbol: i.symbol, hidden: i.hidden })) })),
  };
};

export const strategies: Command = async (ctx) => {
  const p = await pickProfile(authedClient(ctx), ctx.args.profile, ctx.now());
  return {
    strategies: p.strategies.map((s) => ({
      id: s.id,
      name: s.name,
      universe: s.universe.kind === 'group' ? { kind: 'group', groupId: s.universe.groupId, symbols: resolveSymbols(s, p.watchlists) } : { kind: 'symbols', symbols: resolveSymbols(s, p.watchlists) },
      buy: buyRulesSummary(s),
      sell: sellRulesSummary(s),
      sizing: sizingText(s),
      ...(ctx.args.raw ? { rules: s.rules } : {}),
    })),
  };
};
```

`cli/src/main.ts`: import와 `COMMANDS`를 바꾼다.

```ts
import { profiles, strategies, watchlists } from './commands/data';
import { login, logout } from './commands/login';
```

```ts
export const COMMANDS: Record<string, Command> = {
  login,
  logout,
  profiles,
  watchlists,
  strategies,
};
```

- [ ] **Step 4: 통과 확인**

Run: `corepack pnpm --filter gazua-cli test && corepack pnpm --filter gazua-cli check && corepack pnpm --filter gazua-cli build`
Expected: PASS(번들에 `simText`·`strategyV1`·`strategyV2`가 들어가도 `import.meta.env`·`window.`·`navigator.locks`가 없어야 한다. 걸리면 끌려온 모듈을 찾아 import를 좁힌다).

- [ ] **Step 5: 커밋**

```bash
git add cli
git commit -m "feat(cli): profiles·watchlists·strategies 명령과 프로필·전략 읽기를 더함"
```

---

## Task 11: 증권사 직접 호출 계층과 `quote`·`holdings`

**Files:**
- Create: `cli/src/direct.ts`, `cli/src/fileLock.ts`, `cli/src/tokenFiles.ts`, `cli/src/env.ts`, `cli/src/providers.ts`, `cli/src/commands/market.ts`
- Modify: `cli/src/main.ts`(import, `COMMANDS`)
- Create(테스트): `cli/src/direct.test.ts`, `cli/src/fileLock.test.ts`, `cli/src/tokenFiles.test.ts`, `cli/src/env.test.ts`, `cli/src/providers.test.ts`, `cli/src/commands/market.test.ts`

**Interfaces:**
- Consumes: `isAllowed`·`UPSTREAM`(`proxy/src/allowlist.ts`), `createProxyClient`·`ProxyClient`(`http.ts`의 `urlFor`, Task 7), `ApiError`, `createKisProvider`(+`tokenLock`, Task 7), `createTossProvider`·`TOSS_QUEUE_RATES`, `createRequestQueue`(`src/lib/data/requestQueue.ts`), `TokenStore`·`IssuedAtStore`·`TokenLock`·`MarketDataProvider`(`types.ts`).
- Produces:
  ```ts
  // direct.ts
  export function createDirectClient(fetchImpl?: typeof fetch): ProxyClient;     // 허용 목록 밖은 fetch 없이 ApiError('path-blocked')
  // fileLock.ts
  export const LOCK_RETRY_MS = 200; export const LOCK_WAIT_MS = 30_000;
  export interface FileLockOptions { dir: string; name: 'kis' | 'toss'; pid?: number; hostname?: () => string; isGone?: (pid: number) => boolean; waitMs?: number; retryMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number; beforeUnlink?: () => Promise<void> }
  export function processGone(pid: number): boolean;                      // process.kill(pid, 0)이 ESRCH일 때만 true
  export function createFileLock(o: FileLockOptions): TokenLock;           // 잠금 { pid, hostname, nonce, createdAt }. 같은 host + pid ESRCH인 잠금만 회수(지우기 직전 nonce 재확인). 시간 기준 회수·회수 잠금 없음. 해제는 자기 nonce일 때만. 대기 상한 30초 뒤 CliError('token-busy')
  // tokenFiles.ts
  export function keyHashOf(id: string): string;                                  // SHA-256 hex 앞 16자
  export interface StoreHooks { onSecret?: (accessToken: string) => void; warn?: (message: string) => void }   // 접근 토큰 등록, 권한 경고
  export function fileTokenStore(dir: string, provider: 'kis' | 'toss', keyHash: string, hooks?: StoreHooks): TokenStore;     // 공급자별 tokens-<공급자>.json, load()는 매번 파일을 읽는다
  export function fileIssuedAtStore(dir: string, provider: 'kis' | 'toss', keyHash: string, hooks?: StoreHooks): IssuedAtStore;
  // env.ts
  export interface Creds { kis?: { appKey: string; appSecret: string }; toss?: { clientId: string; clientSecret: string } }
  export type ProviderId = 'kis' | 'toss';
  export function readCreds(env: Record<string, string | undefined>): Creds;
  export function chooseProvider(creds: Creds, flag?: ProviderId): ProviderId;     // 없으면 no-credentials, 둘 다면 toss
  // providers.ts
  export interface Built { id: ProviderId; provider: MarketDataProvider; keyHash: string }
  export function buildProvider(ctx: Ctx, id: ProviderId, creds: Creds): Built;     // 키를 redact에 등록, 파일 토큰 저장소·잠금
  // commands/market.ts
  export const quote: Command;      // data: { provider, quotes: [{ symbol, price, ts, venue }], missing? }
  export const holdings: Command;   // data: { provider: 'toss', holdings: [{ symbol, name, quantity, avgPrice? }] }
  ```

- [ ] **Step 1: 실패하는 테스트 쓰기**

`cli/src/direct.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { UPSTREAM } from '../../proxy/src/allowlist';
import { ApiError } from '../../src/lib/providers/errors';
import { createDirectClient } from './direct';

const json = () => new Response('{"ok":1}', { status: 200, headers: { 'content-type': 'application/json' } });
const blocked = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof ApiError ? e.code : 'other';
  }
  return 'no-error';
};

describe('createDirectClient: 프록시와 같은 허용 목록', () => {
  it('토스 주문 생성(POST /api/v1/orders)·KIS 주문 TR 경로·없는 경로는 fetch 없이 path-blocked', async () => {
    const fetchImpl = vi.fn(async () => json());
    const c = createDirectClient(fetchImpl as unknown as typeof fetch);
    expect(await blocked(c.request('toss', 'POST', '/api/v1/orders', { body: { symbol: '005930' } }))).toBe('path-blocked');
    expect(await blocked(c.request('kis', 'POST', '/uapi/domestic-stock/v1/trading/order-cash', { body: {} }))).toBe('path-blocked');
    expect(await blocked(c.request('kis', 'GET', '/uapi/domestic-stock/v1/trading/inquire-balance'))).toBe('path-blocked');
    expect(await blocked(c.request('toss', 'GET', '/api/v1/unknown'))).toBe('path-blocked');
    expect(await blocked(c.request('toss', 'GET', '/api/v1/prices?symbols=005930'))).toBe('path-blocked'); // 경로에 쿼리를 섞으면 안 된다
    expect(await blocked(c.request('toss', 'POST', '/api/v1/prices'))).toBe('path-blocked');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('허용 경로는 UPSTREAM 주소로 보낸다(쿼리 포함)', async () => {
    const fetchImpl = vi.fn(async () => json());
    const c = createDirectClient(fetchImpl as unknown as typeof fetch);
    await c.request('toss', 'GET', '/api/v1/prices', { query: { symbols: '005930' } });
    await c.request('toss', 'GET', '/api/v1/orders', { query: { status: 'CLOSED' } }); // 주문 이력 조회(GET)는 허용
    await c.request('kis', 'POST', '/oauth2/tokenP', { body: { grant_type: 'client_credentials' } });
    const urls = fetchImpl.mock.calls.map((x) => String((x as unknown as [string])[0]));
    expect(urls).toEqual([
      `${UPSTREAM.toss}/api/v1/prices?symbols=005930`,
      `${UPSTREAM.toss}/api/v1/orders?status=CLOSED`,
      `${UPSTREAM.kis}/oauth2/tokenP`,
    ]);
  });

  it('리다이렉트는 따라가지 않는다(proxy-redirect)', async () => {
    const c = createDirectClient((async () => new Response(null, { status: 302, headers: { location: 'https://evil.example' } })) as unknown as typeof fetch);
    expect(await blocked(c.request('toss', 'GET', '/api/v1/prices'))).toBe('proxy-redirect');
  });
});
```

`cli/src/fileLock.test.ts`:

```ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CliError } from './errors';
import { createFileLock, LOCK_RETRY_MS, LOCK_WAIT_MS, processGone } from './fileLock';
import { cleanupDirs, tempDir } from './testing';

afterEach(cleanupDirs);
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const lockPath = (dir: string) => join(dir, 'toss.lock');
const body = (dir: string) => JSON.parse(readFileSync(lockPath(dir), 'utf8')) as { pid: number; hostname: string; nonce: string; createdAt: number };
const writeLock = (dir: string, o: { pid: unknown; hostname?: string; nonce?: string }) =>
  writeFileSync(lockPath(dir), JSON.stringify({ pid: o.pid, hostname: o.hostname ?? 'host-a', nonce: o.nonce ?? 'old', createdAt: 0 }));
const busy = (e: unknown) => e instanceof CliError && e.code === 'token-busy';
const base = { name: 'toss' as const, hostname: () => 'host-a', retryMs: 10 };

describe('상수', () => {
  it('재시도 200ms, 대기 상한 30초', () => {
    expect([LOCK_RETRY_MS, LOCK_WAIT_MS]).toEqual([200, 30_000]);
  });
});

describe('processGone', () => {
  it('없는 pid(ESRCH)만 true, 살아 있는 pid(자기 자신)는 false', () => {
    expect(processGone(process.pid)).toBe(false);
    expect(processGone(2_147_483_646)).toBe(true);
  });
});

describe('createFileLock', () => {
  it('겹치면 하나씩 실행하고 끝나면 잠금 파일이 없다(안에 pid·hostname·nonce·시각이 있다)', async () => {
    const dir = tempDir();
    let active = 0;
    let max = 0;
    let seen: ReturnType<typeof body> | null = null;
    const job = async () => {
      active++;
      max = Math.max(max, active);
      seen ??= body(dir);
      await wait(30);
      active--;
    };
    const mk = () => createFileLock({ dir, ...base, waitMs: 5000, hostname: () => 'host-a' });
    await Promise.all([mk()(job), mk()(job), mk()(job)]);
    expect(max).toBe(1);
    expect(seen).toMatchObject({ pid: process.pid, hostname: 'host-a', nonce: expect.stringMatching(/^[0-9a-f]{16}$/), createdAt: expect.any(Number) });
    expect(existsSync(lockPath(dir))).toBe(false);
  });

  it('fn이 던져도 잠금을 푼다', async () => {
    const dir = tempDir();
    await expect(createFileLock({ dir, ...base })(async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(existsSync(lockPath(dir))).toBe(false);
  });

  it('해제는 자기 nonce일 때만 지운다: 그 사이 남의 잠금으로 바뀌었으면 그대로 둔다', async () => {
    const dir = tempDir();
    await createFileLock({ dir, ...base })(async () => {
      writeLock(dir, { pid: 4242, nonce: 'someone-else' });
    });
    expect(body(dir).nonce).toBe('someone-else');
  });

  it('같은 host에서 pid가 없는(ESRCH) 잠금만 회수한다: 다시 읽어 nonce가 같으면 지우고 들어간다', async () => {
    const dir = tempDir();
    writeLock(dir, { pid: 2_147_483_646 });
    expect(await createFileLock({ dir, ...base, waitMs: 1000 })(async () => 'ran')).toBe('ran');
    expect(existsSync(lockPath(dir))).toBe(false);
  });

  it('깨진 내용의 잠금은 회수하지 않는다(누구 것인지 모른다) → 대기 상한 뒤 token-busy', async () => {
    const dir = tempDir();
    writeFileSync(lockPath(dir), '{');
    await expect(createFileLock({ dir, ...base, waitMs: 100 })(async () => 'never')).rejects.toSatisfy(busy);
    expect(readFileSync(lockPath(dir), 'utf8')).toBe('{');
  });

  it('pid가 살아 있으면 얼마나 오래됐든 회수하지 않고, 대기 상한 뒤 token-busy', async () => {
    const dir = tempDir();
    writeLock(dir, { pid: process.pid });
    const started = Date.now();
    await expect(createFileLock({ dir, ...base, waitMs: 300 })(async () => 'never')).rejects.toSatisfy(busy);
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    expect(body(dir)).toMatchObject({ pid: process.pid, nonce: 'old' });
  });

  it('다른 host의 잠금은 pid가 없어 보여도 회수하지 않는다', async () => {
    const dir = tempDir();
    writeLock(dir, { pid: 2_147_483_646, hostname: 'other-host' });
    await expect(createFileLock({ dir, ...base, waitMs: 100 })(async () => 'never')).rejects.toSatisfy(busy);
    expect(body(dir)).toMatchObject({ hostname: 'other-host', nonce: 'old' });
  });

  it('회수 직전에 다시 읽어 nonce가 달라졌으면(그 사이 남이 새로 만들었으면) 지우지 않는다', async () => {
    const dir = tempDir();
    writeLock(dir, { pid: 2_147_483_646 });
    const lock = createFileLock({
      dir,
      ...base,
      waitMs: 150,
      // 처음 읽은 뒤, 지우기 직전에 다른 실행이 낡은 잠금을 치우고 새 잠금(살아 있는 pid)을 만든 상황
      beforeUnlink: async () => writeLock(dir, { pid: process.pid, nonce: 'new' }),
    });
    await expect(lock(async () => 'never')).rejects.toSatisfy(busy);
    expect(body(dir)).toMatchObject({ pid: process.pid, nonce: 'new' });
  });

  it('kis와 toss는 서로 다른 잠금 파일을 쓴다', async () => {
    const dir = tempDir();
    const kis = createFileLock({ dir, ...base, name: 'kis', waitMs: 100 });
    const toss = createFileLock({ dir, ...base, waitMs: 100 });
    expect(await kis(async () => toss(async () => existsSync(join(dir, 'kis.lock')) && existsSync(join(dir, 'toss.lock'))))).toBe(true);
  });
});
```

`cli/src/tokenFiles.test.ts`:

```ts
import { chmodSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fileIssuedAtStore, fileTokenStore, keyHashOf } from './tokenFiles';
import { cleanupDirs, tempDir } from './testing';

afterEach(cleanupDirs);
const posix = it.skipIf(process.platform === 'win32');

describe('keyHashOf', () => {
  it('SHA-256 hex 앞 16자(키가 달라지면 다르다)', () => {
    expect(keyHashOf('app-key-1')).toMatch(/^[0-9a-f]{16}$/);
    expect(keyHashOf('app-key-1')).toBe(keyHashOf('app-key-1'));
    expect(keyHashOf('app-key-1')).not.toBe(keyHashOf('app-key-2'));
  });
});

describe('파일 토큰 저장소(공급자마다 파일 하나)', () => {
  it('저장한 토큰을 다른 인스턴스가 매번 파일에서 읽는다(메모리에 담지 않는다). 파일은 tokens-<공급자>.json(600)', () => {
    const dir = tempDir();
    const a = fileTokenStore(dir, 'toss', 'hash1');
    const b = fileTokenStore(dir, 'toss', 'hash1');
    expect(a.load()).toBeNull();
    a.save({ accessToken: 'tok-1', expiresAt: 100 });
    expect(b.load()).toEqual({ accessToken: 'tok-1', expiresAt: 100 });
    a.save({ accessToken: 'tok-2', expiresAt: 200 });
    expect(b.load()).toEqual({ accessToken: 'tok-2', expiresAt: 200 });
    expect(readdirSync(dir)).toEqual(['tokens-toss.json']);
    if (process.platform !== 'win32') expect(statSync(join(dir, 'tokens-toss.json')).mode & 0o777).toBe(0o600);
  });

  it('키가 바뀌면(keyHash 불일치) 캐시를 버리고, 다른 공급자 파일은 건드리지 않는다', () => {
    const dir = tempDir();
    fileTokenStore(dir, 'toss', 'old').save({ accessToken: 'old-token', expiresAt: 1 });
    fileTokenStore(dir, 'kis', 'kh').save({ accessToken: 'kis-token', expiresAt: 2 });
    expect(fileTokenStore(dir, 'toss', 'new').load()).toBeNull();
    fileTokenStore(dir, 'toss', 'new').save({ accessToken: 'new-token', expiresAt: 3 });
    expect(JSON.parse(readFileSync(join(dir, 'tokens-toss.json'), 'utf8'))).toEqual({ v: 1, keyHash: 'new', accessToken: 'new-token', expiresAt: 3 });
    expect(JSON.parse(readFileSync(join(dir, 'tokens-kis.json'), 'utf8'))).toEqual({ v: 1, keyHash: 'kh', accessToken: 'kis-token', expiresAt: 2 });
  });

  it('두 공급자가 동시에 갱신해도 서로의 항목을 잃지 않는다(파일이 따로라서)', async () => {
    const dir = tempDir();
    const kis = fileTokenStore(dir, 'kis', 'k');
    const kisIssued = fileIssuedAtStore(dir, 'kis', 'k');
    const toss = fileTokenStore(dir, 'toss', 't');
    const tossIssued = fileIssuedAtStore(dir, 'toss', 't');
    const tick = () => new Promise<void>((r) => setImmediate(r));
    await Promise.all([
      (async () => {
        for (let i = 1; i <= 40; i++) {
          kisIssued.save(i);
          kis.save({ accessToken: `kis-${i}`, expiresAt: i });
          await tick();
        }
      })(),
      (async () => {
        for (let i = 1; i <= 40; i++) {
          tossIssued.save(1000 + i);
          toss.save({ accessToken: `toss-${i}`, expiresAt: 1000 + i });
          await tick();
        }
      })(),
    ]);
    expect(kis.load()).toEqual({ accessToken: 'kis-40', expiresAt: 40 });
    expect(kisIssued.load()).toBe(40);
    expect(toss.load()).toEqual({ accessToken: 'toss-40', expiresAt: 1040 });
    expect(tossIssued.load()).toBe(1040);
  });

  it('issuedAt은 같은 파일에 따로 저장하고, 토큰 저장이 지우지 않는다', () => {
    const dir = tempDir();
    const issued = fileIssuedAtStore(dir, 'kis', 'kh');
    expect(issued.load()).toBeNull();
    issued.save(1234); // createTokenManager는 토큰보다 issuedAt을 먼저 저장한다
    expect(fileTokenStore(dir, 'kis', 'kh').load()).toBeNull(); // 토큰 없이 issuedAt만 있어도 토큰은 null
    fileTokenStore(dir, 'kis', 'kh').save({ accessToken: 't', expiresAt: 9 });
    expect(issued.load()).toBe(1234);
    expect(fileTokenStore(dir, 'kis', 'kh').load()).toEqual({ accessToken: 't', expiresAt: 9 });
    expect(fileIssuedAtStore(dir, 'kis', 'other').load()).toBeNull();
  });

  it('깨진 파일은 없는 것으로 보고 새로 쓴다', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'tokens-toss.json'), '{');
    const s = fileTokenStore(dir, 'toss', 'h');
    expect(s.load()).toBeNull();
    s.save({ accessToken: 'a', expiresAt: 1 });
    expect(s.load()).toEqual({ accessToken: 'a', expiresAt: 1 });
  });

  it('읽거나 저장하는 접근 토큰을 onSecret으로 알린다(출력 거르기 등록용)', () => {
    const dir = tempDir();
    const onSecret = vi.fn();
    const s = fileTokenStore(dir, 'toss', 'h', { onSecret });
    s.save({ accessToken: 'saved-token-1', expiresAt: 1 });
    expect(onSecret).toHaveBeenLastCalledWith('saved-token-1');
    onSecret.mockClear();
    fileTokenStore(dir, 'toss', 'h', { onSecret }).load();
    expect(onSecret).toHaveBeenCalledWith('saved-token-1');
  });

  posix('읽을 때 파일 권한이 644이거나 디렉터리가 755면 warn으로 알린다', () => {
    const dir = tempDir();
    fileTokenStore(dir, 'toss', 'h').save({ accessToken: 'a', expiresAt: 1 });
    const warn = vi.fn();
    fileTokenStore(dir, 'toss', 'h', { warn }).load();
    expect(warn).not.toHaveBeenCalled();
    chmodSync(join(dir, 'tokens-toss.json'), 0o644);
    chmodSync(dir, 0o755);
    fileTokenStore(dir, 'toss', 'h', { warn }).load();
    fileIssuedAtStore(dir, 'toss', 'h', { warn }).load();
    const msgs = warn.mock.calls.map((c) => String(c[0]));
    expect(msgs.some((m) => m.includes('tokens-toss.json') && m.includes('chmod 600'))).toBe(true);
    expect(msgs.some((m) => m.includes('chmod 700'))).toBe(true);
  });
});
```

`cli/src/env.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { chooseProvider, readCreds } from './env';

describe('readCreds', () => {
  it('환경변수 이름 네 개를 읽는다(앞뒤 공백은 뗀다). 한쪽만 있으면 그 공급자는 없는 것', () => {
    expect(readCreds({ KIS_APP_KEY: ' k ', KIS_APP_SECRET: 's', TOSS_CLIENT_ID: 'id', TOSS_CLIENT_SECRET: 'sec' })).toEqual({
      kis: { appKey: 'k', appSecret: 's' },
      toss: { clientId: 'id', clientSecret: 'sec' },
    });
    expect(readCreds({ KIS_APP_KEY: 'k' })).toEqual({});
    expect(readCreds({ TOSS_CLIENT_ID: 'id', TOSS_CLIENT_SECRET: '  ' })).toEqual({});
  });
});

describe('chooseProvider', () => {
  const both = readCreds({ KIS_APP_KEY: 'k', KIS_APP_SECRET: 's', TOSS_CLIENT_ID: 'id', TOSS_CLIENT_SECRET: 'sec' });
  const kisOnly = readCreds({ KIS_APP_KEY: 'k', KIS_APP_SECRET: 's' });

  it('--provider가 없으면 키가 있는 쪽, 둘 다면 toss', () => {
    expect(chooseProvider(both)).toBe('toss');
    expect(chooseProvider(kisOnly)).toBe('kis');
  });

  it('--provider를 주면 그 키가 있어야 한다(no-credentials)', () => {
    expect(chooseProvider(both, 'kis')).toBe('kis');
    expect(() => chooseProvider(kisOnly, 'toss')).toThrow(expect.objectContaining({ code: 'no-credentials' }));
    expect(() => chooseProvider({})).toThrow(expect.objectContaining({ code: 'no-credentials' }));
  });
});
```

`cli/src/providers.test.ts`(같은 키로 동시에 돈 두 실행, 재시작 뒤 재발급 간격, 비밀값 등록, 권한 경고):

```ts
import { chmodSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildProvider } from './providers';
import { createRedactor } from './output';
import { parseArgv } from './args';
import { cleanupDirs, tempDir } from './testing';
import type { Ctx } from './context';

afterEach(cleanupDirs);

function ctxFor(dir: string, fetchImpl: typeof fetch, warnings: string[] = []): Ctx {
  return {
    args: parseArgv(['quote']),
    env: {},
    fetch: fetchImpl,
    now: Date.now,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    hostname: () => 'h',
    dir,
    say: () => {},
    log: () => {},
    warn: (m) => void warnings.push(m),
    redact: createRedactor(),
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const CREDS = { toss: { clientId: 'toss-client-id-1', clientSecret: 'toss-client-secret-1' } };
const TOKEN = 'access-token-1';

/** 토큰 발급 횟수를 세는 가짜 토스. rejectToken이 true면 모든 데이터 요청을 401(토큰 무효)로 거절한다 */
function tossFetch() {
  const seen = { issued: 0, rejectToken: false };
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === '/oauth2/token') {
      seen.issued++;
      await new Promise((r) => setTimeout(r, 30)); // 겹침을 만든다
      return json({ access_token: TOKEN, expires_in: 86_400 });
    }
    if (url.pathname === '/api/v1/prices' && !seen.rejectToken && new Headers(init?.headers).get('authorization') === `Bearer ${TOKEN}`) {
      return json({ result: (url.searchParams.get('symbols') ?? '').split(',').map((symbol) => ({ symbol, lastPrice: '72000', timestamp: '2026-11-02T09:00:00+09:00' })) });
    }
    return json({ error: 'token-revoked' }, 401);
  }) as typeof fetch;
  return { f, seen };
}

describe('buildProvider', () => {
  it('같은 키로 동시에 돈 두 실행은 토큰을 한 번만 발급하고 tokens-toss.json(600)에는 해시·토큰·발급 시각만 남긴다', async () => {
    const dir = tempDir();
    const { f, seen } = tossFetch();
    const a = buildProvider(ctxFor(dir, f), 'toss', CREDS);
    const b = buildProvider(ctxFor(dir, f), 'toss', CREDS);
    const [qa, qb] = await Promise.all([a.provider.getQuotes(['005930'], 'UNIFIED'), b.provider.getQuotes(['000660'], 'UNIFIED')]);
    expect(qa[0]).toMatchObject({ symbol: '005930', price: 72000 });
    expect(qb[0]).toMatchObject({ symbol: '000660', price: 72000 });
    expect(seen.issued).toBe(1);
    const text = readFileSync(join(dir, 'tokens-toss.json'), 'utf8');
    expect(JSON.parse(text)).toMatchObject({ v: 1, keyHash: a.keyHash, accessToken: TOKEN, issuedAt: expect.any(Number) });
    expect(text).not.toContain('toss-client-secret-1');
    if (process.platform !== 'win32') expect(statSync(join(dir, 'tokens-toss.json')).mode & 0o777).toBe(0o600);
  });

  it('이미 받은 토큰이 파일에 있으면 새 실행은 발급하지 않는다', async () => {
    const dir = tempDir();
    const { f, seen } = tossFetch();
    await buildProvider(ctxFor(dir, f), 'toss', CREDS).provider.getQuotes(['005930'], 'UNIFIED');
    await buildProvider(ctxFor(dir, f), 'toss', CREDS).provider.getQuotes(['005930'], 'UNIFIED');
    expect(seen.issued).toBe(1);
  });

  it('재시작한 실행의 캐시 토큰이 거절돼도 1분 안이면 다시 발급하지 않고 token-contended(발급 시각을 파일로 이어 간다)', async () => {
    const dir = tempDir();
    const { f, seen } = tossFetch();
    await buildProvider(ctxFor(dir, f), 'toss', CREDS).provider.getQuotes(['005930'], 'UNIFIED'); // 첫 실행이 발급
    seen.rejectToken = true; // 앱 등 다른 곳이 새로 발급해 이 토큰이 무효가 된 상황
    await expect(buildProvider(ctxFor(dir, f), 'toss', CREDS).provider.getQuotes(['005930'], 'UNIFIED')).rejects.toMatchObject({ code: 'token-contended' });
    expect(seen.issued).toBe(1);
  });

  it('키(clientId)가 바뀌면 캐시를 버리고 다시 발급한다', async () => {
    const dir = tempDir();
    const { f, seen } = tossFetch();
    await buildProvider(ctxFor(dir, f), 'toss', CREDS).provider.getQuotes(['005930'], 'UNIFIED');
    await buildProvider(ctxFor(dir, f), 'toss', { toss: { clientId: 'toss-client-id-2', clientSecret: 'toss-client-secret-1' } }).provider.getQuotes(['005930'], 'UNIFIED');
    expect(seen.issued).toBe(2);
  });

  it('키와 접근 토큰(발급한 것·파일에서 읽은 것)을 출력 거르기에 등록한다', async () => {
    const dir = tempDir();
    const { f } = tossFetch();
    const issuing = ctxFor(dir, f);
    await buildProvider(issuing, 'toss', CREDS).provider.getQuotes(['005930'], 'UNIFIED');
    expect(issuing.redact.apply({ message: `x toss-client-secret-1 y toss-client-id-1 z ${TOKEN}` })).toEqual({ message: 'x [숨김] y [숨김] z [숨김]' });
    const reading = ctxFor(dir, f);
    await buildProvider(reading, 'toss', CREDS).provider.getQuotes(['005930'], 'UNIFIED'); // 파일의 토큰을 읽는 경로
    expect(reading.redact.apply({ message: TOKEN })).toEqual({ message: '[숨김]' });
  });

  it.skipIf(process.platform === 'win32')('토큰 파일 644·디렉터리 755면 로그인 없이도 warnings로 알린다', async () => {
    const dir = tempDir();
    const { f } = tossFetch();
    await buildProvider(ctxFor(dir, f), 'toss', CREDS).provider.getQuotes(['005930'], 'UNIFIED');
    chmodSync(join(dir, 'tokens-toss.json'), 0o644);
    chmodSync(dir, 0o755);
    const warnings: string[] = [];
    await buildProvider(ctxFor(dir, f, warnings), 'toss', CREDS).provider.getQuotes(['005930'], 'UNIFIED');
    expect(warnings.some((m) => m.includes('tokens-toss.json') && m.includes('chmod 600'))).toBe(true);
    expect(warnings.some((m) => m.includes('chmod 700'))).toBe(true);
  });
});
```

`cli/src/commands/market.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { run } from '../main';
import { cleanupDirs, fakeFetch, makeIo, type FakeCall, type FakeReply } from '../testing';

afterEach(cleanupDirs);

const TOSS_ENV = { TOSS_CLIENT_ID: 'toss-client-id-1', TOSS_CLIENT_SECRET: 'toss-client-secret-1' };
const SEQ = 1234567;

function toss(over: (c: FakeCall) => FakeReply | undefined = () => undefined) {
  return fakeFetch((c) => {
    const o = over(c);
    if (o) return o;
    if (c.url.pathname === '/oauth2/token') return { body: { access_token: 'tok-1', expires_in: 86_400 } };
    if (c.url.pathname === '/api/v1/prices') {
      const symbols = (c.url.searchParams.get('symbols') ?? '').split(',').filter((s) => s !== '000000');
      return { body: { result: symbols.map((symbol) => ({ symbol, lastPrice: '71200', timestamp: '2026-11-02T09:00:00+09:00' })) } };
    }
    if (c.url.pathname === '/api/v1/accounts') return { body: { result: [{ accountNo: '1', accountSeq: SEQ, accountType: 'BROKERAGE' }] } };
    if (c.url.pathname === '/api/v1/holdings') {
      return { body: { result: { items: [{ symbol: '005930', name: '삼성전자', marketCountry: 'KR', currency: 'KRW', quantity: '10', averagePurchasePrice: '68500' }, { symbol: 'AAPL', name: '애플', marketCountry: 'US', currency: 'USD', quantity: '1' }] } } };
    }
    return undefined;
  });
}

describe('gazua quote', () => {
  it('현재가를 JSON으로 낸다(토스는 UNIFIED)', async () => {
    const f = toss();
    const t = makeIo({ fetch: f, env: TOSS_ENV });
    expect(await run(['quote', '005930', '000660'], t.io)).toBe(0);
    expect(t.result()).toEqual({
      ok: true,
      data: { provider: 'toss', quotes: [{ symbol: '005930', price: 71200, ts: Date.parse('2026-11-02T09:00:00+09:00'), venue: 'UNIFIED' }, { symbol: '000660', price: 71200, ts: Date.parse('2026-11-02T09:00:00+09:00'), venue: 'UNIFIED' }] },
    });
    expect(f.calls.some((c) => c.url.pathname === '/api/v1/orders')).toBe(false);
    expect(t.out.join('')).not.toContain('toss-client-secret-1');
  });

  it('받지 못한 종목은 missing으로 알린다', async () => {
    const t = makeIo({ fetch: toss(), env: TOSS_ENV });
    await run(['quote', '005930', '000000'], t.io);
    expect(t.result().data.missing).toEqual(['000000']);
  });

  it('종목이 없거나 코드 모양이 틀리면 invalid-args(종료 2)', async () => {
    for (const argv of [['quote'], ['quote', '5930'], ['quote', 'abc!@#']]) {
      const t = makeIo({ fetch: toss(), env: TOSS_ENV });
      expect(await run(argv, t.io)).toBe(2);
      expect(t.result().error.code).toBe('invalid-args');
    }
  });

  it('종목 인자 오류 메시지가 입력을 되풀이해도 환경변수 키는 [숨김]으로 나온다', async () => {
    const t = makeIo({ fetch: toss(), env: TOSS_ENV });
    expect(await run(['quote', 'toss-client-id-1'], t.io)).toBe(2); // 키를 종목 자리에 잘못 넣은 경우
    expect(t.out.join('')).not.toContain('toss-client-id-1');
    expect(t.result().error.message).toContain('[숨김]');
    const u = makeIo({ fetch: toss(), env: TOSS_ENV });
    await run(['quote', 'toss-client-secret-1', '--verbose'], u.io);
    expect(u.out.join('') + u.err.join('')).not.toContain('toss-client-secret-1');
  });

  it('키가 없으면 no-credentials, --provider kis인데 KIS 키가 없어도 no-credentials', async () => {
    const a = makeIo({ fetch: toss() });
    expect(await run(['quote', '005930'], a.io)).toBe(1);
    expect(a.result().error.code).toBe('no-credentials');
    const b = makeIo({ fetch: toss(), env: TOSS_ENV });
    await run(['quote', '005930', '--provider', 'kis'], b.io);
    expect(b.result().error.code).toBe('no-credentials');
  });

  it('토스가 IP를 막으면 ip-not-allowed, 연결이 안 되면 network(proxy-unreachable이 아니다)', async () => {
    const a = makeIo({ fetch: toss((c) => (c.url.pathname === '/oauth2/token' ? { status: 403, body: { error: 'access_denied' } } : undefined)), env: TOSS_ENV });
    await run(['quote', '005930'], a.io);
    expect(a.result().error.code).toBe('ip-not-allowed');
    const b = makeIo({ fetch: fakeFetch(() => new TypeError('fetch failed')), env: TOSS_ENV });
    await run(['quote', '005930'], b.io);
    expect(b.result().error.code).toBe('network');
  });
});

describe('gazua holdings', () => {
  it('토스 국내 보유(수량·평단)를 낸다. 계좌 번호는 출력에 없다', { timeout: 15_000 }, async () => {
    const f = toss();
    const t = makeIo({ fetch: f, env: TOSS_ENV });
    expect(await run(['holdings'], t.io)).toBe(0);
    expect(t.result()).toEqual({ ok: true, data: { provider: 'toss', holdings: [{ symbol: '005930', name: '삼성전자', quantity: 10, avgPrice: 68500 }] } });
    expect(t.out.join('')).not.toContain(String(SEQ));
    expect(f.calls.find((c) => c.url.pathname === '/api/v1/holdings')?.headers.get('x-tossinvest-account')).toBe(String(SEQ));
  });

  it('KIS로는 provider-unsupported, 토스 키가 없으면 no-credentials', async () => {
    const a = makeIo({ fetch: toss(), env: { KIS_APP_KEY: 'k', KIS_APP_SECRET: 's' } });
    await run(['holdings', '--provider', 'kis'], a.io);
    expect(a.result().error.code).toBe('provider-unsupported');
    const b = makeIo({ fetch: toss(), env: { KIS_APP_KEY: 'k', KIS_APP_SECRET: 's' } });
    await run(['holdings'], b.io);
    expect(b.result().error.code).toBe('no-credentials');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `corepack pnpm --filter gazua-cli test -- direct fileLock tokenFiles env providers market`
Expected: FAIL — 새 모듈들이 없다.

- [ ] **Step 3: 최소 구현**

`cli/src/direct.ts`:

```ts
// 증권사를 프록시 없이 직접 부른다. 프록시와 같은 허용 목록(proxy/src/allowlist.ts)으로 주문·쓰기 경로를 막는다.
import { isAllowed, UPSTREAM } from '../../proxy/src/allowlist';
import { ApiError } from '../../src/lib/providers/errors';
import { createProxyClient, type ProxyClient } from '../../src/lib/providers/http';

export function createDirectClient(fetchImpl: typeof fetch = fetch): ProxyClient {
  const inner = createProxyClient({ baseUrl: '', fetchImpl, urlFor: (p, path) => `${UPSTREAM[p]}${path}` });
  return {
    request(provider, method, path, opts) {
      // 검사는 쿼리를 뺀 경로로 한다(isAllowed의 계약). 쿼리는 opts.query로만 보낸다
      if (!isAllowed(provider, path, method)) return Promise.reject(new ApiError('path-blocked'));
      return inner.request(provider, method, path, opts);
    },
  };
}
```

`cli/src/fileLock.ts`:

```ts
// 같은 기기에서 CLI를 병렬로 돌릴 때 토큰 발급을 한 번에 하나로 묶는 파일 잠금(스펙 §4.2).
// 잠금 파일(<name>.lock)에는 { pid, hostname, nonce, createdAt }을 쓰고 open(path, 'wx')(O_EXCL)로 만든다. 이미 있으면 200ms마다 다시 시도한다.
// 파일 시스템에는 원자적인 「비교 후 삭제」가 없어서 회수 잠금이나 시간 기준 회수를 두지 않는다(둘 다 새 경합을 만든다).
// 회수는 같은 host이고 pid가 존재하지 않는(ESRCH) 잠금만, 지우기 직전에 다시 읽어 nonce가 같을 때 한다. 살아 있는 pid나 다른 host의 잠금은 기다린다.
// 해제는 자기 nonce일 때만 unlink한다. 남는 한계(두 회수자가 같은 죽은 잠금을 동시에 볼 때)는 스펙 §4.2에 적었다.
import { randomBytes } from 'node:crypto';
import { open, readFile, rm } from 'node:fs/promises';
import { hostname as osHostname } from 'node:os';
import { join } from 'node:path';
import type { TokenLock } from '../../src/lib/providers/types';
import { ensureDir } from './config';
import { CliError } from './errors';

export const LOCK_RETRY_MS = 200;
/** 이 시간 안에 잠금을 얻지 못하면 token-busy */
export const LOCK_WAIT_MS = 30_000;

interface LockBody {
  pid: number;
  hostname: string;
  nonce: string;
  createdAt: number;
}

export interface FileLockOptions {
  dir: string;
  name: 'kis' | 'toss';
  pid?: number;
  hostname?: () => string;
  /** pid가 존재하지 않으면 true(기본: process.kill(pid, 0)이 ESRCH) */
  isGone?: (pid: number) => boolean;
  waitMs?: number;
  retryMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** 테스트용: 회수하려고 처음 읽은 뒤, 지우기 직전에 다시 읽기 전에 불린다 */
  beforeUnlink?: () => Promise<void>;
}

/** 프로세스가 없으면(ESRCH) true. 있거나 권한이 없으면(EPERM) false */
export function processGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

const code = (e: unknown) => (e as NodeJS.ErrnoException).code;

async function readBody(path: string): Promise<LockBody | null> {
  try {
    const b = JSON.parse(await readFile(path, 'utf8')) as Partial<LockBody>;
    return typeof b.pid === 'number' && typeof b.hostname === 'string' && typeof b.nonce === 'string' ? (b as LockBody) : null;
  } catch {
    return null; // 없거나 깨진 잠금
  }
}

export function createFileLock(o: FileLockOptions): TokenLock {
  const path = join(o.dir, `${o.name}.lock`);
  const pid = o.pid ?? process.pid;
  const host = o.hostname ?? osHostname;
  const isGone = o.isGone ?? processGone;
  const waitMs = o.waitMs ?? LOCK_WAIT_MS;
  const retryMs = o.retryMs ?? LOCK_RETRY_MS;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = o.now ?? Date.now;

  /** 'wx'로 만들고 내용을 쓴다. 이미 있으면 false */
  async function create(nonce: string): Promise<boolean> {
    try {
      const fh = await open(path, 'wx', 0o600);
      try {
        await fh.writeFile(JSON.stringify({ pid, hostname: host(), nonce, createdAt: Date.now() } satisfies LockBody));
      } finally {
        await fh.close();
      }
      return true;
    } catch (e) {
      if (code(e) === 'EEXIST') return false;
      throw e;
    }
  }

  /** 같은 host이고 pid가 없는 잠금이면 지운다(지우기 직전에 다시 읽어 같은 nonce일 때만). 지웠거나 이미 없으면 true */
  async function reclaimIfDead(): Promise<boolean> {
    const seen = await readBody(path);
    if (seen === null) return false; // 깨졌거나 없다. 없는 경우는 다음 반복의 create가 처리한다
    if (seen.hostname !== host() || !isGone(seen.pid)) return false;
    await o.beforeUnlink?.();
    const again = await readBody(path);
    if (again?.nonce !== seen.nonce) return false; // 그 사이 남이 새로 만들었다. 건드리지 않는다
    await rm(path, { force: true });
    return true;
  }

  async function acquire(nonce: string): Promise<void> {
    ensureDir(o.dir);
    const started = now();
    for (;;) {
      if (await create(nonce)) return;
      if (await reclaimIfDead()) continue;
      if (now() - started >= waitMs) throw new CliError('token-busy');
      await sleep(retryMs);
    }
  }

  return async (fn) => {
    const nonce = randomBytes(8).toString('hex');
    await acquire(nonce);
    try {
      return await fn();
    } finally {
      if ((await readBody(path))?.nonce === nonce) await rm(path, { force: true }); // 자기 nonce일 때만
    }
  };
}
```

`cli/src/tokenFiles.ts`:

```ts
// 증권사 접근 토큰 캐시. 공급자마다 파일 하나(tokens-kis.json, tokens-toss.json, 600)이고, 각자의 공급자 잠금 안에서만 갱신한다 —
// 한 파일을 두 공급자가 나눠 쓰면 서로 다른 잠금 아래에서 읽고 덮어써 한쪽 토큰이 사라질 수 있어서다.
// TokenStore.load()는 메모리에 담지 않고 매번 파일을 읽는다 — 잠금을 기다리는 동안 다른 실행이 받아 저장한 토큰을
// 잠금 안에서 다시 읽어 쓰려는 것이다(auth.ts의 usableStored).
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { IssuedAtStore, TokenStore } from '../../src/lib/providers/types';
import { permissionWarnings, readJsonFile, writeJsonFile } from './config';

type ProviderKey = 'kis' | 'toss';
interface Entry {
  v: 1;
  keyHash: string;
  accessToken?: string;
  expiresAt?: number;
  issuedAt?: number;
}

export interface StoreHooks {
  /** 접근 토큰을 읽거나 저장할 때 불린다(출력 거르기 등록) */
  onSecret?: (accessToken: string) => void;
  /** 읽을 때 디렉터리·파일 권한이 넓으면 */
  warn?: (message: string) => void;
}

export const keyHashOf = (id: string): string => createHash('sha256').update(id).digest('hex').slice(0, 16);

export const tokenFileName = (provider: ProviderKey): string => `tokens-${provider}.json`;

function readEntry(dir: string, provider: ProviderKey, keyHash: string, hooks: StoreHooks): Entry | null {
  const raw = readJsonFile<Entry>(join(dir, tokenFileName(provider)));
  for (const w of permissionWarnings(dir, [tokenFileName(provider)])) hooks.warn?.(w);
  return raw !== null && raw.v === 1 && raw.keyHash === keyHash ? raw : null; // 키가 바뀌면 옛 캐시를 버린다
}

function update(dir: string, provider: ProviderKey, keyHash: string, hooks: StoreHooks, patch: Partial<Entry>): void {
  const base: Entry = readEntry(dir, provider, keyHash, hooks) ?? { v: 1, keyHash };
  writeJsonFile(join(dir, tokenFileName(provider)), { ...base, ...patch });
}

export function fileTokenStore(dir: string, provider: ProviderKey, keyHash: string, hooks: StoreHooks = {}): TokenStore {
  return {
    load() {
      const e = readEntry(dir, provider, keyHash, hooks);
      if (!e || typeof e.accessToken !== 'string' || typeof e.expiresAt !== 'number') return null;
      hooks.onSecret?.(e.accessToken);
      return { accessToken: e.accessToken, expiresAt: e.expiresAt };
    },
    save(t) {
      hooks.onSecret?.(t.accessToken);
      update(dir, provider, keyHash, hooks, { accessToken: t.accessToken, expiresAt: t.expiresAt });
    },
  };
}

export function fileIssuedAtStore(dir: string, provider: ProviderKey, keyHash: string, hooks: StoreHooks = {}): IssuedAtStore {
  return {
    load() {
      const e = readEntry(dir, provider, keyHash, hooks);
      return e && typeof e.issuedAt === 'number' ? e.issuedAt : null;
    },
    save(t) {
      update(dir, provider, keyHash, hooks, { issuedAt: t });
    },
  };
}
```

`cli/src/env.ts`:

```ts
// 증권사 키는 환경변수로만 받는다(--env-file은 main이 process.loadEnvFile로 읽어 둔다). 파일에 쓰지 않는다.
import { CliError } from './errors';

export type ProviderId = 'kis' | 'toss';
export interface Creds {
  kis?: { appKey: string; appSecret: string };
  toss?: { clientId: string; clientSecret: string };
}

const val = (env: Record<string, string | undefined>, name: string): string => (env[name] ?? '').trim();

export function readCreds(env: Record<string, string | undefined>): Creds {
  const appKey = val(env, 'KIS_APP_KEY');
  const appSecret = val(env, 'KIS_APP_SECRET');
  const clientId = val(env, 'TOSS_CLIENT_ID');
  const clientSecret = val(env, 'TOSS_CLIENT_SECRET');
  return {
    ...(appKey && appSecret ? { kis: { appKey, appSecret } } : {}),
    ...(clientId && clientSecret ? { toss: { clientId, clientSecret } } : {}),
  };
}

/** --provider가 있으면 그 키가 있어야 한다. 없으면 키가 있는 쪽, 둘 다면 toss */
export function chooseProvider(creds: Creds, flag?: ProviderId): ProviderId {
  if (flag !== undefined) {
    if (!creds[flag]) throw new CliError('no-credentials');
    return flag;
  }
  if (creds.toss) return 'toss';
  if (creds.kis) return 'kis';
  throw new CliError('no-credentials');
}
```

`cli/src/providers.ts`:

```ts
// KIS·토스 공급자 조립: 직접 호출 클라이언트, 파일 토큰 저장소·발급 시각·잠금, 요청 큐. 앱의 factory.ts는 쓰지 않는다
// (sheets/universeSource → import.meta.env를 끌어온다).
import { createRequestQueue } from '../../src/lib/data/requestQueue';
import { createKisProvider } from '../../src/lib/providers/kis';
import { createTossProvider, TOSS_QUEUE_RATES } from '../../src/lib/providers/toss';
import type { MarketDataProvider } from '../../src/lib/providers/types';
import type { Ctx } from './context';
import { createDirectClient } from './direct';
import type { Creds, ProviderId } from './env';
import { CliError } from './errors';
import { createFileLock } from './fileLock';
import { fileIssuedAtStore, fileTokenStore, keyHashOf, type StoreHooks } from './tokenFiles';

/** KIS 초당 20건의 80%(앱 factory.ts와 같은 값) */
const KIS_QUEUE_RATES = { kis: 15 };

export interface Built {
  id: ProviderId;
  provider: MarketDataProvider;
  /** 키 앞 값(appKey·clientId)의 해시. 주문 캐시 파일 이름에 쓴다 */
  keyHash: string;
}

/** 접근 토큰은 읽거나 저장할 때마다 출력 거르기에 등록하고, 파일 권한이 넓으면 warnings로 알린다 */
const hooks = (ctx: Ctx): StoreHooks => ({ onSecret: (t) => ctx.redact.add(t), warn: ctx.warn });

export function buildProvider(ctx: Ctx, id: ProviderId, creds: Creds): Built {
  const client = createDirectClient(ctx.fetch);
  if (id === 'kis') {
    const c = creds.kis;
    if (!c) throw new CliError('no-credentials');
    ctx.redact.add(c.appKey);
    ctx.redact.add(c.appSecret);
    const keyHash = keyHashOf(c.appKey);
    return {
      id,
      keyHash,
      provider: createKisProvider({
        client,
        queue: createRequestQueue({ ratesPerSec: KIS_QUEUE_RATES }),
        creds: c,
        tokenStore: fileTokenStore(ctx.dir, 'kis', keyHash, hooks(ctx)),
        issuedAt: fileIssuedAtStore(ctx.dir, 'kis', keyHash, hooks(ctx)),
        tokenLock: createFileLock({ dir: ctx.dir, name: 'kis' }),
        now: ctx.now,
      }),
    };
  }
  const c = creds.toss;
  if (!c) throw new CliError('no-credentials');
  ctx.redact.add(c.clientId);
  ctx.redact.add(c.clientSecret);
  const keyHash = keyHashOf(c.clientId);
  return {
    id,
    keyHash,
    provider: createTossProvider({
      client,
      queue: createRequestQueue({ ratesPerSec: { ...TOSS_QUEUE_RATES } }),
      creds: c,
      tokenStore: fileTokenStore(ctx.dir, 'toss', keyHash, hooks(ctx)),
      // 실행을 넘어 재발급 간격(60초)을 지키려고 발급 시각을 파일에 둔다. 앱은 넘기지 않는다
      issuedAt: fileIssuedAtStore(ctx.dir, 'toss', keyHash, hooks(ctx)),
      tokenLock: createFileLock({ dir: ctx.dir, name: 'toss' }),
      now: ctx.now,
    }),
  };
}
```

`cli/src/commands/market.ts`:

```ts
import type { Command } from '../context';
import { chooseProvider, readCreds } from '../env';
import { CliError } from '../errors';
import { buildProvider } from '../providers';

const SYMBOL = /^Q?[0-9A-Z]{6}$/;
/** 토스는 ETN을 Q 없는 6자리로 돌려준다 */
const norm = (s: string) => s.replace(/^Q(?=\d{6}$)/, '');

export const quote: Command = async (ctx) => {
  const symbols = ctx.args.positionals;
  if (symbols.length === 0) throw new CliError('invalid-args', '종목 코드가 필요해요. 예: gazua quote 005930 000660');
  for (const s of symbols) if (!SYMBOL.test(s)) throw new CliError('invalid-args', `종목 코드 모양이 맞지 않아요: ${s}`);
  const creds = readCreds(ctx.env);
  const id = chooseProvider(creds, ctx.args.provider);
  const { provider } = buildProvider(ctx, id, creds);
  const venues = provider.capabilities.venues;
  const venue = venues.length === 0 || venues.includes('KRX') ? 'KRX' : venues[0];
  const unique = [...new Set(symbols)];
  const quotes = await provider.getQuotes(unique, venue);
  const got = new Set(quotes.map((q) => norm(q.symbol)));
  const missing = unique.filter((s) => !got.has(norm(s)));
  return {
    provider: id,
    quotes: quotes.map((q) => ({ symbol: q.symbol, price: q.price, ts: q.ts, venue: q.venue })),
    ...(missing.length ? { missing } : {}),
  };
};

export const holdings: Command = async (ctx) => {
  if ((ctx.args.provider ?? 'toss') !== 'toss') throw new CliError('provider-unsupported', '보유 조회는 토스만 돼요');
  const creds = readCreds(ctx.env);
  if (!creds.toss) throw new CliError('no-credentials');
  const { provider } = buildProvider(ctx, 'toss', creds);
  const account = provider.account;
  if (!account) throw new CliError('provider-unsupported');
  ctx.redact.add(await account.accountId()); // accountSeq는 출력에 내지 않는다
  const list = await account.holdings();
  return {
    provider: 'toss',
    holdings: list.map((h) => ({ symbol: h.symbol, name: h.name, quantity: h.quantity, ...(h.avgPrice !== undefined ? { avgPrice: h.avgPrice } : {}) })),
  };
};
```

`cli/src/main.ts`: import와 `COMMANDS`.

```ts
import { holdings, quote } from './commands/market';
```

```ts
export const COMMANDS: Record<string, Command> = {
  login,
  logout,
  profiles,
  watchlists,
  strategies,
  quote,
  holdings,
};
```

- [ ] **Step 4: 통과 확인**

Run: `corepack pnpm --filter gazua-cli test && corepack pnpm --filter gazua-cli check && corepack pnpm --filter gazua-cli build`
Expected: PASS. (`holdings` 테스트에서 토스 `ACCOUNT` 큐가 초당 1건이라 계좌 → 보유 두 호출 사이에 약 1초가 걸릴 수 있다. 테스트 시간 제한은 기본 5초면 충분하다. 넘으면 해당 `it`에 `{ timeout: 15_000 }`을 준다.)

- [ ] **Step 5: 커밋**

```bash
git add cli
git commit -m "feat(cli): 증권사 직접 호출(허용 목록·파일 토큰 잠금)과 quote·holdings를 더함"
```

---

## Task 12: `gazua signals` — 조건 신호와 보유 기준 매도 판정

**Files:**
- Create: `cli/src/signals.ts`, `cli/src/orderCache.ts`, `cli/src/commands/signals.ts`
- Modify: `cli/src/main.ts`(import, `COMMANDS`)
- Create(테스트): `cli/src/signals.test.ts`, `cli/src/orderCache.test.ts`, `cli/src/commands/signals.test.ts`

**Interfaces:**
- Consumes: `createRuleEvaluator`·`rulesLookback`(`src/lib/sim/rules.ts`, Task 7의 `group` 포함), `normalizeOrders`(`src/lib/perf/ledger.ts`), `Trade`(`src/lib/perf/types.ts`), `MarketDataProvider`·`AccountOrder`·`AccountSource`(`types.ts`), `kstDate`·`kstMinuteOfDay`·`addDays`(`src/lib/time/kst.ts`), `resolveSymbols`(`src/lib/sim/validate.ts`), Task 10의 `pickProfile`·`findStrategy`, Task 11의 `buildProvider`·`readCreds`·`chooseProvider`.
- Produces:
  ```ts
  // signals.ts
  export const CLOSE_MINUTE: Record<Venue, number>;                  // KRX 15:30, NXT·UNIFIED 20:00 (KST 자정부터 분)
  export const NOTES: { base: readonly string[]; tossOnly: string; avgAfterScaleIn: string; breakeven: string; noSymbols: string };
  export function pickVenue(provider: Pick<MarketDataProvider, 'capabilities'>): Venue;        // loadSimData와 같은 규칙
  export function windowEnd(o: { now: number; today: boolean; venue: Venue; openToday: boolean }): { to: string; includesToday: boolean };
  export function warmFrom(to: string, strategy: Strategy): string;  // addDays(to, -max(400, ceil(rulesLookback × 1.6)))
  export function usableCandles(candles: Candle[], to: string): Candle[];   // 시·고·저·종가가 유한한 양수이고 날짜 ≤ to, t 오름차순
  export interface Judge { match: boolean; reason?: string; group?: number }
  export function evaluateAt(candles: Candle[], groups: CondGroup[], idx: number): Judge;       // firstDayIdx = idx, 앞 봉부터 signal→update
  export function matchesHolding(strategySymbol: string, code: string): boolean;                // s === code || s === 'Q' + code
  export function tradesInFillOrder(orders: AccountOrder[]): Trade[];                          // normalizeOrders 결과를 실제 체결 시각순(filledAt ?? orderedAt)으로 다시 정렬
  export function firstBuyOf(trades: Trade[], quantity: number): { date: string; price: number } | null;
  export type Tri = boolean | 'unknown';
  export interface HoldingJudgement { symbol: string; quantity: number; avgPrice: number | null; close: number; firstBuyDate: string | null;
    stop: { price: number | null; hit: Tri } | null; takes: { stage: number; price: number | null; hit: Tri }[]; stagesDoneUnknown: boolean;
    trail: { price: number | null; hit: Tri } | null; timeExit: { heldDays: number | null; days: number; hit: Tri } | null;
    breakeven?: { price: number | null; hit: 'unknown' }; signalSell: Judge | null }
  export function judgeHolding(i: { strategy: Strategy; symbol: string; quantity: number; avgPrice: number | undefined; close: number;
    first: { date: string; price: number } | null; peakClose: number | null; heldDays: number | null; signalSell: Judge | null }): HoldingJudgement;
  export interface SymbolSignal { symbol: string; buy: Judge; sell: Judge | null; asOf?: string }
  export interface SignalsDeps { provider: MarketDataProvider; strategy: Strategy; symbols: string[]; now: number; today: boolean; loadOrders?: () => Promise<AccountOrder[]> }
  export interface SignalsOutput { strategy: string; asOf: string | null; includesToday: boolean; venue: Venue; signals: SymbolSignal[]; holdings?: HoldingJudgement[]; failed: { symbol: string; reason: string }[]; notes: string[] }
  export function runSignals(d: SignalsDeps): Promise<SignalsOutput>;
  // orderCache.ts
  export const RESYNC_OVERLAP_DAYS = 7;
  export function orderCachePath(dir: string, keyHash: string, accountSeq: string): string;     // orders-<keyHash>-<accountSeq SHA-256 앞 8자>.json
  export function syncOrders(o: { dir: string; keyHash: string; account: AccountSource; now: number; onSeq?: (seq: string) => void; warn?: (message: string) => void }): Promise<AccountOrder[]>;
  // commands/signals.ts
  export function makeSignals(build?: typeof buildProvider): Command;   // 테스트가 공급자를 바꿔 끼운다
  export const signals: Command;                                        // makeSignals()
  ```
  - 출력은 스펙 §7.1·§7.2의 JSON(`data` = `SignalsOutput`). `--today` 없이 쓰면 어제까지, `--today`이고 그 venue 마감(KRX 15:30·통합 20:00) 뒤이며 오늘이 거래일이면 오늘까지.

- [ ] **Step 1: 실패하는 테스트 쓰기**

`cli/src/signals.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Candle } from '../../src/lib/data/metrics';
import type { Venue } from '../../src/lib/market/tradable';
import type { Trade } from '../../src/lib/perf/types';
import type { AccountOrder, AccountSource, CandleQuery, MarketDataProvider } from '../../src/lib/providers/types';
import { ApiError } from '../../src/lib/providers/errors';
import { normalizeOrders } from '../../src/lib/perf/ledger';
import { createRuleEvaluator } from '../../src/lib/sim/rules';
import { barsFromCloses, tradingDates } from '../../src/lib/sim/testBars';
import { fullStrategyV2 } from '../../src/lib/sim/testStrategyV2';
import type { Cond, CondGroup, Strategy } from '../../src/lib/sim/types';
import { addDays, kstDate, kstEpoch, kstWeekday } from '../../src/lib/time/kst';
import { CLOSE_MINUTE, evaluateAt, firstBuyOf, judgeHolding, matchesHolding, NOTES, pickVenue, runSignals, tradesInFillOrder, usableCandles, warmFrom, windowEnd } from './signals';

const MA_ABOVE: Cond = { kind: 'maPrice', period: 3, side: 'above' };
const MA_BELOW: Cond = { kind: 'maPrice', period: 3, side: 'below' };
const group = (...conds: Cond[]): CondGroup => ({ conds });

/** 매수: 3일선 위, 조건 매도: 3일선 아래. 나머지 매도 규칙은 fullStrategyV2 그대로(손절 7% 평단·익절 10/20%·트레일 10%·20일 청산) */
function strat(over: (s: Strategy) => void = () => {}): Strategy {
  const s = fullStrategyV2();
  s.rules.buy = [group(MA_ABOVE)];
  s.rules.sell.signal = { on: true, groups: [group(MA_BELOW)] };
  over(s);
  return s;
}

const weekdayCalendar = (from: string, to: string, closed: string[] = []) => {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push({ date: d, isOpen: kstWeekday(d) !== 0 && kstWeekday(d) !== 6 && !closed.includes(d) });
  return out;
};

function stub(o: { venues?: Venue[]; candles: Record<string, Candle[] | Error>; closed?: string[]; account?: Partial<AccountSource> }): MarketDataProvider {
  return {
    id: 'toss',
    capabilities: { venues: o.venues ?? ['UNIFIED'], quoteBatchSize: 200, hasIndexCandles: true, indexMinutePastDays: true },
    async getCandles(q: CandleQuery) {
      const c = o.candles[q.symbol];
      if (c instanceof Error) throw c;
      return (c ?? []).filter((x) => kstDate(x.t) >= q.from && kstDate(x.t) <= q.to);
    },
    async getTradingDays(from: string, to: string) {
      return weekdayCalendar(from, to, o.closed);
    },
    ...(o.account ? { account: o.account as AccountSource } : {}),
  } as unknown as MarketDataProvider;
}

// 2026-10-26(월) ~ 2026-11-02(월) 일봉. 11-02는 오늘 봉
const DAYS = tradingDates('2026-10-26', 6); // 10-26 27 28 29 30, 11-02
const CLOSES_UP = [10, 10, 10, 10, 10, 12]; // 마지막 봉이 3일선 위
const CLOSES_DOWN = [10, 10, 10, 10, 10, 8]; // 마지막 봉이 3일선 아래

describe('windowEnd: venue별 마감 시각', () => {
  const at = (date: string, hhmm: string) => kstEpoch(date, `${hhmm}:00`);
  it('마감 시각 상수', () => {
    expect(CLOSE_MINUTE).toEqual({ KRX: 15 * 60 + 30, NXT: 20 * 60, UNIFIED: 20 * 60 });
  });

  it.each<[Venue, string, boolean, boolean, string, boolean]>([
    // venue, 시각, --today, 오늘이 거래일, 기대 to, 기대 includesToday
    ['KRX', '15:29', true, true, '2026-11-01', false],
    ['KRX', '15:30', true, true, '2026-11-02', true],
    ['KRX', '15:30', false, true, '2026-11-01', false],
    ['UNIFIED', '15:30', true, true, '2026-11-01', false],
    ['UNIFIED', '19:59', true, true, '2026-11-01', false],
    ['UNIFIED', '20:00', true, true, '2026-11-02', true],
    ['UNIFIED', '20:00', false, true, '2026-11-01', false],
    ['UNIFIED', '20:00', true, false, '2026-11-01', false], // 휴장일이면 --today여도 오늘 포함 안 함
    ['NXT', '19:59', true, true, '2026-11-01', false],
  ])('%s %s today=%s open=%s → %s %s', (venue, hhmm, today, openToday, to, includesToday) => {
    expect(windowEnd({ now: at('2026-11-02', hhmm), today, venue, openToday })).toEqual({ to, includesToday });
  });
});

describe('pickVenue·warmFrom·usableCandles', () => {
  it('venue는 비었거나 KRX가 있으면 KRX, 아니면 첫 venue(loadSimData와 같다)', () => {
    const p = (venues: Venue[]) => ({ capabilities: { venues } }) as MarketDataProvider;
    expect(pickVenue(p([]))).toBe('KRX');
    expect(pickVenue(p(['KRX', 'NXT', 'UNIFIED']))).toBe('KRX');
    expect(pickVenue(p(['UNIFIED']))).toBe('UNIFIED');
  });

  it('워밍업은 max(400, ceil(lookback×1.6))일 전', () => {
    expect(warmFrom('2026-10-30', strat())).toBe(addDays('2026-10-30', -400));
    const rsi = strat((s) => (s.rules.buy = [group({ kind: 'rsi', period: 14, level: 30, op: 'crossUp' })])); // lookback 251 → 402일
    expect(warmFrom('2026-10-30', rsi)).toBe(addDays('2026-10-30', -402));
  });

  it('유효하지 않은 봉과 to 뒤의 봉을 빼고 시간순으로 돌려준다', () => {
    const bars = barsFromCloses([10, 11, 12, 13], '2026-10-26');
    const bad: Candle = { ...bars[1], c: 0 };
    const out = usableCandles([bars[3], bars[0], bad, bars[2]], '2026-10-28');
    expect(out.map((c) => kstDate(c.t))).toEqual(['2026-10-26', '2026-10-28']);
  });
});

describe('evaluateAt: 엔진과 같은 판정', () => {
  const closes = Array.from({ length: 320 }, (_, i) => Math.round(1000 + 120 * Math.sin(i / 7) + i * 0.5));
  const candles = barsFromCloses(closes, '2025-01-02');
  const groups = [group({ kind: 'rsi', period: 14, level: 50, op: 'above' }), group({ kind: 'maCross', short: 5, long: 20, dir: 'golden' }), group(MA_ABOVE, { kind: 'change', days: 5, pct: 1, op: 'above' })];

  it('firstDayIdx는 기준 봉이다: 같은 평가기를 앞 봉부터 signal→update로 돌린 결과와 모든 봉에서 같다', () => {
    for (let idx = 280; idx < 320; idx++) {
      const ev = createRuleEvaluator(candles, groups, idx);
      let last = null as ReturnType<typeof ev.signal>;
      for (let i = 0; i <= idx; i++) {
        last = ev.signal(i);
        ev.update(i);
      }
      const got = evaluateAt(candles, groups, idx);
      expect(got.match).toBe(last !== null);
      if (last) expect(got).toEqual({ match: true, reason: last.reason, group: last.group });
      else expect(got).toEqual({ match: false });
    }
  });

  it('맞은 묶음 번호와 사유를 낸다', () => {
    const c = barsFromCloses([10, 10, 10, 12], '2026-10-26');
    expect(evaluateAt(c, [group(MA_BELOW), group(MA_ABOVE)], 3)).toEqual({ match: true, reason: '종가 3일선 위', group: 2 });
    expect(evaluateAt(c, [group(MA_BELOW)], 3)).toEqual({ match: false });
  });
});

describe('보유 종목 매칭과 첫 매수', () => {
  it('ETN은 Q 없는 코드도 같은 종목', () => {
    expect(matchesHolding('005930', '005930')).toBe(true);
    expect(matchesHolding('Q500023', '500023')).toBe(true);
    expect(matchesHolding('500023', 'Q500023')).toBe(false);
    expect(matchesHolding('005930', '000660')).toBe(false);
  });

  const t = (side: 'BUY' | 'SELL', date: string, qty: number, price = 100): Trade => ({ orderId: `${side}${date}${qty}`, symbol: '005930', side, date, orderedAt: `${date}T09:00:00+09:00`, qty, price, amount: qty * price, commission: 0, tax: 0 });

  it('수량이 0에서 양수가 된 마지막 날과 그날 첫 매수 체결가', () => {
    expect(firstBuyOf([t('BUY', '2026-08-03', 10, 100), t('SELL', '2026-08-10', 10), t('BUY', '2026-09-02', 5, 110), t('BUY', '2026-09-03', 5, 120)], 10)).toEqual({ date: '2026-09-02', price: 110 });
    expect(firstBuyOf([t('BUY', '2026-09-02', 10, 110), t('BUY', '2026-09-03', 5, 120)], 15)).toEqual({ date: '2026-09-02', price: 110 });
    expect(firstBuyOf([t('BUY', '2026-09-02', 10, 110), t('SELL', '2026-09-05', 3)], 7)).toEqual({ date: '2026-09-02', price: 110 });
  });

  it('같은 날 전량 매도 후 재매수: 체결 시각순으로 읽어 재매수 시점이 첫 매수가 된다', () => {
    const o = (orderId: string, side: 'BUY' | 'SELL', filledAt: string, quantity: number, price: number): AccountOrder => ({ orderId, symbol: '005930', side, status: 'FILLED', currency: 'KRW', orderedAt: filledAt, filledAt, quantity, price, amount: quantity * price, commission: 0, tax: 0 });
    const orders = [
      o('o1', 'BUY', '2026-10-01T09:30:00+09:00', 10, 68000),
      o('o2', 'SELL', '2026-10-30T09:00:00+09:00', 10, 71000),
      o('o3', 'BUY', '2026-10-30T10:00:00+09:00', 10, 70000),
    ];
    expect(tradesInFillOrder(orders).map((t) => t.orderId)).toEqual(['o1', 'o2', 'o3']);
    expect(firstBuyOf(tradesInFillOrder(orders), 10)).toEqual({ date: '2026-10-30', price: 70000 });
    // normalizeOrders만 쓰면 같은 날 매수가 먼저라 첫 매수일이 10-01로 남는다(회귀 확인)
    expect(firstBuyOf(normalizeOrders(orders).trades, 10)).toEqual({ date: '2026-10-01', price: 68000 });
  });

  it('이력이 모자라면(끝 수량이 보유 수량과 다르면) null', () => {
    expect(firstBuyOf([t('BUY', '2026-09-03', 5)], 10)).toBeNull();
    expect(firstBuyOf([], 10)).toBeNull();
    expect(firstBuyOf([t('BUY', '2026-09-02', 10), t('SELL', '2026-09-05', 10)], 10)).toBeNull();
  });
});

describe('judgeHolding: 스펙 §7.2의 계산', () => {
  const base = { strategy: strat(), symbol: '005930', quantity: 10, avgPrice: 68500 as number | undefined, close: 71200, first: { date: '2026-09-02', price: 68000 } as { date: string; price: number } | null, peakClose: 78300 as number | null, heldDays: 42 as number | null, signalSell: { match: false } };

  it('예시 수치: 손절 63,705 · 익절 75,350/82,200 · 트레일 70,470 · 20일 청산 도달', () => {
    expect(judgeHolding(base)).toEqual({
      symbol: '005930',
      quantity: 10,
      avgPrice: 68500,
      close: 71200,
      firstBuyDate: '2026-09-02',
      stop: { price: 63705, hit: false },
      takes: [{ stage: 1, price: 75350, hit: false }, { stage: 2, price: 82200, hit: false }],
      stagesDoneUnknown: true,
      trail: { price: 70470, hit: false },
      timeExit: { heldDays: 42, days: 20, hit: true },
      breakeven: { price: 68500, hit: 'unknown' },
      signalSell: { match: false },
    });
  });

  it('종가 ≤ 손절·트레일이면 도달, ≥ 익절이면 도달(같으면 도달)', () => {
    expect(judgeHolding({ ...base, close: 63705 }).stop).toEqual({ price: 63705, hit: true });
    expect(judgeHolding({ ...base, close: 63706 }).stop?.hit).toBe(false);
    expect(judgeHolding({ ...base, close: 70470 }).trail?.hit).toBe(true);
    const r = judgeHolding({ ...base, close: 76000 });
    expect(r.takes.map((x) => x.hit)).toEqual([true, false]);
    expect(judgeHolding({ ...base, close: 75350 }).takes[0].hit).toBe(true);
  });

  it('트레일 기준은 첫 매수일부터의 종가 최고값과 첫 매수가 중 큰 값', () => {
    expect(judgeHolding({ ...base, peakClose: 60000 }).trail?.price).toBe(61200); // 68000 × 0.9
    expect(judgeHolding({ ...base, peakClose: null }).trail).toEqual({ price: null, hit: 'unknown' }); // 최고값을 모르면 unknown
  });

  it('평단을 모르면 평단 기준 가격은 모두 unknown', () => {
    const r = judgeHolding({ ...base, avgPrice: undefined });
    expect(r.avgPrice).toBeNull();
    expect(r.stop).toEqual({ price: null, hit: 'unknown' });
    expect(r.takes).toEqual([{ stage: 1, price: null, hit: 'unknown' }, { stage: 2, price: null, hit: 'unknown' }]);
    expect(r.breakeven).toEqual({ price: null, hit: 'unknown' });
    expect(r.trail?.price).toBe(70470); // 트레일은 평단이 필요 없다
  });

  it('첫 매수일을 모르면 트레일·기간 청산은 unknown, firstBuy 기준 손절도 unknown', () => {
    const r = judgeHolding({ ...base, first: null, peakClose: null, heldDays: null });
    expect(r.firstBuyDate).toBeNull();
    expect(r.trail).toEqual({ price: null, hit: 'unknown' });
    expect(r.timeExit).toEqual({ heldDays: null, days: 20, hit: 'unknown' });
    const fb = judgeHolding({ ...base, first: null, strategy: strat((s) => (s.rules.sell.stopLoss.basis = 'firstBuy')) });
    expect(fb.stop).toEqual({ price: null, hit: 'unknown' });
    const fb2 = judgeHolding({ ...base, strategy: strat((s) => (s.rules.sell.stopLoss.basis = 'firstBuy')) });
    expect(fb2.stop).toEqual({ price: 63240, hit: false }); // 68000 × 0.93
  });

  it('꺼진 규칙은 null·빈 목록, 본전 손절은 익절이 꺼지면 없다', () => {
    const off = strat((s) => {
      s.rules.sell.stopLoss.on = false;
      s.rules.sell.takeProfit.on = false;
      s.rules.sell.trailing.on = false;
      s.rules.sell.timeExit.on = false;
      s.rules.sell.signal.on = false;
    });
    const r = judgeHolding({ ...base, strategy: off, signalSell: null });
    expect(r).toMatchObject({ stop: null, takes: [], stagesDoneUnknown: false, trail: null, timeExit: null, signalSell: null });
    expect('breakeven' in r).toBe(false);
    const keep = strat((s) => (s.rules.sell.takeProfit.afterFirstTake = 'keep'));
    expect('breakeven' in judgeHolding({ ...base, strategy: keep })).toBe(false);
  });
});

describe('runSignals', () => {
  const NOW = kstEpoch('2026-11-02', '12:00:00'); // 월요일 낮: KRX도 통합도 마감 전

  it('기준 봉은 어제까지의 마지막 완성 일봉, 종목별 매수·매도 판정과 notes', async () => {
    const provider = stub({ venues: ['KRX', 'NXT', 'UNIFIED'], candles: { '005930': barsFromCloses(CLOSES_UP, '2026-10-26'), '000660': barsFromCloses(CLOSES_DOWN, '2026-10-26') } });
    const out = await runSignals({ provider, strategy: strat(), symbols: ['005930', '000660'], now: NOW, today: false });
    expect(out).toEqual({
      strategy: '골든크로스 추세',
      asOf: '2026-10-30',
      includesToday: false,
      venue: 'KRX',
      signals: [
        { symbol: '005930', buy: { match: false }, sell: { match: false } },
        { symbol: '000660', buy: { match: false }, sell: { match: false } },
      ],
      failed: [],
      notes: [...NOTES.base, NOTES.tossOnly],
    });
  });

  it('--today는 마감 뒤에만 오늘 봉을 쓴다(통합은 20:00)', async () => {
    const provider = stub({ candles: { '005930': barsFromCloses(CLOSES_UP, '2026-10-26'), '000660': barsFromCloses(CLOSES_DOWN, '2026-10-26') } });
    const run = (hhmm: string, today = true) => runSignals({ provider, strategy: strat(), symbols: ['005930', '000660'], now: kstEpoch('2026-11-02', `${hhmm}:00`), today });
    const before = await run('15:31');
    expect([before.asOf, before.includesToday, before.venue]).toEqual(['2026-10-30', false, 'UNIFIED']);
    const after = await run('20:01');
    expect([after.asOf, after.includesToday]).toEqual(['2026-11-02', true]);
    expect(after.signals).toEqual([
      { symbol: '005930', buy: { match: true, reason: '종가 3일선 위', group: 1 }, sell: { match: false } },
      { symbol: '000660', buy: { match: false }, sell: { match: true, reason: '종가 3일선 아래', group: 1 } },
    ]);
    const noFlag = await run('20:01', false);
    expect([noFlag.asOf, noFlag.includesToday]).toEqual(['2026-10-30', false]);
  });

  it('KRX는 15:30에 마감: 15:30부터 오늘 봉', async () => {
    const provider = stub({ venues: ['KRX'], candles: { '005930': barsFromCloses(CLOSES_UP, '2026-10-26') } });
    const run = (hhmm: string) => runSignals({ provider, strategy: strat(), symbols: ['005930'], now: kstEpoch('2026-11-02', `${hhmm}:00`), today: true });
    expect((await run('15:29')).includesToday).toBe(false);
    expect((await run('15:30')).includesToday).toBe(true);
  });

  it('오늘이 휴장일이면 --today여도 마지막 거래일이 기준', async () => {
    const provider = stub({ candles: { '005930': barsFromCloses(CLOSES_UP, '2026-10-26') }, closed: ['2026-11-02'] });
    const out = await runSignals({ provider, strategy: strat(), symbols: ['005930'], now: kstEpoch('2026-11-02', '21:00:00'), today: true });
    expect([out.asOf, out.includesToday]).toEqual(['2026-10-30', false]);
  });

  it('조건 매도가 꺼져 있으면 sell은 null', async () => {
    const provider = stub({ candles: { '005930': barsFromCloses(CLOSES_UP, '2026-10-26') } });
    const out = await runSignals({ provider, strategy: strat((s) => (s.rules.sell.signal.on = false)), symbols: ['005930'], now: kstEpoch('2026-11-02', '21:00:00'), today: true });
    expect(out.signals[0].sell).toBeNull();
  });

  it('받지 못한 종목은 failed로, 기준 봉이 다른 종목은 자기 asOf를 단다. 모두 실패하면 첫 오류를 던진다', async () => {
    const provider = stub({ candles: { '005930': barsFromCloses(CLOSES_UP, '2026-10-26'), '000660': new ApiError('timeout'), '035420': [], '051910': barsFromCloses([10, 10, 10, 12], '2026-10-26') } });
    const out = await runSignals({ provider, strategy: strat(), symbols: ['005930', '000660', '035420', '051910'], now: kstEpoch('2026-11-02', '21:00:00'), today: true });
    expect(out.failed).toEqual([{ symbol: '000660', reason: '받지 못했어요' }, { symbol: '035420', reason: '데이터가 없어요' }]);
    expect(out.signals.map((s) => [s.symbol, s.asOf])).toEqual([['005930', undefined], ['051910', '2026-10-29']]);
    const allBad = stub({ candles: { '005930': new ApiError('proxy-unreachable'), '000660': new ApiError('proxy-unreachable') } });
    await expect(runSignals({ provider: allBad, strategy: strat(), symbols: ['005930', '000660'], now: NOW, today: false })).rejects.toMatchObject({ code: 'proxy-unreachable' });
  });

  it('종목이 없으면 빈 결과와 notes', async () => {
    const out = await runSignals({ provider: stub({ candles: {} }), strategy: strat(), symbols: [], now: NOW, today: false });
    expect(out).toMatchObject({ asOf: null, signals: [], notes: expect.arrayContaining([NOTES.noSymbols]) });
  });

  describe('내 보유 기준 매도 판정(토스)', () => {
    // 2026-09-01부터 거래일 분량의 봉. 마지막(10-30) 종가 71,200, 그 전 최고 종가 78,300
    const dates = tradingDates('2026-09-01', 44); // ... 2026-10-30
    const closes = dates.map((_, i) => 70000 + (i % 5) * 100);
    closes[10] = 78300;
    closes[closes.length - 1] = 71200;
    const candles = barsFromCloses(closes, '2026-09-01');
    const order = (over: Partial<AccountOrder> = {}): AccountOrder => ({ orderId: 'o1', symbol: '005930', side: 'BUY', status: 'FILLED', currency: 'KRW', orderedAt: '2026-09-02T09:30:00+09:00', filledAt: '2026-09-02T09:30:05+09:00', quantity: 10, price: 68000, amount: 680000, commission: 0, tax: 0, ...over });
    const account = (holdings: { symbol: string; name: string; quantity: number; avgPrice?: number }[]): Partial<AccountSource> => ({ holdings: async () => holdings });

    it('보유 종목마다 평단·첫 매수일·보유일수·손절/익절/트레일/기간 청산을 계산한다', async () => {
      const provider = stub({ candles: { '005930': candles }, account: account([{ symbol: '005930', name: '삼성전자', quantity: 10, avgPrice: 68500 }]) });
      const out = await runSignals({ provider, strategy: strat(), symbols: ['005930'], now: NOW, today: false, loadOrders: async () => [order()] });
      const heldDays = tradingDates('2026-09-02', 100).filter((d) => d <= '2026-10-30').length;
      expect(out.holdings).toEqual([
        {
          symbol: '005930',
          quantity: 10,
          avgPrice: 68500,
          close: 71200,
          firstBuyDate: '2026-09-02',
          stop: { price: 63705, hit: false },
          takes: [{ stage: 1, price: 75350, hit: false }, { stage: 2, price: 82200, hit: false }],
          stagesDoneUnknown: true,
          trail: { price: 70470, hit: false },
          timeExit: { heldDays, days: 20, hit: true },
          breakeven: { price: 68500, hit: 'unknown' },
          signalSell: { match: false },
        },
      ]);
      expect(out.notes).toEqual([...NOTES.base, NOTES.breakeven]);
    });

    it('주문 이력이 모자라면 첫 매수일에 의존하는 항목은 unknown', async () => {
      const provider = stub({ candles: { '005930': candles }, account: account([{ symbol: '005930', name: '삼성전자', quantity: 10, avgPrice: 68500 }]) });
      const out = await runSignals({ provider, strategy: strat(), symbols: ['005930'], now: NOW, today: false, loadOrders: async () => [order({ quantity: 4 })] });
      expect(out.holdings?.[0]).toMatchObject({ firstBuyDate: null, trail: { price: null, hit: 'unknown' }, timeExit: { heldDays: null, days: 20, hit: 'unknown' }, stop: { price: 63705, hit: false } });
    });

    describe('첫 매수일이 받아 둔 조회 범위보다 앞일 때(트레일 최고가)', () => {
      const longDates = tradingDates('2024-01-02', 800).filter((d) => d <= '2026-10-30');
      const longCloses = longDates.map((_, i) => 70000 + (i % 5) * 100);
      longCloses[40] = 90000; // 첫 매수 직후의 최고 종가
      longCloses[longCloses.length - 1] = 71200;
      const old = order({ orderedAt: '2024-01-02T09:30:00+09:00', filledAt: '2024-01-02T09:30:05+09:00', price: 68000 });
      const held = account([{ symbol: '005930', name: '삼성전자', quantity: 10, avgPrice: 68500 }]);
      const recording = (c: Candle[]) => {
        const froms: string[] = [];
        const p = stub({ candles: { '005930': c }, account: held });
        const orig = p.getCandles.bind(p);
        p.getCandles = async (q: CandleQuery) => {
          froms.push(q.from);
          return orig(q);
        };
        return { p, froms };
      };

      it('부족한 봉을 첫 매수일부터 더 받아 그 구간의 최고 종가로 트레일을 계산한다', async () => {
        const { p, froms } = recording(barsFromCloses(longCloses, '2024-01-02'));
        const out = await runSignals({ provider: p, strategy: strat(), symbols: ['005930'], now: NOW, today: false, loadOrders: async () => [old] });
        expect(froms).toHaveLength(2);
        expect(froms[1]).toBe('2024-01-02');
        expect(out.holdings?.[0]).toMatchObject({ firstBuyDate: '2024-01-02', trail: { price: 81000, hit: true } }); // 90000 × 0.9, 종가 71,200 ≤ 81,000
      });

      it('첫 매수일 근처부터 봉을 확보하지 못하면 트레일은 unknown', async () => {
        const short = barsFromCloses(longCloses.slice(-100), longDates[longDates.length - 100]);
        const { p } = recording(short);
        const out = await runSignals({ provider: p, strategy: strat(), symbols: ['005930'], now: NOW, today: false, loadOrders: async () => [old] });
        expect(out.holdings?.[0].trail).toEqual({ price: null, hit: 'unknown' });
        expect(out.holdings?.[0].stop?.price).toBe(63705); // 다른 항목은 그대로
      });

      it('더 받는 요청이 실패해도 트레일만 unknown', async () => {
        const { p } = recording(barsFromCloses(longCloses, '2024-01-02'));
        const orig = p.getCandles.bind(p);
        let n = 0;
        p.getCandles = async (q: CandleQuery) => {
          if (++n === 2) throw new ApiError('timeout');
          return orig(q);
        };
        const out = await runSignals({ provider: p, strategy: strat(), symbols: ['005930'], now: NOW, today: false, loadOrders: async () => [old] });
        expect(out.holdings?.[0].trail).toEqual({ price: null, hit: 'unknown' });
      });
    });

    it('같은 날 전량 매도 후 재매수한 종목은 재매수일이 첫 매수일이다', async () => {
      const provider = stub({ candles: { '005930': candles }, account: account([{ symbol: '005930', name: '삼성전자', quantity: 10, avgPrice: 70000 }]) });
      const orders = [
        order({ orderId: 'a1' }),
        order({ orderId: 'a2', side: 'SELL', orderedAt: '2026-10-29T09:00:00+09:00', filledAt: '2026-10-29T09:00:05+09:00', price: 71000, amount: 710000 }),
        order({ orderId: 'a3', orderedAt: '2026-10-29T10:00:00+09:00', filledAt: '2026-10-29T10:00:05+09:00', price: 70000, amount: 700000 }),
      ];
      const out = await runSignals({ provider, strategy: strat((s) => (s.rules.sell.stopLoss.basis = 'firstBuy')), symbols: ['005930'], now: NOW, today: false, loadOrders: async () => orders });
      expect(out.holdings?.[0]).toMatchObject({ firstBuyDate: '2026-10-29', stop: { price: 65100, hit: false } }); // 재매수가 70,000 × 0.93
    });

    it('ETN은 전략의 Q코드와 토스의 6자리 코드를 같은 종목으로 본다', async () => {
      const provider = stub({ candles: { Q500023: candles }, account: account([{ symbol: '500023', name: 'ETN', quantity: 10, avgPrice: 68500 }]) });
      const out = await runSignals({ provider, strategy: strat(), symbols: ['Q500023'], now: NOW, today: false, loadOrders: async () => [order({ symbol: '500023' })] });
      expect(out.holdings).toHaveLength(1);
      expect(out.holdings?.[0]).toMatchObject({ symbol: 'Q500023', firstBuyDate: '2026-09-02' });
    });

    it('전략 종목 중 들고 있는 것이 없으면 holdings는 빈 목록(주문 이력을 받지 않는다)', async () => {
      let loaded = false;
      const provider = stub({ candles: { '005930': candles }, account: account([]) });
      const out = await runSignals({ provider, strategy: strat(), symbols: ['005930'], now: NOW, today: false, loadOrders: async () => ((loaded = true), []) });
      expect(out.holdings).toEqual([]);
      expect(loaded).toBe(false);
    });

    it('조건 매도가 켜져 있으면 signalSell에 조건 매도 평가 결과를 넣는다', async () => {
      const down = barsFromCloses([...closes.slice(0, -1), 60000], '2026-09-01');
      const provider = stub({ candles: { '005930': down }, account: account([{ symbol: '005930', name: '삼성전자', quantity: 10, avgPrice: 68500 }]) });
      const out = await runSignals({ provider, strategy: strat(), symbols: ['005930'], now: NOW, today: false, loadOrders: async () => [order()] });
      expect(out.holdings?.[0].signalSell).toEqual({ match: true, reason: '종가 3일선 아래', group: 1 });
      expect(out.holdings?.[0].stop?.hit).toBe(true);
    });

    it('분할 매수 후 평단 기준 손절은 평단으로 계산했다고 notes에 적는다', async () => {
      const provider = stub({ candles: { '005930': candles }, account: account([{ symbol: '005930', name: '삼성전자', quantity: 10, avgPrice: 68500 }]) });
      const s = strat((x) => {
        x.rules.sell.stopLoss.basis = 'avgAfterScaleIn';
        x.rules.sell.takeProfit.afterFirstTake = 'keep';
      });
      const out = await runSignals({ provider, strategy: s, symbols: ['005930'], now: NOW, today: false, loadOrders: async () => [order()] });
      expect(out.notes).toEqual([...NOTES.base, NOTES.avgAfterScaleIn]);
    });
  });

  it('보유 기준 판정은 토스만: account가 없으면 holdings를 빼고 notes에 적는다', async () => {
    const provider = stub({ venues: ['KRX'], candles: { '005930': barsFromCloses(CLOSES_UP, '2026-10-26') } });
    const out = await runSignals({ provider, strategy: strat(), symbols: ['005930'], now: NOW, today: false });
    expect('holdings' in out).toBe(false);
    expect(out.notes).toContain(NOTES.tossOnly);
  });
});
```

`cli/src/orderCache.test.ts`:

```ts
import { chmodSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountOrder, AccountSource } from '../../src/lib/providers/types';
import { addDays, kstDate, kstEpoch } from '../../src/lib/time/kst';
import { orderCachePath, RESYNC_OVERLAP_DAYS, syncOrders } from './orderCache';
import { cleanupDirs, tempDir } from './testing';

afterEach(cleanupDirs);

const SEQ = 'acct-secret-7777777';
const order = (id: string, orderedAt: string, over: Partial<AccountOrder> = {}): AccountOrder => ({ orderId: id, symbol: '005930', side: 'BUY', status: 'FILLED', currency: 'KRW', orderedAt, filledAt: orderedAt, quantity: 1, price: 100, amount: 100, commission: 0, tax: 0, ...over });

function account(seq: string, pages: AccountOrder[][]) {
  const closedOrders = vi.fn(async (_opts?: { from?: string; to?: string }) => pages.shift() ?? []);
  const a = { accountId: async () => seq, closedOrders, holdings: async () => [] } as unknown as AccountSource;
  return { a, closedOrders };
}

describe('syncOrders', () => {
  const day1 = kstEpoch('2026-11-02', '12:00:00');

  it('처음에는 전체를 받고 orders-<keyHash>-<계좌 해시 8자>.json(600)에 저장한다. accountSeq는 이름에도 내용에도 없다', async () => {
    const dir = tempDir();
    const { a, closedOrders } = account(SEQ, [[order('o1', '2026-10-01T09:00:00+09:00')]]);
    const seen: string[] = [];
    const orders = await syncOrders({ dir, keyHash: 'kh1234', account: a, now: day1, onSeq: (s) => seen.push(s) });
    expect(orders.map((o) => o.orderId)).toEqual(['o1']);
    expect(closedOrders).toHaveBeenCalledTimes(1);
    expect(closedOrders.mock.calls[0][0]).toBeUndefined();
    expect(seen).toEqual([SEQ]);
    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^orders-kh1234-[0-9a-f]{8}\.json$/);
    expect(files[0]).not.toContain(SEQ);
    const text = readFileSync(join(dir, files[0]), 'utf8');
    expect(text).not.toContain(SEQ);
    expect(JSON.parse(text)).toMatchObject({ v: 1, syncedAt: day1, syncedThrough: kstDate(day1) });
    if (process.platform !== 'win32') expect(statSync(join(dir, files[0])).mode & 0o777).toBe(0o600);
    expect(orderCachePath(dir, 'kh1234', SEQ)).toBe(join(dir, files[0]));
  });

  it('다음에는 syncedThrough의 7일 전부터만 받아 orderId로 합친다(새 것이 이긴다), 주문 시각순', async () => {
    const dir = tempDir();
    const first = account(SEQ, [[order('o1', '2026-10-01T09:00:00+09:00', { status: 'PARTIAL' }), order('o2', '2026-10-30T09:00:00+09:00')]]);
    await syncOrders({ dir, keyHash: 'kh', account: first.a, now: day1 });
    const day2 = kstEpoch('2026-11-05', '12:00:00');
    const second = account(SEQ, [[order('o2', '2026-10-30T09:00:00+09:00', { status: 'FILLED', price: 222 }), order('o3', '2026-11-04T09:00:00+09:00')]]);
    const orders = await syncOrders({ dir, keyHash: 'kh', account: second.a, now: day2 });
    expect(RESYNC_OVERLAP_DAYS).toBe(7);
    expect(second.closedOrders).toHaveBeenCalledWith({ from: addDays('2026-11-02', -7) });
    expect(orders.map((o) => [o.orderId, o.price])).toEqual([['o1', 100], ['o2', 222], ['o3', 100]]);
    expect(JSON.parse(readFileSync(orderCachePath(dir, 'kh', SEQ), 'utf8')).syncedThrough).toBe('2026-11-05');
  });

  it.skipIf(process.platform === 'win32')('캐시 파일이 644이거나 디렉터리가 755면 warn으로 알린다', async () => {
    const dir = tempDir();
    await syncOrders({ dir, keyHash: 'kh', account: account(SEQ, [[order('o1', '2026-10-01T09:00:00+09:00')]]).a, now: day1 });
    const warn: string[] = [];
    await syncOrders({ dir, keyHash: 'kh', account: account(SEQ, [[]]).a, now: day1, warn: (m) => warn.push(m) });
    expect(warn).toEqual([]);
    const file = orderCachePath(dir, 'kh', SEQ);
    chmodSync(file, 0o644);
    chmodSync(dir, 0o755);
    await syncOrders({ dir, keyHash: 'kh', account: account(SEQ, [[]]).a, now: day1, warn: (m) => warn.push(m) });
    expect(warn.some((m) => m.includes('chmod 600'))).toBe(true);
    expect(warn.some((m) => m.includes('chmod 700'))).toBe(true);
  });

  it('계좌가 바뀌면 다른 파일이다(처음부터 받는다)', async () => {
    const dir = tempDir();
    await syncOrders({ dir, keyHash: 'kh', account: account(SEQ, [[order('o1', '2026-10-01T09:00:00+09:00')]]).a, now: day1 });
    const other = account('another-acct-1', [[order('x1', '2026-10-02T09:00:00+09:00')]]);
    const orders = await syncOrders({ dir, keyHash: 'kh', account: other.a, now: day1 });
    expect(other.closedOrders.mock.calls[0][0]).toBeUndefined();
    expect(orders.map((o) => o.orderId)).toEqual(['x1']);
    expect(readdirSync(dir)).toHaveLength(2);
  });

  it('키(keyHash)가 바뀌어도 다른 파일', async () => {
    expect(orderCachePath('/d', 'a', SEQ)).not.toBe(orderCachePath('/d', 'b', SEQ));
  });
});
```

`cli/src/commands/signals.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import type { MarketDataProvider } from '../../../src/lib/providers/types';
import { fullStrategyV2 } from '../../../src/lib/sim/testStrategyV2';
import { barsFromCloses } from '../../../src/lib/sim/testBars';
import { kstDate } from '../../../src/lib/time/kst';
import { writeAuth } from '../config';
import { COMMANDS, run } from '../main';
import type { Built } from '../providers';
import { cleanupDirs, makeIo, profileDoc, syncServer } from '../testing';
import { makeSignals } from './signals';

afterEach(() => {
  cleanupDirs();
});

const AUTH = { v: 1 as const, server: 'https://sync.example', token: `gzc_${'A'.repeat(43)}`, tokenId: 't1', label: 'gazua@mac', expiresAt: Date.UTC(2027, 0, 1) };
const ENV = { TOSS_CLIENT_ID: 'toss-client-id-1', TOSS_CLIENT_SECRET: 'toss-client-secret-1' };

function simpleDoc() {
  const d = profileDoc(2) as { strategies: ReturnType<typeof fullStrategyV2>[] };
  const s = d.strategies[0];
  s.rules.buy = [{ conds: [{ kind: 'maPrice', period: 3, side: 'above' }] }];
  s.rules.sell.signal = { on: false, groups: [] };
  return d;
}
const provider = (): MarketDataProvider =>
  ({
    id: 'kis',
    capabilities: { venues: ['KRX'], quoteBatchSize: 1, hasIndexCandles: false, indexMinutePastDays: false },
    getCandles: async (q: { symbol: string; from: string; to: string }) => barsFromCloses([10, 10, 10, 12], '2026-10-27').filter((c) => kstDate(c.t) >= q.from && kstDate(c.t) <= q.to),
    getTradingDays: async () => [],
  }) as unknown as MarketDataProvider;
const built: Built = { id: 'kis', provider: provider(), keyHash: 'kh' };

function setup(argv: string[], env: Record<string, string> = ENV, profiles: Parameters<typeof syncServer>[0] = { p1: { doc: simpleDoc() } }) {
  const t = makeIo({ fetch: syncServer(profiles), env });
  writeAuth(t.dir, AUTH);
  COMMANDS.signals = makeSignals(() => built);
  return { t, argv };
}

describe('gazua signals', () => {
  it('--strategy가 없으면 invalid-args(종료 2)', async () => {
    const { t } = setup(['signals']);
    expect(await run(['signals'], t.io)).toBe(2);
    expect(t.result().error.code).toBe('invalid-args');
  });

  it('전략을 이름으로 찾아 전략 종목(그룹 g0: 005930·000660)의 신호를 낸다', async () => {
    const { t } = setup([]);
    expect(await run(['signals', '--strategy', '골든크로스 추세'], t.io)).toBe(0);
    const d = t.result().data;
    expect(d).toMatchObject({ strategy: '골든크로스 추세', asOf: '2026-10-30', includesToday: false, venue: 'KRX', failed: [] });
    expect(d.signals.map((s: { symbol: string }) => s.symbol)).toEqual(['005930', '000660']);
    expect(d.signals[0]).toEqual({ symbol: '005930', buy: { match: true, reason: '종가 3일선 위', group: 1 }, sell: null });
    expect('holdings' in d).toBe(false);
    expect(d.notes).toContain('보유 기준 판정은 토스만 돼요');
  });

  it('없는 전략은 strategy-not-found', async () => {
    const { t } = setup([]);
    expect(await run(['signals', '--strategy', '없는 전략'], t.io)).toBe(1);
    expect(t.result().error.code).toBe('strategy-not-found');
  });

  it('프로필이 여럿이면 profile-required, --profile로 고른다', async () => {
    const two = { p1: { doc: simpleDoc() }, p2: { doc: { ...simpleDoc(), name: '회사' } } };
    const a = setup([], ENV, two);
    await run(['signals', '--strategy', '골든크로스 추세'], a.t.io);
    expect(a.t.result().error.code).toBe('profile-required');
    const b = setup([], ENV, two);
    expect(await run(['signals', '--strategy', '골든크로스 추세', '--profile', '회사'], b.t.io)).toBe(0);
  });

  it('실제 공급자를 쓰는 기본 명령은 키가 없으면 no-credentials', async () => {
    const t = makeIo({ fetch: syncServer({ p1: { doc: simpleDoc() } }) });
    writeAuth(t.dir, AUTH);
    COMMANDS.signals = makeSignals();
    expect(await run(['signals', '--strategy', '골든크로스 추세'], t.io)).toBe(1);
    expect(t.result().error.code).toBe('no-credentials');
  });

  it('signals는 등록돼 있다', async () => {
    expect(COMMANDS.signals).toBeTypeOf('function');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `corepack pnpm --filter gazua-cli test -- signals orderCache`
Expected: FAIL — `./signals`, `./orderCache`, `./commands/signals`가 없다.

- [ ] **Step 3: 최소 구현**

`cli/src/orderCache.ts`:

```ts
// 토스 주문 이력 파일 캐시. 앱의 src/lib/perf/orderCache.ts처럼 { orders, syncedAt, syncedThrough }를 두고,
// 다음에는 syncedThrough의 7일 전부터만 받아 orderId로 합친다(같은 orderId는 새 것이 이긴다).
// 파일 이름에 키 해시(토스 client ID)와 accountSeq 해시 앞 8자를 넣어 계좌·키가 바뀌면 다른 파일이 된다. 원문 accountSeq는 어디에도 쓰지 않는다.
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import type { AccountOrder, AccountSource } from '../../src/lib/providers/types';
import { addDays, kstDate } from '../../src/lib/time/kst';
import { permissionWarnings, readJsonFile, writeJsonFile } from './config';

export const RESYNC_OVERLAP_DAYS = 7;

interface OrderCacheFile {
  v: 1;
  orders: AccountOrder[];
  syncedAt: number;
  /** 마지막으로 받은 날(KST) */
  syncedThrough: string;
}

export function orderCachePath(dir: string, keyHash: string, accountSeq: string): string {
  return join(dir, `orders-${keyHash}-${createHash('sha256').update(accountSeq).digest('hex').slice(0, 8)}.json`);
}

export async function syncOrders(o: { dir: string; keyHash: string; account: AccountSource; now: number; onSeq?: (seq: string) => void; warn?: (message: string) => void }): Promise<AccountOrder[]> {
  const seq = await o.account.accountId();
  o.onSeq?.(seq);
  const path = orderCachePath(o.dir, o.keyHash, seq);
  for (const w of permissionWarnings(o.dir, [basename(path)])) o.warn?.(w); // 읽기 전에 권한 확인
  const raw = readJsonFile<OrderCacheFile>(path);
  const cached = raw !== null && raw.v === 1 && Array.isArray(raw.orders) && /^\d{4}-\d{2}-\d{2}$/.test(raw.syncedThrough) ? raw : null;
  const fresh = await o.account.closedOrders(cached ? { from: addDays(cached.syncedThrough, -RESYNC_OVERLAP_DAYS) } : undefined);
  const byId = new Map<string, AccountOrder>();
  for (const x of cached?.orders ?? []) byId.set(x.orderId, x);
  for (const x of fresh) byId.set(x.orderId, x);
  const orders = [...byId.values()].sort((a, b) => a.orderedAt.localeCompare(b.orderedAt) || a.orderId.localeCompare(b.orderId));
  writeJsonFile(path, { v: 1, orders, syncedAt: o.now, syncedThrough: kstDate(o.now) } satisfies OrderCacheFile);
  return orders;
}
```

`cli/src/signals.ts`:

```ts
// 신호 계산(스펙 §7). 판정만 하고 주문하지 않으며 주문안도 만들지 않는다(단계 B).
import type { Candle } from '../../src/lib/data/metrics';
import type { Venue } from '../../src/lib/market/tradable';
import { normalizeOrders } from '../../src/lib/perf/ledger';
import type { Trade } from '../../src/lib/perf/types';
import type { AccountOrder, MarketDataProvider } from '../../src/lib/providers/types';
import { createRuleEvaluator, rulesLookback } from '../../src/lib/sim/rules';
import type { CondGroup, Strategy } from '../../src/lib/sim/types';
import { addDays, kstDate, kstMinuteOfDay } from '../../src/lib/time/kst';

/** KST 자정부터의 분. 통합(NXT 포함)은 20:00 */
export const CLOSE_MINUTE: Record<Venue, number> = { KRX: 15 * 60 + 30, NXT: 20 * 60, UNIFIED: 20 * 60 };

export const NOTES = {
  base: ['매매 이력 없이 계산한 조건 신호예요', 'RSI는 기준 봉 앞 250봉에서 시작해요', '보유 중인 종목도 매수 조건을 판정해요'],
  tossOnly: '보유 기준 판정은 토스만 돼요',
  avgAfterScaleIn: '분할 매수가 끝났는지 알 수 없어 손절 가격을 평단으로 계산했어요',
  breakeven: '본전 손절은 1단계 익절 여부를 알 수 없어 판정하지 않아요',
  noSymbols: '전략에 종목이 없어요',
} as const;

const EPS = 1e-9;
const round2 = (x: number) => Math.round(x * 100) / 100;

/** loadSimData와 같은 규칙: venues가 비었거나 KRX가 있으면 KRX, 아니면 첫 venue */
export function pickVenue(provider: Pick<MarketDataProvider, 'capabilities'>): Venue {
  const venues = provider.capabilities.venues;
  return venues.length === 0 || venues.includes('KRX') ? 'KRX' : venues[0];
}

/** 기준 봉의 끝 날짜. --today이고 그 venue 마감 뒤이며 오늘이 거래일일 때만 오늘, 아니면 어제 */
export function windowEnd(o: { now: number; today: boolean; venue: Venue; openToday: boolean }): { to: string; includesToday: boolean } {
  const today = kstDate(o.now);
  const includesToday = o.today && kstMinuteOfDay(o.now) >= CLOSE_MINUTE[o.venue] && o.openToday;
  return { to: includesToday ? today : addDays(today, -1), includesToday };
}

export function warmFrom(to: string, strategy: Strategy): string {
  const lookback = rulesLookback([...strategy.rules.buy, ...(strategy.rules.sell.signal.on ? strategy.rules.sell.signal.groups : [])]);
  return addDays(to, -Math.max(400, Math.ceil(lookback * 1.6)));
}

const validBar = (c: Candle) => [c.o, c.h, c.l, c.c].every((p) => Number.isFinite(p) && p > 0);

export function usableCandles(candles: Candle[], to: string): Candle[] {
  return candles.filter((c) => validBar(c) && kstDate(c.t) <= to).sort((a, b) => a.t - b.t);
}

export interface Judge {
  match: boolean;
  reason?: string;
  group?: number;
}

/** 앞 봉부터 signal→update를 차례로 부르고 idx 봉의 signal을 본다. firstDayIdx는 기준 봉(idx)이다(RSI는 기준 봉 앞 250봉에서 시작) */
export function evaluateAt(candles: Candle[], groups: CondGroup[], idx: number): Judge {
  const ev = createRuleEvaluator(candles, groups, idx);
  let last: ReturnType<typeof ev.signal> = null;
  for (let i = 0; i <= idx; i++) {
    last = ev.signal(i);
    ev.update(i);
  }
  return last ? { match: true, reason: last.reason, group: last.group } : { match: false };
}

/** 전략 종목 s와 토스 코드 code: 토스 ETN 코드는 Q 없는 6자리로 온다 */
export const matchesHolding = (strategySymbol: string, code: string): boolean => strategySymbol === code || strategySymbol === `Q${code}`;

/**
 * 보유 구간 복원용 체결 목록: normalizeOrders로 걸러(KRW·중복) 낸 뒤 실제 체결 시각순으로 다시 정렬한다.
 * normalizeOrders는 같은 날 매수를 매도보다 먼저 두므로 「같은 날 전량 매도 후 재매수」를 거꾸로 읽는다.
 */
export function tradesInFillOrder(orders: AccountOrder[]): Trade[] {
  const at = new Map(orders.map((o) => [o.orderId, Date.parse(o.filledAt ?? o.orderedAt) || Date.parse(o.orderedAt) || 0]));
  return normalizeOrders(orders).trades.sort((a, b) => (at.get(a.orderId) ?? 0) - (at.get(b.orderId) ?? 0) || a.orderId.localeCompare(b.orderId));
}

/** 수량이 0에서 양수가 된 마지막 날과 그날의 첫 매수 체결가. 끝 수량이 보유 수량과 다르면 이력이 모자란 것이라 null */
export function firstBuyOf(trades: Trade[], quantity: number): { date: string; price: number } | null {
  let qty = 0;
  let open: { date: string; price: number } | null = null;
  for (const t of trades) {
    if (t.side === 'BUY') {
      if (qty <= EPS) open = { date: t.date, price: t.price };
      qty += t.qty;
    } else {
      qty -= t.qty;
    }
  }
  return open !== null && Math.abs(qty - quantity) < 1e-6 ? open : null;
}

export type Tri = boolean | 'unknown';
export interface HoldingJudgement {
  symbol: string;
  quantity: number;
  avgPrice: number | null;
  close: number;
  firstBuyDate: string | null;
  stop: { price: number | null; hit: Tri } | null;
  takes: { stage: number; price: number | null; hit: Tri }[];
  /** 익절 단계가 이미 체결됐는지는 모른다 → 모든 단계를 내고 true */
  stagesDoneUnknown: boolean;
  trail: { price: number | null; hit: Tri } | null;
  timeExit: { heldDays: number | null; days: number; hit: Tri } | null;
  /** 본전 손절(1단계 익절 뒤)은 익절 여부를 몰라 판정하지 않는다 */
  breakeven?: { price: number | null; hit: 'unknown' };
  signalSell: Judge | null;
}

export function judgeHolding(i: {
  strategy: Strategy;
  symbol: string;
  quantity: number;
  avgPrice: number | undefined;
  close: number;
  first: { date: string; price: number } | null;
  peakClose: number | null;
  heldDays: number | null;
  signalSell: Judge | null;
}): HoldingJudgement {
  const { stopLoss, takeProfit, trailing, timeExit } = i.strategy.rules.sell;
  const avg = i.avgPrice;
  const down = (base: number | null | undefined, pct: number) => (base == null ? null : round2(base * (1 - pct / 100)));
  const tri = (price: number | null, hit: (p: number) => boolean): Tri => (price === null ? 'unknown' : hit(price));

  let stop: HoldingJudgement['stop'] = null;
  if (stopLoss.on) {
    const price = down(stopLoss.basis === 'firstBuy' ? i.first?.price : avg, stopLoss.pct);
    stop = { price, hit: tri(price, (p) => i.close <= p) };
  }
  const takes = takeProfit.on
    ? takeProfit.stages.map((s, k) => {
        const price = avg == null ? null : round2(avg * (1 + s.pct / 100));
        return { stage: k + 1, price, hit: tri(price, (p) => i.close >= p) };
      })
    : [];
  let trail: HoldingJudgement['trail'] = null;
  if (trailing.on) {
    // 첫 매수일부터의 종가 최고값을 모르면(조회 범위를 못 채움) 트레일은 unknown
    const price = i.first === null || i.peakClose === null ? null : down(Math.max(i.peakClose, i.first.price), trailing.pct);
    trail = { price, hit: tri(price, (p) => i.close <= p) };
  }
  const time = timeExit.on ? { heldDays: i.heldDays, days: timeExit.days, hit: (i.heldDays === null ? 'unknown' : i.heldDays >= timeExit.days) as Tri } : null;
  return {
    symbol: i.symbol,
    quantity: i.quantity,
    avgPrice: avg ?? null,
    close: i.close,
    firstBuyDate: i.first?.date ?? null,
    stop,
    takes,
    stagesDoneUnknown: takes.length > 0,
    trail,
    timeExit: time,
    ...(takeProfit.on && takeProfit.afterFirstTake === 'breakeven' ? { breakeven: { price: avg ?? null, hit: 'unknown' as const } } : {}),
    signalSell: i.signalSell,
  };
}

export interface SymbolSignal {
  symbol: string;
  buy: Judge;
  sell: Judge | null;
  /** 이 종목의 기준 봉이 전체 asOf와 다를 때만(거래정지 등) */
  asOf?: string;
}

export interface SignalsDeps {
  provider: MarketDataProvider;
  strategy: Strategy;
  symbols: string[];
  now: number;
  today: boolean;
  /** 토스: 주문 이력(파일 캐시 포함). 없으면 보유 기준 판정을 하지 않는다 */
  loadOrders?: () => Promise<AccountOrder[]>;
}

export interface SignalsOutput {
  strategy: string;
  asOf: string | null;
  includesToday: boolean;
  venue: Venue;
  signals: SymbolSignal[];
  holdings?: HoldingJudgement[];
  failed: { symbol: string; reason: string }[];
  notes: string[];
}

interface Base {
  candles: Candle[];
  idx: number;
  date: string;
  close: number;
}

export async function runSignals(d: SignalsDeps): Promise<SignalsOutput> {
  const { provider, strategy, symbols, now } = d;
  const venue = pickVenue(provider);
  const todayStr = kstDate(now);
  let openToday = false;
  if (d.today && kstMinuteOfDay(now) >= CLOSE_MINUTE[venue]) {
    openToday = (await provider.getTradingDays(todayStr, todayStr)).some((x) => x.date === todayStr && x.isOpen);
  }
  const { to, includesToday: wanted } = windowEnd({ now, today: d.today, venue, openToday });
  const from = warmFrom(to, strategy);
  const sellOn = strategy.rules.sell.signal.on;

  const fetched = await Promise.all(
    symbols.map(async (symbol) => {
      try {
        return { symbol, candles: usableCandles(await provider.getCandles({ symbol, venue, interval: '1d', from, to, priority: 0 }), to) };
      } catch (error) {
        return { symbol, error };
      }
    }),
  );

  const failed: SignalsOutput['failed'] = [];
  const bases = new Map<string, Base>();
  let firstError: unknown;
  for (const f of fetched) {
    if ('error' in f) {
      failed.push({ symbol: f.symbol, reason: '받지 못했어요' });
      firstError ??= f.error;
    } else if (f.candles.length === 0) {
      failed.push({ symbol: f.symbol, reason: '데이터가 없어요' });
    } else {
      const idx = f.candles.length - 1;
      bases.set(f.symbol, { candles: f.candles, idx, date: kstDate(f.candles[idx].t), close: f.candles[idx].c });
    }
  }
  if (symbols.length > 0 && failed.length === symbols.length && firstError !== undefined) throw firstError; // 연결·키 문제

  const asOf = [...bases.values()].reduce<string | null>((m, b) => (m === null || b.date > m ? b.date : m), null);
  const sells = new Map<string, Judge | null>();
  const signals: SymbolSignal[] = [];
  for (const symbol of symbols) {
    const b = bases.get(symbol);
    if (!b) continue;
    const sell = sellOn ? evaluateAt(b.candles, strategy.rules.sell.signal.groups, b.idx) : null;
    sells.set(symbol, sell);
    signals.push({ symbol, buy: evaluateAt(b.candles, strategy.rules.buy, b.idx), sell, ...(b.date !== asOf ? { asOf: b.date } : {}) });
  }

  const notes: string[] = [...NOTES.base];
  let holdings: HoldingJudgement[] | undefined;
  if (!provider.account || !d.loadOrders) {
    notes.push(NOTES.tossOnly);
  } else {
    const held = await provider.account.holdings();
    const matched = symbols.flatMap((s) => {
      const h = held.find((x) => matchesHolding(s, x.symbol));
      return h && bases.has(s) ? [{ s, h }] : [];
    });
    holdings = [];
    if (matched.length > 0) {
      const trades = tradesInFillOrder(await d.loadOrders());
      for (const { s, h } of matched) {
        const b = bases.get(s)!;
        const first = firstBuyOf(trades.filter((t) => matchesHolding(s, t.symbol)), h.quantity);
        let peakClose: number | null = null;
        let heldDays: number | null = null;
        if (first) {
          // 첫 매수일이 받아 둔 범위보다 앞이면 그 날부터 다시 받는다. 첫 매수일 근처부터 확보하지 못하면 최고값을 모른다(트레일 unknown)
          let all = b.candles;
          if (first.date < from) {
            try {
              all = usableCandles(await provider.getCandles({ symbol: s, venue, interval: '1d', from: first.date, to, priority: 0 }), to);
            } catch {
              all = [];
            }
          }
          const covered = all.length > 0 && kstDate(all[0].t) <= addDays(first.date, 7);
          const closes = all.filter((c) => kstDate(c.t) >= first.date && kstDate(c.t) <= b.date).map((c) => c.c);
          peakClose = !covered ? null : closes.length ? Math.max(...closes) : first.price;
          heldDays = first.date > b.date ? 0 : (await provider.getTradingDays(first.date, b.date)).filter((x) => x.isOpen).length;
        }
        holdings.push(judgeHolding({ strategy, symbol: s, quantity: h.quantity, avgPrice: h.avgPrice, close: b.close, first, peakClose, heldDays, signalSell: sells.get(s) ?? null }));
      }
    }
    const { stopLoss, takeProfit } = strategy.rules.sell;
    if (stopLoss.on && stopLoss.basis === 'avgAfterScaleIn') notes.push(NOTES.avgAfterScaleIn);
    if (takeProfit.on && takeProfit.afterFirstTake === 'breakeven') notes.push(NOTES.breakeven);
  }
  if (symbols.length === 0) notes.push(NOTES.noSymbols);

  return {
    strategy: strategy.name,
    asOf,
    includesToday: wanted && asOf === todayStr,
    venue,
    signals,
    ...(holdings ? { holdings } : {}),
    failed,
    notes,
  };
}
```

`cli/src/commands/signals.ts`:

```ts
import { resolveSymbols } from '../../../src/lib/sim/validate';
import type { Command } from '../context';
import { chooseProvider, readCreds } from '../env';
import { CliError } from '../errors';
import { syncOrders } from '../orderCache';
import { findStrategy, pickProfile } from '../profileData';
import { buildProvider } from '../providers';
import { authedClient } from '../session';
import { runSignals } from '../signals';

/** 테스트가 공급자 조립을 바꿔 끼울 수 있게 팩토리로 둔다 */
export function makeSignals(build: typeof buildProvider = buildProvider): Command {
  return async (ctx) => {
    const ref = ctx.args.strategy;
    if (!ref) throw new CliError('invalid-args', '--strategy <이름|ID>가 필요해요');
    const profile = await pickProfile(authedClient(ctx), ctx.args.profile, ctx.now());
    const strategy = findStrategy(profile.strategies, ref);
    const creds = readCreds(ctx.env);
    const built = build(ctx, chooseProvider(creds, ctx.args.provider), creds);
    const account = built.provider.account;
    return runSignals({
      provider: built.provider,
      strategy,
      symbols: resolveSymbols(strategy, profile.watchlists),
      now: ctx.now(),
      today: ctx.args.today,
      ...(account
        ? { loadOrders: () => syncOrders({ dir: ctx.dir, keyHash: built.keyHash, account, now: ctx.now(), onSeq: (seq) => ctx.redact.add(seq), warn: ctx.warn }) }
        : {}),
    });
  };
}

export const signals: Command = makeSignals();
```

`cli/src/main.ts`:

```ts
import { signals } from './commands/signals';
```

```ts
export const COMMANDS: Record<string, Command> = {
  login,
  logout,
  profiles,
  watchlists,
  strategies,
  quote,
  holdings,
  signals,
};
```

- [ ] **Step 4: 통과 확인**

Run: `corepack pnpm --filter gazua-cli test && corepack pnpm --filter gazua-cli check && corepack pnpm --filter gazua-cli build`
Expected: PASS. 확인할 점: (1) `evaluateAt` 테스트의 모든 idx(280~319)에서 수동 루프와 같다. (2) `runSignals`의 토스 예시 테스트에서 `heldDays`가 테스트 안 계산(`tradingDates('2026-09-02', 100)`에서 `<= '2026-10-30'`)과 같다. (3) `commands/signals.test.ts`는 `COMMANDS.signals`를 바꿔 끼우므로 파일 안에서만 쓰고, 다른 파일의 테스트는 별도 프로세스(vitest 파일 격리)라 영향이 없다. 번들 검사에서 `window.` 등이 걸리면 Task 8 Step 5의 지침대로 끌려온 모듈을 고친다.

- [ ] **Step 5: 커밋**

```bash
git add cli
git commit -m "feat(cli): signals(조건 신호·보유 기준 매도 판정)와 토스 주문 이력 캐시를 더함"
```

---

## Task 13: `gazua simulate` — 시뮬레이션 요약

**Files:**
- Create: `cli/src/commands/simulate.ts`, `cli/src/commands/simulate.test.ts`
- Modify: `cli/src/main.ts`(import, `COMMANDS`)

**Interfaces:**
- Consumes: `loadSimData`·`createSimMemo`(`src/lib/sim/loadSimData.ts`), `simulate`(`src/lib/sim/simulate.ts`), `resolveSymbols`, Task 10의 `pickProfile`·`findStrategy`, Task 11의 `buildProvider`, `toCliError`.
- Produces:
  ```ts
  export function makeSimulate(build?: typeof buildProvider): Command;
  export const simulateCmd: Command;   // makeSimulate(), COMMANDS.simulate
  ```
  - `data` = `{ strategy, period: { from, to }, venue, summary: { totalReturnPct, cagrPct, mddPct, winRatePct, roundTrips, openPositions } | null, benchmarks: { holdReturnPct, indexReturnPct, benchmarkReturnPct } | null, perSymbol: [{ symbol, pnl, roundTrips }], failed: [{ symbol, name?, reason }], notes: string[] }`. 퍼센트는 소수 둘째 자리로 반올림(`null`은 그대로). `period`는 실제 거래일 축의 처음·끝 날짜. 기간은 전략의 `period`, `--from`·`--to`로 바꾼다(`from > to`면 `invalid-args`). 받을 데이터가 없으면 `summary: null`과 `notes: ['기간 안에 데이터가 없어요']`.

- [ ] **Step 1: 실패하는 테스트 쓰기**

`cli/src/commands/simulate.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../../src/lib/providers/errors';
import type { MarketDataProvider, StockMeta } from '../../../src/lib/providers/types';
import { createSimMemo, loadSimData } from '../../../src/lib/sim/loadSimData';
import { simulate } from '../../../src/lib/sim/simulate';
import { randomWalk } from '../../../src/lib/sim/testInputs';
import { tradingDates } from '../../../src/lib/sim/testBars';
import { fullStrategyV2 } from '../../../src/lib/sim/testStrategyV2';
import type { Strategy } from '../../../src/lib/sim/types';
import { kstDate } from '../../../src/lib/time/kst';
import { writeAuth } from '../config';
import { COMMANDS, run } from '../main';
import type { Built } from '../providers';
import { cleanupDirs, makeIo, profileDoc, syncServer } from '../testing';
import { makeSimulate } from './simulate';

afterEach(cleanupDirs);

const AUTH = { v: 1 as const, server: 'https://sync.example', token: `gzc_${'A'.repeat(43)}`, tokenId: 't1', label: 'gazua@mac', expiresAt: Date.UTC(2027, 0, 1) };
const DATES = tradingDates('2022-01-03', 1240);
const WALKS: Record<string, ReturnType<typeof randomWalk>> = { '005930': randomWalk(DATES, 11), '000660': randomWalk(DATES, 22), KOSPI: randomWalk(DATES, 33) };

function simpleStrategy(): Strategy {
  const s = fullStrategyV2();
  s.rules.buy = [{ conds: [{ kind: 'maCross', short: 5, long: 20, dir: 'golden' }] }];
  s.rules.sell.signal = { on: true, groups: [{ conds: [{ kind: 'maCross', short: 5, long: 20, dir: 'dead' }] }] };
  s.benchmarks = { index: 'KOSPI', symbol: null };
  return s;
}
const doc = () => ({ ...profileDoc(2), strategies: [simpleStrategy()] });

function stubProvider(over: Partial<MarketDataProvider> = {}): MarketDataProvider {
  const meta = (symbol: string): StockMeta => ({ symbol, name: symbol === '005930' ? '삼성전자' : 'SK하이닉스', market: 'KOSPI', securityType: 'STOCK', nxtSupported: false, krxSuspended: false, nxtSuspended: null, liquidationTrading: false });
  return {
    id: 'kis',
    capabilities: { venues: ['KRX'], quoteBatchSize: 1, hasIndexCandles: true, indexMinutePastDays: false },
    getStockMeta: async (symbols: string[]) => symbols.filter((s) => WALKS[s]).map(meta),
    getCandles: async (q: { symbol: string; from: string; to: string }) => (WALKS[q.symbol] ?? []).filter((c) => kstDate(c.t) >= q.from && kstDate(c.t) <= q.to),
    getIndexCandles: async (_i: string, _iv: string, from: string, to: string) => WALKS.KOSPI.filter((c) => kstDate(c.t) >= from && kstDate(c.t) <= to),
    getTradingDays: async () => [],
    ...over,
  } as unknown as MarketDataProvider;
}
const built = (over: Partial<MarketDataProvider> = {}): Built => ({ id: 'kis', provider: stubProvider(over), keyHash: 'kh' });

function setup(b: Built = built()) {
  const t = makeIo({ fetch: syncServer({ p1: { doc: doc() } }), env: { KIS_APP_KEY: 'k', KIS_APP_SECRET: 's' } });
  writeAuth(t.dir, AUTH);
  COMMANDS.simulate = makeSimulate(() => b);
  return t;
}
const r2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);

describe('gazua simulate', () => {
  it('앱과 같은 loadSimData → simulate의 요약을 낸다', async () => {
    const t = setup();
    expect(await run(['simulate', '--strategy', '골든크로스 추세'], t.io)).toBe(0);
    const d = t.result().data;
    // 같은 입력으로 앱 엔진을 직접 돌린 기대값
    const strategy = simpleStrategy();
    const out = await loadSimData({ provider: stubProvider(), strategy, symbols: ['005930', '000660'], now: t.clock.now, memo: createSimMemo(), onProgress: () => {}, isCancelled: () => false });
    if (!out.ok) throw new Error('loadSimData 실패');
    const want = simulate(out.input);
    expect(d.strategy).toBe('골든크로스 추세');
    expect(d.venue).toBe('KRX 일봉');
    expect(d.period).toEqual({ from: out.input.days[0], to: out.input.days[out.input.days.length - 1] });
    expect(d.summary).toEqual({
      totalReturnPct: r2(want.summary.totalReturnPct),
      cagrPct: r2(want.summary.cagrPct),
      mddPct: r2(want.summary.mddPct),
      winRatePct: r2(want.summary.winRatePct),
      roundTrips: want.summary.roundTrips,
      openPositions: want.summary.openPositions,
    });
    expect(d.benchmarks).toEqual({ holdReturnPct: r2(want.benchmarks.holdReturnPct), indexReturnPct: r2(want.benchmarks.indexReturnPct), benchmarkReturnPct: null });
    expect(d.perSymbol).toEqual(want.perSymbol.map((p) => ({ symbol: p.symbol, pnl: p.pnl, roundTrips: p.roundTrips })));
    expect(d.failed).toEqual([]);
    expect(want.summary.roundTrips).toBeGreaterThan(0); // 입력이 의미 있는 거래를 만든다
  });

  it('--from/--to로 기간을 바꾼다. from이 to보다 뒤면 invalid-args', async () => {
    const t = setup();
    await run(['simulate', '--strategy', '골든크로스 추세', '--from', '2024-01-02', '--to', '2024-12-30'], t.io);
    const p = t.result().data.period;
    expect(p.from >= '2024-01-02' && p.from <= '2024-01-10').toBe(true);
    expect(p.to <= '2024-12-30' && p.to >= '2024-12-20').toBe(true);
    const u = setup();
    expect(await run(['simulate', '--strategy', '골든크로스 추세', '--from', '2025-01-01', '--to', '2024-01-01'], u.io)).toBe(2);
    expect(u.result().error.code).toBe('invalid-args');
  });

  it('받지 못한 종목은 failed로 낸다', async () => {
    const t = setup(built({ getStockMeta: async (symbols: string[]) => symbols.filter((s) => s === '005930').map((s) => ({ symbol: s, name: '삼성전자', market: 'KOSPI', securityType: 'STOCK', nxtSupported: false, krxSuspended: false, nxtSuspended: null, liquidationTrading: false }) as StockMeta) }));
    await run(['simulate', '--strategy', '골든크로스 추세'], t.io);
    expect(t.result().data.failed).toEqual([{ symbol: '000660', reason: '종목 정보를 받지 못했어요' }]);
    expect(t.result().data.perSymbol.map((p: { symbol: string }) => p.symbol)).toEqual(['005930']);
  });

  it('기간 안에 데이터가 없으면 summary: null과 notes', async () => {
    const t = setup(built({ getCandles: async () => [], getIndexCandles: async () => [] }));
    expect(await run(['simulate', '--strategy', '골든크로스 추세'], t.io)).toBe(0);
    expect(t.result().data).toMatchObject({ summary: null, benchmarks: null, perSymbol: [], notes: ['기간 안에 데이터가 없어요'] });
  });

  it('연결 문제(첫 요청부터 실패)는 CLI 오류 코드로 낸다', async () => {
    const t = setup(built({ getStockMeta: async () => Promise.reject(new ApiError('proxy-unreachable')) }));
    expect(await run(['simulate', '--strategy', '골든크로스 추세'], t.io)).toBe(1);
    expect(t.result().error.code).toBe('network');
  });

  it('--strategy가 없으면 invalid-args, 없는 전략은 strategy-not-found', async () => {
    const a = setup();
    expect(await run(['simulate'], a.io)).toBe(2);
    const b = setup();
    await run(['simulate', '--strategy', '없는 전략'], b.io);
    expect(b.result().error.code).toBe('strategy-not-found');
  });
});
```

(`venue`는 앱의 `loadSimData`가 주는 라벨(`'KRX 일봉'`/`'통합 일봉'`)을 그대로 쓴다.)

- [ ] **Step 2: 실패 확인**

Run: `corepack pnpm --filter gazua-cli test -- simulate`
Expected: FAIL — `./simulate`를 찾을 수 없다.

- [ ] **Step 3: 최소 구현**

`cli/src/commands/simulate.ts`:

```ts
import { createSimMemo, loadSimData } from '../../../src/lib/sim/loadSimData';
import { simulate } from '../../../src/lib/sim/simulate';
import { resolveSymbols } from '../../../src/lib/sim/validate';
import type { Command } from '../context';
import { chooseProvider, readCreds } from '../env';
import { CliError, toCliError } from '../errors';
import { findStrategy, pickProfile } from '../profileData';
import { buildProvider } from '../providers';
import { authedClient } from '../session';

const r2 = (n: number | null): number | null => (n === null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);
const NO_DATA = '기간 안에 데이터가 없어요';

/** 앱과 같은 loadSimData → simulate를 쓴다. 테스트가 공급자 조립을 바꿔 끼울 수 있게 팩토리로 둔다 */
export function makeSimulate(build: typeof buildProvider = buildProvider): Command {
  return async (ctx) => {
    const ref = ctx.args.strategy;
    if (!ref) throw new CliError('invalid-args', '--strategy <이름|ID>가 필요해요');
    const profile = await pickProfile(authedClient(ctx), ctx.args.profile, ctx.now());
    const base = findStrategy(profile.strategies, ref);
    const period = { from: ctx.args.from ?? base.period.from, to: ctx.args.to ?? base.period.to };
    if (period.from > period.to) throw new CliError('invalid-args', '--from이 --to보다 뒤예요');
    const strategy = { ...base, period };
    const symbols = resolveSymbols(strategy, profile.watchlists);
    const creds = readCreds(ctx.env);
    const { provider } = build(ctx, chooseProvider(creds, ctx.args.provider), creds);

    const empty = (failed: { symbol: string; name?: string; reason: string }[]) => ({
      strategy: strategy.name,
      period,
      summary: null,
      benchmarks: null,
      perSymbol: [] as never[],
      failed,
      notes: [NO_DATA],
    });
    if (symbols.length === 0) return empty([]);

    const out = await loadSimData({ provider, strategy, symbols, now: ctx.now(), memo: createSimMemo(), onProgress: () => {}, isCancelled: () => false });
    if (!out.ok) {
      if ('noData' in out) return empty(out.failed.map((f) => ({ symbol: f.symbol, ...(f.name ? { name: f.name } : {}), reason: f.reason })));
      if ('error' in out) throw toCliError(out.error); // 첫 요청(메타)부터 실패 = 연결 문제
      throw new CliError('internal');
    }
    const result = simulate(out.input);
    const days = out.input.days;
    const s = result.summary;
    const notes: string[] = [];
    if (out.indexFailed) notes.push(`지수 비교를 못 했어요(${out.indexFailed})`);
    if (out.benchmarkFailed) notes.push('지정 종목 비교를 못 했어요');
    return {
      strategy: strategy.name,
      period: { from: days[0], to: days[days.length - 1] },
      venue: out.venueLabel,
      summary: { totalReturnPct: r2(s.totalReturnPct), cagrPct: r2(s.cagrPct), mddPct: r2(s.mddPct), winRatePct: r2(s.winRatePct), roundTrips: s.roundTrips, openPositions: s.openPositions },
      benchmarks: { holdReturnPct: r2(result.benchmarks.holdReturnPct), indexReturnPct: r2(result.benchmarks.indexReturnPct), benchmarkReturnPct: r2(result.benchmarks.benchmarkReturnPct) },
      perSymbol: result.perSymbol.map((p) => ({ symbol: p.symbol, pnl: p.pnl, roundTrips: p.roundTrips })),
      failed: out.failed.map((f) => ({ symbol: f.symbol, ...(f.name ? { name: f.name } : {}), reason: f.reason })),
      notes,
    };
  };
}

export const simulateCmd: Command = makeSimulate();
```

`cli/src/main.ts`:

```ts
import { simulateCmd } from './commands/simulate';
```

```ts
export const COMMANDS: Record<string, Command> = {
  login,
  logout,
  profiles,
  watchlists,
  strategies,
  quote,
  holdings,
  signals,
  simulate: simulateCmd,
};
```

- [ ] **Step 4: 통과 확인**

Run: `corepack pnpm --filter gazua-cli test && corepack pnpm --filter gazua-cli check && corepack pnpm --filter gazua-cli build`
Expected: PASS. (`gazua simulate`의 기대 출력은 앱 엔진과 같은 입력으로 계산한 값이라, 값이 다르면 CLI가 엔진에 넘기는 입력(`strategy.period`, `symbols`, `now`)부터 의심한다. 입력 데이터 `randomWalk`가 거래를 하나도 못 만들어 `roundTrips`가 0이면 시드나 이동평균 기간을 바꿔 거래가 생기게 한다.)

- [ ] **Step 5: 커밋**

```bash
git add cli
git commit -m "feat(cli): simulate 명령(앱과 같은 loadSimData·simulate 요약)을 더함"
```

---

## Task 14: README(사용법·토스 키 분리 경고·배포 순서)와 전체 검증

**Files:**
- Create: `cli/README.md`
- Create(테스트): `cli/src/readme.test.ts`
- Modify: `sync-worker/README.md`(HTTP 계약 표 윗문단과 표, 새 배포 절)

**Interfaces:**
- Consumes: 앞 Task의 명령·오류 코드·환경변수 이름.
- Produces: 사용자가 읽을 문서. `readme.test.ts`가 스펙 §9 6번의 필수 문구를 확인한다.

- [ ] **Step 1: 실패하는 테스트 쓰기**

`cli/src/readme.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from './errors';
import { COMMANDS } from './main';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const readme = read('../README.md');
const workerReadme = read('../../sync-worker/README.md');

describe('cli/README.md', () => {
  it('토스 키 분리 경고와 토스 허용 IP 등록 안내가 있다', () => {
    expect(readme).toContain('CLI용 토스 앱을 따로 만드세요. 앱과 같은 토스 키를 쓰면 토큰이 서로 무효가 돼요');
    expect(readme).toContain('허용 IP');
  });

  it('환경변수 이름과 옵션이 모두 적혀 있다', () => {
    for (const name of ['KIS_APP_KEY', 'KIS_APP_SECRET', 'TOSS_CLIENT_ID', 'TOSS_CLIENT_SECRET', 'GAZUA_SYNC_URL', 'XDG_CONFIG_HOME', '--env-file', '--profile', '--provider', '--strategy', '--today', '--from', '--to', '--raw', '--pretty', '--verbose', '--server', '--label']) {
      expect(readme, name).toContain(name);
    }
  });

  it('등록된 모든 명령과 모든 오류 코드가 표에 있다', () => {
    for (const name of Object.keys(COMMANDS)) expect(readme, `gazua ${name}`).toContain(`gazua ${name}`);
    for (const code of Object.keys(MESSAGES)) expect(readme, code).toContain(`\`${code}\``);
  });

  it('배포 순서(병합 → 0005 → CLI_IP_SALT → Worker 배포)가 있다', () => {
    const order = ['병합', '0005_cli.sql', 'CLI_IP_SALT', 'wrangler deploy'].map((s) => readme.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('읽기 전용(주문 없음)과 비밀값 출력 금지를 밝힌다', () => {
    expect(readme).toContain('주문');
    expect(readme).toContain('[숨김]');
  });
});

describe('sync-worker/README.md', () => {
  it('CLI 경로와 0005, CLI_IP_SALT를 적는다', () => {
    for (const s of ['/v1/cli/device', '/v1/cli/token', '/v1/cli/approve', '/v1/cli/tokens', '0005_cli.sql', 'CLI_IP_SALT', 'Gazua-CLI']) expect(workerReadme, s).toContain(s);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `corepack pnpm --filter gazua-cli test -- readme`
Expected: FAIL — `cli/README.md`가 없어 `ENOENT`.

- [ ] **Step 3: 문서 쓰기**

`cli/README.md`(아래 내용 그대로. 오류 코드 표는 `MESSAGES`의 키 전체를 백틱으로 적는다):

````markdown
# gazua CLI (읽기 전용)

터미널 AI 도구가 가즈아의 데이터를 읽고 계산하게 해 주는 명령줄 도구예요. 앱과 같은 엔진·같은 데이터를 쓰고, 출력은 JSON 한 줄이에요.

- 읽을 수 있는 것: 동기화한 프로필·관심 그룹·전략, 증권사 시세, 토스 보유, 전략 신호, 시뮬레이션 요약.
- 할 수 없는 것: **주문**과 모든 쓰기. 서버(Worker)는 CLI 토큰으로 `GET /v1/profiles`, `GET /v1/profiles/:id?docVersion=2`, 자기 토큰 철회만 받아요. 증권사 호출도 프록시와 같은 허용 목록(`proxy/src/allowlist.ts`)으로 주문 경로를 막아요. 주문·MCP는 다음 단계예요.

## 설치

저장소에서 빌드해서 써요. npm으로 배포하지 않아요. Node 22 이상이 필요해요.

```bash
corepack pnpm install
VITE_SYNC_API_URL=https://sync.example corepack pnpm --filter gazua-cli build   # 기본 서버 주소를 넣어 빌드(선택)
node cli/dist/gazua.mjs profiles      # 로그인 뒤. 또는
corepack pnpm --filter gazua-cli link --global   # 이후 `gazua`로 실행
```

## 로그인

```bash
gazua login [--label <이름>] [--server <주소>]
```

서버 주소는 `--server` > `GAZUA_SYNC_URL` > 빌드에 넣은 기본값 순서로 정해요. `https`만 받아요(로컬 개발의 `localhost`만 `http`).

터미널이 `XXXX-XXXX` 코드를 보여 주면, 앱의 **설정 › 동기화·공유 › CLI 연결**에 코드를 넣어요(10분 안에). 앱이 요청한 CLI 이름·시각·위치를 보여 주고, 직접 실행한 명령에서 나온 코드만 승인하라고 안내해요. 로그인은 사람이 앱에서 승인해야 끝나서 AI 도구가 대신 할 수 없어요. 토큰은 90일 동안 유효하고, 앱의 **로그인한 기기 › CLI**에서 언제든 끊을 수 있어요.

```bash
gazua logout     # 서버에서 이 토큰을 끊고 ~/.config/gazua/auth.json을 지워요
```

## 증권사 키

키는 환경변수나 `--env-file`로만 받고 파일에 쓰지 않아요.

| 환경변수 | 쓰임 |
|---|---|
| `KIS_APP_KEY`, `KIS_APP_SECRET` | 한국투자증권 |
| `TOSS_CLIENT_ID`, `TOSS_CLIENT_SECRET` | 토스증권 |

`--provider kis|toss`를 주지 않으면 키가 있는 쪽을 쓰고, 둘 다 있으면 `toss`예요.

**CLI용 토스 앱을 따로 만드세요. 앱과 같은 토스 키를 쓰면 토큰이 서로 무효가 돼요.** 토스는 같은 앱(client ID)으로 새 토큰을 받으면 앞 토큰이 무효가 될 수 있어서, 가즈아 앱과 CLI가 같은 키를 쓰면 서로의 토큰을 계속 무효로 만들어요. 토스 개발자 콘솔에서 CLI용 앱을 하나 더 만들어 다른 client ID·secret을 쓰세요(콘솔에서 앱을 여러 개 만들 수 있는지는 확인이 필요해요).

토스는 **허용 IP**에서만 받아요. CLI를 쓰는 기기의 공인 IP를 토스 개발자 콘솔에 등록하세요. 막히면 `ip-not-allowed`가 나와요.

같은 기기에서 CLI를 여러 개 동시에 돌려도 토큰 발급은 `~/.config/gazua/<공급자>.lock` 파일 잠금으로 한 번에 하나씩만 해요.

## 명령

공통 옵션: `--profile <이름|ID>`, `--pretty`(들여쓴 JSON), `--verbose`(진행 로그를 표준 오류로), `--env-file <경로>`. 프로필이 여럿인데 `--profile`이 없으면 `profile-required`와 목록이 나와요.

| 명령 | 하는 일 | 동기화 | 증권사 |
|---|---|---|---|
| `gazua login` | 기기 코드로 로그인 | ○ | |
| `gazua logout` | 서버 토큰 철회 + 파일 삭제 | ○ | |
| `gazua profiles` | 프로필 목록(ID·이름·리비전·그룹·전략 수) | ○ | |
| `gazua watchlists` | 관심 그룹과 종목 | ○ | |
| `gazua strategies [--raw]` | 전략 목록과 규칙 요약(`--raw`면 원 규칙도) | ○ | |
| `gazua quote <종목…>` | 현재가 | | ○ |
| `gazua holdings` | 토스 국내 보유(수량·평단) | | 토스 |
| `gazua signals --strategy <이름\|ID> [--today]` | 조건 신호 + (토스) 보유 기준 매도 판정 | ○ | ○ |
| `gazua simulate --strategy <이름\|ID> [--from YYYY-MM-DD --to YYYY-MM-DD]` | 시뮬레이션 요약 | ○ | ○ |

`signals`의 기준 봉은 마지막 완성 일봉이에요. `--today`가 없으면 어제까지, `--today`면 그 venue 마감 뒤(KRX 15:30·통합 20:00 KST)이고 오늘이 거래일일 때만 오늘까지예요. 토스는 통합 일봉이라 늘 20:00 기준이에요. 판정은 매수·매도 조건과 손절·익절·트레일링·기간 청산 가격만 계산하고 주문하지 않아요. 앱의 시뮬레이션과 다른 점은 출력의 `notes`에 적혀 있어요.

## 출력

표준 출력에는 JSON 한 줄만 나와요. 진행 안내는 표준 오류예요.

```json
{"ok":true,"data":{"provider":"toss","holdings":[{"symbol":"005930","name":"삼성전자","quantity":10,"avgPrice":68500}]}}
{"ok":false,"error":{"code":"profile-required","message":"프로필이 여럿이에요. --profile로 골라 주세요"},"data":{"profiles":[{"id":"9b1c…","name":"내 프로필"}]}}
```

종료 코드: 성공 0, `ok:false` 1, 인자 오류 2. 경고가 있으면 최상위 `warnings` 배열에 담겨요. 증권사 키·접근 토큰·CLI 토큰·기기 코드·계좌 번호(`accountSeq`)는 출력에 나오지 않고 `[숨김]`으로 바뀌어요.

## 오류 코드

| 코드 | 언제 |
|---|---|
| `invalid-args` | 인자·옵션이 틀림(종료 코드 2) |
| `not-logged-in` | `gazua login`을 안 함 |
| `cli-token-revoked`, `cli-token-expired` | 앱에서 끊었거나 90일이 지남 → 다시 로그인 |
| `cli-scope` | 서버가 읽기 전용 밖이라 거절 |
| `not-allowed` | 허용 목록에서 빠진 사용자 |
| `server-outdated` | 서버(Worker)가 CLI를 아직 지원하지 않음 |
| `login-expired`, `login-denied` | 로그인 코드 만료·앱에서 거절 |
| `rate-limited` | 서버·증권사가 너무 많은 요청이라고 답함 |
| `network` | 연결 실패 |
| `profile-required`, `profile-not-found` | 프로필 선택 필요·없음 |
| `strategy-not-found`, `ambiguous-strategy` | 전략을 못 찾음·같은 이름이 여럿 |
| `no-credentials` | 증권사 키 환경변수가 없음 |
| `provider-unsupported` | 그 공급자로 안 되는 명령(예: KIS로 `holdings`) |
| `path-blocked` | 허용 목록 밖 증권사 경로(버그 방어) |
| `ip-not-allowed`, `invalid-credentials`, `token-throttled`, `token-contended`, `upstream`, `timeout` | 증권사 오류 그대로 |
| `token-busy` | 같은 기기의 다른 gazua 실행이 쥔 토큰 잠금을 30초 안에 얻지 못함 |
| `app-outdated` | 서버 문서가 이 CLI보다 새로움 → CLI 업데이트 |
| `internal` | 그 밖 |

## 저장 파일

`~/.config/gazua/`(`XDG_CONFIG_HOME`이 있으면 `$XDG_CONFIG_HOME/gazua/`). 디렉터리 700, 파일 600이에요. 권한이 더 넓으면 `warnings`로 알려요.

| 파일 | 내용 |
|---|---|
| `auth.json` | 서버 주소와 CLI 토큰 |
| `tokens-kis.json`, `tokens-toss.json` | 증권사 접근 토큰 캐시(공급자마다 하나, 키 해시·발급 시각 포함, 키 원문 없음) |
| `kis.lock`, `toss.lock` | 토큰 발급 잠금 |
| `orders-<키 해시>-<계좌 해시>.json` | 토스 주문 이력 캐시(`signals`의 첫 매수일 계산용) |

## 배포 순서 (관리자)

1. 변경을 `main`에 **병합**해요.
2. D1에 `0005_cli.sql`을 적용해요: `corepack pnpm --filter sync-worker migrate:remote`.
3. 시크릿 `CLI_IP_SALT`(32바이트 무작위)를 넣어요: `corepack pnpm --filter sync-worker exec wrangler secret put CLI_IP_SALT`. 이 값이 없으면 `gazua login`이 `server-outdated`로 끝나요(서버가 503 `cli-disabled`).
4. Worker를 배포해요: `corepack pnpm --filter sync-worker run deploy`(= `wrangler deploy`).

앱이 Worker보다 먼저 나가면 CLI 연결 화면이 「서버 업데이트가 필요해요」를 보여 줘요. 다른 동작은 그대로예요.
````

`sync-worker/README.md`를 고친다.

1. `## HTTP 계약` 바로 아래 첫 문단의 첫 문장을 바꾼다.

기존: `모든 요청은 `Origin`이 `ALLOWED_ORIGINS`와 정확히 같아야 해요. 다르면 `403 origin`이에요.` 
새 문장(뒤 문장들은 그대로 둔다):

```markdown
앱 요청은 `Origin`이 `ALLOWED_ORIGINS`와 정확히 같아야 해요. 다르면 `403 origin`이에요. 읽기 전용 CLI는 `Origin`을 보내지 않으므로, **`Origin` 헤더가 아예 없고** `POST /v1/cli/device`·`POST /v1/cli/token`이거나 `Authorization: Gazua-CLI <토큰>`이 있는 요청만 CLI 경로로 받아요(그 밖의 `Origin` 없는 요청은 계속 `403 origin`).
```

2. HTTP 계약 표 마지막 행(`DELETE /v1/keys`) 아래에 행을 더한다.

```markdown
| `POST /v1/cli/device` | CLI용. 무인증(IP·전체 횟수 제한). `{ label }` → `{ deviceCode, userCode, verifyUrl, interval: 5, expiresIn: 600 }`. 시크릿 `CLI_IP_SALT`가 없으면 `503 cli-disabled` |
| `POST /v1/cli/token` | CLI용. `{ deviceCode }` → `400 pending`·`400 slow_down`·`403 denied`·`410 expired`·`404 unknown-device`, 승인되면 `{ token, tokenId, expiresAt }`를 **한 번만** 줘요 |
| `POST /v1/cli/approve` | 앱 세션. `{ userCode }`는 조회(상태 그대로, `{ label, createdAt, geo }`), `{ userCode, approve }`는 승인·거절. 코드가 맞지 않으면 `422 invalid-code` |
| `GET /v1/cli/tokens`, `DELETE /v1/cli/tokens/:id` | 앱 세션. 살아 있는 CLI 토큰 목록과 철회 |
| CLI 토큰(`Authorization: Gazua-CLI <토큰>`) | `GET /v1/profiles`, `GET /v1/profiles/:id?docVersion=2`, `DELETE /v1/cli/token`(자기 토큰 철회)만 통과해요. 그 밖은 라우터 전에 `403 cli-scope`예요. 토큰은 90일 고정이고 D1에는 해시만 둬요 |
```

3. `## 무료 한도 아끼기` 위에 새 절을 더한다.

```markdown
## 읽기 전용 CLI 배포 (`0005_cli.sql`, `CLI_IP_SALT`)

설계: `docs/superpowers/specs/2026-11-01-readonly-cli-design.md`. 순서는 **병합 → 마이그레이션 → 시크릿 → Worker 배포**예요.

1. 병합 뒤 마이그레이션: `corepack pnpm --filter sync-worker migrate:remote`. `0005_cli.sql`이 `cli_grants`·`cli_tokens` 표를 더해요(표만 더해서 지금 Worker·앱은 영향이 없어요).
2. 시크릿: `corepack pnpm --filter sync-worker exec wrangler secret put CLI_IP_SALT`에 32바이트 무작위 값을 넣어요(예: `openssl rand -base64 32`). 요청 IP를 이 값으로 HMAC-SHA256한 해시만 저장하고 원 IP는 저장하지 않아요. 값이 없으면 `POST /v1/cli/device`가 `503 cli-disabled`예요.
3. Worker 배포: `corepack pnpm --filter sync-worker run deploy`.
4. 확인: 앱의 설정 › 동기화·공유 › CLI 연결에 `gazua login` 코드를 넣어 승인되는지 봐요. 승인 대기(`cli_grants`)는 만료 하루 뒤, 토큰(`cli_tokens`)은 만료·철회 30일 뒤 Cron이 지워요.

무료 한도: 로그인 1회는 요청 약 125건·D1 쓰기 약 125행이고, 명령 1회는 프로필 목록 1 + 문서 N 요청이에요. 숫자는 Cloudflare 공개 요금표 기준이라 배포 전 계정 화면에서 다시 확인하세요.
```

- [ ] **Step 4: 통과 확인**

Run: `corepack pnpm --filter gazua-cli test -- readme`
Expected: PASS.

- [ ] **Step 5: 전체 검증**

Run(차례로, 모두 통과해야 한다):

```bash
corepack pnpm test
corepack pnpm check
(cd sync-worker && npx vitest run && npx tsc -p tsconfig.json --noEmit)
corepack pnpm --filter gazua-cli test
corepack pnpm --filter gazua-cli check
corepack pnpm --filter gazua-cli build
node cli/dist/gazua.mjs bogus; echo "exit=$?"
git status --short
```

Expected: 모든 테스트·타입 검사 통과. `node cli/dist/gazua.mjs bogus`는 `{"ok":false,"error":{"code":"invalid-args",…}}` 한 줄과 `exit=2`. `git status`에는 이 Task의 파일만 보인다(`cli/dist`는 `.gitignore`의 `dist/`로 제외).

- [ ] **Step 6: 커밋**

```bash
git add cli/README.md cli/src/readme.test.ts sync-worker/README.md
git commit -m "docs(cli): CLI 사용법·토스 키 분리 경고·배포 순서를 적음"
```
