# 시장 파일을 1년씩 과거로 늘리는 예약 수집 (설계·계획)

> 작은 작업이라 설계와 계획을 이 문서 하나로 쓴다. 전제: 사용자 1명, 여러 기기, 무료 운영.

## 왜 (이미 있는 것으로 안 되는 이유)

`--years 5`는 한 번에 3~4시간 토스를 두드리고, `--update`는 앞(최근)으로만 잇는다. 사용자는 5년치를 원하지만 한 번에 오래·빠르게 받기는 싫어했다(2026-11-12). 기존 파일을 **과거 쪽으로 1년씩** 늘리는 모드와 밤마다 한 번 도는 launchd 에이전트를 더한다.

## 확인한 것

- `scripts/toss-collect.mjs`의 `paged(path, q, from, to)`는 `before = <to>T23:59:59+09:00`에서 시작해 최신순으로 `nextBefore`를 따라간다. 그래서 `dailyCandles(s, from, to)`에 `to`를 기존 첫 날짜 근처로 주면 그 앞의 봉을 받는다. 토스 쪽 코드는 바꾸지 않는다.
- 토스가 더 오래된 봉을 주지 않으면(상장일) `nextBefore`가 없어 `paged`가 그냥 끝난다.

## 동작 (`--extend-back <파일>`)

`scripts/collect-market-data.mjs`에 옵션 두 개를 더한다.

- `--extend-back <파일>`: 그 파일을 과거로 `--years`(기본 1)년 늘린 새 파일을 쓴다. `--update`와 같이 쓸 수 없다. `--provider toss`에서만 쓴다(KIS는 범위 밖).
- `--max-years N`(기본 5, 1~10): 오늘부터 N년 전(목표일)보다 앞으로는 늘리지 않는다.
- `--extend-back`에서 `--rate`가 없으면 초당 1건(기본 2의 절반)으로 돈다.

순서:

1. 이전 파일을 읽고(`format` 확인, `source`가 `toss`가 아니면 거부: KIS 파일의 매매동향·재무를 지우지 않게) 계획을 계산한다(순수 함수 `planExtendBack(prev, { years, maxYears, today })`).
   - `oldFrom = prev.range.from`, `target = today − maxYears년`.
   - `oldFrom ≤ target + 14일`이면 **이미 도달**: 「이미 N년치예요」를 남기고 아무것도 하지 않고 끝난다(종료 코드 0). `main()`은 `fetchOwner()`·`loadMaster()`·토스 클라이언트를 만들기 **전에** 이 판단을 한다(마스터·토큰·owner도 받지 않는다). 14일은 연휴·주말로 첫 거래일이 목표일보다 늦는 것을 흡수한다.
   - 아니면 `from = max(oldFrom − years년, target)`, `to = prev.range.to`(끝은 그대로 둔다).
2. 지수(KOSPI·KOSDAQ): 기존 첫 날짜에서 5번째 거래일(`old.d[min(4, len−1)]`)까지를 `to`로 받아(겹침 비교용) `mergeBack`으로 앞에 붙인다.
   - KOSPI가 하나도 늘지 않으면(토스가 더 오래된 지수를 안 줌) 종목을 받지 않고 「더 오래된 지수가 없어요」를 남기고 파일을 쓰지 않고 끝난다(매일 헛수고 방지).
3. 종목: 마스터 순서대로 돈다.
   - 이전 파일에 없는 종목은 넣지 않는다(이번 모드는 늘리기만 한다. 새 종목은 `--update`·새 수집의 일).
   - 모든 종목을 `dailyCandles(s, from, old.d[min(4,len−1)])`로 받아 `mergeBack`. 이미 상장일에 닿은 종목은 토스가 `nextBefore` 없이 한 쪽만 주므로 요청 1건으로 끝나고 붙는 행이 없다(그대로 둔다). 첫 날짜만 보고 요청 없이 건너뛰지 않는다: 지난 실행에서 실패했거나 앞쪽이 거래정지(가격 0 행은 버려진다)인 종목이 영구히 빠지기 때문이다.
   - 실패하면 그 종목은 이전 값 그대로 두고 실패 목록에 넣는다. 치명 오류·연속 20번 실패는 지금처럼 멈추고 `.partial`을 남긴다.
