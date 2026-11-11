# 해외 지표 알람 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 맥 launchd가 `gazua alert`를 돌려, 장중 미국 지수 선물 급변과 개장 전 시초가 방향 예상을 ntfy로 휴대폰에 보낸다.

**Architecture:** 계산은 `cli/src/alert/`의 순수 함수로 하고, 네이버·FRED 읽기는 `cli/src/naverMarket.ts`와 기존 `scripts/fetch-fred.mjs`가 맡는다. `cli/src/commands/alert.ts`가 하위 명령(`watch`·`test`·`stats`·`premarket`)을 나누고 상태·기록을 `<dir>/alerts/`에 남긴다. 설치 스크립트가 launchd 에이전트 두 개를 올린다.

**Tech Stack:** TypeScript, Node 22.13+, vitest(`TZ=America/New_York`), esbuild 번들(`cli/build.mjs`), bash + launchctl.

**설계:** [2026-11-11-macro-alert-design.md](../specs/2026-11-11-macro-alert-design.md). 아래 「설계 §n」은 이 문서의 절이다.

## Global Constraints

- 사용자 1명, 맥 한 대 + 휴대폰, 무료 운영. 증권사 키·토큰을 쓰지 않는다.
- ntfy 토픽은 저장소 어디에도 적지 않는다. `SECRET_ENV`에 넣어 출력·오류에서 가린다. ntfy 오류에는 URL 대신 HTTP 상태만 적는다.
- 알림 문구에 매수·매도 권유를 쓰지 않는다. 개장 전 알림 끝에 「과거 경향이며 투자 조언이 아님」을 붙인다.
- 기본값: `SPIKE_SIGMA=2.5`, `COOLDOWN_MIN=0`, `DAILY_MAX=0`, `TOP=5`. 0은 제한 없음이다.
- 같은 지표의 같은 봉은 설정과 상관없이 두 번 보내지 않는다.
- 네이버 요청에는 UA 헤더를 붙이고 요청 사이 100ms(`ctx.sleep`)를 둔다. 10분 자료의 표기 시각에는 10분을 더해 봉 끝 시각으로 쓴다.
- `alert`는 MCP 도구로 내보내지 않는다(`cli/src/mcp/tools.ts`는 건드리지 않는다).
- 커밋은 작업마다 하되, push·PR·병합은 사용자가 요청할 때만 한다.
- 검토는 PR마다 1회(필요하면 2회차는 Critical만).

## 파일

| 파일 | 할 일 | PR |
|---|---|---|
| `cli/src/naverMarket.ts` (+ `.test.ts`, `fixtures/naver/*.json`) | 네이버 응답 → `Bar10[]`·`DayBar[]`·`IndexQuote`·`marketStatus` | A |
| `cli/src/alert/regress.ts` (+ test) | `fitLine`(상수항 포함 단일 회귀, 결정계수·t값), 표본·분산 검사 | A |
| `cli/src/alert/intraday.ts` (+ test) | 10분 로그수익률, 급변 판정, 동행 베타, 중복·쿨다운·일일 상한, 문구 | A |
| `cli/src/alert/state.ts` (+ test) | 상태 JSON 읽기/쓰기, `YYYY-MM.jsonl` 추가·읽기 | A |
| `cli/src/alert/config.ts` (+ test) | `alert.env` 값 읽기·검사 | A |
| `cli/src/commands/alert.ts` (+ test) | 하위 명령, 대상 종목, ntfy 전송 | A·B |
| `cli/src/execute.ts`, `cli/src/args.ts` | `alert` 등록, `SECRET_ENV`에 토픽, `--symbols` | A |
| `cli/src/execute.test.ts`, `cli/src/readme.test.ts`, `cli/README.md` | 명령 목록·README 표·옵션 | A |
| `cli/macos/alert-agent/install.sh`, `uninstall.sh`, `plist.template` | launchd | A |
| `cli/src/alert/premarket.ts` (+ test) | 선물 일봉 정렬, 민감도, 오늘 예상, 백테스트, 유가·금리·달러 방향 묶음, 문구 | B |

---

## PR A: 장중 급변 알람 + 설치

