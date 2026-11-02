# gazua CLI (읽기 전용)

터미널 AI 도구가 가즈아의 데이터를 읽고 계산하게 해 주는 명령줄 도구예요. 앱과 같은 엔진·같은 데이터를 쓰고, 출력은 JSON 한 줄이에요.

- 읽을 수 있는 것: 동기화한 프로필·관심 그룹·전략, 증권사 시세, 토스 보유, 전략 신호, 시뮬레이션 요약.
- 할 수 없는 것: **주문**과 모든 쓰기. 서버(Worker)는 CLI 토큰으로 `GET /v1/profiles`, `GET /v1/profiles/:id?docVersion=2`, 자기 토큰 철회만 받아요. 증권사 호출도 프록시와 같은 허용 목록(`proxy/src/allowlist.ts`)으로 주문 경로를 막아요. 주문은 다음 단계예요.

## 설치

저장소에서 빌드해서 써요. npm으로 배포하지 않아요. Node 22.13.0 이상이 필요해요. 이 버전부터 내장 `node:sqlite`를 별도 플래그 없이 쓸 수 있어요([Node 문서](https://nodejs.org/download/release/v22.13.0/docs/api/cli.html#--no-experimental-sqlite)).

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

서버 주소는 `--server` > `GAZUA_SYNC_URL` > 빌드에 넣은 기본값 순서로 정해요. `https`만 받아요(로컬 개발의 `localhost`·`127.0.0.1`·`[::1]`만 `http`). 로그인한 뒤에는 `auth.json`에 저장한 서버 주소를 써요.

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

Drive 전달용 환경변수는 아래 「Drive 전달」 절에 있어요.

`--provider kis|toss`를 주지 않으면 키가 있는 쪽을 쓰고, 둘 다 있으면 `toss`예요.

**CLI용 토스 앱을 따로 만드세요. 앱과 같은 토스 키를 쓰면 토큰이 서로 무효가 돼요.** 토스는 같은 앱(client ID)으로 새 토큰을 받으면 앞 토큰이 무효가 될 수 있어서, 가즈아 앱과 CLI가 같은 키를 쓰면 서로의 토큰을 계속 무효로 만들어요. 토스 개발자 콘솔에서 CLI용 앱을 하나 더 만들어 다른 client ID·secret을 쓰세요(콘솔에서 앱을 여러 개 만들 수 있는지는 확인이 필요해요).

토스는 **허용 IP**에서만 받아요. CLI를 쓰는 기기의 공인 IP를 토스 개발자 콘솔에 등록하세요. 막히면 `ip-not-allowed`가 나와요.

같은 기기에서 CLI를 여러 개 동시에 돌려도 토큰 발급은 `~/.config/gazua/<공급자>.lock.db`의 SQLite 쓰기 잠금으로 한 번에 하나씩만 해요. `BEGIN IMMEDIATE`로 잠그고 끝나면 `COMMIT`(실패하면 `ROLLBACK`) 후 DB를 닫아요. 30초 안에 잠금을 얻지 못하면 `token-busy`예요. 프로세스가 종료되면 운영체제가 잠금을 풀기 때문에 오래된 잠금을 회수할 필요가 없어요. DB 파일은 그대로 두어요.

## 명령

공통 옵션: `--profile <이름|ID>`, `--keep <1~5>`(`drive upload`에서 Drive에 남길 보관본 수, 기본 2), `--pretty`(들여쓴 JSON), `--verbose`(진행 로그를 표준 오류로), `--env-file <경로>`. 프로필이 여럿인데 `--profile`이 없으면 `profile-required`와 목록이 나와요.

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
| `gazua drive login` | 시장 파일 업로드용 서버 로그인 + Google 로그인 | ○ | |
| `gazua drive upload <파일> [--keep N]` | 시장 파일을 Drive에 올리고 서버에 등록 | ○ | |
| `gazua drive status` | Drive 로그인 상태와 올린 시장 파일 목록 | ○ | |
| `gazua drive logout` | 서버·Google 접근 철회 + 파일 삭제 | ○ | |
| `gazua simulate --strategy <이름\|ID> [--from YYYY-MM-DD --to YYYY-MM-DD]` | 시뮬레이션 요약 | ○ | ○ |

`signals`의 기준 봉은 마지막 완성 일봉이에요. `--today`가 없으면 어제까지, `--today`면 그 venue 마감 뒤(KRX 15:30·통합 20:00 KST)이고 오늘이 거래일일 때만 오늘까지예요. 토스는 통합 일봉이라 늘 20:00 기준이에요. 판정은 매수·매도 조건과 손절·익절·트레일링·기간 청산 가격만 계산하고 주문하지 않아요. 앱의 시뮬레이션과 다른 점은 출력의 `notes`에 적혀 있어요.

## MCP 서버

Claude Code 같은 MCP 클라이언트가 셸 대신 도구 호출로 같은 데이터를 읽게 해요. CLI와 같은 번들이고, 결과는 CLI의 JSON과 같아요. 읽기 전용이라 주문·쓰기 도구는 없어요.

```bash
gazua mcp [--env-file <경로>] [--verbose]
```

| 도구 | 인자 | CLI 대응 |
|---|---|---|
| `profiles` | 없음 | `gazua profiles` |
| `watchlists` | `profile?` | `gazua watchlists` |
| `strategies` | `profile?`, `raw?` | `gazua strategies` |
| `quote` | `symbols`(필수, 문자열 배열), `provider?` | `gazua quote` |
| `holdings` | `provider?` | `gazua holdings` |
| `signals` | `strategy`(필수), `profile?`, `provider?`, `today?` | `gazua signals` |
| `simulate` | `strategy`(필수), `profile?`, `provider?`, `from?`, `to?` | `gazua simulate` |

- 인자 이름은 CLI 옵션과 같아요. 명령을 실행하다 난 오류의 코드·메시지는 CLI 그대로예요(예: 「--profile로 골라 주세요」는 `profile` 인자를 주라는 뜻). 인자 모양이 틀리면(모르는 인자, 틀린 형, 빠진 필수 인자) MCP용 문구의 `invalid-args`예요.
- 실패한 도구 호출은 `isError: true`와 CLI의 `{"ok":false,"error":…}`를 돌려줘요. 모르는 도구 이름(`login`·`logout` 포함)은 JSON-RPC 오류 `-32602`예요.
- 로그인은 도구가 아니에요. 사람이 터미널에서 `gazua login`을 한 번 해 두면, 서버를 다시 띄우지 않아도 다음 호출부터 통해요.
- 증권사 키는 서버를 띄울 때의 환경변수나 `--env-file`로만 받아요. 키를 바꾸면 서버를 다시 띄워요.
- 호출은 한 번에 하나씩 차례로 돌아요. 진행 로그(`--verbose`)는 표준 오류로 나가요.
- 지원하는 MCP 프로토콜 버전은 `2025-06-18`·`2024-11-05`예요.

### Claude Code에 등록

```bash
corepack pnpm --filter gazua-cli build
claude mcp add gazua -- node /절대/경로/gazua/cli/dist/gazua.mjs mcp --env-file /절대/경로/broker.env
```

- `broker.env`에는 `KIS_APP_KEY=…`처럼 위 「증권사 키」 표의 환경변수를 적어요. 파일 권한은 600으로 두세요.
- `claude mcp add gazua -e TOSS_CLIENT_ID=… -e TOSS_CLIENT_SECRET=… -- …`로도 넘길 수 있지만, 그러면 키가 Claude Code 설정 파일에 들어가요. `--env-file`을 권해요.
- `gazua`를 전역 링크했다면 `claude mcp add gazua -- gazua mcp --env-file /절대/경로/broker.env`.
- 등록을 확인하려면 `claude mcp list`. 지우려면 `claude mcp remove gazua`.
- CLI용 토스 키 분리 경고는 MCP에도 그대로예요. MCP 서버와 CLI는 같은 토큰 파일·잠금을 써서 서로의 토큰을 무효로 만들지 않아요.

## 전략 비판 스킬

저장소에 Claude Code 프로젝트 스킬 `.claude/skills/strategy-critique/`가 있어요. 위 MCP 서버를 등록한 뒤 이 저장소에서 Claude Code를 열고 「데모 RSI 반등 전략 약점 따져 줘」처럼 요청하면 써요.

- 결과는 **참고 의견이며 매매 신호가 아니에요.** 출력 처음과 끝에 이 문구가 고정으로 들어가요. 종목을 사거나 팔라는 말은 하지 않아요.
- 부르는 도구는 `strategies`(원 규칙까지)·`simulate`(전체 기간, 1년 이상이면 앞·뒤 반 두 번 더)·`signals`, 프로필이 여럿일 때만 `profiles`예요. 주문·쓰기·파일 쓰기는 없어요.
- 강세·약세·리스크 역할이 입력 필드를 근거로 들어 따지고, 정리자가 개선 아이디어 2~4개를 전략 빌더 조건식(JSON 한 줄과 바꿀 곳)으로 내요. 조건 종류·범위는 `reference/conditions.md`에 있고 엔진과 같은지 테스트(`cli/src/skill.test.ts`)가 확인해요.
- 아이디어의 효과는 스킬이 판단하지 않아요. 앱에서 전략을 복사해 아이디어 하나만 바꾸고, 같은 기간과 앞·뒤 반 기간을 다시 시뮬레이션해 비교하세요.
- 데모: 가짜 서버로 띄운 MCP 결과(`examples/demo/*.json`)로 돌린 출력이 `examples/demo-run.md`예요. 엔진이나 출력 모양이 바뀌어 테스트가 실패하면 `UPDATE_DEMO=1 corepack pnpm --filter gazua-cli test src/skill.test.ts`로 데모 입력을 다시 만들고, 데모 출력도 다시 돌려요.

## 출력

CLI 명령의 출력이에요. MCP 서버는 같은 JSON을 도구 결과의 텍스트로 돌려줘요.

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
| `drive-not-configured` | Drive 설정이 없음: Drive 설정(`GAZUA_DRIVE_CLIENT_ID`·`GAZUA_DRIVE_CLIENT_SECRET`)이 필요 |
| `drive-login-required` | Drive 로그인이 필요함 → `gazua drive login` |
| `drive-login-timeout` | Google 로그인을 5분 안에 마치지 못함 |
| `drive-denied` | Google에서 Drive 권한을 허용하지 않음 |
| `drive-quota` | Drive 공간이나 요청 한도에 걸림 |
| `drive-failed` | Drive 요청 실패(서버 시장 파일 경로의 500 포함) |
| `market-file-invalid` | 올릴 수 없는 시장 파일 |
| `market-limit` | Drive 보관본이 서버 한도(10개)에 참 → 앱에서 보관본 지우기 |
| `internal` | 그 밖 |

## Drive 전달

수집한 시장 파일(`market-data-*.json.gz`)을 내 Google Drive의 앱 전용 폴더(appDataFolder)에 올리고, 앱이 설정 › 데이터에서 받게 해요. 업로드는 사람이 실행한 명령으로만 해요.

| 환경변수 | 쓰임 |
|---|---|
| `GAZUA_DRIVE_CLIENT_ID`, `GAZUA_DRIVE_CLIENT_SECRET` | Google OAuth 클라이언트(데스크톱 앱 유형) |
| `GAZUA_DRIVE_PORT` | 로그인 콜백 포트(기본 53682) |

설정 순서:

1. Google Cloud 콘솔에서 Drive API를 켜고 OAuth 클라이언트(데스크톱 앱)를 만들어요. 범위는 `drive.appdata`만 써요.
2. 승인된 리디렉션 URI에 `http://127.0.0.1:53682/`를 등록해요. `GAZUA_DRIVE_PORT`로 포트를 바꾸면 그 주소(`http://127.0.0.1:<포트>/`)도 등록해야 해요.
3. 위 두 환경변수(또는 `--env-file`)를 넣고 `gazua drive login`을 실행해요. 앱의 설정 › 동기화·공유 › CLI 연결에 코드를 넣고, 브라우저에서 Google 권한을 허용해요.
4. `gazua drive upload ~/gazua-data/market-data-20261031.json.gz`로 올려요. 같은 파일이 이미 올라가 있으면 다시 올리지 않고, 최근 `--keep`개(기본 2)만 남기고 지워요.
5. 앱 설정 › 데이터에서 Drive의 시장 파일을 받아요.

`gazua drive login`이 받는 CLI 토큰은 시장 파일 목록을 올리고 지우는 데만 쓸 수 있고, 프로필·키는 읽지 못해요.

배포 순서: D1에 `0006_market_files.sql` 적용 → Worker 배포 → 앱 배포. 앱이 먼저 나가면 시장 파일 목록 요청이 실패해요.

## 저장 파일

`~/.config/gazua/`(`XDG_CONFIG_HOME`이 있으면 `$XDG_CONFIG_HOME/gazua/`). 디렉터리 700, 파일 600이에요. 권한이 더 넓으면 `warnings`로 알려요.

| 파일 | 내용 |
|---|---|
| `auth.json` | 서버 주소와 CLI 토큰 |
| `drive-auth.json` | 시장 파일 업로드 전용 CLI 토큰(`gazua drive login`) |
| `drive.json` | Google 갱신 토큰(Drive appDataFolder 접근) |
| `tokens-kis.json`, `tokens-toss.json` | 증권사 접근 토큰 캐시(공급자마다 하나, 키 해시·발급 시각 포함, 키 원문 없음) |
| `kis.lock.db`, `toss.lock.db` | SQLite 토큰 발급 잠금 DB(600, 프로세스 종료 시 잠금 자동 해제, 파일 유지) |
| `orders-<키 해시>-<계좌 해시>.json` | 토스 주문 이력 캐시(`signals`의 첫 매수일 계산용) |

## 배포 순서 (관리자)

1. 변경을 `main`에 **병합**해요.
2. D1에 `0005_cli.sql`을 적용해요: `corepack pnpm --filter sync-worker migrate:remote`.
3. 시크릿 `CLI_IP_SALT`(32바이트 무작위)를 넣어요: `corepack pnpm --filter sync-worker exec wrangler secret put CLI_IP_SALT`. 이 값이 없으면 `gazua login`이 `server-outdated`로 끝나요(서버가 503 `cli-disabled`).
4. Worker를 배포해요: `corepack pnpm --filter sync-worker run deploy`(= `wrangler deploy`).

앱이 Worker보다 먼저 나가면 CLI 연결 화면이 「서버 업데이트가 필요해요」를 보여 줘요. 다른 동작은 그대로예요.