4. `mergeBack(old, fresh)`(순수 함수, 내보낸다):
   - 겹치는 날(`fresh`와 `old`의 앞 5일 중 공통 날짜)의 가격 열(`old`에 있는 o·h·l·c만. 종목은 o·h·l·c, 지수는 o·c)이 하나라도 다르면(그 사이 수정주가가 바뀜) **붙이지 않고** `{ cols: old, mismatch: true }`. 로그에 「수정주가가 달라 늘리지 않았어요: 종목」을 남긴다. 다시 맞추려면 사람이 새로 수집한다(드문 경우라 따로 막지 않는다).
   - 같으면 `fresh` 중 `d < old.d[0]`인 행만 앞에 붙인다. 겹친 날은 기존 값을 지킨다. 붙일 행이 없으면 같은 참조를 돌려준다.
5. 수급·재무: 토스라 받지 않는다(기존 규칙 그대로). 환율·유가는 새 `from` 기준으로 다시 받는다(실패 시 이전 계열 유지는 기존 코드 그대로).
6. 진행분: `.partial` 경로를 날짜 없는 `<out>/market-data-extend-back.partial`로 둔다. 헤더에 `extendFrom`(이전 파일 절대 경로), `source`, `from`, `to`를 넣는다. 다시 돌 때 `.partial`의 `extendFrom`·`source`가 같으면 **그 헤더의 `from`·`to`를 그대로 쓴다**(오늘 날짜로 다시 계산한 `from`이 하루 밀려도 이어 받는다). 다르면 처음부터 받는다.
7. 쓰기: `collectedAt`은 이전 값을 지킨다(끝 날짜가 그대로라 앱의 오래됨 안내가 꺼지지 않게). 오늘 종목 목록에 없는 이전 종목은 넣지 않고 로그에 남긴다. 이름 규칙·형식은 지금과 같다(`market-data-<오늘>.json.gz`, `gazua-market-data` v4). 임시 파일에 쓴 뒤 이름을 바꾼다. 성공하면 이전 파일을 `<out>/market-data-backup.json.gz.bak`으로 옮긴다(이전 백업은 덮어써 하나만 남는다). `.bak`이라 `run.sh`와 (다른 세션이 만드는) 맥 프록시의 「가장 새 `market-data-*.json.gz`」 고르기에 걸리지 않는다. 이전 파일과 새 파일 이름이 같으면(같은 날) 먼저 백업으로 옮긴 뒤 새 파일로 바꾼다.

## 예약 작업 (`scripts/macos/collect-agent/`)

알람 에이전트(`cli/macos/alert-agent/`)를 따른다. 파일: `install.sh`, `uninstall.sh`, `plist.template`, `run.sh`, `README.md`.

- 설정 파일 `~/.config/gazua/collect.env`(없으면 만든다, 권한 600): `GAZUA_COLLECT_DIR=$HOME/gazua-data`, `GAZUA_COLLECT_MAX_YEARS=5`, `GAZUA_COLLECT_RATE=1`. 키는 여기 넣지 않는다.
- `run.sh`가 실제 한 번의 실행이다.
  - 저장소 경로는 `run.sh` 위치에서 절대 경로로 구하고, 실행 전에 `cd <저장소>`한다.
  - 잠금: `<DIR>/.collect-extend.lock`을 macOS `/usr/bin/lockf -t 0`으로 잡은 채 자신을 다시 실행한다. 못 잡으면(75) 「다른 실행이 돌고 있어요」를 남기고 0으로 끝난다. 프로세스가 끝나면 커널이 풀어 남은 잠금을 치울 일이 없다.
  - `<DIR>`에서 이름순으로 가장 새 `market-data-*.json.gz`를 고른다. 없으면 「먼저 수집해 주세요」로 끝난다(1).
  - `node --env-file=<저장소>/.env.toss <저장소>/scripts/collect-market-data.mjs --provider toss --extend-back <파일> --years 1 --max-years $MAX --rate $RATE --out <DIR>`. 키 값은 다루지 않는다. 출력은 launchd가 로그로 보낸다.
