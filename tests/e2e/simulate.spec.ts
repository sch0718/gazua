import { expect, test } from '@playwright/test';
import { enterDemo, expectNoHorizontalScroll, isWide, loadExampleGroup, openApp, shot } from './helpers';

test('시뮬레이션: 새 전략 → 실행 → 결과 → 거래 차트 시트 → 규칙으로 돌아가기', async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await openApp(page);
  await enterDemo(page);
  await loadExampleGroup(page);

  // 앱 바 진입점 → 빈 목록 → 새 전략
  await page.getByRole('banner').getByRole('button', { name: '시뮬레이션', exact: true }).click();
  await expect(page.getByText('내 매매 규칙을 과거 데이터로 시험해 보세요')).toBeVisible();
  await page.getByRole('button', { name: '＋ 새 전략' }).click();

  // 편집 화면 → 실행
  const run = page.getByRole('button', { name: '시뮬레이션 실행' });
  await expect(run).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, 'sim-1-editor');
  await run.click();

  // 결과: 요약 카드
  const result = page.getByRole('region', { name: '시뮬레이션 결과' }).last();
  await expect(result.getByText('총수익률', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, 'sim-2-result');

  // 거래 내역 첫 행 → 거래 차트 시트
  await result.getByRole('radio', { name: '거래 내역' }).click();
  const firstTrade = result.getByRole('list', { name: '거래 내역' }).getByRole('button').first();
  await expect(firstTrade).toBeVisible();
  const stockName = (await firstTrade.locator('.name').innerText()).trim();
  await firstTrade.click();

  const sheet = page.getByRole('dialog', { name: stockName });
  await expect(sheet).toBeVisible();
  // 차트는 캔버스라 글자 요약으로 확인한다: `매수 MM.DD N원 → …`
  await expect(sheet).toContainText(/매수 .*원/);
  await shot(page, testInfo, 'sim-3-trade-sheet');

  // 닫기: Esc
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  // 규칙으로 돌아가기: 좁은 화면은 머리줄 `규칙`, PC는 편집기가 옆에 계속 보인다
  if (!isWide(page)) {
    await page.getByRole('banner').getByRole('button', { name: '규칙', exact: true }).click();
  }
  await expect(page.getByRole('button', { name: '시뮬레이션 실행' })).toBeVisible();

  expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
});
