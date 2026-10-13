import { expect, test, type Locator } from '@playwright/test';
import { enterDemo, expectNoHorizontalScroll, isWide, loadExampleGroup, openApp, shot } from './helpers';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 총수익률 값(실제 값과 긴 값 복제본)이 한 줄이고 반 카드 안쪽 폭 안에 든다.
 * fallback(컨테이너 쿼리 없음)이면 글자 크기가 --fs-title(17px) 이상인지도 본다.
 */
async function expectMainValueFits(mainValue: Locator, path: 'cqi' | 'fallback'): Promise<void> {
  for (const text of [null, '▲ +99.9%', '▼ −99.9%', '▲ +125.3%', '▲ +1234.5%']) {
    const m = await mainValue.evaluate((orig, t) => {
      const el = t === null ? orig : (orig.cloneNode(true) as HTMLElement);
      if (t !== null) {
        el.textContent = t;
        el.style.setProperty('--chars', String(t.length));
        orig.after(el);
      }
      // 카드 몫 = (카드 목록 폭 − 칸 사이) ÷ 2 − 카드 안쪽 여백. 넘친 값이 칸을 넓혀도 이 몫과 비교한다
      const list = orig.closest('.cards')!;
      const card = getComputedStyle(orig.parentElement!);
      const share = (list.clientWidth - parseFloat(getComputedStyle(list).columnGap)) / 2;
      const inner = share - parseFloat(card.paddingLeft) - parseFloat(card.paddingRight);
      const fontSize = parseFloat(getComputedStyle(el).fontSize);
      // 글자 자체의 폭(소수점까지). scrollWidth는 정수로 올림돼 몫(143.5px)과 비교가 어긋난다
      const range = document.createRange();
      range.selectNodeContents(el);
      const width = range.getBoundingClientRect().width;
      const out = { text: el.textContent, width, inner, fontSize, container: card.containerType, oneLine: el.getBoundingClientRect().height < fontSize * 2 };
      if (t !== null) el.remove();
      return out;
    }, text);
    const at = `[${path}] 총수익률 '${m.text}'`;
    expect(m.container, `${at} container-type`).toBe(path === 'cqi' ? 'inline-size' : 'normal');
    expect(m.oneLine, `${at} 줄바꿈`).toBe(true);
    expect(m.width, `${at} ${m.width}px > 카드 ${m.inner}px (글자 ${m.fontSize}px)`).toBeLessThanOrEqual(m.inner);
    if (path === 'fallback') expect(m.fontSize, `${at} 글자 ${m.fontSize}px < --fs-title`).toBeGreaterThanOrEqual(17);
  }
}

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

  // 총수익률 값은 한 줄이고 반 카드 밖으로 넘치지 않는다(375px에서 반 카드 안쪽 약 143px).
  // 긴 값은 실제 값 옆에 복제본(글자 수 --chars를 함께 바꿈)을 붙여 잰다.
  // 컨테이너 쿼리를 끈 상태(카드의 container-type 제거)에서는 폴백 계산을 쓴다: 그때도 넘치지 않고 글자는 --fs-title 이상
  const mainValue = result.locator('.cards .value.main');
  await expectMainValueFits(mainValue, 'cqi');
  const noContainer = await page.addStyleTag({ content: '.cards li { container-type: normal !important; }' });
  await expectMainValueFits(mainValue, 'fallback');
  await noContainer.evaluate((el) => el.remove());
  await expectMainValueFits(mainValue, 'cqi');

  // 거래 내역 첫 행 → 거래 차트 시트
  await result.getByRole('radio', { name: '거래 내역' }).click();
  const firstTrade = result.getByRole('group', { name: '거래 내역' }).getByRole('button').first();
  await expect(firstTrade).toBeVisible();
  // 행 안의 종목명(.nm)을 읽고, 행 버튼의 접근 가능한 이름이 `종목명 · 값 · MM.DD · 사유`로 시작하는지 본다
  const stockName = (await firstTrade.locator('.nm').textContent())!.trim();
  expect(stockName).not.toBe('');
  await expect(firstTrade).toHaveAccessibleName(new RegExp('^' + escapeRe(stockName) + ' · '));
  await firstTrade.click();

  // 시트 제목은 `종목명 · YY.MM.DD 매수`
  const sheet = page.getByRole('dialog', { name: new RegExp(`^${escapeRe(stockName)} · \\d{2}\\.\\d{2}\\.\\d{2} 매수$`) });
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

