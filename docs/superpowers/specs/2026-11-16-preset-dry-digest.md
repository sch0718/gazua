# 프리셋 연습 실행과 저녁 요약 알림 (설계·계획)

## 전제와 이유

- 사용자 1명, 맥 1대, 무료 운영(ntfy·네이버 시세). 실전(`AUTO_MODE=live`) 경로·주문 프록시는 바꾸지 않는다.
- 이미 있는 것으로 안 되는 이유: `gazua auto`는 전략 1개·연습 원장 1개만 다루고 알림이 거래마다 흩어져, 프리셋 5개를 함께 연습하고 저녁에 한 번에 비교할 수 없다.
- 범위 밖: 실전 여러 전략, 웹 화면, 동기화 프로필 쓰기, 프리셋 순위·추천.

## 1. 프리셋 연습 실행 (`gazua auto`)

- 설정 `AUTO_DRY_PRESETS=all|off`, 기본 `off`. `readAutoConfig`의 허용 키에 더하고 그 밖의 값은 오류. `AUTO_MODE=live`면 값과 무관하게 돌리지 않는다.
- 프리셋 전략은 실행 때마다 `fromTemplate(t, now, null, t.name)`으로 만들고 다음만 덮어쓴다.
  - `id = 'preset-<템플릿 id>'`(원장의 `strategyId` 비교가 매번 같도록 고정)
  - `universe = 주 전략의 universe`(같은 관심 그룹·종목)
  - 자금·배분은 `newStrategy` 기본값 그대로(성과는 손익률로 비교하므로 맞추지 않는다).
  - 동기화 프로필에는 쓰지 않는다.
- 원장: `auto-positions.dry.preset-<id>.json`(권한 600, 기존 `writeJsonFile`). 주 전략 원장 경로·동작은 그대로. `ledgerPath`에 선택 인자 `preset?: string`을 더한다.
- 흐름(`runAuto`, 연습 모드에서만):
  1. 지금처럼 장 상태 → 주 전략 원장 → 프로필·주 전략을 읽는다.
  2. 프리셋 켜짐이면 프리셋 원장 5개를 읽는다. 손상된 프리셋 원장은 그 프리셋만 건너뛴다(덮어쓰지 않음).
  3. 네이버 일봉은 「주 전략 종목 ∪ 모든 원장의 보유 종목」에 대해 종목당 1번만 받는다. 시작일은 모든 전략·보유의 가장 이른 날로 하고, 각 전략은 (전략, 종목)별 시작일(기존 `run.ts`처럼 그 전략의 `warmFrom`과 그 전략 원장에서 **같은 종목**의 `boughtAt` 중 가장 이른 날) 이후 봉만 잘라 쓴다. 그래서 주 전략 판정 입력은 지금과 같다. 종목 이름 조회도 공유한다.
     - 주 전략에 필요한 종목(주 전략 종목 ∪ 주 전략 원장의 보유 종목)의 조회 실패는 기존 실행 전체 오류 처리를 유지한다.
     - 그 밖의 프리셋 전용 보유 종목은 조회 단계에서 종목별로 예외를 잡아 실패를 공유 조회 결과에 보관한다. 주 전략 판정은 계속하고, 해당 종목을 보유한 프리셋마다 5단계의 오류 처리로 넘긴다. 그 종목이 필요 없는 다른 프리셋도 계속 판정하며, 실패한 조회를 프리셋마다 다시 요청하지 않는다.
  4. 주 전략은 지금 코드 그대로 판정·알림한다.
  5. 주 전략 판정이 끝난 뒤 프리셋마다 `try/catch`로 따로 판정한다. 새 함수 `judgeDry(strategy, ledger, bars, ...)`(`cli/src/auto/preset.ts`)가 `decideSell`·`decideBuy`·`tickDown`·`tickUp`을 써서 연습 매도→매수를 하고 원장만 저장한다. ntfy는 보내지 않는다. 오류는 결과 JSON의 `presets[].error`(코드만)에 남기고 다음 프리셋으로 간다. 주 전략의 오류·회복 알림과 무관하다.
     - 3단계에 보관한 조회 실패가 해당 프리셋에 있으면 `judgeDry`를 호출하기 전에 이 오류 처리로 넘겨 `presets[].error`에 코드만 남긴다. 이 실패로 주 전략의 오류·회복 알림 기록을 변경하지 않는다.
