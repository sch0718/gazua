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

6·7번은 이 설계 초안의 질문에 사용자가 추천안을 고른 것이고, 8번은 검토 중에 정한 것이다.

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
| 8 | 카카오톡 인앱 브라우저 | UA에 `KAKAOTALK`가 있으면 SharedView에 「기본 브라우저로 열기」 단추와 안내를 보이고, 확인 창에 "지금 이 브라우저에 저장돼요"를 밝힌다. 인앱에서 가져오기를 막지는 않는다. iOS Safari와 홈 화면 PWA의 저장소가 다르다는 것도 안내한다(4.7) |

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
2. **simResult의 전략은 실행한 작업본(`DoneMeta.strategy`)으로 만든다.** 종목은 지금 관심목록이 아니라 **실행에 쓴 종목**으로 푼다. `perSymbol`에는 받은 종목만 있으므로(`simulate.ts`가 `input.stocks`로 만들고, 받지 못한 종목은 `loadSimData.ts`의 `failed`로 빠진다) `DoneMeta`에 실행한 종목 목록(`symbols`, 요청 순서)을 새로 둔다. 실행 뒤 규칙을 고쳤거나(이전 결과) 그룹 종목이 바뀌어도 결과와 규칙이 맞는다.
3. **validation의 기준도 실행할 때의 것으로 만든다.** 지금 `Simulate.svelte`의 `runSnap`은 이름·자본·흐름 값만 둔다. 여기에 실행한 기준·묶음·전략 사본을 더해 공유 스냅샷을 만든다.
4. **곡선은 자금 숨김과 상관없이 늘 수익률(%)로 담는다.** 화면(EquityChart)도 수익률로 그리므로 잃는 것이 없고, 원 단위보다 짧다. `equity[].cash`는 화면에 쓰지 않아 뺀다(요약의 `avgCashPct`는 남는다).
5. **건너뛴 신호 목록은 들어가면 넣고, 넘치면 이유별 개수만 남긴다.** 사용자 결정의 "빠짐없이"는 거래에 대한 것이다. 건너뜀은 결과 화면의 셋째 탭이라 함께 보내되, 곡선을 솎기 전에 먼저 줄인다(3.4).
6. **검증의 선정 이력은 전부 · 계산값 뺌 · 코드만의 세 수준으로 줄인다.** 조건 계산값을 먼저, 그다음 종목별 수익률을 뺀다(3.4). 검증 결과에는 "빠짐없이" 결정이 없고, 월간·상위 30·10년이면 이력만으로 100 KiB를 넘기 때문이다.
7. **가져오기 대기 값은 30분 뒤 버리고, 읽을 때 다시 검사한다.** sessionStorage는 같은 탭의 다른 스크립트·확장도 쓸 수 있는 곳이라 믿지 않는다.
8. **보내지 않은 캡처는 카카오 서버에서 지운다.** SDK에 `Kakao.Share.deleteImage`가 있다. 대화 상자를 닫을 때 카카오톡으로 보내지 않았으면 지우기를 요청한다(실패는 무시).
9. **고정 이미지는 800×400(2:1)으로 만든다.** 캡처 카드와 같은 비율이라 카카오 카드 모양이 종류마다 흔들리지 않는다.
10. **e2e는 지금 빌드에서 가져오기 흐름만 본다.** 동기화 설정을 넣은 두 번째 빌드는 만들지 않는다(조율 결정). SharedView 화면과 「내 앱에 가져오기」 → 이동 전이는 컴포넌트 테스트와 vitest axe 검사로 덮는다(6.3, 6.5).
11. **SharedView에서 앱으로 나갈 때는 `enter()`와 같은 판단을 쓴다.** 지금 `onexit`의 `app.navigate()`는 관문(`gate()`)만 보고 온보딩을 건너뛴다(`app.svelte.ts` `navigate` vs `enter`). 첫 실행이면 온보딩으로 보내고, 대기 값은 남겨 두었다가 온보딩·관문이 끝난 뒤 확인 창을 연다(조율 결정, 4.8). 기존 「가즈아 열기」 단추도 같은 길로 바꾼다.
12. **받는 쪽 검사는 만드는 쪽보다 너그럽다.** 서버에 넣을 때는 지금처럼 정리 결과와 완전히 같아야 하지만, 읽을 때(받은 화면·가져오기)는 전략·기준에 **빠진 필드를 기본값으로 채워** 받는다. 이후 `Strategy`·`SelectionCriteria`에 필드가 늘어도 만료 전(최대 30일) 옛 공유가 열린다(2.7).
13. **만든 스냅샷은 보내기 전에 클라이언트에서 한 번 검사한다.** JSON 왕복 뒤 `checkShareSnapshot`을 돌려, 서버가 거절할 것을 미리 막는다(3.1).
14. **결과 종류의 대기 값은 가져올 부분만 둔다.** simResult는 strategy 스냅샷, validation은 criteria 스냅샷으로 바꿔 sessionStorage에 넣는다(4.8).
15. **덜어 낸 것(YAGNI).** 거래의 수수료·세금(받은 화면에 보이지 않는다), 선정 이력의 구간 끝 `to`(다음 재선정일로 다시 만든다), 캡처 파일의 5 MB 재시도(1600×800 JPEG는 그 근처에도 가지 않는다)를 뺐다. 고정 PNG는 카카오 서버만 받아 가므로 PWA 미리 저장에서 뺀다(4.6).

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
  /** 시뮬레이션은 DoneMeta.demo. 검증은 늘 false(아래 설명) */
  demo: boolean;
  /** 시세를 받은 시각(검증은 시장 파일 수집 시각), epoch ms */
  fetchedAt: number;
}
```

- 검증의 `demo`: 시장 파일에는 데모 표시가 없다. 데모 파일도 `source: 'kis'`다(`scripts/make-demo-market-data.mjs`, `src/lib/marketData/format.ts`). 데모 시장 파일은 `tests/fixtures/market-data-demo.json.gz`에만 있고 사용자에게 배포하지 않으므로 검증 결과는 늘 `demo: false`로 둔다. 대신 `fetchedAt`(수집 시각)을 `runSnap`에 실행 때의 `info.collectedAt`으로 남겨 받는 사람이 언제 자료인지 알게 한다.
- 날짜를 문자열 배열 대신 일수로 담는다. 3년 일봉에서 축이 9.5 KB에서 2.9 KB로 준다.
- 반올림 규칙: 수익률·%·%p·통계는 소수 둘째 자리(`Math.round(x * 100) / 100`). 원 단위 금액·가격·수수료·세금은 정수. 정수 필드(횟수·일수)는 그대로 둔다. 선정 이력·오늘 선정의 조건 계산값은 **키별 규칙**을 따른다. `finQuarter`(`202406` 같은 결산 분기), `leaderRank`, `flowStreak`처럼 정수인 키는 그대로 두고, 나머지 숫자 키만 유효숫자 4자리(`Number(x.toPrecision(4))`)로 줄인다. 규칙은 2.5의 값 키 목록(`VALUE_KEYS`)에 함께 둔다.
- 반올림 결과가 `-0`이면 `0`으로 쓴다(JSON에서 같아지지만 검사의 동일성 비교를 단순하게 한다).
- 유한수가 아닌 값(`NaN`, `Infinity`)은 null을 허용하는 자리면 null로, 아니면 만들기를 실패로 돌린다(3.1).
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
- 지금 화면이 고를 수 없는 지표를 등락률로 대신 보여 주는 중이면(`fallbackNote`) 스냅샷에도 화면에 보이는(대체된) 지표를 넣는다.

### 2.4 simResult

```ts
export interface SimResultSnapshot {
  kind: 'simResult';
  v: 1;
  title: string;
  /** strategySnapshot 규칙: id 'shared', name = title, updatedAt 0. universe는 실행한 종목(DoneMeta.symbols, 요청 순서) */
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
  /** 거래·종목별·건너뜀 행의 종목 위치가 가리키는 코드. 실행한 종목(DoneMeta.symbols)이고 strategy.universe.symbols와 같다 */
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
  /** 받지 못한 종목(종목별 탭 안내). symbols의 부분 집합이고 perSymbol과 겹치지 않는다. perSymbol ∪ failed = symbols */
  failed: { symbol: string; reason: SimFailureReason }[];
}

/**
 * 거래 한 줄. day는 axis.start로부터의 달력 일수, symbol은 symbols의 위치.
 * 자금 숨김이면 qty는 null(가격은 시세라 남긴다, 사용자 결정 6). 수수료·세금은 받은 화면에 보이지 않아 늘 뺀다.
 * 매수 줄의 pattern은 거래 차트 시트에만 쓰여 뺀다.
 */
export type SharedTrade = [
  day: number,
  symbol: number,
  kind: Trade['kind'],
  stage: number | null,
  price: number,
  qty: number | null,
  reason: string,
  pnlPct: number | null,
];

