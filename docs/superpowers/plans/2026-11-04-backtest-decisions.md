# 백테스트 점검표 결정 반영 계획 (2026-11-04)

설계: [2026-11-04-backtest-decisions-design.md](../specs/2026-11-04-backtest-decisions-design.md). 엔진 파일(`src/lib/sim/`, `src/lib/screen/runValidation.ts` 등)은 건드리지 않는다. 예외로 `src/lib/screen/metrics.ts`는 계산 불변 리팩터링(날수 식 분리)만 한다.

## 순서 (TDD: 테스트 먼저 → 실패 확인 → 구현 → 통과)

1. **문구·문턱 상수** — `src/lib/ui/simulate/simText.ts`
   - `DIVIDEND_TEXT`, `OPEN_POSITION_TEXT = '보유 중 포지션은 매도 비용 전이에요'`, `MIN_CLOSED_TRADES = 20`, `ANNUALIZE_MIN_DAYS = 365`, `FEW_TRADES_TEXT = '끝난 거래가 20번보다 적어서 우연일 수 있어요'`(문턱에서 만든다).
   - `LIMITATIONS`는 `DIVIDEND_TEXT`, `OPEN_POSITION_TEXT`를 쓴다. `src/lib/ui/screen/screenText.ts`의 `HELP_ALWAYS`도 같은 두 상수를 쓰고 주석의 줄 수를 고친다.
2. **시뮬레이션 결과(D2·D3·D4)** — `src/lib/ui/simulate/ResultView.svelte`, `ResultView.test.ts`
   - 테스트: 한계 안내에 D2 줄(이름 `'한계 안내 4줄'`), 끝난 거래 19건이면 경고가 요약 카드 바로 뒤, 20건이면 없음, 거래 0건이면 없음.
   - 구현: 요약 카드 `<ul>` 바로 뒤 `{#if closed < MIN_CLOSED_TRADES}<p class="warn">…</p>{/if}`.
3. **기준 검증 결과(D2·D4)** — `src/lib/screen/metrics.ts`, `src/lib/ui/screen/ValidationResult.svelte`, `ValidationResult.test.ts`, `resultFixture.ts`
   - `metrics.ts`에서 날수 식을 `calendarDays(first: string, last: string): number`로 빼서 `curveStats`가 쓴다. `curveStats` 안의 `days.length ?` 빈 축 확인은 그대로 두고 `calendarDays`는 빈 축을 다루지 않는다(결과 불변, 기존 `metrics.test.ts`로 확인).
   - 테스트: 축 364일이면 부가 줄 `최대 낙폭 …`만, 365일이면 `연환산 … · 최대 낙폭 …`. 기존 29일 fixture 기대값에서 연환산을 뺀다. 도움말에 D2 줄.
   - 구현: `const annualized = $derived(calendarDays(axis[0], axis[axis.length - 1]) >= ANNUALIZE_MIN_DAYS)`.
4. **공유 화면** — `src/routes/SharedView.test.ts`에 시뮬레이션·검증 공유 각각 D2 줄이 보이는지 한 건씩.
5. **도움말(D1)** — `scripts/motion/help-pages.mjs`의 `simulate` tips 한계 줄에 「슬리피지는 넣지 않아요」를 더하고 `corepack pnpm build:motion`. 생성물(`docs/help/simulate.md`, `src/lib/help/content.ts` 등)을 함께 커밋.
6. **점검 문서** — `docs/proposals/2026-11-03-backtest-checklist.md` 「사용자 결정이 필요한 것」 아래에 결정 결과(결정일 2026-11-04)와 D3의 점검표 오류(이미 안내가 있었음), D4 기준 검증 표시 판단을 적는다.

## 검증

- `corepack pnpm test`(단위), `corepack pnpm check`(타입), e2e `simulate`·`screen`·`share`·`help` spec.
- 엔진 불변: `metrics.test.ts`(`metrics.ts`), `simulate.golden.test.ts`(`src/lib/sim/`), `runValidation.test.ts` 통과. 그리고 데모 시장 데이터(`tests/fixtures/market-data-demo.json.gz`)로 `runValidation`·`simulate`를 돌린 지문을 바꾸기 전과 뒤에 뽑아 비교한다(커밋하지 않는 임시 테스트). 결과를 PR에 적는다.
