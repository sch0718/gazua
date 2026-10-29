# 공유 기능 확장 설계

작성 2026-10-29. 기반 문서는 [서버·DB 도입 검토](../../proposals/2026-10-25-server-and-db.md) 6절 「공유 링크는 전용 스냅샷으로 만들어요」와 [동기화 1단계 계획](../plans/2026-10-25-sync-phase1.md)이다. 조사 기준은 `main` `6b20044`다.

## 1. 목표와 범위

### 1.1 목적
지금 공유는 그룹·전략·선정 기준 세 종류를 읽기 전용으로 보여 주기만 한다. 이번 확장으로 다음이 된다.

- 받은 사람이 링크에서 바로 **내 앱에 가져온다**. 로그인·키 없이, 데모로도 된다.
- **비교 화면**(현재 시세)을 화면 구성째 보낸다. 받은 사람은 가져와서 자기 연결이나 데모로 같은 화면을 본다.
- **시뮬레이션 결과**와 **선정 기준 검증 결과**를 곡선·거래까지 보낸다.
- 카카오톡 카드에 종류별 대표 이미지(비교·결과는 화면 캡처)와 요약 문구를 넣는다.

성공 기준은 다음과 같다.
- 카카오톡으로 받은 결과 링크를 열면 보낸 사람이 본 요약 카드·수익 곡선·거래 내역이 그대로 보인다.
- 「내 앱에 가져오기」 한 번과 확인 한 번으로 받은 전략·기준·그룹이 내 프로필에 생긴다.

### 1.2 지금 구조 (바꾸지 않는 것)
- 스냅샷은 `src/lib/share/snapshot.ts`가 만들고 검사한다. 같은 `checkShareSnapshot`을 sync-worker가 `POST /v1/shares`에서 쓴다. 검사 순서는 금지 키 → 크기(100 KiB) → UUID 모양 → 종류별 필드다.
- 서버는 capability(256비트)의 SHA-256만 D1에 둔다. 만료는 기본 7일·최대 30일이고, 활성 공유는 50개까지다. `shares.kind`는 제약 없는 TEXT라 **D1 마이그레이션이 필요 없다.**
- 읽기 화면 `#/s/<capability>`는 관문(프로필 선택·잠금 해제)을 거치지 않고 `SharedView`만 그린다. 받은 스냅샷은 저장소·캐시에 남기지 않는다.

### 1.3 사용자 결정 (2026-10-29)

6·7번은 이 설계 초안의 질문에 사용자가 추천안을 고른 것이다.

| # | 항목 | 결정 |
|---|---|---|
| 1 | 받은 링크 가져오기 | group·strategy·criteria와 새 종류를 내 앱에 저장한다. 로그인·키 없이도 동작한다. 이름 충돌·종목 한도 같은 경계를 처리한다 |
| 1-1 | 가져오기 동선 | SharedView의 「내 앱에 가져오기」 → 가져올 내용을 탭 저장소(sessionStorage)에 잠깐 두고 앱을 연다 → 평소처럼 관문(프로필 선택·키 잠금 해제·첫 실행이면 데모 포함)을 지난다 → "이 프로필에 저장할까요?" 확인 창 → 저장. 키가 없거나 데모여도 동작한다 |
| 2 | 비교(현재 시세) 화면 공유 | Compare.svelte에 공유 진입점을 둔다. 새 스냅샷 종류(화면 구성: 그룹 종목 + 기간·지표·벤치마크·정렬)다. 받은 사람은 가져와 자기 연결이나 데모로 같은 화면을 본다. 시세가 보이는 화면 캡처를 카카오 카드 이미지로 보낸다 |
| 3 | 시뮬레이션 결과 공유 | 곡선·거래까지 전부 보낸다. 전략 결과(SimResult: equity, summary, trades, perSymbol)와 선정 기준 검증 결과(ValidationResult). 결과 화면에 공유 진입점을 두고, SharedView에서 읽기 전용으로 결과를 보인다 |
| 3-1 | 결과 크기 한도 | 100 KiB를 유지하고 축약한다. 열 형식(날짜 배열 + 값 배열, 수익률 등은 소수 둘째 자리 정도로 반올림)으로 줄이고, 그래도 넘으면 곡선 표본을 결정적으로 솎는다(첫·끝점, 최고·최저 같은 중요한 점 유지, 하한 점 수를 정함). 거래는 빠짐없이 넣고, 그래도 넘으면 '너무 커요' 안내로 거절한다. 서버·D1 변경 없이 `checkShareSnapshot` 공용 검사를 새 종류로 넓힌다 |
| 3-2 | 결과 카드 이미지 | 결과 화면의 수익 곡선 차트를 비교 화면과 같은 캡처 경로로 캡처해 카드 이미지로 쓴다 |
| 4 | 카카오 카드 다듬기 | kakao.ts·shareText.ts. 아이콘 대신 종류별 대표 이미지(비교·결과는 캡처), 종목 수·기간·수익률 같은 요약 문구 |
| 5 | KIS 약관 | 시세가 담긴 캡처·결과를 링크 소지자에게 보내게 된다. 사용자가 KIS 「고객 이용약관」 제5조 ③(시세 제3자 제공 금지) 위반 소지를 안내받고 직접 정했다. 시장 파일 공개 배포 금지 결정은 그대로다(5.1) |
| 6 | 자금 숨김일 때의 결과 금액 | 자금 숨김이면 거래 수량·수수료·세금을 빼고(가격은 남김) 종목별 손익은 자금 대비 %로만 보낸다(2.6) |
| 7 | 검증 결과의 ② 매매 규칙 전략 | 검증 결과 공유에 ② 매매 규칙 전략은 넣지 않는다. ② 곡선·통계는 결과로 보이고, 가져오기 확인 창에서 ②가 없다고 알린다(2.5) |

### 1.4 조율 세션이 정한 기본값

사용자 결정 밖의 세부는 조율 세션이 정했다. 코드를 보고 바꾼 것은 1.5에 적는다.

| 항목 | 기본값 |
|---|---|
| 새 종류 이름 | `compare`, `simResult`, `validation`. `v: 1` 유지 |
| compare 스냅샷 | title, symbols(숨긴 종목 제외, 순서 유지), view {period, metric, benchmark, boardOrder}. colorConvention은 받는 사람 취향이라 넣지 않는다. 금지 키(provider, venueMode, theme, lastGroupId 등)는 키 이름으로도 쓰지 않는다 |
| compare 가져오기 | 새 그룹(10종목 넘으면 자르고 안내) + 「보기 설정도 적용」 체크(기본 켬)로 settings 반영 후 그 그룹을 연 비교 화면으로 이동 |
| simResult 스냅샷 | strategySnapshot 규칙(id='shared', 자금 숨김 선택) + 축약 결과 + 메타(from, to, 시세 출처 라벨, demo 여부, 계산 시각). 원시 candles는 넣지 않는다(거래별 차트 시트 없음). 가져오기는 전략만 저장하고 다시 실행을 안내한다 |
| validation 스냅샷 | criteriaSnapshot 규칙(묶음 b0…) + 축약 검증 결과(곡선들, stats, byMarket, 선정 이력, 오늘 선정, notes). 가져오기는 기준 + 묶음 저장. 묶음 30 한도 확인 |
| 자금 숨김 | 결과의 원 단위 금액은 자금 규모를 드러내므로 곡선은 수익률(%)로만 담고, 금액·수량은 숨김일 때 빼거나 비율로 바꾼다 |
| 이름 충돌 | 같은 목록에 같은 이름이 있으면 ` 2`, ` 3`…을 붙인다(30자 안에서). 한도(전략 20, 기준 20, 묶음 30)가 차면 확인 창에서 이유를 보이고 저장 단추를 끈다 |
| 캡처 | 새 라이브러리 없이 lightweight-charts `chart.takeScreenshot()`으로 차트 canvas를 받고 글자를 직접 그려 합성한다. 업로드는 Kakao SDK `Kakao.Share.uploadImage`를 앱 쪽 kakao.ts에서 부른다. 미리 보기는 data: URL. 「화면 캡처 함께 보내기」(기본 켬). 업로드는 링크를 만든 뒤 미리 끝내 두고, 실패하면 종류별 고정 이미지로 돌아간다 |
| 고정 이미지 | public/ 아래 종류별 PNG, 새 의존성 없이 만든다 |
| 정리 | KIND 표시 맵 4곳을 한 곳으로 모은다. 'too-large' 오류 문구를 공유용으로 분리한다 |
| 테스트 | 스냅샷 검사 단위 테스트, 가져오기 계획 함수 단위 테스트, SharedView 컴포넌트 테스트, sync-worker shares 테스트, e2e |

