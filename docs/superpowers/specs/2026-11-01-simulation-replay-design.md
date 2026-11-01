# 시뮬레이션 재생 설계

> 2026-11-01 · 로드맵 최우선 1의 B(재생). A(전략 빌더)는 이 PR이 끝난 뒤 별도 스펙·PR로 해요.

## 1. 목표

지금 시뮬레이션 결과 화면은 끝난 결과만 보여 줘요. 이 작업은 결과를 거래일 순서대로 다시 틀어 볼 수 있게 해요.

- 매수·매도가 시간 흐름에 따라 일어나는 모습을 보여 줘요. 자산 차트가 진행되고 체결 마커가 나타나요.
- 재생/일시정지, 배속, 타임라인으로 원하는 거래일 이동을 지원해요.
- 고른 거래일의 보유·현금·신호·체결 상태를 패널로 보여 줘요.

### 1.1 정한 것 (brainstorming, 2026-11-01)

| 항목 | 결정 |
|---|---|
| 나누기 | 재생 먼저(이 스펙·PR), 전략 빌더는 다음 PR |
| 웹 워커 | 옮기지 않아요. 계산 시간을 테스트로 재고, 기준을 넘으면 다음에 옮겨요(§6.3) |
| 위치 | 결과 화면의 자산 차트 자리에 재생 막대와 「그날 상황」 패널을 더해요. 따로 여는 화면은 만들지 않아요 |
| 배속 | 1배 = 초당 1거래일, 1·2·4·8·16배 |
| 패널 | 보유·평단·종가·평가액·수익률, 손절·추가·익절 가격 막대, 예약 매수 신호, 그날 체결·건너뜀 |

### 1.2 범위 밖

- 전략 형식 변경(A에서 해요). `Strategy` 타입·저장소·동기화 문서·공유 스냅샷 형식은 바꾸지 않아요.
- 공유받은 결과의 재생. 공유 스냅샷에는 일봉과 일별 상태가 없어요. 공유 화면(`readonly`, `timeline` 없음)에는 재생 막대를 보이지 않아요.
- 장중 시각. 일봉 엔진이라 재생 단위는 거래일이에요.
- 선정 기준 검증 화면(`EquityChart`의 `curves` 모드)의 재생.

## 2. 엔진: 일별 상태 기록

### 2.1 타입 (`src/lib/sim/types.ts`)

```ts
export interface HoldingFrame {
  symbol: string;
  qty: number;
  avgPrice: number;       // Position.avgPrice
  close: number;          // 그날 종가, 봉이 없는 날은 마지막 종가
  value: number;          // roundMoney(qty × close), equity 계산과 같은 값
  pnlPct: number;         // (close / avgPrice − 1) × 100
  stop: number | null;    // Position.stopPrice()
  nextAdd: number | null; // Position.nextAddPrice(), 그날 건너뛴 가격이어도 그대로
  takes: { stage: number; price: number }[]; // Position.takeLevels() 중 qty > 0
  openDate: string;       // 이번 포지션의 첫 매수일
}

export interface DayFrame {
  date: string;
  cash: number;           // equity[i].cash와 같음
  value: number;          // equity[i].strategy와 같음
  holdings: HoldingFrame[];                    // 그룹 순서, 보유 중인 종목만
  pending: { symbol: string; reason: string }[]; // 그날 종가 신호 → 다음 거래일 시가 매수 예약
}

// SimResult에 더함
timeline?: DayFrame[]; // equity와 같은 길이·같은 날짜. 옵션을 켠 실행에만 있고, 공유에서 복원한 결과에는 없음
```

손절·추가·익절 가격은 **그날 종가 처리를 마친 뒤의 값**이에요. 다음 거래일 장중 경로에 쓰이는 가격이라 UI에는 「다음 거래일 기준」이라고 적어요.

### 2.2 기록 위치 (`src/lib/sim/simulate.ts`)