/** pnl은 원(자금 숨김이면 null), pnlPct는 초기 자금 대비 %(늘 있다). firstDay는 axis 기준 일수 */
export type SharedPerSymbol = [symbol: number, pnl: number | null, pnlPct: number, roundTrips: number, firstDay: number | null];
```

- 거래를 객체 대신 튜플로 담는다. 300건 기준 거래 하나가 약 230 B에서 약 51 B로 준다(3.5).
- 종목 이름은 넣지 않는다. 지금처럼 보는 쪽이 앱 종목 목록(universe.json)으로 붙인다.
- `SKIP_REASONS`는 `Skip['reason']` 네 값을 고정 순서로 둔 배열이다. 다른 열거값과 함께 의존성 없는 모듈(`src/lib/share/resultEnums.ts`, 2.7)에 둔다.
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
  /** ValuePairs의 키 위치가 가리키는 이름(선정 이력·오늘 선정 공용). VALUE_KEYS에 있는 이름만, 서로 다르게 */
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
- 구간 끝(`HoldSegment.to`)은 담지 않는다. `holdSelection.ts`는 다음 재선정일에 앞 구간을 닫고, 마지막 구간은 축의 마지막 날에 닫는다. 펼칠 때 같은 규칙으로 다시 만든다(솎아도 축의 마지막 날은 남는다).
- 값 키 목록 `VALUE_KEYS`는 `select.ts`가 만드는 키(`marketCap`, `tradingValue`, `leaderRank`, `return`, `ma`, `fromHigh`, `volatility`, `rebound`, 환율·유가 계열의 `…Trend`·`…Beta`, 수급 `flow…`·`rankFlow…`, 재무 `fin…`·`rankFin`)를 키별 반올림 규칙(정수/4자리)과 함께 적은 고정 목록이다. 목록 밖 이름(`__proto__` 포함)은 거절한다. 테스트가 `select.ts`가 실제로 만드는 키가 모두 목록에 있는지 확인한다.
- **② 매매 규칙의 전략은 넣지 않는다.** 기준의 `trading.strategyId`는 지금 규칙대로 null이다. 결과의 ② 곡선·통계는 결과로서 보인다. 가져온 기준에는 ②가 없다는 것을 확인 창에서 알린다(사용자 결정 7).

### 2.6 자금 숨김
「가상 초기 자금 빼기」(기본 켬)가 켜져 있을 때의 처리다(사용자 결정 6).

| 값 | 숨김 꺼짐 | 숨김 켬 |
|---|---|---|
| 곡선 | 수익률(%) | 수익률(%) |
| 요약·통계 | 그대로(모두 %·횟수) | 그대로 |
| 거래 가격 | 원 | 원(시세라 남긴다) |
| 거래 수량 | 주 | null |
| 거래 수수료·세금 | 넣지 않음 | 넣지 않음 |
| 종목별 손익 | 원 + 자금 대비 % | 자금 대비 %만 |
| 전략·기준의 초기 자금 | 원래 값 | 기본값(기존 규칙) |
| 검증 선정 이력의 계산값(시가총액·거래대금 등) | 그대로 | 그대로(시장 값이라 자금과 무관) |

받은 화면은 숨김일 때 거래 줄을 `58,300원`처럼 가격만, 종목별 탭을 `자금 대비 +3.21%`로 보인다. 금액이 없다는 것을 `초기 자금 비공개` 배지로 알린다.

### 2.7 검사 (`checkShareSnapshot` 확장)
- 기존 순서(금지 키 → 크기 → UUID → kind·v·title)는 그대로다. 그 뒤 `switch`에 세 종류를 더한다.
- 모드를 둘로 나눈다. `checkShareSnapshot(raw, kind, now, mode = 'create')`
  - `create`(서버 `POST /v1/shares`, 만든 쪽의 보내기 전 검사): 지금처럼 엄격하다. 전략·기준은 정리(`sanitize*`) 결과와 완전히 같아야 한다.
  - `read`(받은 화면, 가져오기 대기 값): 금지 키·UUID·크기·종류·결과 부분의 모양과 참조는 똑같이 엄격하다. 전략·기준에서만 **입력에 없는 필드는 정리 결과의 기본값으로 채워** 받는다. 모르는 필드와 값이 다른 필드는 그대로 거절한다. 돌려주는 `snapshot`은 채운 값이다.
  - 방법: `jsonDiff`(`src/lib/sync/forbidden.ts`)는 첫 차이 하나만 돌려주므로 종류만 더해서는 "빠진 것만 있다"를 알 수 없다. 그래서 `jsonDiff(a, b, path, { ignoreMissing: true })` 옵션을 더한다. 켜면 정리 결과(b)에만 있는 키는 차이로 보지 않고 건너뛰며 비교를 이어 간다. 남은 차이(`extra` 또는 `value`)가 있으면 거절하고, 없으면 정리 결과를 쓴다. 꺼져 있을 때(기본, `create`)의 동작은 지금과 같다.
  - 제목·이름 길이: `create`는 UTF-16 30 이내(4.8). `read`는 UTF-16 30 **또는** code point 30 이내를 받는다. 지금 만드는 쪽이 code point로 재어 만든 옛 공유(이모지가 든 그룹 이름 등)를 만료 전까지 열기 위해서다. 그런 제목을 가져올 때는 `uniqueName`이 UTF-16 30에 맞춰 자른다.
- 오류 코드에 `unsupported`(모르는 `kind`)를 더한다. 받은 화면은 `unsupported`이면 "새 버전 앱에서 볼 수 있어요. 앱을 새로 고쳐 주세요", 그 밖의 실패(망가졌거나 정리할 수 없는 옛 공유)이면 "이 공유를 읽을 수 없어요. 보낸 사람에게 다시 만들어 달라고 해 주세요"로 나눠 보인다.
- 전략·기준 부분은 지금 `strategy`·`criteria` 분기의 본문을 `checkStrategyPart(raw, title, now, mode)`·`checkCriteriaPart(raw, title, now, mode)`로 떼어 함께 쓴다.
- **종목 코드 검사를 공유 경로에 더한다.** `sanitizeStrategies`는 `universe.symbols`·`benchmarks.symbol`을, `sanitizeCriteria`는 `benchmarks.symbols`를 문자열인지만 본다(`src/lib/sim/validate.ts`, `src/lib/screen/validate.ts`). 가져오면 이 값이 받은 사람 키로 보내는 시세 요청에 들어가므로 검사가 필요하다. 다만 **정리 함수(`sanitize*`)는 바꾸지 않는다.** 정리 함수는 저장소 읽기(손상 배너)와 동기화 DTO(`src/lib/sync/dto.ts`)도 쓰므로, 여기서 거절하면 이미 저장된 데이터가 손상으로 보이거나 동기화 push가 422가 된다. 검사는 공유 경로인 `checkStrategyPart`·`checkCriteriaPart`에만 둔다(관심목록도 저장 쪽 `state/validate.ts`는 아무 문자열이나 받으므로 그대로 둔다).
- 공유용 종목 정규식은 하나로 정한다: `SHARE_SYMBOL_RE = /^(?:[0-9A-Z]{6}|Q[0-9A-Z]{6})$/`. 종목 목록을 만드는 `scripts/parse-master.mjs`의 `SYMBOL_PATTERN`과 같다(주식·ETF·리츠 6자리, ETN은 `Q` + 6자리, `src/lib/data/universe.ts` 주석). 그룹·전략(`universe.symbols`, `benchmarks.symbol`)·기준(`benchmarks.symbols`)·compare·결과 부분(`symbols`, `failed[].symbol`, 검증 `benchmarks[].symbol`, 선정 이력·오늘 선정)이 이것을 쓰고, 각 목록 안에서 중복을 거절한다(한 재선정일·오늘 선정 안에서 중복 없음). 지금 `snapshot.ts`의 `SYMBOL_RE`(`^[0-9A-Z]{6}$`)는 ETN을 거르므로 ETN이 든 그룹 공유가 `invalid`가 되는 버그가 있다. 이것도 함께 고친다.
- **묶음의 종목만은 앱 묶음 규칙(6자리, `src/lib/screen/baskets.ts`의 `SYMBOL_RE`)을 그대로 쓴다.** 앱 묶음은 6자리만 받는다(`baskets.ts`, `BasketSheet.svelte`). 공유에서 ETN 묶음을 받으면 다음 로드에 `sanitizeBaskets`가 `repaired`로 보아 손상 배너가 뜨고 동기화 push가 422가 되기 때문이다. 그래서 criteria·validation의 `baskets[].symbols`에 ETN이 있으면 거절한다.
- 결과 부분은 새 파일 `src/lib/share/checkResult.ts`가 맡는다. 원칙은 기존과 같다. 모르는 필드는 `unknown-field`, 모양·값이 틀리면 `invalid`, 가리키는 곳이 없으면 `reference`로 거절하고 고쳐 받지 않는다.
  - 축: `start`가 유효한 날짜, `offsets[0] === 0`, 엄격히 오름차순 정수, 길이 1~3,700(10년 일봉 여유).
  - 곡선: 길이가 축과 같고, 유한수(또는 허용된 곳만 null), 소수 둘째 자리 이하.
  - 수: 횟수·개수(`counts`의 n, `roundTrips`, `passed`, `trades`, `beat`·`total`)는 0 이상 정수, `qty`는 양의 정수, `stage`는 1~3 정수, 가격은 양의 정수, `avgPicked`는 0 이상.
  - 시뮬레이션 거래: `day`는 축 범위 안이고 오름차순(같은 날 허용), `kind`가 `buy`·`add`면 `stage`·`pnlPct`가 null, `take`·`gapTake`면 `stage`가 숫자, `stop`·`gapStop`이면 `stage`가 null(`simulate.ts`의 매도는 손절일 때 `stage`를 넣지 않는다), 매도 종류(`take`·`stop`·`gapStop`·`gapTake`)면 `pnlPct`가 숫자.
  - `perSymbol`: 길이 = `symbols` − `failed`, `symbols` 순서를 따르고 같은 종목이 두 번 없다. `failed`의 종목은 `symbols` 안이고 `perSymbol`과 겹치지 않는다.
  - `skipped.counts`: 이유가 `SKIP_REASONS` 순서이고 중복 없음. `counts`의 n 합 = `summary.skippedSignals`. `rows`가 있으면 이유별 개수가 `counts`와 같다.
  - `sampled`가 null이 아니면 `from > offsets.length`.
  - `run.from`·`run.to`는 축의 첫날·마지막 날과 같다. `source`는 1~30자, `fetchedAt`은 양의 정수.
  - simResult의 `symbols`는 `strategy.universe.symbols`와 같다. `capitalHidden`이면 거래의 qty와 종목별 pnl이 모두 null이어야 하고, 아니면 모두 숫자여야 한다.
  - validation
    - `indices`의 `id` 순서 = 기준의 `benchmarks.indices`, `benchmarks`의 `symbol` 순서 = 기준의 `benchmarks.symbols`.
    - 곡선·이유·통계는 함께 맞아야 한다: `curve`가 null이면 `reason`이 있고 `stats`가 null, 아니면 `reason`이 null이고 `stats`가 있다.
    - `byMarket`은 `KOSPI`·`KOSDAQ`·`ETF` 세 개가 이 순서로 있다.
    - `notes`는 `ValidationNote` 값만, 중복 없음.
    - 재선정일 `day`는 오름차순이고 축 안의 날짜다. `picks` 수 ≤ `passed`, `picks` 수 ≤ 30(`TAKE_MAX`). 오늘 선정도 같다.
    - `history`와 `picks` 모양이 맞고, `ValuePairs`는 길이가 짝수이며 키 위치는 `valueKeys` 범위 안의 정수이고 한 줄 안에서 겹치지 않는다. 값은 그 키의 규칙(정수 키면 정수)을 따른다.
- **재귀 깊이 상한.** `findForbidden`·`jsonDiff`와 결과 검사는 깊이 32를 넘으면 그 자리에서 `invalid`로 멈춘다. 지금은 재귀에 상한이 없어 아주 깊은 JSON이면 스택이 넘쳐 500이 날 수 있다. 상한에 걸리면 422로 답한다. 스냅샷의 실제 깊이는 10 안팎이다.
- 열거값(`ValidationNote`, `NotBoughtReason`, `MissingReason`, `SimFailureReason`, `ByMarketKey`, `Trade['kind']`, `Skip['reason']`)과 `VALUE_KEYS`는 의존성 없는 `src/lib/share/resultEnums.ts`에 상수 배열로 둔다. 원래 타입을 쓰는 곳(`sim/types.ts`, `screen/runValidation.ts`, `screen/holdSelection.ts`, `sim/loadSimData.ts`)은 그대로 두고, 테스트가 두 쪽이 같은지 타입으로 확인한다(`satisfies readonly X[]`와 반대 방향 대입). 그래서 Worker 번들은 계산 코드(`simulate`, `runValidation`, `select`)를 끌어오지 않는다.

## 3. 축약과 크기

### 3.1 만들기 결과
결과 스냅샷은 크기 때문에 만들지 못할 수 있다. 만들기 함수는 결과를 값으로 돌려준다.

```ts
export type ShareReduction = 'skipped-counts' | 'no-values' | 'codes-only' | 'thinned';
export type ShareBuild<S extends ShareSnapshot = ShareSnapshot> =
  | { ok: true; snapshot: S; reduced: ShareReduction[] }
  | { ok: false; code: 'too-large'; bytes: number }
  | { ok: false; code: 'invalid'; path?: string };

