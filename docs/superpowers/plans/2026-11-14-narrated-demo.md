# 내레이션 데모 영상 구현계획

> 설계: `docs/superpowers/specs/2026-11-14-narrated-demo-design.md`. 이 계획과 다르면 설계를 따른다.
> 구현은 Codex가 한다. Codex 샌드박스는 네트워크가 막혀 있으니 **TTS·녹화·렌더·빌드는 실행하지 않는다.** 실행해 볼 것은 `node --test tests/demo-narrated.test.mjs`와 `node --check`뿐이다. 실제 실행은 Claude 세션이 나중에 한다.

**목표:** `pnpm demo:narrated` 한 번으로 `~/gazua-data/demo-narrated/`에 음성·자막이 들어간 3~5분 데모 영상(`final.mp4`, `final-phone.mp4`, `subtitles.srt`, `title.txt`, `desc.txt`)을 만든다.

**구성:** 장면 정의(`scenes.mjs`, 문장 + 조작) → Edge TTS로 문장별 음성 → Playwright로 폰 화면을 사람처럼 조작하며 CDP screencast 프레임 수집 → 문장별 겹침 PNG(배경·장 표시·폰 베젤·자막) → ffmpeg 합성 → 스킬의 `finish.sh`.

## 전체 제약

- 사용자에게 보이는 글(로그·대본·자막·주석)은 한국어 해요체.
- `scripts/lib/app-preview.mjs`, `scripts/demo-video.mjs`는 고치지 않는다.
- 새 npm 의존성은 더하지 않는다(`@playwright/test`, `pretendard` 이미 있음).
- 결과물은 저장소 밖 `DEMO_NARRATED_OUT`(기본 `~/gazua-data/demo-narrated`). 중간 파일은 그 아래 `work/`.
- 포트 `DEMO_NARRATED_PORT`(기본 4194).
- 스킬 스크립트 폴더 `NARRATED_VIDEO_SCRIPTS`(기본 `~/.claude/skills/narrated-video/scripts`): `tts.mjs`(`speak(voice, text, dir, who) → { file, dur }`), `finish.sh`(`sh finish.sh <출력.mp4> <음성.wav> <조각.mp4...>`, 출력 옆에 `<이름>-phone.mp4`도 만든다).
- 이 Mac의 ffmpeg에는 drawtext·subtitles 필터가 없다. 글자는 모두 PNG로 그린다.
- 상수: FPS 30, 음성 48kHz 모노, LEAD 0.4초(장 첫 문장 앞), GAP 0.5초(문장 뒤), TAIL 0.9초(장 마지막 문장 뒤).
- 녹화 뷰포트 390×844, `deviceScaleFactor: 2`, `isMobile: true`, `hasTouch: true`. 프레임 780×1688.
- 최종 화면: 폰 화면을 416×900으로 줄여 (752, 30)에 둔다. 겹침 PNG는 1920×1080, 그 사각형(모서리 반지름 40)만 투명.

## 파일

| 파일 | 할 일 |
|---|---|
| `scripts/demo-narrated/scenes.mjs` | 만들기. import 없음. `VOICE`, `LEAD`, `GAP`, `TAIL`, `SCENES` |
| `scripts/demo-narrated/human.mjs` | 만들기. 손가락 표시와 사람 같은 조작 도우미, screencast |
| `scripts/demo-narrated/frame.html` | 만들기. 겹침 PNG 틀 |
| `scripts/demo-narrated/make.mjs` | 만들기. 단계 `script`·`voice`·`record`·`render`·`finish` |
| `scripts/demo-narrated/script.md` | `make.mjs script`가 만든다(Codex는 같은 내용을 직접 생성해 커밋해도 됨: 아래 「script.md 형식」) |
| `tests/demo-narrated.test.mjs` | 만들기. 장면 정의 시험 |
| `package.json` | `scripts`에 `"demo:narrated": "pnpm build && node scripts/demo-narrated/make.mjs"` |
| `docs/development.md` | 110행 `demo:video` 줄 아래에 한 줄 |

## Task 1: 장면 정의와 시험

**Files:** `scripts/demo-narrated/scenes.mjs`, `tests/demo-narrated.test.mjs`

`scenes.mjs`의 모양:

```js
// 대본과 화면 조작. 사람이 읽는 판은 script.md(make.mjs script로 만든다).
// 문장(t)은 한 문장씩. say가 있으면 음성은 say를 읽고 자막은 t를 쓴다.
// do(h)는 그 문장을 읽는 동안 할 조작이다. h는 human.mjs의 makeHuman()이 만든다.
export const VOICE = { provider: 'edge', id: 'ko-KR-SunHiNeural', rate: '+5%' };
export const LEAD = 0.4, GAP = 0.5, TAIL = 0.9;
export const SCENES = [ { id, title, note, lines: [{ t, say?, do? }] }, ... ];
```

장 9개, id 순서: `intro`, `demo`, `compare`, `groups`, `simulate`, `criteria`, `performance`, `settings`, `outro`.

`h`가 주는 것(Task 2에서 만든다): `h.page`, `h.expect`, `h.tap(locator)`, `h.type(locator, text)`, `h.scrollTo(locator)`, `h.wait(ms)`, `h.select(locator, value)`, `h.chooseFile(locator, path)`, `h.nav(name)`(하단 내비게이션 버튼 `page.getByRole('navigation').getByRole('button', { name, exact: true })`를 tap), `h.fixture`(= `tests/fixtures/market-data-demo.json.gz` 절대 경로).

문장과 조작(문장은 이대로 쓴다. 조작의 선택자는 `scripts/demo-video.mjs`의 `MENU_SCENES`와 `scripts/lib/app-preview.mjs`에서 같은 것을 가져온다. 클릭은 반드시 `h.tap`, 확인은 `h.expect`):

1. `intro` — title `가즈아`, note `관심종목 비교 · 매매 규칙 시뮬레이션`
   - 「가즈아는 관심 있는 종목을 한 화면에서 비교하고, 내 매매 규칙을 과거 데이터로 시험해 보는 앱이에요.」 (조작 없음. 녹화는 첫 화면에서 시작한다)
   - 「휴대폰 브라우저로 열고 홈 화면에 추가하면 앱처럼 쓸 수 있어요.」
2. `demo` — title `데모로 둘러보기`, note `가상 시세로 모든 화면을 써 봐요`
   - 「증권사 키가 없어도 괜찮아요.」
   - 「첫 화면에서 데모로 둘러보기를 누르면, 가상 시세로 모든 화면을 써 볼 수 있어요.」 → tap `데모로 둘러보기` 버튼, expect `비교할 종목을 추가해 보세요` 보임
   - 「오늘은 이 데모로 하나씩 같이 눌러 볼게요.」
3. `compare` — title `비교 차트`, note `여러 종목을 한 차트에서`
   - 「먼저 예시 그룹을 불러올게요.」 → tap `예시 그룹 불러오기`, expect 리더보드 항목 4개
   - 「그룹에 담은 종목들이 한 차트에 겹쳐 그려져요.」 → wait 800
   - 「기간은 일, 주, 월, 년으로 바꿀 수 있어요.」 → radio `주`, `월`, `년` 차례로 tap(사이 wait 500)
   - 「비교 기준도 바꿀 수 있어요.」 → tap 버튼 `/^등락률/`, expect dialog `비교 지표` 보임
   - 「이번엔 고점 대비 하락률을 골라 볼게요.」 → dialog 안 `/^고점 대비 하락률/` tap, expect dialog 숨김
   - 「아래 순위표도 그 기준으로 다시 줄을 서요.」 → scrollTo 리더보드 region, tap `값 순`