### Task 1: 네이버 응답 정규화

**Files:** Create `cli/src/naverMarket.ts`, `cli/src/naverMarket.test.ts`, `cli/src/fixtures/naver/{es-week,item-week,es-day,item-day,kospi-polling,dxy}.json`

**Interfaces (Produces):**

```ts
export const NAVER_UA: string; // 데스크톱 Chrome UA
export interface Bar10 { end: number; close: number }        // end = 표기 시각 + 10분(epoch ms)
export interface DayBar { date: string; open: number; close: number } // date 'YYYY-MM-DD'
export interface IndexQuote { changePct: number | null; changeAbs: number | null; tradedAt: number | null }
export function parseFuturesWeek(json: unknown): Bar10[];   // chart/foreign/futures/{ES,NQ}cv1?periodType=week
export function parseDomesticWeek(json: unknown): Bar10[];  // chart/domestic/item/{code}?periodType=week
export function parseDayBars(json: unknown): DayBar[];      // .../day?startDateTime=&endDateTime= (배열, localDate YYYYMMDD)
export function parseIndexQuote(json: unknown): IndexQuote; // marketindex/*, fluctuationsRatio·compareToPreviousClosePrice·localTradedAt("7,520.93" 같은 쉼표 숫자)
export function parseMarketStatus(json: unknown): string | null; // polling KOSPI
export async function naverGet(ctx: Pick<Ctx, 'fetch' | 'sleep'>, url: string): Promise<unknown>; // UA 헤더, 응답 전 100ms sleep, !ok면 throw Error(`naver ${status}`)
export const NAVER = { futuresWeek(sym: 'ES' | 'NQ'): string; futuresDay(sym, from: string, to: string): string; itemWeek(code: string): string; itemDay(code, from, to): string; marketIndex(kind: 'oil' | 'rate' | 'dollar'): string; kospiStatus: string };
```

- 선물 10분 응답의 시각은 CST(`zoneId`), 국내는 KST다. 응답에 있는 zone을 따라 epoch으로 바꾼다. 모양이 다르면(배열·필드 없음) 빈 배열/`null`을 돌려준다(던지지 않음).

- [ ] **Step 1: 고정 응답 저장.** 2026-11-11에 받은 응답을 그대로 `fixtures/naver/`에 둔다. 아래로 받는다(UA는 `CLAUDE.md`와 같은 값).

```bash
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36"; F=cli/src/fixtures/naver; mkdir -p $F
curl -s -A "$UA" "https://api.stock.naver.com/chart/foreign/futures/EScv1?periodType=week" > $F/es-week.json
curl -s -A "$UA" "https://api.stock.naver.com/chart/domestic/item/000660?periodType=week" > $F/item-week.json
curl -s -A "$UA" "https://api.stock.naver.com/chart/foreign/futures/EScv1/day?startDateTime=202409010000&endDateTime=202611110000" > $F/es-day.json
curl -s -A "$UA" "https://api.stock.naver.com/chart/domestic/item/000660/day?startDateTime=202409010000&endDateTime=202611110000" > $F/item-day.json
curl -s -A "$UA" "https://polling.finance.naver.com/api/realtime/domestic/index/KOSPI" > $F/kospi-polling.json
curl -s -A "$UA" "https://api.stock.naver.com/marketindex/exchange/.DXY" > $F/dxy.json
```

- [ ] **Step 2: 실패하는 시험.** 
  - `parseDomesticWeek`: 첫 봉의 `end`가 표기 시각 + 10분(KST)이다.
  - `parseFuturesWeek`: CST 표기를 epoch으로 바꾼 뒤 +10분이다. 11/10 10:00 KST 봉 값을 실제 응답에서 하나 골라 단언한다.
  - `parseDayBars`: 길이가 500 이상, 날짜 오름차순, `open`이 있다.
  - `parseIndexQuote`: 쉼표 숫자를 읽는다. 필드가 없으면 `null`이다.
  - `parseMarketStatus`: 문자열을 돌려준다.
  - 모양이 틀린 입력(`{}`, `null`)은 빈 배열이나 `null`을 돌려준다.
