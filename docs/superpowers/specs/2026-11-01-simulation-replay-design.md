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

엔진을 고치기 **전에** 골든 테스트를 먼저 커밋해요(`src/lib/sim/simulate.golden.test.ts`).

- 대표 사례: 분할 매수 + 3단계 익절 + `breakeven`, 손절(갭 포함), 현금 부족 건너뜀, `buyWindows`, 봉 없는 날, 지수·지정 종목 포함.
- 지금 엔진의 `simulate()` 결과에서 `equity`·`trades`·`skipped`·`summary`·`perSymbol`·`nearMiss`·`benchmarks`를 인라인 스냅샷이나 `__snapshots__`로 고정해요.
- 엔진 변경 뒤에는 옵션을 끄든 켜든 `timeline`을 뺀 나머지가 스냅샷과 같아야 해요.

## 3. 재생 상태 (`src/lib/ui/simulate/replay.svelte.ts`)

DOM 없는 컨트롤러예요. Svelte 5 룬으로 상태를 갖고, 시계는 주입해요(테스트에서 가짜 타이머).

```ts
createReplay(opts: { length: number; now?: () => number; raf?: (cb) => number; caf?: (id) => void })
// 상태
index: number      // 0..length−1, 처음 값 = length−1(마지막 날 = 지금 결과 화면과 같음)
playing: boolean
speed: 1 | 2 | 4 | 8 | 16
// 동작
play()   // 마지막 날에서 누르면 0으로 돌아가 시작
pause()
toggle()
seek(i)  // 범위로 자름, 재생 중이면 계속 재생
step(±1) // 일시정지하고 하루 이동
setSpeed(s)
destroy()
```

- 진행: `raf` 루프에서 경과 시간 × speed(거래일/초)만큼 소수 누적, 정수가 넘으면 index를 올려요. 한 프레임에 여러 날을 건너뛸 수 있어요(16배·느린 기기).
- 마지막 날에 닿으면 멈춰요.
- 결과(`result`)가 바뀌면 새 컨트롤러를 만들어요(index = 마지막 날).

## 4. 화면

### 4.1 배치 (`ResultView.svelte`)

```
요약 카드 (최종 결과, 바뀌지 않음)
자산 차트 (index까지 그림, 가로축은 전체 기간 고정)
재생 막대
그날 상황 패널 (index가 마지막 날이고 재생한 적 없으면 접힘 → 「그날 상황 보기」)
탭(체결·종목·건너뜀, 지금과 같음)
```

- `timeline`이 있을 때만 재생 막대·패널이 보여요.
- 모바일도 같은 세로 순서예요. 보유 카드는 한 줄에 하나예요.

### 4.2 재생 막대 (`ReplayBar.svelte`)

- ▶/⏸ 버튼(`aria-label` 「재생」/「일시정지」, `aria-pressed` 없이 라벨로 상태 표시).
- 배속: 기존 `Segmented`로 1×·2×·4×·8×·16×.
- 날짜: `2024-03-15(금) · 120/245거래일`.
- 타임라인: 네이티브 `<input type="range" min=0 max=length−1 step=1>`. 누르기·끌기·키보드가 기본으로 돼요. `aria-valuetext`에 날짜를 넣어요.
- 타임라인 위 눈금: 매수(`buy`·`add`)·매도 날짜를 색 막대로(장식, `aria-hidden`).
- 안내 문구: 「일봉 기준이라 하루 단위로 움직여요」.
- 키보드(막대에 포커스가 있을 때): Space 재생/정지, ←/→ 하루, Home/End 처음/끝. range 입력의 기본 동작과 겹치는 키는 range에 맡겨요.
- 재생 중에는 화면 낭독기에 매일 알리지 않아요. 멈췄을 때 날짜만 `aria-live="polite"`로 알려요.

### 4.3 자산 차트 (`EquityChart.svelte`)

- 새 prop `upTo?: number`(equity 인덱스). 없으면 지금과 같아요.
- 있으면 각 선을 `upTo`까지만 실제 값으로, 그 뒤는 값 없는 점(whitespace)으로 넣어 가로축을 전체 기간으로 고정해요.
- 전략 선에 체결 마커(`createSeriesMarkers`)를 `upTo` 날짜까지만 넣어요. 매수는 아래 ▲, 매도는 위 ▼, 색은 상승·하락 관례(`colorConvention`)를 따라요.
- `upTo`가 바뀔 때 `setData`를 다시 해요. 16배(초당 16번)에서도 버벅이지 않아야 해요.
- `curves` 모드에는 `upTo`를 쓰지 않아요.

### 4.4 그날 상황 패널 (`DayPanel.svelte`)

