# gazua CLI

터미널 AI 도구가 가즈아의 데이터를 읽고 계산하게 해 주는 명령줄 도구예요. 앱과 같은 엔진·같은 데이터를 쓰고, 출력은 JSON 한 줄이에요.

- 읽을 수 있는 것: 동기화한 프로필·관심 그룹·전략, 증권사 시세, 토스 보유, 전략 신호, 시뮬레이션 요약.
- 주문은 사람이 `gazua order … --yes`를 실행할 때만 맥 프록시를 거쳐 보내요. 국내 토스 지정가·당일 주문만 받으며 KIS·정정·취소는 지원하지 않아요. MCP 도구에는 주문이 없어요. 알람은 로컬 기록을 저장하고 ntfy로 알림을 보내요. 증권사 직접 호출은 읽기 허용 목록으로 계속 제한해요.

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

공통 옵션: `--symbols <000660,005930>`(알람 대상 코드를 직접 지정), `--profile <이름|ID>`, `--keep <1~5>`(`drive upload`에서 Drive에 남길 보관본 수, 기본 2), `--pretty`(들여쓴 JSON), `--verbose`(진행 로그를 표준 오류로), `--env-file <경로>`. 프로필이 여럿인데 `--profile`이 없으면 `profile-required`와 목록이 나와요.

| 명령 | 하는 일 | 동기화 | 증권사 |
|---|---|---|---|
| `gazua login` | 기기 코드로 로그인 | ○ | |
| `gazua logout` | 서버 토큰 철회 + 파일 삭제 | ○ | |
| `gazua profiles` | 프로필 목록(ID·이름·리비전·그룹·전략 수) | ○ | |
| `gazua watchlists` | 관심 그룹과 종목 | ○ | |
| `gazua strategies [--raw]` | 전략 목록과 규칙 요약(`--raw`면 원 규칙도) | ○ | |
| `gazua quote <종목…>` | 현재가 | | ○ |
| `gazua order buy\|sell <종목> <수량> <지정가> [--yes]` | 요약, --yes면 맥 프록시로 토스 주문 한 건 | | 토스 |
| `gazua holdings` | 토스 국내 보유(수량·평단) | | 토스 |
| `gazua signals --strategy <이름\|ID> [--today] [--propose]` | 조건 신호 + (토스) 보유 기준 매도 판정(`--propose`면 주문안도) | ○ | ○ |
| `gazua drive login` | 시장 파일 업로드용 서버 로그인 + Google 로그인 | ○ | |
| `gazua drive upload <파일> [--keep N]` | 시장 파일을 Drive에 올리고 서버에 등록 | ○ | |
| `gazua drive status` | Drive 로그인 상태와 올린 시장 파일 목록 | ○ | |
| `gazua drive logout` | 서버·Google 접근 철회 + 파일 삭제 | ○ | |
| `gazua alert premarket\|watch\|test\|stats [--symbols 000660,005930]` | 개장 전 예상·장중 선물·관심 종목 급변 알람·연결 시험·기록 집계 | 관심 그룹 사용 시 ○ | |
| `gazua owner` | 시장 파일에 넣을 수집 계정 표시(`{ owner }`, 32자 hex) | ○ | |
| `gazua simulate --strategy <이름\|ID> [--from YYYY-MM-DD --to YYYY-MM-DD]` | 시뮬레이션 요약 | ○ | ○ |

`owner`는 만료 전 `drive-auth.json`(`gazua drive login`) → `auth.json`(`gazua login`) 순서로 토큰을 골라요. 첫 토큰이 401이면 남은 파일로 한 번 더 시도하고, 쓸 파일이 없으면 `not-logged-in`이에요. 서버가 이 경로를 모르면(옛 Worker) `server-outdated`예요. 수집 스크립트 전용이라 MCP 도구로는 내보내지 않아요.

`signals`의 기준 봉은 마지막 완성 일봉이에요. `--today`가 없으면 어제까지, `--today`면 그 venue 마감 뒤(KRX 15:30·통합 20:00 KST)이고 오늘이 거래일일 때만 오늘까지예요. 토스는 통합 일봉이라 늘 20:00 기준이에요. 판정은 매수·매도 조건과 손절·익절·트레일링·기간 청산 가격만 계산하고 주문하지 않아요. 앱의 시뮬레이션과 다른 점은 출력의 `notes`에 적혀 있어요.

