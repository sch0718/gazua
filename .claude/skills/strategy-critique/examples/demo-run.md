> ⚠️ 참고 의견이며 매매 신호가 아니에요. 개선 아이디어의 효과는 가즈아 전략 빌더에서 바꿔 시뮬레이션으로만 확인하세요.

## 입력 요약
| 항목 | 전체 | 앞 반 | 뒤 반 |
|---|---|---|---|
| 전략 / venue | 데모 RSI 반등 / KRX 일봉 | 같음 | 같음 |
| 기간 | 2023-01-02 ~ 2025-12-30 (1093일) | 2023-01-02 ~ 2024-07-01 | 2024-07-02 ~ 2025-12-30 |
| 수익률 `totalReturnPct` | -3.11 | 3.91 | 0.52 |
| CAGR `cagrPct` | -1.05 | 2.6 | 0.34 |
| MDD `mddPct` | -19.93 | -5.7 | -10.32 |
| 승률 `winRatePct` | 100 | 100 | 100 |
| 왕복 거래 `roundTrips`(미청산 포함) | 4 | 3 | 2 |
| 미청산 `openPositions` | 1 | 1 | 1 |
| 청산 수 `roundTrips − openPositions` | 4 − 1 = 3 | 3 − 1 = 2 | 2 − 1 = 1 |
| 기준선 `holdReturnPct` | 9.81 | 75.8 | -37.39 |
| 기준선 `indexReturnPct` | -65.96 | -58.28 | -19.73 |
| 기준선 `benchmarkReturnPct` | null | null | null |
| 종목 수 / 실패 | 2(`005930`, `000660`) / `failed` = [] | 2 / [] | 2 / [] |
| 신호 | 매수 조건 맞는 종목 0/2, `asOf` = 2026-10-30, `includesToday` = false | - | - |

반 기간 열은 처음 자금·빈 포지션으로 새로 돌린 별도 시뮬레이션이에요. 전체와 합산하지 않았고, 구간마다 기준선과의 차이만 봤어요.

종목을 지금 어떻게 하면 좋을지는 이 스킬이 답하지 않아요. 이 스킬은 전략 규칙을 따지는 참고 의견만 내요. 참고로 `signals`는 매수 조건이 맞는 종목 0/2라고만 알려 줘요.

## 강세
- 앞 반과 뒤 반 모두 수익률이 플러스예요. `simulate-first-half.summary.totalReturnPct = 3.91`, `simulate-second-half.summary.totalReturnPct = 0.52`.
- 뒤 반에서는 기준선을 앞섰어요. `0.52 − (-37.39) = 37.91`(`holdReturnPct` 대비), `0.52 − (-19.73) = 20.25`(`indexReturnPct` 대비).
- 전체 기간에서도 `indexReturnPct` 대비로는 앞서요. `-3.11 − (-65.96) = 62.85`.
- 청산한 거래는 모두 이익이에요. `simulate.summary.winRatePct = 100`, 청산 수 3.
- `005930`은 전체·앞 반·뒤 반 모두 손익이 플러스예요. `simulate.perSymbol[0].pnl = 924723.4135`, `simulate-first-half.perSymbol[0].pnl = 461301.6213`, `simulate-second-half.perSymbol[0].pnl = 442580.0714`.
- 매수 조건이 한 가지(`rules.buy[0].conds`의 RSI 상향 돌파 하나)라 규칙이 단순해요.