### 1.5 설계에서 바꾼 것
1. **compare 종목 수는 1~10개로 검사한다.** 그룹 한 개의 종목 한도가 10(`MAX_ITEMS`)이라 비교 화면에서 나오는 스냅샷은 10개를 넘을 수 없다. 그래서 compare 가져오기에서는 자를 일이 없다. "10개 넘으면 자르고 안내"는 종목을 50개까지 허용하는 **group** 가져오기에 적용한다.
2. **simResult의 전략은 실행한 작업본(`DoneMeta.strategy`)으로 만든다.** 종목은 지금 관심목록이 아니라 **실행에 쓴 종목**(`perSymbol` 순서)으로 푼다. 실행 뒤 규칙을 고쳤거나(이전 결과) 그룹 종목이 바뀌어도 결과와 규칙이 맞는다.
3. **validation의 기준도 실행할 때의 것으로 만든다.** 지금 `Simulate.svelte`의 `runSnap`은 이름·자본·흐름 값만 둔다. 여기에 실행한 기준·묶음·전략 사본을 더해 공유 스냅샷을 만든다.
4. **곡선은 자금 숨김과 상관없이 늘 수익률(%)로 담는다.** 화면(EquityChart)도 수익률로 그리므로 잃는 것이 없고, 원 단위보다 짧다. `equity[].cash`는 화면에 쓰지 않아 뺀다(요약의 `avgCashPct`는 남는다).
5. **건너뛴 신호 목록은 들어가면 넣고, 넘치면 이유별 개수만 남긴다.** 사용자 결정의 "빠짐없이"는 거래에 대한 것이다. 건너뜀은 결과 화면의 셋째 탭이라 함께 보내되, 곡선을 솎기 전에 먼저 줄인다(3.4).
6. **검증의 선정 이력은 전부 · 계산값 뺌 · 코드만의 세 수준으로 줄인다.** 조건 계산값을 먼저, 그다음 종목별 수익률을 뺀다(3.4). 검증 결과에는 "빠짐없이" 결정이 없고, 월간·상위 30·10년이면 이력만으로 100 KiB를 넘기 때문이다.
7. **가져오기 대기 값은 30분 뒤 버리고, 읽을 때 다시 검사한다.** sessionStorage는 같은 탭의 다른 스크립트·확장도 쓸 수 있는 곳이라 믿지 않는다.
8. **보내지 않은 캡처는 카카오 서버에서 지운다.** SDK에 `Kakao.Share.deleteImage`가 있다. 대화 상자를 닫을 때 카카오톡으로 보내지 않았으면 지우기를 요청한다(실패는 무시).
9. **고정 이미지는 800×400(2:1)으로 만든다.** 캡처 카드와 같은 비율이라 카카오 카드 모양이 종류마다 흔들리지 않는다.
10. **e2e는 두 갈래로 나눈다.** 가져오기 흐름은 지금 빌드에 sessionStorage 값을 심어 검사한다. SharedView 렌더는 동기화 설정을 넣은 별도 빌드로 검사한다(6.5).

### 1.6 범위 밖
- 받은 결과의 저장. 결과는 SharedView에서만 보이고, 가져오면 규칙만 저장한다.
- SharedView 안의 거래별 차트 시트(원시 일봉을 보내지 않는다).
- 받은 비교 화면을 가져오기 전에 그 자리에서 시세로 보여 주기.
- 캡처 이미지를 스냅샷이나 D1에 넣기. 캡처는 카카오 서버로만 간다.
- 로그인한 초대 대상 공유, 공동 편집, 공유 목록 공개.
- 서버 변경(D1 스키마, 한도, 엔드포인트). `checkShareSnapshot`의 종류만 넓힌다.
- 토스 공급자 시세의 제3자 제공 조건 검토(5.1에 확인 필요로 남긴다).
- 내 성과(`#/performance`) 공유. 계좌 데이터라 금지 키(`orders`, `holdings`, `performance`)가 막는다.

## 2. 데이터

### 2.1 종류와 표시 이름
`src/lib/share/kinds.ts`를 새로 두고 ShareDialog·kakao·SharedView·SyncManage의 KIND 맵 네 벌을 이것으로 바꾼다.

```ts
export const SHARE_KINDS = ['group', 'strategy', 'criteria', 'compare', 'simResult', 'validation'] as const;
export type ShareKind = (typeof SHARE_KINDS)[number];
export const SHARE_KIND_LABEL: Record<ShareKind, string> = {
  group: '그룹',
  strategy: '전략',
  criteria: '선정 기준',
  compare: '비교 화면',
  simResult: '시뮬레이션 결과',
  validation: '검증 결과',
};
/** 모르는 종류(새 버전 앱이 만든 공유)도 화면이 깨지지 않게 */
export const kindLabel = (k: string): string => (SHARE_KINDS as readonly string[]).includes(k) ? SHARE_KIND_LABEL[k as ShareKind] : '공유';
```

`snapshot.ts`의 `ShareKind`는 이 파일을 다시 내보내고, `ShareSnapshot` 합집합에 `CompareSnapshot | SimResultSnapshot | ValidationSnapshot`을 더한다. Worker도 같은 파일을 쓴다(DOM 의존 없음).

### 2.2 공통 형식

```ts
/** 공유 날짜 축. offsets는 start(KST YYYY-MM-DD)로부터 지난 달력 일수. offsets[0] = 0, 엄격히 오름차순 */
export interface ShareAxis {
  start: string;
  offsets: number[];
}
/** 곡선을 솎았으면 솎기 전 점 수. 솎지 않았으면 null */
export type ShareSampled = { from: number } | null;

/** 결과를 만든 실행. 받은 화면 머리줄(기간 · 시세 출처 · 받은 시각 · 데모 배지)에 쓴다 */
export interface ShareRun {
  /** 실제 계산 축의 첫날·마지막 날(KST YYYY-MM-DD) */
  from: string;
  to: string;
  /** 시세 출처 라벨. 시뮬레이션은 DoneMeta.venueLabel, 검증은 '시장 데이터 파일'. 30자 이내 */
  source: string;
  demo: boolean;
  /** 시세를 받은 시각(검증은 시장 파일 수집 시각), epoch ms */
  fetchedAt: number;
}
```

- 날짜를 문자열 배열 대신 일수로 담는다. 3년 일봉에서 축이 9.5 KB에서 2.9 KB로 준다.
- 반올림 규칙: 수익률·%·%p·통계는 소수 둘째 자리(`Math.round(x * 100) / 100`). 원 단위 금액·가격·수수료·세금은 정수. 선정 이력의 조건 계산값은 유효숫자 4자리(`Number(x.toPrecision(4))`). 정수 필드(횟수·일수)는 그대로 둔다.
- 반올림 결과가 `-0`이면 `0`으로 쓴다(JSON에서 같아지지만 검사의 동일성 비교를 단순하게 한다).
- **새 키 이름은 금지 키와 겹치지 않는다.** 특히 `orders`·`holdings`·`performance`·`theme`·`provider`·`token`을 쓰지 않는다. 테스트가 새 타입의 모든 키를 `FORBIDDEN_KEYS`와 대조한다(6.1).

### 2.3 compare

```ts
export interface CompareSnapshot {
  kind: 'compare';
  v: 1;
  title: string;
  /** 보이는 종목만, 그룹 순서. 1~10개(MAX_ITEMS) */
  symbols: string[];
  view: {
    period: Settings['period'];
    metric: Settings['metric'];
    benchmark: Settings['benchmark'];
    boardOrder: Settings['boardOrder'];
  };
}
export function compareSnapshot(g: Group, s: Settings): CompareSnapshot;
```

- 제목은 그룹 이름(`shareTitle`)이다.
- **시세 값은 넣지 않는다.** 받은 사람이 자기 연결이나 데모로 다시 받는다. 보낸 순간의 시세는 카드 캡처(4.3)에만 있다.
- `view`의 각 값은 동기화 DTO의 `SETTING_OK`(`src/lib/sync/dto.ts`)로 검사한다. 이 표를 내보내 같이 쓴다.
- 지금 화면이 고를 수 없는 지표를 등락률로 대신 보여 주는 중이어도(`fallbackNote`) 스냅샷에는 사용자가 고른 `app.settings.metric`을 넣는다. 받은 사람 환경에서는 고를 수 있을 수 있다.

### 2.4 simResult

```ts
export interface SimResultSnapshot {
  kind: 'simResult';
  v: 1;
  title: string;
  /** strategySnapshot 규칙: id 'shared', name = title, updatedAt 0. universe는 실행에 쓴 종목(perSymbol 순서) */
  strategy: Strategy;
  /** true면 strategy.capital.initial은 기본값이고, 결과의 원 단위 금액·수량은 들어 있지 않다 */
  capitalHidden: boolean;
  run: ShareRun;
  result: SharedSimResult;
}

export interface SharedSimResult {
  axis: ShareAxis;
  sampled: ShareSampled;
  /** 초기 자금 대비 수익률(%). 길이는 axis.offsets와 같다. 지수·지정 종목이 없으면 null, 그날 값이 없으면 원소가 null */
  curves: {
    strategy: number[];
    hold: number[];
    index: (number | null)[] | null;
    benchmark: (number | null)[] | null;
  };
  /** 반올림만 한 원본 요약·비교 값(곡선을 솎아도 이 값은 전체 기간으로 계산한 것이다) */
  summary: SimResult['summary'];
  benchmarks: SimResult['benchmarks'];
  indexFailed: null | '받지 못했어요' | '기간 일부만 받았어요';
  benchmarkFailed: boolean;
  /** 거래·종목별·건너뜀 행의 종목 위치가 가리키는 코드. strategy.universe.symbols와 같다 */
  symbols: string[];
  trades: SharedTrade[];
  perSymbol: SharedPerSymbol[];
  skipped: {
    /** 이유별 개수(늘 있다). SKIP_REASONS 순서 */
    counts: [reason: Skip['reason'], n: number][];
    /** 목록. 크기를 줄일 때 null이 된다(3.4) */
    rows: [day: number, symbol: number, reason: number][] | null;
  };
  nearMiss: SimResult['nearMiss'];
  /** 받지 못한 종목(종목별 탭 안내) */
  failed: { symbol: string; reason: SimFailureReason }[];
}

/**
 * 거래 한 줄. day는 axis.start로부터의 달력 일수, symbol은 symbols의 위치.
 * 자금 숨김이면 qty·fee·tax는 null(가격은 시세라 남긴다). 매수 줄의 pattern은 거래 차트 시트에만 쓰여 뺀다.
 */
export type SharedTrade = [
  day: number,
  symbol: number,
  kind: Trade['kind'],
  stage: number | null,
  price: number,
  qty: number | null,
  fee: number | null,
  tax: number | null,
  reason: string,
  pnlPct: number | null,
];

/** pnl은 원(자금 숨김이면 null), pnlPct는 초기 자금 대비 %(늘 있다). firstDay는 axis 기준 일수 */
export type SharedPerSymbol = [symbol: number, pnl: number | null, pnlPct: number, roundTrips: number, firstDay: number | null];
```