`--propose`를 붙이면 판정을 주문안 `proposals`로도 내요. **어디에도 주문을 보내지 않아요.** 사람이 확인한 뒤 토스 앱이나 `gazua order` 명령으로 직접 주문해요.

- `orders[]`: `side`(BUY·SELL)·`symbol`·`quantity`·`refPrice`(기준 봉 종가)·`amount`·`reason`. `skipped[]`는 조건은 맞았지만 안을 내지 않은 종목과 이유, `buyTotal`은 매수안 금액 합계예요(비용 제외).
- 매수: 매수 조건이 맞고 보유하지 않은 종목. 수량은 1회 금액 ÷ 종가의 내림이에요. 1회 금액은 같은 금액이면 처음 자금 ÷ 종목 수, 그 밖에는 처음 자금 × 비율이에요(계좌 잔고를 읽지 않아요). 분할 매수(추가 매수)는 내지 않아요.
- 매도(토스만): 손절 → 트레일링 스톱 → 기간 청산 → 조건 매도 순으로 처음 맞은 것은 전량, 아니면 맞은 가장 높은 익절 단계예요. 중간 단계는 지금 보유 수량 × 단계 비율, 마지막 단계는 전량이에요. 판정하지 못한 규칙만 있으면 `skipped`예요. 본전 손절은 1단계 익절 여부를 몰라, 종가가 평단 이하일 때 `skipped`로 알려요. 기준 봉이 다른 종목보다 오래된 종목(거래정지 등)은 매수·매도 모두 `skipped`예요.

## 주문

```bash
gazua order buy 005930 10 70000          # 요약만 표시
gazua order sell 005930 1 70000 --yes    # 사람이 확인한 주문 한 건
```

`buy|sell`, 6자리 종목 코드, 양의 정수 수량·지정가(원)를 받아요. 쉼표·소수·지수 표기는 쓰지 않아요. `--yes`가 없으면 프록시 상태를 받아 주문 금액과 한도만 보여 주고, 토스 토큰·계좌도 조회하지 않아요. 1회 주문 금액이 한도와 같거나 크면 프록시가 거절해요. 최종 판정은 맥 프록시가 해요.

| 환경변수 | 쓰임 |
|---|---|
| `GAZUA_PROXY_URL` | 맥 프록시 주소. HTTPS, 로컬 localhost·127.0.0.1·[::1]만 HTTP 허용 |
| `GAZUA_PROXY_TOKEN` | 프록시의 PROXY_TOKEN과 같은 값. 출력에서 가림 |
| `GAZUA_PROXY_ORIGIN` | 프록시 ALLOWED_ORIGINS에 등록한 출처 |

`--yes` 실행에는 기존 `TOSS_CLIENT_ID`·`TOSS_CLIENT_SECRET`도 필요해요. 토큰·종합매매 계좌 조회는 실행 기기에서 토스에 직접 보내므로 그 기기의 공인 IP도 토스 **허용 IP**로 등록해야 해요. 프록시 접속 설정만으로는 조회할 수 없어요. 종합매매 계좌가 없으면 주문을 보내지 않아요.

상태 GET·주문 POST는 리디렉션을 따라가지 않아요. POST는 한 번만 보내며 자동 재시도하지 않아요. `order-unknown`이면 주문이 들어갔을 수 있어요. **토스 앱에서 확인하기 전에는 다시 보내지 마세요.** 응답에 `clientOrderId`가 있으면 함께 표시하고, 없으면 맥 감사 로그의 `send` 줄에서 시각·종목으로 찾아요. `signals --propose`는 계속 주문안 출력만 해요.

Claude는 실제 주문을 실행하지 않는다. 개발·검토는 가짜 fetch와 임시 디렉터리로만 시험하고, 첫 소액 주문은 사용자가 직접 해요. 맥의 설정·중지 파일·감사 로그는 [프록시 안내](../proxy/README.md)의 「주문 경로」를 보세요.

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
| `signals` | `strategy`(필수), `profile?`, `provider?`, `today?`, `propose?` | `gazua signals` |
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

