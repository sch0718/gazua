# 시장 파일 Drive 전달 설계 (서버·DB 2단계 나머지)

작성 2026-11-02. 기준은 `main` `729e072`이다. 근거 문서는 [서버·DB 도입 검토](../../proposals/2026-10-25-server-and-db.md)(이하 제안서) 3·5·7절, [로드맵](../../roadmap.md) 구현 현황, [읽기 전용 CLI 설계](2026-11-01-readonly-cli-design.md)다.

## 0. 이번에 구현할 남은 항목

제안서 7절 2단계의 항목은 다음과 같다. 로드맵(2026-10-31)의 「2/5」는 키 동기화 E2EE를 따로 「다음 우선순위」로 세고 나머지 다섯 줄을 센 값이다.

| # | 제안서 7절 2단계 항목 | 상태 | 근거 |
|---|---|---|---|
| 1 | Drive 기능 전까지 기기마다 수동 가져오기 유지 | 끝남 | `src/lib/marketData/store.ts` `importFile`, 설정 「시장 데이터 가져오기」 |
| 2 | Drive `appDataFolder`로 시장 파일을 본인 기기끼리 전달(선택 기능) | **남음** | 코드 없음 |
| 3 | D1 manifest(파일 버전·해시·수집 시각)와 앱의 검증된 다운로드·교체 경로, 설정의 버전·크기·다시 받기, 보관 개수·업로드 제한 | **남음** | 코드 없음 |
| 4 | 수집 스크립트의 appDataFolder 업로드·manifest 갱신(Drive를 고른 경우만) | **남음** | `scripts/collect-market-data.mjs`에 없음 |
| 5 | `sync-worker` 정리 Cron(삭제 30일 뒤 본문·공유·이력 정리) | 끝남 | `sync-worker/src/purge.ts`, `wrangler.toml` `crons` |
| (별도) | 항목별 E2EE(증권사 키) | 키는 끝남(PR #59) | `src/lib/sync/keySync.ts`. 프록시 토큰·주문 캐시·성과 이력 E2EE는 이번 범위 밖 |

**이번 범위는 2·3·4번이다.** 셋은 한 흐름(맥에서 수집 → Drive에 올림 → D1에 목록 등록 → 다른 기기가 목록을 보고 Drive에서 받음)이라 한 설계로 묶는다.

## 1. 목표와 범위

### 1.1 목표
- 맥에서 `pnpm collect -- --drive …`로 만든 시장 파일이 본인 Google Drive의 `appDataFolder`에 올라가고, D1에 그 파일의 목록(manifest)이 등록된다.
- 다른 기기(폰 등)의 설정 › 데이터에서 Drive 로그인 없이 「새 시장 파일이 있어요」를 보고, 「Drive에서 받기」 한 번(Google 동의 팝업 포함)으로 검증된 파일을 가져온다.
- 수동 가져오기는 그대로 둔다. Drive 기능을 켜지 않은 빌드·사용자에게는 아무것도 바뀌지 않는다.

### 1.2 범위 밖
- 브라우저에서 Drive로 올리기. 시장 파일은 맥의 수집 스크립트만 만든다(YAGNI).
- 무인 백그라운드 전달·자동 받기. 받기는 늘 사용자가 누른다(제안서 7절 2단계).
- 앱 첫 화면·선정 기준 화면의 새 파일 알림. 설정 › 데이터에만 보인다(후속 후보).
- 프록시 토큰·주문 캐시·성과 이력 E2EE.
- 운영 D1 마이그레이션 적용, Worker 배포, Google Cloud 콘솔 설정(사용자 작업, 12절).

## 2. 이미 정해진 사용자 결정

| 결정 | 날짜 | 이 설계에 주는 제약 |
|---|---|---|
| R2를 쓰지 않는다 | 2026-10-25 | 파일 본문은 Drive에만 둔다 |
| 시장 파일 전달은 Drive `appDataFolder`(`drive.appdata`) 선택 기능 | 2026-10-25 | 공유 불가 폴더, 본인 계정만 |
| 시장 파일은 공개 배포하지 않는다(KIS 약관 제5조 ③) | 2026-10-29 | D1·로그·공유에는 시세가 없는 메타데이터만 둔다 |
| 결제 등록 없는 무료 운영 | 2026-10-25 | Drive 15 GB·API 무료 한도 안. Worker·D1 무료 한도 안 |
| 무인 백그라운드 전달을 전제하지 않는다 | 2026-10-25 | 브라우저 토큰은 받을 때마다 사용자 동작으로 얻는다 |
| **수집 스크립트의 manifest 쓰기는 전용 범위 CLI 토큰** | 2026-11-02(이번 질문) | CLI 토큰에 `market-upload` 범위를 더한다. 이 토큰은 manifest 목록·등록·삭제와 자기 철회만 할 수 있고 프로필·키는 읽지도 쓰지도 못한다. 기존 `read` 토큰은 그대로 |

## 3. 설계 결정과 근거

**D1. 브라우저의 Drive 토큰은 Google Identity Services(GIS) 토큰 모델로 받는다.** 제안서 3절이 이 경로(「브라우저 토큰 모델과 `drive.appdata` 범위」)를 적었다. 동기화 로그인 공급자(Google·카카오·네이버)와 상관없이 쓸 수 있다. 버린 안:
- Firebase `reauthenticateWithPopup`에 범위를 더하는 안: Firebase Google 로그인 사용자만 되고, `@sch0718/firebase-session`이 감춘 Auth 객체에 기대야 한다.
- OAuth 암시적 흐름(`response_type=token`) 직접 구현: Google 문서가 「legacy」「SPA에 안전하지 않음」이라 한다(2026-11-02 확인, [JS implicit flow](https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow)).
- Worker가 코드를 교환하는 안: Worker에 Google 클라이언트 시크릿과 새 경로가 생기고, 무인 전달을 하지 않으니 갱신 토큰이 필요 없다.

**D2. 맥(CLI)은 앱과 같은 Google OAuth 웹 클라이언트 ID를 쓴다.** 공식 문서는 「appDataFolder는 만든 앱만 접근한다」고만 하고 「앱」이 클라이언트 ID인지 Cloud 프로젝트인지 밝히지 않는다(2026-11-02 확인, [appdata 문서](https://developers.google.com/workspace/drive/api/guides/appdata)). 같은 클라이언트 ID면 어느 해석이든 같은 폴더다. 웹 클라이언트는 루프백 주소(`http://127.0.0.1:<포트>/`)를 승인된 리디렉션으로 등록할 수 있으므로 CLI는 승인 코드 + PKCE + 클라이언트 시크릿으로 갱신 토큰을 받는다. 시크릿은 환경변수로만 받는다(KIS 키와 같은 취급).

**D3. 업로드는 수집 스크립트가 아니라 CLI(`gazua drive upload`)가 한다. 수집 스크립트의 `--drive`는 수집이 끝난 뒤 CLI를 실행한다.** CLI에는 이미 설정 디렉터리(700/600), 기기 코드 로그인, 토큰 거르기(redact)가 있다. 수집 스크립트(.mjs)에 OAuth·토큰 파일을 다시 만들지 않는다. 제안서의 「수집 스크립트에 업로드·manifest 갱신 작업 추가」는 `--drive` 옵션으로 지킨다.

**D4. manifest는 D1 `market_files` 표에 사용자별로 둔다.** 본문(시세)은 넣지 않는다. 넣는 것: Drive 파일 ID, 파일 이름, gzip 바이트의 SHA-256, gzip 크기, 형식 버전, 수집 시각, 기간, 종목 수. 이 값들은 시세가 아니라 파일 설명이라 제5조 ③에 걸리지 않는다. 다른 기기는 동기화 세션만으로 목록을 읽어 새 파일 여부를 안다(Google 로그인 불필요).

**D5. 보관 개수는 기본 2개(최신 + 직전), CLI `--keep 1~5`.** gzip 수십 MB(제안서 2절 추정) × 2는 15 GB 공용 공간에 부담이 작고, 받은 최신 파일이 깨졌을 때 직전 파일로 돌아갈 수 있다. 서버는 사용자당 10행을 넘는 등록을 거절해 정리가 실패해도 무한히 늘지 않게 한다. 한도에 걸리면 CLI가 정리를 한 번 돌리고 등록을 한 번 다시 시도한다(6.4-5). 그래도 막히면 앱의 「Drive 보관본 지우기」로 비우라고 안내한다(6.5). 올릴 파일보다 새로 수집한 파일이 이미 `keep`개 이상이면 올려도 정리가 바로 지우므로 업로드 전에 `market-file-invalid`로 막고 `--keep`을 늘리라고 안내한다(구현 검토 반영, 2026-11-02). 정리 순서는 문자열이 아니라 `collectedAt`의 시각 값으로 정한다.

**D6. 업로드 크기 상한은 512 MiB(gzip).** 수집 스크립트는 10년을 상한으로 두고 앱은 풀린 JSON을 문자열 하나로 읽는다(`MAX_YEARS` 주석의 약 512 MB 한도). gzip이 이를 넘으면 앱이 어차피 읽지 못한다.

**D7. 받은 파일은 크기와 SHA-256이 manifest와 같을 때만 가져온다.** 다르면 저장하지 않고 「파일이 손상됐어요」로 알린다. 가져오기는 기존 `importFile`을 그대로 써 형식·버전·공간 검사와 한 트랜잭션 교체를 재사용한다. `importFile`은 들어온 Blob의 SHA-256을 요약(`MarketDataInfo.sha256`)에 남긴다. 수동 가져오기도 같은 값을 남겨, 같은 파일을 손으로 가져온 기기도 「최신이에요」로 보인다.

**D8. GIS 스크립트는 Drive 영역이 보일 때 미리 불러온다.** `requestAccessToken`은 팝업을 열므로 클릭 처리기 안에서 바로 불러야 한다(스크립트를 클릭 뒤에 불러오면 팝업이 막힐 수 있다). 미리 불러오지 못했으면 클릭 때 불러온 뒤 「한 번 더 눌러 주세요」로 안내한다.

**D9. CSP는 빌드 때 `VITE_GOOGLE_DRIVE_CLIENT_ID`가 있을 때만 `script-src`에 `https://accounts.google.com/gsi/client`를 더한다.** GIS 문서의 `frame-src`·`style-src`는 One Tap·로그인 버튼용이고, 토큰 모델에 무엇이 필요한지는 문서가 구분하지 않는다(2026-11-02 확인, [GIS 설정](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid)). `connect-src`는 이미 `https:`를 허용한다. 실배포 점검(`docs/live-check.md`)에 「Drive 받기 팝업·CSP 위반 없음」 항목을 더한다. 카카오 CSP와 같은 방식(`kakao-csp.config.ts`)으로 만든다.

**D10. CLI 토큰 범위는 기기 코드 요청 때 정하고, 앱 승인 화면이 범위를 보여 준다.** `cli_grants`에 `scope`를 더한다. 승인하는 사람이 「시장 파일 올리기 전용」인지 보고 승인한다. 토큰 목록도 범위를 보여 준다.

**D11. 일봉을 받지 못한 종목이 하나라도 있는 수집 파일은 `--drive`로 자동 업로드하지 않는다.** 제안서 7절 2단계는 「실패한 수집 파일은 내려받을 버전으로 올리지 않아요」라고만 한다. `collect`는 종목 일부가 실패해도 파일을 쓴다(`summary.failed`, 연속 20회일 때만 멈춤). 비율 상한은 근거가 없어 고르지 않았고, 가장 문자 그대로인 해석(일봉 실패 0건)을 자동 경로의 기준으로 둔다. 일부 실패를 알고도 올릴지는 사람이 `gazua drive upload <경로>`로 직접 정한다. 수급·재무는 없어도 앱이 그 지표만 비워 두는 보조 데이터이고(형식 v3·v4의 `flow?`·`fin?`), `--update`에서는 이전 값을 유지하므로 막지 않는다.

## 4. 흐름

```
맥: pnpm collect -- --drive --update ~/gazua-data/market-data-20261031.json.gz
  └ 수집 성공 → node cli/dist/gazua.mjs drive upload <새 파일>
       ├ 파일 읽기·gunzip·validateMarketData → 메타데이터 → manifest 사전 검사(6.4-1)
       ├ GET  /v1/market/files            (Gazua-CLI market-upload 토큰)
       ├ 같은 sha256이 있고 Drive에 그 파일이 있으면 올리기 생략
       ├ Drive resumable 업로드(appDataFolder) → md5 비교
       ├ POST /v1/market/files            (올렸을 때만. manifest 등록·같은 sha256이면 갱신)
       └ 정리: keep 밖 manifest 삭제 → Drive 파일 삭제 → 목록에 없는 1시간 지난 Drive 파일 삭제

폰: 설정 › 데이터
  ├ GET /v1/market/files (앱 세션) → 최신 항목과 이 기기 요약(sha256) 비교
  └ [Drive에서 받기] → GIS 토큰 팝업 → GET drive/v3/files/<id>?alt=media
       → 크기·SHA-256 확인 → importFile → 「최신이에요」
```

## 5. 서버 (`sync-worker`)

### 5.1 마이그레이션 `0006_market_files.sql`
```sql
ALTER TABLE cli_grants ADD COLUMN scope TEXT NOT NULL DEFAULT 'read'; -- 'read' | 'market-upload'
CREATE TABLE market_files (
  id TEXT PRIMARY KEY,                       -- uuid
  user_id TEXT NOT NULL REFERENCES users(id),
  drive_file_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sha256 TEXT NOT NULL,                      -- gzip 바이트의 SHA-256 hex
  size INTEGER NOT NULL,                     -- gzip 바이트
  format_version INTEGER NOT NULL,
  collected_at TEXT NOT NULL,                -- 파일의 collectedAt(ISO)
  range_from TEXT NOT NULL,                  -- YYYY-MM-DD
  range_to TEXT NOT NULL,
  stocks INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, sha256)
);
CREATE INDEX market_files_user ON market_files(user_id, collected_at);
```
`cli_tokens.scope`는 이미 있다(`0005`). 기존 행은 `'read'`다.

### 5.2 API

| 메서드·경로 | 앱 세션 | CLI `read` | CLI `market-upload` | 동작 |
|---|---|---|---|---|
| `GET /v1/market/files` | 허용 | 403 `cli-scope` | 허용 | `{ files: MarketFileRow[] }`, `collectedAt` 내림차순·`createdAt` 내림차순 |
| `POST /v1/market/files` | 405 | 403 | 허용 | 본문 검사 → `(user_id, sha256)` upsert(같으면 `drive_file_id`·`name`·`updated_at` 갱신) → 행 |
| `DELETE /v1/market/files/:id` | 허용 | 403 | 허용 | 내 행이면 지움. 없거나 남의 것이면 404 |
| `DELETE /v1/market/files` | 허용 | 403 | 403 | 내 행 모두 지움 → `{ deleted: n }` |
| `DELETE /v1/cli/token` | — | 허용 | 허용 | 자기 토큰 철회(기존) |

`MarketFileRow`: `{ id, driveFileId, name, sha256, size, version, collectedAt, range: { from, to }, stocks, createdAt, updatedAt }`.

POST 본문 검사(알 수 없는 키는 422 `unknown-field`, 모양이 다르면 422 `invalid`. 둘 다 `path`를 붙인다. 공유 생성과 같은 방식):
- 키는 정확히 `driveFileId, name, sha256, size, version, collectedAt, range, stocks`. 금지 키 검사(`FORBIDDEN_KEYS`)를 먼저 한다.
- `driveFileId` `^[A-Za-z0-9_-]{10,128}$`, `name` `^[A-Za-z0-9._-]{1,100}$`이고 `.json.gz`로 끝남, `sha256` `^[0-9a-f]{64}$`, `size` 1 ~ 512 MiB 정수, `version` 1 ~ 99 정수, `collectedAt` 40자 이하이고 `Date.parse`가 되는 문자열, `range.from`·`range.to` 달력에 있는 `YYYY-MM-DD`이고 `from <= to`, `stocks` 0 ~ 100000 정수.
- 본문 상한 4 KiB(`readJson(req, 4096)`).
- 새 행이 사용자당 10개를 넘으면 429 `market-limit`. upsert로 갱신하는 경우는 세지 않는다. 공유 한도(`sync-worker/src/shares.ts`)처럼 한 문장의 `INSERT … SELECT … WHERE … ON CONFLICT (user_id, sha256) DO UPDATE`로 처리하되, 조건은 `WHERE (SELECT count(*) FROM market_files WHERE user_id = ?) < 10 OR EXISTS (SELECT 1 FROM market_files WHERE user_id = ? AND sha256 = ?)`로 한다. 조건의 바인딩은 순서대로 요청 사용자 ID·요청 사용자 ID·요청 sha256이다. 행 수만 검사하면 10행일 때 SELECT가 0행이 되어 기존 해시의 갱신도 막히므로, 같은 사용자의 같은 해시가 있으면 갱신을 허용한다. `changes = 0`이면 429 `market-limit`다.

### 5.3 CLI 범위
- `POST /v1/cli/device` 본문에 `scope?: 'read' | 'market-upload'`(기본 `'read'`, 그 밖은 422 `invalid` `path: scope`).
- `approveCli` 조회 응답에 `scope`를 더한다. 승인 후 `pollToken`은 grant의 `scope`로 토큰을 만든다.
- `pollToken` 응답에 `scope`를 더한다(`{ token, tokenId, expiresAt, scope }`). 옛 Worker는 본문의 `scope`를 무시하고 `read` 토큰을 `scope` 없이 돌려주므로, CLI는 `drive login`에서 응답 `scope`가 `'market-upload'`가 아니면(없는 경우 포함) 토큰을 `drive-auth.json`에 저장하지 않고 `server-outdated`로 끝낸다.
- `cliScope(method, url, scope)`: `read`는 기존 허용 목록 그대로, `market-upload`는 위 표의 세 경로 + 로그아웃만. 범위 밖은 403 `cli-scope`.
- `listCliTokens`가 `scope`를 돌려준다.
- 허용 목록 재확인(`stillAllowed`), 만료·철회, `last_used_at` 갱신은 그대로 둔다.

### 5.4 로그
기존 규칙대로 메서드·경로 패턴·상태·시간만 남긴다. Drive 파일 ID·해시·파일 이름은 남기지 않는다.

## 6. CLI (`cli/`)

### 6.1 명령
| 명령 | 하는 일 |
|---|---|
| `gazua drive login` | ① `drive-auth.json`이 없거나 만료면 기기 코드 로그인(`scope: 'market-upload'`, 라벨 기본 `gazua-drive@<호스트>`) ② `drive.json`이 없거나 클라이언트 ID가 바뀌었으면 Google 루프백 로그인. 이미 둘 다 있으면 Google 갱신 토큰을 한 번 갱신해 보고, `invalid_grant`(철회·만료)면 ②를 다시 한다. 그 밖에는 아무것도 안 하고 상태만 알린다. 서버가 401로 거절한 market-upload 토큰은 `gazua drive logout` 뒤 `drive login`으로 안내한다 |
| `gazua drive upload <파일> [--keep N]` | 4절 흐름. `N`은 1~5, 기본 2 |
| `gazua drive status` | 두 로그인 상태와 manifest 목록(JSON) |
| `gazua drive logout` | 서버 토큰 철회(`DELETE /v1/cli/token`), Google 갱신 토큰 철회(`POST https://oauth2.googleapis.com/revoke`), 두 파일 삭제. 서버·Google 철회가 실패해도 파일은 지우고 경고한다(기존 `logout`과 같은 방식) |

출력은 기존 CLI처럼 JSON이다. 진행 문구는 stderr(`ctx.say`)로 낸다.

### 6.2 설정·비밀
- 환경변수: `GAZUA_DRIVE_CLIENT_ID`, `GAZUA_DRIVE_CLIENT_SECRET`(둘 다 필요), `GAZUA_DRIVE_PORT`(기본 53682). CLI를 직접 실행할 때는 `--env-file`로도 받는다. 수집 스크립트의 `--drive` 경로는 셸에서 내보낸 환경변수를 쓴다(7절). 시크릿·갱신 토큰·접근 토큰은 `redact`에 넣는다(`SECRET_ENV`에 시크릿을 더한다).
- `~/.config/gazua/drive-auth.json`: 기존 `AuthFile`과 같은 모양(market-upload 토큰).
- `~/.config/gazua/drive.json`: `{ v: 1, clientId, refreshToken, createdAt }`, 600. 접근 토큰은 파일에 두지 않고 실행마다 갱신한다.

### 6.3 Google 로그인(루프백)
1. 32바이트 `state`와 PKCE `code_verifier`(S256)를 만든다.
2. `127.0.0.1:<포트>`에 HTTP 서버를 연다. 리디렉션 주소는 `http://127.0.0.1:<포트>/`.
3. 인증 주소(`https://accounts.google.com/o/oauth2/v2/auth`, `response_type=code`, `scope=https://www.googleapis.com/auth/drive.appdata`, `access_type=offline`, `prompt=consent`, `code_challenge`, `state`)를 stderr에 출력한다. 브라우저는 열지 않는다(사람이 연다).
4. 첫 요청의 `state`가 다르거나 `error`가 있으면 실패. 5분 안에 오지 않으면 `drive-login-timeout`.
5. `https://oauth2.googleapis.com/token`에 코드·verifier·클라이언트 ID·시크릿·리디렉션 주소로 교환한다. 응답에 `refresh_token`이 없거나 `scope`에 `drive.appdata`가 없으면 실패.
6. 브라우저 쪽 응답은 「터미널로 돌아가세요」 한 줄(HTML, 외부 자원 없음).

### 6.4 업로드
1. 파일을 읽어 SHA-256·MD5·크기를 계산하고, gunzip → `JSON.parse` → `validateMarketData`(`src/lib/marketData/format.ts` 재사용). 이어서 로컬에서 정해지는 manifest 필드(`name`은 입력 파일의 경로를 뺀 이름, `sha256`, `size`, `version`, `collectedAt`, `range`, `stocks`는 종목 수)를 5.2의 POST 본문 규칙과 동일하게 검사한다. 특히 파일 이름의 정규식·길이·`.json.gz` 접미사, 실제 달력 날짜인 `YYYY-MM-DD`·`from <= to`, `collectedAt`의 40자 상한·`Date.parse`, 크기·버전·종목 수의 정수 범위를 확인한다. 파일 형식·manifest 검사 실패나 512 MiB 초과는 접근 토큰 갱신·Drive 업로드 전에 `market-file-invalid`로 끝낸다. `driveFileId`는 업로드 응답에서 얻으므로 등록 전에 5.2 규칙으로 검사한다.
2. 접근 토큰 갱신(`grant_type=refresh_token`). `invalid_grant`면 `drive-login-required`(`gazua drive login`을 다시 하라는 안내).
3. `GET /v1/market/files`. 같은 `sha256` 행이 있으면 `files.get <id>?fields=id,md5Checksum,trashed`로 확인해, 있으면 업로드를 건너뛰고 6단계로 간다.
4. resumable 업로드: `POST https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,md5Checksum,size`에 메타데이터(`name`, `parents: ['appDataFolder']`, `mimeType: 'application/gzip'`, `appProperties: { gazua: 'market-data', sha256 }`) → `Location`에 본문 PUT 한 번. 응답의 `md5Checksum`·`size`가 로컬과 다르면 그 파일을 지우고 실패.
5. `POST /v1/market/files`로 등록. 429 `market-limit`이면 6단계의 정리를 한 번 돌린 뒤 등록을 한 번만 다시 시도한다. 정리는 기존 행을 `keep`개(5개 이하)로 줄이므로 한도 아래로 내려간다. 방금 올린 파일은 아직 manifest에 없지만 1시간이 지나지 않아 정리에서 지우지 않는다. 다시 실패하거나 그 밖의 실패면 방금 올린 Drive 파일을 지우려 시도하고 실패를 알린다.
6. 정리: manifest를 다시 읽어 `collectedAt`·`createdAt` 내림차순으로 `keep`개 밖의 행을 `DELETE /v1/market/files/:id` → Drive 파일 삭제(404는 성공). 그다음 `files.list?spaces=appDataFolder&q=appProperties has { key='gazua' and value='market-data' }`에서 남은 manifest에 없고 `createdTime`이 1시간 넘게 지난 파일을 지운다(다른 실행이 막 올린 파일은 건드리지 않는다). 정리 실패는 경고로만 남기고 업로드 결과는 성공으로 둔다.
7. 결과 JSON: `{ uploaded: boolean, file: MarketFileRow, removed: number }`.

Drive 429·5xx는 1·2·4초 지수 백오프로 세 번까지 다시 한다(업로드 PUT은 세션 주소로 다시 보낸다). 401은 접근 토큰을 한 번 갱신하고 다시 한다.

### 6.5 오류 코드(기존 `CliError` 표에 더함)
`drive-not-configured`(환경변수 없음), `drive-login-required`, `drive-login-timeout`, `drive-denied`(동의 거절·범위 없음), `drive-quota`(403 `storageQuotaExceeded`·429 반복), `drive-failed`(그 밖), `market-file-invalid`(검증 실패·크기 초과), `market-limit`(서버 429. 정리 후 재시도도 막혔을 때만. 안내: 「Drive 보관본이 서버 한도(10개)에 찼어요. 앱 설정 › 데이터의 「Drive 보관본 지우기」로 비운 뒤 다시 올려 주세요」). 종료 코드는 기존 규칙(인증류·입력류·외부 실패)을 따른다.

## 7. 수집 스크립트

- `parseArgs`에 `--drive`(값 없음)를 더한다.
- `main`이 `collect`를 끝낸 뒤 `--drive`면 `runDriveUpload(file)`을 부른다. 기본 구현은 `process.execPath`로 `cli/dist/gazua.mjs drive upload <file>`을 실행하고 stdio를 이어 준다. `cli/dist/gazua.mjs`가 없으면 「먼저 `pnpm -C cli build`를 실행해 주세요」로 실패한다. 업로드가 실패해도 수집 파일은 남고, 종료 코드는 1이다(「파일은 <경로>에 있어요. `gazua drive upload <경로>`로 다시 올릴 수 있어요」).
- 수집이 던지면(실패한 수집) 업로드하지 않는다.
- 수집은 끝났지만 일봉을 받지 못한 종목이 있으면(`summary.failed.length > 0`) `--drive`여도 올리지 않는다(D11). 「일봉 실패 N종목이 있어 Drive에 올리지 않았어요. `--update`로 다시 받거나, 이대로 올리려면 `gazua drive upload <경로>`를 실행해 주세요」를 알리고 종료 코드 1로 끝낸다. 수급(`flowFailed`)·재무(`finFailed`) 실패는 막지 않는다.
- 자식 프로세스에는 KIS 키 환경변수를 넘기지 않는다(`KIS_APP_KEY`·`KIS_APP_SECRET`를 뺀 env). `GAZUA_DRIVE_CLIENT_ID`·`GAZUA_DRIVE_CLIENT_SECRET`는 부모의 환경변수를 그대로 넘긴다. 수집 스크립트는 `--env-file`을 읽거나 CLI에 전달하지 않으므로, `--drive`를 쓸 때는 두 값을 셸에서 `export`해 둔다. 앞선 `gazua drive login --env-file <경로>` 실행에서 읽은 값은 이후 수집 실행에 이어지지 않는다.

## 8. 앱

### 8.1 설정·구성
- `VITE_GOOGLE_DRIVE_CLIENT_ID`가 있고 동기화가 구성된 빌드에서만 Drive 영역이 생긴다. 읽는 곳은 `src/lib/marketData/driveConfig.ts`.
- CSP: `drive-csp.config.ts`(`driveCsp(html, enabled)`, `driveCspPlugin()`)를 `vite.config.ts` 플러그인에 더한다.

### 8.2 모듈
| 파일 | 역할 |
|---|---|
| `src/lib/marketData/driveManifest.ts` | `MarketFileRow` 타입과 응답 검사(`checkMarketFiles`). CLI와 함께 쓴다 |
| `src/lib/marketData/gis.ts` | GIS 스크립트를 한 번만 불러오는 `loadGis()`, `requestDriveToken(clientId)` → `{ token, expiresAt }` 또는 `'cancelled'`·`'denied'`. 토큰은 탭 메모리에만, 만료 1분 전부터 다시 묻는다 |
| `src/lib/marketData/driveClient.ts` | `downloadFile(token, id, onProgress)` → Blob, `deleteFile`, `listMarketFiles`. 실패를 `{ kind: 'auth' | 'not-found' | 'quota' | 'offline' | 'failed' }`로 바꾼다 |
| `src/lib/marketData/driveSync.ts` | `fetchFromDrive(row, deps)`: 토큰 → 다운로드 → 크기·SHA-256 확인 → `store.importFile`. `wipeDrive(deps)`: Drive 파일·manifest 모두 지우기 |
| `src/lib/sync/api.ts` | `marketFiles()`, `deleteMarketFile(id)`, `wipeMarketFiles()` |
| `src/lib/marketData/store.ts` | `MarketDataInfo.sha256?`. `importFile`이 Blob의 SHA-256을 계산해 넣는다 |
| `src/lib/ui/settings/MarketDrive.svelte` | 설정 › 데이터의 「시장 데이터」 아래 Drive 영역 |
| `src/lib/ui/settings/CliConnect.svelte`·토큰 목록 | 범위 표시 |

### 8.3 Drive 영역 화면
동기화에 로그인했을 때만 manifest를 읽는다(설정 화면을 열 때 한 번, 받기·지우기 뒤 다시). 상태별 문구:

| 상태 | 문구 | 버튼 |
|---|---|---|
| 로그인 안 함 | 「동기화에 로그인하면 맥에서 올린 시장 파일을 받을 수 있어요」 | 없음 |
| manifest 비어 있음 | 「Drive에 올린 시장 파일이 없어요. 맥에서 `pnpm collect -- --drive`로 올려요」 | 없음 |
| 최신과 이 기기 sha256이 같음 | 「Drive 최신 파일과 같아요 · 수집 YYYY-MM-DD」 | 「Drive 보관본 지우기」 |
| 다름 | 「Drive에 새 파일이 있어요 · 수집 YYYY-MM-DD · N종목 · M MB」 (이 기기가 더 새 수집이면 「이 기기 파일이 더 새것이에요」) | 「Drive에서 받기」, 「Drive 보관본 지우기」 |
| 받는 중 | 「받는 중… n%」 | 비활성 |

직전 파일(2번째 행)은 「이전 파일 받기」로 고를 수 있다(접힌 목록). 실패 문구: 취소 → 없음, 거절 → 「Google에서 Drive 권한을 허용해야 받을 수 있어요」, 404 → 「Drive에서 파일을 찾지 못했어요. 맥에서 올린 Google 계정과 같은지 확인해 주세요」, 해시·크기 불일치 → 「받은 파일이 손상됐어요. 다시 받아 주세요」, 그 밖의 `importFile` 실패는 기존 문구를 쓴다. 지우기는 확인 대화상자 뒤에 Drive 파일을 지우고 manifest를 비운다. 「이 기기의 시장 데이터는 남아요」라고 알린다.

### 8.4 앱 세션 범위
앱은 manifest를 등록하지 않는다(5.2절 표). 공유 스냅샷·프로필 문서·내보내기에는 manifest가 들어가지 않는다.

## 9. 오류 처리 요약

| 상황 | 처리 |
|---|---|
| 서버에 0006이 없음 | `/v1/market/files`가 500 → 앱은 「서버 업데이트가 필요해요」, CLI는 `drive-failed`. 배포 순서(12절)로 막는다 |
| Worker가 0006 이전 코드 | `drive login`의 토큰 응답에 `scope: 'market-upload'`가 없음 → CLI는 토큰을 저장하지 않고 `server-outdated`(5.3). 배포 순서(12절)로 막는다 |
| manifest는 있는데 Drive 파일이 지워짐 | 앱 404 문구, CLI 업로드는 같은 sha256이어도 다시 올린다(6.4-3) |
| 업로드 성공·등록 실패 | CLI가 Drive 파일 삭제 시도. 남으면 다음 정리에서 지운다 |
| 받은 파일이 앱보다 새 형식 | `importFile`의 `version-newer` 문구 그대로 |
| 기기 공간 부족 | `importFile`의 `quota` 문구 그대로. 받은 Blob은 버린다 |
| Drive 접근 토큰 만료(1시간) | 다음 받기 때 다시 묻는다 |

## 10. 보안·약관

- 시장 파일 본문은 본인 Drive `appDataFolder`에만 있다. 이 폴더는 공유할 수 없다(appdata 문서). D1·로그·공유에는 본문이 없다.
- `market-upload` 토큰은 프로필·키를 읽지 못한다. 유출되면 manifest를 지우거나 엉뚱한 Drive 파일 ID를 등록할 수 있다. 앱은 받은 파일의 크기·SHA-256을 manifest와 비교하고 `validateMarketData`를 거치므로, 다른 사람이 만든 파일을 등록해도 본인 Drive에 그 ID가 없으면 받지 못한다. 토큰은 90일 만료이고 앱에서 철회할 수 있다.
- Google 갱신 토큰은 맥의 600 파일에만 둔다. 서버·D1에는 Google 토큰이 없다.
- 브라우저 접근 토큰은 탭 메모리에만 둔다. 로그·저장소에 쓰지 않는다.
- GIS 스크립트는 Drive 기능을 켠 빌드에서만 CSP에 들어가고, Drive 영역이 보일 때만 불러온다.

## 11. 테스트

| 층 | 무엇을 | 도구 |
|---|---|---|
| Worker | 0006 적용 뒤 목록·등록·upsert·10개 한도(9행에서 새 sha256 등록 성공, 10행에서 새 sha256 등록은 429 `market-limit`·같은 sha256 갱신은 성공하고 행 수는 10개 유지)·삭제·전체 삭제, 소유권(남의 행 404), 본문 검사(각 필드·금지 키·알 수 없는 키), CLI 범위 표(read는 market 403, market-upload는 profiles 403·logout 허용), 기기 코드 scope 저장·승인 조회·토큰 범위 | `sync-worker` vitest + 기존 D1 하네스 |
| CLI | 루프백 로그인(state 불일치·error·시간 초과·refresh_token 없음), 업로드(검증 실패 거절, manifest 각 필드의 정상·경계·오류 사례를 Worker 본문 검사와 동일하게 검증: 한글·공백 파일명, 잘못된 접미사·길이, 없는 날짜·역전 범위, 파싱 불가·40자 초과 수집 시각, 크기·버전·종목 수 범위 밖은 토큰 갱신·Drive 요청 없이 `market-file-invalid`, 같은 sha256 건너뛰기, md5 불일치 삭제, 등록 실패 정리, keep 정리·고아 1시간 규칙, 401 갱신·429 백오프), logout, 비밀 거르기 | `cli` vitest, 가짜 fetch |
| 수집 스크립트 | `--drive` 파싱, 성공 뒤에만 실행·일봉 실패가 있으면 올리지 않음(D11)·KIS env 제외·dist 없음 안내·업로드 실패 종료 코드 | `node --test` |
| 앱 | `importFile`의 sha256, `checkMarketFiles`, `driveClient` 실패 매핑, `fetchFromDrive`(불일치 거절·성공 교체), `MarketDrive.svelte` 상태별 문구·버튼, `driveCsp`, 승인 화면 범위 문구 | vitest + testing-library + fake-indexeddb |

E2E(Playwright)는 Google 팝업을 띄울 수 없어 넣지 않는다. 실배포 점검 항목으로 남긴다.

## 12. 배포 전 사용자 작업

1. Google Cloud 콘솔(Firebase와 같은 프로젝트 권장)에서 Drive API를 켠다.
2. OAuth 동의 화면에 `.../auth/drive.appdata` 범위를 더한다. 게시 상태가 「테스트」면 갱신 토큰이 7일 뒤 만료되므로 「프로덕션」으로 바꾼다(민감하지 않은 범위라 검수 필요 여부는 콘솔 안내를 따른다, 확인 필요).
3. OAuth 클라이언트 ID(웹 애플리케이션)를 만들거나 기존 것을 쓴다. 승인된 JavaScript 원본에 `https://gazua.sch0718.dev`(개발이면 `http://localhost:5173`), 승인된 리디렉션 URI에 `http://127.0.0.1:53682/`를 넣는다.
4. GitHub Actions 빌드 변수 `VITE_GOOGLE_DRIVE_CLIENT_ID`를 넣는다(비밀 아님).
5. 맥에서 `pnpm collect -- --drive …`를 실행할 셸에 `GAZUA_DRIVE_CLIENT_ID`·`GAZUA_DRIVE_CLIENT_SECRET`를 `export`해 둔다(저장소에 넣지 않는다). 두 값은 로그인뿐 아니라 실행마다 접근 토큰을 갱신할 때도 필요하다. `--env-file`은 CLI를 직접 실행할 때만 쓸 수 있으며, 로그인 때만 지정해 두는 것으로는 7단계의 수집 실행에 전달되지 않는다(6.2·7절).
6. 운영 D1에 `0006_market_files.sql`을 적용한 뒤 Worker를 배포하고, 그다음 앱을 배포한다.
7. `pnpm -C cli build` → `gazua drive login`(앱 설정 › CLI 연결에서 「시장 파일 올리기 전용」 승인 + Google 동의) → `pnpm collect -- --drive …`.

## 13. 문서 갱신
- 제안서 2단계·5절 표에 구현 현황을 적는다. 로드맵 현황 표를 5/5로 바꾸고 「다음 우선순위」의 2단계 문구를 정리한다.
- `docs/development.md` 시장 데이터 절에 Drive 전달, `sync-worker/README.md`에 0006·배포 순서, `cli/README.md`에 `drive` 명령, `docs/live-check.md`에 Drive 받기 점검 항목.
