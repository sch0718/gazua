import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';

// 브라우저 없이 규칙·스니펫과, 적었으면 선택자(`selector`)·화면 제한으로 기준선을 맞춰요.
// 렌더 지적의 선택자에는 Svelte 해시 클래스(svelte-xxxx)가 붙으니 정규식은 해시를 빼고 써요.
export function matchBaseline(finding, screen, baseline) {
  return baseline.find((entry) =>
    entry.rule === finding.antipattern &&
    (!entry.screens || entry.screens.includes(screen)) &&
    new RegExp(entry.match).test(finding.snippet) &&
    (!entry.selector || new RegExp(entry.selector).test(finding.selector ?? '')),
  ) ?? null;
}

const exec = promisify(execFile);

async function detect(cdpPort, root) {
  const cli = fileURLToPath(new URL('./cli/bin/cli.js', import.meta.resolve('impeccable/package.json')));
  let stdout;
  try {
    ({ stdout } = await exec(process.execPath, [cli, 'detect', '--json', '--cdp', String(cdpPort)], {
      cwd: root, env: { ...process.env, DO_NOT_TRACK: '1', IMPECCABLE_NO_TELEMETRY: '1' },
      timeout: 60_000, maxBuffer: 16 * 1024 * 1024,
    }));
  } catch (e) {
    if (e.code !== 2 || e.killed || e.signal) throw new Error(`렌더 검사 실행에 실패했어요: ${e.stderr || e.message}`);
    stdout = e.stdout;
  }
  const findings = JSON.parse(stdout);
  if (!Array.isArray(findings) || findings.some((item) => !item ||
    typeof item.antipattern !== 'string' || typeof item.snippet !== 'string')) {
    throw new Error('렌더 검사 결과가 antipattern·snippet을 가진 객체 배열이 아니에요.');
  }
  return findings;
}

function printReport(report) {
  const groups = new Map();
  for (const screen of report.screens) {
    console.log(`${screen.viewport} · ${screen.name}: ${screen.status}${screen.error ? ` (${screen.error})` : ''}`);
    for (const finding of screen.findings) {
      const key = JSON.stringify([finding.antipattern, finding.snippet]);
      if (!groups.has(key)) groups.set(key, { finding, places: [] });
      groups.get(key).places.push({ screen, baseline: finding.baseline });
    }
  }
  for (const [label, known] of [['기준선', true], ['새 지적', false]]) {
    console.log(`\n${label}`);
    let count = 0;
    for (const { finding, places } of groups.values()) {
      const selected = places.filter((place) => Boolean(place.baseline) === known);
      if (!selected.length) continue;
      count++;
      console.log(`- ${finding.antipattern}: ${finding.snippet}`);
      console.log(`  ${selected.map(({ screen }) => `${screen.viewport}/${screen.id}`).join(', ')}`);
      for (const reason of new Set(selected.map(({ baseline }) => baseline && `${baseline.class}: ${baseline.reason}`).filter(Boolean))) {
        console.log(`  ${reason}`);
      }
    }
    console.log(`${count}개 원인`);
  }
  console.log(`\n화면 완료 ${report.screens.filter((s) => s.status === '완료').length}/${report.screens.length}, 종료 코드 ${report.exitCode}`);
}