- [ ] **Step 3:** `cd cli && npx vitest run src/naverMarket.test.ts` → FAIL.
- [ ] **Step 4: 구현.**
- [ ] **Step 5:** 같은 명령 → PASS. 그다음 커밋: `feat(cli): 네이버 시세 응답 정규화`.

### Task 2: 회귀와 장중 판정(순수 함수)

**Files:** Create `cli/src/alert/regress.ts`, `cli/src/alert/intraday.ts`와 각 `.test.ts`

**Interfaces:**

```ts
// regress.ts
export interface Fit { alpha: number; beta: number; r2: number; t: number; n: number }
/** 유한한 짝만 쓴다. n < minN이거나 x 분산 0이면 null */
export function fitLine(xs: number[], ys: number[], minN: number): Fit | null;
export function stdev(xs: number[]): number; // 표본 표준편차, n<2면 0

// intraday.ts  (Consumes Bar10)
export const STEP_MS = 600_000;
/** 정규장(KST 09:00~15:30) 안의 봉 끝 시각 → 10분 로그수익률. 앞 봉과 정확히 10분 간격일 때만 */
export function returns10(bars: Bar10[]): Map<number, number>;
export interface Spike { sym: 'ES' | 'NQ'; end: number; change: number; sigma: number }
/** 마지막 완성 봉(end <= now)이 30분 넘게 오래됐거나, 앞 봉이 빠졌거나, 표본<60, 표준편차 0이면 null */
export function detectSpike(sym: 'ES' | 'NQ', bars: Bar10[], now: number, spikeSigma: number): Spike | null;
export interface Mover { code: string; name: string; expected: number } // expected = beta × change
export function rankMovers(spike: Spike, futRet: Map<number, number>, stocks: { code: string; name: string; ret: Map<number, number> }[], top: number): { up: Mover[]; down: Mover[] };
export interface WatchState { lastBar: Partial<Record<'ES' | 'NQ', number>>; lastSent: Partial<Record<'ES' | 'NQ', number>>; sentByDate: Record<string, number>; loginNotified?: string }
export function allowSend(st: WatchState, spike: Spike, now: number, cooldownMin: number, dailyMax: number): boolean;
export function markSent(st: WatchState, spike: Spike, now: number): WatchState;
export function formatSpike(spike: Spike, movers: { up: Mover[]; down: Mover[] }, ref: { oil?: IndexQuote; rate?: IndexQuote; dollar?: IndexQuote }, missing: string[]): { title: string; body: string };
```

- 동행 베타: 종목과 선물의 같은 `end` 수익률 짝으로 `fitLine(fut, stock, 30)`을 구한다. null이면 그 종목을 뺀다.
- `allowSend`는 다음 순서로 판단한다.
  1. `st.lastBar[sym] === spike.end`이면 false.
  2. `cooldownMin > 0`이고 `now - lastSent < cooldownMin×60000`이면 false.
  3. `dailyMax > 0`이고 `sentByDate[kstDate(now)] >= dailyMax`이면 false.
- 문구는 설계 §5.2 예시와 같다. 하락이면 「함께 눌릴 종목 ▼」, 상승이면 「함께 오를 종목 ▲」를 쓴다. 「데이터 10분 지연」을 넣는다.

- [ ] **Step 1: 실패하는 시험.**
  - `fitLine`: `y = 0.001 + 1.5x + 잡음 0`이면 α·β를 복원하고 r2=1이다. 분산 0이거나 n<minN이면 null이다. NaN 짝은 건너뛴다.
  - `returns10`: 09:00 봉(앞 봉 15:30 전날)은 수익률이 없다. 빠진 봉 다음도 없다.
  - `detectSpike`: 평탄한 ±0.01% 봉 300개 뒤 +1% 봉은 Spike다. 마지막 봉이 35분 전이면 null이다. 표준편차 0이면 null이다. 앞 봉이 빠지면 null이다.
  - `allowSend`: 같은 봉은 false다. cooldown 0과 dailyMax 0이면 연속 다른 봉 10개가 모두 true다. cooldown 30이면 20분 뒤 false, 31분 뒤 true다. dailyMax 2면 세 번째가 false다.
  - `formatSpike`: 「투자」「매수」「매도」가 들어가지 않는다. 빠진 지표 줄이 있다.