저장소에 Claude Code 프로젝트 스킬 `.claude/skills/strategy-critique/`가 있어요. 위 MCP 서버를 등록한 뒤 이 저장소에서 Claude Code를 열고 「『내 전략 이름』 전략 약점 따져 줘」처럼 요청하면 써요.

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
| `order-not-configured` | 주문 프록시 환경변수 세 개가 없음 |
| `order-disabled` | 맥 프록시에서 주문이 꺼짐(ORDER_ENABLED·ORDER_MAX_AMOUNT 확인) |
| `order-stopped` | 주문 중지 파일이 있음 |
| `order-over-limit` | 1회 최대 금액 이상(이번 금액과 한도 표시) |
| `order-daily-limit` | 오늘 주문 금액 합계가 하루 한도를 넘음 |
| `order-total-limit` | 매수 − 매도 잔액이 총 가용 금액을 넘음 |
| `order-rate-limited` | 분당·하루 주문 건수 한도 도달 |
| `order-busy` | 다른 주문 처리 중 |
| `order-invalid` | 주문 내용이 올바르지 않음 |
| `order-unavailable` | Worker 판이거나 맥 프록시 토큰 설정이 없음 |
| `order-upstream` | 토스 주문 거절(토스 메시지 포함) |
| `order-unknown` | 결과 불명. 토스 앱에서 확인하기 전 재전송 금지 |
| `order-audit-failed` | 맥 감사 로그를 쓸 수 없어 보내지 않음 |
| `proxy-rejected` | GAZUA_PROXY_TOKEN·GAZUA_PROXY_ORIGIN 설정 확인 |
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

## 해외 지표 알람

`gazua alert premarket`은 KST 08:00~08:59에 ES·NQ 일봉으로 관심 종목의 시초가 방향과 등락을 예상해요. 지난 250개 표본으로 두 선물 중 설명력이 높은 하나를 고르며, 유효 표본이 120개보다 적은 종목은 빼요. 진행 중인 선물 봉과 오늘 국내 일봉은 학습에 쓰지 않고, 국내 연휴 동안 쌓인 선물 변화도 반영해요. 유가·미국 금리·달러는 FRED 이력으로 같은 쪽·반대쪽 경향을 구하고 네이버의 오늘 등락을 방향 참고로만 붙여요. 72시간보다 오래된 참고값은 빼고, 금리 변화는 %p로 표시해요.

같은 KST 날짜에 이미 보냈으면 다시 보내지 않아요. 시간 밖 실행은 보내지 않고 `late` 기록을 남겨요. 코스피 상태가 `PREOPEN`·`OPEN` 이외이면 휴장으로 보고 끝내며, 상태 조회가 실패하면 「오늘 장이 열리는지 확인하지 못했어요」를 붙여 보내요. 일부 자료가 없으면 「못 가져온 자료」에 적고, ES·NQ가 모두 없으면 기록만 남겨요. 문구에는 「과거 흐름으로 본 예상일 뿐, 투자 조언이 아니에요」를 붙여요.

적중 줄은 평가한 실제 발송 기록이 20거래일 이상이면 「기록」으로, 그 전에는 마지막 60거래일을 날짜별로 다시 학습한 「백테스트」로 표시해요. 두 성적은 섞지 않아요. `stats`와 다음 개장 전 실행은 실제 보낸 종목만 `시가/전일 종가 − 1`의 방향과 비교해요. `stats`는 종류별 적중률·평가 거래일 수·표본 수·늘 오름 기준을 내고, 개장 전 기록에는 최근 20거래일 추이(`recent20`)도 포함해요. 백테스트 실데이터 관문(적중률 55% 이상이며 늘 오름 기준 초과)은 별도로 확인해야 해요.

`gazua alert watch`는 KST 09:00~15:30이고 코스피가 개장 중일 때 ES·NQ 선물의 10분 급변을 찾아 ntfy로 보내요. 네이버 선물 자료는 10분 지연이며, 정규장 시간대의 동행 베타로 함께 움직일 종목을 표시해요. 같은 실행에서 관심 종목 자체의 10분 급변도 찾아요. 종목마다 최근 정규장 10분 수익률의 표준편차를 기준으로 삼고, 마지막 완성 봉이 그 `GAZUA_ALERT_SPIKE_SIGMA`배를 넘으면 급변이에요. 급변한 종목은 선물 알림과 따로 한 알림으로 묶어 보내고(`kind: "stock"` 기록, 하루 상한에는 1회로 셈), 같은 종목의 같은 봉은 다시 보내지 않아요. 동기화 문서에는 종목명이 없어 알림에 쓸 종목만 네이버에서 이름을 찾고, 못 찾으면 코드로 표시해요. `--symbols 000660,005930`을 주면 로그인 없이 그 코드들을 쓰고, 생략하면 로그인한 프로필의 숨기지 않은 관심 종목을 그룹 순서대로 중복 없이 앞 30개까지 써요. 프로필이 여럿이면 `--profile <ID>`로 골라요. MCP 도구로는 내보내지 않아요.