async function main() {
  // 순수 함수 시험에서는 Playwright나 미리보기 서버를 불러오지 않아요.
  const { chromium, expect } = await import('@playwright/test');
  const app = await import('./lib/app-preview.mjs');
  const baseline = JSON.parse(await readFile(new URL('./design-scan-baseline.json', import.meta.url), 'utf8'));
  // 잘못된 기준선은 화면을 열기 전에 드러내요.
  for (const entry of baseline) { new RegExp(entry.match); if (entry.selector) new RegExp(entry.selector); }
  const report = { screens: [], errors: [], exitCode: 0 };
  const steps = [
    ['onboarding', '온보딩', (page, url) => app.openApp(page, url)],
    ['compare-empty', '비교 빈 상태', app.enterDemo],
    ['compare-example', '비교 예시 그룹', app.loadExampleGroup],
    ['simulate-list', '시뮬레이션 목록', app.openSimulation],
    ['templates', '템플릿 고르기', app.openTemplates],
    ['editor', '편집기 처음', app.openEditor],
    ['editor-open', '편집기 모든 구역', app.expandEditor],
    ['result', '시뮬레이션 결과', app.runSimulation],
    ['performance', '성과', async (page, url) => {
      await page.goto(`${url}#/performance`);
      await expect(page.getByRole('region', { name: '요약' })).toBeVisible({ timeout: 30_000 });
    }],
    ['settings', '설정', async (page, url) => {
      await page.goto(`${url}#/settings`);
      await expect(page.getByRole('heading', { name: '데이터 공급자', exact: true })).toBeVisible();
    }],
    ['help', '도움말', async (page, url) => {
      await page.goto(`${url}#/help`);
      await expect(page.getByRole('heading', { level: 1, name: '도움말', exact: true })).toBeVisible();
    }],
  ];
  const viewports = [['폰', app.PHONE], ['데스크톱', { width: 1440, height: 900 }]];
  for (const [viewport, size] of viewports) {
    for (const [id, name] of steps) report.screens.push({ viewport, size, id, name, status: '건너뜀', findings: [] });
  }
  let preview;
  let browser;
  try {
    const cdpPort = app.envPort('DESIGN_SCAN_CDP_PORT', 9341);
    preview = await app.startPreview({ port: app.envPort('DESIGN_SCAN_PORT', 4181) });
    browser = await chromium.launch({ headless: true, args: [`--remote-debugging-port=${cdpPort}`] });
    for (const [viewport, size] of viewports) {
      let context;
      let blocked;
      try {
        context = await app.newAppContext(browser, size);
        const [page] = context.pages();
        for (const [id, , enter] of steps) {
          const screen = report.screens.find((s) => s.viewport === viewport && s.id === id);
          if (blocked) { screen.error = `앞 화면 이동 실패: ${blocked}`; continue; }
          try {
            await enter(page, preview.url);
            await sleep(500);
          } catch (e) {
            blocked = e.message;
            screen.error = `화면 이동 실패: ${e.message}`;
            continue;
          }
          try {
            screen.findings = (await detect(cdpPort, app.ROOT)).map((finding) => ({
              ...finding, baseline: matchBaseline(finding, id, baseline),
            }));
            screen.status = '완료';
          } catch (e) {
            screen.status = '실패';
            screen.error = e.message;
          }
        }
      } catch (e) {
        report.errors.push(`${viewport}: ${e.message}`);
      } finally {
        // 다음 뷰포트로 가기 전에 페이지를 모두 닫아 CDP의 대상이 하나만 남게 해요.
        if (context) await context.close();
      }
    }
  } catch (e) {
    report.errors.push(e.message);
  } finally {
    try { if (browser) await browser.close(); }
    catch (e) { report.errors.push(`브라우저 종료 실패: ${e.message}`); }
    finally {
      if (preview) await preview.stop().catch((e) => report.errors.push(`서버 종료 실패: ${e.message}`));
    }
  }
  report.exitCode = report.errors.length || report.screens.some((s) => s.status !== '완료') ? 2
    : report.screens.some((s) => s.findings.some((f) => !f.baseline)) ? 1 : 0;
  const out = new URL('../test-results/design-scan/', import.meta.url);
  await mkdir(out, { recursive: true });
  await writeFile(new URL('report.json', out), JSON.stringify(report, null, 2) + '\n');
  printReport(report);
  for (const error of report.errors) console.error(`실패: ${error}`);
  console.log('보고서: test-results/design-scan/report.json');
  process.exitCode = report.exitCode;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`렌더 스캔 실패: ${e.message}`); process.exitCode = 2; });
}