- 일정: **매일 03:30 한 번**(`StartCalendarInterval`). 이유: 1년 늘리기는 초당 1건에서 약 2~3시간이라 하루 한 번이면 4번(4일)에 5년에 닿고, 낮 시간 앱·알람의 토스 호출과 겹치지 않는다. 맥이 잠들어 있으면 깬 뒤 한 번 돈다. 5년에 닿은 뒤에는 파일만 읽고 바로 끝난다.
- 로그: `~/Library/Logs/gazua/collect.log`. 라벨 `com.gazua.collect.extend`.
- launchd에는 PATH가 짧아 node를 못 찾으므로, plist가 `/bin/bash <run.sh>`를 부르고 `EnvironmentVariables`로 `GAZUA_COLLECT_NODE`(설치 때의 `command -v node`)와 설정 파일 경로를 넘긴다.
- `install.sh`: Node·`.env.toss` 있음·`cli/dist/gazua.mjs`(owner 표시용) 확인 → 설정 파일 → plist 생성·`plutil -lint` → `launchctl bootstrap`. `GAZUA_COLLECT_DRY=1`이면 임시 폴더에 plist만 만든다(시험용). 바로 한 번 돌리지 않는다.
- `uninstall.sh`: 에이전트만 내리고 설정·로그·데이터는 남긴다고 알린다.

## 시험 (`tests/collect-extend-back.test.mjs`·`tests/collect-agent.test.mjs`, 가짜 토스 클라이언트)

토스 가짜 서버는 `tests/toss-collect.test.mjs`의 `fakeToss`와 같은 모양으로 둔다. 한 동작은 한 곳에서만 시험한다.

1. 늘리기 병합: 이전 파일(최근 N일)과 그 앞 1년이 있는 가짜 서버 → 지수·종목 앞에 붙고, 겹친 날은 기존 값이며, `range.from`이 앞당겨진다. 파일 이름 규칙·백업 하나·이전 백업 덮어쓰기.
2. 상장일 종목: 더 오래된 봉이 없는 종목은 요청 1건으로 끝나고 그대로다. 지난 실행에서 실패해 첫 날짜가 늦은 종목은 이번에 앞이 채워진다.
3. 수정주가 불일치: 겹친 날 값이 다르면 그 종목은 그대로이고 로그에 남는다(`mergeBack` 단위 시험 한 개로).
4. 이어 받기: 몇 종목 뒤 치명 오류로 멈춘 뒤, 다음 날(`now`를 하루 뒤로, 목표일에 걸려 `from`이 달라지는 경우) 다시 돌리면 `.partial`의 기간을 쓰고 끝난 종목은 다시 요청하지 않는다.
5. 5년 도달: 도달한 파일로 스크립트를 자식 프로세스로 실행하면(가짜 키 환경변수, 네트워크 없음) 0으로 끝나고 「이미」 문구를 내며 파일을 쓰지 않는다(owner·마스터·토큰 요청 전에 끝남).
6. 옵션: `--extend-back`과 `--update` 함께 쓰면 거부, `--provider kis`면 거부, `--rate` 없으면 1.
7. 에이전트: `GAZUA_COLLECT_DRY=1 install.sh`로 만든 plist가 `plutil -lint`를 통과하고 03:30 일정·로그 경로를 가진다. `run.sh`를 저장소 밖 작업 디렉터리에서 실행해도 가짜 node가 절대 경로 인자를 받는다. 살아 있는 잠금이 있으면 node를 부르지 않고 0으로 끝난다(가짜 `GAZUA_COLLECT_NODE`로 확인).

## 문서

- `docs/development.md` 토스 절에 `--extend-back`·예약 작업 두세 줄.
- `docs/roadmap.md` 106줄 「토스로 시장 파일 수집」에 「1년씩 과거로 늘리는 밤 예약 작업(PR 번호)」를 덧붙인다.
- `scripts/collect-market-data.mjs` 머리 주석에 사용 예 한 줄.

## 범위 밖

KIS 경로, 매매동향·재무, Drive 업로드, `proxy/`·`src/lib/marketData/`·웹 앱. 설치·실제 수집은 이 작업에서 돌리지 않는다.

## 검증

`node --test tests/collect-market-data.test.mjs tests/toss-collect.test.mjs`, `pnpm test:scripts`, `pnpm check`, `pnpm test`, `pnpm build`. 셸 스크립트는 `bash -n`.
