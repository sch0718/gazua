// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lwcCharts, resetLwcStub, ResizeObserverStub } from '../lib/chart/lwcStub';
import { makeTestApp, itemsOf } from '../sheets/testApp';
import type { App } from '../lib/state/app.svelte';
import { ApiError } from '../lib/providers/errors';
import { newStrategy } from '../lib/sim/defaults';
import { simulate } from '../lib/sim/simulate';
import { doneState, noTrades } from '../lib/ui/simulate/resultFixture';
import { kstEpoch } from '../lib/time/kst';
import { dismissSnackbar, currentSnackbar } from '../lib/ui/components/snackbarStore.svelte';
import Simulate from './Simulate.svelte';

vi.mock('lightweight-charts', async () => (await import('../lib/chart/lwcStub')).lwcModule());
vi.mock('../lib/sim/simulate', async (orig) => {
  const m = await orig<typeof import('../lib/sim/simulate')>();
  return { ...m, simulate: vi.fn(m.simulate) };
});

const NOW = kstEpoch('2026-10-12', '10:00:00');
// 실제 barEnd처럼 compact(폰 폭)이면 상태 칩을 그리지 않는다.
const barEnd = createRawSnippet((compact: () => boolean) => ({
  render: () => (compact() ? '<span></span>' : '<span data-testid="chip">상태 칩</span>'),
}));

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
  vi.mocked(simulate).mockClear();
  vi.restoreAllMocks();
  for (const a of apps) a.destroy();
  apps = [];
  dismissSnackbar();
  vi.unstubAllGlobals();
  resetLwcStub();
});

