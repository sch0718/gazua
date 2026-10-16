// @vitest-environment jsdom
// 3단계 편집 화면: 투자자 매매동향 소구역(순매수 규모·연속 순매수)과 `수급 순` 정렬, 수급 없는 데이터에서의 막기.
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTestApp } from '../../../sheets/testApp';
import type { UniverseItem } from '../../data/universe';
import type { MarketDataInfo } from '../../marketData/store';
import { newCriteria } from '../../screen/defaults';
import type { WorkerInput } from '../../screen/runValidation';
import type { Selection } from '../../screen/select';
import { NOW } from '../../screen/testData';
import type { SelectionCriteria } from '../../screen/types';
import type { App } from '../../state/app.svelte';
import { dismissSnackbar } from '../components/snackbarStore.svelte';
import CriteriaEditor from './CriteriaEditor.svelte';

const RANGE = { from: '2024-10-16', to: '2026-10-15' };
const V3: MarketDataInfo = { collectedAt: '2026-10-16T09:00:00+09:00', stocks: 30, range: RANGE, version: 3, hasMacro: true, themeCount: 0, hasFlow: true, flowStocks: 7 };
const V2: MarketDataInfo = { ...V3, version: 2, hasFlow: false, flowStocks: 0 };
const ITEMS = [{ s: '100000', n: '가온전자' }] as unknown as UniverseItem[];
const selection: Selection = { date: '2026-10-16', passed: 25, picked: [{ symbol: '100000', values: {} }] };
const NO_FLOW = '이 데이터에는 투자자 매매동향이 없어요';

let apps: App[] = [];
function setup(o: { info?: MarketDataInfo; crit?: (c: SelectionCriteria) => void } = {}) {
  const app = makeTestApp({ groups: [{ id: 'g1', name: '반도체주', items: [] }], now: NOW });
  apps.push(app);
  const c = { ...newCriteria(NOW, RANGE, '내 기준'), id: 'c1' };
  o.crit?.(c);
  app.setCriteria([c]);
  const preview = vi.fn(async (_input: WorkerInput) => selection);
  const onRun = vi.fn();
  render(CriteriaEditor, { app, criteria: c, info: o.info ?? V3, sectors: [], themes: [], preview, onRun, loadItems: async () => ITEMS });
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
const radio = (group: string, name: string) => within(screen.getByRole('radiogroup', { name: group })).getByRole('radio', { name });

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  for (const a of apps) a.destroy();
  apps = [];
  dismissSnackbar();
});

