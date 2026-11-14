import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium, expect } from '@playwright/test';
import {
  ROOT, PHONE, envPort, startPreview, newAppContext, openApp, enterDemo, pause,
  loadExampleGroup, openSettings, openSimulation, openTemplates, openEditor, runSimulation,
} from './lib/app-preview.mjs';

async function beginScene(page, { url }) {
  await openApp(page, url);
  await pause();
  await enterDemo(page);
  await pause();
}

async function show(locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible();
  await pause();
}

// simulate.spec.ts와 같은 머리 버튼 선택자예요. 펼친 본문도 화면에 담아요.
async function expandSection(page, title) {
  const head = page.locator('button[aria-expanded]', { has: page.getByText(title, { exact: true }) });
  await head.click();
  await expect(head).toHaveAttribute('aria-expanded', 'true');
  await show(head.locator('..'));
}

// HELP_PAGES의 id 순서예요. 각 장면은 새 컨텍스트에서 데모로 시작해요.
export const MENU_SCENES = {
  compare: async (page, ctx) => {
    await beginScene(page, ctx);
    await loadExampleGroup(page);
    await pause();
    const group = page.getByRole('tablist', { name: '관심 그룹' }).getByRole('tab').first();
    await group.click();
    await expect(group).toHaveAttribute('aria-selected', 'true');
    await pause();
    for (const name of ['주', '월', '년']) {
      const period = page.getByRole('radio', { name, exact: true });
      await period.click();
      await expect(period).toBeChecked();
      await pause();
    }
    await page.getByRole('button', { name: /^등락률/ }).click();
    const metrics = page.getByRole('dialog', { name: '비교 지표' });
    await show(metrics);
    await metrics.getByRole('button', { name: /^고점 대비 하락률/ }).click();
    await expect(metrics).toBeHidden();
    const board = page.getByRole('region', { name: '리더보드' });
    await expect(board).toContainText('고점 대비 하락률 순');
    await pause();
    for (const name of ['내 순서', '값 순']) {
      const sort = board.getByRole('button', { name, exact: true });
      await sort.click();
      await expect(sort).toHaveAttribute('aria-pressed', 'true');
      await pause();
    }
  },

  add: async (page, ctx) => {
    await beginScene(page, ctx);
    await loadExampleGroup(page);
    await pause();
    await page.getByRole('region', { name: '리더보드' }).getByRole('button', { name: '＋ 종목 추가' }).click();
    const sheet = page.getByRole('dialog', { name: '종목 추가' });
    await show(sheet);
    const search = sheet.getByRole('searchbox', { name: '종목 검색' });
    for (const query of ['삼성', 'ㅅㅅ', '005930']) {
      await search.fill(query);
      await expect(sheet.getByText(/^검색 결과 \d+$/)).toBeVisible();
      await expect(sheet.getByRole('button', { name: '삼성전자 빼기', exact: true })).toBeVisible();
      await pause();
    }
    await search.fill('ㅅㅅㅈㄱ');
    await expect(sheet.getByRole('button', { name: '삼성전자 빼기', exact: true })).toBeHidden();
    await show(sheet.getByRole('button', { name: '삼성전기 추가', exact: true }));
    await sheet.getByRole('button', { name: '삼성전기 추가', exact: true }).click();
    await expect(sheet).toContainText('5/10');
    await show(sheet.getByRole('button', { name: '삼성전기 빼기', exact: true }));
    await sheet.getByRole('button', { name: '삼성전기 빼기', exact: true }).click();
    await expect(sheet).toContainText('4/10');
    await pause();
    await sheet.getByRole('button', { name: '완료' }).click();
    await expect(sheet).toBeHidden();
  },

  groups: async (page, ctx) => {
    await beginScene(page, ctx);
    await loadExampleGroup(page);
    await pause();
    await page.getByRole('button', { name: '새 그룹', exact: true }).click();
    await expect(page.getByRole('tab', { name: '새 그룹 2', exact: true })).toHaveAttribute('aria-selected', 'true');
    await pause();
    await page.getByRole('button', { name: '그룹 관리', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: '그룹 관리' });
    await show(sheet);
    await sheet.getByRole('button', { name: '새 그룹 2 이름 바꾸기', exact: true }).click();
    const name = sheet.getByRole('textbox', { name: '그룹 이름' });
    await show(name);
    await name.fill('내 반도체');
    await pause();
    await name.press('Enter');
    await expect(sheet.getByRole('button', { name: '내 반도체 이름 바꾸기', exact: true })).toBeVisible();
    await pause();
    for (const direction of ['위로', '아래로']) {
      await sheet.getByRole('button', { name: `내 반도체 ${direction}`, exact: true }).click();
      await pause();
    }
    // 데모에서는 토스 가져오기가 숨겨져요. 조건으로 고르는 입구만 보여 줘요.
    await show(sheet.getByRole('button', { name: '조건으로 골라 새 그룹 만들기', exact: true }));
  },

  simulate: async (page, ctx) => {
    await beginScene(page, ctx);
    for (const enter of [loadExampleGroup, openSimulation, openTemplates, openEditor]) {
      await enter(page);
      await pause();
    }
    for (const title of ['매수 조건', '매도']) await expandSection(page, title);
    const result = await runSimulation(page);
    await pause();
    const bar = result.getByRole('group', { name: '재생' });
    await show(bar);
    const when = bar.locator('.when');
    const last = (await when.textContent()).trim();
    await bar.getByRole('button', { name: '재생', exact: true }).click();
    await expect(bar.getByRole('button', { name: '일시정지' })).toBeVisible();
    await expect(when).not.toHaveText(last);
    const snapshot = result.getByRole('region', { name: '그날 상황' });
    await expect(snapshot).toBeVisible();
    await expect(when).toContainText(/ · ([2-9]|\d{2,})\/\d+거래일$/, { timeout: 5000 });
    // 재생 중인 날짜와 그날 상황을 몇 초 보여 줘요.
    await show(snapshot);
    await pause(2000);
    await bar.getByRole('button', { name: '일시정지' }).click();
    await expect(bar.getByRole('button', { name: '재생', exact: true })).toBeVisible();
  },

  criteria: async (page, ctx) => {
    await beginScene(page, ctx);
    await openSettings(page);
    await pause();
    await show(page.getByRole('button', { name: '시장 데이터 가져오기', exact: true }));
    await page.getByLabel('시장 데이터 파일').setInputFiles(fileURLToPath(new URL('../tests/fixtures/market-data-demo.json.gz', import.meta.url)));
    await expect(page.getByText(/30종목/)).toBeVisible({ timeout: 30_000 });
    await pause();
    await page.getByRole('button', { name: '비교로 돌아가기' }).click();
    await pause();
    await openSimulation(page);
    await pause();
    const tab = page.getByRole('tab', { name: '선정 기준', exact: true });
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await pause();
    await page.getByRole('button', { name: '＋ 새 기준' }).first().click();
    // 조건 구역은 처음부터 펼쳐져 있어 스위치로 바로 가요.
    const marketCap = page.getByRole('switch', { name: '시가총액 사용', exact: true });
    await show(marketCap);
    await marketCap.click();
    await expect(marketCap).toHaveAttribute('aria-checked', 'true');
    await pause();
    await expandSection(page, '고를 개수·정렬');
    await page.getByRole('textbox', { name: '고를 개수', exact: true }).fill('10');
    await pause();
    await expandSection(page, '재선정·기간');
    const monthly = page.getByRole('radio', { name: '매월', exact: true });
    await monthly.click();
    await expect(monthly).toBeChecked();
    await pause();
    // 미리 보기는 설정을 바꾸면 자동으로 계산돼요.
    const preview = page.getByRole('region', { name: '오늘 기준 미리 보기', exact: true });
    await expect(preview.getByRole('status')).toHaveText(/통과 \d+개 · 상위 \d+개/, { timeout: 30_000 });
    await show(preview);
    await page.getByRole('button', { name: '검증 실행', exact: true }).click();
    await expect(page.getByRole('heading', { name: '오늘 기준 선별' })).toBeVisible({ timeout: 60_000 });
    await show(page.getByRole('heading', { name: '요약', exact: true }));
    await show(page.getByRole('region', { name: '시장별 보기', exact: true }));
  },

  performance: async (page, ctx) => {
    await beginScene(page, ctx);
    await page.getByRole('navigation').getByRole('button', { name: '내 성과', exact: true }).click();
    await expect(page.getByText('데모 계좌예요')).toBeVisible();
    await pause();
    await page.getByLabel('벤치마크').selectOption('069500');
    await expect(page.getByRole('region', { name: '요약' }).getByText('KODEX 200 연수익률')).toBeVisible();
    await pause();
    await page.getByLabel('기간').selectOption('2026');
    await expect(page.getByText(/^2026\.01\.\d\d ~ 2026\.10\.08$/)).toBeVisible();
    await pause();
    await show(page.getByRole('region', { name: '평가금액 + 회수액', exact: true }));
    await page.getByRole('button', { name: '표 보기', exact: true }).click();
    await show(page.getByRole('table', { name: '날짜별 평가금액과 회수액' }));
    const row = page.getByRole('button', { name: /삼성전자/ });
    await row.click();
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    await show(page.getByRole('table', { name: '삼성전자 체결 목록' }));
  },

  settings: async (page, ctx) => {
    await beginScene(page, ctx);
    await openSettings(page);
    await show(page.getByRole('radiogroup', { name: '데이터 공급자', exact: true }));
    await page.getByRole('radio', { name: '한국투자증권 (KIS)', exact: true }).click();
    await pause();
    // 빈 입력 칸만 보여 주고 저장·진단·암호 설정은 실행하지 않아요.
    for (const label of ['프록시 URL', '프록시 토큰 (선택)', 'App Key', 'App Secret']) {
      const field = page.getByLabel(label, { exact: true });
      await expect(field).toHaveValue('');
      await show(field);
    }
    await show(page.getByRole('button', { name: '진단 시작', exact: true }));
    await show(page.getByRole('switch', { name: '키를 암호로 잠그기', exact: true }));
  },
};