4. `groups` — title `종목 추가 · 그룹`, note `이름·초성으로 찾아 담아요`
   - 「종목을 더 담아 볼게요.」 → scrollTo + tap 리더보드의 `＋ 종목 추가`, expect dialog `종목 추가`
   - 「이름은 물론, 초성만 쳐도 찾아져요.」 → `h.type(searchbox '종목 검색', 'ㅅㅅㅈㄱ')`, expect `삼성전기 추가` 버튼 보임
   - 「삼성전기를 눌러 담고, 완료를 눌러요.」 → tap `삼성전기 추가`, expect sheet에 `5/10`, tap `완료`, expect sheet 숨김
   - 「그룹은 여러 개 만들 수 있어요.」 → scrollTo + tap `새 그룹`(exact), expect tab `새 그룹 2` 선택됨
   - 「그룹 관리에서 이름과 순서를 바꿔요.」 → tap `그룹 관리`, tap `새 그룹 2 이름 바꾸기`, textbox `그룹 이름`에 `h.type`(먼저 `fill('')`로 비움) `내 반도체`, `press('Enter')`, expect `내 반도체 이름 바꾸기` 보임
   - 「조건으로 종목을 골라 새 그룹을 만드는 것도 여기서 해요.」 → scrollTo `조건으로 골라 새 그룹 만들기` 버튼, wait 600, 그다음 시트를 닫는다(시트의 닫기 버튼을 `h.tap`. 이름은 `src/sheets/GroupSheet.svelte`에서 확인, 없으면 `Escape`). 닫은 뒤 tablist `관심 그룹`의 첫 탭(종목이 든 예시 그룹)을 `h.tap`하고 `aria-selected="true"`를 확인한다. 빈 `내 반도체` 그룹이 선택된 채로 두면 다음 장의 새 전략이 그 그룹을 대상으로 잡아 실행이 막힌다(`StrategyList.svelte`가 마지막 그룹을 기본 대상으로 쓴다)
5. `simulate` — title `매매 규칙 시뮬레이션`, note `내 규칙을 과거 일봉에 적용해요`
   - 「이제 시뮬레이션 메뉴로 가 볼게요.」 → `h.nav('시뮬레이션')`, expect `내 매매 규칙을 과거 데이터로 시험해 보세요`
   - 「새 전략을 누르면 자주 쓰는 틀이 나와요.」 → tap `＋ 새 전략`, expect `/하락 후 반등/` 버튼
   - 「하락 후 반등을 골라 볼게요.」 → tap `/하락 후 반등/`, expect `시뮬레이션 실행` 버튼
   - 「언제 살지 매수 조건을 칸마다 정해요.」 → 구역 `매수 조건` 펼치기(아래 「구역 펼치기」), scrollTo 그 구역
   - 「팔 때의 조건도 같은 방식으로 정해요.」 → 구역 `매도` 펼치기, scrollTo
   - 「시뮬레이션 실행을 누르면 과거 일봉에 규칙을 그대로 적용해요.」 → scrollTo + tap `시뮬레이션 실행`, 결과 region `시뮬레이션 결과`(`.last()`)에서 `총수익률` 보임(timeout 30000)
   - 「총수익률과 최대 낙폭, 승률을 그냥 보유했을 때와 나란히 보여 줘요.」 → scrollTo 결과 region
   - 「재생을 누르면 그날그날 사고판 기록을 다시 보여 줘요.」 → 결과 안 group `재생` scrollTo, 그 안 `재생`(exact) tap, expect `일시정지` 버튼
   - 「아래에는 그날의 상황이 함께 나와요.」 → region `그날 상황` scrollTo, wait 1500, `일시정지` tap
   - 구역 펼치기: `const head = page.locator('button[aria-expanded]', { has: page.getByText(title, { exact: true }) }); await h.scrollTo(head); await h.tap(head); await h.expect(head).toHaveAttribute('aria-expanded', 'true');`
6. `criteria` — title `선정 기준 검증`, note `그때 이 기준으로 골랐다면`
   - 「선정 기준 검증은 시장 전체 데이터가 있어야 해서, 설정에서 데이터 파일을 먼저 가져와요.」 → `h.nav('설정')`, expect heading `데이터 공급자`, `h.chooseFile(button '시장 데이터 가져오기', h.fixture)`, expect `/30종목/`(timeout 30000)
   - 「다시 시뮬레이션으로 와서 선정 기준 탭을 눌러요.」 → tap `비교로 돌아가기`, `h.nav('시뮬레이션')`, tap tab `선정 기준`(exact), expect selected
   - 「새 기준을 만들고, 고를 조건을 켜요.」 → tap `＋ 새 기준`(`.first()`), scrollTo + tap switch `시가총액 사용`, expect checked
   - 「몇 개를 고를지, 얼마나 자주 다시 고를지도 정해요.」 → 구역 `고를 개수·정렬` 펼치기, textbox `고를 개수`(exact)를 `fill('')` 뒤 `h.type(…, '10')`, 구역 `재선정·기간` 펼치기, radio `매월` tap
   - 「오늘 기준으로 몇 종목이 통과하는지 바로 미리 보여 줘요.」 → region `오늘 기준 미리 보기`의 status가 `/통과 \d+개 · 상위 \d+개/`(timeout 30000), scrollTo 그 region
   - 「검증 실행을 누르면 과거 시점마다 이 기준으로 골랐다면 어땠을지 계산해요.」 → scrollTo + tap `검증 실행`, expect heading `오늘 기준 선별`(timeout 60000)
   - 「결과는 요약과 시장별 보기로 나눠 볼 수 있어요.」 → scrollTo heading `요약`(exact), wait 800, scrollTo region `시장별 보기`
