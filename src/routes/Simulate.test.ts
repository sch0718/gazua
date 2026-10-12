// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lwcCharts, ResizeObserverStub } from '../lib/chart/lwcStub';
import { makeTestApp, itemsOf } from '../sheets/testApp';
import type { App } from '../lib/state/app.svelte';
import { newStrategy } from '../lib/sim/defaults';
import { kstEpoch } from '../lib/time/kst';
import { dismissSnackbar, currentSnackbar } from '../lib/ui/components/snackbarStore.svelte';
import Simulate from './Simulate.svelte';

vi.mock('lightweight-charts', async () => (await import('../lib/chart/lwcStub')).lwcModule());

const NOW = kstEpoch('2026-10-12', '10:00:00');
const barEnd = createRawSnippet(() => ({ render: () => '<span></span>' }));

let apps: App[] = [];
function setup(names: string[] = []) {
  const app = makeTestApp({
    groups: [{ id: 'g1', name: '반도체', items: itemsOf(['005930', '000660']) }],
    now: NOW,
  });
  apps.push(app);
  app.setStrategies(names.map((n, i) => ({ ...newStrategy(NOW - i, 'g1', n), id: `s${i}` })));
  app.navigate({ name: 'simulate' });
  render(Simulate, { app, barEnd });
  return app;
}

afterEach(() => {
  for (const a of apps) a.destroy();
  apps = [];
  dismissSnackbar();
  vi.unstubAllGlobals();
  lwcCharts.length = 0;
});