- 거래를 객체 대신 튜플로 담는다. 300건 기준 거래 하나가 약 230 B에서 약 57 B로 준다(3.5).
- 종목 이름은 넣지 않는다. 지금처럼 보는 쪽이 앱 종목 목록(universe.json)으로 붙인다.
- `SKIP_REASONS`는 `Skip['reason']` 네 값을 고정 순서로 둔 배열이다(`src/lib/sim/types.ts`에 둔다).
- 매수 신호 이유 문자열(`reason`)은 40자 이내로 검사한다. 지금 만드는 문구는 모두 그 안이다.

### 2.5 validation

```ts
export interface ValidationSnapshot {
  kind: 'validation';
  v: 1;
  title: string;
  /** criteriaSnapshot 규칙(묶음 b0…, 반등 패턴 직접 정함, trading.strategyId null). 실행할 때의 기준이다 */
  criteria: SelectionCriteria;
  baskets: { id: string; name: string; symbols: string[] }[];
  capitalHidden: boolean;
  run: ShareRun;
  result: SharedValidation;
}

/** 소수 둘째 자리 */
export interface SharedStats {
  totalPct: number;
  cagrPct: number;
  mddPct: number;
  volPct: number;
}

export interface SharedValidation {
  axis: ShareAxis;
  sampled: ShareSampled;
  /** 곡선은 시작 자본 대비 수익률(%). 길이는 axis.offsets와 같다 */
  hold: { curve: number[]; stats: SharedStats; beat: { beat: number; total: number } | null };
  trading: { curve: number[]; stats: SharedStats; trades: number; skipCounts: [reason: Skip['reason'], n: number][] } | null;
  indices: { id: Market; curve: number[] | null; reason: MissingReason | null; stats: SharedStats | null }[];
  benchmarks: { symbol: string; name: string; curve: number[] | null; reason: MissingReason | null; stats: SharedStats | null }[];
  byMarket: { key: ByMarketKey; inPool: boolean; stats: SharedStats; avgPicked: number }[];
  /** 선정 이력을 얼마나 담았나: 전부 / 조건 계산값 뺌 / 종목 코드만 */
  history: 'full' | 'noValues' | 'codes';
  /** ValuePairs의 키 위치가 가리키는 이름(선정 이력·오늘 선정 공용) */
  valueKeys: string[];
  rebalances: SharedRebalance[];
  /** 오늘 기준 선별은 늘 조건 계산값까지 담는다(많아야 30종목) */
  today: { date: string; passed: number; picks: { symbol: string; values: ValuePairs }[] };
  notes: ValidationNote[];
}

/** [키 위치, 값, 키 위치, 값, …]. 키가 없는 값은 쌍을 두지 않는다(`k in values` 판단이 그대로 맞는다) */
export type ValuePairs = (number | boolean | null)[];

export interface SharedRebalance {
  /** 재선정일, axis.start로부터의 일수 */
  day: number;
  /** 그 구간의 끝(HoldSegment.to), 같은 기준의 일수 */
  to: number;
  passed: number;
  /** history가 'codes'면 종목 코드 배열, 아니면 SharedPick 배열 */
  picks: SharedPick[] | string[];
}

/**
 * 선정 종목 한 줄. retPct는 그 구간 수익률(%).
 * mark: 0 표시 없음, 1 마지막 종가에 판 것으로 셈(soldAtLastClose), 문자열이면 사지 못한 이유(notBought).
 * values는 history가 'noValues'면 null
 */
export type SharedPick = [symbol: string, retPct: number | null, mark: 0 | 1 | NotBoughtReason, values: ValuePairs | null];
```

- 검증 화면의 흐름 기간·수급 주체·재무 지표 표시(`macro`, `FlowRunSnap`, `FinRunSnap`)는 스냅샷의 기준에서 다시 만든다(`usesMacro`, `flowRunSnap`, `finRunSnap`). 기준이 실행할 때의 것이라 값이 같다.
- 지정 ETF의 `name`은 시세가 아닌 공개 종목명이라 그대로 둔다. 30자 이내로 검사한다.
- `today.date`는 축 밖(마지막 거래일 다음 날)일 수 있어 문자열로 둔다.
- **② 매매 규칙의 전략은 넣지 않는다.** 기준의 `trading.strategyId`는 지금 규칙대로 null이다. 결과의 ② 곡선·통계는 결과로서 보인다. 가져온 기준에는 ②가 없다는 것을 확인 창에서 알린다(사용자 결정 7).

### 2.6 자금 숨김
「가상 초기 자금 빼기」(기본 켬)가 켜져 있을 때의 처리다(사용자 결정 6).

| 값 | 숨김 꺼짐 | 숨김 켬 |
|---|---|---|
| 곡선 | 수익률(%) | 수익률(%) |
| 요약·통계 | 그대로(모두 %·횟수) | 그대로 |
| 거래 가격 | 원 | 원(시세라 남긴다) |
| 거래 수량·수수료·세금 | 원·주 | null |
| 종목별 손익 | 원 + 자금 대비 % | 자금 대비 %만 |
| 전략·기준의 초기 자금 | 원래 값 | 기본값(기존 규칙) |
| 검증 선정 이력의 계산값(시가총액·거래대금 등) | 그대로 | 그대로(시장 값이라 자금과 무관) |

받은 화면은 숨김일 때 거래 줄을 `58,300원`처럼 가격만, 종목별 탭을 `자금 대비 +3.21%`로 보인다. 금액이 없다는 것을 `초기 자금 비공개` 배지로 알린다.

### 2.7 검사 (`checkShareSnapshot` 확장)
- 기존 순서(금지 키 → 크기 → UUID → kind·v·title)는 그대로다. 그 뒤 `switch`에 세 종류를 더한다.
- 전략·기준 부분은 지금 `strategy`·`criteria` 분기의 본문을 `checkStrategyPart(raw, title, now)`·`checkCriteriaPart(raw, title, now)`로 떼어 함께 쓴다.
- 결과 부분은 새 파일 `src/lib/share/checkResult.ts`가 맡는다. 원칙은 기존과 같다. 모르는 필드는 `unknown-field`, 모양·값이 틀리면 `invalid`, 가리키는 곳이 없으면 `reference`로 거절하고 고쳐 받지 않는다.
  - 축: `start`가 유효한 날짜, `offsets[0] === 0`, 엄격히 오름차순 정수, 길이 1~3,700(10년 일봉 여유).
  - 곡선: 길이가 축과 같고, 유한수(또는 허용된 곳만 null), 소수 둘째 자리 이하.
  - 튜플: 길이 정확, 종목 위치는 `symbols` 범위 안 정수, `kind`·이유·mark는 열거값, 일수는 축 범위 안.
  - `sampled`가 null이 아니면 `from > offsets.length`.
  - `run.from`·`run.to`는 축의 첫날·마지막 날과 같다. `source`는 1~30자, `fetchedAt`은 양의 정수.
  - simResult의 `symbols`는 `strategy.universe.symbols`와 같아야 한다. `capitalHidden`이면 거래의 qty·fee·tax와 종목별 pnl이 모두 null이어야 하고, 아니면 모두 숫자여야 한다.
  - validation의 `history`와 `picks` 모양이 맞아야 하고, `ValuePairs`의 키 위치는 `valueKeys` 범위 안, `valueKeys`는 서로 다르고 각각 40자 이내다.
- Worker 번들은 이 검사 코드만큼 커진다. 계산 코드(`simulate`, `runValidation`)는 끌어오지 않는다.

## 3. 축약과 크기

### 3.1 만들기 결과
결과 스냅샷은 크기 때문에 만들지 못할 수 있다. 만들기 함수는 결과를 값으로 돌려준다.

```ts
export type ShareReduction = 'skipped-counts' | 'no-values' | 'codes-only' | 'thinned';
export type ShareBuild<S extends ShareSnapshot = ShareSnapshot> =
  | { ok: true; snapshot: S; reduced: ShareReduction[] }
  | { ok: false; code: 'too-large'; bytes: number };

export function simResultSnapshot(done: DoneState, opts: { hideCapital: boolean; now?: number }): ShareBuild<SimResultSnapshot>;
export function validationSnapshot(
  run: { result: ValidationResult; criteria: SelectionCriteria; baskets: Basket[]; strategies: Strategy[]; collectedAt: string; demo: boolean },
  opts: { hideCapital: boolean; now?: number },
): ShareBuild<ValidationSnapshot>;
```

그룹·전략·기준·compare 만들기는 늘 `ok: true`, `reduced: []`로 감싼다.

### 3.2 크기 재기
`jsonBytes(snapshot) <= SHARE_MAX_BYTES`(100 × 1024)로 잰다. Worker 검사와 같은 함수다. `POST /v1/shares`의 본문 상한(110 KiB)은 스냅샷 밖의 필드(`sourceProfileId`, `kind`, `ttlDays`)를 넉넉히 덮는다.

### 3.3 솎기 알고리즘
곡선 여러 개가 축 하나를 함께 쓰므로 **남길 날의 위치를 한 번 정해 모든 곡선에 같이 적용한다.**

