# 메뉴별 사용 영상 (설계·계획)

## 목표

도움말 메뉴 7개(`HELP_PAGES`)마다 데모 모드에서 실제로 누르는 모습을 30~60초 영상으로 녹화한다. 유튜브에 일부 공개로 올리고 README 「메뉴별 도움말」 표에 썸네일 링크를 단다.

이미 있는 것으로 안 되는 이유: `pnpm demo:video`는 시뮬레이션 흐름 하나만 녹화한다.

## 결정

- `scripts/demo-video.mjs`를 넓힌다(새 스크립트를 만들지 않는다). 메뉴마다 새 브라우저 컨텍스트(새 녹화)를 열어 `test-results/demo-video/<id>.webm`·`<id>.mp4`를 만든다.
- 인자로 메뉴를 고를 수 있다: `node scripts/demo-video.mjs [id…]`. 인자가 없으면 7개 전부.
- 기존 `gazua-demo.webm`(시뮬레이션 하나)은 `simulate` 편으로 대체한다. `pnpm demo:video` 명령은 그대로 둔다.
- 메뉴별 흐름은 `MENU_SCENES = { compare, add, groups, simulate, criteria, performance, settings }` 객체 하나에 둔다. 키 순서는 `HELP_PAGES`의 id 순서와 같아야 한다. 각 장면은 `async (page, ctx) => {}` 한 함수이고, 단계 사이에 `pause()`(기본 1000ms)로 멈춘다.
- 선택자는 `tests/e2e/*.spec.ts`의 것을 그대로 쓴다. 도우미는 `scripts/lib/app-preview.mjs`에 이미 있는 것만 쓰고, 두 곳 이상에서 쓰는 것만 추가한다.
- mp4 변환은 지금처럼 `ffmpeg -c:v libx264 -pix_fmt yuv420p -movflags +faststart`. ffmpeg가 없으면 webm만 남긴다.
- 영상 끝에 데모 화면을 1초 더 보여 주고 끝낸다. 내레이션·자막·음악은 넣지 않는다.

## 메뉴별 흐름 (도움말 단계 순서)

| id | 흐름 |
|---|---|
| compare | 데모 → 예시 그룹 → 그룹 탭 누르기 → 기간 `주`·`월`·`년` → 지표 `등락률` 메뉴에서 다른 지표 하나 → 순위 `값 순`/`내 순서` |
| add | 데모 → 예시 그룹 → `＋ 종목 추가` → `삼성` 입력·결과 → `ㅅㅅ`·`005930` → ＋로 담기 → ✓ 다시 눌러 빼기 → `완료` |
| groups | 데모 → 예시 그룹 → 그룹 ＋(새 그룹 2) → `⋯` 그룹 관리 → ✎ 이름 바꾸기 → ↑↓ 순서 → 토스·조건 가져오기 입구만 보여 주기(데모에서 실제 가져오기는 안 되면 연 화면만) |
| simulate | 데모 → 예시 그룹 → 시뮬레이션 → `＋ 새 전략` → 템플릿 → 편집기 매수·매도 구역 펼쳐 보기 → `시뮬레이션 실행` → 결과·재생 몇 초 |
| criteria | 데모 → 설정에서 `tests/fixtures/market-data-demo.json.gz` 가져오기 → 시뮬레이션 › `선정 기준` → `＋ 새 기준` → 미리 보기 → `검증 실행` → 결과(요약·시장별) |
| performance | 데모 → `내 성과`(데모 계좌) → 벤치마크 `KODEX 200` → 기간 `2026` → 차트·표 보기 → `삼성전자` 행 펼치기 |
| settings | 데모 → `설정` → 공급자 목록 보기 → 프록시·키 입력 칸(빈 값 그대로, 키는 넣지 않음) → 연결 진단 입구 → 키 잠그기 스위치 위치까지 스크롤 |

데모에서 막히는 단계(토스 가져오기, 실제 연결 진단, 키 잠그기 암호)는 버튼이 있는 화면까지만 보여 주고 누르지 않는다. 보고에 빠진 단계를 적는다. 한 편이 30초에 못 미치면 멈춤을 늘리지 말고 그대로 둔다(짧은 게 낫다).

## 파일

1. `scripts/demo-video.mjs` — `MENU_SCENES`, 인자 처리, 메뉴별 녹화·변환 루프, 실패한 메뉴 이름을 모아 끝에 알리고 종료 코드 1.
2. `scripts/lib/app-preview.mjs` — 필요하면 `openAddSheet` 같은 작은 도우미만 추가.
3. `tests/demo-video.test.mjs` — 시험 하나: `MENU_SCENES` 키가 `HELP_PAGES` id와 같은 순서로 7개다(브라우저 없이 import만). 이를 위해 `main()`은 직접 실행할 때만 돈다(이미 그렇다).
4. 영상을 올린 뒤: `README.md` 도움말 표에 「사용 영상」 열, `docs/development.md`에 녹화 명령 한 줄. `docs/help/*.md`에는 넣지 않는다(README 한 곳이면 충분하고, 생성 원본을 고치면 일이 커진다).

## 순서와 검증

1. Codex가 1~3을 구현한다(네트워크·브라우저 없이). 
2. 이 세션이 `corepack pnpm build && DEMO_VIDEO_PORT=4193 node scripts/demo-video.mjs`로 녹화하고, 실패하면 선택자를 고친다.
3. `ffprobe`로 길이, `ffmpeg`로 편마다 프레임 3장을 뽑아 본다.
4. `youtube_upload.py --check` → 편마다 `--privacy unlisted` 업로드 → id 모으기.
5. README·development.md 반영 → `corepack pnpm check`, `corepack pnpm test:scripts` → PR → CI 통과 뒤 병합.
