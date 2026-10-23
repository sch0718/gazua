import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { enterDemo, expectNoHorizontalScroll, openApp, shot } from './helpers';

async function expectNoSeriousViolations(page: Page, state: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const bad = results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' ; ')}`);
  expect(bad, `${state}: axe violations`).toEqual([]);
}

const cards = (page: Page) => page.getByRole('region', { name: '요약' });

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await enterDemo(page);
  await page.getByRole('banner').getByRole('button', { name: '내 성과' }).click();
  await expect(page).toHaveURL(/#\/performance$/);
  await expect(cards(page)).toBeVisible();
});

test('내 성과: 데모 계좌 → 벤치마크·기간 바꾸기 → 종목 펼치기', async ({ page }, testInfo) => {
  await expect(page.getByText('데모 계좌예요')).toBeVisible();
  await expect(cards(page).getByText('자동(시장 지수) IRR')).toBeVisible();
  await expect(page.getByRole('heading', { name: '종목별 기여도' })).toBeVisible();
  await expect(page.getByText(/한미반도체: 주문 합계 7주, 보유 8주/)).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, 'performance');

  await page.getByLabel('벤치마크').selectOption('069500');
  await expect(cards(page).getByText('KODEX 200 IRR')).toBeVisible();

  await page.getByLabel('기간').selectOption('2026');
  await expect(page.getByText(/^2026\.01\.\d\d ~ 2026\.10\.08$/)).toBeVisible();

  const row = page.getByRole('button', { name: /삼성전자/ });
  await row.click();
  await expect(row).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('table', { name: '삼성전자 체결 목록' })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, 'performance-open');

  // 고른 벤치마크는 다시 열어도 그대로다
  await page.reload();
  await expect(cards(page).getByText('KODEX 200 IRR')).toBeVisible();
});

test('내 성과 화면에 심각한 접근성 위반이 없다(표 보기 포함)', async ({ page }) => {
  await expectNoSeriousViolations(page, '내 성과');
  await page.getByRole('button', { name: '표 보기' }).click();
  await expect(page.getByRole('table', { name: '날짜별 평가금액과 회수액' })).toBeAttached();
  await page.getByRole('button', { name: /삼성전자/ }).click();
  await expectNoSeriousViolations(page, '내 성과(펼침)');
});