```ts
/** n개 중 남길 위치(오름차순). m은 고르게 남길 점 수, keep은 반드시 남길 위치 */
export function thinIndices(n: number, m: number, keep: readonly number[]): number[] {
  if (n <= m) return [...Array(n).keys()];
  const s = new Set<number>([0, n - 1]);
  for (const k of keep) if (Number.isInteger(k) && k >= 0 && k < n) s.add(k);
  for (let i = 0; i < m; i++) s.add(Math.round((i * (n - 1)) / (m - 1)));
  return [...s].sort((a, b) => a - b);
}
```

- `keep`에 넣는 점
  - 곡선마다 최고점·최저점 위치(null은 건너뛰고, 같으면 처음 나온 위치)
  - 주 곡선(시뮬레이션은 `strategy`, 검증은 `hold`)의 최대 낙폭 시작점(직전 고점)과 바닥
  - 검증은 재선정일 위치(차트의 세로 눈금이 곡선 점과 맞게)
- 같은 입력이면 늘 같은 결과다(난수·시각을 쓰지 않는다). 남는 점 수는 `m + keep 수` 이하다.
- `m`은 500 → 250 → 120 순서로 줄인다. **하한은 120점**이다. 3년 일봉이면 대략 9 거래일에 한 점이고, 최고·최저·낙폭 점은 늘 남는다.
- 요약 카드·통계는 전체 데이터로 계산한 원래 값이다. 솎은 곡선에서 다시 계산하지 않는다. 받은 화면은 `sampled`가 있으면 차트 아래에 `곡선은 {from}점 중 {n}점으로 줄였어요 · 수치는 전체 기간 기준이에요`를 적는다.

### 3.4 줄이는 순서
각 단계 뒤 크기를 다시 잰다. 들어가면 멈추고, 마지막 단계 뒤에도 넘으면 거절한다.

| 단계 | 시뮬레이션 결과 | 검증 결과 |
|---|---|---|
| 1 | 열 형식 + 반올림(늘 한다) | 열 형식 + 반올림(늘 한다) |
| 2 | 건너뛴 신호 목록 → 이유별 개수만(`skipped-counts`) | 선정 이력의 조건 계산값 빼기(`no-values`) |
| 3 | 곡선 솎기 500 → 250 → 120(`thinned`) | 곡선 솎기 500 → 250 → 120(`thinned`) |
| 4 | **거절**. 거래는 빼지 않는다 | 선정 이력을 종목 코드만(`codes-only`) |
| 5 | — | 거절 |

공유 대화 상자는 `reduced`를 한 줄씩 알린다(`건너뛴 신호는 이유별 개수만 보내요` 등). 거절이면 미리 보기 대신 `결과가 너무 커서 공유할 수 없어요(약 {KB} KB, 한도 100 KB). 기간이나 종목을 줄여 다시 실행해 주세요`를 보이고 링크 만들기 단추를 끈다.

### 3.5 크기 예산
아래 숫자는 지금 타입 모양대로 만든 가짜 값을 `JSON.stringify` 바이트로 잰 것이다(2026-10-29, 조사용 스크립트). 실제 값은 숫자 자릿수와 이유 문구 길이에 따라 달라진다. 구현 때 같은 조건의 고정 데이터로 테스트에 넣는다(6.1).

**시뮬레이션: 3년 일봉(735 거래일), 8종목, 거래 300건, 건너뜀 300건, 지수·지정 종목 곡선 포함**

| 부분 | 원형 그대로 | 축약 후 |
|---|---|---|
| 곡선(equity) | 94.8 KB(행당 약 129 B) | 축 2.9 KB + 곡선 4개 16.4 KB |
| 거래 300건 | 약 69 KB(건당 약 230 B) | 17.2 KB(건당 약 57 B) |
| 건너뜀 300건 | 약 21 KB | 3.0 KB |
| 전략·요약·비교·메타·종목별 | 약 2 KB | 약 1.7 KB |
| **합계** | **약 187 KB(거절됨)** | **약 41 KB** |

- 위 표는 자금 숨김을 끈 경우다. 숨김이면 거래의 qty·fee·tax가 `null`(4 B)이 되고 종목별 pnl도 `null`이라 크기는 같거나 조금 작다.
- 거래 1,000건이면 약 81 KB로 1단계에서 들어간다.
- 곡선을 120점으로 솎으면 축+곡선이 3.2 KB다. 나머지 고정분을 약 5 KB로 보면 거래는 **약 1,700건**까지 들어간다. 그 이상은 거절한다.

**검증: 3년 월간(재선정 36번), 상위 10개, 조건 계산값 8개, 곡선 4개(①·②·KOSPI·KODEX 200)**

| 부분 | 원형 그대로 | 축약 후 |
|---|---|---|
| 곡선 | 135 KB(CurvePoint 735점 33.8 KB × 4) | 축 2.9 KB + 곡선 4개 16.7 KB |
| 선정 이력 360줄(구간 수익률 포함) | 약 85 KB | 계산값 포함 38.4 KB, 계산값 빼면 11.0 KB |
| 기준·묶음 | 약 3 KB | 약 3 KB(300종목 묶음 하나마다 +2.7 KB) |
| 오늘 선정·통계·시장별·notes | 약 3 KB | 약 2 KB |
| **합계** | **약 226 KB(거절됨)** | **약 63 KB** |

- 월간·상위 30·3년은 계산값 포함 약 140 KB라 2단계(계산값 빼기)에서 약 58 KB가 된다.
- 월간·상위 30·10년은 계산값을 빼도 이력만 약 110 KB라, 3단계(120점 솎기)를 지나 4단계(코드만, 한 종목 약 10 B)에서 약 50 KB가 된다.

## 4. 동작

### 4.1 공유 요청 모양
`shareStore.svelte.ts`의 요청을 넓힌다.

```ts
export interface ShareRequest {
  kind: ShareKind;
  name: string;
  profileId: string;
  /** 가상 자금 빼기 여부를 받아 보낼 스냅샷을 만든다(group·compare는 무시) */
  build(hideCapital: boolean): ShareBuild;
  /** 비교·결과 화면: 지금 보이는 차트로 카드 이미지를 만든다. 차트가 그려져 있지 않으면 null */
  capture?: () => CardCapture | null;
}

export interface CardCapture {
  /** 합성한 카드(1600×800, 표시 800×400) */
  canvas: HTMLCanvasElement;
  /** 미리 보기 대체 글 */
  alt: string;
  /** 카카오 카드 설명 둘째 줄 후보(예: 상위 종목 값과 기준 시각) */
  line: string | null;
}
```

진입점은 다음과 같다. 모두 지금처럼 `canShare()`일 때만 단추를 보인다.

| 화면 | 위치 | 조건 |
|---|---|---|
| 비교 | 머리줄 오른쪽(그룹 탭 줄 끝)의 `공유` 단추 | 그룹이 있고 보이는 종목이 1개 이상 |
| 시뮬레이션 결과 | `ResultView` 머리줄 오른쪽 `결과 공유` | 결과가 있을 때(거래 0건이어도 된다) |
| 검증 결과 | `검증 결과` 제목 줄의 `결과 공유` | `vctl.state === 'done'` |

### 4.2 공유 대화 상자 (ShareDialog)
- 제목은 `${kindLabel(kind)} 공유`다.
- 열 때 `build(hideCapital)`을 부른다. `ok: false`면 3.4의 거절 문구를 보인다. `reduced`가 있으면 미리 보기 위에 한 줄씩 알린다.
- 「가상 초기 자금 빼기」는 strategy·criteria·simResult·validation에 보인다. 결과 종류에서는 문구를 `가상 초기 자금과 금액·수량 빼기`로 바꾼다.
- 미리 보기 줄(`snapshotLines`)은 결과 종류에서 요약만 보인다(4.5). 「보낼 원문 보기」는 그대로 둔다. 결과는 원문이 길어 `<pre>`의 높이 제한(240px)과 스크롤을 그대로 쓴다.
- 카카오 키가 있고 `capture`가 있으면 열 때 한 번 캡처한다(보이는 화면 그대로). `canvas.toDataURL('image/jpeg', 0.85)`를 `<img>`로 미리 보인다. CSP `img-src 'self' data:` 안이다. 그 아래에 다음을 둔다.
  - 체크 「화면 캡처 함께 보내기」(기본 켬)
  - 안내 `카카오톡 카드에 넣으려고 이 캡처를 카카오 서버에 올려요. 링크를 철회해도 카카오톡으로 보낸 캡처는 지울 수 없어요.`
- 링크 만들기 뒤 순서(카카오 단추 상태: `off` → `loading` → `uploading` → `ready`)
  1. 링크가 생기면 지금처럼 `preloadKakao`.
  2. 준비되고 캡처가 켜져 있으면 `cardFile(canvas)`로 파일을 만들어 `uploadCardImage(file)`. 단추 글은 `캡처 올리는 중…`이다.
  3. 성공하면 받은 이미지 주소를 카드에 쓴다. 실패하면 고정 이미지로 돌아가고 `캡처를 올리지 못해 기본 그림으로 보내요`를 적는다. 어느 쪽이든 `ready`가 된다.
  4. 단추를 누르면 클릭 안에서 기다림 없이 `sendKakao`를 부른다(지금 규칙, PC 팝업 차단 방지).
- 업로드 뒤에 캡처 체크를 끄면 그 이미지를 지우고 고정 이미지를 쓴다.
- 대화 상자를 닫을 때 올린 이미지가 있고 카카오톡 단추를 누르지 않았으면 `deleteCardImage`를 부른다. 눌렀으면 메시지가 그 이미지를 가리키므로 지우지 않는다.
- 다른 요청으로 바뀌면 지금의 `attempt` 규칙대로 늦게 온 업로드 응답을 버린다(버린 응답의 이미지도 지운다).

