// @vitest-environment jsdom
// 재무 기준 편집 화면: 재무·가치 소구역(네 묶음)과 `재무 순` 정렬, 재무 없는 데이터(v3)에서의 막기.
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
const V4: MarketDataInfo = { collectedAt: '2026-10-16T09:00:00+09:00', stocks: 30, range: RANGE, version: 4, hasMacro: true, themeCount: 0, hasFlow: true, flowStocks: 7, hasFin: true, finStocks: 20 };
const V3: MarketDataInfo = { ...V4, version: 3, hasFin: false, finStocks: 0 };
const ITEMS = [{ s: '100000', n: '가온전자' }] as unknown as UniverseItem[];
const selection: Selection = { date: '2026-10-16', passed: 25, picked: [{ symbol: '100000', values: {} }] };
const NO_FIN = '이 데이터에는 재무 정보가 없어요';
const TOGGLES = ['PER 사용', 'PBR 사용', 'ROE 사용', '영업이익률 사용', '매출 증가율 사용', '영업이익 증가율 사용', '부채비율 사용', '흑자 사용'];

let apps: App[] = [];
function setup(o: { info?: MarketDataInfo; crit?: (c: SelectionCriteria) => void } = {}) {
  const app = makeTestApp({ groups: [{ id: 'g1', name: '반도체주', items: [] }], now: NOW });
  apps.push(app);
  const c = { ...newCriteria(NOW, RANGE, '내 기준'), id: 'c1' };
  o.crit?.(c);
  app.setCriteria([c]);
  const preview = vi.fn(async (_input: WorkerInput) => selection);
  const onRun = vi.fn();
  render(CriteriaEditor, { app, criteria: c, info: o.info ?? V4, sectors: [], themes: [], preview, onRun, loadItems: async () => ITEMS });
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

describe('재무·가치 소구역', () => {
  it('has the four groups in order, the spec 4.1 copy, eight switches off and the spec 3.2 defaults', () => {
    setup();
    const box = screen.getByText('재무·가치').parentElement!;
    const titles = [...box.querySelectorAll('.sub-title')].map((e) => e.textContent);
    expect(titles).toEqual(['가치', '수익성', '성장', '안정성']);
    expect(within(box).getByText('재무는 공시가 늦을 수 있어 분기 결산 60일, 연간 결산 100일 뒤부터 써요')).toBeTruthy();
    expect(within(box).getByText('주가가 1년 순이익의 몇 배인지예요. 적자 기업은 빠져요')).toBeTruthy();
    expect(within(box).getAllByText('최근 4분기 합을 1년 전 4분기 합과 비교해요')).toHaveLength(2);
    // 스위치 순서: 가치(PER·PBR) · 수익성(ROE·영업이익률) · 성장(매출·영업이익 증가율) · 안정성(부채비율·흑자)
    expect(within(box).getAllByRole('switch').map((t) => t.getAttribute('aria-label'))).toEqual(TOGGLES);
    for (const t of TOGGLES) expect(sw(t).getAttribute('aria-checked')).toBe('false');
    expect(field('최소 PER').value).toBe('0');
    expect(field('최대 PER').value).toBe('15');
    expect(field('최소 PBR').value).toBe('0');
    expect(field('최대 PBR').value).toBe('1.5');
    expect(field('최소 ROE').value).toBe('10');
    expect(field('최소 영업이익률').value).toBe('5');
    expect(field('최소 매출 증가율').value).toBe('10');
    expect(field('최소 영업이익 증가율').value).toBe('20');
    expect(field('최대 부채비율').value).toBe('100');
    expect(within(box).queryByText('다시 수집하면 쓸 수 있어요')).toBeNull();
  });

  it('sits below the investor-flow subsection inside the conditions section', () => {
    setup();
    const flow = screen.getByText('투자자 매매동향');
    const fin = screen.getByText('재무·가치');
    expect(flow.compareDocumentPosition(fin) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(section('조건').closest('section')!.contains(fin)).toBe(true);
  });

  it('switches and numbers reach the saved criteria, and the summary counts them', async () => {
    const { app } = setup();
    for (const t of TOGGLES) await fireEvent.click(sw(t));
    await fireEvent.input(field('최소 PER'), { target: { value: '2' } });
    await fireEvent.input(field('최대 PER'), { target: { value: '12.5' } });
    await fireEvent.input(field('최소 PBR'), { target: { value: '0.2' } });
    await fireEvent.input(field('최대 PBR'), { target: { value: '1' } });
    await fireEvent.input(field('최소 ROE'), { target: { value: '-5' } });
    await fireEvent.input(field('최소 영업이익률'), { target: { value: '8' } });
    await fireEvent.input(field('최소 매출 증가율'), { target: { value: '30' } });
    await fireEvent.input(field('최소 영업이익 증가율'), { target: { value: '500' } });
    await fireEvent.input(field('최대 부채비율'), { target: { value: '250' } });
    await vi.advanceTimersByTimeAsync(500);
    expect(app.criteria[0].conditions.fin).toEqual({
      per: { on: true, min: 2, max: 12.5 },
      pbr: { on: true, min: 0.2, max: 1 },
      roe: { on: true, min: -5 },
      opMargin: { on: true, min: 8 },
      revGrowth: { on: true, min: 30 },
      opGrowth: { on: true, min: 500 },
      debtRatio: { on: true, max: 250 },
      profitable: { on: true },
    });
    expect(section('조건').textContent).toContain('10개 켬'); // 거래대금·반등 + 8
  });

  it('the fields have the spec 3.2 bounds', async () => {
    setup();
    const cases: [string, string, string][] = [
      ['최대 PER', '1001', '0~1000 사이로 적어 주세요'],
      ['최대 PBR', '101', '0~100 사이로 적어 주세요'],
      ['최소 ROE', '-101', '-100~100 사이로 적어 주세요'],
      ['최소 영업이익률', '101', '-100~100 사이로 적어 주세요'],
      ['최소 매출 증가율', '1001', '-100~1000 사이로 적어 주세요'],
      ['최소 영업이익 증가율', '-101', '-100~1000 사이로 적어 주세요'],
      ['최대 부채비율', '10001', '0~10000 사이로 적어 주세요'],
    ];
    for (const [name, bad, msg] of cases) {
      await fireEvent.input(field(name), { target: { value: bad } });
      expect(screen.getByRole('alert').textContent).toBe(msg);
      await fireEvent.input(field(name), { target: { value: '1' } });
      expect(screen.queryByRole('alert')).toBeNull();
    }
  });

  it('an out-of-range number blocks the run even after the section is folded, then opens it and focuses the field', async () => {
    const { onRun } = setup();
    await fireEvent.input(field('최대 부채비율'), { target: { value: '20000' } });
    await fireEvent.click(section('조건')); // 접힘
    expect(screen.queryByRole('textbox', { name: '최대 부채비율' })).toBeNull();
    await fireEvent.click(runBtn());
    expect(onRun).not.toHaveBeenCalled();
    expect(section('조건').getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(field('최대 부채비율'));
    await fireEvent.input(field('최대 부채비율'), { target: { value: '200' } });
    await fireEvent.click(runBtn());
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it('a reversed PER range is a blocking warning in the conditions section', async () => {
    const { onRun } = setup();
    await fireEvent.click(sw('PER 사용'));
    await fireEvent.input(field('최소 PER'), { target: { value: '20' } });
    await vi.advanceTimersByTimeAsync(500);
    const msg = screen.getByText('PER 범위의 최소가 최대보다 커요');
    expect(section('조건').closest('section')!.contains(msg)).toBe(true);
    await fireEvent.click(runBtn());
    expect(onRun).not.toHaveBeenCalled();
  });
});

describe('재무 없는 데이터(v3)', () => {
  it('the toggles are aria-disabled and described by the re-collect hint; turning one on is refused', async () => {
    const { app } = setup({ info: V3 });
    for (const name of TOGGLES) {
      const t = sw(name);
      expect(t.getAttribute('aria-disabled')).toBe('true');
      const id = t.getAttribute('aria-describedby')!;
      expect(id).toMatch(/^fin-off-/);
      expect(document.getElementById(id)!.textContent).toBe('다시 수집하면 쓸 수 있어요');
      await fireEvent.click(t);
      expect(t.getAttribute('aria-checked')).toBe('false');
    }
    expect(field('최소 PER').matches(':disabled')).toBe(true);
    expect(field('최대 부채비율').matches(':disabled')).toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    expect(Object.values(app.criteria[0].conditions.fin).some((x) => x.on)).toBe(false);
  });

  it('an already-on condition blocks the run, can be turned off with focus kept on its toggle, and then the run goes', async () => {
    const { onRun } = setup({ info: V3, crit: (c) => (c.conditions.fin.profitable.on = true) });
    const msg = screen.getAllByText(NO_FIN);
    expect(msg).toHaveLength(1);
    expect(section('조건').closest('section')!.contains(msg[0])).toBe(true);
    await fireEvent.click(runBtn());
    expect(onRun).not.toHaveBeenCalled();
    const t = sw('흑자 사용');
    expect(t.disabled).toBe(false);
    t.focus();
    await fireEvent.click(t);
    expect(t.disabled).toBe(false);
    expect(document.activeElement).toBe(t);
    expect(t.getAttribute('aria-checked')).toBe('false');
    expect(t.getAttribute('aria-disabled')).toBe('true');
    expect(screen.queryByText(NO_FIN)).toBeNull();
    await fireEvent.click(t); // 다시 켜려 해도 막힌다
    expect(t.getAttribute('aria-checked')).toBe('false');
    await fireEvent.click(runBtn());
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it('each editor gets its own hint id', () => {
    setup({ info: V3 });
    setup({ info: V3 });
    const ids = screen.getAllByRole('switch', { name: 'PER 사용' }).map((t) => t.getAttribute('aria-describedby'));
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });
});

describe('재무 순 정렬', () => {
  it('shows the metric chooser with the spec 4.2 names only when chosen, saves it and names it in the summary', async () => {
    const { app } = setup();
    await open('고를 개수·정렬');
    expect(screen.queryByRole('combobox', { name: '재무 지표' })).toBeNull();
    await fireEvent.click(screen.getByRole('radio', { name: '재무 순' }));
    const pick = screen.getByRole('combobox', { name: '재무 지표' }) as HTMLSelectElement;
    expect([...pick.options].map((o) => o.textContent)).toEqual(['PER 낮은 순', 'PBR 낮은 순', 'ROE 높은 순', '영업이익률 높은 순', '매출 증가율 높은 순', '영업이익 증가율 높은 순']);
    expect(pick.selectedOptions[0].textContent).toBe('PER 낮은 순');
    expect(section('고를 개수·정렬').textContent).toContain('상위 10 · PER 낮은 순');
    await fireEvent.change(pick, { target: { value: 'opGrowth' } });
    await vi.advanceTimersByTimeAsync(500);
    expect(app.criteria[0].rank).toMatchObject({ by: 'fin', fin: { metric: 'opGrowth' } });
    expect(section('고를 개수·정렬').textContent).toContain('상위 10 · 영업이익 증가율 높은 순');
    expect(section('고를 개수·정렬').textContent).not.toContain('재무 순');
  });

  it('a criteria without rank.fin shows PER 낮은 순', async () => {
    setup({
      crit: (c) => {
        c.rank.by = 'fin';
        delete c.rank.fin;
      },
    });
    expect(section('고를 개수·정렬').textContent).toContain('PER 낮은 순');
  });

  it('on data without fin the sort section shows the blocking warning once and the run stops there', async () => {
    const { onRun } = setup({ info: V3, crit: (c) => (c.rank.by = 'fin') });
    await open('고를 개수·정렬');
    const msg = within(document.querySelector('.editor')!).getAllByText(NO_FIN);
    expect(msg).toHaveLength(1);
    expect(section('고를 개수·정렬').closest('section')!.contains(msg[0])).toBe(true);
    await fireEvent.click(runBtn());
    expect(onRun).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(msg[0].closest('[id]'));
  });
});
