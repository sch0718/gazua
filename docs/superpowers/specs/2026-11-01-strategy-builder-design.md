# 전략 빌더 설계

> 2026-11-01 · 로드맵 최우선 1의 A(전략 빌더). B(재생, [`2026-11-01-simulation-replay-design.md`](2026-11-01-simulation-replay-design.md))가 끝난 main(16dd479) 위에서 해요. PR은 둘로 나눠요. PR① 서버 호환, PR② 엔진·화면·옮기기예요(§8.7). 구현 계획은 Task 단위로 잘게 나눠요(§15).
>
> 개정: 2026-11-01 검토 1회차 반영(PR 분리, 새 저장 키, 옮기기 해시 앞당김, Worker 원자 검사, 확인 필요 답).

## 1. 목표

지금 전략은 매수가 「하락 후 반등」 패턴 하나뿐이에요. 매도도 익절·손절만 있어요. 이 작업은 전략을 조건 블록으로 짜게 해요.

- 매수: 이동평균·RSI·거래량·가격·반등 패턴 블록을 AND/OR로 묶어요.
- 매도: 익절·손절에 트레일링 스톱·기간 청산·조건 매도를 더해요.
- 자금 배분: 처음 자금·총자산·남은 현금 비율, 균등 배분 중에서 골라요.
- 기존 전략은 결과가 한 원도 바뀌지 않아요. 골든 스냅샷이 지켜요.

### 1.1 정한 것 (brainstorming·검토, 2026-11-01)

| 항목 | 결정 |
|---|---|
| 매수 조건 구조 | 묶음 목록. 묶음 안은 AND, 묶음끼리는 OR. 2단계, 중첩 없음 |
| 매도 | 분할 익절·손절(기존) + 트레일링 스톱 + 기간 청산 + 조건 매도 묶음. 각각 켜고 꺼요 |
| 트레일링 기준 | 보유 중 최고 **종가**(확정) |
| 분할 매수 | `scaleIn` 그대로 |
| 배분 | `fixed`(처음 자금 N%) · `equityPct`(전 거래일 종가 기준 총자산 N%, 확정) · `cashPct`(남은 현금 N%) · `equal`(처음 자금 ÷ 종목 수) |
| 조건 블록 | 이동평균, RSI, 거래량, 가격, 반등 패턴(지금 `entry` 전체) |
| 엔진 | 종가 판정 → 다음 날 시가 체결 흐름 유지. 패턴 추적기 자리에 같은 계약의 조건식 평가기 |
| 호환 | v1 전략은 새 저장 키로 옮기고 옛 키는 그대로 둬요. 동기화·공유·내보내기 버전을 올려요 |
| PR | 둘. PR① 서버 호환 → 병합·Worker 배포 → PR② 엔진·화면·옮기기 |

### 1.2 범위 밖

- 지수 필터(시장이 오를 때만 사기 등).
- 재무·수급 조건. 선정 기준(`src/lib/screen/`)에만 있어요.
- 장중 신호. 일봉 엔진이라 조건은 종가로만 판정해요.
- 신호 기반 추가 매수. 추가 매수는 지금처럼 가격 간격(`scaleIn`)으로만 해요.
- 묶음 중첩, NOT 연산.

## 2. 지금 구조

| 곳 | 하는 일 |
|---|---|
| `src/lib/sim/types.ts` | `Strategy`(v1): `capital.perBuyPct`, `entry`(`decline`·`triggers`·`filter`), `scaleIn`, `exit`(`takeProfit`·`stopLoss`·`afterFirstTake`). `Trade.kind`는 6종 |
| `src/lib/sim/pattern.ts` | `createPatternTracker(candles, entry)`. `signal(i)`·`update(i)`·`reset(i)`·`stats()`·`resetStats()` |
| `src/lib/sim/simulate.ts` | `simulateCore`: 하루마다 ① 시가 예약 매수 ② `walkBar` 장중 경로(손절·추가·익절) ③ 종가 신호. 1회 금액은 `roundMoney(initial × perBuyPct / 100)` 하나 |
| `src/lib/sim/position.ts` | `openPosition(price, qty, scaleIn, exit)`. `stopPrice()`·`nextAddPrice()`·`takeLevels()` |
| `src/lib/sim/indicators.ts` | `sma`만 있어요 |
| `src/lib/sim/summary.ts` | `nearMiss(core)`: 거래·건너뜀이 없을 때 `patternStats` |
| `src/lib/sim/loadSimData.ts` | 워밍업 `addDays(from, -max(400, ceil(longestMa × 1.6)))` |
| `src/lib/sim/validate.ts` | `sanitizeStrategies`(읽기 검증), `sanitizeEntry`(선정 기준용), `ruleIssues`·`strategyIssues` |
| `src/lib/sim/strategyStore.ts` | `p:<id>:strategies`에 `{ strategies }`. 읽을 때 검증하고 덮어쓰지 않아요 |
| `src/lib/state/app.svelte.ts` | `onStorage`가 동기화 키(설정·그룹·전략·기준·묶음)의 다른 탭 변경을 받아요. `removeProfile`이 프로필 키를 지워요 |
| `src/lib/sync/dto.ts` | `PROFILE_DOC_VERSION = 1`, `checkProfileDoc`(Worker와 같이 씀). 통과하면 **입력 원본**을 `doc`으로 돌려줘요 |
| `src/lib/sync/engine.ts` | `pull()`은 받은 문서를 검사 없이 `local.write`해요. 단계는 `pull` → `keys` → `push`, 하나가 실패하면 멈춰요 |
| `sync-worker/src/profiles.ts` | PUT: `checkProfileDoc` → `replayed()` → 조건부 `UPDATE profile_index` 배치. 409·410 응답에 현재 본문 |
| `sync-worker/src/shares.ts` | `checkShareSnapshot(b.snapshot, b.kind, now)`의 `checked.snapshot`을 저장해요 |
| `src/lib/share/snapshot.ts` | `SHARE_VERSION = 1`, `strategySnapshot`·`criteriaSnapshot`·`checkShareSnapshot`(create·read 모드) |
| `src/lib/share/pendingImport.ts` | `importPart`가 `v: 1`을 박아 넣어요 |
| `src/lib/state/exportImport.ts` | `EXPORT_SCHEMA_VERSION = 1` |
| `src/lib/screen/precompute.ts` | `resolveReboundEntry`가 `from:'strategy'`면 `s.entry`를 써요. 지역 함수 `rollingMax(c, window, min)` |
| `src/lib/screen/runValidation.ts` | `runTrading`이 참조 전략의 `capital.perBuyPct`만 남기고 나머지를 기준 값으로 바꿔요 |
| `src/lib/ui/simulate/StrategyEditor.svelte` | 구역 `universe`·`period`(기간·자금)·`entry`(매수)·`scaleIn`·`exit`(매도)·`benchmarks`·`costs` |
| `src/lib/ui/simulate/editor/EntrySection.svelte` | 매수 칸. `CriteriaEditor.svelte`가 `{ entry } as unknown as Strategy` 겉모양으로 재사용해요 |

## 3. 데이터 형식 (v2)

### 3.1 타입 (`src/lib/sim/types.ts`)

```ts
/** 반등 패턴 한 벌. 지금 Strategy['entry']와 같은 모양(이름만 붙임) */
export interface PatternEntry {
  decline: { dropPct: { on: boolean; value: number }; days: { on: boolean; value: number } };
  triggers: {
    reboundDays: { on: boolean; value: number };
    breakout: { on: boolean; level: 'A' | 'B' };
    maCross: { on: boolean; period: number };
    goldenCross: { on: boolean; short: number; long: number };
  };
  filter: { aboveMa: { on: boolean; period: number } };
}

export type Cond =
  | { kind: 'maPrice'; period: number; side: 'above' | 'below' }            // 종가가 N일선 위·아래
  | { kind: 'maCross'; short: number; long: number; dir: 'golden' | 'dead' } // 골든·데드크로스
  | { kind: 'rsi'; period: number; level: number; op: 'above' | 'below' | 'crossUp' | 'crossDown' }
  | { kind: 'volume'; days: number; ratio: number }                          // 거래량 ≥ N일 평균 × ratio
  | { kind: 'change'; days: number; pct: number; op: 'above' | 'below' }     // N일 등락률
  | { kind: 'fromHigh'; days: number; pct: number }                          // N일 고점 대비 pct% 이상 하락
  | { kind: 'newHigh'; days: number }                                        // N일 신고가 돌파
  | { kind: 'pattern'; entry: PatternEntry };                                // 반등 패턴(매수 전용)

/** 묶음 하나. 안의 조건은 모두 맞아야(AND) 해요 */
export interface CondGroup { conds: Cond[] }

export type SizingMode = 'fixed' | 'equityPct' | 'cashPct' | 'equal';

export interface Strategy {
  v: 2;
  id: string;
  name: string;
  updatedAt: number;
  universe: { kind: 'group'; groupId: string } | { kind: 'symbols'; symbols: string[] };
  period: { from: string; to: string };
  capital: { initial: number };
  sizing: { mode: SizingMode; pct: number }; // equal이면 pct는 쓰지 않지만 값은 남겨요(모드를 바꿔도 기억)
  rules: {
    buy: CondGroup[]; // 묶음끼리 OR
    sell: {
      takeProfit: { on: boolean; stages: { pct: number; sellPct: number }[]; afterFirstTake: 'keep' | 'breakeven' };
      stopLoss: { on: boolean; pct: number; basis: StopBasis };
      trailing: { on: boolean; pct: number };
      timeExit: { on: boolean; days: number };
      signal: { on: boolean; groups: CondGroup[] }; // 조건 매도. pattern 블록은 못 넣어요
    };
  };
  scaleIn: { on: boolean; stepPct: number; maxAdds: number };
  benchmarks: { index: 'KOSPI' | 'KOSDAQ'; symbol: string | null };
  costs: { feePct: number };
}
```