- 거래 기록: 원장 `today`에 선택 필드 `trades?: { side: 'BUY'|'SELL'; symbol; name; qty; price; reason }[]`를 더한다(검증 함수에 반영, 날이 바뀌면 `today`와 함께 비워진다). 주 전략은 `mode === 'dry'`일 때 `send()`에서, 프리셋은 `judgeDry`에서 넣는다. 실전 원장에는 넣지 않는다.
- 요약용 실행 표식: 연습 원장의 `today`에 선택 필드 `judgedDate?: string`을 더한다(`cli/src/auto/ledger.ts`의 형식 검사에 반영, 있으면 유효한 날짜이며 `today.date`와 같아야 한다). 장 `OPEN` 확인과 해당 전략의 준비(프로필·전략·필요한 시세 조회)가 끝나 매도→매수 판정에 진입할 때만 오늘 날짜를 넣고 저장한다. 주 전략은 `runAuto`의 판정 루프 직전, 프리셋은 3단계 조회 실패가 없어 판정에 진입할 때 기록한다. 거래가 없어도 기록하며, 설정·장 상태 조회·준비 오류 처리에서는 새로 넣지 않는다. 같은 날 앞서 기록한 표식은 이후 오류에도 유지하고, 날짜가 바뀌면 `readLedger`가 `today`를 비울 때 함께 지운다. 표식 없는 기존 원장도 읽되 오늘 판정의 증거로 삼지 않는다. 실전 원장에는 넣지 않는다.
- 결과 JSON에 `presets: { id, name, buys, sells, error? }[]`를 더한다(꺼짐이면 빈 배열).

## 2. 저녁 요약 (`gazua auto digest`)

- `cli/src/commands/auto.ts`: 위치 인자가 정확히 `['digest']`면 `runDigest`, 그 밖의 위치 인자·`--yes`는 지금처럼 거절.
- `cli/src/auto/digest.ts` `runDigest(ctx, deps)`:
  1. 평일 KST 15:30 이후가 아니면 `{ skipped: 'hours' }`.
  2. 요약 상태 `auto-digest.json`(`{ date }`, 권한 600)의 날짜가 오늘이면 `{ skipped: 'sent' }`.
  3. 연습 원장들(주 전략 + `AUTO_DRY_PRESETS=all`이면 프리셋 5개)의 원본 `today.date`와 `today.judgedDate`가 모두 오늘인 것만 고른다. 하나도 없으면 휴장·미실행으로 보고 `{ skipped: 'closed' }`(보내지 않음). 오류 처리도 원장을 만들거나 날짜를 갱신해 저장하므로 `today.date`만으로는 판정 실행을 확인할 수 없다. 날짜를 초기화하는 `readLedger`를 거치기 전 원본 필드로 확인한다.
     - 원장은 `ledger.ts`에 새로 내보낼 「날짜를 초기화하지 않는 검증 읽기」로 원장별 `try/catch` 안에서 읽는다. JSON·형식이 잘못되면 그 전략만 「오늘 기록 없음」이고 다른 전략 요약은 보낸다.
  4. 보유 종목의 오늘 종가를 네이버 일봉으로 종목당 1번 받는다. 실패하거나 마지막 봉이 오늘이 아니면 그 종목은 「평가 불가」(이전 종가로 계산하지 않는다).
  5. 본문(전략별 블록):
     - 제목 줄: 주 전략은 `AUTO_STRATEGY` 값, 프리셋은 템플릿 이름.
     - 오늘 거래: `매수 005930 삼성전자 10주 70,000원 (이유)` / 매도 같음. 없으면 「거래 없음」.
     - 보유: `종목명 수량주 평단→종가 +1.2%`. 없으면 생략.
     - 오늘 판정 표식이 있는 원장이 없는 전략(예: 손상·준비 오류·표식 없는 기존 원장)은 「오늘 기록 없음」.
  6. 제목 `[연습] 오늘 연습 결과 M/D`, 끝 줄 「투자 조언 아님」. 본문은 UTF-8 3,500바이트를 넘으면 줄 단위로 자르고 `…(줄임)`을 붙인 뒤 끝 줄을 유지한다(ntfy 메시지 한도 4,096바이트).
  7. ntfy 전송이 성공하면 `auto-digest.json`에 오늘 날짜를 쓴다. 실패하면 쓰지 않는다(다음 실행에서 재시도).
- 토픽은 `ctx.redact`에 더하고 결과·로그에 쓰지 않는다.

## 3. launchd

