# 시뮬레이션 화면 UI/UX 리뷰 (2026-10-13)

- 리뷰 대상: feat/backtest-simulation 568f47e, 데모 공급자, Playwright 375×812·1440×900, 라이트·다크
- 기준: 닐슨 휴리스틱 10원칙(기반 스펙 9장), 기존 화면과의 일관성, 사용 편의성, 시인성
- 구현 계획: [2026-10-13-simulation-polish.md](../superpowers/plans/2026-10-13-simulation-polish.md)


## Findings

U1 High — 모바일 앱 바 넘침 (결과·로딩에서 `규칙` 버튼이 있을 때) · 시인성/H1/H4
- 측정: 결과 화면 scrollWidth 386 > 375. 제목 폭 0, 설정 아이콘 잘림(phone-light-25-loading). 편집 제목 "새…", 목록 "시…"(phone-light-03, 22).
- Simulate.svelte:74-87, App.svelte:103-119(barEnd = 상태 칩 140px + 아이콘 2개). e2e helpers.ts:44-52가 innerWidth와 비교 → isMobile에서 innerWidth도 386이라 못 잡음.
- Fix: (1) simulate 경로에서 600px 미만이면 StatusChip을 그리지 않음(barEnd에 compact 인자) (2) .title `flex:1 1 auto; min-width:0`, 스페이서는 규칙 버튼 앞 (3) 편집 화면 제목은 고정 `시뮬레이션`(이름은 입력 칸에 있음) (4) e2e helper는 page.viewportSize().width와 비교, 결과·로딩 상태에서도 검사.

U2 High — 넓은 화면에서 규칙을 바꿔도 이전 결과가 그대로, 표시 없음 · H1/H5
- Simulate.svelte:94-112, StrategyEditor.svelte:70-75.
- Fix: DoneState.meta.strategy와 현재 draft 비교(updatedAt·name 제외). 다르면 결과 위에 Banner tone="info" `규칙이 바뀌었어요. 다시 실행하면 결과에 반영돼요` + actionLabel `다시 실행`(현재 draft로), 결과 opacity .5.

U3 Medium — 모바일: 편집으로 간 뒤 결과로 돌아갈 길 없음; 로딩 중 규칙으로 가면 실행이 보이지 않게 계속됨 · H3
- Simulate.svelte:53.
- Fix: done/loading 상태에서 편집 화면 바에 `.rules`와 같은 모양의 `결과` 버튼. (Ruling: spec 7.4에 추가)

U4 Medium — 거래 차트 시트 마커·라벨 충돌 · 차트 가독성
- phone-light-17, desktop-dark-17: 매수·추가 마커 겹침, TradingView 로고와 겹침, B/L 축 라벨 맞닿음, 첫 x 라벨 잘림, A·B·L 모두 --t3.
- TradeChartSheet.svelte:72-103.
- Fix: rightPriceScale.scaleMargins {top:.12,bottom:.22}; 같은 방향 마커가 3봉 이내면 하나로 합쳐 라벨 `매수·추가`; 고른 돌파 기준선(A 또는 B)만 --accent, L은 SparseDotted; L axisLabelVisible:false(값은 요약 텍스트에 있음).

U5 Medium — 편집 라벨이 단어 중간에서 줄바꿈, 숫자 칸 정렬 안 됨
- phone-light-05-sec-매수: "고점 대비 하락 / 폭". 매도: 삭제 버튼 때문에 목표 칸만 좁음.
- NumberField.svelte:86-116, ExitSection.svelte:36-49.
- Fix: label `word-break: keep-all`; input width 7ch, .box min-width 128px; 단계 삭제는 단계 제목 줄 끝 ✕(UniverseSection의 .x 재사용).

U6 Medium — 꺼진 조건이 켜진 것처럼 보임 · H1/H6
- 꺼진 행 필드 opacity 1, input 활성. 라벨 탭은 토글이 아니라 INPUT에 포커스. 골든크로스 꺼도 하위 칸 활성(EntrySection.svelte:50-61).
- Fix: NumberField `muted` prop → opacity .5(Toggle:disabled·Segmented aria-disabled와 같은 값). A/B 세그먼트·골든크로스 칸에도 적용.

