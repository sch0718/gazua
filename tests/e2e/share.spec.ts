import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { enterDemo, FIXED_NOW, isWide, leaderboardRows, openApp } from './helpers';

// 지금 e2e 빌드에는 동기화 설정이 없어 SharedView는 unavailable이다. 그래서 「내 앱에 가져오기」가 남기는 대기 값을
// 직접 넣고, 관문·온보딩 → 확인 창 → 저장 → 이동을 본다(설계 1.5-10, 6.5). SharedView 화면은 컴포넌트 테스트가 덮는다.
// playwright.config.ts의 phone-narrow는 compare.spec.ts·layout.spec.ts만 실행한다.
const KEY = 'gazua:v1:share-import';
const TITLE = '이 프로필에 저장할까요?';
const AT = Date.parse(FIXED_NOW);

// 받는 쪽 검사는 전략·기준의 빠진 필드를 기본값으로 채워 받으므로(설계 2.7 read) 최소 모양으로도 가져와진다
const compare = { kind: 'compare', v: 1, title: '반도체 공유', symbols: ['005930', '000660'], view: { period: { unit: 'W', n: 2 }, metric: 'drawdown', benchmark: 'AUTO', boardOrder: 'value' } };
const group = (title: string) => ({ kind: 'group', v: 1, title, symbols: ['005930'] });
const strategy = { kind: 'strategy', v: 1, title: '눌림목 공유', strategy: { id: 'shared', name: '눌림목 공유', updatedAt: 0, universe: { kind: 'symbols', symbols: ['005930'] } }, capitalHidden: true };
const criteria = { kind: 'criteria', v: 1, title: '대형 우량 공유', criteria: { id: 'shared', name: '대형 우량 공유', updatedAt: 0 }, baskets: [], capitalHidden: false };
const pending = (from: string, snapshot: unknown) => ({ id: `e2e-${from}-${Math.random().toString(36).slice(2)}`, from, snapshot, at: AT });

/** 넓은 화면의 레일 버튼은 그룹 이름 뒤에 종목 수가 붙고, 좁은 화면의 탭은 이름만 쓴다. */
function groupItem(page: Page, name: string, count: number): Locator {
  return isWide(page)
    ? page.getByRole('navigation', { name: '탐색' }).getByRole('button', { name: `${name} ${count}`, exact: true })
    : page.getByRole('tab', { name, exact: true });
}

/** addInitScript는 다시 불러올 때마다 돌아 값을 다시 심으므로 쓰지 않는다. 한 번만 넣고 다시 불러온다(설계 6.5) */
async function stash(page: Page, value: unknown): Promise<void> {
  await page.evaluate(([k, v]) => sessionStorage.setItem(k, v), [KEY, JSON.stringify(value)] as const);
  await page.reload();
}

/** 저장 뒤 실제 활성 요소를 본다. 폰의 숨겨진 비교 제목에 포커스하면 실패해야 한다. */
async function expectLandingFocus(page: Page, selector: string): Promise<void> {
  await expect.poll(() => page.evaluate((expectedSelector) => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || active.closest('[role="dialog"]')) return false;
    if (!active.matches(expectedSelector)) return false;
    const rect = active.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    for (let el: HTMLElement | null = active; el; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (el.hidden || style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) return false;
    }
    return true;
  }, selector), { message: `저장 뒤 보이는 ${selector}에 포커스가 있어야 해요` }).toBe(true);
}