describe('투자자 매매동향 소구역', () => {
  it('has the two rows with the spec 4.1 help, the common lag hint and the four subject names', () => {
    setup();
    expect(screen.getByText('투자자 매매동향')).toBeTruthy();
    expect(sw('순매수 규모 사용').getAttribute('aria-checked')).toBe('false');
    expect(sw('연속 순매수 사용').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('최근 기간 순매수 금액이 같은 기간 거래대금에서 차지하는 비율이에요. 음수면 순매도예요')).toBeTruthy();
    expect(screen.getByText('이 주체가 하루도 빠짐없이 순매수한 날이 이어진 수예요')).toBeTruthy();
    expect(screen.getByText('매매동향은 하루 늦게 반영해요(장 마감 뒤 수치가 바뀔 수 있어서)')).toBeTruthy();
    const names = within(screen.getByRole('radiogroup', { name: '순매수 규모 주체' })).getAllByRole('radio').map((r) => r.textContent!.trim());
    expect(names).toEqual(['외국인', '기관', '개인', '외국인+기관']);
    // 기본값(스펙 3.3): 순매수 규모는 외국인 20일 1~100%, 연속 순매수는 기관 5일
    expect(radio('순매수 규모 주체', '외국인').getAttribute('aria-checked')).toBe('true');
    expect(radio('연속 순매수 주체', '기관').getAttribute('aria-checked')).toBe('true');
    expect(field('순매수 기간').value).toBe('20');
    expect(field('최소 순매수 비율').value).toBe('1');
    expect(field('최대 순매수 비율').value).toBe('100');
    expect(field('최소 연속 일수').value).toBe('5');
    expect(screen.queryByText('다시 수집하면 쓸 수 있어요')).toBeNull();
  });

  it('switches, subjects, days and range reach the saved criteria, and the summary counts them', async () => {
    const { app } = setup();
    await fireEvent.click(sw('순매수 규모 사용'));
    await fireEvent.click(radio('순매수 규모 주체', '외국인+기관'));
    await fireEvent.input(field('순매수 기간'), { target: { value: '10' } });
    await fireEvent.input(field('최소 순매수 비율'), { target: { value: '-2.5' } });
    await fireEvent.input(field('최대 순매수 비율'), { target: { value: '30' } });
    await fireEvent.click(sw('연속 순매수 사용'));
    await fireEvent.click(radio('연속 순매수 주체', '개인'));
    await fireEvent.input(field('최소 연속 일수'), { target: { value: '8' } });
    await vi.advanceTimersByTimeAsync(500);
    const f = app.criteria[0].conditions.flow;
    expect(f.amount).toEqual({ on: true, who: 'both', days: 10, minPct: -2.5, maxPct: 30 });
    expect(f.streak).toEqual({ on: true, who: 'indiv', minDays: 8 });
    expect(section('조건').textContent).toContain('4개 켬'); // 거래대금·반등 + 2
  });

  it('an out-of-range number blocks the run even after the section is folded, then opens it and focuses the field', async () => {
    const { onRun } = setup();
    await fireEvent.input(field('순매수 기간'), { target: { value: '200' } });
    expect(screen.getByRole('alert').textContent).toBe('5~120 사이로 적어 주세요');
    await fireEvent.click(section('조건')); // 접힘
    expect(screen.queryByRole('textbox', { name: '순매수 기간' })).toBeNull();
    await fireEvent.click(runBtn());
    expect(onRun).not.toHaveBeenCalled();
    expect(section('조건').getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(field('순매수 기간'));
    await fireEvent.input(field('순매수 기간'), { target: { value: '30' } });
    await fireEvent.click(runBtn());
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it('the streak days and the pct range have the spec 3.3 bounds', async () => {
    setup();
    await fireEvent.input(field('최소 연속 일수'), { target: { value: '61' } });
    expect(screen.getByRole('alert').textContent).toBe('1~60 사이로 적어 주세요');
    await fireEvent.input(field('최소 연속 일수'), { target: { value: '60' } });
    await fireEvent.input(field('최대 순매수 비율'), { target: { value: '101' } });
    expect(screen.getByRole('alert').textContent).toBe('-100~100 사이로 적어 주세요');
  });

  it('a reversed pct range is a blocking warning in the conditions section', async () => {
    const { onRun, preview } = setup();
    await vi.advanceTimersByTimeAsync(300);
    preview.mockClear();
    await fireEvent.click(sw('순매수 규모 사용'));
    await fireEvent.input(field('최소 순매수 비율'), { target: { value: '50' } });
    await fireEvent.input(field('최대 순매수 비율'), { target: { value: '10' } });
    await vi.advanceTimersByTimeAsync(1000);
    const msg = screen.getByText('순매수 비율의 최소가 최대보다 커요');
    expect(section('조건').closest('section')!.contains(msg)).toBe(true);
    expect(preview).not.toHaveBeenCalled();
    await fireEvent.click(runBtn());
    expect(onRun).not.toHaveBeenCalled();
  });
});

describe('수급 없는 데이터(v2)', () => {
  it('the toggles are aria-disabled and described by the re-collect hint; turning one on is refused', async () => {
    const { app } = setup({ info: V2 });
    for (const name of ['순매수 규모 사용', '연속 순매수 사용']) {
      const t = sw(name);
      expect(t.getAttribute('aria-disabled')).toBe('true');
      const id = t.getAttribute('aria-describedby')!;
      expect(id).toMatch(/^flow-off-/);
      expect(document.getElementById(id)!.textContent).toBe('다시 수집하면 쓸 수 있어요');
      await fireEvent.click(t);
      expect(t.getAttribute('aria-checked')).toBe('false');
    }
    expect(field('순매수 기간').matches(':disabled')).toBe(true);
    expect(radio('순매수 규모 주체', '기관').matches(':disabled')).toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    expect(app.criteria[0].conditions.flow.amount.on).toBe(false);
  });

  it('an already-on condition blocks the run, can be turned off with focus kept on its toggle, and then the run goes', async () => {
    const { onRun } = setup({ info: V2, crit: (c) => (c.conditions.flow.streak.on = true) });
    expect(screen.getAllByText(NO_FLOW)).toHaveLength(1);
    await fireEvent.click(runBtn());
    expect(onRun).not.toHaveBeenCalled();
    const t = sw('연속 순매수 사용');
    expect(t.disabled).toBe(false);
    t.focus();
    await fireEvent.click(t);
    expect(document.activeElement).toBe(t);
    expect(t.getAttribute('aria-checked')).toBe('false');
    expect(t.getAttribute('aria-disabled')).toBe('true');
    expect(screen.queryByText(NO_FLOW)).toBeNull();
    await fireEvent.click(t); // 다시 켜려 해도 막힌다
    expect(t.getAttribute('aria-checked')).toBe('false');
    await fireEvent.click(runBtn());
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it('each editor gets its own hint id', () => {
    setup({ info: V2 });
    setup({ info: V2 });
    const ids = screen.getAllByRole('switch', { name: '순매수 규모 사용' }).map((t) => t.getAttribute('aria-describedby'));
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });
});

describe('수급 순 정렬', () => {
  it('shows the subject and days only when chosen and saves them', async () => {
    const { app } = setup();
    await open('고를 개수·정렬');
    expect(screen.queryByRole('radiogroup', { name: '수급 주체' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: '수급 기간' })).toBeNull();
    await fireEvent.click(screen.getByRole('radio', { name: '수급 순' }));
    expect(radio('수급 주체', '외국인').getAttribute('aria-checked')).toBe('true');
    expect(field('수급 기간').value).toBe('20');
    await fireEvent.click(radio('수급 주체', '기관'));
    await fireEvent.input(field('수급 기간'), { target: { value: '60' } });
    await vi.advanceTimersByTimeAsync(500);
    expect(app.criteria[0].rank).toMatchObject({ by: 'flow', flow: { who: 'inst', days: 60 } });
    expect(section('고를 개수·정렬').textContent).toContain('수급 큰 순');
  });

  it('an out-of-range 수급 기간 blocks the run until the sort moves away from 수급 순', async () => {
    const { onRun } = setup({ crit: (c) => (c.rank.by = 'flow') });
    await open('고를 개수·정렬');
    await fireEvent.input(field('수급 기간'), { target: { value: '4' } });
    await fireEvent.click(section('고를 개수·정렬')); // 접힘
    await fireEvent.click(runBtn());
    expect(onRun).not.toHaveBeenCalled();
    expect(section('고를 개수·정렬').getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(field('수급 기간'));
    await fireEvent.click(screen.getByRole('radio', { name: '시가총액 큰 순' }));
    await fireEvent.click(runBtn());
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it('on data without flow the sort section shows the blocking warning once and the run stops there', async () => {
    const { onRun } = setup({ info: V2, crit: (c) => (c.rank.by = 'flow') });
    await open('고를 개수·정렬');
    const msg = within(document.querySelector('.editor')!).getAllByText(NO_FLOW);
    expect(msg).toHaveLength(1);
    expect(section('고를 개수·정렬').closest('section')!.contains(msg[0])).toBe(true);
    await fireEvent.click(runBtn());
    expect(onRun).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(msg[0].closest('[id]'));
  });
});
