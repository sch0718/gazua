import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { expect } from '@playwright/test';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const FIXED_NOW = '2026-10-08T17:42:00+09:00';
export const PHONE = { width: 375, height: 812, isMobile: true, hasTouch: true };
const HELP_SEEN = ['compare', 'add', 'groups', 'simulate', 'criteria', 'performance', 'settings'];

export const pause = (ms = 1000) => sleep(ms);

export function envPort(name, fallback) {
  const port = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${name}: 포트는 1~65535 정수여야 해요.`);
  return port;
}

export async function startPreview({ port }) {
  try {
    await access(new URL('../../dist/index.html', import.meta.url));
  } catch {
    throw new Error('빌드가 없어요. 먼저 pnpm build를 실행해 주세요.');
  }
  const url = `http://127.0.0.1:${port}/`;
  const vite = fileURLToPath(new URL('./bin/vite.js', import.meta.resolve('vite/package.json')));
  const child = spawn(process.execPath, [vite, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1' },
  });
  let output = '';
  let error;
  let ended = false;
  const closed = new Promise((resolve) => child.once('close', () => { ended = true; resolve(); }));
  child.on('error', (e) => { error = e; });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (data) => { output = (output + data).slice(-8000); });
  // 정상 종료 경로의 보조 정리예요. 평소에는 호출한 쪽의 finally에서 stop()으로 닫아요.
  const onExit = () => child.kill('SIGTERM');
  process.once('exit', onExit);
  let stopping;
  function stop() {
    return stopping ??= (async () => {
      if (!ended) {
        child.kill('SIGTERM');
        const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
        try { await closed; } finally { clearTimeout(timer); }
      }
      process.removeListener('exit', onExit);
    })();
  }
  try {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (error || ended) throw new Error(`미리보기 서버를 시작하지 못했어요: ${error?.message ?? output}`);
      // 기존 서버가 같은 포트에서 응답해도 strictPort 실패를 성공으로 보지 않아요.
      if (output.includes(url)) {
        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
          await response.body?.cancel();
          if (response.ok && !ended) return { url, stop };
        } catch { /* 시작 직후에는 아직 응답하지 않을 수 있어요. */ }
      }
      await sleep(100);
    }
    throw new Error(`미리보기 서버 응답을 기다리다 시간이 지났어요: ${output}`);
  } catch (e) {
    await stop();
    throw e;
  }
}

export async function newAppContext(browser, { width, height, isMobile = false, hasTouch = false }, { recordVideo } = {}) {
  const context = await browser.newContext({
    viewport: { width, height }, isMobile, hasTouch,
    locale: 'ko-KR', timezoneId: 'Asia/Seoul', serviceWorkers: 'block',
    ...(recordVideo ? { recordVideo } : {}),
  });
  try {
    context.setDefaultTimeout(15_000);
    await context.addInitScript((seen) => localStorage.setItem('gazua:help-seen:v1', JSON.stringify(seen)), HELP_SEEN);
    const page = await context.newPage();
    // 시각만 고정하고 재생 타이머는 계속 돌아가게 해요(e2e/helpers.ts와 같아요).
    await page.clock.setFixedTime(new Date(FIXED_NOW));
    return context;
  } catch (e) {
    await context.close();
    throw e;
  }
}

export async function openApp(page, url) {
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1, name: '가즈아' })).toBeVisible();
}

export async function enterDemo(page) {
  await page.getByRole('button', { name: '데모로 둘러보기' }).click();
  await expect(page.getByText('비교할 종목을 추가해 보세요')).toBeVisible();
}

export async function loadExampleGroup(page) {
  await page.getByRole('button', { name: '예시 그룹 불러오기' }).click();
  await expect(page.getByRole('region', { name: '리더보드' }).getByRole('listitem')).toHaveCount(4);
}

export async function openSimulation(page) {
  await page.getByRole('navigation').getByRole('button', { name: '시뮬레이션', exact: true }).click();
  await expect(page.getByText('내 매매 규칙을 과거 데이터로 시험해 보세요')).toBeVisible();
}

export async function openSettings(page) {
  await page.getByRole('navigation').getByRole('button', { name: '설정', exact: true }).click();
  await expect(page.getByRole('heading', { name: '데이터 공급자' })).toBeVisible();
}

export async function openTemplates(page) {
  await page.getByRole('button', { name: '＋ 새 전략' }).click();
  await expect(page.getByRole('button', { name: /하락 후 반등/ })).toBeVisible();
}

export async function openEditor(page) {
  await page.getByRole('button', { name: /하락 후 반등/ }).click();
  await expect(page.getByRole('button', { name: '시뮬레이션 실행' })).toBeVisible();
}

export async function expandEditor(page) {
  // simulate.spec.ts의 '편집: 모든 구역을 펼쳐도'와 같은 순서로 펼쳐요.
  for (const title of ['종목', '기간·자금', '매수 조건', '분할 매수', '매도', '비교 기준', '비용']) {
    const head = page.locator('button[aria-expanded]', { has: page.getByText(title, { exact: true }) });
    await head.click();
    await expect(head).toHaveAttribute('aria-expanded', 'true');
  }
  await page.locator('label', { hasText: /^분할 매수$/ }).click();
  await expect(page.getByRole('switch', { name: '분할 매수 사용' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('textbox', { name: '추가 매수 간격' })).toBeVisible();
}

export async function runSimulation(page) {
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  const result = page.getByRole('region', { name: '시뮬레이션 결과' }).last();
  await expect(result.getByText('총수익률', { exact: true })).toBeVisible({ timeout: 30_000 });
  return result;
}