7. `performance` — title `내 성과`, note `내 주문 vs 같은 날 지수·ETF`
   - 「내 성과는 실제로 체결된 주문을 지수와 비교하는 메뉴예요.」 → `h.nav('내 성과')`, expect `데모 계좌예요`
   - 「데모에서는 가상 계좌로 보여 줘요.」
   - 「같은 날 같은 금액으로 ETF를 샀다면 어땠을지 나란히 놓아요.」 → `h.select(getByLabel('벤치마크'), '069500')`, expect 요약 region에 `KODEX 200 연수익률`
   - 「기간을 올해로 좁히고, 표로도 볼 수 있어요.」 → `h.select(getByLabel('기간'), '2026')`, scrollTo + tap `표 보기`, scrollTo table `날짜별 평가금액과 회수액`
   - 「종목을 누르면 체결 내역이 펼쳐져요.」 → scrollTo + tap 버튼 `/삼성전자/`, scrollTo table `삼성전자 체결 목록`
8. `settings` — title `설정`, note `증권사 연결 · 화면 꾸미기`
   - 「마지막으로 설정이에요.」 → `h.nav('설정')`, scrollTo radiogroup `데이터 공급자`(exact)
   - 「실제 시세를 보려면 한국투자증권이나 토스증권을 고르고 키를 넣어요.」 → tap radio `한국투자증권 (KIS)`(exact), scrollTo `App Key` 입력(값은 넣지 않는다)
   - 「키는 암호로 잠가 둘 수도 있어요.」 → scrollTo switch `키를 암호로 잠그기`(누르지 않는다)
   - 「표시에서는 밝기와 색 테마를 고를 수 있어요.」 → scrollTo heading `표시`, radiogroup `테마` 안 `다크`가 있으면 tap(Segmented 선택지 이름은 `src/routes/Settings.svelte`의 `THEMES`에서 확인)
   - 「취향에 맞는 색으로 바꿔 보세요.」 → radiogroup `색 테마` 안 radio `숲` tap, wait 600, radio `장미` tap
9. `outro` — title `마무리`, note `gazua.sch0718.dev`
   - 「가즈아는 무료로 열어 두었어요.」 → tap `비교로 돌아가기`
   - `{ t: '주소는 gazua.sch0718.dev예요.', say: '주소는 가즈아 점 에스씨에이치 공칠일팔 점 데브예요.' }`
   - 「설명란에도 주소를 적어 둘게요.」
   - 「화면의 시세는 모두 가상 데이터이고, 투자 조언이 아니에요.」
   - 「봐 주셔서 고마워요.」

`tests/demo-narrated.test.mjs`(node:test, `assert/strict`):

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { SCENES, VOICE } from '../scripts/demo-narrated/scenes.mjs';

const IDS = ['intro', 'demo', 'compare', 'groups', 'simulate', 'criteria', 'performance', 'settings', 'outro'];
const lines = SCENES.flatMap((s) => s.lines);

test('장 9개가 정해진 순서예요', () => {
  assert.deepEqual(SCENES.map((s) => s.id), IDS);
  for (const s of SCENES) assert.ok(s.title && s.note && s.lines.length > 0, s.id);
});

