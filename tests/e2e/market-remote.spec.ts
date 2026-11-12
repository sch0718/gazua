/// <reference types="vite/client" />
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { validateMarketData } from '../../src/lib/marketData/format';
import type { WorkerRequest } from '../../src/lib/screen/runValidation';
import { validationResult } from '../../src/lib/ui/screen/resultFixture';
import { enterDemo, openApp } from './helpers';

const FIXTURE = 'tests/fixtures/market-data-demo.json.gz';
const BASE = 'https://market-mac.example.test';
const TOKEN = 'market-test-token';
const parsed = validateMarketData(JSON.parse(gunzipSync(readFileSync(FIXTURE)).toString()));
if (!parsed.ok) throw new Error('시장 데이터 시험 파일을 읽지 못했어요');
const data = parsed.data;
const info = { collectedAt: data.collectedAt, stocks: data.stocks.length, range: data.range, version: data.version, hasMacro: true, hasFlow: true, hasFin: true };

async function configureRemote(page: Page) {
  // 실제 앱 저장소에 설정만 넣는다. 시장 원본과 Worker는 앱의 기본 선택을 거친다.
  await page.evaluate(({ base, token }) => {
    const meta = JSON.parse(localStorage.getItem('gazua:v1:meta')!);
    const prefix = `gazua:v1:p:${meta.activeProfileId}:`;
    const settings = JSON.parse(localStorage.getItem(`${prefix}settings`) ?? '{}');
    localStorage.setItem(`${prefix}settings`, JSON.stringify({ ...settings, proxyUrl: base }));
    localStorage.setItem(`${prefix}secrets`, JSON.stringify({ proxyToken: token }));
  }, { base: BASE, token: TOKEN });
  await page.reload();
}
async function criteria(page: Page) {
  await page.getByRole('navigation').getByRole('button', { name: '시뮬레이션', exact: true }).click();
  await page.getByRole('tab', { name: '선정 기준' }).click();
}

test('로컬 파일 없이 맥 원격 요약·미리 보기·검증을 기본 원본으로 쓴다', async ({ page }) => {
  const requests: string[] = [];
  await page.route(`${BASE}/market/**`, async (route) => {
    const req = route.request(); requests.push(req.url());
    expect(req.headers()['x-proxy-token']).toBe(TOKEN);
    if (req.url().endsWith('/meta')) {
      await route.fulfill({ json: { info: { ...info, file: 'market-data-demo.json.gz' }, sectors: data.sectors, themes: 'themes' in data ? data.themes : [] } });
      return;
    }
    const msg = req.postDataJSON() as WorkerRequest;
    expect(msg.input.data).toBeUndefined();
    const result = validationResult();
    const response = msg.type === 'preview' ? { type: 'preview', id: msg.id, selection: result.today } : { type: 'result', result };
    await route.fulfill({ json: response });
  });
  await openApp(page); await enterDemo(page); await configureRemote(page); await criteria(page);
  await expect(page.getByText(/맥\(원격\) · 수집/)).toBeVisible();
  await page.getByRole('button', { name: '＋ 새 기준' }).first().click();
  await expect(page.getByRole('region', { name: '오늘 기준 미리 보기' }).getByRole('status')).toHaveText(/통과 \d+개 · 상위 \d+개/);
  await page.getByRole('button', { name: '검증 실행' }).click();
  await expect(page.getByRole('heading', { name: '오늘 기준 선별' })).toBeVisible();
  expect(requests.filter((url) => url.endsWith('/meta'))).toHaveLength(1);
  expect(requests.filter((url) => url.endsWith('/screen')).length).toBeGreaterThanOrEqual(2);
});

test('이 기기 파일이 있으면 프록시 설정이 있어도 시장 원격 요청을 하지 않는다', async ({ page }) => {
  const requests: string[] = [];
  await page.route(`${BASE}/market/**`, async (route) => { requests.push(route.request().url()); await route.abort(); });
  await openApp(page); await enterDemo(page);
  await page.getByRole('navigation').getByRole('button', { name: '설정', exact: true }).click();
  await page.getByLabel('시장 데이터 파일').setInputFiles(FIXTURE);
  await expect(page.getByText(/30종목/)).toBeVisible();
  await configureRemote(page);
  // 설정 화면에서 새로 고침했으므로 비교 화면을 거쳐 이동한다.
  await page.getByRole('button', { name: '비교로 돌아가기' }).click();
  await criteria(page);
  await page.getByRole('button', { name: '＋ 새 기준' }).first().click();
  await expect(page.getByRole('region', { name: '오늘 기준 미리 보기' }).getByRole('status')).toHaveText(/통과 \d+개 · 상위 \d+개/);
  await page.getByRole('button', { name: '검증 실행' }).click();
  await expect(page.getByRole('heading', { name: '오늘 기준 선별' })).toBeVisible();
  expect(requests).toEqual([]);
});
