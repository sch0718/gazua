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
  3. 네이버 일봉은 「주 전략 종목 ∪ 모든 원장의 보유 종목」에 대해 종목당 1번만 받는다. 시작일은 모든 전략·보유의 가장 이른 날로 하고, 각 전략은 자기 시작일(기존 계산과 같은 `warmFrom`·`boughtAt` 최솟값) 이후 봉만 잘라 쓴다. 그래서 주 전략 판정 입력은 지금과 같다. 종목 이름 조회도 공유한다.
  4. 주 전략은 지금 코드 그대로 판정·알림한다.
  5. 주 전략 판정이 끝난 뒤 프리셋마다 `try/catch`로 따로 판정한다. 새 함수 `judgeDry(strategy, ledger, bars, ...)`(`cli/src/auto/preset.ts`)가 `decideSell`·`decideBuy`·`tickDown`·`tickUp`을 써서 연습 매도→매수를 하고 원장만 저장한다. ntfy는 보내지 않는다. 오류는 결과 JSON의 `presets[].error`(코드만)에 남기고 다음 프리셋으로 간다. 주 전략의 오류·회복 알림과 무관하다.
- 거래 기록: 원장 `today`에 선택 필드 `trades?: { side: 'BUY'|'SELL'; symbol; name; qty; price; reason }[]`를 더한다(검증 함수에 반영, 날이 바뀌면 `today`와 함께 비워진다). 주 전략은 `mode === 'dry'`일 때 `send()`에서, 프리셋은 `judgeDry`에서 넣는다. 실전 원장에는 넣지 않는다.
- 결과 JSON에 `presets: { id, name, buys, sells, error? }[]`를 더한다(꺼짐이면 빈 배열).

## 2. 저녁 요약 (`gazua auto digest`)

- `cli/src/commands/auto.ts`: 위치 인자가 정확히 `['digest']`면 `runDigest`, 그 밖의 위치 인자·`--yes`는 지금처럼 거절.
- `cli/src/auto/digest.ts` `runDigest(ctx, deps)`:
  1. 평일 KST 15:30 이후가 아니면 `{ skipped: 'hours' }`.
  2. 요약 상태 `auto-digest.json`(`{ date }`, 권한 600)의 날짜가 오늘이면 `{ skipped: 'sent' }`.
  3. 연습 원장들(주 전략 + `AUTO_DRY_PRESETS=all`이면 프리셋 5개)의 원본 `today.date`가 오늘인 것만 고른다. 하나도 없으면 휴장·미실행으로 보고 `{ skipped: 'closed' }`(보내지 않음). 원장은 `auto`가 장 `OPEN`일 때만 저장하므로 오늘 날짜는 실행 흔적이다.
  4. 보유 종목의 오늘 종가를 네이버 일봉으로 종목당 1번 받는다. 실패하면 그 종목은 「평가 불가」.
  5. 본문(전략별 블록):
     - 제목 줄: 주 전략은 `AUTO_STRATEGY` 값, 프리셋은 템플릿 이름.
     - 오늘 거래: `매수 005930 삼성전자 10주 70,000원 (이유)` / 매도 같음. 없으면 「거래 없음」.
     - 보유: `종목명 수량주 평단→종가 +1.2%`. 없으면 생략.
     - 오늘 원장이 없는 전략(예: 손상)은 「오늘 기록 없음」.
  6. 제목 `[연습] 오늘 연습 결과 M/D`, 끝 줄 「투자 조언 아님」. 본문은 UTF-8 3,500바이트를 넘으면 줄 단위로 자르고 `…(줄임)`을 붙인 뒤 끝 줄을 유지한다(ntfy 메시지 한도 4,096바이트).
  7. ntfy 전송이 성공하면 `auto-digest.json`에 오늘 날짜를 쓴다. 실패하면 쓰지 않는다(다음 실행에서 재시도).
- 토픽은 `ctx.redact`에 더하고 결과·로그에 쓰지 않는다.

## 3. launchd

- `scripts/macos/auto-agent/digest.sh`: `run.sh`처럼 `alert.env`·`auto.env`를 Node 환경 파일로 읽고 `gazua.mjs auto digest`를 실행. 원장은 읽기만 하므로 `lockf`는 쓰지 않는다.
- `digest.plist.template`: 라벨 `com.gazua.auto-digest`, `StartCalendarInterval` 월~금(Weekday 1~5) 20:00. 맥이 잠들어 지나치면 깨어난 뒤 한 번 돌고, 날이 바뀌었으면 오늘 원장이 없어 건너뛴다.
- `install-digest.sh`·`uninstall-digest.sh`: 기존 `install.sh`의 Node·빌드·`alert.env` 검사, XML 이스케이프, `plutil -lint`, `GAZUA_AUTO_DRY=1` plist만 만들기, 실패 시 되돌리기를 같은 방식으로. 기존 `com.gazua.auto` 파일은 건드리지 않는다.

## 4. 시험 (`cli/src/auto/*.test.ts`, 동작만큼)

- `run.test.ts`: 프리셋 켬 → 프리셋 원장 5개가 따로 생기고 주 전략 원장 내용은 꺼짐과 같다 / 프리셋 거래 ntfy 0건 / 종목당 네이버 일봉 요청 1번 / 한 프리셋 원장 손상이 주 전략·다른 프리셋을 막지 않는다 / live면 프리셋 원장 없음.
- `config.test.ts`: `AUTO_DRY_PRESETS` 허용·잘못된 값 거절.
- `digest.test.ts`: 본문(거래·거래 없음·보유 손익률·`[연습]`·「투자 조언 아님」) / 같은 날 두 번 안 보냄 / 오늘 원장 없으면 안 보냄 / 전송 실패면 상태 안 씀 / 길이 줄임.
- `cli/src/commands/auto.test.ts`: `auto digest` 허용, `auto 다른인자` 거절 유지.

## 5. 문서

- `cli/README.md` 자동 실행기 절: 설정표에 `AUTO_DRY_PRESETS`, 프리셋 원장 이름, 요약 알림, 설치 명령을 짧게.
- `scripts/macos/auto-agent/README.md`: 요약 설치·제거·수동 실행 한 단락.

## 구현 순서와 검증

1. `config.ts`·`ledger.ts`(경로·`trades` 검증) → 2. `preset.ts`와 `run.ts` 연결 → 3. `digest.ts`·`commands/auto.ts` → 4. 스크립트 → 5. 시험·문서.
검증: `cd cli && pnpm check && pnpm test`, 루트 `pnpm check`, `GAZUA_AUTO_DRY=1 AUTO_STRATEGY=x bash scripts/macos/auto-agent/install-digest.sh`로 plist 검사.