- [ ] **Step 2:** `cd cli && npx vitest run src/alert` → FAIL.
- [ ] **Step 3: 구현.** 
- [ ] **Step 4:** 같은 명령 → PASS. 그다음 커밋: `feat(cli): 장중 급변 판정과 회귀`.

### Task 3: 설정·상태·기록

**Files:** Create `cli/src/alert/config.ts`, `cli/src/alert/state.ts`와 각 `.test.ts`

**Interfaces:**

```ts
// config.ts
export interface AlertConfig { topic: string; server: string; spikeSigma: number; cooldownMin: number; dailyMax: number; top: number }
/** env에서 읽는다. 토픽이 없으면 CliError('invalid-args','GAZUA_ALERT_NTFY_TOPIC이 없어요. install.sh를 실행해 주세요'), 숫자가 아니거나 음수면 invalid-args */
export function readAlertConfig(env: Record<string, string | undefined>): AlertConfig;

// state.ts  (기존 config.ts의 readJsonFile·writeJsonFile·ensureDir 사용)
export function alertsDir(dir: string): string; // join(dir,'alerts')
export function readState<T>(dir: string, name: 'watch' | 'premarket', empty: T): T; // 못 읽으면 empty
export function writeState(dir: string, name: 'watch' | 'premarket', value: unknown): void;
export interface LogLine { kind: 'watch' | 'premarket' | 'test'; barStart?: number; barEnd?: number; receivedAt: number; sentAt: number | null; changes: Record<string, number>; picks: { code: string; expected: number }[]; delivered: boolean; note?: string }
export function appendLog(dir: string, line: LogLine): void; // alerts/YYYY-MM.jsonl(KST 월), 파일 600
export function readLogs(dir: string): LogLine[];            // 모든 월 파일, 깨진 줄은 건너뜀
```

- [ ] **Step 1: 실패하는 시험.**
  - 기본값을 채운다.
  - 문자열 숫자를 읽는다.
  - `-1`과 `abc`는 invalid-args다.
  - 상태 파일이 깨졌으면 empty다.
  - `appendLog` 두 번 뒤 `readLogs` 길이가 2이고, 파일 권한이 600이다.
  - 월 경계(KST 11/30 23:59와 12/01 00:01)는 두 파일로 나뉜다.
- [ ] **Step 2: 실행.** `cd cli && npx vitest run src/alert` → FAIL.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 실행.** 같은 명령 → PASS.
- [ ] **Step 5: 커밋.** `feat(cli): 알람 설정·상태·기록 파일`

### Task 4: `gazua alert watch|test|stats` 명령과 연결

**Files:**
- Create: `cli/src/commands/alert.ts`, `cli/src/commands/alert.test.ts`
- Modify: `cli/src/execute.ts`(COMMANDS에 `alert`, `SECRET_ENV`에 `'GAZUA_ALERT_NTFY_TOPIC'`), `cli/src/args.ts`(`symbols: { type: 'string' }` 옵션, `Args.symbols?: string[]`; `^\d{6}$`가 아닌 항목이 있으면 invalid-args), `cli/src/execute.test.ts:64-65`(목록에 `alert` 추가), `cli/src/readme.test.ts`(옵션 목록에 `--symbols`), `cli/README.md`(명령 표에 `gazua alert`, 옵션 `--symbols`, 알람 절)

**Interfaces:**

```ts
export const alert: Command; // positionals[0]: 'watch' | 'test' | 'stats' | 'premarket'(PR B 전에는 invalid-args)
export async function sendNtfy(ctx: Ctx, cfg: AlertConfig, msg: { title: string; body: string; tags?: string }): Promise<boolean>;
// ntfy JSON 발행: POST `${server}`(끝 / 없이), 본문 JSON {topic, title, message, tags}. 한글 제목을 헤더에 넣지 않으려고 JSON을 쓴다
// 실패하면 ctx.say(`ntfy 전송 실패: HTTP ${status}`)만 하고 false (URL·토픽 출력 금지)
export async function targetSymbols(ctx: Ctx): Promise<{ code: string; name: string }[]>;
// args.symbols가 있으면 그것(이름은 코드), 없으면 pickProfile → 숨기지 않은 관심 종목 중복 제거 앞 30개
```