- 옛 타입은 `StrategyV1`로 이름을 바꿔 `src/lib/sim/strategyV1.ts`에 둬요. v1 읽기 검증(`sanitizeStrategiesV1`, 지금 `sanitizeOne` 그대로)과 옮기기 함수(`toV2`)도 같은 파일에 둬요.
- `afterFirstTake`는 익절에 딸린 설정이라 `takeProfit` 안으로 옮겨요.
- 묶음·조건에는 id를 두지 않아요. 순서(배열 위치)가 곧 이름이에요. 이유는 두 가지예요.
  - 공유 검사가 스냅샷 안의 UUID 모양 문자열을 거절해요(`checkShareSnapshot`의 `UUID_RE`).
  - 옮기기가 결정적이어야 기기마다 같은 v2 문서·같은 해시가 나와요(§8.3).
- 기본 패턴은 새 함수 `defaultPatternEntry()`(`src/lib/sim/defaults.ts`)가 만들어요. 값은 지금 `newStrategy().entry`와 같아요. 지금 `newStrategy(...).entry`를 패턴 기본값으로 쓰는 곳(`src/lib/screen/defaults.ts`, `snapshot.ts`, `CriteriaEditor.svelte`)이 이 함수를 써요.

### 3.2 저장 범위와 실행 조건

저장 검증(`sanitizeStrategies` v2)은 **모양**만 지켜요. 틀린 값은 기본값으로 바꾸고 `repaired`를 켜요. **실행할 수 있는지**는 `ruleIssues` 경고가 정해요(§11). 둘을 섞지 않아요.

| 필드 | 저장 범위 | 실행 조건(경고) |
|---|---|---|
| `sizing.pct` | 1~100, 소수 허용 | |
| `rules.buy` | 묶음 0~4개, 묶음마다 조건 0~5개 | 묶음 1개 이상, 빈 묶음 없음 |
| `pattern` 블록 개수 | 고치지 않아요 | 매수 조건 전체에서 1개까지 |
| `rules.sell.signal.groups` | 묶음 0~4개, 묶음마다 조건 0~5개 | 켰으면 묶음 1개 이상, 빈 묶음 없음 |
| `maPrice.period`, `maCross.short/long` | 정수 2~250 | `maCross`는 short < long(막지 않음) |
| `rsi.period` | 정수 2~50 | |
| `rsi.level` | 1~99 | |
| `volume.days` | 정수 2~120 | |
| `volume.ratio` | 1~20, 소수 허용 | |
| `change.days` | 정수 1~250 | |
| `change.pct` | −90~500 | `op: 'below'`와 음수로 「N일 −10% 이하」 |
| `fromHigh.days`, `newHigh.days` | 정수 2~250 | |
| `fromHigh.pct` | 1~90 | |
| `takeProfit.stages` | 1~3단계, 마지막 `sellPct` = 100 | 지금 규칙 그대로 |
| `stopLoss.pct` | 0.5~50 | |
| `trailing.pct` | 1~50 | |
| `timeExit.days` | 정수 1~250 | |

- 모르는 `kind`의 조건은 버리고 `repaired`를 켜요.
- 매도 묶음에 들어온 `pattern` 조건은 버리고 `repaired`를 켜요. 매도 쪽에는 패턴 추적기가 없어요.
- 빈 묶음은 편집 중에 저장될 수 있는 정상 상태라 버리지 않아요.
- 묶음·조건 개수가 한도를 넘으면 잘라내고 `repaired`를 켜요.

### 3.3 금지 키·깊이 점검

`src/lib/sync/forbidden.ts`의 `FORBIDDEN_KEYS`는 어느 깊이든 대소문자를 가리지 않고 막아요. 새 키를 하나씩 대 봤어요.

- 새 키: `v`·`sizing`·`mode`·`pct`·`rules`·`buy`·`sell`·`conds`·`kind`·`period`·`side`·`short`·`long`·`dir`·`level`·`op`·`days`·`ratio`·`entry`·`takeProfit`·`stages`·`afterFirstTake`·`stopLoss`·`basis`·`trailing`·`timeExit`·`signal`·`groups`·`on`.
- 목록과 겹치는 것은 없어요. 특히 `token`·`iv`·`enc`·`iter`·`salt`·`nonce`·`orders`·`holdings`·`provider`·`theme`를 피했어요.
- 재생의 `DayFrame.holdings`는 금지 키예요. `timeline`은 지금처럼 공유·동기화에 넣지 않아요.
- 깊이: 가장 깊은 길은 `strategies[i].rules.buy[g].conds[k].entry.triggers.goldenCross.short`예요. 루트 0에서 잎까지 11이라 `JSON_DEPTH_MAX = 32`에 넉넉해요. 공유(`strategy.…`)와 내보내기도 비슷해요.
- 크기: 묶음 4 × 조건 5를 다 채운 전략도 수 KB예요. 전략 20개여도 프로필 256 KiB, 공유 100 KB 안이에요.

### 3.4 기본값과 템플릿 (`src/lib/sim/defaults.ts`, 새 `src/lib/sim/templates.ts`)

- `newStrategy()`는 v2를 만들어요. 매수는 `defaultPatternEntry()`를 담은 패턴 블록 하나, 매도는 익절 +15% 전량·손절 −5% `avgAfterScaleIn`, 배분은 `fixed` 10%예요. 지금 기본값을 옮긴 결과와 같아요.
- 템플릿 3개. 규칙(`rules`·`scaleIn`·`sizing`)만 정하고 종목·기간·비교·비용은 `newStrategy()` 값을 써요.

| 템플릿 | 매수 | 매도 |
|---|---|---|
| 하락 후 반등 | 패턴 블록(지금 기본) | 익절 +15% · 손절 −5% |
| RSI 과매도 반등 | `rsi` 14, 30 상향 돌파 + `maPrice` 종가 120일선 위 | 익절 +10% · 손절 −5% · 기간 청산 20거래일 |
| 골든크로스 추세 | `maCross` 20/60 golden + `volume` 20일 평균 1.5배 | 손절 −7% · 트레일링 −10% · 조건 매도 `maCross` 20/60 dead |

템플릿 숫자는 시작값이에요. 성과를 약속하는 문구는 쓰지 않아요.

## 4. 엔진

### 4.1 조건식 평가기 (새 `src/lib/sim/rules.ts`)

```ts
export interface RuleEvaluator {
  /** i번째 봉 종가로 묶음을 판정. 처음 맞은 묶음의 사유. 상태는 바꾸지 않아요 */
  signal(i: number): { reason: string; snapshot?: PatternSnapshot } | null;
  update(i: number): void;   // 패턴 블록이 있으면 tracker.update(i)
  reset(i: number): void;    // 전량 매도한 날. 패턴 블록이 있으면 tracker.reset(i)
  stats(): { maxDropPct: number; declineDays: number } | null; // 패턴 블록 통계, 없으면 null
  resetStats(): void;
}
export function createRuleEvaluator(candles: Candle[], groups: CondGroup[], firstDayIdx: number): RuleEvaluator;
export function rulesLookback(groups: CondGroup[]): number; // §5.4
export function condReason(c: Cond): string;                 // §4.6
```

- `PatternTracker`와 같은 계약이에요. `simulateCore`는 `tracker` 자리에 평가기를 넣기만 해요.
- `firstDayIdx`는 그 종목 배열에서 기간 첫날(`days[0]` 이상인 첫 봉)의 인덱스예요. RSI 시작점에 써요(§5.1).
- 만들 때 종목마다 필요한 지표 배열을 한 번 계산해요(같은 기간이면 공유).
- 패턴 블록은 기존 `createPatternTracker(candles, entry)`를 그대로 감싸요. 판정·상태·통계를 바꾸지 않아요.
- 묶음 판정: 묶음 안 조건을 앞에서부터 보고, 하나라도 틀리면 다음 묶음으로 가요. 패턴 블록의 `signal(i)`은 상태를 바꾸지 않으니 순서가 결과를 바꾸지 않아요.
- 패턴 블록이 맞으면 `snapshot`을 같이 돌려줘요. 매수 체결 줄은 `snapshot`이 있을 때만 `pattern` 키를 넣어요(`...(snapshot && { pattern: snapshot })`). 없을 때 `pattern: undefined`를 넣지 않아요. 골든 테스트의 `toStrictEqual`이 `undefined` 키를 구분해요.
- 매도용으로 `rules.sell.signal.groups`에도 평가기를 하나 더 만들어요. 매도 평가기에는 패턴 블록이 없어서 `update`·`reset`은 아무것도 하지 않아요.

### 4.2 하루 순서 (`simulateCore`)

지금 순서를 지키고 ①에 예약 매도를 앞에 더해요.

1. **시가**
   1. 예약 매도: 어제 종가에 생긴 조건 매도·기간 청산을 오늘 시가에 남은 수량 전부 팔아요. 오늘 봉이 없으면 예약을 그대로 두고 다음 봉이 있는 날 팔아요(건너뜀으로 남기지 않아요). 절차는 아래와 같아요.
      - `walkBar`의 지역 함수 `sell`을 바깥 도우미 `sellQty(pos, qty, price, kind, reason, ctx)`로 꺼내 둘이 같이 써요. 수수료·세금·현금 반영·`Trade` 모양이 같아져요. 세율은 `sellTaxPct(settlementDate(date, days), market, isEtf)`예요.
      - 체결은 `record(st, t)`로 남겨 `rt.proceeds`에 더해요.
      - 다 판 뒤 지금 장중 청산과 같은 순서로 `roundTrips.push(...)`, `st.pos = null`, `st.rt = null`, `closed.add(st)`를 해요. 그래서 `closed` 집합은 ① 앞에서 만들어요.
      - 그 종목은 그날 `walkBar`를 돌지 않아요.
   2. 예약 매수: 지금과 같아요. 금액만 §6으로 정해요. 매도 대금이 먼저 들어온 현금으로 사요.
2. **장중**(`walkBar`): 손절·트레일링·추가 매수·익절. 트레일링은 §4.3.
3. **종가**
   - 보유 중이면 매도 판정만 해요. 조건 매도 평가기 `signal(i)`가 맞거나 보유 거래일이 `timeExit.days` 이상이면 예약 매도를 남겨요. 둘 다면 조건 매도를 남겨요.
   - 보유하지 않고 그날 청산하지 않았으면 매수 평가기 `signal(i)`로 예약 매수를 남겨요(지금과 같아요).
   - 두 평가기 모두 `update(i)`. 그날 청산했으면 `reset(i)`. 트레일 기준가를 갱신해요(`pos.markClose(c)`).
   - 마지막 거래일에는 예약을 만들지 않아요(매수·매도 모두, 지금 `di < days.length - 1`).

