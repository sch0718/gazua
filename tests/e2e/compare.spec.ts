import { expect, test, type Page } from '@playwright/test';
import {
  enterDemo,
  expectNoHorizontalScroll,
  isWide,
  leaderboard,
  leaderboardRows,
  loadExampleGroup,
  openAddSheet,
  openApp,
  shot,
} from './helpers';

const samsungElectroRow = (page: Page) => leaderboardRows(page).filter({ hasText: '삼성전기' });

test('데모 흐름: 예시 그룹 → 종목 추가 → 기간·지표·거래소 → 삭제와 되돌리기', async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await openApp(page);
  await expectNoHorizontalScroll(page);

  // 온보딩 → 데모 → 예시 그룹
  await enterDemo(page);
  await loadExampleGroup(page);
  await expect(leaderboard(page)).toContainText('4/8');
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, '1-example-group');

  // 종목 추가: 영문 이름은 초성이 없으니 코드·이름 일부로 찾는다
  const sheet = await openAddSheet(page);
  await expect(sheet).toContainText('4/8');
  const search = sheet.getByRole('searchbox', { name: '종목 검색' });
  await search.fill('kodex');
  await expect(sheet.getByRole('button', { name: 'KODEX 200 추가', exact: true })).toBeVisible();

  await search.fill('ㅅㅅㅈㄱ');
  await expect(sheet.getByText(/^검색 결과 \d+$/)).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'KODEX 200 추가', exact: true })).toBeHidden(); // 이전 검색 결과가 사라졌는지
  await expect(sheet.getByRole('button', { name: '삼성전기 추가', exact: true })).toBeVisible();
  await shot(page, testInfo, '2-add-sheet');
  await sheet.getByRole('button', { name: '삼성전기 추가', exact: true }).click();
  await expect(sheet.getByRole('button', { name: '삼성전기 추가됨', exact: true })).toBeVisible();
  await expect(sheet).toContainText('5/8');
  await expect(sheet).toContainText('이번에 1개 추가했어요');
  await sheet.getByRole('button', { name: '완료' }).click();
  await expect(sheet).toBeHidden();
  await expect(leaderboardRows(page)).toHaveCount(5);
  await expect(leaderboard(page)).toContainText('5/8');

  // 기간: 주 → 2주
  await page.getByRole('radio', { name: '주', exact: true }).click();
  await expect(page.getByRole('radio', { name: '주', exact: true })).toBeChecked();
  await page.getByRole('button', { name: '2주', exact: true }).click();
  await expect(page.getByRole('button', { name: '2주', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // 지표: 고점 대비 하락률
  await page.getByRole('button', { name: /^등락률/ }).click();
  const metricSheet = page.getByRole('dialog', { name: '비교 지표' });
  await metricSheet.getByRole('button', { name: /^고점 대비 하락률/ }).click();
  await expect(metricSheet).toBeHidden();
  await expect(page.getByRole('button', { name: /^고점 대비 하락률/ })).toBeVisible();
  await expect(leaderboard(page)).toContainText('고점 대비 하락률 순');

  // 거래소: KRX
  await page.getByRole('radio', { name: 'KRX', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'KRX', exact: true })).toBeChecked();

  // 상태 칩: 17:42는 KRX 애프터
  await expect(page.getByRole('button', { name: /^KRX 애프터 · 17:42/ })).toBeVisible();
  await expect(page.getByRole('radio', { name: '자동' })).not.toBeChecked();

  // 종목 상세: 삭제 → 되돌리기
  await expect(samsungElectroRow(page)).toHaveCount(1); // 데모 공급자가 종목 목록에서 이름을 채울 때까지 기다린다
  await samsungElectroRow(page).getByRole('button', { name: /^삼성전기 009150/ }).click();
  const detail = isWide(page)
    ? page.getByRole('region', { name: '선택한 종목' })
    : page.getByRole('dialog', { name: '종목 상세' });
  await expect(detail).toBeVisible();
  await expect(detail).toContainText('삼성전기');
  await shot(page, testInfo, '3-detail');
  await detail.getByRole('button', { name: '삭제' }).click();
  await expect(leaderboardRows(page)).toHaveCount(4);
  await expect(page.getByText('을(를) 삭제했어요')).toBeVisible();
  await page.getByRole('button', { name: '되돌리기' }).click();
  await expect(leaderboardRows(page)).toHaveCount(5);
  await expect(samsungElectroRow(page)).toHaveCount(1);

  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, '4-end');

  // 설정 화면
  await page.getByRole('banner').getByRole('button', { name: '설정', exact: true }).click();
  await expect(page.getByRole('heading', { name: '데이터 공급자' })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, '5-settings');

  expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
});

test('다크 모드 비교 화면 스크린샷', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openApp(page);
  await enterDemo(page);
  await loadExampleGroup(page);
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, 'dark-compare');
});
