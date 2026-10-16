import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { enterDemo, expectNoHorizontalScroll, isWide, leaderboardRows, openApp } from './helpers';

const FIXTURE = 'tests/fixtures/market-data-demo.json.gz';

// serious·critical 위반만 실패로 센다. 규칙을 끄지 않는다.
async function expectNoSeriousViolations(page: Page, state: string): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  const results = await new AxeBuilder({ page }).analyze();
  const bad = results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' ; ')}`);
  expect(bad, `${state}: axe violations`).toEqual([]);
}

test('선정 기준 검증: 가져오기 → 새 기준 → 미리 보기 → 검증 실행 → 결과 → 관심 그룹 → 비교 화면', async ({ page }) => {
  // 결과를 최대 60초까지 기다리므로 기본 30초로는 모자라다
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await openApp(page);
  // 예시 그룹을 만들지 않는다: 비교 화면에 보이는 종목은 모두 새 그룹에서 온 것이다
  await enterDemo(page);

  // 설정 › 데이터 › 시장 데이터 가져오기
  await page.getByRole('banner').getByRole('button', { name: '설정', exact: true }).click();
  await page.getByLabel('시장 데이터 파일').setInputFiles(FIXTURE);
  await expect(page.getByText(/30종목/)).toBeVisible({ timeout: 30_000 });
  await expectNoSeriousViolations(page, '설정(시장 데이터 있음)');

  // 시뮬레이션 › 선정 기준
  await page.getByRole('button', { name: '비교로 돌아가기' }).click();
  await page.getByRole('banner').getByRole('button', { name: '시뮬레이션', exact: true }).click();
  const criteriaTab = page.getByRole('tab', { name: '선정 기준' });
  await expect(criteriaTab).toBeVisible();

  // 탭 키보드 이동: 화살표는 포커스만 옮기고 Enter가 선택한다
  await page.getByRole('tab', { name: '매매 규칙' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(criteriaTab).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(criteriaTab).toHaveAttribute('aria-selected', 'true');
  await expectNoHorizontalScroll(page);
  await expectNoSeriousViolations(page, '선정 기준 목록');

  // 새 기준 → 미리 보기
  await page.getByRole('button', { name: '＋ 새 기준' }).first().click();
  const run = page.getByRole('button', { name: '검증 실행' });
  await expect(run).toBeEnabled();
  await expect(page.getByText(/통과 \d+개 · 상위 \d+개/).first()).toBeVisible({ timeout: 30_000 });
  await expectNoHorizontalScroll(page);
  await expectNoSeriousViolations(page, '기준 편집');

  // 검증 실행 → 진행 또는 곧바로 결과
  await run.click();
  const today = page.getByRole('heading', { name: '오늘 기준 선별' });
  await expect(today).toBeVisible({ timeout: 60_000 });

  // 결과: 요약·시장별·이력·도움말
  await expect(page.getByRole('heading', { name: '요약' })).toBeVisible();
  const market = page.getByRole('region', { name: '시장별 보기' });
  await expect(market).toBeVisible();
  await expect(market.getByRole('row')).toHaveCount(4); // 머리줄 + KOSPI·KOSDAQ·ETF
  await expect(page.getByRole('heading', { name: '선정 이력' })).toBeVisible();
  await expect(page.getByRole('list', { name: '결과 해석 도움말' })).toContainText('배당 제외 · 가격 수익률만이에요');
  await expectNoHorizontalScroll(page);
  await expectNoSeriousViolations(page, '검증 결과');

  // 관심 그룹으로 만들기 → 비교 화면에서 보기
  await page.getByRole('button', { name: '관심 그룹으로 만들기' }).click();
  const sheet = page.getByRole('dialog', { name: '관심 그룹으로 만들기' });
  await expect(sheet).toBeVisible();
  await expectNoSeriousViolations(page, '관심 그룹 시트');
  await sheet.getByRole('button', { name: '새 그룹으로 만들기' }).click();
  const status = page.getByRole('status').filter({ hasText: '를 넣었어요' });
  await expect(status).toBeVisible();
  const m = /^'(.+)'에 (\d+)개를 넣었어요/.exec((await status.innerText()).trim());
  expect(m, '상태 문구가 `\'그룹\'에 N개를 넣었어요` 모양이다').not.toBeNull();
  const [groupName, added] = [m![1], Number(m![2])];
  expect(added).toBeGreaterThan(0);
  await status.getByRole('button', { name: '비교 화면에서 보기' }).click();

  // 방금 만든 그룹이 선택돼 있고, 넣은 개수만큼의 행이 있다
  // 좁은 화면은 그룹 탭, 넓은 화면은 왼쪽 레일의 그룹 버튼(aria-current)으로 선택을 본다
  const escaped = groupName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (isWide(page)) {
    await expect(page.getByRole('navigation', { name: '탐색' }).getByRole('button', { name: new RegExp(`^${escaped} \\d+$`) })).toHaveAttribute('aria-current', 'page');
  } else {
    await expect(page.getByRole('tab', { name: groupName, selected: true })).toBeVisible();
  }
  await expect(leaderboardRows(page)).toHaveCount(added);

  expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
});