## 약세
- 동의하지 않음: 강세는 기준선 대비 우위를 말하지만 `holdReturnPct`로는 전체에서 못 미쳐요. 수익률 − `holdReturnPct`는 `-3.11 − 9.81 = -12.92`예요. 앞 반도 `3.91 − 75.8 = -71.89`로 크게 뒤져요. `indexReturnPct`는 세 구간 모두 음수라 비교 기준으로 약해요.
- 동의하지 않음: 「청산한 거래는 모두 이익」이라는 승률 100%는 표본이 청산 3건(앞 반 2건, 뒤 반 1건)뿐이라 뜻이 거의 없어요. 승률이 100%인데도 전체 수익률은 음수예요(`simulate.summary.winRatePct = 100`, `simulate.summary.totalReturnPct = -3.11`).
- 손익이 `005930`에 쏠려 있고 `000660`은 세 구간 모두 마이너스예요. `simulate.perSymbol[1].pnl = -1235975.2587`, `simulate-first-half.perSymbol[1].pnl = -70441.1656`, `simulate-second-half.perSymbol[1].pnl = -391002.5584`.
- 미청산이 의심돼요. 청산 거래가 모두 이익(`winRatePct = 100`)인데 `000660`의 `pnl`이 음수이니, 그 손실은 기간 끝 평가손익(미청산)에서 왔다고 볼 수밖에 없어요. 다만 입력에는 미청산이 어느 종목인지 필드가 없어서 확인 필요예요.
- 청산 조건은 `rules.sell.takeProfit`(+15% 전량)뿐이에요. 손절·트레일링·기간 청산·조건 매도가 모두 꺼져 있어(`rules.sell.stopLoss.on = false`, `rules.sell.trailing.on = false`, `rules.sell.timeExit.on = false`, `rules.sell.signal.on = false`) 이익은 +15%에서 끊기고 손실은 닫히지 않아요.
- 매수 조건이 RSI 하나뿐이라 느슨해요. `rules.buy[0].conds` = `{"kind":"rsi","period":14,"level":30,"op":"crossUp"}`.

## 리스크
- 동의하지 않음(강세): 앞 반 승리를 근거로 삼기엔 거래가 적어요. 앞 반 청산 수 2, 뒤 반 청산 수 1이라 구간 간 비교가 우연일 수 있어요.
- 동의하지 않음(약세): 「`indexReturnPct`는 비교 기준으로 약하다」는 이 입력만으로는 약하다고 단정하기 어려워요. `indexReturnPct`는 세 구간 모두 음수(-65.96, -58.28, -19.73)라는 사실만 확인돼요. 약세 주장은 `holdReturnPct` 비교로만 받겠어요.
- MDD는 전체 -19.93으로 앞 반 -5.7보다 훨씬 깊어요. 뒤 반 -10.32도 앞 반보다 깊어요. 앞·뒤 반 MDD가 모두 전체보다 얕다는 점에서, 전체의 -19.93은 구간 안이 아니라 구간을 가로지르는 낙폭일 수 있어요(반 기간은 새로 시작한 별도 시뮬레이션이라 확정은 못 해요).
- 앞 반과 뒤 반의 차이가 커요. `3.91` → `0.52`, `-5.7` → `-10.32`. 수익은 줄고 낙폭은 깊어졌어요.
- 기준선 부호 검산: 전략 수익률은 `holdReturnPct`보다 전체(-12.92), 앞 반(-71.89)에서 낮고 뒤 반(+37.91)에서만 높아요. `indexReturnPct`보다는 세 구간 모두 높아요(+62.85, +62.19, +20.25).
- 손절·트레일링·기간 청산이 꺼져 있어 손실을 제한하는 장치가 없어요(`rules.sell.stopLoss.on = false` 등).
- `failed` = [], `notes` = []라 빠진 종목은 없어요. 비용 반영 여부(`costs.feePct`)는 입력에 없어 확인 필요예요.
- `signals.notes`에 「매매 이력 없이 계산한 조건 신호」라고 적혀 있어, 신호는 시뮬레이션의 포지션 상태와 무관한 참고 값이에요.