```bash
./cli/macos/alert-agent/install.sh                     # 빌드 후 설치
./cli/macos/alert-agent/install.sh --symbols 000660,005930  # 로그인 없이 사용
./cli/macos/alert-agent/uninstall.sh                   # 에이전트만 제거
```

설치하면 `~/.config/gazua/alert.env`(또는 `$XDG_CONFIG_HOME/gazua/alert.env`)를 권한 600으로 만들고 시험 알림을 한 번 보내요. 터미널에 나온 토픽을 **휴대폰 ntfy 앱에서 구독하세요**. 토픽은 설치 때 무작위로 만들고 기존 파일은 덮어쓰지 않아요. 토픽을 아는 사람이 구독할 수 있으므로 공유하거나 저장소에 적지 마세요. CLI 결과·오류에서 토픽은 `[숨김]`으로 가려요.

| 환경변수 | 기본값·뜻 |
|---|---|
| `GAZUA_ALERT_NTFY_TOPIC` | 설치 시 생성한 토픽, 필수 |
| `GAZUA_ALERT_NTFY_SERVER` | `https://ntfy.sh` |
| `GAZUA_ALERT_SPIKE_SIGMA` | `2.5`, 급변 기준 표준편차 배수(선물·관심 종목 공통) |
| `GAZUA_ALERT_COOLDOWN_MIN` | `0`, 같은 지표 발송 간격(분), 0은 제한 없음 |
| `GAZUA_ALERT_DAILY_MAX` | `0`, KST 하루 발송 상한, 0은 제한 없음 |
| `GAZUA_ALERT_TOP` | `5`, 오름·내림 각각 표시할 종목 수 |

같은 지표의 같은 봉은 설정과 관계없이 다시 보내지 않아요. 전송 실패도 기록하고 자동 재시도하지 않아요. 유가·금리·달러는 전일 대비 방향 참고값으로만 붙이며, 받지 못한 자료는 알림에 표시해요.

```bash
gazua alert test --env-file ~/.config/gazua/alert.env
gazua alert premarket --env-file ~/.config/gazua/alert.env --symbols 000660,005930
gazua alert watch --env-file ~/.config/gazua/alert.env --symbols 000660,005930
gazua alert stats --pretty
```

`stats`는 실제로 보낸 장중 기록과 지금 받을 수 있는 최근 5거래일 자료를 맞춰 봐요. 발송 시각 뒤 첫 완성 10분 봉의 방향을 써요. `hit`는 방향 적중 비율, `n`은 평가 표본 수, `days`는 평가한 KST 거래일 수, `baseUp`은 늘 오름으로 보았을 때의 적중 비율이에요. 기록이 없으면 모두 0이에요. 기록에 결과를 덧쓰지 않고 실행할 때 계산해요.

에이전트는 `~/Library/LaunchAgents/com.gazua.alert.{watch,premarket}.plist`에 설치돼요. 맥 시간대를 **Asia/Seoul**로 두세요. watch는 월~금 09:10~15:20에 10분마다, premarket은 월~금 08:40에 실행해요. CLI의 날짜·발송 시간 판정은 실행 환경 시간대와 관계없이 KST를 써요. 로그는 `~/Library/Logs/gazua/alert.log`, 상태와 월별 기록은 `<설정 디렉터리>/alerts/`예요. 제거해도 `alert.env`·기록·로그는 남아요. 저장소를 옮기거나 다시 빌드하면 설치 스크립트를 다시 실행하세요.

설치 없이 plist만 확인하려면 `GAZUA_ALERT_DRY=1 GAZUA_ALERT_DRY_DIR=<임시 디렉터리> ./cli/macos/alert-agent/install.sh`를 써요. 이 모드는 설정 파일·에이전트를 바꾸지 않고 launchctl과 시험 발송을 건너뛰어요.