async function expectNoSeriousViolations(page: Page, state: string): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const bad = results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' ; ')}`);
  expect(bad, `${state}: axe violations`).toEqual([]);
}

test('온보딩 전: 첫 실행이면 온보딩이 먼저 뜨고, 데모로 둘러보기 뒤 확인 창에서 비교 화면을 저장한다', async ({ page }) => {
  await openApp(page);
  await stash(page, pending('compare', compare));
  await expect(page.getByRole('button', { name: '데모로 둘러보기' })).toBeVisible();
  await expect(page.getByText(TITLE)).toHaveCount(0);
  expect(await page.evaluate((key) => sessionStorage.getItem(key) !== null, KEY)).toBe(true);
  await page.getByRole('button', { name: '데모로 둘러보기' }).click();
  const sheet = page.getByRole('dialog', { name: TITLE });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText('그룹 「반도체 공유」 · 종목 2개')).toBeVisible();
  await expect(sheet.getByText('같은 이름이 있어', { exact: false })).toHaveCount(0);
  const applyView = sheet.getByRole('checkbox', { name: '보기 설정도 적용' });
  await applyView.check();
  await expect(applyView).toBeChecked();
  await expectNoSeriousViolations(page, '확인 창');
  await sheet.getByRole('button', { name: '저장', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page).toHaveURL(/#\/compare\/[^/]+$/);
  await expect(groupItem(page, '반도체 공유', 2)).toHaveCount(1);
  await expect(leaderboardRows(page)).toHaveCount(2);
  // compare.spec.ts와 같은 컨트롤로 기본값(1일·등락률)과 다른 공유 보기 설정이 적용됐는지 본다.
  await expect(page.getByRole('radio', { name: '주', exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: '2주', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /^고점 대비 하락률/ })).toBeVisible();
  await expectLandingFocus(page, isWide(page) ? '[data-landing-title]' : 'main');
  await expectNoSeriousViolations(page, '가져온 비교 화면');
});

test('온보딩 후: 같은 이름 그룹(기본 그룹 「내 관심」)이 있으면 2를 붙여 바로 확인 창에서 저장한다', async ({ page }) => {
  await openApp(page);
  await enterDemo(page);
  await stash(page, pending('group', group('내 관심')));
  const sheet = page.getByRole('dialog', { name: TITLE });
  await expect(sheet.getByText('같은 이름이 있어 「내 관심 2」로 저장해요')).toBeVisible();
  await sheet.getByRole('button', { name: '저장', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page).toHaveURL(/#\/compare\/[^/]+$/);
  const importedGroup = groupItem(page, '내 관심 2', 1);
  await expect(importedGroup).toHaveCount(1);
  await expect(importedGroup).toBeVisible();
  await expect(leaderboardRows(page)).toHaveCount(1);
  await expectLandingFocus(page, isWide(page) ? '[data-landing-title]' : 'main');
  await expectNoSeriousViolations(page, '가져온 그룹 비교 화면');
});

test('전략 저장: 확인 창에서 저장하면 전략 편집으로 간다', async ({ page }) => {
  await openApp(page);
  await enterDemo(page);
  await stash(page, pending('strategy', strategy));
  const sheet = page.getByRole('dialog', { name: TITLE });
  await expect(sheet.getByText('초기 자금은 기본값으로 저장해요')).toBeVisible();
  await expectNoSeriousViolations(page, '전략 확인 창');
  await sheet.getByRole('button', { name: '저장', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page).toHaveURL(/#\/simulate\/(?!criteria(?:\/|$))[^/?#]+$/);
  await expect(page.getByRole('textbox', { name: '전략 이름', exact: true })).toHaveValue('눌림목 공유');
  await expectLandingFocus(page, '[data-landing-title]');
  await expectNoSeriousViolations(page, '가져온 전략 편집');
});

test('저장하지 않기: 아무것도 생기지 않고 다시 열어도 창이 뜨지 않는다', async ({ page }) => {
  await openApp(page);
  await enterDemo(page);
  await stash(page, pending('strategy', strategy));
  const sheet = page.getByRole('dialog', { name: TITLE });
  await expect(sheet.getByText('초기 자금은 기본값으로 저장해요')).toBeVisible();
  await sheet.getByRole('button', { name: '저장하지 않기' }).click();
  await expect(sheet).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('비교할 종목을 추가해 보세요')).toBeVisible();
  await expect(page.getByText(TITLE)).toHaveCount(0);
  await page.goto('./#/simulate');
  await expect(page.getByText('내 매매 규칙을 과거 데이터로 시험해 보세요')).toBeVisible();
  await expect(page.getByText('눌림목 공유')).toHaveCount(0);
  await expect(page.evaluate((key) => sessionStorage.getItem(key), KEY)).resolves.toBeNull();
});

test('검증 결과에서 온 기준: ② 안내 뒤 저장하면 기준 편집으로 간다', async ({ page }) => {
  await openApp(page);
  await enterDemo(page);
  await stash(page, pending('validation', criteria));
  const sheet = page.getByRole('dialog', { name: TITLE });
  await expect(sheet.getByText('② 매매 규칙은 함께 오지 않아요. 저장한 뒤 매매 규칙을 골라 주세요')).toBeVisible();
  await expectNoSeriousViolations(page, '기준 확인 창');
  await sheet.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page).toHaveURL(/#\/simulate\/criteria\/[^/]+$/);
  await expect(sheet).toHaveCount(0);
  await expectLandingFocus(page, '[data-landing-title]');
  await expectNoSeriousViolations(page, '가져온 기준 편집');
});
