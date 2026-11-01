# 읽기 전용 CLI 설계

> 2026-11-01 · 로드맵 최우선 2(「AI가 쓰는 가즈아 CLI」)의 단계 A(`docs/roadmap.md` §최우선 2). main f5377a2 위에서 해요. 한 PR로 내요. 주문·MCP는 다음 단계예요.
>
> 개정: 2026-11-01 검토 1회차 반영(CLI용 토스 키 분리·파일 잠금, 토큰 한 번만 원자 처리, 승인 화면 경로, venue별 마감 시각, 자기 토큰 철회, 확인 필요 답).
>
> 개정: 2026-11-01 검토 2회차 반영(오래된 잠금 원자 인수, `#/settings/sync` 해시 읽기만, `UNIFIED` 이름, 토큰 발급 만료 조건, `slow_down` 상한, `DELETE /v1/cli/token` 분기 위치, IP 정규화, 주문 캐시 파일 이름, 테스트 하네스 솔트).

## 1. 목표

AI 도구(터미널 에이전트)가 가즈아 데이터를 읽고 계산하게 해요. 사람이 쓰는 앱과 같은 데이터·같은 엔진을 쓰고, 출력은 기계가 읽기 좋은 JSON이에요.

- 동기화한 관심 그룹·전략을 읽어요(동기화 API).
- 시세·보유를 읽어요(증권사 API 직접 호출).
- 전략 신호를 계산하고 시뮬레이션을 돌려요(앱 엔진 재사용).
- 어떤 경로로도 주문·쓰기를 하지 않아요. 서버와 CLI가 각각 막아요.

### 1.1 정한 것 (brainstorming, 2026-11-01)

| 항목 | 결정 |
|---|---|
| 로그인 | 기기 코드 방식. CLI가 코드를 보이고, 사용자가 앱(설정 › 동기화·공유)에서 승인 |
| 서버 권한 | CLI 토큰은 읽기 전용. `GET /v1/profiles`, `GET /v1/profiles/:id?docVersion=2`, 자기 토큰 철회 `DELETE /v1/cli/token`만 통과 |
| 토큰 수명 | 90일 고정, 앱에서 철회 |
| 증권사 키 | 환경변수(`KIS_APP_KEY`·`KIS_APP_SECRET`, `TOSS_CLIENT_ID`·`TOSS_CLIENT_SECRET`), `--env-file`. **토스는 CLI용 앱을 따로 만들어 다른 client ID·secret을 써요**(§4.2) |
| 증권사 호출 | 프록시 없이 직접. 프록시와 같은 허용 목록(`proxy/src/allowlist.ts`)으로 주문 경로 차단 |
| 패키지 | `cli/` 워크스페이스, Node ≥ 22, esbuild 단일 번들, bin `gazua` |
| 출력 | 모든 명령 JSON. `{ ok: true, data }` / `{ ok: false, error: { code, message } }` |
| 신호 | (a) 조건 신호, (b) 내 보유(토스) 기준 매도 판정 |
| PR | 한 PR. 배포: 병합 → D1 `0005` → Worker 배포 |

### 1.2 범위 밖

- 주문(단계 B·C). 모의투자 포함.
- MCP 서버(다음 PR).
- 키 금고 복호화. CLI는 동기화한 증권사 키(`keyVault`)를 읽지 않아요. 키는 환경변수로만 받아요.
- 선정 기준 실행(전 종목 시장 파일이 필요해요).
- 프로필·전략 쓰기, 공유 만들기, 세션 관리.

## 2. 지금 구조

| 곳 | 하는 일 |
|---|---|
| `sync-worker/src/handler.ts` | 라우터. `matchOrigin`이 실패하면 모든 요청을 403 `origin`으로 거절해요(`:105-111`). 개인 API는 `authed()`가 `authenticate()`(세션)를 거쳐요 |
| `sync-worker/src/session.ts` | `@sch0718/firebase-session/worker`의 `createSessionAuth`. 헤더 `X-Gazua-Session` + Firebase ID 토큰(또는 소셜 세션만). 요청마다 허용 이메일·계정을 다시 봐요 |
| `sync-worker/src/cors.ts` | 허용 헤더 `Authorization, Content-Type, X-Gazua-Session, X-Share-Token` |
| `sync-worker/src/purge.ts` | 하루 한 번 Cron 정리(삭제 프로필·만료 공유·세션) |
| `sync-worker/migrations/` | `0001`~`0004`. 다음 번호는 `0005` |
| `src/lib/sync/api.ts` | 앱의 동기화 클라이언트(`createSyncApi`, `@sch0718/firebase-session/client`) |
| `src/lib/sync/dto.ts` | `ProfileDocV1`·`ProfileDocV2`, `PROFILE_DOC_VERSION = 2` |
| `src/lib/sim/strategyV1.ts` | `sanitizeStrategiesV1`·`toV2`(서버에 남은 v1 문서 읽기) |
| `src/lib/sim/strategyV2.ts` | `sanitizeStrategiesV2` |
| `src/lib/sim/loadSimData.ts`, `simulate.ts`, `rules.ts` | 시뮬레이션 데이터 받기·엔진·조건 평가기(`createRuleEvaluator`). `import.meta.env`·DOM 없음 |
| `src/lib/providers/kis.ts`, `toss.ts` | 공급자. `ProxyClient`(`http.ts`)를 주입받아요 |
| `src/lib/providers/http.ts` | `createProxyClient`: 주소를 `${baseUrl}/${provider}${path}`로 만들어요 |
| `src/lib/providers/factory.ts` | 공급자 조립. `sheets/universeSource`(→ `src/lib/data/universe.ts`의 `import.meta.env.BASE_URL`)를 끌어와 CLI에서 쓸 수 없어요 |
| `src/lib/providers/types.ts` | `AccountSource`(`holdings()`·`closedOrders()`), `AccountHolding`은 `symbol`·`name`·`quantity`만 있어요(평단 없음) |
| `src/lib/perf/ledger.ts` | `normalizeOrders`: 주문 → 날짜순 국내 체결 목록 |
| `proxy/src/allowlist.ts` | 공급자별 허용 경로·메서드(`isAllowed`). 주문 경로는 없어요. 토스 `/api/v1/orders`는 GET만 |
| `src/lib/ui/settings/SyncPanel.svelte`, `SyncManage.svelte` | 설정 › 동기화·공유. 「로그인한 기기」 목록·철회는 `SyncManage.svelte:73-86` |

## 3. 서버 설계 (`sync-worker`)

### 3.1 테이블 (`sync-worker/migrations/0005_cli.sql`)

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
  consumed_token_hash TEXT,           -- 폴링이 토큰을 만들 때 그 토큰의 해시(한 번만 주기, §3.2)
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

- 코드·토큰 원문은 저장하지 않아요. 지금 세션·공유와 같은 방식(`sha256Hex`, `@sch0718/firebase-session/worker`)이에요.
- 기기 코드: 32바이트 무작위(`deps.random(32)`)를 base64url. 토큰: 32바이트 무작위를 base64url하고 앞에 `gzc_`를 붙여요(로그·화면에서 무엇인지 알아보게).
- 사용자 코드: 자음 20자(`BCDFGHJKLMNPQRSTVWXZ`)에서 8자, 보일 때는 `XXXX-XXXX`. 경우의 수 20⁸ ≈ 2.6 × 10¹⁰. 받을 때 대문자로 바꾸고 하이픈·공백을 빼요. 겹치면(UNIQUE 위반) 다시 만들어요.

### 3.2 엔드포인트

모든 응답은 지금 Worker와 같은 JSON(`json()`·`errorBody()`)이에요. 오류는 `{ error: '<code>', … }`.

| 메서드·경로 | 인증 | 요청 | 성공 응답 | 오류 |
|---|---|---|---|---|
| `POST /v1/cli/device` | 없음(횟수 제한) | `{ label: string }`(1~64자) | `{ deviceCode, userCode: 'XXXX-XXXX', verifyUrl, interval: 5, expiresIn: 600 }` | 422 `invalid`, 429 `rate-limited` |
| `POST /v1/cli/token` | 없음(기기 코드) | `{ deviceCode }` | `{ token, tokenId, expiresAt }`(한 번만) | 400 `pending`·`slow_down`, 410 `expired`, 403 `denied`, 404 `unknown-device`, 429 `rate-limited` |
| `POST /v1/cli/approve` | 앱 세션(`authed`) | `{ userCode, approve: boolean }` | `{ label, createdAt }`(승인 대상 정보) | 422 `invalid-code`(없음·만료·이미 처리) |
| `GET /v1/cli/tokens` | 앱 세션 | — | `{ tokens: [{ id, label, createdAt, lastUsedAt, expiresAt }] }`(살아 있는 것만) | — |
| `DELETE /v1/cli/tokens/:id` | 앱 세션 | — | `{ revoked: true }` | 404 `not-found`(내 것이 아님 포함) |
| `GET /v1/profiles` | CLI 토큰 | — | 지금과 같음 | 401·403(§3.3) |
| `GET /v1/profiles/:id?docVersion=2` | CLI 토큰 | — | 지금과 같음(`doc_v` 규칙 그대로) | 401·403·422(지금과 같음) |
| `DELETE /v1/cli/token` | CLI 토큰 | — | `{ revoked: true }`(요청에 쓴 그 토큰만 철회) | 401 |

