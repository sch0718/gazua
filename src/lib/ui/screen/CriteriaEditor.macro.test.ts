// @vitest-environment jsdom
// 4단계 편집 화면: 환율·유가 조건, 테마·내 묶음 후보 범위, 민감도 정렬, 막는 경고와 미리 보기.
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTestApp } from '../../../sheets/testApp';
import type { UniverseItem } from '../../data/universe';
import type { MarketDataInfo } from '../../marketData/store';
import { newBasket } from '../../screen/baskets';
import { newCriteria } from '../../screen/defaults';
import type { WorkerInput } from '../../screen/runValidation';
import type { Selection } from '../../screen/select';
import { NOW } from '../../screen/testData';
import type { SelectionCriteria } from '../../screen/types';
import type { App } from '../../state/app.svelte';
import { dismissSnackbar } from '../components/snackbarStore.svelte';
import CriteriaEditor from './CriteriaEditor.svelte';

const RANGE = { from: '2024-10-16', to: '2026-10-15' };
const V2 = { collectedAt: '2026-10-16T09:00:00+09:00', stocks: 30, range: RANGE, version: 2 as const, hasMacro: true, themeCount: 2 };
const V1 = { collectedAt: '2026-10-16T09:00:00+09:00', stocks: 30, range: RANGE };
const THEMES = [
  { code: 'T01', name: '반도체', count: 12 },
  { code: 'T02', name: '2차전지', count: 30 },
];
const ITEMS = [{ s: '100000', n: '가온전자' }] as unknown as UniverseItem[];
const selection: Selection = { date: '2026-10-16', passed: 25, picked: [{ symbol: '100000', values: {} }] };

let apps: App[] = [];
type Setup = { info?: MarketDataInfo; crit?: (c: SelectionCriteria) => void; themes?: typeof THEMES; baskets?: ReturnType<typeof newBasket>[] };
function setup(o: Setup = {}) {
  const app = makeTestApp({ groups: [{ id: 'g1', name: '반도체주', items: [] }], now: NOW });
  apps.push(app);
  if (o.baskets) app.setBaskets(o.baskets);
  const c = { ...newCriteria(NOW, RANGE, '내 기준'), id: 'c1' };
  o.crit?.(c);
  app.setCriteria([c]);
  const preview = vi.fn(async (_input: WorkerInput) => selection);
  const onRun = vi.fn();
  render(CriteriaEditor, {
    app,
    criteria: c,
    info: o.info ?? V2,
    sectors: [],
    themes: o.themes ?? ((o.info ?? V2).version === 2 ? THEMES : []),
    preview,
    onRun,
    loadItems: async () => ITEMS,
  });
  return { app, preview, onRun };
}
const section = (title: string) => screen.getByRole('button', { name: new RegExp(`^${title}`) });
const open = async (title: string) => {
  const b = section(title);
  if (b.getAttribute('aria-expanded') !== 'true') await fireEvent.click(b);
};
const runBtn = () => screen.getByRole('button', { name: '검증 실행' });
const field = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement;
const sw = (name: string) => screen.getByRole('switch', { name }) as HTMLButtonElement;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  for (const a of apps) a.destroy();
  apps = [];
  dismissSnackbar();
});