- `simulateCore`의 하루 끝(`equity.push` 직후)에서 `syms`를 돌며 `DayFrame`을 만들어 `CoreResult.timeline`에 쌓아요.
- 엔진의 체결·현금·신호 계산 순서와 값은 바꾸지 않아요. 기록은 읽기만 해요.
- `pending`은 그날 새로 생긴 `st.pending`(종가 신호)이에요.
- 기록은 옵션이에요: `simulateCore(input, { timeline: true })`, `simulate(input, { timeline: true })`. 기본은 꺼짐이라 선정 기준 검증(`runValidation.ts`, worker)은 지금과 같아요. 결과 화면 실행(`runController.svelte.ts`)만 켜요.
- 켜면 `simulate()`는 `core.timeline`을 `SimResult.timeline`으로 그대로 넘겨요.
- 가격은 반올림하지 않아요. 표시할 때 `simText`의 포맷터로 다듬어요.
- `expandSimResult`(공유 복원)는 `timeline`을 만들지 않아요.

### 2.3 동일성 고정

1. 엔진을 고치기 **전에** 골든 테스트를 먼저 커밋해요(`src/lib/sim/simulate.golden.test.ts`).
   - 대표 입력 3개: (가) 분할 매수 + 3단계 익절 + `breakeven`, (나) 손절(갭 포함) + 현금 부족 건너뜀 + 봉 없는 날, (다) `buyWindows` + 지수·지정 종목.
   - 각 입력의 지금 `simulate()` 결과 전체를 `toMatchSnapshot()`으로 고정해요.
2. 엔진 변경 뒤 같은 파일에 불변식을 더해요: 대표 입력마다 `const { timeline, ...rest } = simulate(i, { timeline: true }); expect(rest).toStrictEqual(simulate(i))`.
   - 옵션을 끄면 `timeline` 키를 아예 넣지 않아요(`toStrictEqual`이 `undefined` 키를 구분하므로).
3. 옵션을 끈 경로는 기존 `simulate.test.ts`와 골든 스냅샷이 지켜요.

## 3. 재생 상태 (`src/lib/ui/simulate/replay.svelte.ts`)

DOM 없는 컨트롤러예요. Svelte 5 룬으로 상태를 갖고, 시계는 주입해요(테스트에서 가짜 타이머).

```ts
createReplay(opts: { length: number; now?: () => number; raf?: (cb) => number; caf?: (id) => void })
// 상태(읽기 전용 getter)
index: number      // 0..length−1, 처음 값 = length−1(마지막 날 = 지금 결과 화면과 같음)
playing: boolean
speed: 1 | 2 | 4 | 8 | 16
touched: boolean   // play·seek·step 중 하나라도 하면 true, reset()이 false로
// 동작
play()   // 마지막 날에서 누르면 0으로 돌아가 시작
pause()
toggle()
seek(i)  // 범위로 자르고 일시정지
step(±1) // 일시정지하고 하루 이동
setSpeed(s)
reset()  // 일시정지, index = length−1, touched = false
destroy()
```

- 진행: `raf` 루프에서 경과 시간(프레임당 최대 1초로 자름) × speed(거래일/초)만큼 소수 누적, 정수가 넘으면 index를 올려요. 한 프레임에 여러 날을 건너뛸 수 있어요(16배·느린 기기).
- 마지막 날에 닿으면 멈춰요.
- 생명주기: `ResultView`에서 아래처럼 만들어요. `createReplay`가 자기 `$state`를 읽어도 바깥 effect의 의존성이 되지 않게 `untrack`으로 감싸요. `$derived` 안에서 만들지 않아요(부작용·정리 누락). 첫 렌더에서 `replay`는 `undefined`예요.

  ```ts
  let replay = $state.raw<Replay>();
  $effect(() => {
    const n = result.equity.length;
    const r = untrack(() => createReplay({ length: n }));
    replay = r;
    return () => r.destroy();
  });
  ```

## 4. 화면

### 4.1 배치 (`ResultView.svelte`)

