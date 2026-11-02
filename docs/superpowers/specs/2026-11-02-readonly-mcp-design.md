# 읽기 전용 MCP 서버 설계

> 2026-11-02 · 로드맵 최우선 2(「AI가 쓰는 가즈아 CLI」)의 단계 A 마무리. 읽기 전용 CLI(`docs/superpowers/specs/2026-11-01-readonly-cli-design.md`, #63) 위에서 해요. 한 PR로 내요. 주문(단계 B·C)은 범위 밖이에요.

## 1. 목표

MCP를 쓰는 AI 도구(Claude Code 등)가 CLI를 셸로 부르지 않고 도구 호출로 가즈아 데이터를 읽게 해요. CLI와 **같은 코어·같은 출력·같은 안전장치**를 써요.

- 도구는 CLI의 읽기 명령과 일대일이에요.
- 인증(CLI 토큰), 증권사 토큰 잠금(SQLite), 증권사 허용 목록(`proxy/src/allowlist.ts`), 비밀값 거르기는 CLI 구현을 그대로 불러요. 새로 만들지 않아요.
- 주문·쓰기 도구는 없어요.

### 1.1 정한 것과 근거

사용자 지시에 따라 CLI 설계와의 일관성을 기준으로 정했어요.

| 항목 | 결정 | 근거 |
|---|---|---|
| 진입점 | 같은 번들의 하위 명령 `gazua mcp`(stdio) | CLI 설계 §1.1의 「`cli/` 워크스페이스, esbuild 단일 번들, bin `gazua`」를 그대로 써요. 번들·빌드 검사(§6.1)·설치 방법이 하나로 유지돼요. 별도 bin을 두면 빌드 산출물과 브라우저 코드 검사가 둘이 돼요 |
| MCP 구현 | 의존성 없이 직접 구현(줄 단위 JSON-RPC 2.0, `initialize`·`ping`·`tools/list`·`tools/call`) | CLI는 런타임 의존성이 0개예요(`package.json`에 devDependencies만). 공식 SDK는 zod 등 여러 런타임 의존성을 끌고 오고, 병렬로 도는 다른 세션과 lockfile 충돌도 만들어요. 필요한 프로토콜 범위가 작아 직접 구현이 100~200줄이에요 |
| 도구 | `profiles`·`watchlists`·`strategies`·`quote`·`holdings`·`signals`·`simulate` 7개 | CLI 명령과 같은 이름. `login`·`logout`은 뺌(§3.3) |
| 인자 | CLI 옵션과 같은 이름의 JSON 인자. 검증은 CLI의 `parseArgv`를 그대로 거침(§3.2) | 날짜 달력 검사·`provider` 값 검사가 CLI와 한 군데에서 유지돼요 |
| 결과 | CLI 표준 출력과 **같은 JSON**(`{ok,data,warnings}` / `{ok:false,error,data}`)을 텍스트 콘텐츠 하나로. `ok:false`면 `isError: true` | 사용법 문서·오류 코드표가 CLI와 하나예요. AI 도구가 CLI와 MCP를 섞어 써도 같은 모양을 받아요 |
| 증권사 키 | 서버 프로세스의 환경변수, 또는 `gazua mcp --env-file <경로>` | CLI 설계 §1.1 「환경변수, `--env-file`」. 도구 인자로 키·경로를 받지 않아요 |
| 호출 처리 | 도구 호출을 한 번에 하나씩 차례로 실행 | 주문 이력 캐시(`orderCache.ts`)는 프로세스 사이 동시 쓰기를 가정하지 않아요. CLI는 사람이 명령을 하나씩 돌리는 게 보통이라 문제가 작지만, MCP 클라이언트는 한 프로세스에 병렬 호출을 보낼 수 있어요. 차례로 돌리면 같은 프로세스 안의 경합이 없어요(토큰 잠금은 원래 같은 프로세스 대기도 처리해요, `fileLock.ts`) |

### 1.2 범위 밖

- 주문·주문안(단계 B·C), 모든 쓰기 도구.
- 로그인·로그아웃 도구(§3.3).
- MCP 리소스·프롬프트·샘플링·진행 알림·취소 처리. 도구만 있어요.
- HTTP(Streamable HTTP) 전송. stdio만이에요.

## 2. 지금 구조 (재사용하는 것)

- `cli/src/main.ts`: `run(argv, io)` — 인자 해석 → 명령 분기 → `ok`/`fail` → 거르기 → JSON 한 줄. `COMMANDS` 표.
- `cli/src/context.ts`: `Ctx`(명령이 받는 것), `Io`(주입할 바깥 세계), `Command = (ctx) => Promise<unknown>`.
- `cli/src/args.ts`: `parseArgv` — `node:util` `parseArgs`(strict), `provider`·날짜 검사.
- `cli/src/output.ts`: `createRedactor`, `ok`, `fail`, `render`.
- `cli/src/errors.ts`: `CliError`, `toCliError`, `MESSAGES`.
- `cli/src/session.ts`: `requireAuth`(호출마다 `auth.json`을 읽음), `authedClient`.
- `cli/src/fileLock.ts`: 공급자별 SQLite 잠금, 같은 프로세스 대기(`active` 맵).
- `cli/src/direct.ts`: 허용 목록 밖 경로는 `path-blocked`.

명령 함수는 `Ctx`만 받으므로, MCP 서버는 도구 인자로 `Args`를 만들고 CLI와 같은 방식으로 `Ctx`를 만들어 `COMMANDS[name]`을 부르면 돼요. 다만 이름은 먼저 MCP 도구 표(§3.2)에서 `Object.hasOwn`으로 찾고, 표에 있는 이름만 `COMMANDS`에서 꺼내요(§3.5). `COMMANDS`에는 `login`·`logout`이 있어서예요.

## 3. 설계

### 3.1 파일

| 파일 | 변경 |
|---|---|
| `cli/src/execute.ts`(새) | `COMMANDS`·`SECRET_ENV`·`loadEnvFile`과, `run`에서 떼어 낸 「명령 실행 → `Result`」 함수 `execute(cmd, args, io, redact)`를 둬요. CLI(`main.ts`)와 MCP(`mcp/*`)가 둘 다 이 모듈만 import해서 순환 import가 없어요(`main.ts`가 `mcp/server.ts`를 import하고 `mcp/*`가 `main.ts`를 import하면, 진입점이 `main.ts`인 번들에서 `mcp/*`가 먼저 평가돼 최상위의 `COMMANDS` 읽기가 초기화 전 접근 오류로 깨져요). 의존 방향: `main.ts` → `mcp/server.ts` → `execute.ts`, `main.ts` → `execute.ts` |
| `cli/src/main.ts` | `run`이 `execute`를 써요. 출력은 지금과 같아요. 기존 테스트의 `import { COMMANDS } from './main'`이 그대로 되도록 `COMMANDS`를 다시 내보내요. 분기는 `run`이 아니라 `isMain` 블록에서 해요: `process.argv.slice(2)`의 첫 인자가 `mcp`면 `run` 대신 `serveMcp(argv, io, readline.createInterface({ input: process.stdin, crlfDelay: Infinity }))`를 부르고, 돌려받은 종료 코드를 `process.exitCode`에 넣어요. `Io`·`run`의 모양은 바꾸지 않아요(`Io`에는 표준 입력이 없어요). 서버 옵션은 `mcp` 뒤에만 와요(§3.6). `gazua --env-file x mcp`처럼 옵션이 앞에 오면 지금처럼 `run`이 받아 「알 수 없는 명령이에요: mcp」(`invalid-args`)로 끝나요 |
| `cli/src/mcp/protocol.ts`(새) | 줄 단위 JSON-RPC 처리: 한 줄 해석, 요청·알림 구분, 응답·오류 만들기. 입출력을 주입받는 순수 모듈 |
| `cli/src/mcp/tools.ts`(새) | 도구 7개의 정의(이름·설명·`inputSchema`·`annotations`)와 「도구 인자 → `argv`」 변환 |
| `cli/src/mcp/server.ts`(새) | `serveMcp(argv: string[], io: Io, input: AsyncIterable<string>): Promise<number>`: `argv`는 `mcp`를 포함한 그대로, `input`은 표준 입력의 줄 단위 비동기 반복자(테스트는 배열·생성기로 주입). 서버 옵션 해석(§3.6), `initialize`·`tools/list`·`tools/call`·`ping` 분기, 호출을 차례로 실행. 입력이 끝나면 0, 시작 실패면 2를 돌려줘요 |
| `cli/src/mcp/*.test.ts`(새) | §5 |
| `cli/src/bundle.test.ts` | 번들을 `mcp`로 띄워 `initialize`·`tools/list`·`tools/call` 왕복 |
| `cli/src/readme.test.ts` | README에 MCP 절·도구 이름·등록 명령이 있는지 |
| `cli/README.md` | MCP 절(등록 방법 포함) |
| `docs/roadmap.md` | 단계 A 완료·MCP 반영 |

### 3.2 도구와 인자

공통 인자: `profile`(문자열, 이름 또는 ID), `provider`(`"kis"`·`"toss"`). CLI에서 그 명령이 받는 옵션만 그 도구의 `inputSchema`에 넣어요.

| 도구 | 인자 | CLI 대응 |
|---|---|---|
| `profiles` | 없음 | `gazua profiles` |
| `watchlists` | `profile?` | `gazua watchlists` |
| `strategies` | `profile?`, `raw?`(불리언) | `gazua strategies` |
| `quote` | `symbols`(문자열 배열, 1개 이상, 필수), `provider?` | `gazua quote <종목…>` |
| `holdings` | `provider?` | `gazua holdings` |
| `signals` | `strategy`(필수), `profile?`, `provider?`, `today?`(불리언) | `gazua signals` |
| `simulate` | `strategy`(필수), `profile?`, `provider?`, `from?`, `to?`(`YYYY-MM-DD`) | `gazua simulate` |

변환과 검증:

1. `arguments`가 없으면 `{}`로 다뤄요. `arguments`가 JSON 객체가 아닌 경우(`null`·배열·숫자 등), 스키마에 없는 키·틀린 형(문자열 자리에 숫자 등)·빠진 필수 인자는 모두 `invalid-args` 도구 결과(`isError: true`, §3.5)예요. 형 검사는 도구 정의의 작은 표로 직접 해요(JSON Schema 검증기를 들이지 않아요).
2. 통과한 인자를 `argv`로 바꿔요: 값은 `--이름=값` 한 토큰으로(값이 `-`로 시작해도 옵션으로 읽히지 않게), 불리언은 `true`일 때만 `--이름`, 종목은 맨 뒤 `--` 다음에 둬요. 예: `{symbols:["005930"],provider:"kis"}` → `["quote","--provider=kis","--","005930"]`.
3. `parseArgv(argv)`로 CLI와 같은 검사(`provider` 값, 달력 날짜)를 거쳐 `Args`를 얻어요.
4. 서버 수준 옵션(`envFile`·`verbose`)은 도구 인자로 받지 않아요. `server`·`label`·`pretty`도 없어요. `parseArgv`가 만든 호출별 `Args`의 `verbose`는 서버 시작 때 해석한 `verbose` 값으로 덮어쓴 뒤 `execute(cmd, args, io, redact)`에 넘겨요. `execute`는 CLI와 같이 `args.verbose`로 `ctx.log`와 모르는 오류 스택의 표준 오류 출력을 제어해요.

오류 메시지는 CLI 문구 그대로예요(예: 「--profile로 골라 주세요」). 도구 설명에 「인자 이름은 CLI 옵션과 같아요」라고 적어 AI 도구가 옮겨 읽게 해요. 메시지를 MCP용으로 따로 두면 오류 코드표가 둘이 돼요.

### 3.3 넣지 않는 도구

- `login`: 사람이 앱에서 승인해야 끝나고, 최대 10분 폴링해요. AI 도구가 대신 할 일이 아니에요(CLI 설계 §6.8). 로그인하지 않았으면 도구가 `not-logged-in`(「gazua login을 먼저 실행해 주세요」)을 돌려줘요. 사람이 터미널에서 `gazua login`을 하면 서버를 다시 띄우지 않아도 다음 호출부터 통해요(`requireAuth`가 호출마다 `auth.json`을 읽어요).
- `logout`: 서버 토큰을 철회하고 파일을 지우는 상태 변경이에요. 읽기 전용 도구 모음에 넣지 않아요.

### 3.4 프로토콜

- 전송: stdio. 한 줄에 JSON-RPC 메시지 하나(UTF-8, 끝 `\n`). 표준 출력에는 프로토콜 메시지만 써요. 진행 안내(`ctx.say`)·`--verbose` 로그는 표준 오류예요.
- 서버를 띄우는 동안 `console.log`·`console.info`·`console.debug`를 표준 오류로 돌려 앱 코드가 표준 출력을 더럽히지 못하게 해요(지금 `src/lib`에는 없지만 방어).
- `initialize`: 클라이언트의 `protocolVersion`이 지원 목록(`2025-06-18`·`2024-11-05`)에 있으면 그 값을, 없으면 `2025-06-18`을 돌려줘요. `capabilities: { tools: {} }`, `serverInfo: { name: "gazua", version: <cli/package.json의 version> }`, `2025-03-26`은 지원 목록에서 뺐어요. 그 버전은 JSON-RPC 배치 수신을 필수로 정했고(`2025-06-18`에서 다시 뺌), 이 서버는 배열 묶음을 `-32600`으로 거절해요. 배치를 그 버전에서만 구현하면 처리 경로가 둘이 되고, 알려진 차이로 두면 규격 위반을 안고 가요. `2025-03-26`을 보낸 클라이언트는 `2025-06-18`을 받고 이어 갈지 스스로 정해요(규격의 협상 절차). `instructions`: 「가즈아 읽기 전용 도구예요. 주문·쓰기는 없어요. 로그인은 사람이 터미널에서 gazua login으로 해요. 결과는 gazua CLI의 JSON과 같아요.」
- `notifications/initialized`·그 밖의 알림(`id` 없음): 응답하지 않아요.
- `ping`: `{}`.
- `tools/list`: 도구 7개. 커서는 쓰지 않아요(`nextCursor` 없음).
- `tools/call`: §3.5.
- 모르는 메서드 `-32601`, 해석할 수 없는 줄 `-32700`(`id: null`), JSON-RPC 모양이 아닌 메시지(배열 묶음 포함) `-32600`, 모르는 도구 이름·`params` 모양 틀림 `-32602`. `tools/call`에서 `params` 모양 틀림은 `params` 자체가 JSON 객체가 아니거나 `name`이 문자열이 아닌 경우(누락 포함)예요. 알려진 도구의 `arguments` 검증 실패는 §3.2의 `invalid-args` 도구 결과로 돌려줘요. 예를 들어 `params: {"name":"quote","arguments":5}`는 JSON-RPC 오류가 아니라 `isError: true`인 도구 결과예요.
- 표준 입력이 닫히면 새 줄은 더 받지 않고, 이미 받은 요청은 진행 중인 것과 줄 서 있는 것 모두 받은 차례대로 실행해 응답을 쓴 뒤 종료해요(종료 코드 0). 받은 요청을 버리는 것은 취소 처리라 범위 밖이에요(§1.2).

### 3.5 도구 실행

`tools/call` 하나마다:

1. `name`을 도구 표(§3.2)에서 `Object.hasOwn`으로 찾아요. 표에 없으면(`login`·`logout`·`__proto__`·`constructor` 포함) 명령을 실행하지 않고 `-32602`로 끝내요. `COMMANDS` 조회는 이 확인 뒤에만 해요.
2. 앞 호출이 끝날 때까지 기다려요(§1.1 「호출 처리」).
3. 새 `Redactor`를 만들고 증권사 키 환경변수(`SECRET_ENV`)를 등록해요. 호출마다 새로 만들어 앞 호출의 비밀값 목록이 섞이지 않게 하지만, 키는 매번 다시 등록해요.
4. §3.2로 `Args`를 만들어요. 실패하면 `invalid-args` 결과.
5. CLI와 같은 `execute`로 명령을 실행해 `Result`를 얻어요(`ok`/`fail`, `warnings`).
6. `redact.apply(result)`를 `JSON.stringify`(들여쓰기 없음)해 `{ content: [{ type: "text", text }], isError: !result.ok }`로 돌려줘요.

명령이 던진 모르는 오류는 CLI처럼 `internal`로 바꾸고 도구 결과에는 원문을 내보내지 않아요. 서버의 `--verbose`가 켜져 있으면 CLI와 같이 오류 스택을 호출별 `Redactor`로 거른 뒤 표준 오류에 써요. 서버 프로세스는 계속 돌아요.

`annotations`: 모두 `readOnlyHint: true`. 증권사·동기화 서버를 부르므로 `openWorldHint: true`. `destructiveHint`·`idempotentHint`는 적지 않아요(읽기 전용이면 의미가 없어요).

### 3.6 서버 실행 옵션

```bash
gazua mcp [--env-file <경로>] [--verbose]
```

- 옵션은 `mcp` 뒤에 둬요(§3.1의 분기 기준). `serveMcp`가 받은 `argv`를 `parseArgv`로 해석한 뒤 `envFile`·`verbose` 말고 다른 옵션이나 `mcp` 뒤의 위치 인자가 있으면 `invalid-args`로 시작하지 않아요.
- 시작 실패(인자 오류, `--env-file` 읽기 실패)는 표준 오류에 CLI와 같은 JSON 한 줄을 쓰고 종료 코드 2로 끝나요. 표준 출력은 프로토콜 전용이라 쓰지 않아요.
- `--env-file`은 시작할 때 한 번 읽어요(CLI의 `loadEnvFile`, 이미 있는 환경변수는 덮어쓰지 않음). 키를 바꾸면 서버를 다시 띄워요.

### 3.7 Claude Code 등록 (README에 적음)

```bash
claude mcp add gazua -- node /절대/경로/gazua/cli/dist/gazua.mjs mcp --env-file /절대/경로/broker.env
```

- 키는 `--env-file`(사용자가 관리하는 파일, 권한 600 권장)이나 `claude mcp add -e TOSS_CLIENT_ID=…`로 넘겨요. 후자는 키가 Claude Code 설정 파일에 들어가므로 `--env-file`을 권해요.
- `gazua`를 전역 링크했다면 `claude mcp add gazua -- gazua mcp --env-file …`.
- 토스 키 분리 경고(CLI용 토스 앱)는 MCP에도 그대로예요. MCP 서버와 CLI는 같은 토큰 파일·잠금을 써서 서로의 토큰을 무효로 만들지 않아요.

## 4. 보안

- 읽기 전용은 세 겹이에요: 서버(CLI 토큰 범위, Worker), 증권사 허용 목록(`direct.ts`), 도구 목록(쓰기 도구 없음). MCP는 세 번째 겹만 새로 정하고 앞의 두 겹은 CLI 코드 그대로예요.
- 프롬프트 주입: AI 도구가 악의적 지시를 받아도 이 서버로는 주문·쓰기를 할 수 없어요. 도구 인자로 파일 경로·서버 주소·키를 받지 않아 파일 읽기나 다른 서버로 토큰 보내기도 없어요.
- 비밀값: CLI와 같은 거르기를 도구 결과마다 해요(§3.5). 시작 실패 JSON도 거르기를 거쳐요.
- 결과 안의 외부 문자열(종목 이름, 전략 이름)은 데이터예요. 이 서버는 결과를 해석하지 않아요.

## 5. 테스트 (vitest, fetch 흉내)

- `mcp/protocol.test.ts`: 한 줄 해석, 알림 무응답, `-32700`·`-32600`(배열 포함)·`-32601`, 응답 `id` 보존.
- 순환 import 방지: `mcp/*`와 `execute.ts`는 `main.ts`를 import하지 않음(파일 내용 검사). 번들 실행 테스트(`bundle.test.ts`)가 CLI 명령과 `mcp` 둘 다 뜨는지 확인.
- `mcp/tools.test.ts`: 도구 이름이 `COMMANDS`에서 `login`·`logout`을 뺀 것과 정확히 같음. 모든 도구 `readOnlyHint: true`. 인자 → `argv` 변환(값이 `-`로 시작, `--` 뒤 종목), 모르는 키·틀린 형·빠진 필수·틀린 날짜·틀린 `provider`는 `invalid-args`. `inputSchema`의 키 목록과 검증 표가 같음.
- `mcp/server.test.ts`(주입한 입력 줄 → 출력 줄):
  - `initialize` 버전 협상(지원·미지원), `serverInfo.version`이 `package.json`과 같음, `ping`, `tools/list`.
  - `tools/call`의 결과 텍스트가 같은 인자의 CLI `run` 표준 출력과 같음(`profiles`·`quote` 등, 가짜 동기화 서버·증권사).
  - 실패는 `isError: true`와 CLI와 같은 오류 JSON(`not-logged-in`, `profile-required`의 `data.profiles`).
  - `tools/call`에서 `params`가 객체가 아니거나 `name`이 문자열이 아니면(누락 포함) `-32602`. `params: {"name":"quote","arguments":5}`와 `arguments`가 `null`·배열인 경우는 JSON-RPC `result`에 `isError: true`, 결과 텍스트에 `error.code: "invalid-args"`. `arguments`를 생략하면 `{}`로 검증(`profiles`는 성공, `quote`는 필수 인자 누락으로 `invalid-args`).
  - `tools/call`의 `name`이 `login`·`logout`·`__proto__`·`constructor`·없는 이름이면 `-32602`이고 명령이 실행되지 않음(가짜 fetch 호출 0회, `logout`이면 `auth.json`이 그대로).
  - 증권사 키 환경변수 값이 결과·표준 오류에 나오지 않음(`[숨김]`).
  - 병렬로 보낸 호출 두 개가 겹치지 않고 차례로 돌며 응답 `id`가 맞음.
  - 명령이 모르는 오류를 던져도 `internal` 결과를 돌려주고 다음 호출을 받음.
  - 서버의 `--verbose`가 켜져 있으면 도구 호출의 `ctx.log`와 모르는 오류 스택이 비밀값 거르기를 거친 뒤 표준 오류에 나오고, 꺼져 있으면 나오지 않음. 두 경우 모두 표준 출력에는 JSON-RPC만 나옴.
  - 서버 실행 중 `console.log`가 표준 출력이 아니라 표준 오류로 감.
  - 시작 옵션: 허용 밖 옵션·위치 인자는 종료 코드 2와 표준 오류 JSON, `--env-file`의 키를 쓰고 거름.
  - 입력이 닫히면 진행 중 호출과 줄 선 호출의 응답을 받은 차례대로 모두 쓴 뒤 0으로 끝남(`tools/call` 두 줄을 넣고 바로 입력을 닫는 사례).
- `main.test.ts`: `execute`로 떼어 낸 뒤에도 기존 테스트 그대로 통과(동작 변화 없음).
- `bundle.test.ts`: 빌드한 번들을 `node gazua.mjs mcp`로 띄워 `initialize` → `tools/list`(7개) → `tools/call quote`(가짜 fetch 사전 로드) 왕복, 표준 출력의 모든 줄이 JSON-RPC.
- `readme.test.ts`: MCP 절에 `gazua mcp`, `claude mcp add`, 도구 이름 7개.

## 6. 배포

서버(Worker)·앱 변경이 없어요. 병합 뒤 `corepack pnpm --filter gazua-cli build`로 번들을 다시 만들고 Claude Code에 등록하면 돼요. npm 배포는 하지 않아요.

## 7. 확인 필요

1. Claude Code가 stdio MCP 서버에 넘기는 환경변수 범위(부모 환경 전체인지, `-e`로 준 것만인지). README는 어느 쪽이든 동작하는 `--env-file`을 권해요.
2. 긴 `simulate`가 클라이언트의 도구 호출 시간 제한에 걸리는지. 걸리면 기간을 줄여 다시 부르면 돼요. 진행 알림은 범위 밖이에요.