### 4.3 트레일링 스톱 (`walkBar`, `Position`)

- 기준가(peak) = 이번 포지션의 매수 체결가와 보유 중 종가들의 최댓값이에요. 추가 매수로 바뀌지 않아요. 지금 엔진이 고점·저점을 종가로 보는 것과 맞췄어요(확정).
- 트레일 가격 = peak × (1 − `trailing.pct` / 100). 하루 안에서는 고정이고 종가 뒤에 갱신해요. 손절가처럼 「다음 거래일 기준」이에요.
- 매수한 날도 장중에 트레일이 살아 있어요(peak = 매수가). 손절과 같아요.
- `walkBar`는 손절가 자리에 `floor = max(손절가, 트레일 가격)`을 써요. 나머지 규칙은 그대로예요.
  - 이미 지나친 값(시가가 floor 이하)이면 커서 가격에 전량. 손절이 더 높거나 같으면 `gapStop`/`stop`, 트레일이 더 높으면 `trail`.
  - 내려가는 구간: 구간 안의 가장 높은 floor·추가 매수, 같으면 floor가 먼저. floor 안에서 손절·트레일이 같으면 손절이에요.
- 갭 트레일도 체결 종류는 `trail`이에요. 사유가 「트레일링 −10%(갭)」으로 갈라요. 체결 종류는 합의한 3종만 써요.
- 꺼져 있으면 트레일 가격은 `null`이고 floor는 지금 손절가와 같아요. 그래서 v1 전략의 `walkBar` 경로는 바뀌지 않아요.

### 4.4 손절·익절 끄기 (`Position`)

- `openPosition(price, qty, scaleIn, sell, amount)`로 바꿔요. `sell`은 `rules.sell`, `amount`는 §6.1의 포지션 금액이에요.
- `stopLoss.on = false`면 기본 손절가가 없어요(`null`). 다만 `afterFirstTake: 'breakeven'`은 익절 설정이라 1단계 익절 뒤 평단 손절이 살아요. 지금 `stopPrice()`의 `base === null ? avg()` 분기 그대로예요.
- `takeProfit.on = false`면 `takeLevels()`가 빈 배열이에요.
- 새 멤버 `trailPrice(): number | null`, `markClose(close: number): void`(peak 갱신), `readonly amount: number`.

### 4.5 동시 신호 우선순위

| 상황 | 결과 |
|---|---|
| 예약 매도가 있는 날 시가가 손절·트레일 아래로 갭 | 예약 매도가 먼저예요. 시가에 `signalSell`/`time`으로 다 팔고 `walkBar`는 돌지 않아요 |
| 같은 날 장중 손절·트레일과 익절 | 지금 `walkBar` 규칙(가격 커서 순서, 내려갈 때 floor 먼저) |
| 손절가 = 트레일 가격 | 손절(`stop`) |
| 보유 중 매수 조건이 맞음 | 무시해요. 보유 중 재진입은 없어요(지금과 같아요) |
| 그날 전량 매도한 종목의 매수 조건 | 그날은 판정하지 않아요. 다음 거래일 종가부터 다시 봐요. 패턴 블록은 `reset`돼서 새 하락이 필요해요 |
| 매수일 종가에 매도 조건이 맞음 | 다음 거래일 시가에 팔아요 |
| 조건 매도와 기간 청산이 같은 날 | 조건 매도 하나만 남겨요 |
| 여러 종목의 예약 매수 | 지금처럼 그룹 순서 |

패턴 블록이 없는 조건(예: 「종가 20일선 위」)은 상태 조건이라, 판 다음 날 다시 맞으면 바로 다시 살 수 있어요. 편집 화면 도움말에 적어요(§10.2).

### 4.6 기간 청산

- 보유 거래일은 **시장 축** `days` 기준이에요. `di − rt.openDay + 1`로 세서 `roundTrips.holdDays`와 같아요. 매수일이 1일째예요.
- 그 종목의 거래정지일(봉 없는 날)도 하루로 세요. 시장 축이라서요.
- 추가 매수로 다시 세지 않아요. `openDay`는 첫 매수일이에요.
- N일째 종가에 예약하고, N+1일째 시가에 팔아요. 그날 봉이 없으면 §4.2의 규칙대로 미뤄요.

### 4.7 체결 종류와 사유

- `Trade.kind`에 `trail`·`time`·`signalSell`을 더해요. 셋 다 매도 줄이라 `pnlPct`가 있고 `stage`는 없어요.
- 매수 사유: 처음 맞은 묶음의 조건 문구를 ` + `로 이어요. 40자(`REASON_MAX`, `src/lib/share/checkResult.ts`)를 넘으면 39자에서 자르고 `…`을 붙여요.
- 조건이 패턴 블록 하나뿐인 묶음은 패턴 사유(`3일 연속 상승`·`B 돌파` 등) 그대로예요. 그래서 옮긴 전략의 사유가 지금과 같아요.
- 조건 문구(`condReason`): `종가 20일선 위`, `골든크로스 20/60`, `데드크로스 20/60`, `RSI14 30 상향 돌파`, `RSI14 70 위`, `거래량 20일 평균 1.5배↑`, `5일 +10% 이상`, `5일 −10% 이하`, `60일 고점 −20%↓`, `60일 신고가`.
- 매도 사유: `trail` = `트레일링 −10%`(갭이면 `(갭)`), `time` = `보유 20일 청산`, `signalSell` = 맞은 묶음 문구.
- `simText.ts`의 `tradeWhy`: `signalSell`은 `<사유> 매도`, 나머지 새 종류는 사유 그대로예요.

### 4.8 nearMiss (`src/lib/sim/summary.ts`)

- 매수 평가기에 패턴 블록이 있으면 `patternStats`가 그 블록 통계라 지금과 같아요.
- 패턴 블록이 없으면 `stats()`가 `null`이고 `nearMiss`도 `null`이에요. `ResultView`는 지금처럼 `nearMiss`가 있을 때만 그 줄을 보여요. 새 문구는 더하지 않아요.
- `nearMissText`는 `s.entry` 대신 매수 조건의 패턴 블록 `entry`를 받아요. 「②의 사는 신호」는 「반등 패턴 ②의 사는 신호」로 바꿔요. 패턴 칸이 이제 매수 조건 안의 한 블록이라 ①②가 어디를 가리키는지 밝혀요.

## 5. 지표 (`src/lib/sim/indicators.ts`)

모든 함수는 종목의 봉 배열 인덱스 기준이고, 값이 모자라면 `null`이에요. 판정에서 `null`은 늘 「불만족」이에요(지금 `crossed`와 같아요).

### 5.1 정의

| 함수 | 공식 | 첫 값 |
|---|---|---|
| `sma(c, n)` | 지금 그대로 | `i = n−1` |
| `rsi(c, n, start)` | Wilder. 변화량 dᵢ = cᵢ − cᵢ₋₁. `start`부터 시작해 첫 평균 = 그 뒤 n개 변화량의 상승·하락 산술평균. 이후 avg = (avg × (n−1) + 오늘) / n. RSI = 100 − 100 / (1 + 평균상승/평균하락) | `i = start + n` |
| `volumeRatio(v, n)` | vᵢ / (전날까지 n개 봉 중 거래량이 있는 봉의 평균). 오늘은 평균에서 빼요 | `i = n` |
| `rollingMax(c, window, min)` | 오늘 포함 최근 window개 최댓값. 개수가 min 미만이면 `null` | 개수 ≥ min |

- RSI 시작점: `start = max(0, firstDayIdx − 250)`. 기간 첫날 앞 **고정 250봉**에서 시작해요. 받은 워밍업 길이가 달라도 같은 기간이면 같은 값이 나와요. 250봉이 없는 종목(최근 상장)은 0부터 시작해요.
- RSI 특수값: 평균하락 = 0이면 100, 평균상승·평균하락이 모두 0이면 50이에요.
- 거래량: `v ≤ 0`이거나 유한한 수가 아니면 **값 없음**으로 봐요. 평균에서 빼요. 오늘 값이 없으면 불만족(`null`)이에요. 창 안에 값 있는 봉이 하나도 없어도 `null`이에요.
- `rollingMax`는 `src/lib/screen/precompute.ts`의 지역 함수를 `min` 인자 그대로 `indicators.ts`로 옮겨요. 선정 기준은 지금 인자 그대로 쓰고, 엔진은 `min = window`로 불러 창이 다 찬 날만 써요. 단조 덱이라 O(n)이에요.

### 5.2 조건 판정 (t = 오늘)

| 조건 | 맞는 때 | 등호 |
|---|---|---|
| `maPrice` above / below | c[t] > sma[t] / c[t] < sma[t] | 같으면 둘 다 불만족 |
| `maCross` golden | short[t−1] ≤ long[t−1] 그리고 short[t] > long[t] | 지금 `crossed`와 같음 |
| `maCross` dead | short[t−1] ≥ long[t−1] 그리고 short[t] < long[t] | 대칭 |
| `rsi` above / below | rsi[t] > level / rsi[t] < level | 같으면 불만족 |
| `rsi` crossUp | rsi[t−1] ≤ level 그리고 rsi[t] > level | 교차 |
| `rsi` crossDown | rsi[t−1] ≥ level 그리고 rsi[t] < level | 교차 |
| `volume` | volumeRatio[t] ≥ ratio | 같으면 만족 |
| `change` above / below | (c[t] / c[t−days] − 1) × 100 ≥ pct / ≤ pct | 같으면 만족 |
| `fromHigh` | (1 − c[t] / rollingMax(c, days, days)[t]) × 100 ≥ pct | 같으면 만족 |
| `newHigh` | c[t] > rollingMax(c, days, days)[t−1] (어제까지 days개 최고 종가) | 같으면 불만족 |
| `pattern` | `createPatternTracker(...).signal(t) !== null` | |