- `verifyUrl`은 `${ALLOWED_ORIGINS의 첫 출처}/#/settings/sync`예요. 앱 경로는 해시 라우터(`src/lib/state/routes.ts`)라 `parseHash`만 `#/settings/sync`를 `{ name: 'settings', section: 'sync' }`로 받아요(설정 화면을 열고 동기화·공유 구역으로 스크롤, `CLI 연결` 칸에 초점). `hashFor`는 계속 `#/settings`를 내요(§5.3).
- `DELETE /v1/cli/token`은 §3.3의 CLI 분기에만 두고 `ROUTES`에 `authed`로 넣지 않아요. 그래서 허용 Origin+세션 경로에서는 404예요(앱은 `DELETE /v1/cli/tokens/:id`를 써요).
- 승인 화면이 코드를 보낼 때 `approve: false`면 `status = 'denied'`로 바꿔요. 다음 폴링이 403 `denied`를 받아요.
- `POST /v1/cli/approve`의 조회 응답은 `{ label, createdAt, geo }`예요. `geo`는 기기 코드를 만들 때의 `request.cf.country`·`request.cf.city`(Cloudflare가 붙여 주는 값)를 `'KR · Seoul'`처럼 저장한 것이고, 없으면 `null`이에요.
- `pending`·`slow_down`은 OAuth 2.0 기기 인가(RFC 8628)의 이름을 따랐어요. CLI는 `slow_down`이면 간격을 5초 늘려요. 서버도 `interval_ms`를 5초 늘려 저장하되, `interval_ms < 60000`일 때만 늘려요. 60초 이상이면 늘리지 않고 `slow_down`만 답해요(간격이 끝없이 커지지 않게).
- `POST /v1/cli/token`이 승인된 기기 코드를 받으면 그때 토큰을 만들어요. 겹친 폴링 둘 중 **하나만** 토큰을 받게 세 단계로 해요.
  1. 새 토큰 `T`와 해시 `H`를 만들고 한 batch로 보내요.
     - `UPDATE cli_grants SET status = 'consumed', consumed_token_hash = ? WHERE id = ? AND status = 'approved' AND consumed_token_hash IS NULL AND expires_at > ?`(`H`, 지금 시각)
     - `INSERT INTO cli_tokens (…) SELECT … WHERE EXISTS (SELECT 1 FROM cli_grants WHERE id = ? AND consumed_token_hash = ?)`(`H`)
  2. 응답 전에 `cli_grants.consumed_token_hash`를 다시 읽어 `H`와 같을 때만 `T`를 돌려줘요.
  3. 다르면(다른 폴링이 먼저 가져감) 410 `expired`로 답해요. 이 폴링의 `INSERT`는 `EXISTS`가 거짓이라 행이 생기지 않아요.
  원문 토큰은 이 응답 한 번만 나가요.
- 만료(`expires_at <= now`)면 410 `expired`. `consumed` 뒤 다시 오면 410 `expired`로 답해요(토큰을 다시 주지 않아요).
- CLI 토큰 목록·철회는 세션 목록과 따로예요. 기존 `DELETE /v1/sessions?others=1`(「다른 기기 모두 로그아웃」)은 **CLI 토큰을 지우지 않아요.** 세션 표는 패키지(`@sch0718/firebase-session`)가 가진 표라 섞지 않고, CLI는 앱 화면에서 따로 철회해요(§5).

### 3.3 인증 분기 (`handler.ts`)

지금은 `Origin`이 없으면 바로 403이에요. CLI(Node)는 `Origin`을 보내지 않아요. 아래 순서로 갈라요.

1. `OPTIONS`는 지금과 같아요(앱 출처만).
2. `Origin`이 허용 출처면 지금 경로 그대로예요. 새 앱 경로 `POST /v1/cli/approve`·`GET /v1/cli/tokens`·`DELETE /v1/cli/tokens/:id`도 여기서 `authed()`로 받아요.
3. `Origin` 헤더가 **없고** 아래 중 하나면 CLI 경로로 받아요. 그 밖은 지금처럼 403 `origin`이에요.
   - 경로가 `POST /v1/cli/device` 또는 `POST /v1/cli/token`.
   - `Authorization`이 `Gazua-CLI `로 시작.
4. CLI 토큰 요청(`Authorization: Gazua-CLI <token>`):
   - 토큰 모양(`^gzc_[A-Za-z0-9_-]{43}$`)이 아니면 401 `cli-token`.
   - `cli_tokens`를 `token_hash`로 찾아요. 없음·철회·만료면 401 `cli-token-revoked`·`cli-token-expired`.
   - 사용자가 아직 허용 목록에 있는지 봐요(§3.4). 아니면 403 `not-allowed`.
   - **허용 목록(읽기 전용 강제)**: 라우터를 타기 **전에** 아래 셋 중 하나와 정확히 맞을 때만 통과해요. 그 밖(쓰기·키 금고·공유·세션·리비전·CLI 관리 경로, `HEAD`, 끝 슬래시 포함)은 403 `cli-scope`예요. 앞으로 경로를 더해도 실수로 열리지 않아요.

     | 메서드 | 경로(정규식, 라우터와 같은 모양) | 쿼리 |
     |---|---|---|
     | `GET` | `^/v1/profiles$` | 아무것도 보지 않음 |
     | `GET` | `^/v1/profiles/([^/]+)$` | `docVersion`이 정확히 `2` |
     | `DELETE` | `^/v1/cli/token$` | 없음 |

     메서드는 `req.method === 'GET'`처럼 정확히 비교해요(`HEAD`를 `GET`으로 보지 않아요). `/v1/profiles/`(끝 슬래시)·`/v1/profiles/a/revisions`는 정규식에 맞지 않아 거절돼요.
   - 통과하면 `AuthContext`(`{ userId, … }`)를 만들어 기존 `listProfiles`·`getProfile`을 그대로 불러요.
   - `last_used_at`은 하루에 한 번만 갱신해요(세션 `TOUCH_INTERVAL`처럼 쓰기를 아껴요).
5. CORS 허용 헤더(`cors.ts`)는 바꾸지 않아요. CLI는 브라우저가 아니라 preflight가 없어요. 브라우저가 `Origin` 없이 `Authorization: Gazua-CLI`를 보낼 수는 없어요(교차 출처 fetch는 늘 `Origin`을 붙여요).

### 3.4 허용 목록 다시 보기

세션 인증은 요청마다 허용 이메일(`ALLOWED_EMAILS`)·소셜 계정(`ALLOWED_ACCOUNTS`)을 다시 봐요(패키지 `authenticate`). CLI 토큰도 같은 정책을 따라요.

- 패키지는 소셜 사용자도 `users.firebase_sub`에 `identity`(예: `kakao:…`·`naver:…`)를 넣어요(`saveSession`의 `INSERT INTO users (id, firebase_sub, …)`).
- 그래서 `users.firebase_sub`가 `kakao:`·`naver:`로 시작하면 `parseAccountList(env.ALLOWED_ACCOUNTS)`에 있는지, 아니면 `users.email`이 `parseAllowList(env.ALLOWED_EMAILS)`에 있는지 봐요. 두 함수 모두 `@sch0718/firebase-session/worker`가 내보내요.

### 3.5 횟수 제한

Cloudflare Workers Rate Limiting 바인딩 대신 D1로 세요. 무료 계정에서 확실히 쓸 수 있는 것이 D1이라서예요(바인딩의 무료 계정 사용 가능 여부는 확인 필요, §13).

| 대상 | 규칙 | 응답 |
|---|---|---|
| `POST /v1/cli/device` | 같은 `ip_hash`로 최근 10분 5건, 전체 `pending` 50건 | 429 `rate-limited`, `Retry-After` |
| `POST /v1/cli/token` | 같은 기기 코드 `last_polled_at + interval_ms` 전이면 | 400 `slow_down`(간격 +5초, 60초 미만일 때만) |