function stubWidth(wide: boolean, phone = false) {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  vi.stubGlobal(
    'matchMedia',
    (q: string) =>
      ({
        matches: (wide && q === '(min-width: 1024px)') || (phone && q === '(max-width: 599px)'),
        media: q,
        addEventListener() {},
        removeEventListener() {},
      }) as unknown as MediaQueryList,
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

  it('menu: rename with an empty name shows an error under the field on Enter', async () => {
    const app = setup(['눌림목']);
    await fireEvent.click(screen.getByRole('button', { name: '눌림목 메뉴' }));
    await fireEvent.click(screen.getByRole('button', { name: '이름 바꾸기' }));
    const input = screen.getByRole('textbox', { name: '전략 이름' });
    await fireEvent.input(input, { target: { value: '   ' } });
    await fireEvent.submit(input.closest('form')!);
    expect(screen.getByText('이름을 적어 주세요')).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(app.strategies[0].name).toBe('눌림목');
    // 다시 적으면 오류가 사라진다
    await fireEvent.input(input, { target: { value: '반등' } });
    expect(screen.queryByText('이름을 적어 주세요')).toBeNull();
  });

  it('menu: rename with an empty name twice re-inserts the alert so it is announced again', async () => {
    setup(['눌림목']);
    await fireEvent.click(screen.getByRole('button', { name: '눌림목 메뉴' }));
    await fireEvent.click(screen.getByRole('button', { name: '이름 바꾸기' }));
    const input = screen.getByRole('textbox', { name: '전략 이름' });
    await fireEvent.input(input, { target: { value: '' } });
    await fireEvent.submit(input.closest('form')!);
    const first = await screen.findByRole('alert');
    await fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(screen.getByRole('alert')).not.toBe(first));
    expect(screen.getByRole('alert').textContent).toBe('이름을 적어 주세요');
  });

  it('menu: delete shows 되돌리기 and restores in place', async () => {
    const app = setup(['가', '나', '다']);
    await fireEvent.click(screen.getByRole('button', { name: '나 메뉴' }));
    await fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    expect(app.strategies.map((s) => s.name)).toEqual(['가', '다']);
    expect(currentSnackbar()?.message).toBe("'나'을(를) 삭제했어요");
    expect(currentSnackbar()?.action?.label).toBe('되돌리기');
    currentSnackbar()!.action!.run();
    expect(app.strategies.map((s) => s.name)).toEqual(['가', '나', '다']);
  });

  it('new strategies are numbered: 새 전략, 새 전략 2', async () => {
    const app = setup();
    await fireEvent.click(screen.getByRole('button', { name: '＋ 새 전략' }));
    app.navigate({ name: 'simulate' });
    await fireEvent.click(await screen.findByRole('button', { name: '＋ 새 전략' }));
    expect(app.strategies.map((s) => s.name)).toEqual(['새 전략', '새 전략 2']);
  });

  it('at 20 strategies, 복제 only shows the limit snackbar', async () => {
    const app = setup(Array.from({ length: 20 }, (_, i) => `전략 ${i}`));
    await fireEvent.click(screen.getByRole('button', { name: '전략 3 메뉴' }));
    await fireEvent.click(screen.getByRole('button', { name: '복제' }));
    expect(app.strategies).toHaveLength(20);
    expect(currentSnackbar()?.message).toBe('전략은 20개까지 저장할 수 있어요');
  });

  it('at 20 strategies, 되돌리기 does not restore and shows the limit snackbar', async () => {
    const app = setup(Array.from({ length: 20 }, (_, i) => `전략 ${i}`));
    await fireEvent.click(screen.getByRole('button', { name: '전략 3 메뉴' }));
    await fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    expect(app.strategies).toHaveLength(19);
    // 지운 자리가 다른 전략으로 다시 찼다
    app.setStrategies([...app.strategies, newStrategy(NOW, 'g1', '끼어든 전략')]);
    currentSnackbar()!.action!.run();
    expect(app.strategies).toHaveLength(20);
    expect(app.strategies.some((s) => s.name === '전략 3')).toBe(false);
    expect(currentSnackbar()?.message).toBe('전략은 20개까지 저장할 수 있어요');
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

  it('the rail puts 시뮬레이션 right before 설정', () => {
    setup();
    const nav = screen.getByRole('navigation', { name: '탐색' });
    const sim = within(nav).getByRole('button', { name: '시뮬레이션' });
    const set = within(nav).getByRole('button', { name: '설정' });
    expect(sim.nextElementSibling).toBe(set);
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

  it('폰 폭 편집 화면: 실행 → 결과 → 규칙 → 바의 결과 버튼으로 결과에 돌아온다', async () => {
    stubWidth(false, true);
    const app = setup(['눌림목']);
    shortPeriod(app);
    app.navigate({ name: 'simulate', strategyId: 's0' });
    expect(screen.queryByRole('button', { name: '결과' })).toBeNull();
    await fireEvent.click(await screen.findByRole('button', { name: '시뮬레이션 실행' }));
    expect(await screen.findByText('배당 제외 · 가격 수익률만이에요', {}, { timeout: 5000 })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: '규칙' }));
    expect(screen.getByRole('textbox', { name: '전략 이름' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '규칙' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: '결과' }));
    expect(screen.getByText('배당 제외 · 가격 수익률만이에요')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: '전략 이름' })).toBeNull();
    expect(screen.getByRole('button', { name: '규칙' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '결과' })).toBeNull();
  }, 15000);

  it('폰 폭: 일부 종목을 못 받은 안내(partial)에서 규칙으로 가도 결과 버튼으로 돌아온다', async () => {
    stubWidth(false, true);
    const app = setup(['눌림목']);
    shortPeriod(app);
    const real = app.provider.getCandles.bind(app.provider);
    vi.spyOn(app.provider, 'getCandles').mockImplementation((q) => (q.symbol === '000660' ? Promise.reject(new Error('x')) : real(q)));
    app.navigate({ name: 'simulate', strategyId: 's0' });
    await fireEvent.click(await screen.findByRole('button', { name: '시뮬레이션 실행' }));
    expect(await screen.findByRole('button', { name: '빼고 계속' }, { timeout: 5000 })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: '규칙' }));
    expect(screen.getByRole('textbox', { name: '전략 이름' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: '결과' }));
    expect(screen.getByRole('button', { name: '빼고 계속' })).toBeTruthy();
  }, 15000);

  it('편집 화면 제목은 항상 시뮬레이션이다(이름은 이름 칸에)', async () => {
    stubWidth(false, true);
    const app = setup(['눌림목']);
    app.navigate({ name: 'simulate', strategyId: 's0' });
    await screen.findByRole('textbox', { name: '전략 이름' });
    const bar = document.querySelector('header.bar') as HTMLElement;
    expect(within(bar).getByText('시뮬레이션')).toBeTruthy();
    expect(within(bar).queryByText('눌림목')).toBeNull();
  });

  it('PC 폭에는 결과 버튼이 없다', async () => {
    stubWidth(true);
    const app = setup(['눌림목']);
    shortPeriod(app);
    app.navigate({ name: 'simulate', strategyId: 's0' });
    await fireEvent.click(await screen.findByRole('button', { name: '시뮬레이션 실행' }));
    expect(await screen.findByText('배당 제외 · 가격 수익률만이에요', {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '결과' })).toBeNull();
  }, 15000);
});