「위·아래·돌파」는 엄격 비교, 「이상·이하·배 이상」은 같음 포함이에요. 문구(§4.7)와 맞췄어요.

### 5.3 데이터 부족

- 지표가 `null`인 날은 불만족이에요. 신호가 안 나는 것뿐이고 오류가 아니에요.
- 봉 없는 날은 지금처럼 그 종목을 판정하지 않아요. 인덱스는 그 종목 배열 기준이라 거래정지일은 건너뛰고 이어져요(지표는 봉 기준, 기간 청산은 시장 축 기준).

### 5.4 워밍업 (`loadSimData.ts`)

- `longestMa(s)`를 `rulesLookback([...rules.buy, ...(sell.signal.on ? sell.signal.groups : [])])`로 바꿔요. 식은 그대로 `addDays(from, -max(400, ceil(L × 1.6)))`예요.
- 조건별 L: `maPrice` = period, `maCross` = long, `rsi` = 251(고정 시작점 250봉 + 1), `volume` = days + 1, `change` = days + 1, `fromHigh` = days, `newHigh` = days + 1, `pattern` = 지금 `longestMa`가 보던 켜진 이평 기간 중 최댓값.
- RSI를 쓰면 `ceil(251 × 1.6) = 402`일이라 400일보다 조금 길어요. 달력 402일은 거래일 약 270일이라 250봉을 덮어요.
- 옮긴 전략은 패턴 블록 하나라 L이 지금과 같고, 받는 기간·메모 키(`memoKey`)도 같아요.

## 6. 자금 배분

### 6.1 1회 금액

| 모드 | 금액 |
|---|---|
| `fixed` | roundMoney(initial × pct / 100). 지금과 같아요 |
| `equityPct` | roundMoney(전 거래일 종가 기준 총자산 × pct / 100). 첫 거래일은 initial(확정) |
| `cashPct` | roundMoney(그 순간 남은 현금 × pct / 100). 같은 시가에 앞 종목이 사면 줄어든 현금으로 계산해요 |
| `equal` | roundMoney(initial / 종목 수). 종목 수는 엔진의 `input.stocks.length`(실제로 받은 종목) |

- 금액은 포지션을 열 때 한 번 정해 포지션에 붙여요(`Position.amount`). 추가 매수(`walkBar`의 `ctx.amount`)도 그 금액을 써요. 지금은 늘 같은 금액이라 결과가 같아요.
- 「그날 총자산」을 전 거래일 종가로 정한 이유: 시가 체결 전에는 오늘 종가를 몰라요. 같은 날 앞 종목 매수로 총자산이 바뀌지도 않아요.
- `equal`의 종목 수는 받지 못한 종목을 빼요. 편집 화면 안내(§10.4)는 고른 종목 수로 보이니, 일부 종목을 받지 못하면 실제 금액이 안내보다 커져요. 결과 화면의 받지 못한 종목 안내가 이미 있어 따로 알리지 않아요.

### 6.2 현금 부족·1주 미만

- 수량·비용은 지금 `sizeBuy(amount, price, feePct, cash)`가 그대로 계산해요.
- 1주도 못 사면 `'1주가 1회 금액보다 비쌈'`, 비용이 현금보다 크면 `'현금 부족'`으로 건너뛰어요. 남은 현금만큼 줄여 사지 않아요.
- `cashPct`의 **첫 매수**는 금액이 현금 이하라 현금 부족이 나지 않아요. 남은 현금이 줄면 금액도 줄어 1주 미만으로 건너뛸 수 있어요.
- `cashPct`의 **추가 매수**는 포지션을 열 때 정한 금액을 써요. 그사이 현금이 줄었으면 `'현금 부족'`으로 건너뛸 수 있어요.
- 건너뜀 사유 목록(`Skip['reason']`, `SKIP_REASONS`)은 그대로예요.

### 6.3 경고 (`strategyIssues`의 자금 경고)

| 모드 | 경고 |
|---|---|
| `fixed`, `equityPct` | pct × (1 + 추가 횟수) × 종목 수 > 100이면 지금 문구 |
| `equal` | 분할 매수가 켜져 있으면 「균등 배분은 첫 매수에 몫을 다 써요. 추가 매수는 현금이 모자라 건너뛸 수 있어요」 |
| `cashPct` | 없음 |

## 7. 선정 기준 연동

- `SelectionCriteria`의 형식은 바꾸지 않아요. `pattern.entry`의 타입 이름만 `Strategy['entry']`에서 `PatternEntry`로 바꿔요.
- `resolveReboundEntry`(`src/lib/screen/precompute.ts`): `from:'strategy'`면 그 전략 매수 조건의 패턴 블록 `entry`를 써요.
  - 전략이 없으면 지금처럼 `MissingStrategyError`.
  - 전략은 있는데 패턴 블록이 없으면 새 `MissingPatternError`. 실행 전에 아래 경고가 먼저 막으니 방어용이에요.
- `criteriaIssues`·`strategyRuleIssues`(`src/lib/screen/validate.ts`)
  - 전략이 없을 때: 지금 문구 「반등 신호에 쓰던 전략이 없어요. 다시 골라 주세요」(막음).
  - 패턴 블록이 없을 때: 새 문구 「고른 전략에 반등 패턴이 없어요. 반등 패턴이 있는 전략을 고르거나 직접 정해 주세요」(막음, 기준 실행만).
  - 블록이 있으면 그 블록에서 나온 막는 경고만 빌려 와요. `ruleIssues`의 경고에 `pattern: true` 표시를 달아 고를 수 있게 해요.
  - 매매 규칙(②): 지금처럼 막는 경고 전부(`RULE_SECTIONS`).
- 전략 편집 화면은 막지 않아요. 선정 기준이 참조하는 전략에서 패턴 블록을 빼면 「이 전략을 반등 패턴으로 쓰는 선정 기준이 N개 있어요」라는 막지 않는 경고를 「매수 조건」 구역에 보여요. 전략은 그대로 실행돼요.
- `runTrading`(`src/lib/screen/runValidation.ts`)의 덮어쓰기
  - `capital: { initial: criteria.capital }`, `period`·`costs`·`benchmarks`는 지금처럼 기준 값.
  - `rules`·`scaleIn`은 참조 전략 그대로.
  - `sizing`: `fixed`·`equityPct`·`cashPct`는 그대로. `equal`은 `{ mode: 'equityPct', pct: 100 / rank.take }`로 바꿔요. 검증의 종목은 재선정마다 바뀌어 누적 종목 수가 커져요. 보유 곡선(`holdSelection.ts`)이 뽑힌 종목을 그때 자산으로 똑같이 나누는 것과 맞춰요.
- `criteriaSnapshot`(`src/lib/share/snapshot.ts`): `from:'strategy'`면 참조 전략의 패턴 블록 `entry`를 복사해 `from:'custom'`으로 바꿔요. 전략이나 블록이 없으면 `defaultPatternEntry()`를 넣어요(지금은 `newStrategy(...).entry`).
- `CriteriaEditor.svelte`
  - 「전략에서 불러오기」 목록에서 패턴 블록이 없는 전략은 `disabled`로 「반등 패턴 없음」을 붙여요.
  - 직접 정하기로 바꿀 때 복사 원본도 패턴 블록 `entry`예요(없으면 `defaultPatternEntry()`).
  - `EntrySection` 겉모양 우회(`entryHost`)를 없애고 §10.2의 `PatternFields`를 바로 써요.

## 8. 옮기기·호환·배포

### 8.1 v1 → v2 옮기기 (`toV2`, `src/lib/sim/strategyV1.ts`)

| v1 | v2 |
|---|---|
| (없음) | `v: 2` |
| `capital.initial` | `capital.initial` |
| `capital.perBuyPct` | `sizing: { mode: 'fixed', pct }` |
| `entry` | `rules.buy = [{ conds: [{ kind: 'pattern', entry }] }]` |
| `exit.takeProfit` | `rules.sell.takeProfit = { on: true, stages, afterFirstTake }` |
| `exit.afterFirstTake` | 위로 옮김 |
| `exit.stopLoss` | `rules.sell.stopLoss = { on: true, pct, basis }` |
| (없음) | `trailing: { on: false, pct: 10 }`, `timeExit: { on: false, days: 20 }`, `signal: { on: false, groups: [] }` |
| 나머지 | 그대로 |

- 입력은 먼저 `sanitizeStrategiesV1`로 고친 뒤 옮겨요. 옮기기 자체는 순수 함수예요. 시각·난수를 쓰지 않아 같은 v1이면 늘 같은 v2예요.
- 저장된 객체의 형식 판별은 `v === 2`예요. `v`가 없으면 v1로 봐요.

### 8.2 저장소: 새 키에 두고 옛 키는 그대로

같은 키를 제자리에서 바꾸면 위험해요. 같은 브라우저의 옛 탭(같은 출처)이 바뀐 키를 읽어 기본값으로 채우고, 그대로 저장하거나 올릴 수 있어요. 그래서 v2는 **새 키**에 둬요.

- 새 키: `p:<id>:strategySet`(`profileKeys.strategySet`). 저장소 키는 문서 필드가 아니지만, 혹시 섞여도 걸리지 않게 금지 키와 겹치지 않는 이름으로 골랐어요.
- 옛 키 `p:<id>:strategies`는 새 앱이 **쓰지 않아요.** 옮긴 뒤 옛 키가 곧 백업이에요. 따로 백업 키를 만들지 않아요.
- `loadStrategies`(`strategyStore.ts`)
  1. 새 키가 있으면 v2 검증으로 읽어요.
  2. 없으면 옛 키를 v1 검증 → `toV2`로 옮기고 `st.trySet(새 키, …)`로 써요. 쓰기에 실패하면 옮긴 값을 메모리로만 쓰고, 다음에 다시 옮겨요(옛 키가 그대로라 결과가 같아요).
  3. 옮기기는 「고침」이 아니라 배너(`reportCorrupt`)를 띄우지 않아요. v1 검증에서 실제로 고친 것이 있을 때만 띄워요.