- `pending` 폴링은 쓰기를 아끼려고 `last_polled_at`을 매번 쓰지 않아요. 조건부 UPDATE 한 문장으로 「간격이 지났으면 `last_polled_at`을 지금으로」를 하고, 바뀐 행이 0이면 `slow_down`이에요(`UPDATE … SET last_polled_at = ? WHERE id = ? AND (last_polled_at IS NULL OR last_polled_at + interval_ms <= ?)`). 정상 간격 폴링은 한 번에 1행을 써요.
| `POST /v1/cli/approve` | 앱 세션이 필요하고 허용된 사용자만이라 따로 세지 않아요 | — |

- IP는 `CF-Connecting-IP` 헤더예요. 정규화는 이래요.
  - IPv6는 `::`를 펼친 뒤 앞 4그룹(/64)만 써요(한 기기가 주소를 바꿔 가며 피하지 못하게).
  - IPv4-mapped(`::ffff:a.b.c.d`)는 IPv4(`a.b.c.d`)로 봐요.
  - 헤더가 없으면 `'unknown'` 한 묶음으로 세요.
  - `geo`(`'국가 · 도시'`)는 64자까지만 저장해요.
- 원 IP는 저장하지 않고 시크릿 `CLI_IP_SALT`(wrangler secret)로 HMAC-SHA256한 값만 둬요. 시크릿이 없으면 `/v1/cli/device`는 503 `cli-disabled`예요. grant 행은 하루 뒤 지워져(§3.6) IP 해시도 함께 사라져요.
- 넣기 문장 안에서 다시 세요(공유 50개 한도와 같은 방식, `shares.ts`의 `INSERT … SELECT … WHERE (SELECT count(*) …) < ?`). 겹친 요청 둘이 함께 지나가지 않아요.

### 3.6 정리 (`purge.ts`)

- `cli_grants`: `expires_at`이 하루 지난 행을 지워요.
- `cli_tokens`: 만료·철회 뒤 30일(`KEEP_AFTER_END`) 지난 행을 지워요.
- 한 번에 지우는 양은 지금 `PURGE_ROWS_PER_RUN`(500)을 같이 써요.

### 3.7 Cloudflare 무료 한도

| 항목 | 무료 한도 | CLI 사용량 어림 |
|---|---|---|
| Workers 요청 | 하루 10만 | 로그인 1회 = 기기 1 + 폴링 최대 120(5초 × 10분) + 승인 1. 명령 1회 = 프로필 목록 1 + 문서 N |
| D1 읽기 | 하루 500만 행 | 토큰 확인 1행/요청 |
| D1 쓰기 | 하루 10만 행 | 로그인 1회 ≈ 기기 1 + 폴링 최대 120(정상 간격일 때 폴링마다 1) + 승인 1 + 토큰 2 ≈ 125행. 명령은 `last_used_at` 하루 1번 |

숫자는 Cloudflare 공개 요금표 기준이에요. 배포 전 계정 화면에서 다시 봐요(확인 필요, §13).

## 4. 보안

### 4.1 위협 모델

| 위협 | 막는 방법 | 남는 위험 |
|---|---|---|
| CLI 토큰 탈취(파일 유출·로그) | 서버는 해시만 저장. 토큰은 읽기 전용(§3.3). 파일 권한 600(§6.5). 출력·로그에 토큰을 내지 않음(§6.4). 90일 만료, 앱에서 철회 | 유효 기간 동안 관심 그룹·전략을 읽을 수 있어요. 키·계좌는 서버에 없거나(계좌) 암호문이라(키 금고) 읽을 수 없어요 |
| 사용자 코드 추측 | 승인은 앱 세션(허용된 사용자)만. 코드 2.6 × 10¹⁰, 10분 만료 | 공격자가 자기 기기 코드를 사용자에게 승인하게 속이는 피싱. 승인 화면에 CLI 이름(`label`)·요청 시각을 보이고 「직접 실행한 명령에서 나온 코드만 승인하세요」를 적어요 |
| 기기 코드 추측 | 32바이트 무작위, 해시 조회 | 없음 |
| 무인증 경로 남용 | IP별·전체 횟수 제한, 10분 만료, 정리 Cron | 분산 IP로 `pending`을 채우면 50건 한도 동안 새 로그인이 막혀요(10분 뒤 풀림) |
| 프롬프트 주입(AI가 읽은 문서·웹이 CLI를 조종) | CLI에 쓰기·주문 명령이 없어요. 서버도 읽기만 허용. 증권사 호출도 허용 목록만 | 읽은 데이터(종목·전략 이름)를 AI가 다른 곳에 보낼 수 있어요. CLI 출력에 비밀값이 없게 하는 것까지가 이 PR의 범위예요 |
| 주문 경로 | 증권사 호출 전에 `isAllowed`(프록시와 같은 목록)로 막아요(§6.3). 주문 TR·경로는 목록에 없어요 | 허용 목록을 넓히는 실수. 목록 테스트가 주문 경로를 막는지 확인해요(§8) |
| 증권사 키 노출 | 환경변수로만 받고 파일에 쓰지 않아요. 접근 토큰 캐시만 600 파일에 둬요 | 사용자 셸 환경·`.env` 파일 관리는 사용자 몫이에요 |
| 앱과 CLI의 토스 토큰 다툼 | 토스는 같은 앱(client ID)으로 새 토큰을 받으면 앞 토큰이 무효가 될 수 있어요. CLI용 앱을 따로 만들어 다른 키를 쓰게 해요(§4.2) | 같은 키를 쓰면 앱과 CLI가 서로의 토큰을 무효로 만들어요 |

### 4.2 토스 키 분리와 토큰 잠금

- **CLI용 토스 키를 따로 써요.** 토스 개발자 콘솔에서 CLI용 앱을 하나 더 만들어 다른 client ID·secret을 받아요. 앱과 같은 키를 쓰면 한쪽이 토큰을 새로 받을 때 다른 쪽 토큰이 무효가 될 수 있어요(앱은 이를 `token-contended`로 다뤄요, `src/lib/providers/toss.ts`). README에 이 경고와 콘솔 안내를 적어요. 콘솔에서 앱을 여러 개 만들 수 있는지는 확인 필요예요(§13).
- **같은 기기의 CLI 병렬 실행**: AI 도구가 명령을 동시에 여러 개 돌릴 수 있어요. 공급자에 파일 잠금 `TokenLock`을 넘겨 토큰 발급을 한 번에 하나로 묶어요.
  - 잠금 파일: `~/.config/gazua/<provider>.lock`(`kis.lock`·`toss.lock`). 안에 `{ pid, hostname, nonce, createdAt }`을 써요. `fs.open(path, 'wx')`(`O_EXCL`)로 만들고, 이미 있으면 200ms마다 다시 시도해요.
  - 회수: 파일 시스템에는 원자적인 「비교 후 삭제」가 없어서 회수 잠금(`.break`)과 시간 기준 회수는 두지 않아요(둘 다 새 경합을 만들어요). 잠금을 읽어 **같은 `hostname`이고 `process.kill(pid, 0)`이 ESRCH(프로세스 없음)일 때만** 회수해요. 지우기 직전에 다시 읽어 nonce가 같으면 `unlink`하고 `open('wx')`를 다시 시도해요. pid가 살아 있거나(EPERM 포함) 다른 host이거나 내용이 깨졌으면 회수하지 않고 기다려요.
  - 대기 상한은 30초예요. 넘으면 오류 코드 `token-busy`로 실패해요(§6.6).
  - 해제: 잠금 파일을 읽어 자기 `nonce`일 때만 `unlink`해요(그 사이 남의 잠금으로 바뀌었으면 그대로 둬요).
  - 한계: 두 회수자가 같은 죽은 잠금을 동시에 보면, 한쪽이 지운 뒤 새로 만든 잠금을 다른 쪽이 (다시 읽기와 `unlink` 사이에) 지울 수 있는 아주 좁은 틈이 남아요. 그 결과는 토큰을 한 번 더 발급하는 것뿐이고, 토스는 `token-revoked`, KIS는 재시도로 복구돼요. 데이터 손실은 없어요.
  - 잠금 안에서 토큰 저장소(`tokens-<공급자>.json`)를 다시 읽으니, 앞 실행이 받은 토큰을 뒤 실행이 그대로 써요. KIS 1분 발급 제한은 같은 파일의 `issuedAt`으로, 토스 재발급 간격(60초)도 `issuedAt`을 파일에 두어 실행을 넘어 지켜요.
  - `createTossProvider`는 이미 `tokenLock`을 받아요. `createKisProvider`에는 선택 인자 `tokenLock`을 더해 `createTokenManager`의 다섯 번째 인자로 넘기고, `createTossProvider`에는 선택 인자 `issuedAt`(`IssuedAtStore`)을 더해 네 번째 인자로 넘겨요(§6.2). 앱은 둘 다 넘기지 않아 그대로예요.