describe('환율·유가 소구역', () => {
  it('has a switch per series and kind with the spec 5.2 help, and WTI swaps 환율 for 유가', () => {
    setup();
    for (const l of ['원/달러 민감도', '원/달러 흐름 따라가기', '유가 민감도', '유가 흐름 따라가기']) expect(sw(`${l} 사용`).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('환율이 1% 오를 때 주가가 평균 몇 % 움직였는지예요. +면 같이 오르고, −면 반대로 움직여요.')).toBeTruthy();
    expect(screen.getByText('유가가 1% 오를 때 주가가 평균 몇 % 움직였는지예요. +면 같이 오르고, −면 반대로 움직여요.')).toBeTruthy();
    expect(screen.getByText('최근 며칠 동안 환율이 크게 오르면 같이 오르는 종목을, 크게 내리면 반대로 움직이는 종목을 골라요.')).toBeTruthy();
    expect(field('민감도 계산 기간').value).toBe('120');
    // 이 V2에는 매매동향이 없어 그 소구역만 안내가 보인다(환율·유가 소구역에는 없다)
    expect(within(document.querySelector('.macro')!).queryByText('다시 수집하면 쓸 수 있어요')).toBeNull();
  });

  it('switches and numbers reach the saved criteria', async () => {
    const { app } = setup();
    await fireEvent.click(sw('원/달러 민감도 사용'));
    await fireEvent.input(field('원/달러 최소 민감도'), { target: { value: '0.5' } });
    await fireEvent.input(field('민감도 계산 기간'), { target: { value: '60' } });
    await fireEvent.click(sw('유가 흐름 따라가기 사용'));
    await fireEvent.input(field('유가 흐름 기간'), { target: { value: '10' } });
    await fireEvent.click(screen.getAllByRole('radio', { name: '현금으로 두기' })[1]);
    await vi.advanceTimersByTimeAsync(500);
    const m = app.criteria[0].conditions.macro;
    expect(m.usdkrw.beta).toEqual({ on: true, min: 0.5, max: 5 });
    expect(m.betaDays).toBe(60);
    expect(m.wti.trend).toMatchObject({ on: true, lookback: 10, whenFlat: 'none' });
    expect(m.usdkrw.trend.whenFlat).toBe('pass');
  });

  it('an out-of-range number blocks the run even after the section is folded', async () => {
    const { onRun } = setup();
    await fireEvent.input(field('원/달러 최소 민감도'), { target: { value: '25' } });
    expect(screen.getByRole('alert').textContent).toBe('-20~20 사이로 적어 주세요');
    await fireEvent.click(section('조건')); // 접힘
    expect(screen.queryByRole('textbox', { name: '원/달러 최소 민감도' })).toBeNull();
    await fireEvent.click(runBtn());
    expect(onRun).not.toHaveBeenCalled();
    expect(section('조건').getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(field('원/달러 최소 민감도'));
    await fireEvent.input(field('원/달러 최소 민감도'), { target: { value: '0.4' } });
    await fireEvent.click(runBtn());
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it('a reversed beta range is a blocking warning, and the preview stops while it stands', async () => {
    const { onRun, preview } = setup();
    await vi.advanceTimersByTimeAsync(300);
    expect(preview).toHaveBeenCalledTimes(1);
    preview.mockClear();
    await fireEvent.click(sw('유가 민감도 사용'));
    await fireEvent.input(field('유가 최소 민감도'), { target: { value: '6' } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(screen.getByText('유가 민감도 범위의 최소가 최대보다 커요')).toBeTruthy();
    expect(preview).not.toHaveBeenCalled();
    expect(screen.getByText('고칠 곳을 고치면 미리 볼 수 있어요').getAttribute('role')).toBe('status'); // 기존 상태 영역의 글만 바뀐다
    await fireEvent.click(runBtn());
    expect(onRun).not.toHaveBeenCalled();
    await fireEvent.input(field('유가 최소 민감도'), { target: { value: '1' } });
    await vi.advanceTimersByTimeAsync(300);
    expect(preview).toHaveBeenCalledTimes(1);
  });

  it('the conditions summary counts the FX/oil switches', async () => {
    setup();
    await fireEvent.click(sw('원/달러 민감도 사용'));
    await fireEvent.click(sw('유가 흐름 따라가기 사용'));
    expect(section('조건').textContent).toContain('4개 켬'); // 거래대금·반등 + 2
  });
});

describe('v1 데이터(환율·유가·테마 없음)', () => {
  it('turns the FX/oil rows and the theme picker off with the re-collect hint', async () => {
    setup({ info: V1 });
    await open('후보 범위');
    expect(screen.getAllByText('다시 수집하면 쓸 수 있어요')).toHaveLength(3); // 환율·유가 + 매매동향 + 테마
    expect(sw('원/달러 민감도 사용').getAttribute('aria-disabled')).toBe('true');
    expect(field('원/달러 최소 민감도').matches(':disabled')).toBe(true); // 비활성 fieldset 안
    expect((screen.getByRole('searchbox', { name: '테마 검색' }) as HTMLInputElement).disabled).toBe(true);
  });

  it('a condition that was already on stays blocking, can be switched off, and then the run goes', async () => {
    const { onRun } = setup({ info: V1, crit: (c) => (c.conditions.macro.wti.beta.on = true) });
    expect(sw('유가 민감도 사용').disabled).toBe(false);
    expect(screen.getAllByText('이 데이터에는 환율·유가가 없어요')).toHaveLength(1);
    await fireEvent.click(runBtn());
    expect(onRun).not.toHaveBeenCalled();
    await fireEvent.click(sw('유가 민감도 사용'));
    expect(screen.queryByText('이 데이터에는 환율·유가가 없어요')).toBeNull();
    await fireEvent.click(runBtn());
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it('turning an already-on condition off keeps keyboard focus on its toggle, and turning one on stays refused', async () => {
    const { app } = setup({ info: V1, crit: (c) => (c.conditions.macro.wti.beta.on = true) });
    const on = sw('유가 민감도 사용');
    on.focus();
    await fireEvent.click(on);
    expect(document.activeElement).toBe(on);
    expect(on.getAttribute('aria-checked')).toBe('false');
    expect(on.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(on.getAttribute('aria-describedby')!)!.textContent).toBe('다시 수집하면 쓸 수 있어요');
    await fireEvent.click(on); // 다시 켜려 해도 막힌다
    expect(on.getAttribute('aria-checked')).toBe('false');
    await vi.advanceTimersByTimeAsync(500);
    expect(app.criteria[0].conditions.macro.wti.beta.on).toBe(false);
  });

  it('sorting by 민감도 큰 순 is blocked in the sort section with the same copy', async () => {
    const { onRun } = setup({ info: V1, crit: (c) => (c.rank.by = 'macroBeta') });
    await open('고를 개수·정렬');
    const msg = within(document.querySelector('.editor')!).getAllByText('이 데이터에는 환율·유가가 없어요');
    expect(msg).toHaveLength(1);
    // 정렬 구역 안에 있고, 실제로 실행을 막는다
    const sortBody = section('고를 개수·정렬').closest('section')!;
    expect(sortBody.contains(msg[0])).toBe(true);
    await fireEvent.click(runBtn());
    expect(onRun).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(msg[0].closest('[id]'));
  });
});

describe('민감도 큰 순 정렬', () => {
  it('shows the series select only when chosen and saves the series', async () => {
    const { app } = setup();
    await open('고를 개수·정렬');
    expect(screen.queryByRole('combobox', { name: '민감도 계열' })).toBeNull();
    await fireEvent.click(screen.getByRole('radio', { name: '민감도 큰 순' }));
    const pick = screen.getByRole('combobox', { name: '민감도 계열' });
    await fireEvent.change(pick, { target: { value: 'wti' } });
    await vi.advanceTimersByTimeAsync(500);
    expect(app.criteria[0].rank).toMatchObject({ by: 'macroBeta', series: 'wti' });
  });
});

describe('후보 범위: 테마와 내 묶음', () => {
  it('picks themes into the pool and shows the summary 테마 n·묶음 n', async () => {
    const b = { ...newBasket(NOW, '내 묶음', ['100000']), id: 'b1' };
    const { app } = setup({ baskets: [b] });
    await open('후보 범위');
    await fireEvent.click(screen.getByRole('checkbox', { name: /반도체/ }));
    await fireEvent.click(screen.getByRole('checkbox', { name: /2차전지/ }));
    await fireEvent.click(screen.getByRole('checkbox', { name: /내 묶음/ }));
    await vi.advanceTimersByTimeAsync(500);
    expect(app.criteria[0].pool.themes).toEqual(['T01', 'T02']);
    expect(app.criteria[0].pool.baskets).toEqual(['b1']);
    expect(section('후보 범위').textContent).toContain('KOSPI·KOSDAQ 주식 · 테마 2·묶음 1');
    await fireEvent.click(screen.getByRole('button', { name: '반도체 테마 지우기' }));
    await vi.advanceTimersByTimeAsync(500);
    expect(app.criteria[0].pool.themes).toEqual(['T02']);
  });

  it('a deleted basket in the criteria warns (not blocking) and can be unchecked', async () => {
    const { onRun, app } = setup({ crit: (c) => (c.pool.baskets = ['gone']) });
    await open('후보 범위');
    expect(screen.getByText('지워진 내 묶음이 있어요. 다시 골라 주세요')).toBeTruthy();
    await fireEvent.click(screen.getByRole('checkbox', { name: '지워진 묶음' }));
    await vi.advanceTimersByTimeAsync(500);
    expect(app.criteria[0].pool.baskets).toEqual([]);
    expect(screen.queryByText('지워진 내 묶음이 있어요. 다시 골라 주세요')).toBeNull();
    await fireEvent.click(runBtn());
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it('a saved theme missing from the new data warns without blocking', async () => {
    const { onRun } = setup({ crit: (c) => (c.pool.themes = ['T99']) });
    await open('후보 범위');
    expect(screen.getByText('지금 데이터에 없는 테마가 있어요')).toBeTruthy();
    await fireEvent.click(runBtn());
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it('the preview call carries the baskets of this profile', async () => {
    const b = { ...newBasket(NOW, '내 묶음', ['100000']), id: 'b1' };
    const { preview } = setup({ baskets: [b], crit: (c) => (c.pool.baskets = ['b1']) });
    await vi.advanceTimersByTimeAsync(300);
    expect(preview.mock.calls[0][0].baskets).toEqual([b]);
  });

  it('opening 묶음 관리 shows the manage sheet and closing returns focus to the button', async () => {
    setup();
    await open('후보 범위');
    const btn = screen.getByRole('button', { name: '묶음 관리' });
    btn.focus();
    await fireEvent.click(btn);
    expect(screen.getByRole('dialog', { name: '묶음 관리' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(btn);
  });
});
