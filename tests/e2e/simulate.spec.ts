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
  await expect(sheet).toContainText(/A .*원 · B .*원 · L .*원/);
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

test('시뮬레이션: 목록·편집·로딩·결과 어느 상태에서도 가로 스크롤이 없다', async ({ page }) => {
  // 데모 공급자는 일봉을 메모리에서 만들어 로딩이 순식간이다. 실행이 종목 목록(universe.json)을 기다리게 해서 로딩에 붙들어 둔다:
  // 예시 그룹 밖의 종목(035420)을 그룹에 넣고, 새로고침 뒤 첫 universe.json 응답을 풀어 줄 때까지 붙든다.
  let hold: Promise<void> | null = null;
  let release = () => {};
  await page.route('**/universe.json', async (route) => {
    if (hold) await hold;
    await route.continue();
  });

  await openApp(page);
  await enterDemo(page);
  await loadExampleGroup(page);

  await page.getByRole('banner').getByRole('button', { name: '시뮬레이션', exact: true }).click();
  await expect(page.getByText('내 매매 규칙을 과거 데이터로 시험해 보세요')).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.getByRole('button', { name: '＋ 새 전략' }).click();
  const run = page.getByRole('button', { name: '시뮬레이션 실행' });
  await expect(run).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => /^gazua:v1:p:[^:]+:watchlists$/.test(k))!;
    const w = JSON.parse(localStorage.getItem(key)!);
    w.groups[0].items.push({ symbol: '035420', colorSlot: 5, hidden: false, addedAt: 1 });
    localStorage.setItem(key, JSON.stringify(w));
  });
  hold = new Promise<void>((resolve) => (release = resolve));
  await page.reload();
  await expect(run).toBeVisible();

  // 로딩
  await run.click();
  await expect(page.getByRole('button', { name: '취소' })).toBeVisible();
  await expectNoHorizontalScroll(page);

  if (!isWide(page)) {
    // 로딩 중에 규칙으로 갔다가 바의 `결과`로 돌아온다
    await page.getByRole('banner').getByRole('button', { name: '규칙', exact: true }).click();
    await expect(run).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.getByRole('banner').getByRole('button', { name: '결과', exact: true }).click();
    await expect(page.getByRole('button', { name: '취소' })).toBeVisible();
  }

  // 결과
  release();
  const result = page.getByRole('region', { name: '시뮬레이션 결과' }).last();
  await expect(result.getByText('총수익률', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expectNoHorizontalScroll(page);

  // 앱 바의 시뮬레이션 아이콘은 현재 위치를 알린다
  await expect(page.getByRole('banner').getByRole('button', { name: '시뮬레이션', exact: true })).toHaveAttribute('aria-current', 'page');
});