### 4.3 출력하지 않는 값

증권사 키(appKey·appSecret·clientId·clientSecret), 접근 토큰, CLI 토큰, 기기 코드, 토스 `accountSeq`(`x-tossinvest-account`). 출력 직전에 한 번 더 걸러요(§6.4).

## 5. 앱 화면

### 5.1 CLI 연결 승인 (새 `src/lib/ui/settings/CliConnect.svelte`)

`SyncPanel.svelte`의 `KeySync` 아래에 둬요. 동기화가 켜져 있고 로그인했을 때만 보여요.

```
CLI 연결
터미널에서 `gazua login`을 실행하면 나오는 코드를 넣어 주세요.
[ XXXX-XXXX ] [확인]
```

0. 조회한 코드는 정보와 함께 기억하고, 허락·거절은 그 코드로만 보내요. 입력 칸을 바꾸면 조회 결과(대화상자)를 버려요. 조회하는 사이 입력이 바뀌면 그 결과를 보이지 않아요.
1. 코드를 넣고 확인을 누르면 `POST /v1/cli/approve`를 `approve: true`로 바로 보내지 않고, 먼저 확인 대화상자를 열어요.
   - 「읽기 전용 접근을 허락할까요?」
   - 「`gazua@macbook`에서 요청했어요(KR · Seoul, 2분 전). 관심 그룹·전략을 읽을 수 있고, 바꾸거나 주문할 수는 없어요. 직접 실행한 명령에서 나온 코드만 승인하세요.」 위치(`geo`)가 없으면 괄호 안은 시각만 보여요.
   - [허락] [거절]
   - CLI 이름은 승인 전에 보여야 해서, 승인 API를 두 단계로 나눠요: `POST /v1/cli/approve`에 `{ userCode }`만 보내면 `{ label, createdAt, geo }`를 돌려주고 상태는 바꾸지 않아요. `approve: true`/`false`를 함께 보내야 상태를 바꿔요.
2. 허락하면 「연결했어요. 터미널로 돌아가세요」.
3. 실패 문구
   - 422 `invalid-code`: 「코드가 맞지 않거나 시간이 지났어요. `gazua login`을 다시 실행해 주세요」
   - 404(옛 Worker, 경로 없음): 「서버 업데이트가 필요해요」. 코드가 틀린 경우는 422라 404와 겹치지 않아요.
4. 입력 칸: `aria-label="CLI 코드"`, `autocomplete="off"`, 대문자로 보이고 하이픈은 자동으로 넣어요. 휴대폰 한 열.

### 5.2 로그인한 기기에 CLI 토큰 (`SyncManage.svelte`)

「로그인한 기기」를 펼치면 세션 목록 아래에 「CLI」 묶음을 둬요. `GET /v1/cli/tokens`를 같이 읽어요.

- 줄: `gazua@macbook` · 「읽기 전용 CLI」 · 마지막 사용 · 만료일 · [연결 끊기](`aria-label="gazua@macbook CLI 연결 끊기"`).
- 「다른 기기 모두 로그아웃」은 CLI 토큰을 건드리지 않는다는 문구를 버튼 아래에 적어요: 「CLI 연결은 따로 끊어요」.
- 404면 CLI 묶음 자리에 「서버 업데이트가 필요해요」.

### 5.3 앱 코드

- `src/lib/sync/api.ts`: `cliApprove(userCode, approve?)`, `cliTokens()`, `cliRevoke(id)`.
- `src/lib/sync/controller.svelte.ts`: 같은 이름의 `guarded` 래퍼.
- 문구는 해요체. 실패 코드 → 문구 표는 `CliConnect.svelte` 안에 둬요.
- `src/lib/state/routes.ts`: `parseHash`만 `#/settings/sync`를 `{ name: 'settings', section: 'sync' }`로 받아요. `hashFor`는 그대로 `#/settings`를 내요. 일회성 구역 이동을 해시에 남기지 않는 기존 설계예요(`routes.ts:17-18`의 `section` 주석). `Route.section`(`SettingsSection`)과 `Settings.svelte`의 `SECTION_IDS.sync`(`set-sync`)는 이미 있어서 타입은 바꾸지 않아요.
- `src/routes/Settings.svelte`: 지금은 구역 제목(`h`)에 초점을 줘요. `section === 'sync'`일 때는 「CLI 코드」 입력 칸(`CliConnect.svelte`의 입력)에 초점을 주도록 조금 고쳐요.

## 6. CLI 구조 (`cli/`)

### 6.1 파일

| 파일 | 책임 |
|---|---|
| `cli/package.json` | `name: "gazua-cli"`, `type: "module"`, `bin: { gazua: "dist/gazua.mjs" }`, `engines.node: ">=22"`, 스크립트 `build`·`test`·`check` |
| `cli/build.mjs` | esbuild 단일 번들: 진입 `src/main.ts` → `dist/gazua.mjs`, `platform: 'node'`, `format: 'esm'`, `target: 'node22'`, 첫 줄 `#!/usr/bin/env node` |
| `cli/src/main.ts` | 인자 해석(`node:util`의 `parseArgs`), 명령 분기, 최상위 오류 → JSON |
| `cli/src/output.ts` | `ok(data)`·`fail(code, message)`, 비밀값 거르기(§6.4) |
| `cli/src/errors.ts` | `CliError(code, message)`, 오류 코드 표(§6.6) |
| `cli/src/config.ts` | `~/.config/gazua/` 경로, 파일 읽기·쓰기(권한 600·700) |
| `cli/src/fileLock.ts` | 파일 잠금 `TokenLock`(§4.2) |
| `cli/src/orderCache.ts` | 토스 주문 이력 파일 캐시(§7.2) |
| `cli/src/env.ts` | 환경변수·`--env-file`(`process.loadEnvFile`) |
| `cli/src/syncClient.ts` | 동기화 API(`/v1/cli/*`, `/v1/profiles`). `Authorization: Gazua-CLI` |
| `cli/src/direct.ts` | 증권사 직접 호출용 `ProxyClient`(§6.3) |
| `cli/src/providers.ts` | KIS·토스 공급자 조립(파일 토큰 저장소, `createRequestQueue`) |
| `cli/src/profileData.ts` | 프로필 문서 읽기, v1 → v2 옮기기(`sanitizeStrategiesV1`·`toV2`), 프로필·전략 찾기 |
| `cli/src/signals.ts` | 신호 계산(§7) |
| `cli/src/commands/*.ts` | `login`·`logout`·`profiles`·`watchlists`·`strategies`·`quote`·`holdings`·`signals`·`simulate` |
| `cli/vitest.config.ts`, `cli/tsconfig.json` | 테스트·타입 |
| `pnpm-workspace.yaml` | `'cli'` 더하기 |

- 재사용(상대 경로 import, esbuild가 묶음): `src/lib/sim/*`(엔진·평가기·`loadSimData`·`strategyV1`·`strategyV2`), `src/lib/providers/{kis,toss,http,auth,errors,types}.ts`, `src/lib/data/requestQueue.ts`, `src/lib/sync/dto.ts`(타입·`PROFILE_DOC_VERSION`), `src/lib/perf/ledger.ts`(`normalizeOrders`), `src/lib/time/kst.ts`, `proxy/src/allowlist.ts`.
- 쓰지 않음: `src/lib/providers/factory.ts`(→ `sheets/universeSource` → `import.meta.env`), `src/lib/data/universe.ts`, `src/lib/state/*`(브라우저 저장소), `src/lib/sync/api.ts`(앱 세션 클라이언트).
- 묶음에 `import.meta.env`·`window`·`navigator.locks`가 들어오면 빌드를 실패시켜요(esbuild `define`으로 `import.meta.env`를 정의하지 않고, 빌드 뒤 결과에서 이 문자열을 찾는 검사 단계).
- esbuild 버전은 지금 lockfile의 vite가 쓰는 버전과 같게 `cli`의 devDependency로 고정해요.

### 6.2 앱 쪽에 더하는 작은 변경

