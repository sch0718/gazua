import { expect, test, type Locator, type Page } from '@playwright/test';
import { enterDemo, expectNoHorizontalScroll, isWide, leaderboard, leaderboardRows, loadExampleGroup, openAddSheet, openApp, shot } from './helpers';

// 비교 화면 레이아웃: 요소 경계 상자가 서로 겹치지 않는지 본다(좁은 폰 360px에서 나왔던 문제, 2026-10-26).

/** 예시 그룹(4종목)에 6종목을 더해 10종목을 채운다. */
async function fillTenItems(page: Page): Promise<void> {
  const sheet = await openAddSheet(page);
  const search = sheet.getByRole('searchbox', { name: '종목 검색' });
  for (const name of ['삼성전기', 'KODEX 200', 'NAVER', '카카오', '현대차', '기아']) {
    await search.fill(name);
    await sheet.getByRole('button', { name: `${name} 추가`, exact: true }).click();
    await expect(sheet.getByRole('button', { name: `${name} 빼기`, exact: true })).toBeVisible();
  }
  await expect(sheet).toContainText('10/10');
  await sheet.getByRole('button', { name: '완료' }).click();
  await expect(sheet).toBeHidden();
  await expect(leaderboardRows(page)).toHaveCount(10);
}

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  expect(b, `${locator} 경계 상자`).not.toBeNull();
  return b!;
}

/** a가 b보다 위에 있고 세로로 겹치지 않는다(0.5px 반올림 오차는 봐준다). */
async function expectAbove(a: Locator, b: Locator, what: string): Promise<void> {
  const [ba, bb] = [await box(a), await box(b)];
  expect(ba.y + ba.height, `${what}: 위 요소 아래 ${ba.y + ba.height} > 아래 요소 위 ${bb.y}`).toBeLessThanOrEqual(bb.y + 0.5);
}

test('10종목: 거래 가능 시간 막대가 범례·표 보기와 겹치지 않는다', async ({ page }, testInfo) => {
  await openApp(page);
  await enterDemo(page);
  await loadExampleGroup(page);
  await fillTenItems(page);
  await expect(leaderboard(page)).toContainText('10/10');

  const lanes = page.getByRole('group', { name: '종목별 거래 가능 시간' });
  await expect(lanes.locator('[data-lane]')).toHaveCount(10);
  const legend = page.locator('.legend');
  const table = page.getByRole('button', { name: /^표 보기/ });
  await expectAbove(page.getByRole('group', { name: '종목 비교 차트' }), lanes, '차트 → 레인');
  await expectAbove(lanes, legend, '레인 → 범례');
  await expectAbove(legend, table, '범례 → 표 보기');
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, 'layout-10-items');
});

test('앱 바: 그룹 탭 이름이 잘리지 않고 상태 칩·아이콘과 겹치지 않는다', async ({ page }, testInfo) => {
  test.skip(isWide(page), '≥1024에서는 레일이 그룹을 보여 주고 탭은 숨긴다');
  await openApp(page);
  await enterDemo(page);
  await loadExampleGroup(page);
  // 그룹 셋: 지금 그룹 + 새 그룹 2 + 새 그룹 3
  for (let i = 0; i < 2; i++) await page.getByRole('button', { name: '새 그룹', exact: true }).click();
  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveCount(3);
  // 상태 칩은 장중(고정 시각 17:42, KRX 애프터)이라 세션 이름까지 보인다.
  const chip = page.getByRole('button', { name: /오늘 세션 시간표 보기$/ });
  await expect(chip).toBeVisible();

  const list = await box(page.getByRole('tablist', { name: '관심 그룹' }));
  // 탭 줄은 가로로 스크롤되므로, 화면에 보이는 부분은 탭 줄 바깥 틀(＋·⋯ 포함)과의 교집합이다.
  const frame = await box(page.locator('.tabs'));
  const left = Math.max(list.x, frame.x);
  const right = Math.min(list.x + list.width, frame.x + frame.width);
  for (const tab of await tabs.all()) {
    const b = await box(tab);
    const name = (await tab.textContent())?.trim();
    expect(b.x, `${name} 탭 왼쪽이 잘림`).toBeGreaterThanOrEqual(left - 0.5);
    expect(b.x + b.width, `${name} 탭 오른쪽이 잘림`).toBeLessThanOrEqual(right + 0.5);
  }
  // 탭 줄(＋·⋯ 포함)과 상태 칩·아이콘이 겹치지 않는다.
  for (const other of [chip, page.getByRole('button', { name: '설정' })]) {
    const o = await box(other);
    const overlapX = Math.min(frame.x + frame.width, o.x + o.width) - Math.max(frame.x, o.x);
    const overlapY = Math.min(frame.y + frame.height, o.y + o.height) - Math.max(frame.y, o.y);
    expect(overlapX <= 0.5 || overlapY <= 0.5, `탭 줄과 ${await other.getAttribute('aria-label')}이 겹침`).toBe(true);
  }
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, 'layout-group-tabs');
});