- `saveStrategies`·`app.svelte.ts`의 전략 쓰기(지금 `write(profileKeys.strategies(...))`)는 새 키에 써요.
- `applyProfileDoc`(`src/lib/sync/profileDoc.ts`)
  - v2 문서: 새 키에 써요. 옛 키는 손대지 않아요.
  - v1 문서(아직 옮기지 않은 기기가 올린 서버 문서): 옛 키에 쓰고 새 키를 지워요. 다음 읽기가 다시 옮겨요.
- `onStorage`(`app.svelte.ts`)의 동기화 키 목록에 새 키를 더해요. 옛 키는 v1 문서를 받을 때만 바뀌니 목록에 남겨 둬요.
- `removeProfile`에서 새 키도 지워요. `profileKeys`에 `strategySet`을 더해요.
- 내보내기·동기화 문서는 새 키만 읽어요.

### 8.3 동기화 (`src/lib/sync/`)

- `PROFILE_DOC_VERSION = 2`. 타입은 `ProfileDocV1`(전략 `StrategyV1[]`)과 `ProfileDocV2`, 합친 `ProfileDoc`이에요. 새 앱은 V2만 만들어요.
- `checkProfileDoc`은 `v`가 1이면 v1 검증, 2면 v2 검증으로 정확히 같은지 봐요. `v`가 더 크면 새 코드 `unsupported`(`DocError`에 더함)예요.
- `checkProfileDoc`은 지금처럼 **입력 원본**을 `doc`으로 돌려줘요. Worker는 그 원본을 그대로 저장해요(`JSON.stringify(checked.doc)`). 검사가 옮기거나 고친 값을 저장하지 않아요.
- 새 앱은 받은 문서의 `v`가 자기 버전보다 크면 쓰지 않고 「앱을 새로 고쳐 주세요」를 알려요(앞으로의 v3 대비).

#### 옮기기 단계와 해시 앞당김 (가짜 충돌 막기)

옮기기만 해도 로컬 문서 해시가 v1 문서 해시 H1에서 v2 문서 해시 H2로 바뀌어요. 그대로 두면 다른 기기가 그사이 서버를 고쳤을 때, 이 기기는 아무것도 안 고쳤는데 `pull()`이 「로컬도 바뀜」으로 보고 충돌 사본을 만들어요(`engine.ts`의 `syncedHash === localHash` 비교).

- 동기화 엔진이 첫 주기를 돌기 **전에** 옮기기 단계를 둬요(`src/lib/sync/migrate.ts`, 컨트롤러 시작 시).
  1. 프로필마다 `loadStrategies`로 옮겨 새 키를 채워요.
  2. 옮기기 전 문서(옛 키로 만든 v1 문서)의 해시 H1과 옮긴 뒤 v2 문서 해시 H2를 구해요.
  3. `store.state(id).syncedHash === H1`이면 `syncedHash`를 H2로 바꿔요. `syncedRevision`은 그대로예요.
- 이러면 옮기기는 「확인된 상태」로 쳐요. 이 기기에 실제 수정이 없으면 서버의 새 리비전을 그대로 받아요.
- 이 기기에서 확인되지 않은 수정이 있었으면(`syncedHash ≠ H1`) 앞당기지 않아요. 지금처럼 보내기·충돌 규칙을 따라요.
- 서버가 아직 v1이면 다음 `enqueueChanged()`가 v2를 올려요. H2 ≠ 서버 해시라도 리비전이 같으니 충돌 없이 받아들여져요. 여러 기기가 같은 v1을 옮기면 같은 H2가 나와 서로 충돌하지 않아요.

#### 지금 옛 앱이 실제로 하는 일 (코드 확인, 16dd479)

- 옛 앱은 받은 문서를 검사하지 않아요. `engine.ts`의 `pull()`이 `api.getProfile` 결과를 `local.write` → `app.applySyncedProfile` → `applyProfileDoc`으로 바로 써요. `checkProfileDoc`은 Worker의 PUT에서만 돌아요.
- 그래서 v2 문서를 받으면 저장소에 v2 전략이 그대로 들어가요. 읽을 때 v1 `sanitizeStrategies`가 `rules`를 모르는 키로 버리고, 빠진 `entry`·`exit`를 조용히 기본값으로 채워요(빠진 필드는 「고침」으로 세지 않아 배너도 없어요).
- 다음 `enqueueChanged()`에서 `buildProfileDoc`이 기본값으로 채운 v1 문서를 만들어요. 해시가 받은 것과 달라 PUT해요. Worker가 v1을 받으면 **서버의 v2 규칙이 기본값으로 덮여요.** 데이터 손실이에요.

#### 막는 방법 (Worker, PR①)

옛 앱 코드는 바꿀 수 없어요. Worker가 옛 앱에게 v2를 주지도, 받지도 않게 해요.

1. **요청 버전**: 새 앱은 프로필 요청에 쿼리 `docVersion=2`를 붙여요. 붙이는 자리는 `src/lib/sync/api.ts`의 프로필 요청들(`getProfile`·`getRevision`·`restoreProfile`·`putProfile`·`deleteProfile`)이에요. 헤더가 아니라 쿼리라 CORS 허용 헤더(`sync-worker/src/cors.ts`의 `ALLOWED_HEADERS`)를 바꾸지 않아요.
   - Worker 파싱: 없으면 1. 1 이상의 정수가 아니면 422 `invalid`(path `docVersion`).
2. **저장 버전 열**: `profile_index`에 `doc_v INTEGER NOT NULL DEFAULT 1` 열을 더해요(`sync-worker/migrations/0004_doc_version.sql`). PUT·복원 때 같은 배치에서 갱신해요. 본문을 파싱하지 않고 비교할 수 있어요.
3. **PUT 순서**: `checkProfileDoc` → `replayed()` → 버전 조건부 갱신.
   - `replayed()`를 버전 검사 앞에 둬요. 이미 반영된 같은 opId를 다시 보내면 처음 결과를 돌려줘요. 응답을 못 받은 기기가 재전송했다가 422를 받아 `rejectedHash`가 남는 일을 막아요.
   - 갱신은 조건부 `UPDATE profile_index … WHERE … AND revision = ? AND doc_v <= ?`(들어온 `v`) 한 문장이에요. 검사와 갱신 사이에 다른 기기가 v2를 올려도 원자적으로 막혀요. 새로 만들기(`expectedRevision 0`)는 `doc_v`를 함께 넣어요.
   - 반영되지 않았으면 지금 `rejected()`가 머리를 다시 읽어요. `doc_v`가 들어온 `v`보다 크면 422(아래 코드), 아니면 지금처럼 409·410이에요.
4. **본문을 돌려주는 응답**: 저장된 `doc_v`가 요청 버전보다 크면
   - `getProfile`·`getRevision`(그 리비전 본문의 `v`)·`restoreProfile`은 422로 답해요. `restoreProfile`은 **바꾸기 전에** 검사해서, 거절할 때는 아무것도 바꾸지 않아요.
   - 409 충돌 응답(`rejected()`, `deleteProfile`의 `h?.lastOpId === opId` 분기)은 `doc`을 빼요(`null`).
- 422 코드: 한국어 문장 `앱을 새로 고쳐 주세요`를 써요(상수 `APP_OUTDATED_CODE`, `dto.ts`).
  - 이유: 옛 앱 `SyncPanel.svelte`는 거절 코드를 괄호에 날것으로 보여요(「…서버가 받지 않았어요(코드). 줄이면 다시 보내요.」). 영문 코드 `app-outdated`보다 「(앱을 새로 고쳐 주세요)」가 사용자에게 뜻이 통해요.
  - 새 앱은 이 코드를 비교해 자기 문구로 바꿔 보여요. 코드는 JSON 본문의 문자열이라 한국어여도 전송에 문제가 없어요.

#### 막은 뒤 옛 앱 화면 (코드 확인)

- GET이 422면 옛 앱은 `kind: 'invalid'`로 받아요. `failed()`가 `phase: 'error'`를 돌려주고 `pull()`이 그 자리에서 끝나요.
  - 상태 줄: `SyncPanel.svelte`의 `PHASE.error` 「오류가 났어요. 잠시 뒤 다시 시도해요」.
  - 다시 시도: 5초부터 두 배씩, 최대 5분(`BASE_BACKOFF`·`MAX_BACKOFF`).
  - 그 주기의 나머지가 멈춰요. 뒤 프로필 받기, 키 단계(`keys`), 올리기(`push`)를 모두 하지 않아요(`run()`이 `phase !== 'idle'`에서 끊어요). 다른 프로필의 동기화도 같이 멈춰요.
  - 저장소에는 아무것도 쓰지 않아요.
- PUT이 422면 `rejectedHash`·`rejectedCode`를 남기고 같은 문서를 다시 보내지 않아요. 설정 화면에 「…(앱을 새로 고쳐 주세요)…」가 보여요.
- 옛 앱 문구 체계라 「앱을 새로 고쳐 주세요」를 상태 줄에 띄울 수는 없어요. 앱은 PWA `autoUpdate`(`pwa.config.ts`, `@sch0718/vite-app`)라 다시 열면 새 버전이 돼요. 옛 탭이 오래 열려 있는 동안만 위 상태가 보여요.
- 남는 위험: Worker 배포 전에 옛 앱이 v2를 받는 경우는 막을 수 없어요. 그래서 PR①(Worker)을 먼저 배포해요(§8.7). 서버 리비전 기록(`revisions` 표, `getRevision`)으로 되돌릴 길은 있어요.

#### 새 앱의 남은 처리

- IndexedDB에 남은 v1 충돌 사본: 충돌을 고르면 `applyProfileDoc`이 v1을 옛 키에 쓰고 다시 옮겨요.
- 미전송 v1 작업: `enqueueChanged()`가 지금도 해시가 다른 미전송 작업을 지우고 새 문서를 넣어요.
- 보냈지만 응답을 못 받은 v1 작업: 다시 보내요. 이미 반영된 opId면 `replayed()`가 처음 결과를, 서버가 그사이 v2가 됐으면 422를 돌려줘요.

### 8.4 공유 (`src/lib/share/`, `sync-worker/src/shares.ts`)