`watch`의 흐름은 다음과 같다(설계 §5).

1. KST 시각이 09:00~15:30이 아니면 `{ skipped: 'hours' }`를 돌려주고 끝낸다.
2. `marketStatus`가 `OPEN`이 아니면 `{ skipped: 'closed' }`. 상태를 읽지 못했으면 계속 진행한다.
3. 설정을 읽는다.
4. 상태를 읽는다.
5. ES·NQ 10분 봉을 받는다. 둘 다 실패하면 `ctx.say`로 로그만 남기고 `{ skipped: 'nodata' }`.
6. `detectSpike`로 급변을 본다. 급변이 없으면 `{ spikes: [] }`를 돌려주고 상태는 쓰지 않는다.
7. 급변이 있으면 대상 종목의 10분 봉을 받는다. 종목 하나가 실패하면 그 종목만 뺀다.
8. 유가·금리·달러 참고값을 받는다.
9. 급변마다 `allowSend`를 본다. 통과하면 `sendNtfy`, `markSent`, `appendLog`를 한다.
10. 상태를 쓴다.

로그인 오류는 다음과 같이 처리한다. 대상 종목을 고를 때 CliError가 `not-logged-in`, `cli-token-expired`, `cli-token-revoked` 중 하나면, 그날 첫 번째일 때만 「gazua login 필요」를 보낸다. 그런 뒤 오류를 다시 던진다.

`test`는 「gazua 알람 시험」을 보내고 `{ delivered }`를 돌려준다.

`stats`는 `readLogs`로 기록을 읽어 종류별로 집계한다. 장중 정답은 `sentAt` 뒤 첫 완성 10분 봉의 종목 수익률 방향이다. 지금 받을 수 있는 5거래일 안의 기록만 맞춰 보고, 결과는 기록 줄에 `outcome`으로 덧쓰지 않고 그때그때 계산한다. 돌려주는 값은 `{ kinds: { watch: { hit, n, days, baseUp } } }`이다.

- [ ] **Step 1: 실패하는 시험.** `makeIo`·`fakeFetch`를 쓰고, `env`에 `GAZUA_ALERT_NTFY_TOPIC=testtopic-abcdefghijkl`을 넣는다.
  - 10:40 KST에 고정 응답의 마지막 봉을 +1%로 바꾼 ES를 넣으면 ntfy 호출이 1번 나간다. 기록이 1줄 생긴다.
  - 같은 시각에 다시 돌리면 ntfy 호출이 0번이다(같은 봉).
  - 08:30 KST이면 `skipped: 'hours'`다.
  - ntfy가 500이면 결과 JSON과 `err`에 `testtopic`이 없다. 기록의 `delivered`는 false다.
  - `--symbols 12345`이면 종료 코드 2다.
  - `alert foo`이면 invalid-args다.
  - `stats`는 기록 0줄에서 `n: 0`이다.
- [ ] **Step 2: 실행.** `cd cli && npx vitest run` → 새 시험이 FAIL이다.
- [ ] **Step 3: 구현과 연결 수정.** README 표에 `gazua alert`와 `--symbols`를 넣는다.
- [ ] **Step 4: 실행.** `cd cli && npx vitest run && npx tsc --noEmit -p . && node build.mjs`가 모두 통과한다. 번들 금지 문자열 검사도 통과한다.
- [ ] **Step 5: 손 확인.** 빌드된 CLI로 시험 알림을 보낸다. 토픽은 사용자가 정한 임시 값을 셸 변수로만 쓴다.

```bash
GAZUA_ALERT_NTFY_TOPIC=$TOPIC node cli/dist/gazua.mjs alert test --pretty
```

예상 결과는 `"delivered": true`이고 휴대폰에 알림이 온다. 휴대폰 확인은 사용자에게 부탁한다.
- [ ] **Step 6: 커밋.** `feat(cli): gazua alert watch·test·stats`

