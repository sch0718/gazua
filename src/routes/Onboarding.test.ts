// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import kisPrice from '../lib/providers/fixtures/kis/inquire-price-005930.json';
import kisToken from '../lib/providers/fixtures/kis/token.json';
import type { App } from '../lib/state/app.svelte';
import { DEMO_BANNER } from '../lib/state/app.svelte';
import { kstEpoch } from '../lib/time/kst';
import { EXAMPLE_SYMBOLS } from '../lib/ui/compare/compareView';
import { dismissSnackbar } from '@sch0718/ui-svelte';
import { makeTestApp } from '../sheets/testApp';
import Onboarding from './Onboarding.svelte';

const NOW = kstEpoch('2026-10-12', '10:00:00');

/** 프록시 흉내: /health, KIS 토큰, 현재가. */
const okFetch = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.endsWith('/health')) return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
  const body = url.includes('/oauth2/tokenP') ? kisToken : kisPrice;
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}) as unknown as typeof fetch;

let apps: App[] = [];
function setup(fetchImpl = okFetch) {
  // 앱 공급자도 같은 가짜 프록시를 쓴다(진단이 공급자의 토큰을 함께 쓰므로, 실제 네트워크로 나가지 않게).
  const app = makeTestApp({
    groups: [{ id: 'g1', name: '내 관심', items: [] }],
    now: NOW,
    settings: { onboarded: false },
    fetchImpl,
  });
  apps.push(app);
  expect(app.route.name).toBe('onboarding');
  render(Onboarding, { app, fetchImpl, now: () => NOW });
  return app;
}
const progress = () => screen.getByRole('progressbar');
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));

async function toKeys(app: App, provider: '한국투자증권 (KIS)' | '토스증권' = '한국투자증권 (KIS)') {
  await click('내 API로 시작');
  await fireEvent.click(screen.getByRole('radio', { name: provider }));
  await click(/^다음 — 프록시 연결/);
  expect(screen.getByRole('link', { name: '배포 방법 보기' }).getAttribute('href')).toBe(
    'https://github.com/sch0718/gazua/blob/main/proxy/README.md',
  );
  await fireEvent.input(screen.getByLabelText('프록시 URL'), { target: { value: 'https://proxy.example.net' } });
  await click('다음 — 키 입력');
  await waitFor(() => expect(progress().getAttribute('aria-valuenow')).toBe('4'));
  expect(app.settings.proxyUrl).toBe('https://proxy.example.net');
}

afterEach(() => {
  for (const a of apps) a.destroy();
  apps = [];
  dismissSnackbar();
});