- 버전은 전략을 담는 종류만 올려요. `strategy`·`simResult` = 2, `group`·`compare`·`criteria`·`validation` = 1 그대로예요. 기준 스냅샷은 형식이 바뀌지 않으니 옛 앱이 계속 열 수 있게 해요.
- `checkShareSnapshot`
  - `strategy`·`simResult`는 `v` 1·2를 받아요. 알려진 것보다 높은 `v`는 `unsupported`(`ShareError`에 이미 있음)예요.
  - **create 모드**: 옮기지 않고 받은 **원본**을 돌려줘요. Worker(`shares.ts`)는 `checked.snapshot`을 저장하니, 옛 앱이 만든 v1 공유는 v1 그대로 저장돼요.
  - **read 모드**: `checkStrategyPart`가 v1 검증 뒤 `toV2`로 옮기고, 스냅샷 `v`도 2로 바꿔 돌려줘요. 화면 코드는 늘 v2만 봐요.
- `pendingImport.ts`의 `importPart`는 `v: 1`을 박지 않고 받은 스냅샷의 `v`를 따라가요(`strategy`는 read 결과라 2, `criteria`는 1).
- 새 앱은 늘 v2로 만들어요. 서버에 있는 v1 공유 링크는 새 앱에서 옮겨 열려요.
- 옛 앱이 v2 공유를 열면 `raw.v !== SHARE_VERSION`으로 거절돼요. 문구는 옛 앱 것이라 바꿀 수 없어요. 한계로 남겨요.
- 결과 검사(`checkResult.ts`): `TRADE_KINDS`·`SELL_KINDS`(`resultEnums.ts`)에 새 3종을 더해요. 새 종류는 `stage`가 `null`, `pnlPct`가 있어야 해요. `resultEnums.test.ts`의 타입 대조도 같이 고쳐요.

### 8.5 내보내기 (`src/lib/state/exportImport.ts`)

- `EXPORT_SCHEMA_VERSION = 2`. 가져오기는 1·2를 받고, 1이면 전략을 옮겨요.
- 옛 앱은 v2 파일에 지금 문구 「지원하지 않는 버전이에요」(`IMPORT_BAD_VERSION`)를 보여요.

### 8.6 옛 앱이 만나는 것 요약

| 만나는 것 | 옛 앱 동작 |
|---|---|
| 서버의 v2 프로필 받기 | 422 → 「오류가 났어요. 잠시 뒤 다시 시도해요」, 최대 5분 간격 재시도, 그 주기 동기화 전체 멈춤, 저장소 그대로 |
| v2 위에 v1 올리기 | 422 → 설정 화면 「…(앱을 새로 고쳐 주세요)…」, 같은 문서 재전송 안 함 |
| v2 공유 열기 | 거절(옛 문구) |
| v1 공유 만들기 | 지금처럼 됨(v1 원본 저장) |
| v2 내보내기 파일 | 「지원하지 않는 버전이에요」 |
| 같은 브라우저의 새 탭이 옮김 | 옛 키 `p:<id>:strategies`를 건드리지 않아 옛 탭은 v1 그대로 읽어요 |

### 8.7 PR 나누기와 배포 순서

#### PR① 서버 호환

- 범위
  - `src/lib/sim/types.ts`(v2 타입만 더함, 앱은 아직 v1 사용), `src/lib/sim/strategyV1.ts`(옛 검증·`toV2`), v2 검증 함수.
  - `src/lib/sync/dto.ts`: `checkProfileDoc` v1·v2, `unsupported`, 원본 반환 명시, `APP_OUTDATED_CODE`.
  - `src/lib/share/snapshot.ts`·`checkResult.ts`·`resultEnums.ts`: v1·v2 수용, create 원본·read 옮기기, 새 체결 종류.
  - `sync-worker/src/profiles.ts`·`shares.ts`·`migrations/0004_doc_version.sql`: `docVersion`, `doc_v`, 원자적 다운그레이드 거절, 본문 응답 가리기, `replayed()` 순서.
- 앱은 여전히 v1만 만들고 `docVersion`을 보내지 않아요. 그래서 Worker에게는 PR① 앱도 「버전 1 클라이언트」예요.
- 병합 → Worker 배포(마이그레이션 포함) → 앱 배포.

#### PR② 엔진·화면·옮기기

- 엔진(§4~6), 저장소 새 키·옮기기(§8.2), 옮기기 단계·해시 앞당김(§8.3), `docVersion=2`, 공유·내보내기 v2 생성, 선정 기준(§7), 편집 화면(§10), 재생 표시(§9).
- PR① Worker 배포를 확인한 뒤 병합·배포해요.

#### 단계별 동작

| 단계 | 서버 문서 | 옛 앱(지금 배포본) | PR① 앱 | PR② 앱 |
|---|---|---|---|---|
| 지금 | 모두 v1 | 그대로 | — | — |
| PR① 배포 후 | 모두 v1, `doc_v = 1` | 그대로(요청 버전 1, 저장 버전 1이라 가리기·거절이 걸리지 않아요) | 옛 앱과 같아요 | — |
| PR② 배포 후, 아무도 아직 안 엶 | v1 | 그대로 | 그대로 | — |
| PR② 앱이 한 번 엶 | 그 프로필 v2, `doc_v = 2` | 그 프로필 받기 422, 올리기 422(§8.6) | 옛 앱과 같아요(버전 1 클라이언트) | v1은 받아 옮김, v2 주고받음 |

PR①만 배포된 상태에서 옛 앱이 전과 똑같이 도는지는 `profiles.test.ts`·`shares.test.ts`의 「쿼리 없음 + v1 문서」 경로 테스트로 확인해요(§12.4). 응답 모양이 바뀌지 않는지(409 본문 `doc` 포함, 200 본문)를 지금 테스트 그대로 통과시켜요.

- 순서를 어기면 PR② 앱의 v2 PUT이 옛 Worker에서 422(`v`)로 거절되고 `rejectedHash`가 남아요. 그 문서가 바뀔 때까지 다시 보내지 않아요. 그래서 PR② 병합 전에 Worker 배포를 확인해요.

## 9. 결과·재생 형식

### 9.1 `SimResult`

- `Trade.kind`에 3종을 더하는 것 말고 바뀌지 않아요. `summary`·`perSymbol`·`roundTrips` 계산은 그대로예요.

### 9.2 재생 (`HoldingFrame`·`DayFrame`)

```ts
export interface HoldingFrame {
  // …지금 필드
  trail: number | null;  // 다음 거래일 트레일 가격, 꺼지면 null
  heldDays: number;      // 시장 축 보유 거래일, 매수일 = 1
}
export interface DayFrame {
  // …지금 필드
  pendingSells: { symbol: string; reason: string }[]; // 그날 종가 → 다음 거래일 시가 매도 예약
}
```

- 재생 스펙 §4.4(`2026-11-01-simulation-replay-design.md:162`)는 `stop`이 `null`인 경우를 「분할 매수 끝나기 전 `avgAfterScaleIn`, 유일한 경우」로 봤어요. 이제 손절을 끈 경우도 `null`이에요.
- 프레임에 상태 필드를 더하지 않고 화면이 전략으로 계산해요. `DayPanel`은 `ResultView`가 가진 실행 전략(`meta.strategy`)을 받아요.
  - `stop === null`이고 손절이 켜져 있으면(`avgAfterScaleIn`, 분할 매수 중) 지금 문구 `STOP_PENDING_NOTE`.
  - `stop === null`이고 손절이 꺼져 있으면 「손절 꺼짐」.
  - 기간 청산까지 남은 날은 `timeExit.days − heldDays`로 계산해요.
- 같은 스펙 §6.1의 「분할 매수 중 `avgAfterScaleIn`은 `null`」 단언은 그대로 맞아요. 손절 끔 경우만 테스트를 더해요.
- `timeline` 불변식(골든 테스트의 `toStrictEqual`)은 그대로예요.

### 9.3 화면 반영

| 파일 | 변경 |
|---|---|
| `src/lib/ui/simulate/markers.ts` | `TRADE_LABEL`에 `trail: '트레일'`, `time: '기간'`, `signalSell: '조건'`. `MARKER_COLOR`는 셋 다 `MIXED_COLOR`(손익 방향이 정해지지 않음). 매도라 위 ▼ |
| `src/lib/ui/simulate/simText.ts` | `tradeWhy`(§4.7), `priceMarks`에 `trail` 눈금(`PriceMark.kind`에 `'trail'`), `pendingSellText`, `STOP_OFF_NOTE`, `nearMissText` |
| `src/lib/ui/simulate/HoldingCard.svelte` | 트레일 눈금, 손절 문구(§9.2), 「보유 N거래일째 · M일 뒤 청산」 |
| `src/lib/ui/simulate/DayPanel.svelte` | 전략 prop, 예약 매도 「다음 거래일 시가에 팔아요: 삼성전자 — <사유>」(예약 매수 위) |
| `src/lib/ui/simulate/ResultView.svelte` | `DayPanel`에 전략 전달 |
| `src/lib/ui/simulate/TradeList.svelte` | 사유는 `tradeWhy`라 따로 없음. 새 종류의 색·라벨 확인 |
| `src/lib/ui/simulate/positions.ts` | 매수 외는 매도로 세므로 바꿀 것 없음(확인만) |

## 10. 편집 화면

### 10.1 구역 (`StrategyEditor.svelte`)

| 키 | 제목 | 내용 |
|---|---|---|
| `universe` | 종목 | 그대로 |
| `period` | 기간·자금 | 기간, 처음 자금, **배분 방식**(§10.4) |
| `entry` | **매수 조건** | 묶음 편집(§10.2) |
| `scaleIn` | 분할 매수 | 그대로 |
| `exit` | 매도 | 토글 4개 + 조건 매도(§10.3) |
| `benchmarks`·`costs` | 그대로 | |

구역 키(`Issue['section']`)는 그대로 둬요. 경고 연결 코드를 덜 바꾸려고요. 제목만 바꿔요.

### 10.2 매수 조건 (새 `editor/BuyRulesSection.svelte`, `CondGroupCard.svelte`, `CondRow.svelte`)

```
[묶음 1]  ─────────────── [묶음 지우기]
  [이동평균 ▾] 종가가 [20]일선 [위 ▾]        [×]
  [RSI ▾]     [14]일 RSI가 [30] [상향 돌파 ▾]  [×]
  [+ 조건]
── 또는 ──
[묶음 2] …
[+ 또는 묶음]
```

