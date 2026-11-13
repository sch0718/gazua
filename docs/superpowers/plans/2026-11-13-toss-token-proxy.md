# 토스 토큰 프록시 구현 계획

> 설계: `docs/superpowers/specs/2026-11-13-toss-token-proxy-design.md`(이하 「설계」). 이 계획은 파일·순서·검증만 적는다. 동작 세부는 설계의 절 번호를 따른다.

**목표:** 토스 토큰 발급을 맥 프록시 한 곳으로 모으고, 웹·CLI·수집 스크립트는 프록시가 맡으면 토큰 없이 프록시로 보낸다.

## 지킬 것

- 사용자에게 보이는 문구·주석·커밋 메시지는 한국어. 기존 문체(「~해요」)를 따른다.
- 토스 키·토큰·프록시 토큰 값을 로그·응답·오류 문구·시험 스냅샷에 남기지 않는다. 시험 값은 `test-client-id` 같은 가짜 문자열.
- 실제 네트워크를 쓰지 않는다. 시험은 전부 가짜 `fetch`.
- `proxy/.env`는 읽거나 고치지 않는다.
- 키가 없거나 프록시가 맡지 않으면 지금 동작이 그대로여야 한다(기존 시험이 깨지면 안 된다).
- 작게: 새 추상화·설정 키를 늘리지 않는다. 기존 시험 파일에 시험을 더한다.

## 순서

각 작업은 시험을 먼저 쓰고(실패 확인) → 구현 → 해당 패키지 시험 통과 → 커밋한다.

### 작업 1. 프록시 토큰 관리자

- 만들기: `proxy/node/tossToken.ts`, `proxy/node/tossToken.test.ts`
- 내보내기:
  ```ts
  export interface TossTokenKeeper { get(): Promise<string>; invalidate(token: string): boolean }
  export function readTossKeys(env: Record<string, string | undefined>): { clientId: string; clientSecret: string } | undefined
  export function createTossTokenKeeper(keys: { clientId: string; clientSecret: string },
    deps: { fetchImpl: typeof fetch; now: () => number; timeoutMs: number; log?: (line: string) => void }): TossTokenKeeper
  ```
- 동작: 설계 4.1. 만료 60초 전 재발급, 동시 `get()`은 발급 1회, 실패는 캐시 안 함, `invalidate`는 마지막 발급 뒤 60초가 지났을 때만 토큰을 버리고 true. 발급은 `UPSTREAM.toss + '/oauth2/token'`(`proxy/src/allowlist.ts`), `redirect: 'manual'`, `AbortSignal.timeout(timeoutMs)`. 실패 로그는 `toss-token: issue failed <status>`(값 없음).
- 시험: 단일 발급, 만료 전 재발급, 60초 안 `invalidate` → false·재발급 없음, 60초 뒤 → true·다음 `get()`이 새로 발급, 실패 뒤 다음 `get()`이 다시 시도, 로그에 키·토큰 문자열 없음, `readTossKeys` 빈 값·공백 → undefined.

### 작업 2. 프록시 핸들러·주문·서버

