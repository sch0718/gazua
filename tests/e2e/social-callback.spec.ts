import { expect, test } from '@playwright/test';
import { enterDemo, openApp, expectNoHorizontalScroll } from './helpers';

test('소셜 콜백 주소를 지우고 설정 화면으로 돌아간다', async ({ page }) => {
  await openApp(page);
  await enterDemo(page);
  await page.goto('/auth/callback/?code=fake-code&state=fake-state');
  await expect.poll(() => new URL(page.url()).search).not.toMatch(/code=|state=/);
  expect(await page.locator('meta[name="referrer"]').getAttribute('content')).toBe('no-referrer');
  // 동기화 설정이 없는 운영 시험 빌드는 대기 요청보다 설정 안내를 먼저 한다.
  await expect(page.getByRole('heading', { name: /이 빌드에는 카카오·네이버 로그인이 설정되지 않았어요/ })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: '돌아가기' }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/');
  await expect(page).toHaveURL(/\/#\/settings$/);
  expect(page.url()).not.toContain('code=');
});