export function simResultSnapshot(done: DoneState, opts: { hideCapital: boolean; now?: number }): ShareBuild<SimResultSnapshot>;
export function validationSnapshot(
  run: { result: ValidationResult; criteria: SelectionCriteria; baskets: Basket[]; strategies: Strategy[]; collectedAt: string },
  opts: { hideCapital: boolean; now?: number },
): ShareBuild<ValidationSnapshot>;
```

그룹·전략·기준·compare 만들기는 늘 `ok: true`, `reduced: []`로 감싼다.

- 만든 쪽의 마지막 단계로 **JSON 왕복 뒤 `checkShareSnapshot(…, 'create')`를 돌린다.** 통과하지 못하면 `{ ok: false, code: 'invalid', path }`를 돌려주고, 대화 상자는 링크 만들기를 끄고 `이 결과는 공유 형식으로 바꾸지 못했어요`를 보인다(오류 경로는 원문 보기에만). 그래서 `ShareBuild`의 실패 코드는 `'too-large' | 'invalid'`다.
- 축이 3,700점을 넘으면(10년 넘는 일봉) 크기와 상관없이 먼저 솎는다(3.3의 `thinIndices`, `m` = 3,000). 이것도 솎기라 `reduced`에 `thinned`를 넣는다. `sampled.from`은 늘 **원래 축의 점 수**다. 3.4의 500 → 250 → 120 단계도 앞 단계 결과가 아니라 늘 **원래 축에서 다시** 솎는다(keep 점이 단계마다 같게).
- `validationSnapshot`의 `collectedAt`은 `runSnap`에 실행 때 남긴 값이고 `demo`는 늘 false다(2.2).

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
- 같은 입력이면 늘 같은 결과다(난수·시각을 쓰지 않는다). 남는 점 수는 `m + keep 수` 이하다. 단계마다 원래 축에서 다시 솎는다(3.1).
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
| 거래 300건 | 약 69 KB(건당 약 230 B) | 15.2 KB(건당 약 51 B) |
| 건너뜀 300건 | 약 21 KB | 3.0 KB |
| 전략·요약·비교·메타·종목별 | 약 2 KB | 약 1.7 KB |
| **합계** | **약 187 KB(거절됨)** | **약 39 KB** |

- 위 표는 자금 숨김을 끈 경우다. 숨김이면 거래의 qty가 `null`(4 B)이 되고 종목별 pnl도 `null`이라 크기는 같거나 조금 작다.
- 거래 1,000건이면 약 75 KB로 1단계에서 들어간다.
- 곡선을 120점으로 솎으면 축+곡선이 3.2 KB다. 나머지 고정분을 약 5 KB로 보면 거래는 **약 1,900건**까지 들어간다. 그 이상은 거절한다.

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
  /** 비교·결과 화면: 지금 보이는 차트로 카드 이미지를 만든다. 빈 그룹·불러오는 중·거래 0건 결과처럼 그릴 곡선이 없으면 null */
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
- 미리 보기 줄(`snapshotLines`)은 결과 종류에서 요약만 보인다(4.5). 「보낼 원문 보기」는 결과 종류에서 둘로 나눈다. 규칙 부분(strategy 또는 criteria·baskets)은 지금처럼 들여 쓴 JSON, 결과 부분은 `결과 원문({KB} KB)` 아래에 압축 JSON(들여쓰기 없음)으로 두고 **펼쳤을 때만** 문자열을 만든다. 지금 대화 상자는 열 때마다 `JSON.stringify(snapshot, null, 2)`를 그리므로 100 KB 결과면 수천 줄이 된다.
- 카카오 키가 있고 `capture`가 있으면 열 때 한 번 캡처한다(보이는 화면 그대로). `null`이면(4.1) 캡처 부분을 통째로 숨기고 고정 이미지를 쓴다. `canvas.toDataURL('image/jpeg', 0.85)`를 `<img>`로 미리 보인다. CSP `img-src 'self' data:` 안이다. 그 아래에 다음을 둔다.
  - 체크 「화면 캡처 함께 보내기」(기본 켬)
  - 안내 `링크를 만들면 이 캡처를 카카오 서버에 바로 올려요(카카오톡 카드에 넣으려고요). 링크를 철회해도 카카오톡으로 보낸 캡처는 지울 수 없어요.` 기본으로 켜져 있어 링크를 만들기만 해도 올라간다는 것을 문구가 먼저 말한다.
- 캡처를 올릴지는 **링크 전 화면의 체크로만 정한다.** 링크를 만들면 곧바로 올리므로 링크 화면에서는 끌 기회가 없다. 링크 화면에는 작은 미리 보기와 「이미지 빼고 보내기」 단추만 둔다. 누르면 올린 이미지를 지우고 고정 이미지 카드로 바꾼다(되돌리지 않는다). 업로드 중에 누르면 카드는 바로 고정 이미지가 되고, 늦게 온 업로드 응답은 `attempt` 규칙처럼 버리면서 그 이미지를 `deleteCardImage`로 지운다.
- 링크 만들기 뒤 순서(카카오 단추 상태: `off` → `loading` → `uploading` → `ready`)
  1. 링크가 생기면 지금처럼 `preloadKakao`.
  2. 준비되고 캡처가 켜져 있으면 `cardFile(canvas)`로 파일을 만들어 `uploadCardImage(file)`. 단추 글은 `캡처 올리는 중…`이다.
  3. 성공하면 받은 이미지 주소를 카드에 쓴다. 실패하면 고정 이미지로 돌아가고 `캡처를 올리지 못해 기본 그림으로 보내요`를 적는다. 어느 쪽이든 `ready`가 된다.
  4. 단추를 누르면 클릭 안에서 기다림 없이 `sendKakao`를 부른다(지금 규칙, PC 팝업 차단 방지).
- 대화 상자를 닫을 때 올린 이미지가 있고 카카오톡 단추를 누르지 않았으면 `deleteCardImage`를 부른다. 눌렀으면 메시지가 그 이미지를 가리키므로 지우지 않는다. 대화 상자를 닫지 않고 탭을 닫거나 다른 곳으로 가면(`pagehide`) 지우기 요청이 끝까지 가지 못할 수 있다. 이 한계는 5.3에 적는다.
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
/** JPEG 0.85로 만든다. 실패하거나 5 MB(카카오 한도)를 넘으면 null */
export function cardFile(canvas: HTMLCanvasElement): Promise<File | null>;
/** 지금 테마의 CSS 변수(--bg, --t1, --t2, --up, --down, --accent)를 읽는다. 색 관례(colorConvention)는 보낸 사람 것을 따른다 */
export function readCardColors(el: Element): CardColors;
```