async function recordMenu(browser, url, id, out) {
  const context = await newAppContext(browser, PHONE, {
    recordVideo: { dir: fileURLToPath(out), size: { width: PHONE.width, height: PHONE.height } },
  });
  const [page] = context.pages();
  const video = page.video();
  try {
    await MENU_SCENES[id](page, { url });
    await pause();
  } finally {
    // 컨텍스트를 닫아야 녹화가 끝나요. 실패한 메뉴의 영상도 같은 id로 남겨요.
    await context.close();
    await video.saveAs(fileURLToPath(new URL(`${id}.webm`, out)));
    await video.delete();
  }
  console.log(`데모 영상: test-results/demo-video/${id}.webm`);
  try {
    await promisify(execFile)('ffmpeg', [
      '-y', '-i', fileURLToPath(new URL(`${id}.webm`, out)),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      fileURLToPath(new URL(`${id}.mp4`, out)),
    ], { cwd: ROOT, timeout: 120_000 });
    console.log(`데모 영상: test-results/demo-video/${id}.mp4`);
  } catch (e) {
    if (e.code !== 'ENOENT') throw new Error(`MP4 변환에 실패했어요(WEBM은 저장했어요): ${e.stderr || e.message}`);
    console.log(`${id}: ffmpeg가 PATH에 없어 WEBM 영상만 저장했어요.`);
  }
}