### 4.3 캡처와 카드 합성
새 파일 `src/lib/share/cardImage.ts`가 맡는다. 새 라이브러리를 쓰지 않는다.

```ts
export interface CardText {
  /** 굵은 제목(그룹·전략·기준 이름) */
  title: string;
  /** 기간 · 지표 · 기준 시각 같은 한 줄 */
  subtitle: string;
  /** 오른쪽 값 목록(비교: 상위 5종목, 결과: 총수익률·최대 낙폭·비교 기준) */
  rows: { label: string; value: string; tone: 'up' | 'down' | 'flat' }[];
  /** 아래 줄: 시세 출처(데모면 '데모 데이터') */
  footer: string;
}
export interface CardColors { bg: string; text: string; sub: string; up: string; down: string; accent: string }

/** 차트 canvas와 글을 1600×800 canvas 하나로 합친다 */
export function composeCard(chart: HTMLCanvasElement, text: CardText, colors: CardColors): HTMLCanvasElement;
/** JPEG 0.85로 만들고 5 MB를 넘으면 0.7로 한 번 더. 그래도 넘거나 실패하면 null */
export function cardFile(canvas: HTMLCanvasElement): Promise<File | null>;
/** 지금 테마의 CSS 변수(--bg, --t1, --t2, --up, --down, --accent)를 읽는다. 색 관례(colorConvention)는 보낸 사람 것을 따른다 */
export function readCardColors(el: Element): CardColors;
```

- 차트 canvas는 `chart.takeScreenshot(true, false)`(lightweight-charts 5.2 `IChartApi`, typings 1767행)로 받는다. 위 레이어(세션 띠 등 primitive)는 넣고 십자선은 뺀다.
- `CompareChart.svelte`·`EquityChart.svelte`에 `export function screenshot(): HTMLCanvasElement | null`을 더한다. `ChartPanel`은 이것을 넘긴다. 폰에서 표 보기라 차트가 없으면 null이고, 그때는 캡처 없이 고정 이미지를 쓴다(체크 상자도 숨긴다).
- DOM으로 그린 것(SessionLanes, 직접 라벨, 범례)은 캡처에 들어가지 않는다. 그래서 범례(선 색 + 이름)를 카드 오른쪽 목록에 직접 그린다.
- 배치(표시 800×400 기준): 위 64px 띠에 `가즈아` 글자와 제목·부제, 왼쪽 약 62%에 차트(비율 유지 축소), 오른쪽에 값 목록, 맨 아래 24px에 출처. 글꼴은 `getComputedStyle(document.body).fontFamily`다.
- 비교 카드 값: 리더보드 순서대로 위 5종목의 `이름 값`(지금 지표의 표시 형식 그대로). 부제는 `{기간 이름} · {지표 이름} · {MM.DD HH:mm} 기준`. 출처는 공급자 이름(데모면 `데모 데이터`).
- 결과 카드 값: 총수익률, 최대 낙폭, 같은 종목 보유, 지수. 검증은 ① 선정만, ②(있으면), 첫 지수. 부제는 `{from} ~ {to}`.
- 대체 글(alt): `{제목} {종류} 캡처: {부제}, {값 목록을 쉼표로}`.

### 4.4 카카오 (kakao.ts)
`@sch0718/kakao-share` 0.1.1의 `KakaoSdk` 타입에는 업로드가 없다. SDK 2.8.4에는 `Share.uploadImage({ file })`(`POST https://kapi.kakao.com/v2/api/talk/message/image/upload`, FormData)와 `Share.deleteImage({ imageUrl })`가 있다(2026-10-29, SDK 파일에서 확인). 앱 쪽에서 타입을 넓혀 부른다. 패키지는 바꾸지 않는다.

```ts
export interface KakaoImage { url: string; width: number; height: number }
interface KakaoShareImages {
  uploadImage(o: { file: File[] }): Promise<{ infos: { original: KakaoImage } }>;
  deleteImage(o: { imageUrl: string }): Promise<unknown>;
}
const images = (): Partial<KakaoShareImages> | undefined =>
  (globalThis as { Kakao?: { Share?: Partial<KakaoShareImages> } }).Kakao?.Share;

/** preloadKakao 뒤에 부른다. https 주소이고 200×200 이상일 때만 돌려주고, 아니면 null(카드는 고정 이미지) */
export async function uploadCardImage(file: File): Promise<KakaoImage | null>;
/** 실패는 무시한다 */
export function deleteCardImage(url: string): void;

/** image가 없으면 종류별 고정 이미지(share/<kind>.png, 800×400) */
export function kakaoCard(snapshot: ShareSnapshot, url: string, opts?: { names?: SymbolNames; image?: KakaoImage | null; line?: string | null }): KakaoCard;
```

- 카드 제목은 `${kindLabel} 공유: ${title}`(지금 그대로)다. 설명은 두 줄이다(4.5).
- 고정 이미지 주소는 지금처럼 공유 링크와 같은 출처의 절대 주소(`new URL('share/<kind>.png', url)`)다.
- **CSP:** 업로드는 SDK가 `https://kapi.kakao.com`으로 보내는 요청이라 `connect-src 'self' https:` 안이다. 미리 보기는 data: URL이라 `img-src 'self' data:` 안이다. 업로드된 이미지(카카오 CDN 주소)는 이 앱이 불러오지 않는다. **CSP는 바꾸지 않는다.** 나중에 `connect-src`를 좁히면 `https://kapi.kakao.com`을 넣어야 한다는 주석을 `kakao-csp.config.ts`에 남긴다.
- **번들:** 새 의존성이 없다. 늘어나는 것은 축약·검사·합성·가져오기 코드와 SharedView가 끌어오는 결과 컴포넌트다. 결과 컴포넌트와 lightweight-charts는 이미 같은 번들에 있다(App이 Simulate·Compare를 바로 불러온다). 구현 PR에 `pnpm build` 산출 크기의 전후 차이를 적는다. Worker 번들은 2.7의 검사 코드만큼 커진다.

### 4.5 요약 문구 (shareText.ts)
`snapshotLines`에 새 종류를 더하고, 카카오 설명용 `cardLines(snapshot, names)`(두 줄)를 새로 둔다.

| 종류 | 카카오 설명 1줄 | 2줄 |
|---|---|---|
| group | `종목 N개: 이름, 이름, 이름 외 M개` | — |
| strategy | `종목 N개 · YYYY.MM.DD ~ YYYY.MM.DD` | `하락 20% · 익절 10%/20% · 손절 10%` |
| criteria | `KOSPI·KOSDAQ 상위 10개 · 매월 재선정` | `YYYY.MM.DD ~ YYYY.MM.DD` |
| compare | `종목 N개 · 1개월 등락률` | 캡처의 `line`(예: `삼성전자 +3.2% · SK하이닉스 +2.1% · 10.29 14:32 기준`), 없으면 앞 3종목 이름 |
| simResult | `총수익률 +12.3% · 최대 낙폭 −23.4%` | `종목 8개 · 거래 95번 · YYYY.MM.DD ~ YYYY.MM.DD` |
| validation | `① 선정만 +12.3% · 지수 대비 +4.5%p` | `상위 10개 · 매월 · YYYY.MM ~ YYYY.MM` |

- 수익률 표시는 결과 화면의 `trendReturn`·`trendPp`와 같은 형식이다. 데모면 2줄 끝에 ` · 데모`를 붙인다.
- 미리 보기·읽기 화면의 `snapshotLines`는 결과 종류에서 `제목`, 위 두 줄, `시세 출처: {source} · {fetchedAt} 받음`, `초기 자금: 비공개|금액`을 보인다.

### 4.6 고정 이미지
- 파일: `public/share/{group,strategy,criteria,compare,simResult,validation}.png`, 800×400. PWA 캐시 대상(`**/*.png`)에 저절로 들어간다.
- 만드는 법: 새 스크립트 `scripts/build-share-images.mjs`가 기존 `scripts/motion/kit.mjs`의 `loadTheme`(토큰 CSS)와 `public/icon.svg` 로고로 종류별 SVG를 만들고, 이미 개발 의존성인 `playwright-core`의 Chromium으로 PNG를 찍는다(`page.setContent` → `screenshot`). 결과 PNG를 커밋한다. `build:motion`처럼 손으로 돌리는 스크립트이고 `prebuild`에 넣지 않는다.
- 그림: 라이트 토큰 배경, 왼쪽에 로고, 오른쪽에 종류 이름(`비교 화면` 등)과 종류별 단순 도형(선 3개·막대·체크 목록). 숫자는 넣지 않는다.
- `package.json`에 `"build:share-images": "node scripts/build-share-images.mjs"`를 더한다.

### 4.7 받은 화면 (SharedView)
- 상태에 `unsupported`를 더한다. 받은 `kind`를 모르거나 클라이언트 검사(`checkShareSnapshot`)에 실패하면 `이 공유는 새 버전 앱에서 볼 수 있어요. 앱을 새로 고쳐 주세요.`를 보인다. 서버는 읽을 때 다시 검사하지 않으므로 받은 쪽에서 한 번 검사한다.
- 머리: 배지 `읽기 전용 공유`, 제목, `{kindLabel} · {만료일}까지 볼 수 있어요`. 결과 종류는 그 아래에 `{from} ~ {to} · {source} · {받은 시각}` 줄과 `데모 데이터`·`초기 자금 비공개` 배지.
- 본문
  - group·strategy·criteria: 지금 그대로(요약 줄 + 규칙 전체 보기).
  - compare: 요약 줄(종목·기간·지표·벤치마크·정렬)과 `가져오면 내 연결이나 데모로 같은 화면을 볼 수 있어요`.
  - simResult: `ResultView`를 읽기 전용으로 쓴다. 스냅샷을 `expandSimResult(s): DoneState`로 펼친다. 곡선은 `initial × (1 + pct / 100)`로 되돌리고, `meta.candles`는 빈 객체다. 그 뒤에 규칙 전체 보기.
  - validation: `ValidationResult`를 읽기 전용으로 쓴다. `expandValidation(s): ValidationResult`로 펼친다(곡선 값 = `capital × (1 + pct / 100)`, 코드만 이력은 수익률 없이 종목 줄만).