test('문장은 한 문장씩, 조작은 함수예요', () => {
  for (const l of lines) {
    assert.match(l.t, /\S[.?!]$/, l.t);
    assert.doesNotMatch(l.t.slice(0, -1), /[.?!]\s/, l.t);
    if ('do' in l) assert.equal(typeof l.do, 'function', l.t);
    if ('say' in l) assert.ok(typeof l.say === 'string' && l.say.trim(), l.t);
  }
});

test('분량은 900~1,400자이고 마무리에 주소와 안내가 있어요', () => {
  const n = lines.reduce((a, l) => a + l.t.length, 0);
  assert.ok(n >= 900 && n <= 1400, `${n}자`);
  const outro = SCENES.at(-1).lines.map((l) => l.t).join(' ');
  assert.match(outro, /투자 조언이 아니에요/);
  assert.match(outro, /gazua\.sch0718\.dev/);
  assert.equal(VOICE.provider, 'edge');
});
```

주소 문장 `gazua.sch0718.dev예요.`는 `.`이 공백 없이 이어져 두 번째 검사를 통과한다.

분량이 900자 밑이면 문장을 늘리지 말고 Claude 세션에 맡긴다(실행 후 길이를 보고 조정한다). Codex는 위 문장을 그대로 쓴다.

검증: `node --test tests/demo-narrated.test.mjs` 통과.

## Task 2: 사람 같은 조작 도우미 `human.mjs`

**Produces:** `export const FINGER_SCRIPT`(addInitScript용 문자열 또는 함수), `export function makeHuman(page, { expect, fixture })`, `export async function startScreencast(page, dir) → { stop(): Promise<{ frames: { file: string, t: number }[] }> }`(t는 epoch 초).

- 손가락 표시: `addInitScript`로 넣는다. `DOMContentLoaded` 뒤 `document.documentElement`에 `div#__finger`(`position:fixed; left:0; top:0; width:44px; height:44px; margin:-22px 0 0 -22px; border-radius:50%; background:rgba(255,255,255,.35); border:2px solid rgba(20,20,20,.55); box-shadow:0 2px 10px rgba(0,0,0,.35); pointer-events:none; z-index:2147483647; transform:translate(x,y); opacity:0; transition:opacity .2s`)와 `aria-hidden="true"`. 처음 위치는 화면 가운데 아래(195, 700). `window.__finger = { move(x, y, ms), press(), show() }`:
  - `move`: 지금 위치에서 (x, y)까지 2차 베지어(제어점은 두 점 중간에서 선분에 수직으로 거리의 15~25% 떨어진 곳, 방향은 무작위), ease-in-out(`t<.5 ? 2t² : 1-(-2t+2)²/2`), `requestAnimationFrame`. 끝나면 resolve하는 Promise.
  - `press`: 원 `scale(.8)` 120ms 뒤 되돌림, 같은 자리에 물결 원(지름 44 → 110, 불투명도 .5 → 0, 450ms) 하나를 만들고 끝나면 지운다.
- `makeHuman(page, { expect, fixture })`가 돌려주는 `h`:
  - `wait(ms)`: `setTimeout`(Node).
  - `scrollTo(locator)`: `locator.evaluate`로 스크롤 부모(위로 올라가며 `overflowY`가 `auto|scroll`이고 `scrollHeight > clientHeight`인 첫 요소, 없으면 `document.scrollingElement`)를 찾고, 요소 가운데가 뷰포트 높이 40% 지점에 오도록 목표 `scrollTop`을 계산(0~최대로 자름). 차이가 8px 미만이면 바로 끝. 아니면 거리 비례 500~800ms ease-in-out으로 `scrollTop`을 바꾸고 끝날 때 resolve. 뒤에 wait 150.
  - `tap(locator)`: `await locator.waitFor({ state: 'visible' })`. 상자가 화면(0~844) 밖이면 `scrollTo` 먼저. `boundingBox()` 가운데 ± 상자 크기의 15% 안 무작위 점으로 `__finger.move`(거리에 따라 350~900ms) → wait 120 → `__finger.press()` → `locator.click()` → wait 250.
  - `type(locator, text)`: `tap(locator)` → `locator.pressSequentially(text, { delay: 110~160 사이 무작위 하나 })`.
  - `select(locator, value)`: `tap` 대신 손가락만 이동·press(네이티브 선택 창은 안 뜬다) → `locator.selectOption(value)` → wait 300.
  - `chooseFile(locator, path)`: `const chooser = page.waitForEvent('filechooser'); await h.tap(locator); await (await chooser).setFiles(path);`
  - `nav(name)`: `tap(page.getByRole('navigation').getByRole('button', { name, exact: true }))`.
  - `page`, `expect`, `fixture`.
  - 무작위는 시드 고정 의사난수(예: mulberry32(7))로 해서 다시 만들어도 같게 한다.