## 정리
### 합의와 이견
- 합의: 청산 수가 3건(앞 반 2건, 뒤 반 1건)뿐이라 승률 100%는 해석할 수 없어요. 손익은 `005930`에 쏠려 있어요. 손절·트레일링·기간 청산·조건 매도가 모두 꺼져 있어요.
- 이견: 기준선을 무엇으로 볼지가 갈려요. `holdReturnPct` 기준으로는 전체 -12.92로 뒤지고, `indexReturnPct` 기준으로는 +62.85로 앞서요. 어느 쪽이 맞는지는 입력으로 정할 수 없어요.
- 이견: 전체 MDD -19.93이 두 반 기간 MDD(-5.7, -10.32)보다 깊은 이유는 입력만으로 확정할 수 없어요.

### 아이디어 1: 미청산 손실을 끊는 손절
- **겨냥:** `simulate.summary.openPositions = 1`, `simulate.perSymbol[1].pnl = -1235975.2587`, `rules.sell.stopLoss.on = false`
- **바꿀 곳:** `rules.sell.stopLoss` 값 바꾸기 (손절 사용 › 손절폭)
```json
{"on":true,"pct":10}
```
- **확인할 숫자:** `summary.totalReturnPct`, `summary.mddPct`, `summary.openPositions`, `perSymbol[].pnl`

### 아이디어 2: 하락 추세 매수를 거르는 추세 조건
- **겨냥:** `rules.buy[0].conds`가 RSI 상향 돌파 하나뿐, `simulate.summary.mddPct = -19.93`, `simulate.perSymbol[1].pnl = -1235975.2587`
- **바꿀 곳:** `rules.buy[0]` 조건 추가 (매수 묶음 1 › ＋ 조건 › 이동평균 위·아래)
```json
{"kind":"maPrice","period":60,"side":"above"}
```
- **확인할 숫자:** `summary.roundTrips`, `summary.mddPct`, `summary.totalReturnPct`, `perSymbol[].pnl`

### 아이디어 3: 오래 묶인 포지션을 정리하는 기간 청산
- **겨냥:** `simulate.summary.openPositions = 1`, `rules.sell.timeExit.on = false`, 청산 수 `4 − 1 = 3`
- **바꿀 곳:** `rules.sell.timeExit` 값 바꾸기 (기간 청산)
```json
{"on":true,"days":60}
```
- **확인할 숫자:** `summary.openPositions`, `summary.roundTrips`, `summary.winRatePct`, `summary.totalReturnPct`

### 아이디어 4: 익절선이 이익을 일찍 끊는지 보는 익절폭
- **겨냥:** `simulate-first-half.summary.totalReturnPct − simulate-first-half.benchmarks.holdReturnPct = 3.91 − 75.8 = -71.89`, `rules.sell.takeProfit.stages[0].pct = 15`
- **바꿀 곳:** `rules.sell.takeProfit` 값 바꾸기 (익절 사용)
```json
{"stages":[{"pct":25,"sellPct":100}]}
```
- **확인할 숫자:** `summary.totalReturnPct`, `summary.mddPct`, `benchmarks.holdReturnPct`, `summary.openPositions`

### 검증 순서
1. 앱에서 전략을 복사한다(원본은 그대로 둔다).
2. 아이디어 하나만 바꾼다.
3. 같은 기간과 앞·뒤 반 기간을 다시 시뮬레이션해 원래 결과(입력 요약 표)와 비교한다.
4. 청산 수(`roundTrips − openPositions`)가 10회 미만이면 결과 차이를 우연으로 본다.

### 확인 필요
- 수수료·비용(`costs.feePct`)이 시뮬레이션에 반영됐는지(입력에 없음).
- 분할 매수 여부와 실제 자금 배분 수치(`strategies`에는 `sizing` 문구 「회당 총자산 30%」뿐).
- 미청산 1건이 어느 종목인지(`perSymbol`에 `openPositions` 필드가 없음).
- 종목 구성(`005930`, `000660` 두 개)과 기간을 바꾼 결과는 조건식 아이디어가 아니므로 이 목록에서 다루지 않았어요.

> ⚠️ 참고 의견이며 매매 신호가 아니에요. 개선 아이디어의 효과는 가즈아 전략 빌더에서 바꿔 시뮬레이션으로만 확인하세요.