| 파일 | 변경 | 이유 |
|---|---|---|
| `src/lib/providers/http.ts` | `ProxyClientConfig`에 선택 인자 `urlFor?: (provider, path) => string`. 없으면 지금처럼 `${baseUrl}/${provider}${path}` | CLI가 같은 클라이언트(시간 제한·오류 분류·`retry-after`)로 증권사 원 주소를 부르게 |
| `src/lib/providers/types.ts`, `toss.ts` | `AccountHolding`에 `avgPrice?: number`(토스 `averagePurchasePrice`) | 보유 기준 매도 판정(§7.2). 지금 보유 응답 고정값(`toss.import.test.ts:55`)에 이 필드가 있어요 |
| `src/lib/providers/toss.ts` | `TossDeps.issuedAt?: IssuedAtStore` → `createTokenManager(…, deps.issuedAt, deps.tokenLock)` | 실행을 넘는 토스 재발급 간격(§4.2). 앱은 넘기지 않아 그대로 |
| `src/lib/providers/kis.ts` | `KisDeps.tokenLock?: TokenLock` → `createTokenManager(…, deps.issuedAt, deps.tokenLock)` | CLI 병렬 실행의 발급 묶기(§4.2). 앱은 넘기지 않아 그대로 |

앱 동작은 바뀌지 않아요.

### 6.3 증권사 직접 호출 (`cli/src/direct.ts`)

```ts
import { isAllowed, UPSTREAM } from '../../proxy/src/allowlist';
import { createProxyClient, type ProxyClient } from '../../src/lib/providers/http';
import { ApiError } from '../../src/lib/providers/errors';

/** 프록시 없이 증권사를 부른다. 프록시와 같은 허용 목록으로 주문·쓰기 경로를 막는다 */
export function createDirectClient(fetchImpl: typeof fetch = fetch): ProxyClient {
  const inner = createProxyClient({ baseUrl: '', fetchImpl, urlFor: (p, path) => `${UPSTREAM[p]}${path}` });
  return {
    request(provider, method, path, opts) {
      if (!isAllowed(provider, path, method)) return Promise.reject(new ApiError('path-blocked'));
      return inner.request(provider, method, path, opts);
    },
  };
}
```

- 검사는 쿼리를 뺀 경로로 해요(`isAllowed`의 계약과 같아요).
- 토스는 허용 IP에서만 받아요. 이 기기의 공인 IP를 토스 개발자 콘솔에 등록해야 해요. 지금 프록시가 도는 기기와 같은 기기에서 쓰면 그대로일 수 있어요(확인 필요, §13). 토스가 IP로 거절하면 `ip-not-allowed`(`errors.ts`)로 나와요.
- KIS 발급 1분 제한(`KIS_TOKEN_INTERVAL_MS`)과 토스 재발급 간격은 공급자 코드가 그대로 지켜요. 발급 시각을 파일에 저장해 CLI를 여러 번 실행해도 지켜요(§6.5).

### 6.4 출력과 비밀값 거르기 (`cli/src/output.ts`)

- 표준 출력에는 JSON 한 줄(`JSON.stringify`)만 써요. `--pretty`면 들여 써요. 진행 상황은 표준 오류에 `--verbose`일 때만 써요.
- 종료 코드: 성공 0, `ok: false`면 1, 인자 오류 2.
- 거르기: 출력 직전에 객체를 돌며 키 이름이 CLI 비밀 키 목록(`SECRET_KEYS`: `appKey`·`appSecret`·`clientId`·`clientSecret`·`accessToken`·`refreshToken`·`token`·`proxyToken`·`accountSeq`·`deviceCode`·`secrets`, 대소문자 무시)에 있으면 값을 `"[숨김]"`으로 바꿔요. 동기화의 `FORBIDDEN_KEYS`(`src/lib/sync/forbidden.ts`)는 쓰지 않아요. 그 목록에는 `holdings`·`provider`·`orders`처럼 CLI가 정상으로 내는 키가 있어서예요. 문자열 값에 지금 실행의 비밀값(환경변수 키, CLI 토큰, 접근 토큰, `accountSeq`)이 들어 있으면 그 부분을 `[숨김]`으로 바꿔요. 환경변수 키는 인자 검증보다 먼저(`--env-file` 로드 직후 다시) 등록하고, 접근 토큰은 토큰 파일을 읽거나 저장할 때, `accountSeq`는 알게 될 때 등록해요. 그래서 인자 오류 메시지가 입력을 되풀이해도 키가 나가지 않아요. 오류 메시지도 같은 거르기를 거쳐요.

### 6.5 저장 파일 (`~/.config/gazua/`)

`XDG_CONFIG_HOME`이 있으면 `$XDG_CONFIG_HOME/gazua/`. 디렉터리 700, 파일 600으로 만들고, 읽을 때 권한이 더 넓으면 경고(`warnings`)를 붙여요. Windows는 권한 검사를 건너뛰어요.

`auth.json`:

```json
{ "v": 1, "server": "https://sync.example", "token": "gzc_…", "tokenId": "3f2c…", "label": "gazua@macbook", "expiresAt": 1770000000000 }
```

`tokens-kis.json`·`tokens-toss.json`(증권사 접근 토큰 캐시, 공급자마다 파일 하나):

```json
{ "v": 1, "keyHash": "c3d4…", "accessToken": "…", "expiresAt": 1762000000000, "issuedAt": 1761913600000 }
```

- 공급자마다 파일을 나눠, 각자의 공급자 잠금(`kis.lock`·`toss.lock`) 안에서만 갱신해요. 한 파일을 두 공급자가 나눠 쓰면 서로 다른 잠금 아래에서 읽고 덮어써 한쪽 토큰이 사라질 수 있어서예요.
- `keyHash`: 키 앞 값(appKey·clientId)의 SHA-256 앞 16자. 키를 바꾸면 캐시를 버려요.
- `TokenStore`·`IssuedAtStore`(`src/lib/providers/types.ts`) 구현이 이 파일을 읽고 써요. 쓰기는 임시 파일 → rename으로 해요. 읽을 때마다 디렉터리·파일 권한이 넓으면 `warnings`를 붙여요(`auth.json`, 토큰 파일, 주문 캐시 모두).
- `TokenStore.load()`는 메모리에 담지 않고 매번 파일을 읽어요(잠금 안 다시 읽기를 위해, `src/lib/providers/auth.ts`의 `usableStored()` 참고).
- 동기화 서버 주소: `gazua login --server <주소>` 또는 `GAZUA_SYNC_URL`이 먼저, 없으면 빌드 때 esbuild `define`으로 넣은 기본값(빌드 환경의 `VITE_SYNC_API_URL`, 앱이 `src/lib/sync/config.ts`에서 읽는 값과 같음). 로그인한 뒤에는 `auth.json`의 `server`를 써요. 이 `define`은 `import.meta.env` 전체가 아니라 상수 하나만 바꿔요.
- 잠금 파일 `kis.lock`·`toss.lock`(§4.2)과 주문 캐시 `orders-<keyHash>-<accountSeq 해시 앞 8자>.json`(§7.2)도 같은 디렉터리·권한이에요.

### 6.6 오류 코드

| 코드 | 언제 |
|---|---|
| `invalid-args` | 인자·옵션 틀림(종료 코드 2) |
| `not-logged-in` | `auth.json` 없음 |
| `cli-token-revoked`·`cli-token-expired` | 서버가 토큰을 거절(앱에서 끊음·90일 지남) → `gazua login` 다시 |
| `cli-scope` | 서버가 읽기 전용 밖이라 거절(버그 방어) |
| `not-allowed` | 허용 목록에서 빠진 사용자 |
| `server-outdated` | CLI 경로가 404(옛 Worker) |
| `login-expired`·`login-denied` | 기기 코드 만료·거절 |
| `rate-limited` | 서버·증권사 429 |
| `network` | 연결 실패. 공급자 `ApiError`의 `proxy-unreachable`·`offline`도 여기로(CLI는 프록시를 쓰지 않아 이 이름이 맞지 않아요) |
| `profile-required` | 프로필이 여럿인데 `--profile`이 없음(`data.profiles`에 목록) |
| `profile-not-found`·`strategy-not-found` | 이름·ID로 못 찾음 |
| `ambiguous-strategy` | 같은 이름 전략이 여럿(`data.matches`에 ID 목록) |
| `no-credentials` | 필요한 증권사 키 환경변수가 없음 |
| `provider-unsupported` | 그 공급자로 안 되는 명령(예: KIS로 `holdings`) |
| `path-blocked` | 허용 목록 밖 증권사 경로(버그 방어) |
| `token-busy` | 같은 기기의 다른 CLI 실행이 쥔 토큰 잠금을 30초 안에 얻지 못함(§4.2) |
| `ip-not-allowed`·`invalid-credentials`·`token-throttled`·`token-contended`·`upstream`·`timeout` | 공급자 `ApiError` 코드를 그대로 |
| `app-outdated` | 서버 문서가 이 CLI보다 높은 버전(422 `앱을 새로 고쳐 주세요`) → CLI 업데이트 |
| `internal` | 그 밖 |