- 차트 canvas는 `chart.takeScreenshot(true, false)`(lightweight-charts 5.2 `IChartApi`, typings 1767행)로 받는다. 위 레이어(세션 띠 등 primitive)는 넣고 십자선은 뺀다.
- `CompareChart.svelte`·`EquityChart.svelte`에 `export function screenshot(): HTMLCanvasElement | null`을 더한다. `ChartPanel`은 이것을 넘긴다. 비교 화면의 차트는 늘 그려지고 표(`DataTable`)는 그 아래에 펼쳐 보는 것이라(`Compare.svelte`의 `chart-slot`) 표 보기 때문에 캡처가 비지는 않는다. `null`이 되는 것은 그룹이 비었을 때, 시세를 불러오는 중일 때(`ctl.progress`가 진행 중이면 캡처하지 않는다 — 반쯤 그린 차트를 보내지 않게), 거래 0건이라 결과 화면에 곡선이 없을 때다.
- DOM으로 그린 것(SessionLanes, 직접 라벨, 범례)은 캡처에 들어가지 않는다. 그래서 범례(선 색 + 이름)를 카드 오른쪽 목록에 직접 그린다.
- 배치(표시 800×400 기준): 위 64px 띠에 `가즈아` 글자와 제목·부제, 왼쪽 약 62%에 차트(비율 유지 축소), 오른쪽에 값 목록, 맨 아래 24px에 출처. 글꼴은 `getComputedStyle(document.body).fontFamily`다.
- 비교 카드 값: 리더보드 순서대로 위 5종목의 `이름 값`(지금 지표의 표시 형식 그대로). 부제는 `{기간 이름} · {지표 이름} · {MM.DD HH:mm} 기준`. 출처는 공급자 이름(데모면 `데모 데이터`).
- 결과 카드 값: 총수익률, 최대 낙폭, 같은 종목 보유, 지수. 검증은 ① 선정만, ②(있으면), 첫 지수. 부제는 `{from} ~ {to}`.
- 대체 글(alt): `{제목} {종류} 캡처: {부제}, {값 목록을 쉼표로}`.

### 4.4 카카오 (kakao.ts)
`@sch0718/kakao-share` 0.1.1의 `KakaoSdk` 타입에는 업로드가 없다. SDK 2.8.4에는 `Share.uploadImage({ file })`(`POST https://kapi.kakao.com/v2/api/talk/message/image/upload`, FormData)와 `Share.deleteImage({ imageUrl })`가 있다. SDK는 저장소에 없고 CDN(`KAKAO_SDK_URL`, SRI 고정)에서 받으므로 근거를 여기 남긴다. 2026-10-29에 받은 `kakao.min.js`(88,359 B, SHA-256 `b890d6fa977e28b3a473d820fae21000a2d058a136cffaedbc62cf8daae0234f`)의 API 표에 `"/v2/api/talk/message/image/upload":{method:"POST",data:{required:{file:…}}}`와 `uploadImage:function(e){return Rr("/v2/api/talk/message/image/upload",{file:…})}`가 있고, 요청을 만들 때 `file`을 하나씩 돌며 `FormData.append("file", e)`한다. 그래서 `File[]`도 `FileList`도 된다. 타입은 `File[] | FileList`로 둔다. 앱 쪽에서 타입을 넓혀 부르고 패키지는 바꾸지 않는다. 운영 도메인에서의 동작은 10절에서 확인한다.

