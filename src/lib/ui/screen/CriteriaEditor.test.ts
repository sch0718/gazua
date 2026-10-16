// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTestApp } from '../../../sheets/testApp';
import type { UniverseItem } from '../../data/universe';
import { newCriteria } from '../../screen/defaults';
import { PreviewError } from '../../screen/validationController.svelte';
import type { Selection } from '../../screen/select';
import { NOW } from '../../screen/testData';
import type { SelectionCriteria } from '../../screen/types';
import { newStrategy } from '../../sim/defaults';
import type { App } from '../../state/app.svelte';
import { currentSnackbar, dismissSnackbar } from '../components/snackbarStore.svelte';
import CriteriaEditor from './CriteriaEditor.svelte';
import { CONDITION_HELP } from './screenText';

const RANGE = { from: '2024-10-16', to: '2026-10-15' };
const INFO = { collectedAt: '2026-10-16T09:00:00+09:00', stocks: 30, range: RANGE };
const SECTORS = [
  { code: '00013', name: '전기·전자', level: 1 as const },
  { code: '00016', name: '금융', level: 1 as const },
];
const ITEMS = [
  { s: '100000', n: '가온전자' },
  { s: '101111', n: '나라반도체' },
] as unknown as UniverseItem[];
const selection = (n: number): Selection => ({
  date: '2026-10-16',
  passed: 25,
  picked: Array.from({ length: n }, (_, i) => ({ symbol: i === 0 ? '100000' : `20000${i}`, values: {} })),
});

let apps: App[] = [];
type Setup = { crit?: (c: SelectionCriteria) => void; strategies?: string[]; info?: typeof INFO | null; preview?: ReturnType<typeof vi.fn> };
function setup(o: Setup = {}) {
  const app = makeTestApp({ groups: [{ id: 'g1', name: '반도체', items: [] }], now: NOW });
  apps.push(app);
  app.setStrategies((o.strategies ?? []).map((n, i) => ({ ...newStrategy(NOW - i, 'g1', n), id: `s${i}` })));
  const c = { ...newCriteria(NOW, RANGE, '내 기준'), id: 'c1' };
  o.crit?.(c);
  app.setCriteria([c]);
  const preview = o.preview ?? vi.fn(async () => selection(10));
  const onRun = vi.fn();
  const view = render(CriteriaEditor, {
    app,
    criteria: c,
    info: o.info === undefined ? INFO : o.info,
    sectors: SECTORS,
    preview,
    onRun,
    loadItems: async () => ITEMS,
  });
  return { app, preview, onRun, view };
}
const section = (title: string) => screen.getByRole('button', { name: new RegExp(`^${title}`) });
const open = async (title: string) => {
  const b = section(title);
  if (b.getAttribute('aria-expanded') !== 'true') await fireEvent.click(b);
};
const runBtn = () => screen.getByRole('button', { name: '검증 실행' });

// 시계는 전부 가짜다(실제 시간에 기대지 않는다). 비동기 결과는 advanceTimersByTimeAsync로 흘려보낸 뒤 동기로 확인한다
beforeEach(() => vi.useFakeTimers());
const settle = () => vi.advanceTimersByTimeAsync(0);
afterEach(() => {
  vi.useRealTimers();
  for (const a of apps) a.destroy();
  apps = [];
  dismissSnackbar();
});

describe('CriteriaEditor sections', () => {
  it('six sections in spec order', () => {
    setup();
    const heads = screen.getAllByRole('button', { name: /^(후보 범위|조건|고를 개수·정렬|재선정·기간|비교 대상|② 매매 규칙)/ });
    expect(heads.map((h) => h.querySelector('b')?.textContent)).toEqual(['후보 범위', '조건', '고를 개수·정렬', '재선정·기간', '비교 대상', '② 매매 규칙']);
  });
});