- 묶음 카드 머리에 「모두 만족」이라고 적고, 묶음 사이에 「또는」 구분선을 둬요.
- 조건 줄: 종류 선택(`이동평균 위·아래`, `이평 교차`, `RSI`, `거래량`, `N일 등락률`, `고점 대비 하락`, `신고가 돌파`, `반등 패턴`) → 종류별 숫자 칸(`NumberField` 재사용) → 지우기 버튼.
- 종류를 바꾸면 그 종류의 기본값으로 바꿔요. 앞 종류의 값은 기억하지 않아요.
- 반등 패턴은 매수 조건 전체에 하나만 둘 수 있어요. 이미 있으면 다른 줄의 선택지에서 `disabled`예요. 고르면 줄 아래에 `PatternFields`가 펼쳐져요.
- `EntrySection.svelte` → `PatternFields.svelte`로 바꿔요. props는 `entry: PatternEntry`, `update: (fn: (e: PatternEntry) => void) => void`, `nf?`예요. 전략 편집기와 `CriteriaEditor`가 같이 써요. `nf` 칸 이름(`dropPct` 등)은 그대로라 `CriteriaEditor`의 `entry-` 접두 처리도 그대로예요.
- 한도에 닿으면 [+ 조건]·[+ 또는 묶음]을 숨기지 않고 `disabled` + 이유 문구(「묶음은 4개까지예요」)를 보여요.
- 도움말: 「묶음 안 조건은 모두, 묶음끼리는 하나만 맞으면 사요」, 「팔고 난 다음 날에도 조건이 맞으면 다시 살 수 있어요. 패턴·교차·돌파는 새로 일어나야 맞아요」.
- 휴대폰: 한 열이에요. 조건 줄은 종류 선택이 한 줄, 숫자 칸이 다음 줄로 접혀요. 지우기 버튼은 44px 터치 영역이에요.
- 접근성: 묶음 카드는 `role="group"` + `aria-label="매수 묶음 1"`, 지우기 버튼은 `aria-label="묶음 1의 조건 2 지우기"`. 줄을 더하면 새 줄의 종류 선택으로 초점을 옮겨요. 지우면 앞 줄(없으면 [+ 조건])로 옮겨요.

### 10.3 매도 (`editor/ExitSection.svelte` 고침)

- 토글 줄 4개: 익절(켜면 지금 단계 편집), 손절(켜면 지금 % · 기준), 트레일링 스톱(%), 기간 청산(거래일).
- 「조건 매도」 토글을 켜면 `CondGroupCard`를 같은 방식으로 보여요. 반등 패턴은 선택지에 없어요.
- 문구: 「조건 매도·기간 청산은 종가에 판정해 다음 거래일 시가에 남은 수량을 모두 팔아요」, 「트레일링: 보유 중 가장 높은 종가에서 N% 내려오면 팔아요」, 「기간 청산은 매수일을 1일째로, 거래정지일도 세요」.

### 10.4 배분 방식 (`editor/PeriodSection.svelte`)

- 「회당 매수 비중」 칸 자리에 `Segmented`(`wrap` prop, 좁은 화면에서 두 칸씩 줄바꿈) 4개(처음 자금·총자산·남은 현금·균등) + 비율 칸.
- 균등이면 비율 칸을 숨기고 「처음 자금 ÷ 종목 수(지금 N종목 → 회당 X원)」를 보여요. N은 고른 종목 수예요(§6.1의 차이 참고).

### 10.5 템플릿

- `StrategyList.svelte`의 새 전략 만들기에서 템플릿 3개를 고르는 시트를 먼저 보여요. 「하락 후 반등」이 첫 선택이고 지금 새 전략과 같아요.
- 이미 있는 전략을 템플릿으로 바꾸는 메뉴는 두지 않아요. 새 전략을 만들어 쓰면 돼요.

### 10.6 요약 문구 (`simText.ts`, `shareText.ts`)

- `sectionSummary`
  - `entry`: 묶음은 ` 또는 `, 조건은 ` + `. 예: `RSI14 30 상향 돌파 + 종가 120일선 위 또는 60일 신고가`. 패턴 블록만 있으면 지금 `entrySummary` 문구 그대로예요.
  - `exit`: 켜진 것만 ` · `로. 예: `익절 +10%에 전량 · 손절 −5% · 트레일링 −10% · 20일 청산 · 조건 매도 1묶음`. 모두 꺼지면 `파는 규칙 없음`.
  - `capital`: `1,000만 원 · 회당 처음 자금 10%` / `총자산 10%` / `남은 현금 10%` / `종목마다 같은 금액`.
- `shareText.ts`의 `snapshotLines`(`strategy`): `1회 N%` 줄을 배분 문구로, `하락 …%` 줄을 매수 요약(40자에서 자름)으로, `익절/손절` 줄을 매도 요약으로 바꿔요.

## 11. 오류·경고 (`ruleIssues`, `src/lib/sim/validate.ts`)

| 조건 | 구역 | 막음 | 문구 |
|---|---|---|---|
| 매수 묶음이 없음 | entry | 예 | 사는 조건이 없어요. 조건을 하나 이상 넣어 주세요 |
| 빈 묶음(매수·조건 매도) | entry / exit | 예 | 빈 묶음이 있어요. 조건을 넣거나 묶음을 지워 주세요 |
| 패턴 블록 2개 이상(바깥에서 온 값) | entry | 예 | 반등 패턴은 하나만 넣을 수 있어요 |
| 패턴 블록의 트리거가 모두 꺼짐 | entry(`pattern`) | 예 | 사는 신호가 하나도 켜져 있지 않아요. 반등 패턴 ②에서 하나 이상 켜 주세요 |
| 패턴 골든크로스 짧은 ≥ 긴 | entry(`pattern`) | 아니요 | 지금 문구 |
| `maCross` 조건 short ≥ long | entry / exit | 아니요 | 짧은 이동평균 기간이 긴 이동평균보다 짧아야 해요 |
| 조건 매도를 켰는데 묶음 없음 | exit | 예 | 조건 매도에 조건을 넣거나 꺼 주세요 |
| 익절 단계 순서·합계 | exit | 지금과 같음 | 익절이 켜져 있을 때만 |
| `avgAlways` 손절 ≤ 추가 간격 | exit | 아니요 | 손절이 켜져 있을 때만 |
| 트레일링 % ≤ 추가 간격(분할 매수 켬) | exit | 아니요 | 추가 매수보다 트레일링이 먼저 일어나요. 추가 매수 간격을 트레일링 폭보다 작게 해 주세요 |
| 파는 규칙이 하나도 없음 | exit | 아니요 | 파는 규칙이 없어요. 기간 끝까지 들고 있어요 |
| 선정 기준이 반등 패턴으로 참조하는데 패턴 블록 없음 | entry | 아니요 | §7 |
| 자금 | capital | 아니요 | §6.3 |

- `Issue`에 선택 필드 `pattern?: true`를 더해 패턴 블록에서 나온 경고를 표시해요(§7).
- 저장 검증은 §3.2를 따라요.

## 12. 테스트

### 12.1 엔진 동일성 (가장 먼저)

- `src/lib/sim/simulate.golden.test.ts`와 `__snapshots__/simulate.golden.test.ts.snap`은 손대지 않아요. `-u`로 갱신하지 않아요.
- `testInputs.ts`의 `baseStrategy`·`goldenInputs`는 v1 모양으로 만든 뒤 `toV2`로 넘겨요. 그래서 골든 테스트가 옮기기까지 같이 지켜요.
- `simulate.test.ts`(694줄)도 같은 도우미(`v1Strategy(over)` → `toV2`)로 바꿔 기존 단언을 그대로 둬요.
- 성능: `simulate.perf.test.ts`의 timeline 켬/끔 비교를 그대로 통과해야 해요. 평가기는 지표를 미리 계산해 하루 판정이 O(조건 수)예요.

### 12.2 지표 (`indicators.test.ts`, 새 파일)

- `rsi`: 널리 쓰이는 14일 예시표(StockCharts의 44.34, 44.09, … 시작 표). 첫 값 70.53, 다음 66.32(소수 둘째 자리). 원본 표와 숫자 대조는 확인 필요(§14).
- `rsi` 특수값: 계속 오름 → 100, 변화 없음 → 50, `start + n` 앞은 `null`.
- `rsi` 시작점: 워밍업 길이만 다른 두 입력에서 기간 안 값이 같아요.
- `volumeRatio`: 오늘 제외 평균, `v ≤ 0` 봉 제외, 오늘 0 → `null`, 창 안에 값 없음 → `null`.
- `rollingMax`: `min` 동작, 덱 경계, `precompute`의 기존 테스트가 그대로 통과.

### 12.3 조건·매도 엔진 (`rules.test.ts`, `simulate.rules.test.ts`)

- 조건마다 맞는 날·안 맞는 날, §5.2의 등호 경계, 교차의 전날 값 경계, `null` 구간 불만족.
- 묶음: AND 하나 틀리면 불만족, OR 두 번째 묶음 사유, 사유 40자 자르기.
- 패턴 블록 하나 = `createPatternTracker` 결과와 날짜·사유·스냅샷이 같아요. 패턴 없는 매수 줄에는 `pattern` 키가 없어요.
- 트레일링: peak 갱신(종가), 갭 아래 시가 → `trail`(갭) 사유, 손절 = 트레일이면 `stop`, 트레일 vs 추가 매수 같은 가격이면 트레일.
- 기간 청산: N일째 종가 → 다음 날 시가, 거래정지일도 셈, 추가 매수로 다시 세지 않음, 다음 날 봉 없음 → 봉 있는 날로 미룸, 마지막 날 예약 없음.
- 조건 매도: 다음 날 시가 전량, 같은 날 갭 손절보다 먼저, 판 날 매수 판정 없음, `roundTrips`·`closed` 반영.
- 손절 끔·익절 끔·본전 손절만 남은 경우의 `stopPrice()`.
- 배분 4종: 금액 계산, `equityPct`는 전 거래일 총자산, `cashPct`는 같은 시가 앞 종목 뒤 현금, `cashPct` 추가 매수 현금 부족, 추가 매수 금액이 포지션 금액, 1주 미만·현금 부족 건너뜀, `equal`은 받은 종목 수.
- `nearMiss`: 패턴 블록 없으면 `null`.
- `rulesLookback`: 옮긴 전략은 `longestMa`와 같아요(`loadSimData.test.ts`). RSI면 402일.