- `scripts/macos/auto-agent/digest.sh`: `run.sh`처럼 `alert.env`·`auto.env`를 Node 환경 파일로 읽고 `gazua.mjs auto digest`를 실행. 요약 상태 `auto-digest.json`을 확인→전송→저장하므로 `run.sh`와 같은 방식으로 `lockf -t 0 "$DIR/.auto-digest.lock"`을 걸어 예약·수동 실행이 겹치면 뒤 실행은 건너뛴다(종료 75 → 0). 수동 실행도 이 스크립트를 쓴다.
- `digest.plist.template`: 라벨 `com.gazua.auto-digest`, `StartCalendarInterval` 월~금(Weekday 1~5) 20:00. 맥이 잠들어 지나치면 깨어난 뒤 한 번 돌고, 날이 바뀌었으면 오늘 원장이 없어 건너뛴다.
- `install-digest.sh`·`uninstall-digest.sh`: 기존 `install.sh`의 Node·빌드·`alert.env` 검사, XML 이스케이프, `plutil -lint`, `GAZUA_AUTO_DRY=1` plist만 만들기, 실패 시 되돌리기를 같은 방식으로. 기존 `com.gazua.auto` 파일은 건드리지 않는다.

## 4. 시험 (동작만큼)

- `run.test.ts`: 프리셋 켬 → 프리셋 원장 5개가 따로 생기고 주 전략 원장 내용은 꺼짐과 같다 / 프리셋 거래 ntfy 0건 / 종목당 네이버 일봉 요청 1번 / 한 프리셋 원장 손상이 주 전략·다른 프리셋을 막지 않는다 / live면 프리셋 원장 없음.
  - 프리셋 전용 보유 종목의 일봉 요청이 HTTP 오류로 실패해도 주 전략과 그 종목이 필요 없는 다른 프리셋은 정상 실행된다. 실패 종목을 보유한 프리셋들만 `presets[].error`를 남기고 판정·원장 저장을 건너뛴다. 실패 요청도 종목당 1번이며, 이 오류로 주 전략의 오류·회복 알림이나 그 알림 기록이 추가되지 않는다. 기존 회복 대기 기록이 있는 경우에도 주 전략이 정상이면 기존 회복 알림 동작을 유지한다.
  - 주 전략에도 필요한 종목의 일봉 조회 실패는 기존처럼 실행 전체 오류·알림 경로로 처리된다.
  - 연습 판정 진입 시 거래가 없어도 `judgedDate`를 저장한다. 설정·장 상태 조회·필요 시세 조회 오류만 난 날에는 표식을 만들지 않는다. 같은 날 판정 후 오류가 나도 기존 표식은 유지한다.
- `ledger.test.ts`: 표식 없는 기존 원장 허용 / `judgedDate` 형식·`today.date` 일치 검사 / 날짜 변경 시 표식 제거.
- `config.test.ts`: `AUTO_DRY_PRESETS` 허용·잘못된 값 거절.
- `digest.test.ts`: 본문(거래·거래 없음·보유 손익률·`[연습]`·「투자 조언 아님」) / 같은 날 두 번 안 보냄 / 오늘 원장 없으면 안 보냄 / 전송 실패면 상태 안 씀 / 길이 줄임.
  - 설정 오류나 장 상태 조회 실패로만 오늘 원장이 저장된 날은 `{ skipped: 'closed' }`이며 전송·요약 상태 저장이 없다. 어제 표식·표식 없는 기존 원장도 제외한다. 오늘 판정 표식이 있으면 거래가 없어도 요약하며, 이후 같은 날 오류가 나도 포함한다. 일부 전략만 표식이 있으면 그 전략만 요약하고 나머지는 「오늘 기록 없음」으로 표시한다.
- `cli/src/commands/auto.test.ts`: `auto digest` 허용, `auto 다른인자` 거절 유지.
- `tests/auto-agent.test.mjs`(기존 plist·실행 인자 시험 방식): DRY `install-digest.sh`가 라벨 `com.gazua.auto-digest`, `StartCalendarInterval` 월~금(Weekday 1~5) 20:00 plist만 만들고 `com.gazua.auto.plist`는 만들지 않는다 / `digest.sh`가 가짜 node에 `alert.env`·`auto.env`를 `--env-file`로, 절대 경로 `gazua.mjs`와 `auto digest`를 넘긴다.

## 5. 문서

- `cli/README.md` 자동 실행기 절: 설정표에 `AUTO_DRY_PRESETS`, 프리셋 원장 이름, 요약 알림, 설치 명령을 짧게.
- `scripts/macos/auto-agent/README.md`: 요약 설치·제거·수동 실행 한 단락.

## 구현 순서와 검증

1. `config.ts`·`ledger.ts`(경로·`trades`·`judgedDate` 검증) → 2. `preset.ts`와 `run.ts` 연결 → 3. `digest.ts`·`commands/auto.ts` → 4. 스크립트 → 5. 시험·문서.
검증: `cd cli && pnpm check && pnpm test`, 루트 `pnpm check`, 루트 `node --test tests/auto-agent.test.mjs`, `GAZUA_AUTO_DRY=1 AUTO_STRATEGY=x bash scripts/macos/auto-agent/install-digest.sh`로 plist 검사.