- 기존 컴포넌트에 더하는 것
  - `ResultView`: `readonly?: boolean`(규칙 고치기·거래 차트 시트를 숨기고 거래 줄을 누를 수 없게), `hideAmounts?: boolean`, `skippedCounts?: [reason, n][]`(목록이 없을 때 셋째 탭에 개수만).
  - `TradeList`: `hideQty?: boolean`. `SymbolTab`: `pnlPct?: Record<string, number>`가 있으면 금액 대신 `자금 대비 %`.
  - `ValidationResult`: `app`을 `app: App | null`로, 색 관례를 `colorConvention` prop으로 받는다. `app`이 null이면 `TodayPicks`는 그룹에 넣기 단추 없이 목록만 보인다.
  - `EquityChart`: `sampledNote?: string`을 받아 차트 아래에 적는다.
- 색 관례·테마는 App이 `app.settings`의 값을 넘긴다(보는 사람 취향).
- 맨 아래 주 단추 `내 앱에 가져오기`와 설명 `이 기기의 프로필에 저장해요. 로그인이나 키가 없어도 돼요. 결과는 저장하지 않고 규칙만 가져와요`(결과 종류에서만 둘째 문장). 그 아래 기존 안내 문구.

### 4.8 가져오기
**대기 값 (`src/lib/share/pendingImport.ts`)**

```ts
const KEY = 'gazua:v1:share-import';
const TTL_MS = 30 * 60 * 1000;
export interface PendingImport { snapshot: ShareSnapshot; at: number }
/** sessionStorage에 둔다. 쓰지 못하면 false(그때는 메모리 값으로 같은 탭 안에서만 이어 간다) */
export function stashImport(snapshot: ShareSnapshot, now: number, store?: Storage | null): boolean;
/** 꺼내면서 지운다. 30분이 지났거나 checkShareSnapshot에 실패하면 null */
export function takeImport(now: number, store?: Storage | null): ShareSnapshot | null;
```

- capability·링크 주소·만료일은 넣지 않는다. 스냅샷만 둔다.
- sessionStorage는 탭을 닫으면 사라진다. 새로 고침과 관문(잠금 해제 등)을 지나도 남는다.
- 접근이 막힌 환경(사생활 보호 등)이면 모듈 안 메모리 변수로 대신한다. SharedView → 앱 이동은 같은 페이지 안이라 이어진다.

**흐름**
1. SharedView `내 앱에 가져오기` → `stashImport` → `onexit()`(지금의 `app.navigate({ name: 'compare' })`).
2. 앱의 관문이 그대로 돈다. 프로필이 여럿이면 선택, 잠금이면 잠금 해제, 처음이면 온보딩(데모 포함).
3. App에 새로 두는 `ImportHost`가 경로를 본다. 경로가 일반 화면(`compare`·`simulate`·`performance`·`settings`·`help`)이 되면 `takeImport`로 꺼내고, 종목 목록(`sharedUniverse`)을 받은 뒤(실패하면 null) 계획을 세워 확인 창을 연다.
4. 확인 창(Sheet) 제목 `이 프로필에 저장할까요?`. 본문은 다음과 같다.
   - `「{프로필 이름}」 프로필에 저장해요`
   - 만들 것 목록(`planImport`의 `lines`). 예: `그룹 「반도체 2」 · 종목 10개`, `전략 「눌림목」`, `선정 기준 「대형 우량」 · 묶음 2개`.
   - 이름을 바꾸거나 자른 경우의 안내. 예: `같은 이름이 있어 「반도체 2」로 저장해요`, `상위 10개만 넣었어요`, `종목 목록에 없는 종목 3개는 뺐어요`.
   - compare면 체크 「보기 설정도 적용」(기본 켬)과 바뀌는 값(`기간 1개월 · 지표 등락률 · 벤치마크 자동 · 정렬 값 순`).
   - 자금이 숨겨진 공유면 `초기 자금은 기본값으로 저장해요`.
   - validation이면 `② 매매 규칙은 함께 오지 않아요. 저장한 뒤 매매 규칙을 골라 주세요`. simResult·validation이면 `결과는 저장하지 않아요. 저장한 뒤 실행하면 내 데이터로 다시 계산해요`.
   - 단추 `저장`(주)과 `저장하지 않기`. 막히면 이유를 `role="alert"`로 보이고 `저장`을 끈다. 이때 단추는 `닫기` 하나이고 `목록을 정리한 뒤 공유 링크를 다시 열면 가져올 수 있어요`를 덧붙인다.
5. 저장하면 `applyImport`의 결과를 `app.setWatchlists`·`setBaskets`·`setCriteria`·`setStrategies`·`updateSettings`로 쓴다. 그다음 만든 것으로 이동하고 스낵바 `가져왔어요`를 띄운다.

| 종류 | 만드는 것 | 이동 |
|---|---|---|
| group | 새 그룹(종목 목록에 있는 것만, 앞에서 10개) | 비교 `#/compare/<새 그룹>` |
| compare | 새 그룹 + (체크 시) 보기 설정 4개 | 비교 `#/compare/<새 그룹>` |
| strategy, simResult | 새 전략(종목은 그대로, 새 ID) | `#/simulate/<새 전략>` |
| criteria, validation | 새 묶음들 + 새 기준(`pool.baskets`를 새 묶음 ID로 바꿈) | `#/simulate/criteria/<새 기준>` |

**계획 함수 (`src/lib/share/importPlan.ts`, 순수 함수)**

```ts
export interface ImportState {
  watchlists: Watchlists;
  strategies: Strategy[];
  criteria: SelectionCriteria[];
  baskets: Basket[];
  /** 앱 종목 코드. 받지 못했으면 null(그때는 거르지 않는다) */
  universe: ReadonlySet<string> | null;
}
export interface ImportPlan {
  /** 만들 것 한 줄씩(바뀐 이름으로) */
  lines: string[];
  /** 이름 변경·자르기·뺀 종목 안내 */
  notes: string[];
  /** 저장할 수 없는 이유. 있으면 저장 단추를 끈다 */
  blocked: string | null;
  /** compare만: 적용할 수 있는 보기 설정 */
  view: CompareSnapshot['view'] | null;
}
export interface ImportApplied {
  watchlists?: Watchlists;
  strategies?: Strategy[];
  criteria?: SelectionCriteria[];
  baskets?: Basket[];
  settings?: Partial<Pick<Settings, 'period' | 'metric' | 'benchmark' | 'boardOrder'>>;
  route: Route;
}
export function planImport(s: ShareSnapshot, cur: ImportState): ImportPlan;
/** planImport가 막지 않은 경우에만 부른다. 막힌 계획이면 던진다 */
export function applyImport(s: ShareSnapshot, cur: ImportState, opts: { now: number; applyView: boolean }): ImportApplied;
/** base가 taken에 없으면 그대로, 있으면 ` 2`, ` 3`…을 붙인다. 붙인 결과가 30자(문자 단위)를 넘으면 이름 끝을 잘라 맞춘다 */
export function uniqueName(base: string, taken: ReadonlySet<string>, max?: number): string;
```

- 그룹·compare에서 종목 목록으로 거른 뒤 남는 종목이 없으면 `가져올 수 있는 종목이 없어요`로 막는다.
- 한도 확인: 전략 20(`MAX_STRATEGIES`), 기준 20(`MAX_CRITERIA`), 묶음 30(`MAX_BASKETS`, 지금 개수 + 새 묶음 수). 막힌 이유는 기존 문구(`BASKET_CAP_MESSAGE` 등)를 쓴다.
- 이름 비교는 앞뒤 공백을 뺀 정확한 문자열 비교다. 그룹·전략·기준·묶음 각자의 목록 안에서만 본다. 한 번의 가져오기로 만드는 묶음끼리도 겹치지 않게 차례로 `taken`에 더한다.
- 그룹 이름은 지금 한도가 없지만 같은 30자 규칙을 쓴다(공유 제목이 이미 30자 이내다).
- 새 ID는 기존 생성 함수(`withNewGroup`, `newBasket`, `crypto.randomUUID`)로 만든다. 받은 `shared`·`b0` ID는 남기지 않는다. `updatedAt`은 `now`다.
- 받은 전략·기준은 저장 전에 `sanitizeStrategies`·`sanitizeCriteria`를 한 번 더 지난다. 검사를 통과한 스냅샷이라 바뀌는 것이 없어야 하고, 바뀌면 저장하지 않고 `가져올 수 없는 공유예요`를 보인다.
- 쓰기 순서는 묶음 → 기준이다. 기준 쓰기가 실패하면(한도 오류 등) 방금 더한 묶음을 되돌린다.

### 4.9 화면별 바뀌는 곳
- `Compare.svelte`: 공유 단추, `openShare({ kind: 'compare', build: () => ok(compareSnapshot(group, app.settings)), capture })`. `capture`는 ChartPanel의 `screenshot()` + 리더보드 위 5행 + 기준 시각으로 카드를 합성한다.
- `Simulate.svelte`: `runSnap`에 `criteria`(실행한 기준의 `$state.snapshot`), `baskets`, `strategies`를 더한다. 검증 결과 제목 줄에 `결과 공유`. 시뮬레이션 결과는 `ResultView`에 `onShare?: () => void`를 넘긴다.
- 결과 화면 캡처는 `EquityChart`의 `screenshot()`을 쓴다. `ResultView`·`ValidationResult`가 `bind:this`로 들고 `capture()`를 내보낸다.

