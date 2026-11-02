# impeccable 시범 적용 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** impeccable `detect`를 프로젝트 단위로 붙여 `pnpm lint:design`을 만들고, 실제 문제 1건(placeholder 대비)을 고치고, 오탐률을 기록한다(공용화는 측정 결과를 보고 따로 정함).

**Architecture:** 설계는 `docs/superpowers/specs/2026-11-03-impeccable-trial-design.md`다. 도구는 devDependency로만 들어오고, 기준선은 소스 줄 끝 인라인 주석이다. 고치는 코드는 `src/lib/ui/tokens.css`의 전역 `::placeholder` 한 블록이다.

**Tech Stack:** pnpm 10, Svelte 5, vitest 3, Playwright 1.63, impeccable 4.8.0(엔진 0.1.18).

## Global Constraints

- 전역 설치를 하지 않는다. `impeccable`은 `devDependencies`에 `4.8.0`(정확한 버전)으로만 둔다.
- `impeccable install`·`skills`·`live` 명령과 생성형 명령(bolder, overdrive, colorize 등)을 돌리지 않는다.
- impeccable을 돌릴 때는 늘 `DO_NOT_TRACK=1 IMPECCABLE_NO_TELEMETRY=1`을 붙인다.
- CI 워크플로(`.github/workflows/*`)는 바꾸지 않는다.
- `@sch0718/ui-svelte`(공용 패키지) 스타일을 덮어쓰지 않는다.
- 사용자에게 보이는 글·문서는 한국어, 해요체.
- 세 저장소 버전 고정·공용 위치 이전의 설계·작업은 하지 않는다(2026-11-03 범위 축소).

---

### Task 1: `lint:design` 스크립트와 줄 단위 기준선

**Files:**
- Modify: `package.json` (scripts, devDependencies는 이미 `"impeccable": "4.8.0"`)
- Modify: `src/lib/ui/simulate/ResultView.svelte:304`

**Interfaces:**
- Produces: `pnpm lint:design` — 종료 코드 0(지적 없음)·2(지적 있음).

- [x] **Step 1: 기준선 없이 실패 확인** — 계획 작성 중에 확인했어요(2026-11-03). 주석을 달기 전 `DO_NOT_TRACK=1 IMPECCABLE_NO_TELEMETRY=1 pnpm exec impeccable detect src index.html`은 `line 304: [side-tab] border-left: 3px solid var(--accent)` 1건과 종료 코드 `2`였어요. Step 3 주석은 그때 문법 확인을 위해 이미 달았어요. 다시 보려면 `git show HEAD:src/lib/ui/simulate/ResultView.svelte`로 만든 사본을 검사해요.

- [ ] **Step 2: 스크립트 추가** (`"check:e2e"` 다음 줄)

```json
    "lint:design": "DO_NOT_TRACK=1 IMPECCABLE_NO_TELEMETRY=1 impeccable detect src index.html",
```

- [x] **Step 3: 304행 줄 끝 주석** (이미 반영됨)

```css
    border-left: 3px solid var(--accent); /* impeccable-disable-line side-tab -- 지난 실행 결과 표시(투명도 대신 고른 강조선) */
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm lint:design; echo $?`
Expected: 지적 없이 `0`

### Task 2: placeholder 색을 `--t3`로 (TDD)

**Files:**
- Test: `src/lib/ui/tokens.test.ts` (`describe('tokens.css')` 안, `html and body turn off …` 테스트 다음)
- Modify: `src/lib/ui/tokens.css` (파일 끝)

- [ ] **Step 1: 실패하는 테스트**

```ts
  it('placeholder uses --t3 (AA on every surface) instead of the browser default (#757575, 4.3:1 on --bg)', () => {
    const rule = block('::placeholder');
    expect(rule).toMatch(/color:\s*var\(--t3\)/);
    expect(rule).toMatch(/opacity:\s*1/);
  });
```

`--t3`의 대비는 같은 파일의 `text contrast (WCAG AA 4.5:1) on bg, surface and surface 2`가 이미 본다.

- [ ] **Step 2: 실패 확인**

Run: `pnpm test src/lib/ui/tokens.test.ts`
Expected: FAIL (`::placeholder` 블록 없음)

- [ ] **Step 3: 구현** (`tokens.css` 끝)

```css
/* 입력 placeholder: 브라우저 기본색(#757575)은 --bg 위 4.3:1이라 AA 미달 → 모든 면에서 AA인 --t3.
   Firefox는 placeholder에 불투명도를 따로 줘서 1로 맞춘다(공용 기본 스타일에는 placeholder 지정이 없다). */
::placeholder {
  color: var(--t3);
  opacity: 1;
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm test src/lib/ui/tokens.test.ts`
Expected: PASS

- [ ] **Step 5: 렌더 확인** — spec D3-1 절차로 `pnpm build` 뒤 설정 화면(`#/settings`)을 폰·데스크톱에서 `--cdp`로 스캔한다.
Expected: 프록시 주소 입력(`ConnectionForm.svelte`, 선택자 `#<uid>-url`)이 화면에 있는 상태에서 `low-contrast` 지적 0건. 입력이 안 보이면 0건으로 세지 않는다

### Task 3: 검토 문서 기록

**Files:**
- Modify: `docs/proposals/2026-11-02-external-tools.md` (1절 끝, 「가즈아에서 특히 쓸모 있는 곳」 다음에 `### 가즈아 시범 결과 (2026-11-03)`)

- [ ] **Step 1:** 다음을 적는다(수치는 spec 「검사 결과」·「분류」와 같게).
  - 설치 확인: 출처·버전·설치 스크립트 없음·체크섬·홈과 저장소 무변화
  - 방식별 건수: 정규식 1(1번), HTML 엔진 2(2·3번), 렌더 26(고유 7, 4~10번)
  - 오탐률: 고유 10건 중 실제 1(10%)·오탐 3(30%)·취향 6(60%)
  - 기준선: 인라인 주석 1개, 렌더 스캔 분류표
  - 렌더 스캔 재실행 절차(spec D3-1 요약)
  - 공용화: 「측정 결과를 보고 따로 정함」 한 문단과 판단에 쓸 사실(정적 0건·렌더 1건·정밀도 10%)
  - 후속(공용 패키지에서 온 placeholder·Badge 10px, `phone-narrow` 360px 편집기 점검, 묶음 사이 「또는」 낭독)
- [ ] **Step 2:** 머리말 3행의 "설치·실측은 하지 않았어요"와 5행의 "지금은 기록만 하고, 설치나 코드 변경은 하지 않았어요."를, 1절 impeccable은 2026-11-03 가즈아 시범을 했다는 문장과 시범 결과 절 안내로 고친다.

### Task 4: 전체 검증과 PR

- [ ] **Step 1:** `pnpm check && pnpm check:e2e && pnpm test && pnpm test:scripts` — 모두 0
- [ ] **Step 2:** `pnpm e2e` (백그라운드) — 모두 통과
- [ ] **Step 3:** `git status`에 의도한 파일만 있는지 확인한다. spec 「설치 전후 비교」의 17개 파일을 `cd ~ && shasum <목록>`으로 다시 재서 scratchpad의 `home-before.sha`와 `diff`한다(같아야 함). `~/.impeccable`이 없는지 본다
- [ ] **Step 4:** 커밋 → push → PR(병합하지 않음), CI 결과 확인
