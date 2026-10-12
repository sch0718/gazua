import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';

/** 시계를 고정하는 시각: 2026-10-08(목) 17:42 KST. KRX·NXT 애프터마켓이 모두 열려 있고 자동 모드는 KRX로 풀린다. */
export const FIXED_NOW = '2026-10-08T17:42:00+09:00';

/** 종목 상세가 오른쪽 패널로 그려지는 폭(스펙 7.6, ≥1024). 그보다 좁으면 바텀 시트다. */
export const WIDE_MIN_WIDTH = 1024;

export const isWide = (page: Page): boolean => (page.viewportSize()?.width ?? 0) >= WIDE_MIN_WIDTH;

/** 시계를 고정하고 빈 저장소로 앱을 연다. 앱은 첫 실행이므로 온보딩이 뜬다. */
export async function openApp(page: Page): Promise<void> {
  // setFixedTime은 타이머를 멈추지 않는다(시각만 고정).
  await page.clock.setFixedTime(new Date(FIXED_NOW));
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1, name: '가즈아' })).toBeVisible();
}

/** 온보딩 `데모로 둘러보기` → 비교 화면(빈 그룹). */
export async function enterDemo(page: Page): Promise<void> {
  await page.getByRole('button', { name: '데모로 둘러보기' }).click();
  await expect(page.getByText('비교할 종목을 추가해 보세요')).toBeVisible();
}

/** 빈 상태의 `예시 그룹 불러오기` → 리더보드 4행. */
export async function loadExampleGroup(page: Page): Promise<void> {
  await page.getByRole('button', { name: '예시 그룹 불러오기' }).click();
  await expect(leaderboardRows(page)).toHaveCount(4);
}

export const leaderboard = (page: Page): Locator => page.getByRole('region', { name: '리더보드' });

export const leaderboardRows = (page: Page): Locator => leaderboard(page).getByRole('listitem');

/** 리더보드의 `＋ 종목 추가`로 추가 시트를 연다(PC 레일에도 같은 이름의 버튼이 있어 리더보드로 한정한다). */
export async function openAddSheet(page: Page): Promise<Locator> {
  await leaderboard(page).getByRole('button', { name: '＋ 종목 추가' }).click();
  const sheet = page.getByRole('dialog', { name: '종목 추가' });
  await expect(sheet).toBeVisible();
  return sheet;
}

/** 가로 스크롤이 없다: 문서 폭이 뷰포트 폭을 넘지 않는다. */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(overflow.scrollWidth, `scrollWidth ${overflow.scrollWidth} > innerWidth ${overflow.innerWidth}`).toBeLessThanOrEqual(
    overflow.innerWidth,
  );
}

/** 시각 확인용 전체 페이지 스크린샷: test-results/screens/<project>-<step>.png */
export async function shot(page: Page, testInfo: TestInfo, step: string): Promise<void> {
  // 시트·전환 애니메이션 도중이 찍히지 않게 애니메이션을 끈 상태로 찍는다.
  await page.screenshot({ path: `test-results/screens/${testInfo.project.name}-${step}.png`, fullPage: true, animations: 'disabled' });
}