- 고치기: `proxy/src/handler.ts`, `proxy/node/order.ts`, `proxy/node/server.ts`
- 시험: `proxy/src/handler.test.ts`, `proxy/node/order.test.ts`, `proxy/node/server.test.ts`
- `handler.ts`: `HandleOptions.tossToken?: { get(): Promise<string>; invalidate(token: string): boolean }`(타입만 선언, Worker는 Node 모듈을 import하지 않는다). 설계 4.2: `/health`에 `tossToken: !!opts.tossToken`, 맡음이면 `/toss/oauth2/token` → 403 `toss-token-managed`, 클라이언트 `authorization` 버리고 프록시 토큰, 발급 실패 → 502 `toss-token-failed`, 상류 401이면 `invalidate`가 true일 때만 새 토큰으로 한 번 더(GET만).
- `order.ts`: `createOrderHandler(cfg, deps)`의 `deps`에 `tossToken?`. 있으면 `parseOrder`가 `authorization`을 요구하지 않고, `send` 감사 기록 **전에** `get()`(실패 → 502 `toss-token-failed`, 감사 기록·건수 증가 없음), 상류에 프록시 토큰. 상류 401이면 `invalidate`만(재전송 없음). 없으면 지금 그대로.
- `server.ts`: `env.PROXY_TOKEN`이 있고 `readTossKeys(opts.orderEnv ?? process.env)`가 있으면 관리자를 만들어(`fetchImpl`, `now`, `upstreamTimeoutMs`) `handle`과 `createOrderHandler`에 넘긴다. 시작 로그 `toss-token: proxy` 또는 `toss-token: off`.
- 시험: 맡음일 때 인증 교체(클라이언트가 보낸 `authorization`은 상류에 안 감), `/toss/oauth2/token` 403, 401 → 한 번 재시도, `invalidate` false면 401 그대로, 발급 실패 502, `/health.tossToken` true/false, KIS 요청은 그대로, 키 없을 때 기존 시험 그대로. 주문: 인증 없이 받음·프록시 토큰 사용·401 재전송 없음·발급 실패 시 감사 로그에 send 없음. 서버: 키를 넣은 `orderEnv`로 `/health` true.

### 작업 3. 웹 공통: `/health` 판정·오류 코드

- 만들기: `src/lib/providers/proxyHealth.ts`, `src/lib/providers/proxyHealth.test.ts`
- 고치기: `src/lib/providers/errors.ts`(+ 기존 시험)
- `export async function proxyManagesTossToken(baseUrl: string, fetchImpl: typeof fetch = fetch, timeoutMs = 8000): Promise<boolean>` — 설계 5.1 그대로. 프록시 토큰 헤더를 보내지 않는다. `isRedirect`는 `./http`에서 가져온다.
- `errors.ts`: `ErrorCode`에 `'proxy-token-managed'`, `DESCRIPTIONS`에 「맥 프록시가 토스 토큰을 맡고 있어요. 다시 불러와 주세요」, `PROXY_CODES`에 `'toss-token-managed': 'proxy-token-managed'`, `'toss-token-failed': 'upstream'`.
- 시험: true·false·필드 없음(옛 프록시) / 비2xx·비JSON·`ok !== true`·boolean 아닌 값 → `proxy-unreachable`, 네트워크 오류 → `proxy-unreachable`, 시간 초과 → `timeout`, 3xx → `proxy-redirect`. `classify`가 새 코드를 매핑.

### 작업 4. 웹 토스 제공자·factory

- 고치기: `src/lib/providers/toss.ts`, `src/lib/providers/types.ts`(`orderHeaders` 반환 `authorization?: string`), `src/lib/providers/factory.ts`
- 시험: 기존 `src/lib/providers/toss.test.ts`, `factory.test.ts`
- `TossDeps.creds?`(선택), `proxyManagesToken?: () => Promise<boolean>`. 설계 5.2: 맡음 여부는 성공한 결과만 기억, 맡음이면 `authorization` 없이 호출하고 토큰 관리자를 부르지 않는다. 아님이고 키가 없으면 `new ApiError('invalid-credentials', '토스 키를 넣거나 맥 프록시에 키를 넣어 주세요')`. `api()`는 `token-expired`·`proxy-token-managed`면 기억을 지우고 한 번 다시(맡음 모드에서는 `tokens.invalidate` 안 함). `orderHeaders`는 맡음이면 계좌 키만. `getAccessToken`은 그대로 두되 맡음이면 쓰지 않게 진단에서 처리(작업 5).
- `factory.ts`: 프록시 주소가 있으면 토스 키가 없어도 토스 제공자를 만들고 `proxyManagesToken: () => proxyManagesTossToken(s.proxyUrl.trim(), fetchImpl)`을 넘긴다.
- 시험: 맡음이면 `/oauth2/token` 호출 0번·요청에 `authorization` 없음·`token-contended` 없음, 키 없이 시세 성공, 아님+키 없음 → `invalid-credentials`, 조회 실패 시 발급 없고 다음 호출에서 다시 조회, 맡음→아님 전환(첫 응답 401 → 다시 조회 → 키로 발급) 재시도, factory 키 없음+프록시 → 토스, 프록시 없음 → 데모.