describe('Onboarding', () => {
  it('starts at step 1 of 5 and 데모로 둘러보기 enters demo mode with the demo banner', async () => {
    const app = setup();
    expect(progress().getAttribute('aria-valuenow')).toBe('1');
    expect(progress().getAttribute('aria-valuemax')).toBe('5');
    await click('데모로 둘러보기');
    expect(app.settings).toMatchObject({ provider: 'demo', onboarded: true });
    expect(app.route.name).toBe('compare');
    const banner = app.banners.find((b) => b.id === 'demo');
    expect(banner?.text).toBe(DEMO_BANNER);
    expect(banner?.action?.label).toBe('연결하기');
  });

  it('every later step also offers 데모로 둘러보기', async () => {
    const app = setup();
    await click('내 API로 시작');
    expect(progress().getAttribute('aria-valuenow')).toBe('2');
    expect(screen.getByText('키와 설정은 이 브라우저에만 저장돼요. 서버로 보내지 않아요.')).toBeTruthy();
    await click(/^다음 — 프록시 연결/);
    expect(progress().getAttribute('aria-valuenow')).toBe('3');
    await click('데모로 둘러보기');
    expect(app.settings).toMatchObject({ provider: 'demo', onboarded: true });
    expect(app.route.name).toBe('compare');
  });

  it('finishes after a successful diagnosis with the example group', async () => {
    const app = setup();
    await toKeys(app);
    await fireEvent.input(screen.getByLabelText('App Key'), { target: { value: 'PSkey-1234' } });
    await fireEvent.input(screen.getByLabelText('App Secret'), { target: { value: 'secret-5678' } });
    await click('다음 — 연결 진단');
    await waitFor(() => expect(progress().getAttribute('aria-valuenow')).toBe('5'));
    expect(screen.queryByRole('button', { name: '예시 그룹으로 시작' })).toBeNull();
    await click('진단 시작');
    await fireEvent.click(await screen.findByRole('button', { name: '예시 그룹으로 시작' }));
    expect(app.settings).toMatchObject({ provider: 'kis', onboarded: true });
    expect(app.watchlists.groups[0].items.map((i) => i.symbol)).toEqual(EXAMPLE_SYMBOLS);
    expect(app.route).toEqual({ name: 'compare', groupId: 'g1' });
    expect(app.banners.find((b) => b.id === 'demo')).toBeUndefined();
  });

  it('빈 그룹으로 시작 finishes without adding symbols', async () => {
    const app = setup();
    await toKeys(app);
    await fireEvent.input(screen.getByLabelText('App Key'), { target: { value: 'PSkey-1234' } });
    await fireEvent.input(screen.getByLabelText('App Secret'), { target: { value: 'secret-5678' } });
    await click('다음 — 연결 진단');
    await waitFor(() => expect(progress().getAttribute('aria-valuenow')).toBe('5'));
    await click('진단 시작');
    await fireEvent.click(await screen.findByRole('button', { name: '빈 그룹으로 시작' }));
    expect(app.settings.onboarded).toBe(true);
    expect(app.watchlists.groups[0].items).toEqual([]);
    expect(app.route.name).toBe('compare');
  });

  it('Toss: after saving keys, recommends locking before the diagnosis step', async () => {
    const app = setup();
    await toKeys(app, '토스증권');
    await fireEvent.input(screen.getByLabelText('Client ID'), { target: { value: 'cid-1234' } });
    await fireEvent.input(screen.getByLabelText('Client Secret'), { target: { value: 'csec-5678' } });
    await click('다음 — 연결 진단');
    expect(await screen.findByText('토스 키는 주문 권한이 있어요. 암호로 잠그는 걸 권해요')).toBeTruthy();
    expect(progress().getAttribute('aria-valuenow')).toBe('4');
    expect(app.secrets?.toss).toEqual({ clientId: 'cid-1234', clientSecret: 'csec-5678' });
    await click('나중에 잠글게요');
    expect(progress().getAttribute('aria-valuenow')).toBe('5');
  });

  it('moves focus to the new step heading', async () => {
    setup();
    await click('내 API로 시작');
    await waitFor(() => expect(document.activeElement?.tagName).toBe('H1'));
    expect(document.activeElement?.textContent).toContain('어디서 시세를');
  });

  it('the back button returns to the previous step', async () => {
    setup();
    await click('내 API로 시작');
    await click('이전 단계');
    expect(progress().getAttribute('aria-valuenow')).toBe('1');
  });
});


describe('토스 키 없는 온보딩', () => {
  it('프록시가 맡으면 키 입력 위 버튼으로 진단에 간다', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url) => String(url).endsWith('/health')
      ? Response.json({ ok: true, tossToken: true })
      : Response.json({ result: [{ symbol: '005930', lastPrice: '100' }] }));
    const app = setup(fetchImpl);
    await toKeys(app, '토스증권');
    expect(await screen.findByText('맥 프록시가 토스 토큰을 맡고 있어서 키 없이 써도 돼요')).toBeTruthy();
    await fireEvent.click(screen.getAllByRole('button', { name: '다음 — 연결 진단' })[0]);
    expect(progress().getAttribute('aria-valuenow')).toBe('5');
    expect(app.secrets?.toss).toBeUndefined();
    await click('진단 시작');
    expect(await screen.findByRole('button', { name: '빈 그룹으로 시작' })).toBeTruthy();
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes('/oauth2/token'))).toBe(false);
  });
  it.each([false, 'error'])('관리하지 않거나 확인 실패면 기존 키 입력을 유지한다: %s', async (state) => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
      if (state === 'error') throw new Error('가짜 연결 실패');
      return Response.json({ ok: true, tossToken: false });
    });
    const app = setup(fetchImpl);
    await toKeys(app, '토스증권');
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('맥 프록시가 토스 토큰을 맡고 있어서 키 없이 써도 돼요')).toBeNull();
    expect(screen.getAllByRole('button', { name: '다음 — 연결 진단' })).toHaveLength(1);
    expect(screen.getByLabelText('Client ID')).toBeTruthy();
  });
});