### Task 5: launchd 설치·제거

**Files:** Create `cli/macos/alert-agent/install.sh`, `uninstall.sh`, `plist.template`

- 기존 `proxy/macos/install.sh`의 bootout → bootstrap 형식을 따른다.
- 라벨은 `com.gazua.alert.premarket`와 `com.gazua.alert.watch`다. 둘 다 `~/Library/LaunchAgents`에 둔다. 각 에이전트에 `StandardOutPath`와 `StandardErrorPath`를 둔다.
  - `StandardOutPath`는 `~/Library/Logs/gazua/alert.log`다.
  - `StandardErrorPath`도 같은 파일이다.
- premarket은 PR A에서도 설치한다. 이 단계에서 `alert premarket`은 invalid-args로 끝나며, 로그에 한 줄만 남기고 아무것도 보내지 않는다.
- `install.sh`가 하는 일은 다음과 같다.
  1. `set -euo pipefail`을 건다.
  2. `NODE=$(command -v node)`로 node를 찾고, 22.13 이상인지 `node -e`로 검사한다.
  3. `CLI="$REPO/cli/dist/gazua.mjs"`가 있는지 확인한다.
  4. `DIR="${XDG_CONFIG_HOME:-$HOME/.config}/gazua"`를 정한다.
  5. `alert.env`가 없으면 `umask 077`을 건 뒤 토픽 `gazua-$(LC_ALL=C tr -dc a-z0-9 </dev/urandom | head -c 24)`로 만든다. 다른 값은 설계 §3.2의 기본값을 넣는다.
  6. `--symbols`를 쓰지 않으면 `"$NODE" "$CLI" profiles`의 프로필 수를 센다. 2개 이상이면 목록을 보여 주고 `read`로 ID를 받는다.
  7. `plist.template`의 `__NODE__`·`__CLI__`·`__ENV__`·`__PROFILE_ARGS__`·`__LOG__`를 `sed`로 바꿔 plist를 쓴다.
  8. `plutil -lint`로 검사한다.
  9. 에이전트마다 `launchctl bootout gui/$UID/<label> 2>/dev/null || true`를 한 뒤 `launchctl bootstrap gui/$UID <plist>`를 한다. 실패하면 `trap`으로 둘 다 bootout하고 plist를 지운다.
  10. `"$NODE" "$CLI" alert test --env-file "$DIR/alert.env"`를 돌린다.
  11. 마지막에 토픽과 「휴대폰 ntfy 앱에서 이 토픽을 구독하세요」를 출력한다.
- watch의 `StartCalendarInterval`은 월~금 × 09:10~15:20의 10분 간격 항목을 스크립트가 반복문으로 만든다(5 × 38 = 190개).
- `uninstall.sh`는 두 라벨을 bootout하고 plist를 지운다. 없어도 오류가 아니다. 남겨 둔 `alert.env`, `alerts/`, 로그의 경로를 출력한다.

- [ ] **Step 1: 스크립트 작성.**
- [ ] **Step 2: 검사.** `bash -n cli/macos/alert-agent/*.sh`를 돌린다. 임시 출력 디렉터리에 plist만 만드는 `GAZUA_ALERT_DRY=1` 모드로 템플릿을 채우고 `plutil -lint`를 통과시킨다. 이 모드는 launchctl과 test를 건너뛴다.
- [ ] **Step 3: 손 확인.** 이 맥에서 한 번 한다. launchctl을 쓰므로 사용자에게 먼저 알린다.
  1. `./cli/macos/alert-agent/install.sh`를 돌린다.
  2. `launchctl kickstart gui/$UID/com.gazua.alert.watch`로 한 번 실행한다. 장 시간 밖이면 로그에 `skipped`가 나온다.
  3. 다시 설치한다. 오류가 없어야 한다.
  4. `uninstall.sh`를 돌린다. `launchctl print`로 보면 둘 다 없어야 한다.
- [ ] **Step 4: README와 커밋.** `cli/README.md` 알람 절에 설치·제거·토픽 구독·로그 위치를 적고 커밋한다: `feat(cli): 알람 launchd 설치·제거 스크립트`