### 4.10 파일 목록과 데이터 흐름

**새 파일**

| 파일 | 하는 일 |
|---|---|
| `src/lib/share/kinds.ts` | 종류 목록·표시 이름(2.1) |
| `src/lib/share/compact.ts` | 축·곡선 열 형식, 반올림, `thinIndices`, 줄이는 순서, `simResultSnapshot`·`validationSnapshot`·`compareSnapshot`, `expandSimResult`·`expandValidation` |
| `src/lib/share/checkResult.ts` | 결과 부분 검사(Worker 공용, DOM 없음) |
| `src/lib/share/cardImage.ts` | 카드 합성·파일 만들기·색 읽기(4.3) |
| `src/lib/share/pendingImport.ts` | 가져오기 대기 값(4.8) |
| `src/lib/share/importPlan.ts` | `planImport`·`applyImport`·`uniqueName`(4.8) |
| `src/lib/share/ImportHost.svelte` | 가져오기 확인 창 |
| `src/lib/share/view/SharedSimResult.svelte`, `SharedValidation.svelte` | 받은 결과를 펼쳐 읽기 전용 결과 컴포넌트에 넘김 |
| `scripts/build-share-images.mjs`, `public/share/*.png` | 고정 이미지(4.6) |
| 테스트: `compact.test.ts`, `checkResult.test.ts`, `importPlan.test.ts`, `pendingImport.test.ts`, `cardImage.test.ts`, `ImportHost.test.ts`, `SharedView.test.ts`, `tests/e2e/share.spec.ts` | 6절 |

**바뀌는 파일**

| 파일 | 바뀌는 것 |
|---|---|
| `src/lib/share/snapshot.ts` | 종류·합집합 확장, 검사 분기 3개, 전략·기준 검사 함수 분리 |
| `src/lib/share/shareText.ts` | 새 종류 요약 줄, `cardLines` |
| `src/lib/share/kakao.ts` | 업로드·지우기, 카드 이미지·설명 |
| `src/lib/share/shareStore.svelte.ts` | `build`가 `ShareBuild`를 돌려줌, `capture` |
| `src/lib/share/ShareDialog.svelte` | 거절·줄임 안내, 캡처 미리 보기·체크, 업로드 상태 |
| `src/routes/SharedView.svelte` | 새 종류 본문, `unsupported`, 받은 쪽 검사, 가져오기 단추(`onimport`) |
| `src/App.svelte` | SharedView에 `onimport`·색 관례·테마, `ImportHost` |
| `src/routes/Compare.svelte`, `src/lib/ui/compare/ChartPanel.svelte`, `src/lib/chart/CompareChart.svelte` | 공유 단추, `screenshot()` |
| `src/routes/Simulate.svelte` | `runSnap` 확장, 검증 결과 공유 단추 |
| `src/lib/ui/simulate/ResultView.svelte`, `TradeList.svelte`, `SymbolTab.svelte`, `EquityChart.svelte` | 읽기 전용·금액 숨김·건너뜀 개수·솎기 안내·`screenshot()`·공유 단추 |
| `src/lib/ui/screen/ValidationResult.svelte`, `TodayPicks.svelte` | `app` null, `colorConvention` prop, 캡처 |
| `src/lib/ui/settings/SyncManage.svelte` | 종류 표시를 `kindLabel`로 |
| `src/lib/sync/controller.svelte.ts` | 공유용 `too-large` 문구 |
| `src/lib/sync/dto.ts` | `SETTING_OK` 내보내기 |
| `src/lib/sim/types.ts` | `SKIP_REASONS` |
| `src/lib/chart/lwcStub.ts` | `takeScreenshot` 가짜 |
| `kakao-csp.config.ts` | `connect-src`를 좁힐 때의 주석 |
| `sync-worker/src/shares.test.ts` | 새 종류 |
| `playwright.config.ts`, `.gitignore`, `docs/development.md`, `docs/live-check.md`, `package.json` | e2e 두 번째 서버, 스크립트, 점검 항목 |

**데이터 흐름**

```
보내기
  화면(Compare / ResultView / ValidationResult)
    └ openShare({ kind, build, capture })
        └ ShareDialog: build(hideCapital) ─ compact.ts(열 형식 → 줄이기) ─ ShareBuild
                       capture() ─ cardImage.ts(takeScreenshot + 글) ─ 미리 보기(data: URL)
            └ 링크 만들기: sync.createShare ─ POST /v1/shares ─ checkShareSnapshot(Worker) ─ D1
            └ 카카오: preloadKakao → uploadCardImage(kapi.kakao.com) → 클릭 안 sendKakao

받기
  #/s/<capability> ─ GET /v1/public/share ─ SharedView
    └ checkShareSnapshot(받은 쪽) → 종류별 본문(expand* → 읽기 전용 결과 컴포넌트)
    └ 내 앱에 가져오기 ─ stashImport(sessionStorage) ─ app.navigate(compare)
        └ 관문(프로필 · 잠금 해제 · 온보딩)
        └ ImportHost: takeImport → planImport → 확인 창 → applyImport → app.set* → 이동
```

## 5. 보안·약관

### 5.1 KIS 약관
- 원문: KIS Developers 공개 API `https://apiportal.koreainvestment.com/api/terms/public?termsType=MARKET`, 이름 「고객 이용약관」, version 28, 최종 수정 2024-04-11, 부칙 "본 약관은 2022년 10월 1일부터 시행한다"(2026-10-29 확인).
- 제5조 ③은 회사가 제공하는 시세(국내주식·해외주식·국내선물/옵션 등) 정보를 고객이 직접 개발한 프로그램 등 개인의 업무에만 쓰게 하고, "제3자에게 제공해서는 아니 된다"고 정한다.
- 이번 확장으로 시세가 담긴 것이 링크 소지자에게 간다.
  - 비교 화면 캡처(카카오 서버에 올라가고 카카오톡 메시지에 남는다)
  - 시뮬레이션 결과의 곡선·거래 가격(KIS로 받은 일봉에서 계산)
  - 검증 결과의 곡선·조건 계산값(KIS로 수집한 시장 데이터 파일에서 계산)
- **사용자가 제5조 ③ 위반 소지를 안내받고 이 공유를 직접 정했다(사용자 결정, 2026-10-29).** 이 설계는 그 결정을 따른다.
- 그대로인 결정: **시장 데이터 파일은 공개 배포하지 않는다**(사용자 결정, 2026-10-29). 결과 스냅샷에 원시 일봉·시장 파일 내용을 넣지 않는 것도 이 경계를 지키는 장치다.
- 토스 공급자로 받은 시세의 제3자 제공 조건은 이번에 확인하지 않았다. **확인 필요**로 남긴다.
- 데모 데이터는 지어낸 값이라 약관과 무관하다. 카드·받은 화면에 `데모 데이터`를 늘 표시한다.

### 5.2 스냅샷 경계
- 기존 경계를 그대로 지킨다. 원본 ID·프로필 이름·키·계좌·프록시 주소·최근 그룹은 넣지 않는다. 검사가 금지 키·UUID 모양을 막는다.
- 결과 스냅샷에 계좌 데이터는 없다. 시뮬레이션·검증은 가상 매매다.
- 자금 숨김은 2.6대로 금액·수량을 모두 뺀다. 테스트가 숨김 스냅샷 JSON에 원래 초기 자금 숫자가 없음을 확인한다.

### 5.3 카카오 업로드
- 캡처는 사용자가 「화면 캡처 함께 보내기」를 켜 둔 때만, 링크를 만든 뒤에만 올린다. 링크 복사만 하고 닫으면 지우기를 요청한다(4.2).
- 카카오에 올린 이미지의 보관 기간·삭제 보장은 이 앱이 정하지 못한다. 보관 기간은 카카오 문서에서 **확인 필요**다. 대화 상자 문구로 철회해도 지울 수 없다고 알린다.
- 업로드 요청에는 이미지 파일만 담는다. 링크 주소·스냅샷은 담지 않는다.

### 5.4 가져오기
- 대기 값은 읽을 때 `checkShareSnapshot`을 다시 지나야 쓴다(1.5-7). 저장 전 `sanitize*`를 한 번 더 지난다.
- 확인 창 없이는 아무것도 저장하지 않는다. 기존 데이터를 덮어쓰지 않고 늘 새로 만든다.
- 가져온 그룹으로 비교 화면을 열면 받은 사람의 키로 시세를 받는다. 받은 공유가 요청 대상을 고를 수 있는 것은 종목 코드(6자리 검사)뿐이다.

## 6. 테스트

### 6.1 스냅샷 (`snapshot.test.ts`, 새 `compact.test.ts`·`checkResult.test.ts`)
- 새 종류 각각: 만든 스냅샷이 검사를 통과한다. 필드 하나 더하기 → `unknown-field`, 빼기·틀린 값 → `invalid`, 종목 위치 범위 밖 → `reference`.
- 금지 키: 새 타입 모든 키 경로를 모아 `FORBIDDEN_KEYS`와 겹치지 않음을 확인한다. 결과 안 아무 곳에 `token` 키를 넣으면 `forbidden-field`. 거래 이유 문자열에 UUID를 넣으면 `reference`.
- 반올림: 소수 셋째 자리가 있는 곡선 값은 `invalid`.
- 솎기: 같은 입력 두 번 → 같은 위치. 첫·끝·최고·최저·낙폭 점이 남는다. n ≤ m이면 그대로. 하한 120.
- 줄이는 순서: 3.5의 두 고정 데이터(3년 일봉·거래 300건, 3년 월간·상위 10)가 `reduced: []`로 들어간다. 거래 2,500건이면 `too-large`. 월간·상위 30·10년이면 `codes-only`까지 가서 들어간다.
- 100 KiB 경계: 크기를 맞춘 스냅샷으로 정확히 `SHARE_MAX_BYTES`는 통과, 1바이트 넘으면 `too-large`.
- 자금 숨김: qty·fee·tax·pnl이 null이고 JSON에 원래 초기 자금 숫자가 없다. 숨김인데 qty가 숫자면 `invalid`.
- 펼치기: `expandSimResult`·`expandValidation`의 결과를 결과 화면 계산 함수(`resultHeadline`, `skipCounts` 등)가 받아 원래 값과 반올림 오차 안에서 같다.