function stubWidth(wide: boolean) {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  vi.stubGlobal(
    'matchMedia',
    (q: string) => ({ matches: wide && q === '(min-width: 1024px)', media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
  );
}

function shortPeriod(app: App) {
  app.setStrategies(app.strategies.map((s) => ({ ...s, period: { from: '2026-03-02', to: '2026-06-30' } })));
}

describe('Simulate list', () => {
  it('empty state invites a first strategy', () => {
    setup();
    expect(screen.getByText('내 매매 규칙을 과거 데이터로 시험해 보세요')).toBeTruthy();
    expect(screen.getByRole('button', { name: '＋ 새 전략' })).toBeTruthy();
  });

  it('＋ 새 전략 saves one strategy and opens it', async () => {
    const app = setup();
    await fireEvent.click(screen.getByRole('button', { name: '＋ 새 전략' }));
    expect(app.strategies).toHaveLength(1);
    expect(location.hash).toBe(`#/simulate/${app.strategies[0].id}`);
    expect(app.route).toEqual({ name: 'simulate', strategyId: app.strategies[0].id });
  });

  it('shows rows with a one-line summary', () => {
    setup(['눌림목']);
    expect(screen.getByText('눌림목')).toBeTruthy();
    expect(screen.getByText(/^반도체 · \d{4}\.\d{2}\.\d{2}~\d{4}\.\d{2}\.\d{2}$/)).toBeTruthy();
  });

  it('tapping a row opens the editor placeholder with the name', async () => {
    const app = setup(['눌림목']);
    await fireEvent.click(screen.getByText('눌림목'));
    expect(app.route).toEqual({ name: 'simulate', strategyId: 's0' });
  });

  it('renders the editor with the strategy name when a strategyId is routed', async () => {
    const app = setup(['눌림목']);
    app.navigate({ name: 'simulate', strategyId: 's0' });
    expect(((await screen.findByRole('textbox', { name: '전략 이름' })) as HTMLInputElement).value).toBe('눌림목');
  });

  it('menu: duplicate adds a 사본', async () => {
    const app = setup(['눌림목']);
    await fireEvent.click(screen.getByRole('button', { name: '눌림목 메뉴' }));
    await fireEvent.click(screen.getByRole('button', { name: '복제' }));
    expect(app.strategies.map((s) => s.name)).toContain('눌림목 사본');
    expect(app.strategies).toHaveLength(2);
    expect(new Set(app.strategies.map((s) => s.id)).size).toBe(2);
  });

  it('menu: rename', async () => {
    const app = setup(['눌림목']);
    await fireEvent.click(screen.getByRole('button', { name: '눌림목 메뉴' }));
    await fireEvent.click(screen.getByRole('button', { name: '이름 바꾸기' }));
    const input = screen.getByRole('textbox', { name: '전략 이름' });
    await fireEvent.input(input, { target: { value: '반등 매매' } });
    await fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(app.strategies[0].name).toBe('반등 매매');
  });

  it('menu: delete shows 되돌리기 and restores in place', async () => {
    const app = setup(['가', '나', '다']);
    await fireEvent.click(screen.getByRole('button', { name: '나 메뉴' }));
    await fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    expect(app.strategies.map((s) => s.name)).toEqual(['가', '다']);
    expect(currentSnackbar()?.action?.label).toBe('되돌리기');
    currentSnackbar()!.action!.run();
    expect(app.strategies.map((s) => s.name)).toEqual(['가', '나', '다']);
  });

  it('at 20 strategies ＋ 새 전략 only shows a snackbar', async () => {
    const app = setup(Array.from({ length: 20 }, (_, i) => `전략 ${i}`));
    await fireEvent.click(screen.getByRole('button', { name: '＋ 새 전략' }));
    expect(app.strategies).toHaveLength(20);
    expect(currentSnackbar()?.message).toBe('전략은 20개까지 저장할 수 있어요');
  });

  it('a missing strategy shows 전략을 찾을 수 없어요', async () => {
    const app = setup(['눌림목']);
    app.navigate({ name: 'simulate', strategyId: 'nope' });
    await waitFor(() => expect(currentSnackbar()?.message).toBe('전략을 찾을 수 없어요'));
    expect(app.route).toEqual({ name: 'simulate' });
  });

  it('the rail has a 시뮬레이션 item marked current', () => {
    setup();
    const nav = screen.getByRole('navigation', { name: '탐색' });
    const item = within(nav).getByRole('button', { name: '시뮬레이션' });
    expect(item.className).toContain('on');
  });
});

describe('Simulate run', () => {
  it('실행하면 결과로 바뀌고 규칙 버튼으로 편집으로 돌아간다(좁은 폭)', async () => {
    stubWidth(false);
    const app = setup(['눌림목']);
    shortPeriod(app);
    app.navigate({ name: 'simulate', strategyId: 's0' });
    await fireEvent.click(await screen.findByRole('button', { name: '시뮬레이션 실행' }));
    expect(screen.queryByRole('textbox', { name: '전략 이름' })).toBeNull();
    expect(await screen.findByText('배당 제외 · 가격 수익률만이에요', {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText('데모 데이터')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: '규칙' }));
    expect(screen.getByRole('textbox', { name: '전략 이름' })).toBeTruthy();
    expect(screen.queryByText('배당 제외 · 가격 수익률만이에요')).toBeNull();
    expect(screen.queryByRole('button', { name: '규칙' })).toBeNull();
  }, 15000);

  it('PC 폭(≥1024)에서는 편집과 결과가 함께 보인다', async () => {
    stubWidth(true);
    const app = setup(['눌림목']);
    shortPeriod(app);
    app.navigate({ name: 'simulate', strategyId: 's0' });
    await fireEvent.click(await screen.findByRole('button', { name: '시뮬레이션 실행' }));
    expect(await screen.findByText('배당 제외 · 가격 수익률만이에요', {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '전략 이름' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '규칙' })).toBeNull();
  }, 15000);

  it('실행 전 고친 내용(저장 대기 중)으로 실행하고, 실행은 전략을 다시 쓰지 않는다', async () => {
    stubWidth(true);
    const app = setup(['눌림목']);
    shortPeriod(app);
    app.navigate({ name: 'simulate', strategyId: 's0' });
    const name = await screen.findByRole('textbox', { name: '전략 이름' });
    await fireEvent.input(name, { target: { value: '반등' } });
    await fireEvent.click(screen.getByRole('button', { name: '시뮬레이션 실행' }));
    // 실행 직전에 저장 대기분을 바로 저장한다
    expect(app.strategies[0].name).toBe('반등');
    const saved = app.strategies[0];
    expect(await screen.findByText('배당 제외 · 가격 수익률만이에요', {}, { timeout: 5000 })).toBeTruthy();
    expect(app.strategies[0]).toBe(saved);
  }, 15000);

  it('다른 전략으로 가면 결과를 버리고 편집으로 돌아간다', async () => {
    stubWidth(false);
    const app = setup(['눌림목', '반등']);
    shortPeriod(app);
    app.navigate({ name: 'simulate', strategyId: 's0' });
    await fireEvent.click(await screen.findByRole('button', { name: '시뮬레이션 실행' }));
    expect(await screen.findByText('배당 제외 · 가격 수익률만이에요', {}, { timeout: 5000 })).toBeTruthy();
    app.navigate({ name: 'simulate', strategyId: 's1' });
    expect(((await screen.findByRole('textbox', { name: '전략 이름' })) as HTMLInputElement).value).toBe('반등');
    expect(screen.queryByText('배당 제외 · 가격 수익률만이에요')).toBeNull();
    expect(screen.queryByRole('button', { name: '규칙' })).toBeNull();
  }, 15000);
});