### Task 6: PR A 마무리

- [ ] 루트 `npm test`, `cd cli && npm test`, `npx tsc --noEmit`, `node cli/build.mjs`를 돌린다.
- [ ] `git grep -n "gazua-[a-z0-9]\{24\}"`의 결과가 없어야 한다(토픽이 저장소에 없다).
- [ ] 검토 1회를 한다(Codex 코드 리뷰 `--base main`). 사실로 확인된 지적만 고친다.
- [ ] 사용자 요청이 있으면 PR을 만든다.

---

## PR B: 개장 전 알람

### Task 7: 개장 전 계산(순수 함수)과 백테스트

**Files:** Create `cli/src/alert/premarket.ts`, `cli/src/alert/premarket.test.ts`

**Interfaces:**

```ts
// Consumes: DayBar(Task 1), fitLine(Task 2)
/** F[d]: localDate < d인 선물 일봉 중 마지막 봉의 종가. 없으면 null */
export function futAt(fut: DayBar[], date: string): number | null;
export interface Sample { date: string; x: number; y: number }
/** 국내 거래일 t(두 번째부터)마다 y=ln(open_t/close_{t-1}), x=ln(F[t]/F[t-1]). |y|>0.3, 비유한 값 제외 */
export function samples(stock: DayBar[], fut: DayBar[]): Sample[];
export interface Model { sym: 'ES' | 'NQ'; fit: Fit }
/** 날짜 < asOf인 마지막 250표본으로 ES·NQ 각각 fitLine(minN 120), r2 큰 쪽. 둘 다 null이면 null */
export function fitModel(byFut: { ES: Sample[]; NQ: Sample[] }, asOf: string): Model | null;
export function predict(m: Model, x: number): number; // expm1(alpha + beta*x)
export interface Backtest { hit: number; baseUp: number; n: number; days: number }
/** 마지막 60개 국내 거래일 d마다 fitModel(…, d)로 예측. y==0 제외. baseUp = y>0 비율 */
export function backtest(stocks: { ES: Sample[]; NQ: Sample[] }[], days?: number): Backtest;
export type Side = 'same' | 'opposite';
/** 국내 종가 일간 로그 변화 ~ FRED 일간 변화(유가·달러 로그, 금리 %p) 단일 회귀, |t|>=2면 부호로 묶음 */
export function macroSide(stockClose: DayBar[], fred: { d: string[]; v: number[] }, kind: 'oil' | 'dollar' | 'rate'): Side | null;
export function formatPremarket(args: { esPct: number | null; nqPct: number | null; session: string; up: { name: string; pct: number; sym: string }[]; down: typeof args.up; macro: { kind: 'oil' | 'rate' | 'dollar'; quote: IndexQuote; same: string[]; opposite: string[] }[]; record: Backtest & { source: '기록' | '백테스트' }; missing: string[]; statusUnknown: boolean }): { title: string; body: string };
```

- [ ] **Step 1: 실패하는 시험.**
  - `futAt`: 진행 중인 봉(localDate = d)을 쓰지 않는다.
  - 국내 연휴 뒤 첫 거래일의 x는 연휴 동안 쌓인 세션 변화다(만든 데이터로 검사한다).
  - `samples`: `|y|>0.3`인 날을 뺀다.
  - `fitModel`: asOf와 그 뒤 표본을 쓰지 않는다. 누설 시험은 평가일 뒤 y와 x를 모두 바꿔도 `backtest`의 예측이 같은지 본다.
  - 표본이 119개면 null이다.
  - `predict`: α=0, β=1, x=ln(1.01)이면 0.01이다.
  - `macroSide`: 부호를 복원한다. 잡음만 있으면 null이다.
  - `formatPremarket`: 「과거 경향이며 투자 조언이 아님」이 들어가고, 「매수」「매도」가 없다. 「백테스트」 표시가 있고, statusUnknown이면 「휴장 여부 확인 못 함」이 붙는다.