test('편집: 모든 구역을 펼쳐도 카드 밖으로 넘치지 않고, 숫자 칸 박스·라벨이 크게 눌린다', async ({ page }, testInfo) => {
  await openApp(page);
  await enterDemo(page);
  await loadExampleGroup(page);
  await page.getByRole('banner').getByRole('button', { name: '시뮬레이션', exact: true }).click();
  await page.getByRole('button', { name: '＋ 새 전략' }).click();
  await expect(page.getByRole('button', { name: '시뮬레이션 실행' })).toBeVisible();

  for (const title of ['종목', '기간·자금', '매수', '분할 매수', '매도', '비교 기준', '비용']) {
    const head = page.locator('button[aria-expanded]', { has: page.getByText(title, { exact: true }) });
    await head.click();
    await expect(head).toHaveAttribute('aria-expanded', 'true');
  }
  // 분할 매수를 켜서 그 칸들도 그린다(라벨을 눌러 켠다)
  await page.locator('label', { hasText: /^분할 매수$/ }).click();
  await expect(page.getByRole('switch', { name: '분할 매수 사용' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('textbox', { name: '추가 매수 간격' })).toBeVisible();

  await expectNoHorizontalScroll(page);
  // 구역 카드는 overflow:hidden이라 문서 폭으로는 안 잡힌다: 카드마다 내용이 카드 폭을 넘지 않는지 본다
  const overflow = await page.locator('section.sec').evaluateAll((els) =>
    els.filter((el) => el.scrollWidth > el.clientWidth).map((el) => el.querySelector('b')?.textContent),
  );
  expect(overflow, `cards overflow: ${overflow.join(', ')}`).toEqual([]);
  await shot(page, testInfo, 'sim-4-editor-open');

  // 숫자 칸 박스의 여백을 눌러도 입력에 포커스, 박스 높이 44px 이상
  const stop = page.getByRole('textbox', { name: '손절폭' });
  const box = stop.locator('xpath=ancestor::label[1]');
  expect((await box.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await box.click({ position: { x: 4, y: 4 } });
  await expect(stop).toBeFocused();

  // 라벨을 누르면 그 줄의 토글이 바뀐다
  const sw = page.getByRole('switch', { name: '고점 대비 하락폭 사용' });
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await page.locator('label', { hasText: /^고점 대비 하락폭$/ }).click();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
});

test('편집: 처음 자금 칸에 키보드로 들어와 바로 치면 값이 바뀌고, 최댓값도 잘리지 않는다', async ({ page }) => {
  await openApp(page);
  await enterDemo(page);
  await loadExampleGroup(page);
  await page.getByRole('banner').getByRole('button', { name: '시뮬레이션', exact: true }).click();
  await page.getByRole('button', { name: '＋ 새 전략' }).click();
  const head = page.locator('button[aria-expanded]', { has: page.getByText('기간·자금', { exact: true }) });
  await head.click();

  const cap = page.getByRole('textbox', { name: '처음 자금' });
  await expect(cap).toHaveValue('10,000,000');
  // 다음 칸에서 Shift+Tab으로 들어온다(브라우저가 전체 선택) → 바로 친다
  await page.getByRole('textbox', { name: '회당 매수 비중' }).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(cap).toBeFocused();
  await expect(cap).toHaveValue('10000000');
  await page.keyboard.type('5000000');
  await expect(cap).toHaveValue('5000000');
  await page.keyboard.press('Tab');
  await expect(cap).toHaveValue('5,000,000');
  await expect(page.getByText('= 500만 원')).toBeVisible();

  // 최댓값(15자)도 포커스 밖에서 칸 안에 다 보인다(포커스 때 쉼표를 빼는 갱신이 끝난 뒤 채운다)
  await cap.focus();
  await expect(cap).toHaveValue('5000000');
  await cap.fill('100000000000');
  await cap.blur();
  await expect(cap).toHaveValue('100,000,000,000');
  const clip = await cap.evaluate((el: HTMLInputElement) => el.scrollWidth - el.clientWidth);
  expect(clip, `처음 자금 칸이 ${clip}px 잘림`).toBeLessThanOrEqual(0);
  await expect(page.getByText('= 1,000억 원')).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test('편집: 폭 320px에서도 처음 자금 칸(최댓값)이 줄 안에 맞고 가로로 넘치지 않는다', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await openApp(page);
  await enterDemo(page);
  await loadExampleGroup(page);
  await page.getByRole('banner').getByRole('button', { name: '시뮬레이션', exact: true }).click();
  await page.getByRole('button', { name: '＋ 새 전략' }).click();
  await page.locator('button[aria-expanded]', { has: page.getByText('기간·자금', { exact: true }) }).click();

  const cap = page.getByRole('textbox', { name: '처음 자금' });
  await cap.focus();
  await expect(cap).toHaveValue('10000000');
  await cap.fill('100000000000');
  await cap.blur();
  await expect(cap).toHaveValue('100,000,000,000');
  await expectNoHorizontalScroll(page);

  // 숫자 칸 박스의 오른쪽 끝이 구역 안쪽(본문 여백 안) 오른쪽 끝을 넘지 않는다
  const m = await cap.evaluate((el) => {
    const body = el.closest('section.sec')!.querySelector('.body')!;
    const innerRight = body.getBoundingClientRect().right - parseFloat(getComputedStyle(body).paddingRight);
    const box = el.closest('label')!.getBoundingClientRect();
    const field = el.closest('.field')!.getBoundingClientRect();
    return { over: box.right - innerRight, boxWidth: box.width, fieldWidth: field.width, sec: el.closest('section.sec')!.scrollWidth - el.closest('section.sec')!.clientWidth };
  });
  expect(m.over, `박스가 줄 밖으로 ${m.over}px`).toBeLessThanOrEqual(0);
  expect(m.sec, `구역 카드 넘침 ${m.sec}px`).toBeLessThanOrEqual(0);
  expect(m.boxWidth).toBeLessThanOrEqual(m.fieldWidth);
  await shot(page, testInfo, 'sim-5-capital-320');
});

test('앱 바: 폰 폭에서 시뮬레이션 화면에는 상태 칩이 없고 비교 화면에는 있다', async ({ page }) => {
  await openApp(page);
  await enterDemo(page);
  await loadExampleGroup(page);
  const chip = page.getByRole('banner').getByRole('button', { name: /· 오늘 세션 시간표 보기$/ });
  await expect(chip).toHaveCount(1);

  await page.getByRole('banner').getByRole('button', { name: '시뮬레이션', exact: true }).click();
  await expect(page.getByText('내 매매 규칙을 과거 데이터로 시험해 보세요')).toBeVisible();
  const phone = page.viewportSize()!.width < 600;
  await expect(chip).toHaveCount(phone ? 0 : 1);

  // 비교로 돌아오면 다시 있다
  await page.getByRole('button', { name: '비교로 돌아가기' }).click();
  await expect(chip).toHaveCount(1);
});