- `startScreencast(page, dir)`: `const cdp = await page.context().newCDPSession(page)`; `Page.screencastFrame`마다 `writeFileSync(join(dir, \`${pad6(i)}.jpg\`), Buffer.from(data, 'base64'))`, `frames.push({ file, t: Number.isFinite(metadata.timestamp) ? metadata.timestamp : Date.now() / 1000 })`(타임스탬프는 선택 필드라 없으면 받은 시각), 그다음 `Page.screencastFrameAck({ sessionId })`. 시작: `Page.startScreencast({ format: 'jpeg', quality: 90, maxWidth: 780, maxHeight: 1688, everyNthFrame: 1 })`. `stop()`: `Page.stopScreencast`, 진행 중 쓰기 끝나길 기다리고 `cdp.detach()`, `{ frames }` 반환.

## Task 3: 겹침 틀 `frame.html`

1920×1080, `html, body { margin:0; width:1920px; height:1080px; background:transparent; overflow:hidden }`. 글꼴은 `../../node_modules/pretendard/dist/web/variable/pretendardvariable.css`를 `<link>`(파일 URL로 열므로 상대 경로가 맞다). `window.draw(spec)` → `document.fonts.ready` Promise.

`spec = { index, total, title, note, chapters: string[], sub }`:
- 배경 SVG(전체 1920×1080): `<path fill-rule="evenodd">`로 전체 사각형에서 폰 화면 자리(x 752, y 30, w 416, h 900, 모서리 40) 구멍을 뺀다. 채움은 세로 그라데이션 `#10141c → #1b2230`.
- 베젤: 같은 사각형 바깥에 두께 12px 둥근 테두리(`#05070a`, 바깥 반지름 52), 그 바깥 1px `#3a4252` 선.
- 왼쪽(x 96~660): `index/total`(`3 / 9`, 26px, 불투명도 .6), 장 제목(64px, 800), 한 줄 설명(30px, `#c8d0e0`), 그 아래 9개 장 목록(26px, 지금 장은 흰색 굵게 + 왼쪽 막대 `#8fb0ff`, 나머지 불투명도 .45).
- 오른쪽 위(x 1260~1840, y 72): `가즈아` 34px 800 + `gazua.sch0718.dev` 24px 불투명도 .7.
- 자막(`sub`가 있을 때): 가운데 정렬, 상자 `left:50%; transform:translateX(-50%); top:948px; max-width:1760px; padding:12px 28px; background:rgba(8,12,18,.78); border-radius:12px; font-size:38px; font-weight:600; line-height:1.35; word-break:keep-all; text-wrap:balance`. 두 줄까지(넘치면 make.mjs가 경고만 낸다).
- 문자열은 `textContent`로 넣는다(HTML 이스케이프).

## Task 4: 단계 실행 `make.mjs`

`node scripts/demo-narrated/make.mjs [단계...]`. 단계: `script`, `voice`, `record`, `render`, `finish`. 인자 없으면 `script voice record render finish` 순서. 시작 때 `check()`.

- 경로: `OUT = process.env.DEMO_NARRATED_OUT ?? join(homedir(), 'gazua-data/demo-narrated')`, `WORK = join(OUT, 'work')`, `SK = process.env.NARRATED_VIDEO_SCRIPTS ?? join(homedir(), '.claude/skills/narrated-video/scripts')`.
- `check()`: `SK/tts.mjs`, `SK/finish.sh` 존재, `uvx`·`ffmpeg`·`ffprobe`가 PATH에 있는지(`execFileSync('which', [x])`). 없으면 `없어요: …` 출력 후 `process.exit(1)`.
- `lineList()`: `SCENES.flatMap((s, si) => s.lines.map((l, li) => ({ si, li, first: li === 0, last: li === s.lines.length - 1, ...l })))`.