```
요약 카드 (최종 결과, 바뀌지 않음)
자산 차트 (재생 중이면 index까지 그림, 가로·세로축은 전체 기간 고정)
재생 막대
그날 상황 패널 (touched일 때만 펼침, 아니면 「그날 상황 보기」 버튼 → 누르면 touched)
탭(체결·종목·건너뜀, 지금과 같음)
```

- 재생 막대·패널은 아래를 모두 만족할 때만 보여요: `timeline`이 있음, 길이가 `equity`와 같음, 거래일 2일 이상, 거래가 1건 이상(거래 0건이면 자산 차트 자체가 없어요, `ResultView.svelte:140-164`).
- 차트에 넘기는 `upTo`는 `touched`일 때만 `index`, 아니면 `undefined`예요. 그래서 재생을 건드리지 않으면 화면은 지금과 똑같아요.
- 공유 카드: 캡처 경로(`capture()`)는 동기라 그대로 둬요. 대신 「결과 공유」 버튼 핸들러를 `async () => { replay?.reset(); await tick(); onShare?.(); }`로 바꿔 대화상자를 열기 전에 차트를 최종 상태로 되돌려요. 카드는 늘 최종 곡선·마커 없음으로 찍혀 받은 공유 화면과 같아요.
- 모바일도 같은 세로 순서예요. 보유 카드는 한 줄에 하나예요. 좁은 화면(< 480px)에서는 배속 선택을 재생 버튼·날짜 아래 별도 줄에 둬요.

### 4.2 재생 막대 (`ReplayBar.svelte`)

- ▶/⏸ 버튼(`aria-label` 「재생」/「일시정지」).
- 배속: 기존 `Segmented`로 1×·2×·4×·8×·16×.
- 날짜: `dotDate` 형식 `2024.03.15(금) · 120/245거래일`.
- 타임라인: 네이티브 `<input type="range" min=0 max=length−1 step=1 aria-label="거래일">`. `aria-valuetext`에 날짜를 넣어요. `oninput`에서 `seek`(일시정지)해요.
- 안내 문구: 「일봉 기준이라 하루 단위로 움직여요」.
- 키보드: 단축키는 range 요소에만 걸어요. Space는 `preventDefault` 후 `toggle`. ←/→·Home/End는 range 기본 동작 → `oninput` → `seek`. 버튼과 `Segmented`에는 따로 핸들러를 달지 않아요(이벤트가 겹치지 않게).
- 재생 중에는 화면 낭독기에 매일 알리지 않아요. 멈췄을 때 날짜만 `aria-live="polite"`로 알려요.

### 4.3 자산 차트 (`EquityChart.svelte`)

- 새 prop `upTo?: number`(equity 인덱스). 없으면 지금과 같아요(마커도 없음).
- 시리즈 데이터 다시 넣기: 지금은 `onMount`에서 한 번만 `setData`해요(`:162-175`). `$effect`가 차트 준비 뒤 `upTo`를 늘 읽어요.
  - 숫자면 선마다 `upTo`까지 실제 값, 그 뒤 날짜는 값 없는 점(whitespace)으로 `setData`해 가로축을 전체 기간으로 고정해요.
  - `undefined`로 돌아오면 전체 데이터로 `setData`, `setMarkers([])`, 각 시리즈 `applyOptions({ autoscaleInfoProvider: undefined })`로 지금 화면과 같게 되돌려요.
- 세로축 고정: whitespace는 자동 축 계산에서 빠져 날마다 축이 출렁이므로, `upTo`가 있으면 각 시리즈에 `autoscaleInfoProvider`로 전체 기간 최소·최대를 넣어요.
- 범례: `upTo`가 있으면 기본 날짜를 `equity[upTo].date`로 하고, 크로스헤어 날짜가 그보다 뒤면 무시하고 기본 날짜를 보여요.
- 체결 마커: `onMount`에서 전략 선에 `createSeriesMarkers(series, [])`로 한 번 붙이고, 이후에는 `setMarkers()`만 불러요. `upTo` 날짜까지의 체결만 넣어요. 매수(`buy`·`add`)는 아래 ▲, 매도는 위 ▼. `TradeChartSheet.svelte`의 지역 `mergedMarkers`·`MARKER_COLOR`·`LABEL`을 `src/lib/ui/simulate/markers.ts`로 옮기고 묶기 간격을 인자로 받게 해요. `TradeChartSheet`는 지금 간격(`MERGE_BARS`) 그대로, 재생 차트는 0(같은 날·같은 방향만 한 마커)으로 써서 그날 체결이 늘 그날 마커로 생겨요.
- `curves` 모드에는 `upTo`를 쓰지 않아요.