```ts
export interface KakaoImage { url: string; width: number; height: number }
interface KakaoShareImages {
  uploadImage(o: { file: File[] | FileList }): Promise<{ infos: { original: KakaoImage } }>;
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
- 파일: `public/share/{group,strategy,criteria,compare,simResult,validation}.png`, 800×400. 카카오 서버가 받아 가는 그림이고 앱 화면은 쓰지 않으므로 PWA 미리 저장에서 뺀다(`pwa.config.ts`의 기존 `globIgnores`에 `'share/**'`를 더한다).
- 만드는 법: 새 스크립트 `scripts/build-share-images.mjs`가 기존 `scripts/motion/kit.mjs`의 `loadTheme`(토큰 CSS)와 `public/icon.svg` 로고로 종류별 SVG를 만들고, 이미 개발 의존성인 `playwright-core`의 Chromium으로 PNG를 찍는다(`page.setContent` → `screenshot`). 결과 PNG를 커밋한다. `build:motion`처럼 손으로 돌리는 스크립트이고 `prebuild`에 넣지 않는다.
- 그림: 라이트 토큰 배경, 왼쪽에 로고, 오른쪽에 종류 이름(`비교 화면` 등)과 종류별 단순 도형(선 3개·막대·체크 목록). 숫자는 넣지 않는다.
- `package.json`에 `"build:share-images": "node scripts/build-share-images.mjs"`를 더한다.

### 4.7 받은 화면 (SharedView)
- 상태에 `unsupported`와 `unreadable`을 더한다. 서버는 읽을 때 다시 검사하지 않으므로 받은 쪽에서 `checkShareSnapshot(…, 'read')`로 한 번 검사하고(2.7), 모르는 종류면 `unsupported`(`이 공유는 새 버전 앱에서 볼 수 있어요. 앱을 새로 고쳐 주세요.`), 그 밖의 실패면 `unreadable`(`이 공유를 읽을 수 없어요. 보낸 사람에게 다시 만들어 달라고 해 주세요.`)을 보인다. 화면은 검사가 채운 스냅샷을 쓴다.
- **카카오톡 인앱 브라우저(사용자 결정 8).** `navigator.userAgent`에 `KAKAOTALK`가 있으면 머리 아래에 안내 상자를 둔다.
  - 문구: `카카오톡 안에서 열었어요. 여기서 가져오면 이 카카오톡 브라우저에만 저장돼요. 평소 쓰는 브라우저에 저장하려면 기본 브라우저로 열어 주세요.` iOS(UA에 `iPhone`·`iPad`)면 `홈 화면에 추가한 가즈아는 Safari와 저장소가 따로라, 홈 화면 앱에서 이 링크를 다시 열어야 거기에 저장돼요.`를 덧붙인다.
  - 단추 `기본 브라우저로 열기`: `location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(location.href)`. 이 스킴은 카카오 공식 개발 문서에서 찾지 못했고 카카오 개발자 포럼(DevTalk)과 여러 서비스가 쓰는 관용 방식이다. 그래서 동작은 10절에서 Android·iOS 카카오톡으로 확인하고, 안 되면 단추를 빼고 `오른쪽 위 ⋮ › 다른 브라우저로 열기`를 글로 안내한다.
  - 인앱에서도 가져오기는 막지 않는다. 확인 창은 인앱일 때 `지금 이 브라우저(카카오톡)에 저장돼요`를 맨 위에 보인다.
- 머리: 배지 `읽기 전용 공유`, 제목, `{kindLabel} · {만료일}까지 볼 수 있어요`. 결과 종류는 그 아래에 `{from} ~ {to} · {source} · {받은 시각}` 줄과 `데모 데이터`·`초기 자금 비공개` 배지.
- 본문
  - group·strategy·criteria: 지금 그대로(요약 줄 + 규칙 전체 보기).
  - compare: 요약 줄(종목·기간·지표·벤치마크·정렬)과 `가져오면 내 연결이나 데모로 같은 화면을 볼 수 있어요`.
  - simResult: `ResultView`를 읽기 전용으로 쓴다. 스냅샷을 `expandSimResult(s, names): DoneState`로 펼친다. 곡선은 `initial × (1 + pct / 100)`로 되돌리고, `meta.candles`는 빈 객체, `meta.names`는 앱 종목 목록에서 찾은 이름(못 찾으면 코드)이다. `ResultView`·`SymbolTab`이 `meta.names`로 이름을 붙이고 비교 기준 줄도 지정 종목 이름을 여기서 찾으므로 빠지면 안 된다. 그 뒤에 규칙 전체 보기.
  - validation: `ValidationResult`를 읽기 전용으로 쓴다. `expandValidation(s): ValidationResult`로 펼친다(곡선 값 = `capital × (1 + pct / 100)`, 코드만 이력은 수익률 없이 종목 줄만).
- 기존 컴포넌트에 더하는 것
  - `ResultView`: `readonly?: boolean`(규칙 고치기·거래 차트 시트를 숨기고 거래 줄을 누를 수 없게), `onEdit`을 선택 prop으로(읽기 전용이면 없음), `hideAmounts?: boolean`, `skippedCounts?: [reason, n][]`. 건너뜀 목록이 없을 때(`skipped.rows === null`) 지금 `result.skipped`를 쓰는 세 곳이 틀리므로 개수로 바꾼다: 거래 0건 분기의 "신호가 n번 났지만"과 이유 목록, 셋째 탭 이름 `건너뛴 신호 n`, `cashIssue`(가장 많은 이유). n은 `summary.skippedSignals`, 이유는 `skippedCounts`에서 읽는다. 셋째 탭 본문은 이유별 개수와 `목록은 크기 때문에 빼고 보냈어요`.
  - `TradeList`: `onTrade`를 선택 prop으로 바꾸고, 없으면 줄을 버튼이 아닌 목록 항목으로 그린다. `hideQty?: boolean`. `SymbolTab`: `pnlPct?: Record<string, number>`가 있으면 금액 대신 `자금 대비 %`.
  - `ValidationResult`: `app`을 `app: App | null`로, 색 관례를 `colorConvention` prop으로 받는다. `app`이 null이면 `TodayPicks`는 그룹에 넣기 단추 없이 목록만 보인다.
  - `EquityChart`: `sampledNote?: string`을 받아 차트 아래에 적는다.
- 색 관례·테마는 App이 `app.settings`의 값을 넘긴다(보는 사람 취향).
- 「규칙 전체 보기」(`rulesOf`)는 결과 종류에서 `strategy` 또는 `criteria`·`baskets`만 보인다. 지금 함수는 kind·v·title을 뺀 나머지를 모두 보여 `result`까지 거대한 JSON으로 그린다.
- 맨 아래 주 단추 `내 앱에 가져오기`와 설명 `이 기기의 프로필에 저장해요. 로그인이나 키가 없어도 돼요. 결과는 저장하지 않고 규칙만 가져와요`(결과 종류에서만 둘째 문장). 그 아래 기존 안내 문구.

### 4.8 가져오기
**대기 값 (`src/lib/share/pendingImport.ts`)**

```ts
const KEY = 'gazua:v1:share-import';
const TTL_MS = 30 * 60 * 1000;
/** 가져올 수 있는 종류만 둔다. simResult는 strategy로, validation은 criteria로 바꿔 넣는다 */
export type ImportSnapshot = GroupSnapshot | StrategySnapshot | CriteriaSnapshot | CompareSnapshot;
export interface PendingImport {
  /** 이 가져오기를 구별하는 무작위 값(작업 표시) */
  id: string;
  /** 원래 받은 종류(확인 창 안내에 쓴다) */
  from: ShareKind;
  snapshot: ImportSnapshot;
  at: number;
}
/** sessionStorage에 둔다. 쓰지 못하면 false(그때는 메모리 값으로 같은 탭 안에서만 이어 간다) */
export function stashImport(snapshot: ShareSnapshot, now: number, store?: Storage | null): boolean;
/**
 * 지우지 않고 읽는다. 다음 중 하나면 지우고 null:
 * 30분이 지남, from이 SHARE_KINDS가 아님, snapshot.kind가 from에 맞지 않음
 * (simResult → strategy, validation → criteria, 나머지는 같은 종류), checkShareSnapshot(…, 'read') 실패
 */
export function peekImport(now: number, store?: Storage | null): PendingImport | null;
/** 저장하거나 닫을 때 지운다 */
export function clearImport(store?: Storage | null): void;
```

- capability·링크 주소·만료일은 넣지 않는다. 가져올 스냅샷만 둔다. 결과 종류는 결과 부분을 버리고 규칙 부분만 둔다(sessionStorage에 100 KB를 둘 까닭이 없다).
- 확인 창을 열 때는 `peekImport`로 읽기만 한다. 창이 떠 있는 동안 새로 고치거나 탭이 죽어도 다시 열린다. `저장`·`저장하지 않기`·`닫기`에서 `clearImport`한다.
- 탭을 복제하면 sessionStorage도 복사되어 같은 가져오기가 두 번 저장될 수 있다. 저장할 때 `id`를 localStorage `gazua:v1:share-import-done`(최근 20개)에 남긴다. 확인 창을 열기 전에 확인하고, 이미 있는 `id`면 창 대신 `이미 가져왔어요` 스낵바를 띄우고 지운다. 두 탭이 함께 창을 띄운 경우를 위해 `저장`을 누른 직후, 쓰기 전에 한 번 더 확인한다.
- sessionStorage는 탭을 닫으면 사라진다. 새로 고침과 관문(잠금 해제 등)을 지나도 남는다.
- 접근이 막힌 환경(사생활 보호 등)이면 모듈 안 메모리 변수로 대신한다. SharedView → 앱 이동은 같은 페이지 안이라 이어진다.

**흐름**
1. SharedView `내 앱에 가져오기` → `stashImport` → `onexit()`.
2. `onexit`은 새 `app.leaveShared()`를 부른다. 공유 해시를 지우고 `enter()`와 같은 판단을 한다: 관문(`gate()`)이 있으면 프로필 선택·잠금 해제로, 없고 `!settings.onboarded`면 온보딩으로, 아니면 비교 화면으로 간다. 지금 `onexit`의 `app.navigate({ name: 'compare' })`는 관문만 보고 온보딩을 건너뛰므로(`app.svelte.ts`의 `navigate`는 `gate()`만, `enter()`는 `onboarded`도 본다) 첫 실행 사용자가 온보딩 없이 빈 비교 화면에 떨어진다. 관문을 마친 뒤의 진입(`enter()`)도 온보딩을 보므로, 프로필 선택·잠금 해제 → 온보딩 순서가 그대로 이어진다. 대기 값은 이 동안 남아 있다.
3. App에 새로 두는 `ImportHost`가 경로를 본다. 경로가 일반 화면(`compare`·`simulate`·`performance`·`settings`·`help`)이 되면(관문·온보딩 화면에서는 열지 않는다) `peekImport`로 읽고, 종목 목록(`sharedUniverse`)을 받은 뒤(실패하면 null) 계획을 세워 확인 창을 연다.
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
| strategy(받은 것이 strategy 또는 simResult) | 새 전략(종목은 그대로, 새 ID) | `#/simulate/<새 전략>` |
| criteria(받은 것이 criteria 또는 validation) | 새 묶음들 + 새 기준(`pool.baskets`를 새 묶음 ID로 바꿈) | `#/simulate/criteria/<새 기준>` |

