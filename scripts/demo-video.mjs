import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';
import {
  ROOT, PHONE, envPort, startPreview, newAppContext, openApp, enterDemo,
  loadExampleGroup, openSimulation, openTemplates, openEditor, runSimulation,
} from './lib/app-preview.mjs';

async function main() {
  const out = new URL('../test-results/demo-video/', import.meta.url);
  await mkdir(out, { recursive: true });
  let preview;
  let browser;
  let context;
  let video;
  try {
    preview = await startPreview({ port: envPort('DEMO_VIDEO_PORT', 4182) });
    browser = await chromium.launch({ headless: true });
    context = await newAppContext(browser, PHONE, {
      recordVideo: { dir: fileURLToPath(out), size: { width: PHONE.width, height: PHONE.height } },
    });
    const [page] = context.pages();
    video = page.video();
    for (const enter of [openApp, enterDemo, loadExampleGroup, openSimulation, openTemplates, openEditor]) {
      await enter(page, preview.url);
      await sleep(1000);
    }
    const result = await runSimulation(page);
    await sleep(1000);
    const bar = result.getByRole('group', { name: '재생' });
    await expect(bar).toBeVisible();
    const when = bar.locator('.when');
    const last = (await when.textContent()).trim();
    await bar.getByRole('button', { name: '재생' }).click();
    await expect(bar.getByRole('button', { name: '일시정지' })).toBeVisible();
    await expect(when).not.toHaveText(last);
    await expect(result.getByRole('region', { name: '그날 상황' })).toBeVisible();
    await expect(when).toContainText(/ · ([2-9]|\d{2,})\/\d+거래일$/, { timeout: 5000 });
    await sleep(3000);
    await bar.getByRole('button', { name: '일시정지' }).click();
    await expect(bar.getByRole('button', { name: '재생' })).toBeVisible();
    await sleep(1000);
    await context.close();
    context = undefined;
    // 녹화 완료 뒤, 브라우저 연결을 닫기 전에 결과물을 저장해요.
    await video.saveAs(fileURLToPath(new URL('gazua-demo.webm', out)));
    await video.delete();
    console.log('데모 영상: test-results/demo-video/gazua-demo.webm');
  } finally {
    // 컨텍스트를 닫아야 녹화가 끝나요. 실패해도 브라우저와 서버까지 정리해요.
    try { if (context) await context.close(); }
    finally {
      try { if (browser) await browser.close(); }
      finally { if (preview) await preview.stop(); }
    }
  }
  const webm = fileURLToPath(new URL('gazua-demo.webm', out));
  try {
    await promisify(execFile)('ffmpeg', [
      '-y', '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      fileURLToPath(new URL('gazua-demo.mp4', out)),
    ], { cwd: ROOT, timeout: 120_000 });
    console.log('데모 영상: test-results/demo-video/gazua-demo.mp4');
  } catch (e) {
    if (e.code !== 'ENOENT') throw new Error(`MP4 변환에 실패했어요(WEBM은 저장했어요): ${e.stderr || e.message}`);
    console.log('ffmpeg가 PATH에 없어 WEBM 영상만 저장했어요.');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`데모 녹화 실패: ${e.message}`); process.exitCode = 1; });
}
