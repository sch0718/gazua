# 전략 빌더 조건식 (엔진 기준)

`src/lib/sim/strategyV2.ts`의 `Cond`와 `sanitizeStrategiesV2` 기준이에요. 범위 밖 값은 전략을 읽을 때 조용히 기본값으로 바뀌어 다른 전략이 돼요. `cli/src/skill.test.ts`가 이 표와 엔진이 같은지 검사해요.

## 조건 종류

| kind | 편집기 이름 | 맞는 때 | JSON 예 |
|---|---|---|---|
| `maPrice` | 이동평균 위·아래 | 종가가 `period`일 이동평균보다 위(`above`)·아래(`below`) | `{"kind":"maPrice","period":20,"side":"above"}` |
| `maCross` | 이평 교차 | `short`일선이 `long`일선을 위로(`golden`)·아래로(`dead`) 뚫은 날 | `{"kind":"maCross","short":20,"long":60,"dir":"golden"}` |
| `rsi` | RSI | `period`일 RSI가 `level`보다 위·아래(`above`·`below`), 또는 위로·아래로 지난 날(`crossUp`·`crossDown`) | `{"kind":"rsi","period":14,"level":30,"op":"crossUp"}` |
| `volume` | 거래량 | 거래량이 `days`일 평균의 `ratio`배 이상 | `{"kind":"volume","days":20,"ratio":1.5}` |
| `change` | N일 등락률 | `days`일 전 종가 대비 등락률이 `pct`% 이상(`above`)·이하(`below`) | `{"kind":"change","days":5,"pct":-10,"op":"below"}` |
| `fromHigh` | 고점 대비 하락 | 종가가 `days`일 최고 종가보다 `pct`% 이상 낮음 | `{"kind":"fromHigh","days":60,"pct":20}` |
| `newHigh` | 신고가 돌파 | 종가가 직전 `days`일 최고 종가를 넘음 | `{"kind":"newHigh","days":60}` |
| `pattern` | 반등 패턴 | 기존 반등 패턴(인자는 `entry` 안, 검증은 따로). 새로 제안하지 않고, 매도 조건에는 못 써요 | — |

## 숫자 범위

| 대상 | 인자 | 형 | 최소 | 최대 |
|---|---|---|---|---|
| `maPrice` | `period` | 정수 | 2 | 250 |
| `maCross` | `short` | 정수 | 2 | 250 |
| `maCross` | `long` | 정수 | 2 | 250 |
| `rsi` | `period` | 정수 | 2 | 50 |
| `rsi` | `level` | 소수 | 1 | 99 |
| `volume` | `days` | 정수 | 2 | 120 |
| `volume` | `ratio` | 소수 | 1 | 20 |
| `change` | `days` | 정수 | 1 | 250 |
| `change` | `pct` | 소수 | -90 | 500 |
| `fromHigh` | `days` | 정수 | 2 | 250 |
| `fromHigh` | `pct` | 소수 | 1 | 90 |
| `newHigh` | `days` | 정수 | 2 | 250 |
| `takeProfit.stages[]` | `pct` | 소수 | 0.5 | 500 |
| `takeProfit.stages[]` | `sellPct` | 소수 | 1 | 100 |
| `stopLoss` | `pct` | 소수 | 0.5 | 50 |
| `trailing` | `pct` | 소수 | 1 | 50 |
| `timeExit` | `days` | 정수 | 1 | 250 |

- 익절 단계는 1~3개이고 **마지막 단계의 `sellPct`는 항상 100**이에요(엔진이 강제). 위 `sellPct` 범위는 마지막이 아닌 단계에만 해당해요.
- `maCross`는 `short`가 `long`보다 작아야 뜻이 있어요(엔진은 검사하지 않아요).

## 고르는 값

| 자리 | 값 |
|---|---|
| `maPrice.side`, `change.op` | `above`, `below` |
| `maCross.dir` | `golden`, `dead` |
| `rsi.op` | `above`, `below`, `crossUp`, `crossDown` |
| `stopLoss.basis` | `avgAfterScaleIn`(분할 매수 뒤 평단), `avgAlways`(늘 평단), `firstBuy`(첫 매수가) |
| `takeProfit.afterFirstTake` | `keep`(손절선 유지), `breakeven`(1단계 익절 뒤 본전 손절) |
| 각 매도 규칙의 `on` | `true`, `false` |

## 묶음 한도

묶음은 최대 4개, 묶음마다 조건은 최대 5개예요. 묶음 안 조건은 모두 맞아야 하고(AND), 묶음끼리는 하나만 맞으면 돼요(OR). 매수(`rules.buy`)와 조건 매도(`rules.sell.signal.groups`)가 같은 한도예요.

## 매도 규칙 모양

| 필드 | 모양 | 편집기 |
|---|---|---|
| `rules.sell.takeProfit` | `{"on":true,"stages":[{"pct":15,"sellPct":100}],"afterFirstTake":"keep"}` | 익절 사용 |
| `rules.sell.stopLoss` | `{"on":true,"pct":7,"basis":"avgAlways"}` | 손절 사용 |
| `rules.sell.trailing` | `{"on":true,"pct":10}` | 트레일링 스톱 |
| `rules.sell.timeExit` | `{"on":true,"days":20}` | 기간 청산 |
| `rules.sell.signal` | `{"on":true,"groups":[{"conds":[…]}]}` | 조건 매도 사용 › 조건 매도 묶음 |