test('환율·테마 기준: v2 데이터 → 테마 1개 + 원/달러 민감도 ≥ 1.0 → 미리 보기 → 실행 → 이력 값 · 테마 메모', async ({ page }) => {
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await openApp(page);
  await enterDemo(page);

  await page.getByRole('banner').getByRole('button', { name: '설정', exact: true }).click();
  await page.getByLabel('시장 데이터 파일').setInputFiles(FIXTURE);
  await expect(page.getByText(/30종목/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: '비교로 돌아가기' }).click();
  await page.getByRole('banner').getByRole('button', { name: '시뮬레이션', exact: true }).click();
  await page.getByRole('tab', { name: '선정 기준' }).click();
  await page.getByRole('button', { name: '＋ 새 기준' }).first().click();
  const run = page.getByRole('button', { name: '검증 실행' });
  await expect(run).toBeEnabled();
  await expect(page.getByText(/통과 \d+개 · 상위 \d+개/).first()).toBeVisible({ timeout: 30_000 });

  // 후보 범위 › 테마 1개: 설계상 USD/KRW 민감도 +1.5인 종목만 든 '환율 수혜 대표'
  await page.getByRole('button', { name: /^후보 범위/ }).click();
  await page.getByLabel('테마 검색').fill('환율 수혜');
  await page.getByRole('checkbox', { name: /환율 수혜 대표/ }).check();
  await expect(page.getByRole('list', { name: '고른 테마' })).toContainText('환율 수혜 대표');

  // 조건 › 원/달러 민감도 ≥ 1.0
  const beta = page.getByRole('switch', { name: '원/달러 민감도 사용' });
  await beta.click();
  await expect(beta).toBeChecked();
  const min = page.getByRole('textbox', { name: '원/달러 최소 민감도' });
  await min.fill('1.0');
  await min.blur();
  await expect(min).toHaveValue(/^1(\.0)?$/);
  await expectNoHorizontalScroll(page);
  await expectNoSeriousViolations(page, '환율·테마 기준 편집');

  // 기본으로 켜진 반등 신호는 끈다: 이 흐름은 테마와 환율 민감도만 본다
  const previewStatus = page.getByRole('region', { name: '오늘 기준 미리 보기' }).getByRole('status');
  await expect(previewStatus).toHaveText(/통과 \d+개 · 상위 \d+개/, { timeout: 30_000 });
  const before = (await previewStatus.innerText()).trim();
  const rebound = page.getByRole('switch', { name: '반등 신호 사용' });
  await rebound.click();
  await expect(rebound).not.toBeChecked();

  // 미리 보기가 바뀐 기준으로 다시 계산돼 이전 값과 달라지고, 테마 안의 종목이 통과한다
  await expect(previewStatus).not.toHaveText(before, { timeout: 30_000 });
  await expect(previewStatus).toHaveText(/통과 [1-9]\d*개 · 상위 \d+개/, { timeout: 30_000 });

  await run.click();
  await expect(page.getByRole('heading', { name: '오늘 기준 선별' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('heading', { name: '선정 이력' })).toBeVisible();

  // 이력 행을 펼치면 원/달러 민감도 값 줄이 보인다
  const hist = page.getByRole('region', { name: '선정 이력' });
  const row = hist.getByRole('button', { expanded: false }).first();
  await row.click();
  await expect(hist.locator('[data-macro-value]').first()).toHaveText(/^원\/달러 민감도 \d+\.\d{2}/);

  // 뽑힌 종목은 모두 '환율 수혜 대표' 테마(설계상 원/달러 민감도 +1.5)의 종목이고, 민감도 값이 1.0 이상이다
  const THEME_SYMBOLS = ['100000', '101111', '102222'];
  const picked = await hist.locator('.picks .nm small').allInnerTexts();
  expect(picked.length, '뽑힌 종목이 있다').toBeGreaterThan(0);
  for (const sym of picked) expect(THEME_SYMBOLS, `${sym}은 테마 종목이다`).toContain(sym.trim());
  const betas = (await hist.locator('[data-macro-value]').allInnerTexts()).map((t) => Number(/민감도 (\d+\.\d+)/.exec(t)![1]));
  expect(betas.length).toBeGreaterThan(0);
  for (const b of betas) expect(b).toBeGreaterThanOrEqual(1.0);

  // 테마를 썼으니 테마 메모가 도움말에 있다
  await expect(page.getByRole('list', { name: '결과 해석 도움말' })).toContainText('테마·내 묶음은 지금 구성을 과거에도 써요');
  await expectNoHorizontalScroll(page);
  await expectNoSeriousViolations(page, '환율·테마 검증 결과');

  expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
});