async function main(ids = process.argv.slice(2)) {
  const unknown = ids.filter((id) => !Object.hasOwn(MENU_SCENES, id));
  if (unknown.length) throw new Error(`알 수 없는 메뉴 id: ${unknown.join(', ')}. 가능한 id: ${Object.keys(MENU_SCENES).join(', ')}`);
  const selected = ids.length ? [...new Set(ids)] : Object.keys(MENU_SCENES);
  const out = new URL('../test-results/demo-video/', import.meta.url);
  await mkdir(out, { recursive: true });
  let preview;
  let browser;
  const failed = [];
  try {
    preview = await startPreview({ port: envPort('DEMO_VIDEO_PORT', 4182) });
    browser = await chromium.launch({ headless: true });
    for (const id of selected) {
      console.log(`${id}: 데모 녹화를 시작해요.`);
      try {
        await recordMenu(browser, preview.url, id, out);
      } catch (e) {
        failed.push({ id, message: e.message });
      }
    }
  } finally {
    try { if (browser) await browser.close(); }
    finally {
      try { if (preview) await preview.stop(); }
      finally {
        if (failed.length) {
          console.error(`녹화에 실패한 메뉴: ${failed.map(({ id }) => id).join(', ')}`);
          for (const { id, message } of failed) console.error(`${id}: ${message}`);
          process.exitCode = 1;
        }
      }
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`데모 녹화 실패: ${e.message}`); process.exitCode = 1; });
}