`message`는 사람이 읽는 한국어 한 줄이고 비밀값이 없어요.

### 6.7 명령

공통 옵션: `--profile <이름|ID>`, `--pretty`, `--verbose`, `--env-file <경로>`. 증권사가 필요한 명령은 `--provider kis|toss`(없으면 키가 있는 쪽, 둘 다면 `toss`).

| 명령 | 하는 일 | 동기화 | 증권사 |
|---|---|---|---|
| `gazua login [--label <이름>] [--server <주소>]` | 기기 코드 흐름(§6.8) | ○ | |
| `gazua logout` | `DELETE /v1/cli/token`으로 서버 토큰을 끊고 `auth.json`을 지워요. 401 `cli-token-revoked`·`cli-token-expired`는 「이미 끊김」이라 성공으로 보고 파일만 지워요. 서버에 닿지 않아도 파일은 지우고 `warnings`에 「서버 연결은 앱에서 끊어 주세요」 | ○ | |
| `gazua profiles` | 프로필 목록(ID·이름·리비전·그룹·전략 수) | ○ | |
| `gazua watchlists` | 그룹·종목 | ○ | |
| `gazua strategies` | 전략 목록과 규칙 요약 | ○ | |
| `gazua quote <종목…>` | 현재가 | | ○ |
| `gazua holdings` | 토스 국내 보유(수량·평단) | | 토스 |
| `gazua signals --strategy <이름|ID> [--today]` | §7 | ○ | ○ |
| `gazua simulate --strategy <이름|ID> [--from --to]` | 시뮬레이션 요약 | ○ | ○ |

출력 예시:

```json
{"ok":true,"data":{"profiles":[{"id":"9b1c…","name":"내 프로필","revision":12,"groups":3,"strategies":4}]}}
```

```json
{"ok":true,"data":{"profile":"내 프로필","groups":[{"id":"g-1","name":"반도체","symbols":[{"symbol":"005930","hidden":false}]}]}}
```

```json
{"ok":true,"data":{"strategies":[{"id":"s1","name":"골든크로스 추세","universe":{"kind":"group","groupId":"g-1","symbols":["005930","000660"]},"buy":"골든크로스 20/60 + 거래량 20일 평균 1.5배↑","sell":"손절 −7% · 트레일링 −10% · 조건 매도 1묶음","sizing":"회당 처음 자금 10%"}]}}
```

```json
{"ok":true,"data":{"provider":"kis","quotes":[{"symbol":"005930","price":71200,"ts":1761970200000,"venue":"KRX"}]}}
```

```json
{"ok":true,"data":{"provider":"toss","holdings":[{"symbol":"005930","name":"삼성전자","quantity":10,"avgPrice":68500}]}}
```

```json
{"ok":true,"data":{"strategy":"골든크로스 추세","period":{"from":"2023-11-01","to":"2026-10-31"},"summary":{"totalReturnPct":23.4,"cagrPct":7.2,"mddPct":-14.1,"winRatePct":55.6,"roundTrips":18,"openPositions":1},"benchmarks":{"holdReturnPct":15.2,"indexReturnPct":9.8,"benchmarkReturnPct":10.1},"perSymbol":[{"symbol":"005930","pnl":1234000,"roundTrips":7}],"failed":[]}}
```

```json
{"ok":false,"error":{"code":"profile-required","message":"프로필이 여럿이에요. --profile로 골라 주세요"},"data":{"profiles":[{"id":"9b1c…","name":"내 프로필"}]}}
```

- 문자열 요약(`buy`·`sell`·`sizing`)은 앱의 `buyRulesSummary`·`sellRulesSummary`·`sizingText`(`src/lib/ui/simulate/simText.ts`)를 그대로 묶어 써요. `simText.ts`가 import하는 `../format`·`../compare/compareText`는 브라우저 의존이 없어 번들할 수 있어요. 빌드 뒤 문자열 검사(§6.1)는 그대로 둬요. 원 규칙(`rules`)은 `--raw`로 함께 내요.
- 이름 찾기: 정확히 같은 이름 → 없으면 ID. 같은 이름이 여럿이면 `ambiguous-strategy`.
- `simulate`는 앱과 같은 `loadSimData` → `simulate`를 써요. 기간은 전략의 `period`, `--from`·`--to`로 바꿀 수 있어요. 종목은 `resolveSymbols(strategy, watchlists)`.
- 서버 문서가 v1이면 `sanitizeStrategiesV1` → `toV2`로 옮겨 읽어요. CLI는 쓰지 않으니 옮긴 결과를 저장하지 않아요.

### 6.8 로그인 흐름

1. `POST /v1/cli/device { label }`. `label` 기본값은 `gazua@<호스트 이름>`(`os.hostname()`, 64자로 자름).
2. 표준 오류에 사람이 읽을 안내를 써요: 「앱의 설정 › 동기화·공유 › CLI 연결에 이 코드를 넣어 주세요: XXXX-XXXX (10분)」와 `verifyUrl`. 표준 출력은 끝날 때 JSON 한 줄만.
3. `interval`초마다 `POST /v1/cli/token`. `pending`이면 계속, `slow_down`이면 간격 +5초, `expired`·`denied`면 `login-expired`·`login-denied`.
4. 토큰을 받으면 `auth.json`(600)에 쓰고 `{ ok: true, data: { label, expiresAt } }`.

AI 도구가 로그인까지 할 수는 없어요(사람이 앱에서 승인). 로그인은 사람이 한 번 해 두는 일이에요.

## 7. signals 계산 (`cli/src/signals.ts`)

### 7.1 조건 신호 (전략 종목 전체)

- 기준 봉: 마지막 완성 일봉이에요.
  - 마감 시각은 받는 일봉의 venue로 정해요. `KRX`는 15:30 KST, 통합(`UNIFIED`, NXT 포함)은 20:00 KST예요. 토스는 `venues: ['UNIFIED']`만 내므로(`toss.ts`) 토스 사용자는 늘 20:00 기준이에요. venue는 `loadSimData`와 같은 규칙(공급자가 KRX를 주면 KRX, 아니면 첫 venue)이에요.
  - `--today`가 없거나 지금이 그 마감 전이면 어제까지(`addDays(kstDate(now), -1)`), `--today`이고 마감 뒤면 오늘까지 받아요.
  - 오늘이 휴장일(`getTradingDays`의 `isOpen: false`)이면 `--today`여도 마지막 거래일이에요.
  - 출력에 `asOf`(기준 봉 날짜)·`includesToday`·`venue`를 넣어요.
- 데이터: 종목마다 `getCandles({ interval: '1d', from: warmFrom, to })`. `warmFrom`은 `loadSimData`와 같은 식(`max(400, ceil(rulesLookback × 1.6))`일 전)이에요.
- 판정: `createRuleEvaluator(candles, rules.buy, firstDayIdx)`(매수)와, 조건 매도가 켜져 있으면 `createRuleEvaluator(candles, rules.sell.signal.groups, firstDayIdx)`(매도). `firstDayIdx`는 **기준 봉**의 인덱스예요(RSI는 기준 봉 앞 250봉에서 시작). 엔진과 같이 앞 봉부터 `signal(i)` → `update(i)`를 차례로 부르고, 기준 봉의 `signal`을 봐요.
- 시뮬레이션과 다른 점(출력 `notes`에 모두 적어요):
  - RSI 시작점: 시뮬레이션은 기간 첫날 앞 250봉, signals는 기준 봉 앞 250봉이라 RSI 값이 조금 다를 수 있어요.
  - reset 없음: 매매 이력이 없어 반등 패턴 블록의 `reset`(전량 매도 뒤 새 하락 필요)을 부르지 않아요.
  - 보유 중에도 매수 판정: 시뮬레이션은 보유 중 매수 조건을 보지 않지만, signals는 모든 종목의 매수 조건을 내요.
- 출력:

```json
{"ok":true,"data":{"strategy":"골든크로스 추세","asOf":"2026-10-31","includesToday":false,"signals":[{"symbol":"005930","buy":{"match":true,"reason":"골든크로스 20/60 + 거래량 20일 평균 1.5배↑","group":1},"sell":{"match":false}},{"symbol":"000660","buy":{"match":false},"sell":null}],"failed":[],"venue":"KRX","notes":["매매 이력 없이 계산한 조건 신호예요","RSI는 기준 봉 앞 250봉에서 시작해요","보유 중인 종목도 매수 조건을 판정해요"]}}
```