### 4.4 그날 상황 패널 (`DayPanel.svelte`)

입력: `frame: DayFrame`, 그날 `trades`·`skipped`, `names`, `initial`.

- 머리: 날짜, 총자산, 현금(비중 %), 그날까지 수익률.
- 보유 카드(`HoldingCard.svelte`): 종목명, 수량, 평단, 종가, 평가액, 수익률, 보유 시작일.
  - 가격 막대: 손절 · 다음 추가 · 평단 · 익절 1~3 위치에 눈금, 종가 위치에 점. 막대 범위는 표시할 가격들의 최소·최대에 여유 5%. 눈금마다 라벨과 가격. 「다음 거래일 기준」이라고 적어요.
  - `stop`이 null이면(분할 매수 끝나기 전 `avgAfterScaleIn`, 유일한 경우) 「손절: 분할 매수 끝나면 정해져요」라고 적어요. `nextAdd`가 null이면 눈금만 빼요.
- 예약 매수: 「다음 거래일 시가에 사요: 삼성전자 — <신호 이유>」.
- 그날 체결: `TradeList.svelte`의 지역 함수 `why`(사유 문구)를 `simText.ts`로 옮겨 `TradeList`와 패널이 같이 써요.
- 그날 건너뜀: 사유별로.
- 보유가 없으면 「보유한 종목이 없어요」.

### 4.5 모션

- 차트는 index가 바뀔 때마다 그날까지 다시 그려져서 앞으로 나아가요. 마커는 그날이 되면 생겨요.
- index가 1만큼 바뀌었을 때만(재생 1·2배, step) 그날 새 체결 줄·새 보유 카드가 150ms 떠오르고(`transition:fly`) 가격 막대 점이 150ms 미끄러져요(CSS `transition: left`). 한 번에 여러 날을 건너뛰면 효과 없이 값만 바꿔요.
- `prefers-reduced-motion: reduce`면 위 효과를 끄고 값만 바꿔요. 재생 자체(날짜 진행)는 사용자가 누른 동작이라 그대로 해요.

## 5. 오류·경계

- `timeline` 길이가 `equity`와 다르면 재생 막대를 숨기고 `console.error`를 남겨요(엔진 버그 방어).
- 기간이 1거래일이거나 거래가 0건이면 재생 막대·패널을 숨겨요.
- 결과가 `stale`(이전 결과)이어도 재생은 돼요.
- 재생 중 다른 탭으로 가면 `raf`가 멈추고, 돌아오면 프레임당 경과 시간을 최대 1초로 잘라요.
- 화면을 떠나거나 결과가 바뀌면 `$effect` 정리에서 컨트롤러를 `destroy`해요.

## 6. 테스트

### 6.1 단위

- 골든·불변식: §2.3.
- `timeline`:
  - 길이·날짜가 `equity`와 같고, `cash`·`value`가 같아요.
  - `buy` 체결일 프레임부터 `holdings`에 있고, 전량 매도일 프레임에서 빠져요. 같은 날 사고 전량 판 종목은 `holdings`에 없고 그날 체결에만 있어요.
  - `stop`·`nextAdd`·`takes`가 같은 시점의 `Position` 계산과 같아요(분할 매수 중 `avgAfterScaleIn`은 `null`, `breakeven` 뒤 평단 이상).
  - 봉 없는 날 `close`는 마지막 종가예요.
  - `pending`은 신호 난 날에만 있고, 다음 거래일 `buy` 체결이나 건너뜀으로 이어져요.