표의 첫 열은 대기 값의 `snapshot.kind`다. 결과에서 온 것인지는 `from`으로 알고, 확인 창의 결과 안내(결과는 저장하지 않음, ② 없음)만 `from`을 본다.

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
/** 대기 값(PendingImport)의 snapshot·from. from은 확인 창 안내에만 쓴다 */
export interface ImportInput { snapshot: ImportSnapshot; from: ShareKind }
export function planImport(p: ImportInput, cur: ImportState): ImportPlan;
/** planImport가 막지 않은 경우에만 부른다. 막힌 계획이면 던진다 */
export function applyImport(p: ImportInput, cur: ImportState, opts: { now: number; applyView: boolean }): ImportApplied;
/** base가 taken에 없으면 그대로, 있으면 ` 2`, ` 3`…을 붙인다. 붙인 결과가 30(UTF-16 길이, 저장 검사와 같은 기준)을 넘으면 이름 끝을 잘라 맞추되 서로게이트 쌍을 반으로 자르지 않는다 */
export function uniqueName(base: string, taken: ReadonlySet<string>, max?: number): string;
```

- 그룹·compare에서 종목 목록으로 거른 뒤 남는 종목이 없으면 `가져올 수 있는 종목이 없어요`로 막는다.
- 한도 확인: 전략 20(`MAX_STRATEGIES`), 기준 20(`MAX_CRITERIA`), 묶음 30(`MAX_BASKETS`, 지금 개수 + 새 묶음 수). 막힌 이유는 기존 문구(`BASKET_CAP_MESSAGE` 등)를 쓴다.
- 이름 비교는 앞뒤 공백을 뺀 정확한 문자열 비교다. 그룹·전략·기준·묶음 각자의 목록 안에서만 본다. 한 번의 가져오기로 만드는 묶음끼리도 겹치지 않게 차례로 `taken`에 더한다.
- 길이는 **UTF-16 `.length`** 로 잰다. 전략·기준·묶음의 저장 검사가 `raw.name.length > NAME_MAX`(`sim/validate.ts`, `screen/validate.ts`, `screen/baskets.ts`)로 재기 때문이다. 문자(code point) 단위로 재면 이모지가 든 이름이 저장 때 잘리거나 `repaired`가 된다. 공유 제목의 `shareTitle`·`validTitle`도 지금은 code point로 재므로 같은 기준(UTF-16, 서로게이트를 자르지 않음)으로 맞춘다.
- 그룹 이름은 지금 한도가 없지만 같은 30 규칙을 쓴다(공유 제목이 이미 30 이내다).
- 새 ID는 기존 생성 함수(`withNewGroup`, `newBasket`, `crypto.randomUUID`)로 만든다. 받은 `shared`·`b0` ID는 남기지 않는다. `updatedAt`은 `now`다.
- 받은 전략·기준·묶음은 저장 전에 `sanitizeStrategies`·`sanitizeCriteria`·`sanitizeBaskets`를 한 번 더 지난다. 검사를 통과한 스냅샷이라 바뀌는 것이 없어야 하고, 바뀌면 저장하지 않고 `가져올 수 없는 공유예요`를 보인다.
- 쓰기 순서는 묶음 → 기준이다. 기준 쓰기가 실패하면(한도 오류 등) 방금 더한 묶음을 되돌린다.

### 4.9 화면별 바뀌는 곳
- `Compare.svelte`: 공유 단추, `openShare({ kind: 'compare', build: () => ok(compareSnapshot(group, app.settings)), capture })`. `capture`는 ChartPanel의 `screenshot()` + 리더보드 위 5행 + 기준 시각으로 카드를 합성한다.
- `Simulate.svelte`: `runSnap`에 `criteria`(실행한 기준의 `$state.snapshot`), `baskets`, `strategies`, `collectedAt`(실행 때 `info.collectedAt`)을 더한다. 검증 결과 제목 줄에 `결과 공유`. 시뮬레이션 결과는 `ResultView`에 `onShare?: () => void`를 넘긴다.
- 결과 화면 캡처는 `EquityChart`의 `screenshot()`을 쓴다. `ResultView`·`ValidationResult`가 `bind:this`로 들고 `capture()`를 내보낸다.
- `runController.svelte.ts`: `DoneMeta`에 `symbols`(실행한 종목, 요청 순서)를 더한다(1.5-2).
- 그룹·전략·기준의 기존 공유 단추(`GroupSheet.svelte`, `StrategyList.svelte`, `CriteriaList.svelte`)는 `build`가 `ShareBuild`를 돌려주게 감싼다.
- `app.svelte.ts`: `leaveShared()`(4.8). SharedView의 「가즈아 열기」도 이것을 쓴다.

**배포 순서.** Worker를 먼저 배포한다. 옛 Worker는 새 종류를 `invalid`(`kind`)로 거절하므로 앱을 먼저 내면 새 공유 만들기가 모두 실패한다. 받는 쪽은 앱 버전만 따른다(Worker는 읽을 때 검사하지 않는다).

### 4.10 파일 목록과 데이터 흐름

**새 파일**

| 파일 | 하는 일 |
|---|---|
| `src/lib/share/kinds.ts` | 종류 목록·표시 이름(2.1) |
| `src/lib/share/compact.ts` | 축·곡선 열 형식, 반올림, `thinIndices`, 줄이는 순서, `simResultSnapshot`·`validationSnapshot`·`compareSnapshot`, `expandSimResult`·`expandValidation` |
| `src/lib/share/checkResult.ts` | 결과 부분 검사(Worker 공용, DOM 없음) |
| `src/lib/share/resultEnums.ts` | 결과 검사용 열거값·`VALUE_KEYS`(의존성 없음, 2.7) |
| `src/lib/share/cardImage.ts` | 카드 합성·파일 만들기·색 읽기(4.3) |
| `src/lib/share/pendingImport.ts` | 가져오기 대기 값(`stashImport`·`peekImport`·`clearImport`, 4.8) |
| `src/lib/share/importPlan.ts` | `planImport`·`applyImport`·`uniqueName`(4.8) |
| `src/lib/share/ImportHost.svelte` | 가져오기 확인 창 |
| `src/lib/share/view/SharedSimResult.svelte`, `SharedValidation.svelte` | 받은 결과를 펼쳐 읽기 전용 결과 컴포넌트에 넘김 |
| `scripts/build-share-images.mjs`, `public/share/*.png` | 고정 이미지(4.6) |
| 테스트: `compact.test.ts`, `checkResult.test.ts`, `importPlan.test.ts`, `pendingImport.test.ts`, `cardImage.test.ts`, `ImportHost.test.ts`, `SharedView.test.ts`, `tests/e2e/share.spec.ts` | 6절 |

**바뀌는 파일**

| 파일 | 바뀌는 것 |
|---|---|
| `src/lib/share/snapshot.ts` | 종류·합집합 확장, 검사 분기 3개, 전략·기준 검사 함수 분리, `create`/`read` 모드, 제목 길이를 UTF-16 기준으로 |
| `src/lib/share/shareText.ts` | 새 종류 요약 줄, `cardLines` |
| `src/lib/share/kakao.ts` | 업로드·지우기, 카드 이미지·설명 |
| `src/lib/share/shareStore.svelte.ts` | `build`가 `ShareBuild`를 돌려줌, `capture` |
| `src/lib/share/ShareDialog.svelte` | 거절·줄임 안내, 캡처 미리 보기·체크, 업로드 상태 |
| `src/routes/SharedView.svelte` | 새 종류 본문, `unsupported`, 받은 쪽 검사, 가져오기 단추(`onimport`) |
| `src/App.svelte` | SharedView에 `onimport`·색 관례·테마, `ImportHost` |
| `src/routes/Compare.svelte`, `src/lib/ui/compare/ChartPanel.svelte`, `src/lib/chart/CompareChart.svelte` | 공유 단추, `screenshot()` |
| `src/routes/Simulate.svelte` | `runSnap` 확장, 검증 결과 공유 단추 |
| `src/lib/ui/simulate/RunPanel.svelte`, `runController.svelte.ts` | 결과 공유 단추를 `ResultView`까지 넘김, `DoneMeta.symbols` |
| `src/sheets/GroupSheet.svelte`, `src/lib/ui/simulate/StrategyList.svelte`, `src/lib/ui/screen/CriteriaList.svelte` | `build`가 `ShareBuild`를 돌려줌 |
| `src/lib/state/app.svelte.ts` | `leaveShared()` |
| `src/lib/sync/forbidden.ts` | `jsonDiff`의 `ignoreMissing` 옵션, 재귀 깊이 상한 |
| `pwa.config.ts` | `globIgnores`에 `share/**` |
| `src/lib/ui/simulate/ResultView.svelte`, `TradeList.svelte`, `SymbolTab.svelte`, `SkipList.svelte`, `EquityChart.svelte` | 읽기 전용(`onEdit`·`onTrade` 선택)·금액 숨김·건너뜀 개수·솎기 안내·`screenshot()`·공유 단추 |
| `src/lib/ui/screen/ValidationResult.svelte`, `TodayPicks.svelte`, `SelectionHistory.svelte` | `app` null, `colorConvention` prop, 캡처, 코드만 이력·다시 만든 구간 끝 |
| `src/lib/ui/settings/SyncManage.svelte` | 종류 표시를 `kindLabel`로 |
| `src/lib/sync/controller.svelte.ts` | `describeFail(f, ctx: 'profile' \| 'share')`로 `too-large` 문구 구분 |
| `src/lib/sync/dto.ts` | `SETTING_OK` 내보내기 |
| `src/lib/chart/lwcStub.ts` | `takeScreenshot` 가짜 |
| `kakao-csp.config.ts` | `connect-src`를 좁힐 때의 주석 |
| `sync-worker/src/shares.test.ts` | 새 종류 |
| `docs/live-check.md`, `package.json` | 점검 항목, 고정 이미지 스크립트 |

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
    └ checkShareSnapshot(…, 'read') → 종류별 본문(expand* → 읽기 전용 결과 컴포넌트)
    └ 내 앱에 가져오기 ─ stashImport(sessionStorage) ─ app.leaveShared()
        └ 관문(프로필 · 잠금 해제) → 온보딩(첫 실행)
        └ ImportHost: peekImport → planImport → 확인 창 → applyImport → app.set* → clearImport → 이동
```

## 5. 보안·약관

### 5.1 KIS 약관
- 원문: KIS Developers 공개 API `https://apiportal.koreainvestment.com/api/terms/public?termsType=MARKET`, 이름 「고객 이용약관」(2026-10-29 확인). 응답의 `version`은 28, `lastModifiedDate`는 2024-04-11이다. 본문의 부칙은 하나뿐이고 "본 약관은 2022년 10월 1일부터 시행한다"만 적혀 있다. 2024-04-11 수정에 대한 개정 부칙이나 시행일은 원문에 없다(2026-10-29 다시 확인).
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
- 캡처는 「화면 캡처 함께 보내기」가 켜져 있을 때만, 링크를 만든 뒤에만 올린다. **체크가 기본으로 켜져 있어 링크를 만들기만 해도 올라간다.** 대화 상자 문구가 이것을 먼저 말한다(4.2). 링크 복사만 하고 닫으면 지우기를 요청한다.
- 대화 상자를 닫지 않고 탭을 닫거나 페이지를 떠나면 지우기 요청이 보내지지 않거나 끝나지 못할 수 있다(`pagehide`에서 비동기 요청은 보장되지 않고, SDK 호출이라 `sendBeacon`으로 바꿀 수도 없다). 그런 캡처는 카카오 서버에 남는다.
- 카카오에 올린 이미지의 보관 기간·삭제 보장은 이 앱이 정하지 못한다. 보관 기간은 카카오 문서에서 **확인 필요**다. 대화 상자 문구로 철회해도 지울 수 없다고 알린다.
- 업로드 요청에는 이미지 파일만 담는다. 링크 주소·스냅샷은 담지 않는다.

### 5.4 가져오기
- 대기 값은 읽을 때 `checkShareSnapshot(…, 'read')`를 다시 지나야 쓴다(1.5-7). 저장 전 `sanitize*`를 한 번 더 지난다.
- 확인 창 없이는 아무것도 저장하지 않는다. 기존 데이터를 덮어쓰지 않고 늘 새로 만든다.
- 가져온 그룹으로 비교 화면을 열면 받은 사람의 키로 시세를 받는다. 받은 공유가 요청 대상을 고를 수 있는 것은 종목 코드뿐이고, 그 코드는 그룹·전략 종목·지정 종목·기준 비교 종목 모두 `SHARE_SYMBOL_RE`로 검사한다(2.7, 공유 경로에서만). 지금 전략·기준 정리 함수는 문자열인지만 보므로 이 검사가 없으면 아무 문자열이 받은 사람의 시세 요청 경로에 들어갈 수 있다.

## 6. 테스트

### 6.1 스냅샷 (`snapshot.test.ts`, 새 `compact.test.ts`·`checkResult.test.ts`)
- 새 종류 각각: 만든 스냅샷이 검사를 통과한다. 필드 하나 더하기 → `unknown-field`, 빼기·틀린 값 → `invalid`, 종목 위치 범위 밖 → `reference`.
- 금지 키: 새 타입 모든 키 경로를 모아 `FORBIDDEN_KEYS`와 겹치지 않음을 확인한다. 결과 안 아무 곳에 `token` 키를 넣으면 `forbidden-field`. 거래 이유 문자열에 UUID를 넣으면 `reference`.
- 반올림: 소수 셋째 자리가 있는 곡선 값은 `invalid`.
- 솎기: 같은 입력 두 번 → 같은 위치. 첫·끝·최고·최저·낙폭 점이 남는다. n ≤ m이면 그대로. 하한 120.
- 줄이는 순서: 3.5의 두 고정 데이터(3년 일봉·거래 300건, 3년 월간·상위 10)가 `reduced: []`로 들어간다. 거래 3,000건이면 `too-large`. 월간·상위 30·10년이면 `codes-only`까지 가서 들어간다.
- 100 KiB 경계: 크기를 맞춘 스냅샷으로 정확히 `SHARE_MAX_BYTES`는 통과, 1바이트 넘으면 `too-large`.
- 자금 숨김: qty·pnl이 null이고 JSON에 원래 초기 자금 숫자가 없다. 숨김인데 qty가 숫자면 `invalid`.
- 만든 쪽 왕복: 고정 데이터로 만든 결과 스냅샷을 `JSON.parse(JSON.stringify(s))` 뒤 `checkShareSnapshot(…, 'create')`에 넣으면 통과한다. `NaN`이 null을 허용하지 않는 자리(예: `summary.totalReturnPct`, `curves.strategy`)에 섞인 결과는 만들기에서 `{ ok: false, code: 'invalid' }`로 막히고 서버에 보내지 않는다. null을 허용하는 자리(`curves.index`의 원소)의 `NaN`은 null이 되어 통과한다. 축 4,000점 결과는 먼저 솎여 `reduced`에 `thinned`, `sampled.from` 4,000으로 통과한다.
- 받는 쪽 모드: 전략에서 키 하나를 지운 옛 스냅샷은 `create`에서 `invalid`, `read`에서 기본값이 채워져 통과. 모르는 키는 두 모드 모두 `unknown-field`. 모르는 `kind`는 `unsupported`.
- 종목 코드: 전략 `universe.symbols`·`benchmarks.symbol`, 기준 `benchmarks.symbols`, 결과의 `symbols`·`failed`·검증 `benchmarks`·선정 종목에 `../x`나 소문자 코드를 넣으면 거절, 중복도 거절. ETN(`Q500023`)이 든 그룹·전략·simResult는 통과하고, ETN이 든 묶음(criteria·validation의 `baskets`)은 거절한다. 같은 잘못된 코드가 든 전략이라도 `sanitizeStrategies`(저장·동기화 경로)는 지금처럼 받는다(회귀 방지).
- 깊이: 깊이 1,000의 중첩 객체는 예외 없이 `invalid`.
- 값 반올림: `finQuarter: 202406`, `leaderRank: 3`, `flowStreak: 12`는 그대로, `marketCap`·`return`은 4자리. `select.ts`가 만드는 키가 모두 `VALUE_KEYS`에 있다. 목록 밖 키·`__proto__`는 거절.
- 대응 검사(2.7의 수·거래·`perSymbol`·`failed`·validation 항목)마다 어긋난 예 하나씩.
- 제목·이름 길이: 이모지가 든 30 UTF-16 경계에서 서로게이트를 자르지 않는다.
- 펼치기: `expandSimResult`·`expandValidation`의 결과를 결과 화면 계산 함수(`resultHeadline`, `skipCounts` 등)가 받아 원래 값과 반올림 오차 안에서 같다.

### 6.2 가져오기 (`importPlan.test.ts`, `pendingImport.test.ts`)
- `uniqueName`: 충돌 없음, ` 2`, ` 2`도 있으면 ` 3`, 30자 이름 + ` 2` → 끝을 잘라 UTF-16 30, 끝이 이모지면 서로게이트 쌍째 자름, 결과가 `sanitizeStrategies`를 지나도 `repaired`가 아님.
- 그룹: 50종목 → 10개 + 안내, 종목 목록에 없는 코드 제외 + 개수, 종목 목록이 null이면 거르지 않음.
- compare: `applyView` 켬/끔, 바뀌는 설정이 4개 키뿐.
- 전략: 20개면 막힘, 새 ID·`updatedAt`, 자금 숨김 안내.
- 기준: 묶음 b0·b1 → 새 ID로 바뀐 `pool.baskets`, 묶음 29 + 2개면 막힘, 같은 이름 묶음끼리도 겹치지 않음.
- 대기 값: 30분 지나면 null, `peekImport`는 지우지 않고 `clearImport`가 지움, 망가진 JSON·검사 실패 → null, sessionStorage가 던지면 메모리로, simResult·validation은 strategy·criteria로 바뀌어 저장됨, 이미 가져온 `id`는 `이미 가져왔어요`.
- `leaveShared`(`app.svelte.ts` 테스트): 프로필 여럿 → 프로필 선택, 잠금 → 잠금 해제, `onboarded` false → 온보딩, 아니면 비교. 공유 해시가 지워진다.

### 6.3 컴포넌트
- `SharedView.test.ts`: 종류별 렌더(compare 요약, simResult 요약 카드·거래 줄·종목 이름, validation 카드·선정 이력), `unsupported`·`unreadable` 문구 구분, 자금 숨김 배지·가격만 보이는 거래 줄, 건너뜀 목록 없는 결과의 개수·탭 이름, 「규칙 전체 보기」에 `result`가 없음, UA `KAKAOTALK`이면 안내·단추(iOS 문구 포함), `내 앱에 가져오기`가 대기 값을 넣고 `onexit`을 부름. 종류마다 axe 위반 0. 단위 테스트용 axe 도구는 아직 없다. `@axe-core/playwright`가 이미 끌어오는 `axe-core@4.13.0`을 개발 의존성으로 명시하고 jsdom에서 `axe.run(container)`를 돌린다. jsdom은 색을 계산하지 않으므로 `color-contrast` 규칙은 끈다(대비는 기존 토큰 검사가 맡는다).
- `ImportHost.test.ts`: 관문 경로(`profiles`·`unlock`·`onboarding`)에서는 열리지 않고 대기 값이 남음, 일반 경로가 되면 열림, 인앱 문구, 막힘 문구와 꺼진 저장 단추, 저장 뒤 이동 경로와 `clearImport`, axe 위반 0.
- `ShareDialog.test.ts`: 거절 문구(`too-large`·`invalid`)와 꺼진 단추, `reduced` 안내, 결과 원문은 펼칠 때만 만들어짐, 캡처 미리 보기(data: URL)와 링크 전 화면의 체크(끄면 업로드 안 함), 링크 화면의 「이미지 빼고 보내기」(지우기 호출 + 고정 이미지 카드, 업로드 중에 누르면 늦게 온 응답의 이미지도 지우고 카드는 고정 이미지), 업로드 상태(`uploading` → `ready`), 업로드 실패 시 고정 이미지 카드, 보내지 않고 닫으면 지우기 호출, 보낸 뒤 닫으면 호출 안 함. 카카오 SDK와 업로드는 가짜로 넣는다.
- `kakao.test.ts`: 종류별 카드 설명 두 줄, 이미지 있음/없음, http 주소·200 미만 응답은 null.
- `cardImage.test.ts`: jsdom에는 canvas가 없으므로 그리기 호출을 기록하는 가짜 2D context로 배치(글 위치·값 목록 순서)와 `cardFile`의 5 MB 초과 null만 본다. `lwcStub.ts`에 `takeScreenshot`을 더한다.
- `ResultView`·`ValidationResult`·`TradeList`·`SymbolTab`의 새 prop(읽기 전용, 금액 숨김, `app` null).

### 6.4 sync-worker (`sync-worker/src/shares.test.ts`)
- 새 세 종류 생성이 200(지금 핸들러는 `ok()`로 200을 준다), 요청 `kind`와 스냅샷 `kind`가 다르면 422 `invalid`, 모르는 `kind`는 422 `unsupported`.
- 100 KiB 넘는 결과 스냅샷은 422 `too-large`(스냅샷 검사). 본문이 110 KiB를 넘으면 그보다 먼저 `readJson`이 413 `too-large`로 막는다. 두 경우를 따로 본다. 앱의 `describeFail(f, 'share')`는 둘 다 공유용 문구로 보인다.
- 깊이 1,000의 중첩 스냅샷은 500이 아니라 422.
- 읽기(`GET /v1/public/share`)가 새 종류를 그대로 돌려준다.

### 6.5 e2e
- 동기화 설정을 넣은 두 번째 빌드는 만들지 않는다(1.5-10). 지금 e2e 빌드에는 동기화 설정이 없어 SharedView가 `unavailable`이므로, SharedView 화면과 「내 앱에 가져오기」 → `leaveShared` 전이는 6.2·6.3이 덮는다.
- `tests/e2e/share.spec.ts`(지금 빌드, 모든 뷰포트 프로젝트): 대기 값(고정 compare·strategy·criteria 스냅샷, 그리고 validation에서 바뀐 criteria)을 sessionStorage에 넣는다. `page.addInitScript`는 다시 불러올 때마다 돌아 값을 다시 심으므로(`tests/e2e/helpers.ts`의 `openApp`도 이 방식) 쓰지 않는다. 첫 `page.goto` 뒤 `page.evaluate`로 **한 번만** 넣고 `page.reload()`한다.
  1. **온보딩 전:** 저장소가 빈 첫 실행으로 `#/compare`를 연다 → 온보딩이 먼저 뜨고 확인 창은 뜨지 않는다 → `데모로 둘러보기` → 확인 창 → `저장` → 만든 그룹의 비교 화면(또는 전략·기준 편집)이 열린다.
  2. **온보딩 후:** 데모로 온보딩을 마친 저장소에서 연다 → 바로 확인 창. 같은 이름 그룹을 먼저 만들어 두고 ` 2`로 저장되는지, `저장하지 않기`면 아무것도 생기지 않고 다시 열어도 창이 뜨지 않는지.
  3. 확인 창과 이동한 화면에서 axe 위반 0.

## 7. 오류 처리

| 상황 | 처리 |
|---|---|
| 결과가 100 KiB를 넘음(줄여도) | 대화 상자에 거절 문구, 링크 만들기 꺼짐. 서버에 보내지 않는다 |
| 서버가 422·413 `too-large` | 공유용 문구 `공유 내용이 너무 커요(100 KB). 기간이나 종목을 줄여 주세요`. `controller.svelte.ts`의 `describeFail(f, ctx)`에 `'profile' \| 'share'`를 넘겨, 공유 요청에서는 이 문구를, 프로필 동기화에서는 지금의 `프로필이 너무 커요(256 KiB)…`를 쓴다 |
| 만든 스냅샷이 클라이언트 검사를 통과하지 못함 | `이 결과는 공유 형식으로 바꾸지 못했어요`, 링크 만들기 꺼짐. 서버에 보내지 않는다(3.1) |
| 서버가 다른 422(`invalid`·`unknown-field`·`reference`·`unsupported`) | 지금처럼 `서버가 이 데이터를 받지 않았어요.` 앱과 Worker 버전이 다를 때 생긴다(배포 순서는 4.9) |
| 캡처 없음(빈 그룹·불러오는 중·거래 0건)·canvas 오류 | 캡처 부분을 숨기고 고정 이미지 |
| 업로드 실패·시간 초과(15초) | 고정 이미지 + 안내 한 줄. 카카오 단추는 쓸 수 있다 |
| SDK에 `uploadImage`가 없음(SDK 버전 변화) | 업로드를 건너뛰고 고정 이미지 |
| 받은 공유의 종류를 모름 | `unsupported` 문구(새로 고침 안내) |
| 받은 공유가 망가졌거나 정리할 수 없음 | `unreadable` 문구(다시 만들어 달라는 안내) |
| 이미 가져온 대기 값(탭 복제) | 스낵바 `이미 가져왔어요`, 확인 창 없음 |
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
- axe 검사는 받은 화면은 컴포넌트 테스트(6.3)에서, 확인 창과 이동한 화면은 e2e(6.5)에서 한다.
- 카카오톡 인앱 안내는 글 상자(`role="note"`)이고 `기본 브라우저로 열기`는 글자 단추다.

## 9. 사용자에게 물을 것
없음. 초안의 두 질문(자금 숨김일 때의 금액·수량, 검증 결과의 ② 전략)은 사용자가 추천안을 골라 1.3의 6·7번으로 옮겼다.

## 10. 실연결 점검
`docs/live-check.md`에 항목을 더한다.
- 운영 도메인에서 `Kakao.Share.uploadImage`가 성공하는지(등록 도메인·앱 키 권한), 돌려준 주소의 호스트와 크기 값.
- 업로드한 800×400(실제 1600×800) JPEG가 카카오톡 카드(PC·모바일)에서 잘리지 않는지. 고정 PNG도 같은 확인.
- `deleteImage` 뒤 그 주소가 더는 열리지 않는지, 이미 보낸 메시지의 이미지는 남는지.
- 카카오 업로드 이미지의 보관 기간(카카오 문서).
- 3년 일봉 실제 KIS 결과·실제 시장 파일 검증 결과의 스냅샷 크기(3.5 예산과 비교).
- 받은 사람이 PWA 옛 버전일 때 새 종류 링크가 어떻게 보이는지. 이번 변경 전의 앱은 모르는 종류를 다루지 못하므로(지금 `snapshotLines`·`KIND` 맵에 없는 값) 어떻게 깨지는지 한 번 보고, 새 버전 배포 뒤에는 `unsupported` 문구가 나오는지.
- 카카오톡 인앱 브라우저(Android·iOS)에서 `kakaotalk://web/openExternal?url=`이 기본 브라우저를 여는지. 안 되면 단추를 빼고 글 안내만 둔다(4.7). iOS 홈 화면 PWA와 Safari가 저장소를 따로 쓰는지(안내 문구의 근거).
- Workers Free 실행당 CPU 10 ms 안에서 100 KiB 결과 스냅샷 검사(금지 키·`jsonDiff`·결과 검사·`JSON.stringify`)가 끝나는지. 로컬 `wrangler dev`에서 3.5의 두 고정 데이터와 100 KiB 경계 스냅샷으로 재고, 넘으면 결과 부분의 동일성 비교를 줄인다.