U7 Low — 토글 위치가 설정 화면과 반대 · 일관성
- 설정 키 잠금은 "라벨 … [토글]"(phone-light-02), 편집은 "[토글] 라벨 [필드]".
- Fix: 설정 `.row` 패턴(라벨 · 필드 · 오른쪽 토글).

U8 Medium — 숫자 입력 실제 탭 영역 84×23px · 터치(44px, 스펙 8.2)
- NumberField.svelte:58-71(.box가 span). 박스 여백을 탭하면 포커스 BODY.
- Fix: .box를 `<label for>`로, 또는 input `align-self:stretch; height:100%`.

U9 Medium — 종료일 입력이 카드 밖으로 넘침(375px)
- 오른쪽 끝 364px > 카드 359px, 달력 아이콘 잘림(phone-light-08). PeriodSection.svelte:33-54.
- Fix: `grid-template-columns: minmax(0,1fr) minmax(0,1fr)`; input `width:100%; min-width:0`.

U10 Medium — 금액 자릿수 구분 없음 · H2
- 입력 `10000000 원`, 요약은 `1,000만 원`. 범위 오류 `1~10000000000000 사이로…`. NumberField.svelte:26,73.
- Fix: NumberField `format` prop(포커스 아닐 때 fmtWon) 또는 힌트 줄 `= 1,000만 원`(simText.money()); 오류의 min/max도 fmtWon.

U11 Medium — 접힌 요약이 중요한 부분에서 잘림, 셰브런 위치가 흔들림
- phone-light-04 "…1,000만 …", phone-light-10 셰브런 x 653 vs 676. EditorSection.svelte:55 (`auto 1fr auto auto`).
- Fix: 두 줄 헤더(제목 / 요약 --fs-sub, 2줄 clamp, 왼쪽 정렬 — 목록 행 .name/.line과 같은 구조); 셰브런 `grid-column:-2/-1` 고정.

U12 Medium — 경고가 다른 구역에 뜸, 플래그가 색으로만 구분
- 분할 매수 켜면(10×3×4=120) 경고가 기간·자금에 뜸(validate.ts:197-199 keyOf). 라이트 플래그 갈색 #855600 vs 빨강 #b82a2a, 같은 `!`. 플래그 aria-hidden → 헤더 이름에 경고 정보 없음(EditorSection.svelte:32).
- Fix: 헤더에 sr-only `· 고쳐야 실행돼요` / `· 확인할 점이 있어요`; 경고는 다른 글리프(`i` 또는 `△`); 분할 매수가 켜져 있으면 자금 경고를 기간·자금과 분할 매수 둘 다에 표시.

U13 Medium — 삭제가 --down(한국식에서 파랑 = 하락) · 일관성/H2
- StrategyList.svelte:217-219, EditorSection.svelte:127-129. 기존은 --err(GroupSheet.svelte:207,235, StockDetailSheet.svelte:349, KeyLock.svelte:235).
- Fix: `color: var(--err)`.

U14 Medium — 거래 내역 훑어보기 어려움
- 연도 없음(11.21 → 01.15), 값 오른쪽 정렬 안 됨, `1단계 익절 80% · ▲15.0%` 퍼센트 두 개, 손익 형식이 앱(`▲ +15.0%`, trendReturn/fmtPct)과 다름, `@ 44,913`에 원 없음, 열리는 표시(›) 없음. TradeList.svelte:17-36.
- Fix: Leaderboard 행 구조 재사용 — 1줄: 종목명 + 오른쪽 정렬 num 값(매도는 trendReturn, 매수는 `22주 · 44,913원`), 2줄: 날짜·사유 --t3; 연도 구분선(설정 h2 스타일); 행 끝 `›`.

U15 Medium — 자산 곡선 선 대비 낮음, 범례에 점선 구분 없음
- 밝은 배경에서 지수 --s2 2.63:1, 비교 종목 --s1 2.99:1, 1px 점선(WCAG 1.4.11 3:1 미만). 스펙은 슬롯 1·7 + 회색인데 지수가 s2(EquityChart.svelte:26-31). 범례 견본 모두 실선(:108-112). 맨 위 y 라벨 +30.0% 잘림(phone-light-13). 비교 기준 행에 색 견본 없음.
- Fix: 지수 --t2 점선, 비교 종목 lineWidth 2, 범례 점선 견본, scaleMargins.top .1, .bench 행에도 같은 견본. (Ruling: 전략 선은 파랑 s7이 하락으로 읽히므로 --accent로)