**script**: `scripts/demo-narrated/script.md`를 쓴다. 형식:

```
# 가즈아 데모 영상 대본

> scenes.mjs에서 만든 파일이에요. 고칠 때는 scenes.mjs를 고치고 `node scripts/demo-narrated/make.mjs script`를 다시 돌려요.
> 음성: Edge TTS ko-KR-SunHiNeural (+5%)

## 1. 가즈아 — 관심종목 비교 · 매매 규칙 시뮬레이션

- 문장 (읽기: say가 있으면 괄호로)
```

**voice**: `const { speak } = await import(pathToFileURL(join(SK, 'tts.mjs')))`. 문장마다 `speak(VOICE, l.say ?? l.t, join(WORK, 'voice'), 'narr')` → `WORK/voice.json`에 `[{ si, li, t, file, dur }]`. 합계 초를 출력.

**record**: `voice.json`이 없으면 오류. `startPreview({ port: envPort('DEMO_NARRATED_PORT', 4194) })`, `chromium.launch({ headless: true })`. 컨텍스트:

```js
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  locale: 'ko-KR', timezoneId: 'Asia/Seoul', serviceWorkers: 'block',
});
context.setDefaultTimeout(15_000);
await context.addInitScript((seen) => localStorage.setItem('gazua:help-seen:v1', JSON.stringify(seen)),
  ['compare', 'add', 'groups', 'simulate', 'criteria', 'performance', 'settings']);
await context.addInitScript(FINGER_SCRIPT);
const page = await context.newPage();
await page.clock.setFixedTime(new Date(FIXED_NOW));
await openApp(page, url);
await page.evaluate(() => window.__finger.show());
await sleep(600);
```

`WORK/frames/`를 비우고 `startScreencast`. `t0 = Date.now() / 1000`. 문장마다:

```js
const start = Date.now() / 1000 - t0;
const pre = l.first ? LEAD : 0, post = l.last ? TAIL : GAP;
marks.push({ si, li, start, voiceAt: start + pre, dur, t: l.t });
try { if (l.do) await l.do(h); } catch (e) { throw new Error(`${scene.id} 「${l.t}」: ${e.message}`); }
const left = t0 + start + pre + dur + post - Date.now() / 1000;
if (left > 0) await sleep(left * 1000);
```

끝: `end = Date.now()/1000 - t0`, `stop()`. `frames.json = { end, frames: frames.map(f => ({ file: f.file, t: f.t - t0 })) }`, `marks.json = marks`. `finally`에서 브라우저·서버 닫기. 실패하면 메시지 출력, `process.exitCode = 1`.

**render**:
1. 겹침: 브라우저 페이지(뷰포트 1920×1080)로 `frame.html`을 `file://`로 열고, 문장마다 `draw({ index: si+1, total: 9, title, note, chapters: SCENES.map(s => s.title), sub: t })` 뒤 `page.screenshot({ path: WORK/ov/NNN.png, omitBackground: true })`. 자막 상자 높이가 110px를 넘으면 경고 출력.
2. 프레임 목록 `WORK/frames.txt`: 0초 이전 프레임은 버리되 그중 마지막 하나를 0초로 옮겨 쓴다(없으면 첫 프레임을 0초로). 프레임 i의 `duration` = 다음 프레임 t − 이 프레임 t, 마지막은 `end − t`. 0 이하 duration은 건너뛴다. 끝에 마지막 `file` 줄을 한 번 더 쓴다(concat 관례). 목록 안 파일 경로는 절대 경로로 쓰고, `file` 줄마다 바로 뒤에 `option framerate 1000`을 붙인다(이미지 입력 기본 25fps에 시각이 0.04초 단위로 뭉개지지 않게).
3. 겹침 목록 `WORK/ov.txt`: 겹침 i는 `marks[i].start`(i=0이면 0)부터 `marks[i+1].start`(마지막이면 `end`)까지. 같은 방식(절대 경로, `option framerate 1000`, 마지막 줄 반복).
4. ffmpeg(`execFileSync`, `stdio: 'inherit'`, 경로는 모두 `join(WORK, …)` 절대 경로):