- `group`은 맞은 묶음 번호(1부터)예요. 평가기 `signal()`은 사유만 돌려주니, 묶음 번호를 함께 돌려주는 선택 필드를 `RuleEvaluator.signal` 결과에 더해요(`group?: number`, 엔진은 쓰지 않음).

### 7.2 내 보유 기준 매도 판정 (토스, `--provider toss`)

전략 종목 중 토스에 실제로 들고 있는 종목마다 계산해요. KIS면 이 부분을 빼고 `notes`에 「보유 기준 판정은 토스만 돼요」를 넣어요.

| 항목 | 계산 | 모르면 |
|---|---|---|
| 평단·수량 | `account.holdings()`의 `avgPrice`·`quantity`(§6.2) | `avgPrice`가 없으면 가격 판정을 `unknown` |
| 첫 매수일 | `account.closedOrders()` → `normalizeOrders`로 거른 뒤 **실제 체결 시각순**(`filledAt ?? orderedAt`)으로 다시 정렬해(`normalizeOrders`는 같은 날 매수를 먼저 둬서 같은 날 전량 매도 후 재매수를 거꾸로 읽는다) 수량을 더하고 빼며, 수량이 0에서 양수가 된 마지막 날. 끝 수량이 지금 보유 수량과 다르면 이력이 모자란 것 | `unknown` |

- 주문별 체결은 합산돼 `filledAt`이 마지막 체결 시각이라, 부분 체결이 다른 주문 사이에 끼면 순서를 복원할 수 없어요. 복원 중 누적 수량이 음수가 되면 첫 매수일을 `null`(`unknown`)로 두고 트레일·기간 청산도 `unknown`이에요.
- 주문 이력은 파일 캐시(`orders-<keyHash>-<accountSeq 해시 앞 8자>.json`, 600)에 둬요. 앱의 `src/lib/perf/orderCache.ts`처럼 `{ orders, syncedAt, syncedThrough }`를 두고, 다음에는 `syncedThrough`의 7일 전부터만 받아 합쳐요(같은 `orderId`는 새 것으로). `keyHash`는 토스 client ID 해시이고, `accountSeq`의 SHA-256 앞 8자를 파일 이름에 더해 계좌가 바뀌면 다른 파일이 돼요. 원문 `accountSeq`는 파일 이름에도 내용에도 쓰지 않아요.
| 손절 가격 | `stopLoss.on`이면 기준에 따라: `avgAlways`·`avgAfterScaleIn` = 평단 × (1 − pct), `firstBuy` = 첫 매수 체결가 × (1 − pct) | `firstBuy`인데 첫 매수가를 모르면 `unknown` |
| 익절 가격 | `takeProfit.on`이면 단계마다 평단 × (1 + pct) | 지난 단계 체결 여부는 모름 → 모든 단계를 내고 `stagesDoneUnknown: true` |
| 트레일 가격 | `trailing.on`이면 (첫 매수일부터 기준 봉까지 종가 최고값과 첫 매수가 중 큰 값) × (1 − pct) | 첫 매수일이 받아 둔 봉 범위보다 앞이면 첫 매수일부터 다시 받아요. 첫 매수일 근처부터 봉을 확보하지 못하거나 첫 매수일이 `unknown`이면 `unknown` |
| 기간 청산 | `timeExit.on`이면 첫 매수일부터 기준 봉까지 거래일 수(`getTradingDays`, 첫날 = 1), `days` 이상이면 도달 | 첫 매수일 `unknown`이면 `unknown` |
| 조건 매도 | §7.1의 매도 평가 결과 | — |
| 도달 여부 | 기준 봉 종가 ≤ 손절·트레일, ≥ 익절 | 가격이 `unknown`이면 `unknown` |

- `avgAfterScaleIn`은 분할 매수가 끝났는지 알 수 없어 평단으로 계산하고 `notes`에 적어요.
- 본전 손절(`afterFirstTake: 'breakeven'`)은 1단계 익절 여부를 몰라 `unknown`으로 둬요.
- 토스 ETN 코드는 `Q` 없는 6자리로 와요(`types.ts`의 `ImportStock` 주석). 전략 종목 `s`와 토스 코드 `code`는 `s === code || s === 'Q' + code`면 같은 종목으로 봐요.
- 출력:

```json
{"ok":true,"data":{"asOf":"2026-10-31","holdings":[{"symbol":"005930","quantity":10,"avgPrice":68500,"close":71200,"firstBuyDate":"2026-09-02","stop":{"price":63705,"hit":false},"takes":[{"stage":1,"price":75350,"hit":false}],"stagesDoneUnknown":true,"trail":{"price":70470,"hit":false},"timeExit":{"heldDays":42,"days":20,"hit":true},"signalSell":{"match":false}}]}}
```

- 계산은 판정만 해요. 주문하지 않고 주문안도 만들지 않아요(단계 B).

## 8. 테스트

### 8.1 Worker (`sync-worker/src/cli.test.ts`, 하네스 `sync-worker/test/harness.ts`)

- 기기 코드 흐름: device → token(`pending`) → approve 조회(상태 그대로, `geo` 포함) → approve(true) → token(토큰 한 번) → token 다시(410 `expired`).
- 겹친 폴링: 승인된 기기 코드로 폴링 둘을 겹쳐 보내면(첫 batch 뒤 두 번째가 끼어들도록 `prepare`를 가로챔) `cli_tokens` 행이 1개, 토큰을 받은 응답이 1개, 다른 하나는 410 `expired`.
- 거절: approve(false) → token 403 `denied`.
- 만료: 시계를 10분 넘겨 token 410, approve 422 `invalid-code`.
- 간격: 간격 안의 두 번째 폴링 400 `slow_down`, 저장 간격 +5초. `interval_ms`가 60000 이상이면 `slow_down`만 답하고 저장 간격은 그대로.
- 횟수 제한: 같은 IP 6번째 device 429, 전체 `pending` 51번째 429. 겹친 넣기도 한도를 넘지 않음.
- 읽기 전용 강제(표로 돌려요):

  | 요청 | 기대 |
  |---|---|
  | `GET /v1/profiles` | 200 |
  | `GET /v1/profiles/:id?docVersion=2` | 200 |
  | `GET /v1/profiles/:id`(쿼리 없음)·`?docVersion=1`·`?docVersion=02` | 403 `cli-scope` |
  | `HEAD /v1/profiles` | 403 `cli-scope` |
  | `GET /v1/profiles/`(끝 슬래시)·`GET /v1/profiles/:id/revisions` | 403 `cli-scope` |
  | `PUT /v1/profiles/:id`·`DELETE /v1/profiles/:id`·`GET /v1/keys`·`POST /v1/shares`·`GET /v1/sessions`·`GET /v1/cli/tokens` | 403 `cli-scope` |
  | `DELETE /v1/cli/token` | 200, 그 토큰만 철회(같은 사용자의 다른 CLI 토큰은 그대로) |
  | `DELETE /v1/cli/token`을 허용 Origin+세션으로 | 404 |
- Origin: Origin 없는 세션 요청은 지금처럼 403 `origin`. Origin이 있는 요청에 `Gazua-CLI` 헤더면 CLI 경로로 가지 않음(세션 인증 실패).
- 철회·만료: `DELETE /v1/cli/tokens/:id` 뒤 401 `cli-token-revoked`, 90일 뒤 401 `cli-token-expired`. 남의 토큰 철회 404.
- 「다른 기기 모두 로그아웃」 뒤에도 CLI 토큰은 살아 있음.
- 허용 목록에서 빠진 사용자 403 `not-allowed`(이메일 사용자, `kakao:` 소셜 사용자 각각).
- IP: 같은 IPv6 /64의 다른 주소도 같은 횟수로 셈(`::` 줄임 표기 포함). IPv4-mapped IPv6는 같은 IPv4와 같은 묶음. `CF-Connecting-IP`가 없으면 `'unknown'` 묶음. `geo`는 64자로 잘림. `CLI_IP_SALT`가 없으면 device 503 `cli-disabled`.
- 저장값: `cli_grants`·`cli_tokens`에 원문 코드·토큰이 없음(해시만).
- 정리: `purge`가 만료 grant·오래된 토큰을 지움.
- 하네스: `sync-worker/test/harness.ts`의 `env`에 `CLI_IP_SALT` 기본값을 넣어요. `cli-disabled` 503 테스트만 이 값을 빼요.

### 8.2 CLI (`cli/src/*.test.ts`, vitest, fetch 흉내)