### 작업 5. 웹 진단·설정·온보딩

- 고치기: `src/lib/providers/diagnostics.ts`, `src/lib/ui/settings/Diagnostics.svelte`, `src/routes/Onboarding.svelte`, `src/lib/state/app.svelte.ts`(필요할 때만)
- 시험: `src/lib/providers/diagnostics.test.ts`, `src/lib/ui/settings/Diagnostics.test.ts`, 온보딩 시험이 있으면 그 파일
- 진단(설계 5.4): ② 응답 JSON의 `tossToken === true`이고 공급자가 토스면 ③을 발급·`tokenSource` 없이 `ok`(hint 「맥 프록시가 토큰을 맡아요」), ④는 `authorization` 없이. 키 없어도 실패 아님.
- `Diagnostics.svelte`: 공급자 토스·프록시 주소 있음일 때 카드 맨 위 한 줄 「토스 조회: 맥 프록시가 맡음」/「토스 조회: 이 기기가 직접 받음」. 마운트 때 `proxyManagesTossToken` 한 번, 실패면 숨김.
- 온보딩 4단계(키 입력): 공급자가 토스이고 `proxyManagesTossToken`이 true면 「맥 프록시가 토스 토큰을 맡고 있어서 키 없이 써도 돼요」와 「다음 — 연결 진단」 버튼(`go(5)`)을 키 입력 폼 위에 보인다. 실패·false면 지금 그대로.
- 시험: 맡음이면 ③ ok·발급 요청 없음·④에 인증 없음, 아님이면 기존 그대로. 표시 줄 두 가지. 온보딩 건너뛰기 버튼.

### 작업 6. CLI

- 고치기: `cli/src/providers.ts`, `cli/src/env.ts`, `cli/src/commands/market.ts`, `cli/src/commands/signals.ts`, `cli/src/commands/simulate.ts`, `cli/src/commands/order.ts`, `cli/src/errors.ts`, `cli/src/auto/run.ts`
- 시험: 각 파일의 기존 `*.test.ts`(`providers.test.ts`, `env.test.ts`, `commands/market.test.ts`, `signals.test.ts`, `simulate.test.ts`, `order.test.ts`, `auto/run.test.ts`)
- `providers.ts`: `export function proxyOf(ctx: Ctx): { server: string; token: string; headers: { origin: string; 'x-proxy-token': string } } | undefined`(셋 다 있을 때만, `normalizeServer` 사용, 토큰을 `ctx.redact`에 등록). `order.ts`의 `proxySettings`는 `proxyOf`로 다시 쓰고 없으면 `order-not-configured`(반환 모양 `{ server, headers }` 유지).
- `buildProvider(ctx, 'toss', creds)`: `proxyOf`가 있으면 `createProxyClient({ baseUrl: server, proxyToken: token, fetchImpl: ctx.fetch })`를 감싸 `opts.headers`에 `origin`을 더한 클라이언트, `proxyManagesToken: () => proxyManagesTossToken(server, ctx.fetch)`, 키 선택. 키가 없을 때 `keyHash`는 `keyHashOf('proxy:' + server)`(주문 이력 캐시·토큰 파일 이름이 안정되게). 프록시 설정이 없으면 지금 그대로(키 필수).
- `env.ts`: `chooseProvider(creds, flag?, proxy?: unknown)` — `proxy`가 있으면 토스 키 없이도 `'toss'`(flag가 `toss`이거나 없을 때). `quote`·`makeSignals`·`makeSimulate`는 `proxyOf(ctx)`를 넘긴다. `holdings`는 토스 키와 `proxyOf`가 모두 없을 때만 `no-credentials`.
- `order.ts`: `tossAccount`는 `authorization`이 있을 때만 가림. `sendOrder` 헤더 타입은 `authorization?`. 설계 6.2: `PROXY_ERRORS`에 `'toss-token-failed': 'order-token-failed'`, `proxyCall`은 502·504를 `order-unknown`으로 바꾸기 전에 `error.code === 'toss-token-failed'`이면 `order-token-failed`. `errors.ts`에 `order-token-failed` 문구.
- `auto/run.ts`: `RETRY`에 `order-token-failed`.
- 시험: 키 없이 프록시 env 셋 + `/health` true → `quote`·`holdings`·`signals`·`simulate` 성공, 요청 URL이 `<proxy>/toss/...`, `origin`·`x-proxy-token` 헤더 있음, `authorization`·`/oauth2/token` 없음. 프록시·키 둘 다 없음 → `no-credentials`, 프록시 비관리+키 없음 → `invalid-credentials`. `order`: 맡음 시 `authorization` 없이 전송, 502 `toss-token-failed` → `order-token-failed`, 코드 없는 502 → `order-unknown`. `auto`: `order-token-failed`면 원장 되돌림.