```
ffmpeg -v error -y -f concat -safe 0 -i WORK/frames.txt -f concat -safe 0 -i WORK/ov.txt -filter_complex
 "[0:v]fps=30,scale=416:900:flags=lanczos,setsar=1,pad=1920:1080:752:30:black[s];[1:v]fps=30,format=rgba[o];[s][o]overlay=0:0:format=auto,format=yuv420p[v]"
 -map "[v]" -t <end> -r 30 -c:v libx264 -preset medium -crf 18 -g 60 WORK/video.mp4
```

5. 음성 `WORK/audio.wav`: 길이 `ceil(end * 48000)` 샘플 무음 PCM에, 문장마다 `ffmpeg -v error -i <file> -f s16le -ar 48000 -ac 1 -`로 읽은 PCM을 `round(voiceAt * 48000)` 위치에 복사(넘치면 자름). 44바이트 WAV 헤더(16bit 모노 48k)를 붙인다. 이베리아 `build-audio.mjs`와 같은 방식.
6. `WORK/timeline.json = { fps: 30, end, lines: marks }`.

**finish**:
1. `subtitles.srt`: 문장마다 번호, `voiceAt → voiceAt + dur`(`HH:MM:SS,mmm`), 자막 `t`.
2. `title.txt`: `가즈아 둘러보기 — 관심종목 비교와 매매 규칙 시뮬레이션 (데모)`.
3. `desc.txt`(한 줄씩): 앱 소개 한 줄, `앱 주소: https://gazua.sch0718.dev/`, `화면의 시세와 계좌는 모두 데모용 가상 데이터예요.`, `투자 조언이 아니에요. 투자 판단과 책임은 본인에게 있어요.`, `내레이션: Microsoft Edge TTS (ko-KR-SunHiNeural)`, `소스: https://github.com/sch0718/gazua`. `<`·`>`는 쓰지 않는다.
4. `sh SK/finish.sh OUT/final.mp4 WORK/audio.wav WORK/video.mp4` → `final.mp4`, `final-phone.mp4`.
5. 점검 출력: `ffprobe -v error -show_entries stream=codec_type,codec_name,width,height,r_frame_rate,duration -show_entries format=duration -of json OUT/final.mp4`. 1920×1080, 30/1, h264+aac, 길이 180~300초, 영상·음성 스트림 길이 차 0.2초 이하인지 보고 각 줄 `통과/다름`으로 출력한다. 다름이 있으면 `process.exitCode = 1`(파일은 그대로 둔다).

`main` 실행은 `if (process.argv[1] === fileURLToPath(import.meta.url))`로 감싼다(시험이 import해도 돌지 않게. 시험은 `scenes.mjs`만 import하지만 같은 관례를 따른다).

## Task 5: package.json, 문서

- `package.json` `scripts`의 `demo:video` 다음 줄: `"demo:narrated": "pnpm build && node scripts/demo-narrated/make.mjs",`
- `docs/development.md` 110행 아래:

```
DEMO_NARRATED_PORT=4194 corepack pnpm demo:narrated            # 음성 내레이션 데모 영상(~/gazua-data/demo-narrated/final.mp4, 단계만: node scripts/demo-narrated/make.mjs voice|record|render|finish)
```

## 검증 (Codex)

```bash
node --check scripts/demo-narrated/make.mjs
node --check scripts/demo-narrated/human.mjs
node --test tests/demo-narrated.test.mjs
node scripts/demo-narrated/make.mjs script   # check()가 도구 없음으로 멈추면 script 단계만은 check 없이 돌게 해도 된다
```

커밋은 하나로: `feat: 음성 내레이션 데모 영상(pnpm demo:narrated)`. 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## 실행·확인 (Claude 세션)

1. `corepack pnpm build` → `node scripts/demo-narrated/make.mjs voice`로 길이 확인(음성 합 150~240초가 목표).
2. `record` → `render` → `finish`를 백그라운드로.
3. `ffprobe` 점검 줄, 프레임 12장(`ffmpeg -ss <초> -frames:v 1`)을 Read로 보고 자막·조작이 맞는지 확인.
4. 길이가 3~5분을 벗어나거나 조작이 어긋나면 `scenes.mjs`의 대기(wait)나 문장을 고쳐 다시 돌린다.