- `direct.ts`: 토스 `POST /api/v1/orders`·KIS 주문 TR 경로·없는 경로는 fetch 없이 `path-blocked`. 허용 경로는 `UPSTREAM` 주소로 보냄.
- `output.ts`: 키·토큰·`accountSeq`가 들어간 객체·오류 메시지가 `[숨김]`으로 나옴. 표준 출력이 JSON 한 줄.
- `config.ts`: 파일 권한 600·디렉터리 700, 넓은 권한 경고, rename 쓰기.
- `fileLock.ts`: 두 잠금이 겹치면 하나씩, 같은 host의 죽은 pid(ESRCH) 잠금은 회수(지우기 직전 nonce 재확인), 살아 있는 pid 잠금은 회수하지 않고 대기 상한(30초) 뒤 `token-busy`, 다른 host 잠금과 깨진 잠금은 회수 안 함, 해제는 자기 nonce일 때만. 잠금 안에서 다른 실행이 저장한 토큰을 다시 읽어 발급하지 않음. 회수 경합 재현 테스트는 두지 않아요(§4.2 한계).
- 토큰 파일: 공급자별 파일, 두 공급자 동시 갱신에도 서로의 항목이 남음. 토큰·주문 캐시 읽기에도 644 파일·755 디렉터리 경고. 토스 `issuedAt`: 재시작한 실행의 캐시 토큰이 거절돼도 1분 안이면 `token-contended`. 환경변수 키·접근 토큰이 성공·인자 오류·표준 오류 출력에서 `[숨김]`.
- `orderCache.ts`: 처음 전체 받기, 다음에는 `syncedThrough` 7일 전부터만 받아 합침, `accountSeq`가 파일에 없음.
- `logout`: 서버 철회 호출 뒤 파일 삭제, 서버 실패여도 파일 삭제와 `warnings`. 401 `cli-token-revoked`·`cli-token-expired`는 성공(`warnings` 없음)으로 보고 파일만 삭제.
- `login`: 폴링 `pending` → `slow_down`(간격 증가) → 토큰, `expired`·`denied` 오류 코드.
- `syncClient.ts`: `Authorization: Gazua-CLI` 헤더, `docVersion=2` 쿼리, 401·403·404·422 → 오류 코드 표.
- `profileData.ts`: v1 문서 옮겨 읽기, 프로필·전략 이름 찾기(없음·여럿).
- `signals.ts`: venue별 마감(KRX 15:30·통합 20:00) 전후 `--today` 기준 봉, 휴장일, `firstDayIdx` = 기준 봉, 엔진과 같은 조건 판정(Task 대표 입력으로 `createRuleEvaluator` 결과와 비교), 첫 매수일(이력 맞음·모자람), 손절·익절·트레일·기간 청산 가격·도달, `unknown` 처리.
- 번들 검사: `dist/gazua.mjs`에 `import.meta.env`·`window.`·`navigator.locks`가 없음.

### 8.3 앱

- `CliConnect.svelte`: 코드 정규화(소문자·하이픈 없음 → `XXXX-XXXX`), 조회 → 확인 대화상자(이름·문구) → 허락·거절 호출, 422·404 문구, axe.
- `SyncManage.svelte`: CLI 묶음 목록·연결 끊기·404 안내, 「다른 기기 모두 로그아웃」 문구, axe.
- `http.ts`: `urlFor`가 없으면 지금 주소, 있으면 그 주소.
- `kis.ts`: `tokenLock`을 넘기면 발급이 잠금 안에서 일어남.
- `routes.ts`: `parseHash('#/settings/sync')` = `{ name: 'settings', section: 'sync' }`. `hashFor`는 `section`이 있어도 `#/settings`(왕복 아님), 기존 `#/settings` 그대로.
- `toss.ts`: 보유의 `avgPrice` 읽기(`averagePurchasePrice`), 없거나 숫자가 아니면 빠짐.

## 9. 배포

1. 병합.
2. D1 마이그레이션: `corepack pnpm --filter sync-worker migrate:remote`(`0005_cli.sql`). 시크릿 `CLI_IP_SALT`(32바이트 무작위)를 `wrangler secret put`으로 넣어요.
3. Worker 배포: `corepack pnpm --filter sync-worker run deploy`.
4. 앱은 병합 때 자동 배포될 수 있어요. 앱이 Worker보다 먼저 나가면 CLI 승인 화면·CLI 목록이 404를 받고 「서버 업데이트가 필요해요」를 보여요. 다른 동작은 그대로예요.
5. CLI는 저장소에서 `corepack pnpm --filter gazua-cli build` 뒤 `node cli/dist/gazua.mjs` 또는 `corepack pnpm --filter gazua-cli link --global`로 써요. npm 배포는 하지 않아요.
6. README(`cli/README.md`)에 설치·로그인·환경변수·토스 허용 IP 등록·명령표와 **「CLI용 토스 앱을 따로 만드세요. 앱과 같은 토스 키를 쓰면 토큰이 서로 무효가 돼요」** 경고를 적어요.

## 10. 범위 밖 (다시)

주문·주문안(단계 B·C), MCP 서버, 키 금고 복호화, 선정 기준 실행, 프로필·전략 쓰기, 공유, 데모 공급자(CLI는 실제 키만 써요).

## 11. 바뀌는 파일

| 파일 | 변경 |
|---|---|
| `sync-worker/migrations/0005_cli.sql` | 새 파일(§3.1) |
| `sync-worker/src/cli.ts` | 새 파일: device·token·approve·tokens·자기 토큰 철회, CLI 토큰 인증, 읽기 전용 허용 목록, 횟수 제한, IP HMAC |
| `sync-worker/src/env.ts`, `wrangler.toml` 주석 | `SyncEnv`에 선택 필드 `CLI_IP_SALT?: string`(시크릿) |
| `sync-worker/test/harness.ts` | `env`에 `CLI_IP_SALT` 기본값(503 테스트만 뺌) |
| `sync-worker/src/handler.ts` | Origin 없는 CLI 분기(§3.3), 앱 경로 3개 |
| `sync-worker/src/purge.ts` | grant·토큰 정리 |
| `sync-worker/src/cli.test.ts`, `sync-worker/README.md` | 테스트, 배포 문서 |
| `src/lib/providers/http.ts`, `types.ts`, `toss.ts` | `urlFor`, `avgPrice`(§6.2) |
| `src/lib/sim/rules.ts` | `signal()` 결과에 선택 필드 `group`(§7.1) |
| `src/lib/sync/api.ts`, `controller.svelte.ts` | CLI 승인·목록·철회 |
| `src/lib/state/routes.ts` | `parseHash`가 `#/settings/sync`를 받음(`hashFor`는 그대로, §5.3) |
| `src/routes/Settings.svelte` | `section: 'sync'`이면 「CLI 코드」 칸에 초점(§5.3) |
| `src/lib/providers/kis.ts` | `tokenLock` 선택 인자(§4.2) |
| `src/lib/ui/settings/CliConnect.svelte`(새), `SyncPanel.svelte`, `SyncManage.svelte` | 화면(§5) |
| `cli/**` | 새 패키지(§6.1) |
| `pnpm-workspace.yaml` | `'cli'` |

## 12. 문서 점검

- 엔드포인트 경로·코드·테이블 열 이름은 §3·§6.6·§8에서 같은 이름을 써요.
- 「읽기 전용」은 서버(§3.3)·증권사 호출(§6.3)·명령 목록(§6.7) 세 곳에서 따로 지켜요.

## 13. 확인 필요

1. Cloudflare Workers Rate Limiting 바인딩을 무료 계정에서 쓸 수 있는지. 쓸 수 있어도 이번에는 D1 방식으로 가요.
2. 토스 허용 IP: CLI를 쓰는 기기의 공인 IP가 지금 등록한 IP(프록시 기기)와 같은지, 여러 IP를 등록할 수 있는지.
3. 토스 `averagePurchasePrice`가 수수료 포함 평단인지, 분할 매수·일부 매도 뒤 어떻게 계산되는지(토스 API 문서).
4. 토스 개발자 콘솔에서 앱(client ID)을 여러 개 만들 수 있는지(CLI용 키 분리, §4.2).
5. Cloudflare 무료 한도 숫자(Workers 하루 10만 요청, D1 읽기 500만·쓰기 10만 행)를 배포 전 계정 화면에서 다시 확인.

검토 1회차에서 답을 받은 항목(승인 화면 경로, 소셜 허용 목록 판정, 기본 서버 주소, `simText` 번들, ETN 코드 맞추기, `logout` 서버 철회)은 본문에 반영했어요.
