import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { enterDemo, expectNoHorizontalScroll, leaderboardRows, loadExampleGroup, openAddSheet, openApp } from './helpers';

// serious·critical 위반만 실패로 센다. 규칙을 끄지 않는다.
async function expectNoSeriousViolations(page: Page, state: string): Promise<void> {
  // 시트·스낵바의 등장 애니메이션이 끝난 뒤에 잰다(중간 색으로 대비를 잘못 계산하지 않게).
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

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await enterDemo(page);
  await loadExampleGroup(page);
});

test('비교 화면(예시 그룹)에 심각한 접근성 위반이 없다', async ({ page }) => {
  await expectNoSeriousViolations(page, '비교');
  await expectNoHorizontalScroll(page);
});

test('설정 화면에 심각한 접근성 위반이 없다', async ({ page }) => {
  await page.getByRole('banner').getByRole('button', { name: '설정', exact: true }).click();
  await expect(page.getByRole('heading', { name: '데이터 공급자' })).toBeVisible();
  await expectNoSeriousViolations(page, '설정');
  await expectNoHorizontalScroll(page);
});

test('종목 추가 시트가 열린 상태에 심각한 접근성 위반이 없다', async ({ page }) => {
  const sheet = await openAddSheet(page);
  await sheet.getByRole('searchbox', { name: '종목 검색' }).fill('ㅅㅅㅈㄱ');
  await expect(sheet.getByRole('button', { name: '삼성전기 추가', exact: true })).toBeVisible();
  await expectNoSeriousViolations(page, '종목 추가 시트');
});

test('지표 시트가 열린 상태에 심각한 접근성 위반이 없다', async ({ page }) => {
  await page.getByRole('button', { name: /^등락률/ }).click();
  await expect(page.getByRole('dialog', { name: '비교 지표' })).toBeVisible();
  await expectNoSeriousViolations(page, '지표 시트');
});

test('종목 상세가 열린 상태에 심각한 접근성 위반이 없다', async ({ page }) => {
  await leaderboardRows(page).first().getByRole('button', { name: /원$/ }).click();
  await expect(page.getByText('오늘 거래 가능 시간 (KST)')).toBeVisible();
  await expectNoSeriousViolations(page, '종목 상세');
});

// 시스템 다크 모드(prefers-color-scheme: dark)에서도 같은 기준을 지킨다.
test.describe('다크 모드', () => {
  test.use({ colorScheme: 'dark' });

  test('비교 화면(예시 그룹)에 심각한 접근성 위반이 없다', async ({ page }) => {
    await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
    await expectNoSeriousViolations(page, '다크 비교');
  });

  test('종목 추가 시트가 열린 상태에 심각한 접근성 위반이 없다', async ({ page }) => {
    const sheet = await openAddSheet(page);
    await sheet.getByRole('searchbox', { name: '종목 검색' }).fill('ㅅㅅㅈㄱ');
    await expect(sheet.getByRole('button', { name: '삼성전기 추가', exact: true })).toBeVisible();
    await expectNoSeriousViolations(page, '다크 종목 추가 시트');
  });
});