- `replay.svelte.ts`: 가짜 시계로 1·16배 진행, 끝에서 멈춤, 끝에서 play → 0, seek 범위 자르기·일시정지, step 일시정지, touched·reset, 큰 경과 시간 자르기, destroy 뒤 raf 멈춤.

### 6.2 컴포넌트 (vitest + `lwcStub`)

- `ReplayBar`: 버튼·배속·range 동작, 날짜 표시, Space 토글(한 번만 전환), axe.
- `EquityChart`: `upTo`일 때 실제 점 수와 마커 수, `upTo` 변경에 `setData` 다시 호출, 범례가 `upTo` 날짜를 보임, `upTo` 없으면 마커 없음, 숫자 → `undefined`로 바뀌면 전체 점·마커 0개.
- `markers.ts`: 간격 0이면 같은 날·같은 방향만 묶임, 기존 간격 동작은 `TradeChartSheet` 테스트가 그대로 통과.
- `DayPanel`·`HoldingCard`: 보유 없음/있음, 손절 null 안내, axe.
- `ResultView`: `timeline` 있으면 막대가 보이고 없으면(공유) 안 보여요. 「그날 상황 보기」로 패널이 펼쳐져요. 「결과 공유」를 누르면 reset 뒤 `onShare`가 불려요.

### 6.3 성능

- 10년(약 2,450거래일)·8종목 합성 데이터로 `simulate()`를 timeline 끔/켬 각각 돌려, 켬 시간이 끔의 2배 이하인지 단언해요. 절대 시간은 로그로만 남겨요. 결과가 나쁘면 웹 워커 이전을 다음 작업으로 남겨요.

### 6.4 e2e (`tests/e2e/simulate.spec.ts`, `a11y.spec.ts`)

- 데모 데이터로 실행 → ▶ → 날짜가 바뀜 → ⏸ → 타임라인을 처음(Home)으로 이동 → 패널에 「보유한 종목이 없어요」(워밍업은 예약을 만들지 않아 첫 거래일에는 체결·보유가 없어요. 첫날 종가 신호로 예약은 생길 수 있어요).
- 결과 화면 axe에 재생 막대·펼친 패널 포함.

## 7. 바뀌는 파일

| 파일 | 변경 |
|---|---|
| `src/lib/sim/types.ts` | `HoldingFrame`·`DayFrame`, `SimResult.timeline?` |
| `src/lib/sim/simulate.ts` | 옵션 `{ timeline }`, 하루 끝 기록, `CoreResult.timeline?` |
| `src/lib/ui/simulate/runController.svelte.ts` | `simulate(input, { timeline: true })` |
| `src/lib/sim/simulate.golden.test.ts` | 새 파일(엔진 변경 전) |
| `src/lib/ui/simulate/replay.svelte.ts` | 새 파일 |
| `src/lib/ui/simulate/ReplayBar.svelte` | 새 파일 |
| `src/lib/ui/simulate/DayPanel.svelte`, `HoldingCard.svelte` | 새 파일 |
| `src/lib/ui/simulate/EquityChart.svelte` | `upTo`, 마커 |
| `src/lib/ui/simulate/markers.ts`(새), `TradeChartSheet.svelte` | 마커 합치기·색 공용화 |
| `src/lib/ui/simulate/ResultView.svelte` | 컨트롤러 생명주기, 배치, 공유 전 reset |
| `src/lib/ui/simulate/simText.ts`, `TradeList.svelte` | 체결 사유 문구 `why`를 옮김, 가격 막대 문구 |
| `tests/e2e/simulate.spec.ts`, `a11y.spec.ts` | 재생 흐름 |

동기화(`src/lib/sync/`)와 공유(`src/lib/share/`) 형식은 바꾸지 않아요. `SimResult.timeline`은 선택 필드라 공유 복원 코드도 그대로 컴파일돼요.