### 12.4 옮기기·왕복

- `toV2`: 필드 표(§8.1)대로, 결정적(두 번 옮겨도 같음), `sanitizeStrategiesV1` 고침 여부 전달.
- `strategyStore`: 옛 키만 있음 → 새 키에 옮김·옛 키 그대로·배너 없음, `trySet` 실패 → 메모리로만, 새 키 있으면 옛 키 무시.
- `applyProfileDoc`: v2 → 새 키만, v1 → 옛 키 쓰고 새 키 지움. `onStorage`가 새 키 변경을 받음. `removeProfile`이 새 키를 지움.
- 옮기기 단계: `syncedHash === H1`이면 H2로 앞당기고 리비전 그대로, 다른 기기가 서버를 고친 뒤 받아도 충돌 없음. `syncedHash ≠ H1`이면 앞당기지 않음.
- 동기화: v1·v2 `checkProfileDoc` 통과, 원본 반환, v2에 v1 전략 섞이면 거절, 높은 `v`는 `unsupported`, 금지 키·깊이 검사 통과(조건 20개짜리 전략), `roundtrip.test.ts`에 v2 왕복.
- Worker(`sync-worker/src/profiles.test.ts`)
  - 쿼리 없음 + v1 문서: 지금 응답 그대로(PR① 무변화 확인).
  - 쿼리 없음 + 저장 v2: GET·리비전·복원 422(복원은 바뀌지 않음), 409·`deleteProfile` 409에 `doc: null`.
  - v1 PUT onto v2 → 422, 검사와 갱신 사이 v2가 올라온 경우도 422(조건부 UPDATE).
  - 반영된 같은 opId 재전송 → 처음 결과.
  - `docVersion` 형식 오류 → 422 `invalid`.
- 공유(`snapshot.test.ts`·`shares.test.ts`): create는 원본 저장(v1 그대로), read는 v1 → v2(`v: 2`), 높은 `v` → `unsupported`, 새 체결 종류 결과 검사, `criteriaSnapshot`의 패턴 블록 복사, UUID 없음, `importPart`가 `v`를 따라감.
- 내보내기: v1 파일 가져오기 → v2 전략, v2 왕복.
- 선정 기준: `resolveReboundEntry`(두 오류), 경고 두 문구, `runTrading`의 `equal` → `equityPct` 100/take.

### 12.5 화면 (vitest + axe, `src/lib/share/testAxe.ts` 방식)

- `BuyRulesSection`: 조건 더하기·지우기·종류 바꾸기(기본값), 묶음 더하기, 한도 `disabled`, 패턴 하나 제한, 초점 이동, axe.
- `ExitSection`: 토글 4개와 조건 매도, axe.
- `PeriodSection`: 배분 모드 전환, `wrap`, 균등 안내.
- 템플릿 시트: 고르면 규칙이 바뀌고 종목·기간은 그대로.
- `CriteriaEditor`: `PatternFields` 직접 사용, 블록 없는 전략 `disabled`.
- 재생: `HoldingCard`의 손절 문구 2가지·트레일 눈금·기간 청산 남은 날, `DayPanel` 예약 매도, `markers` 새 종류 라벨·색.
- e2e(`tests/e2e/simulate.spec.ts`·`a11y.spec.ts`): 템플릿 「골든크로스 추세」로 실행 → 결과·재생이 보임, 편집 화면 axe.

## 13. 범위 밖 (다시)

지수 필터, 재무·수급 조건, 장중 신호, 신호 기반 추가 매수, 묶음 중첩, 기존 전략을 템플릿으로 바꾸기. 다음 스펙에서 다뤄요.

## 14. 확인 필요

1. RSI 예시표 숫자(70.53, 66.32)는 기억에 기댄 값이에요. 구현 때 원본 표와 대조해야 해요.
2. 템플릿 숫자(§3.4)를 이대로 둘지.

검토 1회차에서 답을 받은 항목(트레일링 기준, `equityPct` 기준, `runTrading`의 `equal`, 거래량 값 없음, RSI 시작점, 쿼리 자리, 422 코드, `Segmented` 줄바꿈, 옛 앱의 v2 공유 문구)은 본문에 반영했어요.

## 15. 바뀌는 파일과 Task 순서

### 15.1 파일

| 파일 | PR | 변경 |
|---|---|---|
| `src/lib/sim/types.ts` | ①(타입 추가) ②(사용) | `PatternEntry`·`Cond`·`CondGroup`·`SizingMode`, `Strategy` v2, `Trade.kind` 3종, `HoldingFrame`·`DayFrame` 필드 |
| `src/lib/sim/strategyV1.ts` | ① | 새 파일: `StrategyV1`, `sanitizeStrategiesV1`, `toV2` |
| `src/lib/sim/validate.ts` | ①(v2 검증) ②(경고) | v2 `sanitizeStrategies`, `sanitizeEntry` → `sanitizePatternEntry`, `ruleIssues`·`strategyIssues` |
| `src/lib/sync/dto.ts` | ① | v1·v2 검사, `unsupported`, `APP_OUTDATED_CODE` |
| `src/lib/share/snapshot.ts`, `checkResult.ts`, `resultEnums.ts` | ① | §8.4 |
| `sync-worker/src/profiles.ts`, `shares.ts`, `migrations/0004_doc_version.sql` | ① | §8.3, §8.4 |
| `src/lib/sim/indicators.ts`, `src/lib/screen/precompute.ts` | ② | `rsi`·`volumeRatio`, `rollingMax` 이동 |
| `src/lib/sim/rules.ts` | ② | 새 파일: 평가기, `rulesLookback`, `condReason` |
| `src/lib/sim/position.ts` | ② | `sell`·`amount` 인자, 끄기, `trailPrice`·`markClose` |
| `src/lib/sim/simulate.ts` | ② | 평가기, 예약 매도, `sellQty`, 트레일 floor, 배분, `dayFrame` 필드 |
| `src/lib/sim/summary.ts` | ② | `nearMiss`가 `stats()` null 처리 |
| `src/lib/sim/defaults.ts`, `templates.ts`(새) | ② | v2 기본값, `defaultPatternEntry`, 템플릿 |
| `src/lib/sim/strategyStore.ts`, `src/lib/state/profileStore.ts`, `src/lib/state/app.svelte.ts` | ② | 새 키 `strategySet`, 옮기기, `onStorage`·`removeProfile`·전략 쓰기 |
| `src/lib/sim/loadSimData.ts` | ② | `rulesLookback` |
| `src/lib/sim/testInputs.ts`, `simulate.test.ts` | ② | v1 → `toV2` 도우미 |
| `src/lib/screen/validate.ts`, `runValidation.ts`, `types.ts`, `defaults.ts` | ② | §7 |
| `src/lib/sync/profileDoc.ts`, `api.ts`, `controller.svelte.ts`, `migrate.ts`(새) | ② | v2 문서·키 분기, `docVersion=2`, 문구, 옮기기 단계·해시 앞당김 |
| `src/lib/share/shareText.ts`, `pendingImport.ts` | ② | §10.6, `importPart` 버전 |
| `src/lib/state/exportImport.ts` | ② | §8.5 |
| `src/lib/ui/settings/SyncPanel.svelte` | ② | `APP_OUTDATED_CODE` 문구 |
| `src/lib/ui/simulate/StrategyEditor.svelte`, `StrategyList.svelte` | ② | 구역 제목, 템플릿 시트 |
| `src/lib/ui/simulate/editor/*` | ② | `BuyRulesSection`·`CondGroupCard`·`CondRow`·`PatternFields`(새), `ExitSection`·`PeriodSection` 고침, `EntrySection` 지움 |
| `src/lib/ui/screen/CriteriaEditor.svelte` | ② | `PatternFields`, 블록 없는 전략 |
| `src/lib/ui/simulate/simText.ts`, `markers.ts`, `HoldingCard.svelte`, `DayPanel.svelte`, `ResultView.svelte` | ② | §4.7, §4.8, §9.3 |

### 15.2 Task 순서 (계획에서 더 잘게)

**PR①**

1. `StrategyV1`·`sanitizeStrategiesV1`·`toV2`와 단위 테스트.
2. v2 타입·v2 검증 함수(앱은 아직 v1 사용).
3. `checkProfileDoc` v1·v2·`unsupported`·원본 반환.
4. `checkShareSnapshot` create 원본·read 옮기기, 새 체결 종류.
5. Worker: `doc_v` 마이그레이션, `docVersion` 파싱, PUT 순서·조건부 갱신, 본문 응답 가리기. 「쿼리 없음 + v1」 무변화 테스트.

**PR②**

6. `testInputs`·`simulate.test.ts`를 v1 → `toV2` 도우미로, 엔진이 v2 필드를 읽게. 골든 그대로.
7. 지표(`rsi`·`volumeRatio`·`rollingMax` 이동) + 테스트.
8. 평가기(`rules.ts`) + 패턴 블록 동일성 → `simulateCore` 연결. 골든 그대로.
9. `Position` 끄기·트레일, `walkBar` floor. 골든 그대로.
10. 예약 매도(조건 매도·기간 청산), `sellQty`.
11. 배분 4종, `nearMiss`.
12. `rulesLookback` → `loadSimData`.
13. 결과 형식: 재생 프레임·화면.
14. 저장소 새 키·옮기기, `applyProfileDoc`·`onStorage`·`removeProfile`.
15. 옮기기 단계·해시 앞당김, `docVersion=2`, 동기화 문구, 공유·내보내기 v2 생성.
16. 선정 기준 연동(§7).
17. 편집 화면: `PatternFields` 분리 → 매수 조건 → 매도 → 배분 → 템플릿 → 요약 문구.
18. e2e·axe, 도움말 정리.
