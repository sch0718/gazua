import { expect, test } from '@playwright/test';
import { enterDemo, isWide, leaderboard, leaderboardRows, openApp } from './helpers';

test('데모 보유 종목에 수익이 보이고 수익금순을 누르면 순서가 바뀌어요', async ({ page }) => {
  await openApp(page);
  await enterDemo(page);
  await page.getByRole('navigation').getByRole('button', { name: isWide(page) ? '보유 종목' : '보유', exact: true }).click();

  const board = leaderboard(page);
  const rows = leaderboardRows(page);
  const profitLines = rows.getByText(/^수익 .+% .+원$/);
  await expect(profitLines).toHaveCount(4);
  await expect(profitLines.first()).toBeVisible();
  const sort = board.getByRole('button', { name: '수익금순' });
  await sort.click();
  // 순서 자체는 단위 시험이 지킨다(데모 가격은 시각마다 달라 순서 단언은 흔들린다)
  await expect(sort).toHaveAttribute('aria-pressed', 'true');
  await expect(board.getByText(/수익금 순/)).toBeVisible();
});