입력: `frame: DayFrame`, 그날 `trades`·`skipped`, `names`, `initial`, `colorConvention`.

- 머리: 날짜, 총자산, 현금(비중 %), 그날까지 수익률.
- 보유 카드(`HoldingCard.svelte`): 종목명, 수량, 평단, 종가, 평가액, 수익률, 보유 시작일.
  - 가격 막대: 손절 · 다음 추가 · 평단 · 익절 1~3 위치에 눈금, 종가 위치에 점. 막대 범위는 표시할 가격들의 최소·최대에 여유 5%. 눈금마다 라벨과 가격.
  - 값이 없으면(손절 미정 등) 그 눈금은 빼고 라벨 줄에 「손절: 분할 매수 끝나면 정해져요」처럼 이유를 적어요.
- 예약 매수: 「다음 거래일 시가에 사요: 삼성전자 — 고점 대비 −20% 뒤 반등 3일」.
- 그날 체결: 기존 `TradeList`의 한 줄 표현을 재사용하거나 같은 문구 함수(`simText`)를 써요.
- 그날 건너뜀: 사유별로.
- 보유가 없으면 「보유한 종목이 없어요」.

### 4.5 모션

- 차트는 index가 바뀔 때마다 그날까지 다시 그려져서 앞으로 나아가요.
- 그날 새 체결 줄과 새 보유 카드는 150ms 떠오르며 나타나요(`transition:fly`).
- 가격 막대의 점은 150ms 미끄러져요(CSS `transition: left`).
- `prefers-reduced-motion: reduce`면 위 두 효과를 끄고 값만 바꿔요. 재생 자체(날짜 진행)는 사용자가 누른 동작이라 그대로 해요.

## 5. 오류·경계

- `timeline` 길이가 `equity`와 다르면 재생 막대를 숨기고 `console.error`를 남겨요(엔진 버그 방어).
- 기간이 1거래일이면 재생 막대를 숨겨요.
- 결과가 `stale`(이전 결과)이어도 재생은 돼요.
- 재생 중 다른 탭으로 가면 `raf`가 멈추고, 돌아오면 경과 시간이 한 번에 커지지 않게 프레임당 최대 1초로 잘라요.
- 화면을 떠나면(`onDestroy`) 컨트롤러를 정리해요.

## 6. 테스트

### 6.1 단위

- 골든: §2.3.
- `timeline`:
  - 길이·날짜가 `equity`와 같고, `cash`·`value`가 같아요.
  - 매수 다음 날 `holdings`에 생기고, 전량 매도한 날 빠져요.
  - `stop`·`nextAdd`·`takes`가 같은 시점의 `Position` 계산과 같아요(분할 매수 중 `avgAfterScaleIn`은 `null`, `breakeven` 뒤 평단).
  - 봉 없는 날 `close`는 마지막 종가예요.
  - `pending`은 신호 난 날에만 있고, 다음 날 `buy` 체결이나 건너뜀으로 이어져요.
- `replay.svelte.ts`: 가짜 시계로 1·16배 진행, 끝에서 멈춤, 끝에서 play → 0, seek 범위 자르기, step이 일시정지, 큰 경과 시간 자르기.

### 6.2 컴포넌트 (vitest + `lwcStub`)

- `ReplayBar`: 버튼·배속·range 동작, 날짜 표시, 키보드, axe.
- `EquityChart`: `upTo`일 때 실제 점 수와 마커 수.
- `DayPanel`·`HoldingCard`: 보유 없음/있음, null 가격 안내, axe.
- `ResultView`: `timeline` 있으면 막대가 보이고 없으면(공유) 안 보여요.

### 6.3 성능

- 10년(약 2,450거래일)·8종목 합성 데이터로 `simulate()`를 돌려 `timeline`이 있어도 Node에서 500ms 이하인지 확인해요. 넘으면 웹 워커 이전을 다음 작업으로 남겨요.

### 6.4 e2e (`tests/e2e/simulate.spec.ts`, `a11y.spec.ts`)

- 데모 데이터로 실행 → ▶ → 날짜가 바뀜 → ⏸ → 타임라인을 처음으로 이동 → 패널에 「보유한 종목이 없어요」 또는 첫 날 상태.
- 결과 화면 axe에 재생 막대·패널 포함.

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
| `src/lib/ui/simulate/ResultView.svelte` | 배치 |
| `src/lib/ui/simulate/simText.ts` | 날짜·가격 막대 문구 |
| `tests/e2e/simulate.spec.ts`, `a11y.spec.ts` | 재생 흐름 |

동기화(`src/lib/sync/`)와 공유(`src/lib/share/`) 형식은 바꾸지 않아요. `SimResult.timeline`은 선택 필드라 공유 복원 코드도 그대로 컴파일돼요.