describe('Simulate run states', () => {
  const STALE = '규칙이 바뀌었어요. 다시 실행하면 결과에 반영돼요';
  const dropOf = () => vi.mocked(simulate).mock.calls.at(-1)![0].strategy.entry.decline.dropPct.value;

  async function runWide() {
    stubWidth(true);
    const app = setup(['눌림목']);
    shortPeriod(app);
    app.navigate({ name: 'simulate', strategyId: 's0' });
    await fireEvent.click(await screen.findByRole('button', { name: '시뮬레이션 실행' }));
    expect(await screen.findByText('배당 제외 · 가격 수익률만이에요', {}, { timeout: 5000 })).toBeTruthy();
    return app;
  }

  it('넓은 화면 idle: 결과 칸에 안내 문구', async () => {
    stubWidth(true);
    const app = setup(['눌림목']);
    app.navigate({ name: 'simulate', strategyId: 's0' });
    expect(await screen.findByText('규칙을 정하고 시뮬레이션 실행을 누르면 여기에 결과가 나와요')).toBeTruthy();
  });

  it('stale result shows the rules-changed banner and reruns with the current draft', async () => {
    await runWide();
    expect(screen.queryByText(STALE)).toBeNull();
    const before = dropOf();
    await fireEvent.click(screen.getByRole('button', { name: /^매수/ }));
    await fireEvent.input(screen.getByRole('textbox', { name: '고점 대비 하락폭' }), { target: { value: String(before + 7) } });
    expect(await screen.findByText(STALE)).toBeTruthy();
    vi.mocked(simulate).mockClear();
    await fireEvent.click(screen.getByRole('button', { name: '다시 실행' }));
    await waitFor(() => expect(simulate).toHaveBeenCalled(), { timeout: 5000 });
    expect(dropOf()).toBe(before + 7);
    await waitFor(() => expect(screen.queryByText(STALE)).toBeNull());
  }, 20000);

  it('이름만 바꾸면 결과는 오래된 것이 아니다', async () => {
    await runWide();
    await fireEvent.input(screen.getByRole('textbox', { name: '전략 이름' }), { target: { value: '반등' } });
    expect(screen.queryByText(STALE)).toBeNull();
  }, 15000);

  it('규칙을 원래대로 돌리면 배너가 사라진다', async () => {
    await runWide();
    const before = dropOf();
    await fireEvent.click(screen.getByRole('button', { name: /^매수/ }));
    const input = screen.getByRole('textbox', { name: '고점 대비 하락폭' });
    await fireEvent.input(input, { target: { value: String(before + 7) } });
    expect(await screen.findByText(STALE)).toBeTruthy();
    await fireEvent.input(input, { target: { value: String(before) } });
    await waitFor(() => expect(screen.queryByText(STALE)).toBeNull());
  }, 20000);

  it('좁은 화면에는 오래된 결과 배너가 없다', async () => {
    stubWidth(false, true);
    const app = setup(['눌림목']);
    shortPeriod(app);
    app.navigate({ name: 'simulate', strategyId: 's0' });
    await fireEvent.click(await screen.findByRole('button', { name: '시뮬레이션 실행' }));
    expect(await screen.findByText('배당 제외 · 가격 수익률만이에요', {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByText(STALE)).toBeNull();
  }, 15000);

  it('모든 종목을 받지 못하면 연결 문구와 다시 시도(현재 draft로)', async () => {
    stubWidth(false, true);
    const app = setup(['눌림목']);
    shortPeriod(app);
    const spy = vi.spyOn(app.provider, 'getCandles').mockImplementation(() => Promise.reject(new Error('x')));
    app.navigate({ name: 'simulate', strategyId: 's0' });
    await fireEvent.click(await screen.findByRole('button', { name: '시뮬레이션 실행' }));
    expect(await screen.findByRole('button', { name: '진단 열기' }, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByText('기간 안에 받은 데이터가 없어요')).toBeNull();
    const calls = spy.mock.calls.length;
    await fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThan(calls), { timeout: 5000 });
  }, 15000);

  it('모든 종목 일봉 요청이 ApiError로 실패하면 그 오류의 배너 문구와 해결 행동', async () => {
    stubWidth(false, true);
    const app = setup(['눌림목']);
    shortPeriod(app);
    vi.spyOn(app.provider, 'getCandles').mockImplementation(() => Promise.reject(new ApiError('invalid-credentials')));
    app.navigate({ name: 'simulate', strategyId: 's0' });
    await fireEvent.click(await screen.findByRole('button', { name: '시뮬레이션 실행' }));
    expect(await screen.findByText('키가 맞지 않아요', {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByRole('button', { name: '키 다시 입력' })).toBeTruthy();
    expect(screen.queryByText('종목 정보를 받지 못했어요')).toBeNull();
  }, 15000);

  it('작업본에 막는 경고가 있으면 다시 시도는 실행 대신 그 구역을 연다(버튼은 꺼지지 않는다)', async () => {
    stubWidth(false, true);
    const app = setup(['눌림목']);
    shortPeriod(app);
    const spy = vi.spyOn(app.provider, 'getCandles').mockImplementation(() => Promise.reject(new Error('x')));
    app.navigate({ name: 'simulate', strategyId: 's0' });
    await fireEvent.click(await screen.findByRole('button', { name: '시뮬레이션 실행' }));
    await screen.findByRole('button', { name: '진단 열기' }, { timeout: 5000 });
    // 규칙으로 가서 사는 신호를 모두 끈다(막는 경고)
    await fireEvent.click(screen.getByRole('button', { name: '규칙' }));
    const head = () => screen.getAllByRole('button').find((b) => b.hasAttribute('aria-expanded') && b.querySelector('b')?.textContent === '매수')!;
    await fireEvent.click(head());
    await fireEvent.click(screen.getByRole('switch', { name: '저점 뒤 연속 상승 사용' }));
    await fireEvent.click(screen.getByRole('switch', { name: '전 고점 돌파 사용' }));
    await fireEvent.click(head());
    expect(head().getAttribute('aria-expanded')).toBe('false');
    await fireEvent.click(screen.getByRole('button', { name: '결과' }));
    const retry = screen.getByRole('button', { name: '다시 시도' }) as HTMLButtonElement;
    expect(retry.disabled).toBe(false);
    const calls = spy.mock.calls.length;
    await fireEvent.click(retry);
    expect(head().getAttribute('aria-expanded')).toBe('true');
    expect(spy.mock.calls.length).toBe(calls); // 다시 받지 않았다
  }, 15000);

  it('규칙 고치기(기간·자금) 뒤 결과로 갔다가 규칙을 다시 열면 구역이 강제로 열리지 않는다', async () => {
    stubWidth(false, true);
    const app = setup(['눌림목']);
    shortPeriod(app);
    // 전부 건너뜀(현금 부족) 결과 → 규칙 고치기는 기간·자금을 연다
    vi.mocked(simulate).mockImplementationOnce(() =>
      doneState((s) => noTrades(s, [{ date: '2024-07-02', symbol: '000660', reason: '현금 부족' }])).result,
    );
    app.navigate({ name: 'simulate', strategyId: 's0' });
    await fireEvent.click(await screen.findByRole('button', { name: '시뮬레이션 실행' }));
    await fireEvent.click(await screen.findByRole('button', { name: '규칙 고치기' }, { timeout: 5000 }));
    const periodHead = () => screen.getAllByRole('button').find((b) => b.hasAttribute('aria-expanded') && b.querySelector('b')?.textContent === '기간·자금')!;
    expect(periodHead().getAttribute('aria-expanded')).toBe('true');
    // 결과 → 규칙: 편집기가 다시 만들어져도 이전 요청을 다시 열지 않는다
    await fireEvent.click(screen.getByRole('button', { name: '결과' }));
    await fireEvent.click(await screen.findByRole('button', { name: '규칙' }));
    expect(periodHead().getAttribute('aria-expanded')).toBe('false');
  }, 15000);
});

describe('Simulate app bar', () => {
  it('폰 폭에서는 상태 칩이 없고 넓은 화면에서는 있다', () => {
    stubWidth(false, true);
    setup();
    expect(screen.queryByTestId('chip')).toBeNull();
  });

  it('폰이 아니면 상태 칩이 있다', () => {
    stubWidth(false, false);
    setup();
    expect(screen.getByTestId('chip')).toBeTruthy();
  });
});