U16 Medium — 결과 영역이 토큰·위계를 벗어남
- 요약 카드 radius 12 + 1px 테두리 vs 앱 카드 --r-card 16 무테. 값 20px·라벨 12px(토큰 밖). 총수익률은 --fs-headline 28. 결과 여백 16px vs 편집 --gutter. 결과 화면 글자 크기 12/12.5/13/14/15/18/20 혼재. ResultView.svelte:160-245.
- Fix: 카드 --r-card 무테; 총수익률 --fs-headline, 나머지 셋 --fs-title; 라벨·부가 --fs-sub; 여백 `16px var(--gutter)`; 본문 --fs-body.

U17 Medium — 새 전략 이름이 모두 "새 전략"
- Fix: create()에서 번호(`새 전략 2`, `새 전략 3`…).

U18 Low — 넓은 화면 첫 실행 전 결과 칸이 빈칸 (RunPanel.svelte:35)
- Fix: idle 힌트 `규칙을 정하고 시뮬레이션 실행을 누르면 여기에 결과가 나와요`.

U19 Low — 진행 막대 트랙이 안 보임(--surface2 on --bg ≈1.04:1, RunPanel.svelte:82-93); `0/7`이 무엇인지 설명 없음
- Fix: 트랙 --line; 부가 줄 `종목 4개 · 지수 · 비교 기준`.

U20 Low — `건너뛴 신호 0` 탭이 아무것도 안 그림
- Fix: `건너뛴 신호가 없어요`.

U21 Low — 전부 건너뜀 결과가 같은 행 89개만 나열
- Fix: 사유별 개수 + 고칠 곳 안내(`기간·자금에서 회당 비중이나 처음 자금을 늘려 보세요`); `규칙 고치기`가 그 구역을 열기.

