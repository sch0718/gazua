# 백테스트 점검표 결정 반영 (2026-11-04)

[점검표](../../proposals/2026-11-03-backtest-checklist.md)의 D1~D5를 사용자가 정했어요. 엔진 계산은 바꾸지 않고, 화면 문구와 도움말만 고쳐요.

전제: 1인용 앱, 작게 끝낸다. 새 설정·새 결과 필드는 만들지 않아요.

## 결정과 할 일

| # | 결정 | 할 일 |
|---|---|---|
| D1 슬리피지 | (가) 넣지 않음 | 시뮬레이션 도움말(`scripts/motion/help-pages.mjs` `simulate` tips)에 「슬리피지는 넣지 않아요」를 더하고 `corepack pnpm build:motion`으로 다시 만든다 |
| D2 기간 끝 청산 비용 | (다) 값 그대로, 안내 한 줄 | 시뮬레이션 결과의 한계 안내(`LIMITATIONS`)와 기준 검증 결과의 도움말(`HELP_ALWAYS`)에 「보유 중 포지션은 매도 비용 전이에요」 한 줄(점검표 (다)의 문구, 두 목록이 `simText.ts`의 상수 `OPEN_POSITION_TEXT`를 함께 쓴다). 두 화면 모두 기간 끝에 보유 중인 곡선(전략·그냥 보유·①·②)이 있다 |
| D3 배당 | (가) 같은 문구 | 시뮬레이션 `LIMITATIONS`에 이미 `'배당 제외 · 가격 수익률만이에요'`가 있다(점검표의 「안내가 없어요」는 틀렸다). 두 목록이 `simText.ts`의 상수 `DIVIDEND_TEXT`(`'배당 제외 · 가격 수익률만이에요'`)를 함께 쓰게만 바꾼다(`screenText.ts`는 이미 `simText`를 import한다) |
| D4 시뮬레이션 | (가) 끝난 거래 20건 미만이면 경고 | 거래가 1건 이상이고 끝난 거래(`roundTrips − openPositions`)가 20건 미만이면 요약 카드 바로 아래 한 줄: 「끝난 거래가 20번보다 적어서 우연일 수 있어요」. 거래 0건 화면은 지금 그대로 |
| D4 기준 검증 | (가) 1년 미만이면 기간 수익률 | 결과 축(`result.axis`) 첫날~마지막 날이 365일 미만이면 카드 부가 줄에서 `연환산 X · `만 빼고 `최대 낙폭`만 남긴다. 카드 큰 값이 이미 기간 수익률(`totalPct`)이라 `기간 X`를 더하면 같은 수가 두 번 나온다(내 성과는 큰 값이 IRR이라 겹치지 않는다). 2026-11-04 결정 |
| D5 Sharpe | (가) 넣지 않음 | 없음 |

## 세부

- **문턱 상수:** `MIN_CLOSED_TRADES = 20`, `ANNUALIZE_MIN_DAYS = 365`를 한 파일(`src/lib/ui/simulate/simText.ts`)에 둔다. 내 성과의 `span < 365`(`src/lib/perf/view.ts`)는 엔진 쪽이라 그대로 둔다.
- **날수 계산:** 기준 검증은 `curveStats`와 같은 식(KST 자정 차이 ÷ 하루, 반올림)으로 `result.axis`의 첫날·마지막 날 사이 날수를 구한다. 곡선마다 시작일이 조금 다를 수 있지만 문턱 근처에서만 갈리니 따로 막지 않는다.
- **공유 화면:** `SharedSimResult`·`SharedValidation`이 같은 `ResultView`·`ValidationResult`를 쓰므로 같은 안내가 나온다. 공유 스냅숏의 축은 솎아도 첫날·마지막 날을 남긴다(`thinIndices`가 0과 n−1을 늘 넣는다).
- **공유 카드 이미지·MCP·CLI 출력**은 바꾸지 않는다.

## 검증

- 단위: `ResultView`(20건 경계 19·20, 0건), `ValidationResult`(364·365일 경계), 공유 화면 한 건씩.
- 기존 테스트 기대값: `resultFixture.ts`의 축이 `2026-01-05`~`2026-02-03`(29일)이라 D4 뒤 `ValidationResult.test.ts`의 요약 카드 기대값(`연환산 +6.2%`, `연환산 +4.0%`)에서 연환산이 빠진다. 이 기대값을 짧은 기간 기준으로 고치고, 1년 이상 축은 365일 경계 테스트용 fixture로 따로 쓴다. `ResultView.test.ts`의 `'배당 제외 · 가격 수익률만이에요'` 기대는 D3에서 문구 값을 바꾸지 않으므로 그대로 둔다.
- 엔진 불변: 데모 데이터로 시뮬레이션·검증을 돌려 바꾸기 전과 수치가 같은지 비교한다(`src/lib/sim/`은 건드리지 않고 `simulate.golden.test.ts`로, `metrics.ts`는 계산 불변 리팩터링만 하고 `metrics.test.ts`로 확인).
- e2e: `simulate.spec.ts`, `screen.spec.ts`, `share.spec.ts`, `help.spec.ts`.