### 작업 7. 수집 스크립트

- 고치기: `scripts/toss-collect.mjs`, `scripts/collect-market-data.mjs`
- 시험: `tests/toss-collect.test.mjs`, `tests/collect-market-data.test.mjs`(있으면, 없으면 선택 함수만 `toss-collect.test.mjs`에)
- `createTossClient({ ..., baseUrl = BASE_URL, headers = {}, proxyManaged = false })`: 모든 요청에 `headers`와 `redirect: 'manual'`, 3xx·`opaqueredirect` → 재시도 없는 치명 오류. `proxyManaged`면 발급하지 않고 `authorization` 없음, 401은 재발급 없이 치명 실패. `clientId`·`clientSecret`은 맡음일 때 선택.
- `collect-market-data.mjs`: `export async function chooseTossSource(env, fetchImpl = fetch)` → `{ proxy: { baseUrl, headers } } | { direct: true }`. 프록시 env 셋이 있으면 `/health`를 `redirect: 'manual'`로 읽어 설계 5.1 규칙대로 판정(조회 실패는 throw). `main()`은 맡음이면 키 검사를 건너뛰고 프록시 클라이언트를 만든다. `KEY_ENV`에 `GAZUA_PROXY_TOKEN` 추가(오류 문구 가림·자식 env에서 제거).
- 시험: 맡음 모드(발급 없음·헤더·`<proxy>/toss` URL), 3xx·`opaqueredirect`에서 fetch 1번만, `chooseTossSource` true/false/옛 프록시/조회 실패 throw.

### 작업 8. 문서

- 고치기: `proxy/README.md`(「토스 토큰을 맥 프록시가 맡기」 절: `.env`에 `TOSS_CLIENT_ID`·`TOSS_CLIENT_SECRET`, `PROXY_TOKEN` 필수, `proxy/macos/install.sh` 다시 실행, 로그 `toss-token: proxy`, 설계 9절의 배포·되돌리기 순서 요약), `cli/README.md`(프록시 env가 있으면 토스 키 없이 쓰는 법, `order-token-failed`), `docs/roadmap.md`(현황 줄 하나: 「토스 토큰을 맥 프록시가 맡음(2026-11-13)」).

## 검증(구현 뒤 이 세션이 직접)

```bash
pnpm check && pnpm test && pnpm build
pnpm -C cli check && pnpm -C cli test && pnpm -C cli build
pnpm -C proxy test && pnpm -C proxy build
pnpm test:scripts
```

모두 통과해야 한다. 실제 토스 호출·주문·`proxy/.env` 접근이 없음을 diff에서 확인한다.