U22 Low — 다크에서 카드 안 세그먼트 선택 항목이 들어가 보임(--surface #17181b on --surface2 #1f2125 ≈1.1:1)
- Fix: Segmented `onSurface` 변형(트랙 --bg, 선택 --surface2).

U23 Low — tabular-nums 빠짐: .sum, .cards small, .trade-chart .summary, .why, NumberField input
- Fix: `num` 클래스 또는 `font-variant-numeric: tabular-nums`.

U24 Low — 거래 시트 요약 날짜 "3.24/3.5" vs 목록 "03.24"; "50,875 / 원" 줄바꿈; 제목이 종목명뿐
- TradeChartSheet.svelte:61-62,112.
- Fix: shortDate 사용; 단계별 nowrap span; 제목 `DB하이텍 · 25.03.24 매수`; 요약 끝에 결과 `▲ +15.0%`.

U25 Low — 섹션 셰브런이 텍스트 글리프 ⌄/⌃(EditorSection.svelte:33), 앱은 ▾·SVG; 앱 바 시뮬레이션 아이콘에 aria-current 없음(레일은 있음)
- Fix: 회전하는 ▾; App.svelte:105 아이콘에 aria-current + .on 배경.

U26 Low — 분할 매수가 꺼져 있는데 기본 손절 기준이 "분할 완료 후 평단", 옵션 2줄로 줄바꿈
- Fix: 라벨 `분할 후 평단 / 매번 평단 / 첫 매수가`; 힌트 `평단 = 평균 매수가예요. 분할 매수를 끄면 세 기준이 같아요`; 분할 매수 꺼져 있으면 요약에서 기준 생략.

U27 Low — 종목별 탭 모든 행에 "부터 참여" (데이터 축 자체가 늦게 시작, SymbolTab.svelte:31)
- Fix: meta.from(실제 축 시작)과 비교. (Ruling 반영 — B1과 함께)

U28 Low — 복제 위치가 스펙 7.3(머리줄)과 다름(StrategyEditor.svelte:122-125)
- 권고: U1 때문에 지금 위치 유지, 스펙 수정.

U29 Low — 거래 9번 / 2승 4패 숫자가 안 맞아 보임(9 = 끝난 6 + 보유 3)
- Fix: 부가 줄 `끝난 6번 · 아직 보유 3종목 · 평균 149일`.

## Copy review (현재 → 제안)
- nearMiss ① simText.ts:131 `가장 크게 빠진 때도 27.0%였어요(조건 85%)` → `고점 대비 가장 크게 빠진 때도 27.0%라, 하락 조건(85% 이상)에 닿지 않았어요`
- nearMiss ② simText.ts:132 `하락 조건을 만족한 날이 N일 있었지만 매수 트리거가 나지 않았어요` → `충분히 떨어진 날은 N일 있었지만, 그 뒤 ②의 사는 신호(연속 상승·돌파 등)가 한 번도 나오지 않았어요` (편집 화면 보이는 제목은 `② 그다음 이 중 하나가 나오면 사요`, '트리거'는 aria-label에만)
- nearMiss 대체 simText.ts:133 → days.on이면 `고점 뒤 N거래일 넘게 떨어진 적이 없었어요(조건 N일 이상)`
- validate.ts:186(스펙 3.1) `매수 신호가 나지 않아요. 트리거를 하나 이상 켜 주세요` → `사는 신호가 하나도 켜져 있지 않아요. ②에서 하나 이상 켜 주세요`
- 요약: `트리거 없음` → `사는 신호 없음`; `고점 대비 10%↓ 뒤 → …` → `고점 대비 10% 하락 뒤 → …`; `익절 +15% 50% → +25% 25% → +35% 전량` → `익절 +15%에 50% → +25%에 25% → +35%에 나머지`; `3%씩 최대 2번` → `3% 내릴 때마다 최대 2번 더`; `수수료 0.015% · 매도 세금` → `수수료 0.015% · 팔 때 세금 포함`
- PeriodSection `한 번에 사는 금액` / `% (자금 대비)` → `회당 매수 비중` / `% (처음 자금 대비)`
- NumberField 오류 min/max는 fmtWon
- PatternHelp `마지막으로 리셋한 뒤` → `마지막으로 전량 판 뒤(처음이면 기간 시작부터)`
- 손절 기준 옵션 (U26)
- 결과 카드 `보유 대비 −4.4%p` → `그냥 보유보다 −4.4%p`; `평균 149일 보유 · 보유 중 3` → `끝난 6번 · 아직 보유 3종목 · 평균 149일`
- 전부 건너뜀 `매수 신호 89번이 모두 건너뛰어졌어요` → `매수 신호가 89번 났지만 한 번도 사지 못했어요`; `가장 많은 이유: 1주가 1회 금액보다 비쌈` → `주로 1주 가격이 회당 매수 금액보다 비싸서였어요`
- 건너뛴 사유 표시 매핑(스펙 5.6 enum은 그대로): `현금 부족` → `현금이 모자랐어요`, `1주가 1회 금액보다 비쌈` → `1주가 회당 금액보다 비싸요`, `거래 없음` → `그날 거래가 없었어요`
- 비교 기준 `같은 종목 보유` → `같은 종목 사서 보유`
- 거래 내역 `1단계 익절 80%` → `1단계 익절(80% 매도)`, 손익은 trendReturn
- 삭제 스낵바 `'새 전략'을 지웠어요` → `'새 전략'을(를) 삭제했어요` (groupActions.ts:92와 같게)
- 유지: 종목 힌트, `켠 조건을 모두 만족해야…`, 한계 문구, `… 사본`

## 처리 결과

2026-10-13 재검토. 6e8a558~5b3967d를 반영한 프로덕션 빌드(vite preview, base `/gazua/`), 데모 공급자, 시계 2026-10-08 17:42 KST, Playwright 375×812(isMobile, DPR 2)·1440×900, 라이트·다크로 다시 찍고 쟀다. 스크린샷 이름은 재검토용 스크래치패드(`ui-recheck/shots/`)의 것이고 저장소에는 넣지 않는다. 대비는 WCAG 상대 휘도 식으로 토큰 값에서 계산했다.

| U | 처리 | 확인 근거 |
|---|---|---|
| U1 | 해결. 폰 폭(<600)에서 시뮬레이션 머리줄에 상태 칩을 그리지 않고, 편집 화면 제목은 늘 `시뮬레이션`. e2e 가로 스크롤 검사는 설정한 뷰포트 폭과 비교하고 결과·로딩 상태도 본다 | 375px에서 목록·편집·결과·로딩·전부 건너뜀·규칙 복귀 모두 scrollWidth 375, 제목 폭 129~187px·잘림 없음(phone-light-12-result, 25-loading, 25b-loading-then-rules). e2e `시뮬레이션: 목록·편집·로딩·결과 어느 상태에서도 가로 스크롤이 없다` 4개 프로젝트 통과 |
| U2 | 해결. 넓은 화면에서 규칙이 바뀌면 결과 위 배너 `규칙이 바뀌었어요. 다시 실행하면 결과에 반영돼요` + `다시 실행`, 본문 opacity .5 | 하락폭 10→15로 바꾸면 배너·dim 0.5, 10으로 되돌리면 dim 없음(desktop-light-12b-stale-result, desktop-dark 동일) |
| U3 | 해결. 좁은 화면에서 `규칙`으로 편집에 가 있으면 대기 상태가 아닐 때 머리줄에 `결과` | 결과 뒤·로딩 중 모두 편집 머리줄에 `결과`(205–255px), 누르면 결과로 돌아옴(phone-light-18-back-to-rules, 25b-loading-then-rules) |
| U4 | **일부 해결.** 같은 방향 3봉 이내 마커 합치기(`매수·추가`), 고른 기준선(B)만 `--accent`·A는 `--t3`, L은 성긴 점선에 축 라벨 없음, 가격 축 여백으로 TradingView 로고와 마커가 겹치지 않고 B·A 축 라벨도 떨어짐. **첫 x 라벨(`'25년`)이 왼쪽에서 잘리는 것은 그대로**다(리뷰 Fix 목록에 없던 항목) | phone-light-17-trade-sheet, desktop-dark-17-trade-sheet. 단위 테스트 `마커: 포지션 거래만, 같은 방향이 3봉 이내면 하나로 합친다(매수·추가)` |
| U5 | 해결. 라벨 `word-break: keep-all`, 숫자 칸 박스 min-width 128px로 오른쪽 끝이 맞음, 단계 삭제는 단계 제목 줄 끝 `✕`(44×44) | `고점 뒤 지난 / 거래일`처럼 단어 사이에서만 줄바꿈, 매수 구역 박스 오른쪽 끝 모두 279px(토글 칸 앞), 토글 없는 줄은 모두 343px, 단계의 목표·파는 양도 343px로 맞음, ✕ 299–343px(phone-light-05-sec-매수, 05-sec-매도) |
| U6 | 해결(방식 조정). 꺼진 칸은 opacity .5 대신 박스 배경 없음·테두리 `--line`·글자 `--t3`(글자 대비 AA 유지, 66bc441), 돌파를 끄면 A/B 글자 `--t3`, 라벨을 누르면 그 줄 토글이 바뀜. 스펙 7.3 문구도 이 방식으로 고침 | 꺼진 칸 opacity 1·배경 투명·입력 `--t3`(--surface 위 5.21:1 라이트, 5.19:1 다크). 라벨 탭 → 스위치 false→true, 포커스 switch(phone-light-05b-entry-days-on, 09b-entry-breakout-off) |
| U7 | 해결. `라벨 · 숫자 칸 · 오른쪽 토글` | 토글이 있는 5줄 모두 라벨 x < 박스 x < 스위치 x(375px: 32 < 143 < 291) |
| U8 | 해결. 숫자 칸 박스가 입력과 연결된 `<label for>` | 박스 148×44, 박스 여백(6,4) 탭 → INPUT 포커스. 모든 구역을 펼친 편집 화면에 44px 미만 탭 대상 0개(결과·시트의 35×19는 차트 라이브러리의 TradingView 로고 링크로 리뷰 전부터 있던 것). e2e `편집: 모든 구역을 펼쳐도 카드 밖으로 넘치지 않고, 숫자 칸 박스·라벨이 크게 눌린다` |
| U9 | 해결. 날짜 칸 `minmax(0,1fr)` 두 칸 | 종료일 오른쪽 끝 343px ≤ 구역 안쪽 343px(구역 359px), 달력 아이콘 보임(phone-light-05-sec-기간자금) |
| U10 | 해결. 처음 자금은 포커스 밖에서 `10,000,000` + `= 1,000만 원`, 범위 오류의 최소·최대도 천 단위. **다만 새 문제가 생겼다**: 금액 칸에 Tab·Shift+Tab으로 들어오면 포커스 때 쉼표 없는 값으로 바꾸면서 브라우저의 전체 선택이 풀려 커서가 끝에 놓인다. 바로 숫자를 치면 기존 값 뒤에 붙는다(다른 숫자 칸은 전체 선택 유지) | 입력 `10,000,000`, `= 1,000만 원`, 오류 `1~10,000,000,000,000 사이로 적어 주세요`(phone-light-07b-capital-invalid). 새 문제: Shift+Tab 진입 시 selection 8–8(값 `10000000`), `5000000` 입력 → `100000005000000`. 회당 매수 비중 칸은 진입 시 selection 0–2, `20` 입력 → `20` |
| U11 | 해결. 두 줄 머리(제목 / 요약 `--fs-sub` 2줄 clamp), 셰브런은 마지막 칸 고정 | 기본 전략 7구역 요약 잘림 없음, 셰브런 x가 경고 표시 유무와 관계없이 모두 336px(폰)·785px(PC)(phone-light-04-editor-collapsed, 10-collapsed-with-flags) |
| U12 | 해결. 확인할 점 `△`(`--warn`), 막는 경고 `!`(`--err` 원), 머리 버튼 이름에 `· 확인할 점이 있어요`/`· 고쳐야 실행돼요`, 분할 매수가 켜져 있으면 자금 경고를 두 구역에 | 회당 30%에서 기간·자금과 분할 매수 둘 다 같은 경고 Banner. 플래그 글리프·이름 확인(phone-light-10-collapsed-with-flags, phone-dark 동일) |
| U13 | 해결. 삭제는 `--err` | 단계 ✕·목록 메뉴 `삭제` 색 rgb(184,42,42)=라이트 `--err`, rgb(255,107,107)=다크 `--err`(phone-light-23-row-menu, phone-dark-05-sec-매도) |
| U14 | 해결. 리더보드 행 구조, 연도 구분선, 오른쪽 정렬 값(매수 `22주 · 44,913원`, 매도 `▲ +15.0%`), 사유 `1단계 익절(80% 매도)`, 행 끝 `›` | `2025년`·`2026년` 구분선, 행 높이 60px, 값 오른쪽 끝 고정(phone-light-12-result, 16-tab-trades) |
| U15 | **일부 해결.** 전략 `--accent`(라이트 5.72:1), 같은 종목 보유 `--t3` 실선(4.86:1), 지수 `--t2` 점선(5.90:1), 비교 종목 굵기 2, 범례·비교 기준 행에 실선/점선 견본, 가격 축 위 여백으로 맨 위 라벨 안 잘림. **비교 종목 `--s1` 선은 라이트 `--bg` 위 2.99:1로 3:1에 0.01 모자란다**(Fix가 굵기만 바꿨고 색은 그대로). 다크는 4.94:1 | phone-light-13-equity, phone-light-12-result. 비교 기준 4행 모두 견본 있음 |
| U16 | 해결. 카드 `--r-card` 무테, 총수익률 `--fs-headline`, 나머지 `--fs-title`, 라벨·부가 `--fs-sub`, 여백 `16px var(--gutter)` | radius 16px·border 0, 값 28/17/17/17px, 라벨·부가 13px, padding 16px 16px(폰)·16px 24px(PC). 결과 영역 글자 크기는 28/17/15/13/11px(토큰)과 공용 컴포넌트(Badge 10px, Segmented 14px)뿐 |
| U17 | 해결. 새 전략 번호 | 두 번째·세 번째 생성 이름 `새 전략 2`·`새 전략 3`(phone-light-22-sim-list-3) |
| U18 | 해결. 넓은 화면 idle 안내 | `규칙을 정하고 시뮬레이션 실행을 누르면 여기에 결과가 나와요`(desktop-light-04-editor-collapsed) |
| U19 | 해결. 진행 막대 트랙 `--line`, 부가 줄 `종목 4개 · 지수 · 비교 기준` | 트랙 대비 `--bg` 위 1.05→1.18(라이트), 1.19→1.39(다크)로 눈에 보임(phone-light-25-loading). 트랙은 장식이고 진행은 채움색으로 읽는다 |
| U20 | 해결. 빈 건너뛴 신호 탭 | `건너뛴 신호 0` 탭 → `건너뛴 신호가 없어요`(phone-light-15-tab-skipped) |
| U21 | 해결. 사유별 개수 + 안내, `규칙 고치기`가 기간·자금을 엶 | `매수 신호가 89번 났지만 한 번도 사지 못했어요` / `1주가 회당 금액보다 비싸요 89번` / 안내 문구, 누르면 펼쳐진 구역 = 기간·자금(phone-light-21-all-skipped, 21c-fix-opened) |
| U22 | 해결. `Segmented onSurface`(트랙 `--bg`, 선택 `--surface2`) | 다크 트랙 #0e0f11·선택 #1f2125로 선택이 트랙보다 밝아 올라와 보임(이전엔 선택이 더 어두움)(phone-dark-05-sec-매도) |
| U23 | 해결. 숫자에 tabular-nums | 편집·결과 화면에서 숫자+단위 글자 중 tabular가 아닌 요소 0개, 숫자 입력도 `num` |
| U24 | 해결. 제목 `DB하이텍 · 25.03.24 매수`, 날짜 `03.24` 형식, 단계별 nowrap, 끝에 결과 | 요약 `매수 03.24 44,913원 → 추가 03.25 43,566원 → 익절 04.23 50,875원 → 익절 03.05 55,299원 · ▲ +17.0%`, 단계 span white-space nowrap(phone-light-17-trade-sheet) |
| U25 | 해결. 회전하는 `▾`, 앱 바 시뮬레이션 아이콘 `aria-current="page"` + `.on` 배경 | 아이콘 aria-current=page, 배경 rgb(240,241,244)(phone-light-03-sim-list-empty) |
| U26 | 해결. 옵션 `분할 후 평단 / 매번 평단 / 첫 매수가`(한 줄, 44px), 평단 힌트, 분할 매수를 끄면 요약에서 기준 생략 | 요약: 켬 `… · 손절 −5% 분할 후 평단`, 끔 `… · 손절 −5%`(phone-light-05-sec-매도) |
| U27 | 해결. 실제 축 시작(meta.from)과 비교 | 데모 결과 종목별 탭에 `부터 참여` 0행(phone-light-14-tab-symbols) |
| U28 | 해결(스펙). 복제는 이름 칸 옆 유지, 스펙 7.3에 반영 | 스펙 7.3 `복제는 이름 입력 칸 옆에 둔다` |
| U29 | **해결 안 됨(잘못된 숫자).** 부가 줄 형식은 `끝난 N번 · 아직 보유 N종목 · 평균 N일`로 바뀌었지만, `끝난`과 카드 값 모두 보유 중 포지션까지 센 `summary.roundTrips`를 쓴다. 그래서 `9번 / 끝난 9번 · 아직 보유 3종목`이 `2승 4패`(끝난 6번)와 여전히 안 맞고, `끝난 9번`은 사실과 다르다(ResultView.svelte 카드 `거래 횟수`, summary.ts의 `roundTrips`는 열린 것 포함) | phone-light-12-result·desktop-light-12-result: `거래 횟수 9번 / 끝난 9번 · 아직 보유 3종목 · 평균 149일`, 승률 `2승 4패`. 분할 매수 끈 실행도 `11번 / 끝난 11번 · 아직 보유 4종목` vs `3승 4패` |

카피 리뷰 항목은 화면에서 모두 확인했다: nearMiss ①(`… 27.0%라, 하락 조건(85% 이상)에 닿지 않았어요`), 막는 경고 `사는 신호가 하나도 켜져 있지 않아요. ②에서 하나 이상 켜 주세요`, 요약 문구 5종, `회당 매수 비중`/`% (처음 자금 대비)`, 금액 오류 천 단위, PatternHelp `마지막으로 전량 판 뒤(처음이면 기간 시작부터)`, 손절 기준 옵션, `그냥 보유보다`, 전부 건너뜀 제목·사유 표시, `같은 종목 사서 보유`, `1단계 익절(80% 매도)`, 삭제 스낵바 `'새 전략'을(를) 삭제했어요`. nearMiss ②·③은 데모 흐름에서 나오지 않아 `simText.test.ts`의 `nearMissText`로 확인했다(③은 스펙 7.4 문구 `고점 뒤 하락이 N거래일 이상 이어진 적이 없었어요`).