describe('conditions', () => {
  it('each condition has an on switch and the spec 7.3 one-line help', () => {
    setup();
    for (const text of Object.values(CONDITION_HELP)) expect(screen.getByText(text)).toBeTruthy();
    for (const label of ['시가총액', '거래대금', '대장주', '수익률', '이동평균', '52주 고점 대비', '변동성', '반등 신호']) {
      expect(screen.getByRole('switch', { name: `${label} 사용` })).toBeTruthy();
    }
    expect(screen.getByRole('switch', { name: '시가총액 사용' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('switch', { name: '거래대금 사용' }).getAttribute('aria-checked')).toBe('true');
  });

  it('flipping a condition and a number reaches the saved criteria after 500ms', async () => {
    const { app } = setup();
    await fireEvent.click(screen.getByRole('switch', { name: '시가총액 사용' }));
    await fireEvent.input(screen.getByRole('textbox', { name: '최소 시가총액' }), { target: { value: '3000' } });
    expect(app.criteria[0].conditions.marketCap.on).toBe(false); // 아직 저장 전
    await vi.advanceTimersByTimeAsync(500);
    expect(app.criteria[0].conditions.marketCap).toEqual({ on: true, minEok: 3000 });
  });

  it('no on conditions shows the warning but does not block the run', async () => {
    const { onRun } = setup();
    await fireEvent.click(screen.getByRole('switch', { name: '거래대금 사용' }));
    await fireEvent.click(screen.getByRole('switch', { name: '반등 신호 사용' }));
    expect(screen.getByText('조건이 없으면 후보 범위의 모든 종목에서 정렬 순으로 골라요')).toBeTruthy();
    await fireEvent.click(runBtn());
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it('an out-of-range number shows an error under the field and blocks the run, focusing the field', async () => {
    const { onRun, app } = setup();
    await open('고를 개수·정렬');
    const take = screen.getByRole('textbox', { name: '고를 개수' });
    await fireEvent.input(take, { target: { value: '31' } });
    expect(screen.getByRole('alert').textContent).toBe('1~30 사이로 적어 주세요');
    await fireEvent.click(runBtn());
    expect(onRun).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(take);
    expect(app.criteria[0].rank.take).toBe(10); // 저장값은 그대로
    // 고치면 다시 실행된다
    await fireEvent.input(take, { target: { value: '12' } });
    await fireEvent.click(runBtn());
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onRun.mock.calls[0][0].rank.take).toBe(12);
  });

  it('the invalid text stays visible after leaving the field (the run stays blocked)', async () => {
    const { onRun } = setup();
    await open('고를 개수·정렬');
    const take = screen.getByRole('textbox', { name: '고를 개수' });
    await fireEvent.input(take, { target: { value: '0' } });
    await fireEvent.blur(take);
    expect(screen.getByRole('alert')).toBeTruthy();
    await fireEvent.click(runBtn());
    expect(onRun).not.toHaveBeenCalled();
  });
});

describe('후보 범위', () => {
  it('picking a sector puts its code in the pool', async () => {
    const { onRun } = setup();
    await open('후보 범위');
    await fireEvent.click(screen.getByRole('checkbox', { name: '전기·전자' }));
    await fireEvent.click(runBtn());
    expect(onRun.mock.calls[0][0].pool.sectors).toEqual(['00013']);
  });

  it('the last market cannot be switched off', async () => {
    const { onRun } = setup();
    await open('후보 범위');
    await fireEvent.click(screen.getByRole('switch', { name: 'KOSDAQ' }));
    await fireEvent.click(screen.getByRole('switch', { name: 'KOSPI' })); // 마지막 하나
    expect(screen.getByRole('switch', { name: 'KOSPI' }).getAttribute('aria-checked')).toBe('true');
    await fireEvent.click(runBtn());
    expect(onRun.mock.calls[0][0].pool.markets).toEqual(['KOSPI']);
  });
});

describe('반등 신호 패턴', () => {
  it('직접 정하기 (default) shows the same buy section as the strategy editor', () => {
    setup({ strategies: ['눌림목'] });
    expect(screen.getByRole('radio', { name: '직접 정하기' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('① 먼저 이만큼 떨어져야 해요')).toBeTruthy();
  });

  it('editing the custom pattern changes its entry', async () => {
    const { onRun } = setup();
    await fireEvent.input(screen.getByRole('textbox', { name: '고점 대비 하락폭' }), { target: { value: '25' } });
    await fireEvent.click(runBtn());
    const p = onRun.mock.calls[0][0].conditions.rebound.pattern;
    expect(p.from).toBe('custom');
    expect(p.entry.decline.dropPct.value).toBe(25);
  });

  it('전략에서 불러오기 lists the saved strategies and keeps the chosen id', async () => {
    const { onRun } = setup({ strategies: ['눌림목', '반등'] });
    await fireEvent.click(screen.getByRole('radio', { name: '전략에서 불러오기' }));
    expect(screen.queryByText('① 먼저 이만큼 떨어져야 해요')).toBeNull();
    const pick = screen.getByRole('combobox', { name: '반등 패턴 전략' }) as HTMLSelectElement;
    await fireEvent.change(pick, { target: { value: 's1' } });
    await fireEvent.click(runBtn());
    expect(onRun.mock.calls[0][0].conditions.rebound.pattern).toEqual({ from: 'strategy', strategyId: 's1' });
  });

  it('without saved strategies 전략에서 불러오기 is not offered', () => {
    setup();
    expect(screen.getByRole('radio', { name: '전략에서 불러오기' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('a deleted strategy asks to pick again, with a blocking banner, and the run is blocked', async () => {
    const { onRun } = setup({
      strategies: ['눌림목'],
      crit: (c) => (c.conditions.rebound.pattern = { from: 'strategy', strategyId: 'gone' }),
    });
    expect(screen.getByText('반등 신호에 쓰던 전략이 없어요. 다시 골라 주세요')).toBeTruthy();
    const pick = screen.getByRole('combobox', { name: '반등 패턴 전략' }) as HTMLSelectElement;
    expect(pick.selectedOptions[0].textContent).toContain('다시 골라 주세요');
    await fireEvent.click(runBtn());
    expect(onRun).not.toHaveBeenCalled();
    expect(document.activeElement?.textContent).toContain('반등 신호에 쓰던 전략이 없어요');
    await fireEvent.change(pick, { target: { value: 's0' } });
    await fireEvent.click(runBtn());
    expect(onRun).toHaveBeenCalledTimes(1);
  });
});

describe('② 매매 규칙', () => {
  it('a deleted trading strategy blocks the run and asks to pick again', async () => {
    const { onRun } = setup({ strategies: ['눌림목'], crit: (c) => (c.trading.strategyId = 'gone') });
    await open('② 매매 규칙');
    expect(screen.getAllByText('매매 규칙 전략이 없어요. 다시 골라 주세요').length).toBeGreaterThan(0);
    await fireEvent.click(runBtn());
    expect(onRun).not.toHaveBeenCalled();
  });

  it('a trading strategy the strategy editor would block (all buy signals off) blocks the run with its reason', async () => {
    const { app, onRun } = setup({ strategies: ['눌림목'], crit: (c) => (c.trading.strategyId = 's0') });
    const s = structuredClone(app.strategies[0]);
    Object.values(s.entry.triggers).forEach((t) => (t.on = false));
    app.setStrategies([s]);
    await settle();
    await fireEvent.click(runBtn());
    expect(onRun).not.toHaveBeenCalled();
    expect(document.activeElement?.textContent).toContain('매매 규칙 전략에 고칠 곳이 있어요: 사는 신호가 하나도 켜져 있지 않아요');
  });

  it('picking a strategy sets trading.strategyId; 쓰지 않음 sets null', async () => {
    const { onRun } = setup({ strategies: ['눌림목'] });
    await open('② 매매 규칙');
    const pick = screen.getByRole('combobox', { name: '매매 규칙 전략' });
    await fireEvent.change(pick, { target: { value: 's0' } });
    await fireEvent.click(runBtn());
    expect(onRun.mock.calls[0][0].trading.strategyId).toBe('s0');
    await fireEvent.change(pick, { target: { value: '' } });
    await fireEvent.click(runBtn());
    expect(onRun.mock.calls[1][0].trading.strategyId).toBeNull();
  });
});

describe('실행 버튼', () => {
  it('without market data it is disabled and the reason is shown with it', () => {
    setup({ info: null });
    expect((runBtn() as HTMLButtonElement).disabled).toBe(true);
    const reason = screen.getByText('시장 데이터를 가져오면 실행할 수 있어요');
    expect(runBtn().getAttribute('aria-describedby')).toBe(reason.id);
  });

  it('a period outside the data is fitted to it, with the 8.1 notice, and then runs', async () => {
    const { onRun } = setup({ crit: (c) => (c.period = { from: '2020-01-02', to: '2030-01-02' }) });
    await fireEvent.click(runBtn());
    expect(onRun.mock.calls[0][0].period).toEqual(RANGE);
    expect(currentSnackbar()?.message).toBe('데이터 범위에 맞췄어요');
  });

  it('a start date after the end date opens 재선정·기간 and focuses its blocking banner', async () => {
    const { onRun } = setup({ crit: (c) => (c.period = { from: '2026-01-02', to: '2025-01-02' }) });
    await fireEvent.click(runBtn());
    expect(onRun).not.toHaveBeenCalled();
    expect(section('재선정·기간').getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement?.textContent).toContain('시작일이 종료일보다 앞이어야 해요');
  });

  it('runs with the latest draft, saved first', async () => {
    const { onRun, app } = setup();
    await fireEvent.click(screen.getByRole('switch', { name: '시가총액 사용' }));
    await fireEvent.click(runBtn());
    expect(app.criteria[0].conditions.marketCap.on).toBe(true);
    expect(onRun.mock.calls[0][0].conditions.marketCap.on).toBe(true);
  });
});

describe('오늘 기준 미리 보기', () => {
  it('shows 통과 n개 · 상위 10개 with names 0.3s after the editor opens', async () => {
    const { preview } = setup();
    expect(screen.getByText('오늘 기준 미리 보기')).toBeTruthy();
    expect(preview).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(preview).toHaveBeenCalledTimes(1);
    await settle();
    expect(screen.getByText('통과 25개 · 상위 10개')).toBeTruthy();
    expect(screen.getByText('가온전자')).toBeTruthy();
    expect(screen.getByText('2026-10-15 기준')).toBeTruthy();
  });

  it('an edit recalculates 0.3s later, and quick edits collapse into one call', async () => {
    const { preview } = setup();
    await vi.advanceTimersByTimeAsync(300);
    preview.mockClear();
    preview.mockResolvedValue({ ...selection(3), passed: 4 });
    await fireEvent.click(screen.getByRole('switch', { name: '시가총액 사용' }));
    await vi.advanceTimersByTimeAsync(200);
    await fireEvent.click(screen.getByRole('switch', { name: '변동성 사용' }));
    await vi.advanceTimersByTimeAsync(299);
    expect(preview).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(preview).toHaveBeenCalledTimes(1);
    await settle();
    expect(screen.getByText('통과 4개 · 상위 3개')).toBeTruthy();
    const sent = preview.mock.calls[0][0];
    expect(sent.criteria.conditions.marketCap.on).toBe(true);
    expect(sent.criteria.conditions.volatility.on).toBe(true);
  });

  it('renaming does not recalculate', async () => {
    const { preview } = setup();
    await vi.advanceTimersByTimeAsync(300);
    preview.mockClear();
    await fireEvent.input(screen.getByRole('textbox', { name: '기준 이름' }), { target: { value: '새 이름' } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(preview).not.toHaveBeenCalled();
  });

  it('a late answer for an older edit is ignored', async () => {
    let first!: (s: Selection) => void;
    const preview = vi
      .fn()
      .mockImplementationOnce(() => new Promise<Selection>((r) => (first = r)))
      .mockResolvedValue({ ...selection(2), passed: 7 });
    setup({ preview });
    await vi.advanceTimersByTimeAsync(300);
    await fireEvent.click(screen.getByRole('switch', { name: '시가총액 사용' }));
    await vi.advanceTimersByTimeAsync(300);
    await settle();
    expect(screen.getByText('통과 7개 · 상위 2개')).toBeTruthy();
    first({ ...selection(1), passed: 99 });
    await vi.advanceTimersByTimeAsync(10);
    expect(screen.queryByText('통과 99개 · 상위 1개')).toBeNull();
    expect(screen.getByText('통과 7개 · 상위 2개')).toBeTruthy();
  });

  it('a failed preview says so; a cancelled one stays quiet', async () => {
    const preview = vi.fn().mockRejectedValueOnce(new PreviewError('crash')).mockRejectedValue(new PreviewError('cancelled'));
    setup({ preview });
    await vi.advanceTimersByTimeAsync(300);
    await settle();
    expect(screen.getByText('미리 보기를 계산하지 못했어요')).toBeTruthy();
    await fireEvent.click(screen.getByRole('switch', { name: '시가총액 사용' }));
    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(10);
    expect(screen.queryByText('미리 보기를 계산하지 못했어요')).toBeNull();
  });

  it('without data it does not call the worker and explains', async () => {
    const { preview } = setup({ info: null });
    await vi.advanceTimersByTimeAsync(1000);
    expect(preview).not.toHaveBeenCalled();
    expect(within(screen.getByRole('region', { name: '오늘 기준 미리 보기' })).getByText('시장 데이터를 가져오면 미리 볼 수 있어요')).toBeTruthy();
  });
});

describe('저장', () => {
  it('a pending edit is saved when the editor goes away', async () => {
    const { app, view } = setup();
    await fireEvent.click(screen.getByRole('switch', { name: '시가총액 사용' }));
    view.unmount();
    expect(app.criteria[0].conditions.marketCap.on).toBe(true);
  });

  it('rename needs a name; the saved one is kept meanwhile', async () => {
    const { app } = setup();
    const name = screen.getByRole('textbox', { name: '기준 이름' });
    await fireEvent.input(name, { target: { value: '  ' } });
    expect(screen.getByText('이름을 적어 주세요')).toBeTruthy();
    await vi.advanceTimersByTimeAsync(600);
    expect(app.criteria[0].name).toBe('내 기준');
    await fireEvent.input(name, { target: { value: '새 이름' } });
    await vi.advanceTimersByTimeAsync(500);
    expect(app.criteria[0].name).toBe('새 이름');
  });
});

describe('접어도 틀린 값은 실행을 막는다', () => {
  it('고를 개수에 31을 적고 구역을 접어도 실행은 막히고, 실행하면 구역을 열어 그 칸으로 간다', async () => {
    const { onRun } = setup();
    await open('고를 개수·정렬');
    await fireEvent.input(screen.getByRole('textbox', { name: '고를 개수' }), { target: { value: '31' } });
    await fireEvent.click(section('고를 개수·정렬')); // 접힘: 칸이 사라진다
    expect(screen.queryByRole('textbox', { name: '고를 개수' })).toBeNull();
    await fireEvent.click(runBtn());
    expect(onRun).not.toHaveBeenCalled();
    expect(section('고를 개수·정렬').getAttribute('aria-expanded')).toBe('true');
    const take = screen.getByRole('textbox', { name: '고를 개수' }) as HTMLInputElement;
    expect(take.value).toBe('31');
    expect(take.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toBe('1~30 사이로 적어 주세요');
    expect(document.activeElement).toBe(take);
  });

  it('고치면 다시 실행된다(다시 펼친 칸에도 틀린 글이 남아 있다가 고치면 풀린다)', async () => {
    const { onRun } = setup();
    await open('고를 개수·정렬');
    await fireEvent.input(screen.getByRole('textbox', { name: '고를 개수' }), { target: { value: '31' } });
    await fireEvent.click(section('고를 개수·정렬'));
    await fireEvent.click(section('고를 개수·정렬'));
    const take = screen.getByRole('textbox', { name: '고를 개수' }) as HTMLInputElement;
    expect(take.value).toBe('31');
    await fireEvent.input(take, { target: { value: '9' } });
    await fireEvent.click(section('고를 개수·정렬'));
    await fireEvent.click(runBtn());
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onRun.mock.calls[0][0].rank.take).toBe(9);
  });

  it('직접 정하기 매수 칸의 틀린 값도 같은 방식으로 막는다', async () => {
    const { onRun } = setup();
    const drop = screen.getByRole('textbox', { name: '고점 대비 하락폭' });
    await fireEvent.input(drop, { target: { value: '95' } });
    await fireEvent.click(section('조건')); // 조건 구역 전체가 접힌다
    await fireEvent.click(runBtn());
    expect(onRun).not.toHaveBeenCalled();
    const back = screen.getByRole('textbox', { name: '고점 대비 하락폭' }) as HTMLInputElement;
    expect(back.value).toBe('95');
    expect(document.activeElement).toBe(back);
  });

  it('전략에서 불러오기로 바꾸면 숨은 매수 칸의 틀린 값은 더 막지 않는다', async () => {
    const { onRun } = setup({ strategies: ['눌림목'] });
    await fireEvent.input(screen.getByRole('textbox', { name: '고점 대비 하락폭' }), { target: { value: '95' } });
    await fireEvent.click(screen.getByRole('radio', { name: '전략에서 불러오기' }));
    await fireEvent.click(runBtn());
    expect(onRun).toHaveBeenCalledTimes(1);
  });
});

describe('미리 보기 옛 답', () => {
  it('편집한 직후(0.3초 전)에 도착한 옛 답도 버린다', async () => {
    let first!: (s: Selection) => void;
    const preview = vi
      .fn()
      .mockImplementationOnce(() => new Promise<Selection>((r) => (first = r)))
      .mockResolvedValue(selection(2));
    setup({ preview });
    await vi.advanceTimersByTimeAsync(300);
    await fireEvent.click(screen.getByRole('switch', { name: '시가총액 사용' })); // 타이머가 돌기 전
    first({ ...selection(1), passed: 99 });
    await vi.advanceTimersByTimeAsync(10);
    expect(screen.queryByText('통과 99개 · 상위 1개')).toBeNull();
  });

  it('끝난 결과 문구는 role=status 안에 있다', async () => {
    setup();
    await vi.advanceTimersByTimeAsync(300);
    expect(screen.getByRole('status').textContent).toBe('통과 25개 · 상위 10개');
  });
});

describe('프로필 전환', () => {
  it('저장 대기분은 다른 프로필에 쓰이지 않는다', async () => {
    const { app } = setup();
    await fireEvent.click(screen.getByRole('switch', { name: '시가총액 사용' }));
    const other = app.addProfile('다른');
    app.switchProfile(other.id);
    await vi.advanceTimersByTimeAsync(600);
    expect(app.criteria).toEqual([]);
    app.switchProfile('p1');
    expect(app.criteria[0].conditions.marketCap.on).toBe(false);
  });
});

