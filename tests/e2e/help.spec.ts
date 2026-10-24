import { expect, test } from '@playwright/test';
import { enterDemo, expectNoHorizontalScroll, openApp } from './helpers';

test('first visit shows the compare intro once, and the help page shows the moving picture', async ({ page }) => {
  await openApp(page, { intro: true });
  await page.getByRole('button', { name: '데모로 둘러보기' }).click();
  const intro = page.getByRole('dialog', { name: '비교 차트' });
  await expect(intro).toBeVisible();
  await expect(intro.getByRole('img', { name: /비교 차트 사용법/ })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await intro.getByRole('button', { name: '시작하기' }).click();
  await expect(intro).toBeHidden();
  await expect(page.getByText('비교할 종목을 추가해 보세요')).toBeVisible();

  // 다시 들어와도 뜨지 않는다.
  await page.reload();
  await expect(page.getByText('비교할 종목을 추가해 보세요')).toBeVisible();
  await expect(page.getByRole('dialog', { name: '비교 차트' })).toHaveCount(0);

  // 앱 바의 ? → 이 화면의 도움말. 폰 폭에서는 비교 화면 앱 바에 자리가 없어 설정 › 도움말로 간다.
  const bar = page.locator('header.bar');
  if ((page.viewportSize()?.width ?? 0) < 600) {
    await expect(bar.getByRole('button', { name: '비교 차트 도움말' })).toBeHidden();
    await bar.getByRole('button', { name: '설정' }).click();
    await page.getByRole('button', { name: '도움말 보기' }).click();
    await page.getByRole('list', { name: '메뉴별 도움말' }).getByRole('button', { name: /비교 차트/ }).click();
  } else {
    await bar.getByRole('button', { name: '비교 차트 도움말' }).click();
  }
  // 그림 파일이 실제로 읽혀 그려진다.
  await expect(page.getByRole('heading', { level: 1, name: '비교 차트' })).toBeVisible();
  const img = page.getByRole('img', { name: /비교 차트 사용법/ });
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(960);
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: '다음: 종목 추가 →' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '종목 추가' })).toBeVisible();
  await expect(page).toHaveURL(/#\/help\/add$/);
});

test('settings lets the intros show again', async ({ page }) => {
  await openApp(page);
  await enterDemo(page);
  await page.locator('header.bar').getByRole('button', { name: '설정' }).click();
  await page.getByRole('button', { name: '처음 안내 다시 보기' }).click();
  await expect(page.getByText('메뉴에 처음 들어갈 때 안내가 다시 떠요')).toBeVisible();
  await page.getByRole('button', { name: '도움말 보기' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '도움말' })).toBeVisible();
  await expect(page.getByRole('list', { name: '메뉴별 도움말' }).getByRole('listitem')).toHaveCount(7);
});