- [ ] **Step 2: 실행.** `cd cli && npx vitest run src/alert/premarket.test.ts` → FAIL.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 실행.** 같은 명령 → PASS.
- [ ] **Step 5: 커밋.** `feat(cli): 개장 전 민감도·예상·백테스트`

### Task 8: `gazua alert premarket`과 백테스트 관문

**Files:** Modify `cli/src/commands/alert.ts`, `cli/src/commands/alert.test.ts`, `cli/README.md`

흐름(설계 §4)은 다음과 같다.

1. 상태를 읽고, 같은 KST 날짜에 이미 보냈으면 `{ skipped: 'sent' }`로 끝낸다.
2. 휴장을 판단한다. 판단할 수 없으면 `statusUnknown`으로 표시하고 계속한다.
3. 2년치 ES·NQ와 종목 일봉을 받는다. 지금은 `kstDate(now)` 기준이다.
4. 종목별로 `fitModel(…, 오늘)`을 맞춘다.
5. `x_today = ln(F[오늘]/F[국내 전 거래일])`로 예상을 낸다.
6. FRED `DCOILWTICO`·`DGS10`·`DTWEXBGS`를 받는다. `scripts/fetch-fred.mjs`의 `fetchFredSeries`를 import하고 `fetchImpl: ctx.fetch`를 넘긴다. 받은 값으로 `macroSide`를 구한다.
7. 네이버 유가·금리·달러 등락을 받는다. `tradedAt`이 36시간보다 오래된 지표는 뺀다.
8. 적중 줄을 만든다. 실제 premarket 기록이 20거래일 이상이면 기록으로, 아니면 `backtest`로 만든다.
9. KST 08:00~08:59이면 보낸다. 그 밖이면 보내지 않고 `{ sent: false, reason: 'late' }`를 기록한다.
10. 지난 premarket 기록을 그날 시가와 맞춰 본다. 계산은 `stats`와 같은 함수로 한다.
11. 결과 JSON에 `{ sent, backtest, picks }`를 넣는다.

`stats`에 premarket 집계를 더한다. 정답은 `sign(시가/전일 종가 − 1)`이다.

- [ ] **Step 1: 실패하는 시험.**
  - 08:40 KST, 고정 일봉 응답, `PREOPEN`이면 ntfy가 1번 나간다. 같은 날 다시 돌리면 0번이다.
  - 09:05이면 ntfy가 0번이고 기록이 1줄 생긴다(`sentAt: null`).
  - marketStatus가 `CLOSE`이면 0번이다.
  - polling이 실패하면 보내고, 「휴장 여부 확인 못 함」이 붙는다.
  - FRED가 실패하면 유가·금리·달러 줄이 빠지고 「빠진 지표」가 붙는다.
- [ ] **Step 2: 실행.** `cd cli && npx vitest run` → FAIL.
- [ ] **Step 3: 구현.** README 알람 절에 개장 전을 더한다.
- [ ] **Step 4: 실행.** `cd cli && npx vitest run && npx tsc --noEmit -p . && node build.mjs` → 통과.
- [ ] **Step 5: 백테스트 관문(설계 §11).** 장 시간 밖에 실제 데이터로 한 번 돌린다. 이때는 보내지 않는다.

```bash
node cli/dist/gazua.mjs alert premarket --env-file "${XDG_CONFIG_HOME:-$HOME/.config}/gazua/alert.env" --pretty
```

`backtest.hit`와 `baseUp`을 사용자에게 보고한다. 다음 둘 중 하나라도 해당하면 여기서 멈추고 사용자에게 묻는다(PR B를 내지 않는다).
  - `hit < 0.55`
  - `hit <= baseUp`
- [ ] **Step 6: 커밋.** `feat(cli): gazua alert premarket`

### Task 9: PR B 마무리

- [ ] Task 6과 같은 검증을 하고, 검토를 1회 한다.
- [ ] 휴장일 `marketStatus` 값을 처음 휴장일에 확인해 설계 §2의 「확인 필요」를 고친다. 이 PR에서 확인할 수 없으면 그대로 둔다.
- [ ] `docs/roadmap.md`에 사용 확인 날짜를 적는다: 2026-12-11, 걷어낼 조건은 설계 §11.