### 6.2 가져오기 (`importPlan.test.ts`, `pendingImport.test.ts`)
- `uniqueName`: 충돌 없음, ` 2`, ` 2`도 있으면 ` 3`, 30자 이름 + ` 2` → 앞을 잘라 30자, 이모지·한글이 섞여도 문자 단위.
- 그룹: 50종목 → 10개 + 안내, 종목 목록에 없는 코드 제외 + 개수, 종목 목록이 null이면 거르지 않음.
- compare: `applyView` 켬/끔, 바뀌는 설정이 4개 키뿐.
- 전략: 20개면 막힘, 새 ID·`updatedAt`, 자금 숨김 안내.
- 기준: 묶음 b0·b1 → 새 ID로 바뀐 `pool.baskets`, 묶음 29 + 2개면 막힘, 같은 이름 묶음끼리도 겹치지 않음.
- 대기 값: 30분 지나면 null, 꺼내면 지워짐, 망가진 JSON·검사 실패 → null, sessionStorage가 던지면 메모리로.

### 6.3 컴포넌트
- `SharedView.test.ts`: 종류별 렌더(compare 요약, simResult 요약 카드·거래 줄, validation 카드·선정 이력), `unsupported`, 자금 숨김 배지·가격만 보이는 거래 줄, `내 앱에 가져오기`가 `onimport`를 스냅샷과 함께 부름.
- `ImportHost.test.ts`: 관문 경로(`profiles`·`unlock`·`onboarding`)에서는 열리지 않음, 일반 경로가 되면 열림, 막힘 문구와 꺼진 저장 단추, 저장 뒤 이동 경로.
- `ShareDialog.test.ts`: 거절 문구와 꺼진 단추, `reduced` 안내, 캡처 미리 보기(data: URL)와 체크, 업로드 상태(`uploading` → `ready`), 업로드 실패 시 고정 이미지 카드, 보내지 않고 닫으면 지우기 호출, 보낸 뒤 닫으면 호출 안 함. 카카오 SDK와 업로드는 가짜로 넣는다.
- `kakao.test.ts`: 종류별 카드 설명 두 줄, 이미지 있음/없음, http 주소·200 미만 응답은 null.
- `cardImage.test.ts`: jsdom에는 canvas가 없으므로 그리기 호출을 기록하는 가짜 2D context로 배치(글 위치·값 목록 순서)와 `cardFile`의 품질 재시도만 본다. `lwcStub.ts`에 `takeScreenshot`을 더한다.
- `ResultView`·`ValidationResult`·`TradeList`·`SymbolTab`의 새 prop(읽기 전용, 금액 숨김, `app` null).

### 6.4 sync-worker (`sync-worker/src/shares.test.ts`)
- 새 세 종류 생성이 201, 요청 `kind`와 스냅샷 `kind`가 다르면 422 `invalid`.
- 100 KiB 넘는 결과 스냅샷은 422 `too-large`. 본문 110 KiB 상한보다 먼저 스냅샷 검사에 걸리는 크기와, 본문 상한에 걸리는 크기 두 경우.
- 읽기(`GET /v1/public/share`)가 새 종류를 그대로 돌려준다.

### 6.5 e2e
1. **가져오기 흐름(지금 빌드, 모든 프로젝트):** `page.addInitScript`로 sessionStorage에 대기 값(고정 compare·strategy·validation 스냅샷)을 넣고 `#/compare`를 연다. 첫 실행 → 온보딩에서 `데모로 둘러보기` → 확인 창 → `저장` → 만든 그룹의 비교 화면·전략 편집·기준 편집이 열리는지. 이름 충돌(같은 이름 그룹을 먼저 만든 뒤 ` 2`) 한 번. axe 위반 0.
2. **받은 화면(별도 빌드, `share` 프로젝트):** 지금 e2e 빌드에는 동기화 설정(`VITE_SYNC_API_URL`, `VITE_FIREBASE_*`)이 없어 SharedView가 `unavailable`이다. 그래서 `playwright.config.ts`의 `webServer`를 배열로 바꿔 두 번째 서버를 둔다. 가짜 설정(`VITE_SYNC_API_URL=https://sync.e2e.test`와 가짜 Firebase 값)으로 `vite build --outDir dist-e2e-share` 후 4174 포트로 띄운다. 테스트는 `page.route('https://sync.e2e.test/v1/public/share', …)`로 고정 응답을 주고, Firebase·Google 요청은 `route.abort()`로 막는다. phone·desktop 두 뷰포트에서 종류별 렌더와 `내 앱에 가져오기` → 확인 창까지 본다.
   - `dist-e2e-share`는 `.gitignore`에 더한다. 빌드 시간이 두 배가 되므로 `share` 프로젝트만 따로 돌리는 명령(`pnpm e2e --project=share`)을 `docs/development.md`에 적는다.
   - 로그인하지 않은 상태라 공유 만들기(대화 상자)는 e2e에서 다루지 않는다. 컴포넌트 테스트(6.3)가 맡는다.

## 7. 오류 처리

| 상황 | 처리 |
|---|---|
| 결과가 100 KiB를 넘음(줄여도) | 대화 상자에 거절 문구, 링크 만들기 꺼짐. 서버에 보내지 않는다 |
| 서버가 422 `too-large` | 공유용 문구 `공유 내용이 너무 커요(100 KB). 기간이나 종목을 줄여 주세요`. `controller.svelte.ts`의 `describeFail`이 공유 요청에서는 이 문구를 쓴다(지금의 `프로필이 너무 커요(256 KiB)…`와 나눈다) |
| 서버가 다른 422(`invalid`·`unknown-field`·`reference`) | 지금처럼 `서버가 이 데이터를 받지 않았어요.` 앱과 Worker 버전이 다를 때 생긴다 |
| 캡처 실패(차트 없음·canvas 오류) | 캡처 체크를 숨기고 고정 이미지 |
| 업로드 실패·시간 초과(15초) | 고정 이미지 + 안내 한 줄. 카카오 단추는 쓸 수 있다 |
| SDK에 `uploadImage`가 없음(SDK 버전 변화) | 업로드를 건너뛰고 고정 이미지 |
| 받은 공유의 종류를 모름·검사 실패 | `unsupported` 문구 |
| 대기 값이 오래됐거나 망가짐 | 조용히 버린다(확인 창을 열지 않는다) |
| 한도로 막힘 | 확인 창에 이유, 저장 꺼짐 |
| 저장 중 오류 | 스낵바 `가져오지 못했어요`, 이미 쓴 묶음은 되돌림(4.8) |

## 8. 접근성
- 새 단추(`공유`, `결과 공유`, `내 앱에 가져오기`, `저장`)는 `--touch` 높이 이상이고 글자 단추다. 아이콘만 쓰면 `aria-label`을 단다.
- 캡처 미리 보기 `<img>`에 4.3의 대체 글을 단다. 체크 상자는 `<label>`로 감싼다.
- 카카오 단추의 상태 글(`카카오톡 준비 중…`, `캡처 올리는 중…`)이 바뀌는 자리에 `aria-live="polite"`를 둔다.
- 거절·막힘 문구는 `role="alert"`, 줄인 안내는 일반 목록이다.
- 확인 창은 기존 `Sheet`(포커스 가둠, Esc 닫기)를 쓴다. 열리면 제목으로 포커스가 가고, 닫히면 이동한 화면의 제목(없으면 본문 첫 제목)으로 간다.
- 읽기 전용 결과 화면에서 거래 줄은 버튼이 아니다(누를 수 없는 것을 버튼으로 두지 않는다).
- 솎은 곡선 안내와 데모·자금 비공개 배지는 글로 보인다. 색만으로 알리지 않는다.
- e2e의 axe 검사(6.5)에 확인 창과 받은 결과 화면을 넣는다.

## 9. 사용자에게 물을 것
없음. 초안의 두 질문(자금 숨김일 때의 금액·수량, 검증 결과의 ② 전략)은 사용자가 추천안을 골라 1.3의 6·7번으로 옮겼다.

## 10. 실연결 점검
`docs/live-check.md`에 항목을 더한다.
- 운영 도메인에서 `Kakao.Share.uploadImage`가 성공하는지(등록 도메인·앱 키 권한), 돌려준 주소의 호스트와 크기 값.
- 업로드한 800×400(실제 1600×800) JPEG가 카카오톡 카드(PC·모바일)에서 잘리지 않는지. 고정 PNG도 같은 확인.
- `deleteImage` 뒤 그 주소가 더는 열리지 않는지, 이미 보낸 메시지의 이미지는 남는지.
- 카카오 업로드 이미지의 보관 기간(카카오 문서).
- 3년 일봉 실제 KIS 결과·실제 시장 파일 검증 결과의 스냅샷 크기(3.5 예산과 비교).
- 받은 사람이 PWA 옛 버전일 때 새 종류 링크가 어떻게 보이는지(새로 고침 안내가 나오는지).
