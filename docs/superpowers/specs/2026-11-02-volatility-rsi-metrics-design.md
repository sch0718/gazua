# 비교 지표 v1.1: 변동성·RSI(14) 켜기

> 작성일: 2026-11-02 · 관련: 최초 설계 6절(`2026-10-11-stock-compare-design.md`), 로드맵 「다음 우선순위」

## 목표

비교 화면 지표 목록에 비활성으로만 있던 **변동성**과 **RSI(14)**를 실제로 고를 수 있게 한다.
차트·리더보드·데이터 표에 값이 나오고, 도움말과 로드맵도 맞춘다.

범위 밖:

- 「조건으로 골라 새 그룹 만들기」 순위 지표(`RANK_METRICS`)에 넣는 일. 지금처럼 빼 둔다.
- RSI 30/70 과열·침체 보조선. 차트가 기준선 하나만 그리므로 50 기준선만 둔다. 필요하면 후속으로 한다.
- 1일·주 기간 지원. 최초 설계대로 1개월 이상에서만 고를 수 있다.

## 지금 상태

- `src/lib/data/metricRegistry.ts`: 두 지표가 `v1: false`, `needs.minPeriodDays: 30`. `metricAvailability`는 `v1`이 아니면 무조건 막는다(1일·주는 「1개월 이상에서 볼 수 있어요」, 그 밖은 「곧 추가될 예정이에요」).
- `src/lib/data/seriesMetrics.ts`의 `metricPoints`: 두 지표는 `default` 분기로 모든 값이 null.
- RSI 계산: `src/lib/sim/indicators.ts`의 `rsi(closes, period, start)`(Wilder). 전략 빌더(#62)가 쓴다.
- 변동성 계산: 선정 기준의 `src/lib/screen/precompute.ts`에 비공개 `rollingVol(c, days)`가 있다. 최근 `days`개 일간 단순수익률(`c[k]/c[k-1]−1`)의 표본 표준편차(n−1)를 %로 낸다(연환산 없음). 시뮬레이션 결과의 `curveStats`(`src/lib/screen/metrics.ts`)는 같은 표준편차에 `√252`를 곱해 연환산한다.
- 일봉 시리즈(`LoadedSeries.daily`)는 기간 시작 40일 전(`lookbackFrom`)부터 받는다. 기간 시작 앞에 보통 26~28거래일이 있다.
- 리더보드 값 시세 반영(`withQuote`)은 `series.candles`의 마지막 봉 종가만 바꾸고 `series.daily`는 그대로 둔다.
- 화면 단위: `MetricUnit = '%' | 'x' | '조' | ''`. `%`는 ▲▼ 부호와 상승·하락 색, 차트 기준선 0. `Compare.svelte`는 `''`를 `%`로 바꿔 넘긴다(쓰는 지표가 없어 생긴 임시 처리).

## 결정과 근거

### D1. 변동성 = 20거래일 일간 수익률 표준편차 × √252 (%, 연환산)

- 봉 t의 값: t까지 최근 20개 일간 단순수익률의 표본 표준편차(n−1) × √252 × 100.
- 근거
  - 최초 설계 6절 정의(「20일 일간 수익률 표준편차 × √252」)와 지표 시트 설명(「20일 수익률 표준편차(연율)」)이 이미 그렇다.
  - 앱 안의 다른 변동성과 같은 식이다. 선정 기준 `rollingVol`(20일 기본, 단순수익률, n−1)과 시뮬레이션 `curveStats`(n−1, √252)를 그대로 합친 값이라 화면마다 숫자가 어긋나지 않는다.
  - 20일 창은 RVOL의 20일 평균과 같은 길이다. 받아 둔 일봉(기간 앞 26~28거래일)로 기간 첫날부터 값이 나온다.
  - 로그수익률 대신 단순수익률: 앱의 다른 두 계산과 맞춘다. 일간 수준에서는 차이가 작다.
- 재사용: `rollingVol`을 동작을 바꾸지 않고 `src/lib/sim/indicators.ts`로 옮겨 `rollingStdPct`로 내보낸다. 선정 기준(`precompute.ts`)과 비교 지표가 같이 쓴다. 비교 지표는 그 값에 `√252`를 곱한다. 표준편차 식은 한 곳에만 있게 한다.
- 잘못된 종가 처리는 비교 지표 쪽(`annualizedVolPct`)에서만 한다. 봉 t의 창(t−20..t)에 0 이하이거나 유한하지 않은 종가가 있으면 그 봉은 null. 21개 종가가 안 되면 null.
  - `rollingStdPct` 자체는 지금처럼 종가를 검사하지 않는다(앞 종가가 0이면 NaN). 선정 기준의 결과를 이번 작업에서 바꾸지 않으려는 것이다. 선정 기준의 NaN 처리는 이 작업 범위 밖이다.

### D2. RSI(14) = 기존 `rsi(closes, 14, 0)` 재사용

- 비교 지표 쪽에서 새로 구현하지 않는다. `src/lib/sim/indicators.ts`의 `rsi`를 그대로 부른다.
- 평활 시작점: 받은 일봉의 첫 봉(`start = 0`). 기간·기준일이 같으면 늘 같은 입력이라 값이 흔들리지 않는다.
- 전략 엔진은 기간 첫날 250봉 앞에서 평활을 시작한다(`RSI_START_BARS`). 비교 화면은 기간 앞 26~28거래일만 받으므로 같은 날의 RSI가 엔진 값과 조금 다를 수 있다. 일봉을 250봉 더 받으면 모든 지표의 조회 범위와 캐시 키가 바뀌고 호출량이 늘어서 하지 않는다. 이 차이는 도움말에는 적지 않고 이 문서에만 남긴다.
- 한계: 평활 시작점이 받은 일봉의 첫 봉(기간 시작 40일 전)이라, 같은 날의 RSI도 고른 기간(1개월·3개월·1년)에 따라 조금 다를 수 있고 거래일이 지나면 과거 날짜의 값도 조금 바뀐다. 평활이 수렴하면 차이는 작아진다. 기간과 무관하게 맞추려면 고정 길이 이력을 따로 받아야 해서 이번에는 하지 않는다.
- 잘못된 종가: 입력(워밍업 포함)에 0 이하·유한하지 않은 종가가 처음 나온 봉부터 그 뒤 RSI는 모두 null. `rsi()`는 그런 변화를 0으로 넘겨 값을 내지만 Wilder 평활은 그 영향이 뒤로 계속 남는다. 이 처리는 비교 지표 쪽에서 하고 `rsi()`(전략 엔진)는 바꾸지 않는다.
- 표기: 단위 없는 0–100 수, 소수 첫째 자리(`62.4`). 부호·상승/하락 색은 붙이지 않는다. 차트 기준선은 50(중립).

### D3. 계산 입력 = 기간 앞 일봉 + 기간 봉

- 종가 배열 = `series.daily` 중 기간 첫 봉보다 앞선 봉의 종가 + `series.candles`의 종가.
- 출력은 `series.candles`와 같은 길이·시각의 점이다. 다른 지표처럼 봉마다 하나다.
- 기간 봉을 `series.candles`에서 가져오므로, 리더보드 값은 `withQuote`가 바꾼 오늘 종가(5초 시세)를 그대로 반영한다. `series.daily`의 기간 안 봉은 쓰지 않는다.
- 기간 봉이 없으면 빈 배열.

### D4. 사용 가능 조건 = 기간 길이 30일 이상

- `metricAvailability`에서 `v1` 대신 `needs.minPeriodDays`로 판단한다. 기간 길이 = 1일 1, 주 7×n, 월 30×n, 년 365×n. 1개월(30)부터 된다.
- 모자라면 지금과 같은 문구 「1개월 이상에서 볼 수 있어요」. 그 지표를 고른 채 1일·주로 바꾸면 지금처럼 등락률로 보여 주고 헤드라인 아래에 이유를 알린다(기존 동작).
- 두 지표를 켜면 `v1: false`인 지표가 없으므로 `v1` 필드와 「곧 추가될 예정이에요」 분기를 지운다. 모르는 id는 지금처럼 고를 수 없게 하되 이유는 하나(「곧 추가될 예정이에요」)로 둔다.

### D5. 화면 단위: `'%abs'` 추가, `''`는 단위 없는 수

| unit | 지표 | 리더보드·표 | 차트 축 | 색 | 기준선 |
|---|---|---|---|---|---|
| `%` | 등락률 등 | `▲ +1.23%` | `+1.23%` | 상승·하락 | 0 |
| `%abs` (새로) | 변동성 | `32.10%` | `32.10%` | 없음 | 없음 |
| `''` | RSI | `62.4` | `62.4` | 없음 | 50 |

- 변동성은 늘 0 이상이고 높고 낮음이 좋고 나쁨이 아니라서 ▲▼와 색을 붙이지 않는다.
- `Compare.svelte`의 `'' → '%'` 변환을 없애고 레지스트리 단위를 그대로 넘긴다. 차트(`CompareChart`·`ChartPanel`·`CompareChartFixture`)의 단위 타입은 `MetricUnit`으로 맞춘다.
- 리더보드 「값 순」은 지금처럼 큰 값이 위다(변동성 큰 순, RSI 높은 순).

## 바꾸는 곳

| 파일 | 내용 |
|---|---|
| `src/lib/sim/indicators.ts` | `rollingStdPct` 추가(`precompute.ts`의 `rollingVol`을 옮김) |
| `src/lib/screen/precompute.ts` | `rollingStdPct`를 가져다 씀 |
| `src/lib/data/metrics.ts` | `annualizedVolPct(closes, window)` 추가(`rollingStdPct × √252`) |
| `src/lib/data/seriesMetrics.ts` | `volatility`·`rsi` 분기, 기간 앞 일봉을 붙인 종가 배열 만들기 |
| `src/lib/data/metricRegistry.ts` | `v1` 필드 제거, 단위(`%abs`·`''`), `minPeriodDays` 판정 |
| `src/lib/ui/compare/compareText.ts` | `MetricUnit`에 `%abs`, `formatMetricValue` 표기 |
| `src/lib/chart/CompareChart.svelte` 외 차트 2곳 | 단위 타입·축 표기·기준선 |
| `src/routes/Compare.svelte` | `''→'%'` 변환 제거 |
| `scripts/motion/help-pages.mjs` → `build:motion` | 비교 차트 도움말 문구 |
| `docs/roadmap.md` | 「다음 우선순위」에서 빼고 구현 현황 갱신 |
| `docs/superpowers/specs/2026-10-11-stock-compare-design.md` | 6절 표의 v1 칸 갱신 |

## 도움말

- 3단계 부제: 「`등락률`을 눌러 고점 대비 하락률·변동성·RSI 등으로」.
- 팁 한 줄 추가: 「`변동성`·`RSI(14)`는 `1개월` 이상 기간에서 골라요. 변동성은 20거래일 수익률의 흔들림을 1년 기준으로 늘린 값이고, RSI는 70 위면 과열, 30 아래면 침체로 읽어요.」
- 지표 시트 그림은 6줄이 화면 높이의 끝이라 RSI 줄을 더하지 않는다(변동성 줄은 이미 있다).
- `src/lib/help/content.ts`와 `docs/help/compare.md`는 `build:motion`이 만든다. 직접 고치지 않는다.

## 테스트

- `indicators.test.ts`: `rollingStdPct` — 손으로 계산한 값, 창 부족 null. 옮긴 뒤에도 선정 기준 동작이 같은지는 기존 선정 기준 테스트로 확인한다(동작을 바꾸지 않으므로).
- `metrics.test.ts`: `annualizedVolPct` — 일정 수익률이면 0, 손 계산 값, 21개 미만 null, 창 안 종가가 0이면 그 창의 봉만 null.
- `seriesMetrics.test.ts`
  - 변동성·RSI가 `series.candles`와 같은 시각의 점을 낸다.
  - 기간 앞 일봉을 워밍업으로 쓴다(기간 첫 봉부터 값이 있음). RSI 값이 `rsi(전체 종가, 14, 0)`의 기간 구간과 같다.
  - 기간 마지막 봉 종가가 시세로 바뀌면 마지막 값이 바뀐다(`series.daily`가 아니라 `candles` 사용).
- 비활성 전제를 고정한 기존 테스트를 바꾼다.
  - `src/lib/data/metrics.test.ts`의 `metricAvailability` 테스트(「v1.1 metrics: short periods vs longer」): 1일·주 → 「1개월 이상에서 볼 수 있어요」, 1개월·3개월·1년 → 사용 가능. 모르는 id → 「곧 추가될 예정이에요」.
  - `src/lib/data/metrics.test.ts`의 「lists the seven metrics in order with exact copy」: `v1` 열을 빼고 변동성 단위를 `%abs`로.
  - `src/lib/data/seriesMetrics.test.ts`의 「v1.1 metrics give all null」: 위 새 계산 테스트로 바꾼다.
  - `src/sheets/MetricSheet.test.ts`의 「곧 추가될 예정이에요」 기대: 1개월 이상에서 고를 수 있고 1일·주에서는 「1개월 이상에서 볼 수 있어요」로 바꾼다.
- `compareText.test.ts`: `%abs`·`''` 표기.
- 컴포넌트: `Compare.test.ts`(1개월 변동성·RSI 값 표시, 색 없음).
- e2e `tests/e2e/compare.spec.ts`: 데모 흐름에 1개월에서 `RSI(14)`를 고르는 단계를 더한다(데모 데이터로 값이 나오는지 확인).
