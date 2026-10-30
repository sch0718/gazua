// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toChartTime } from '../lib/chart/lineData';
import { lwcCharts, lwcStubHooks, resetLwcStub, ResizeObserverStub } from '../lib/chart/lwcStub';
import { loadIndexSeries, type LoadedSeries } from '../lib/data/candleService';
import { memoryCache } from '../lib/data/testCache';
import { sessionsForDay } from '../lib/market/sessions';
import { createApp, type App } from '../lib/state/app.svelte';
import { formatMetricValue } from '../lib/ui/compare/compareText';
import { fmtWon } from '../lib/ui/format';
import { SnackbarHost } from '@sch0718/ui-svelte';
import { currentSnackbar, dismissSnackbar } from '@sch0718/ui-svelte';
import { addItem, removeItem } from '../lib/state/watchlist';
import { ApiError } from '../lib/providers/errors';
import { DEFAULT_SETTINGS, type Meta, type Settings, type WatchItem } from '../lib/state/schema';
import { createSafeStorage } from '../lib/state/storage';
import { memoryBacking, seed } from '../lib/state/testStorage';
import { kstDate, kstEpoch } from '../lib/time/kst';
import Compare from './Compare.svelte';
import { closeShare, currentShare, setShareController } from '../lib/share/shareStore.svelte';
import type { SyncController } from '../lib/sync/controller.svelte';

vi.mock('lightweight-charts', async () => (await import('../lib/chart/lwcStub')).lwcModule());
// 지수 로딩만 테스트에서 실패시킬 수 있게 감싼다(기본은 실제 구현).
vi.mock('../lib/data/candleService', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/data/candleService')>();
  return { ...real, loadIndexSeries: vi.fn(real.loadIndexSeries) };
});

const DAY = '2026-10-12';
const NOW = kstEpoch(DAY, '10:00:00');
const sessions = sessionsForDay({ date: DAY, isOpen: true });
const META: Meta = { schemaVersion: 1, activeProfileId: 'p1', profiles: [{ id: 'p1', name: '내 프로필', createdAt: 1 }] };
const EXAMPLE = ['005930', '000660', '042700', '000990'];
const items = (symbols: string[]): WatchItem[] =>
  symbols.map((symbol, i) => ({ symbol, colorSlot: (i + 1) as WatchItem['colorSlot'], hidden: false, addedAt: 1 }));

let apps: App[] = [];
function makeApp(symbols: string[], settings: Partial<Settings> = {}): App {
  const backing = memoryBacking();
  seed(backing, 'meta', META);
  seed(backing, 'p:p1:settings', { ...DEFAULT_SETTINGS, onboarded: true, ...settings });
  seed(backing, 'p:p1:watchlists', { groups: [{ id: 'g1', name: '반도체', items: items(symbols) }] });
  location.hash = '#/compare/g1';
  const app = createApp({ storage: createSafeStorage(backing), now: () => NOW, cache: memoryCache() });
  apps.push(app);
  return app;
}

const barEnd = createRawSnippet(() => ({ render: () => '<span></span>' }));
const board = () => within(screen.getByRole('region', { name: '리더보드' }));
const rowOf = (name: string) => board().getByText(name).closest('li')!;

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  resetLwcStub();
  // 리더보드의 입력 방식(포인터/키보드)은 모듈 상태라, 앞 테스트의 포인터 입력이 남지 않게 키보드로 되돌린다.
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }));
});
afterEach(() => {
  lwcStubHooks.crosshairOnSetData = null;
  for (const a of apps) a.destroy();
  apps = [];
  vi.unstubAllGlobals();
  dismissSnackbar();
});

describe('Compare (demo provider)', () => {
  it('renders the example group rows and the loading progress disappears', async () => {
    const app = makeApp(EXAMPLE);
    render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd });
    expect(screen.getByText(/불러오는 중 \d\/4/)).toBeTruthy();
    await vi.waitFor(() => expect(screen.queryByText(/불러오는 중/)).toBeNull(), { timeout: 3000 });
    for (const name of ['삼성전자', 'SK하이닉스', '한미반도체', 'DB하이텍']) {
      expect(within(rowOf(name)).getByText(/[▲▼]|0\.00%/)).toBeTruthy();
    }
    expect(screen.getByText('등락률 순 · 4/10')).toBeTruthy();
    expect(screen.getByText('오늘 · 등락률 · 기준 전일 종가')).toBeTruthy();
    // 4종목 × (점선 + 실선)
    expect(lwcCharts.at(-1)?.series.length).toBe(8);
  });

  it('one failing stock shows an error on its row only; the others are drawn', async () => {
    const app = makeApp(EXAMPLE);
    const real = app.provider.getCandles.bind(app.provider);
    vi.spyOn(app.provider, 'getCandles').mockImplementation(async (q) => {
      if (q.symbol === '042700') throw new Error('boom');
      return real(q);
    });
    render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd });
    await vi.waitFor(() => expect(screen.queryByText(/불러오는 중/)).toBeNull(), { timeout: 3000 });
    expect(within(rowOf('한미반도체')).getByText('불러오지 못했어요')).toBeTruthy();
    expect(within(rowOf('삼성전자')).getByText(/[▲▼]|0\.00%/)).toBeTruthy();
    expect(lwcCharts.at(-1)?.series.length).toBe(6);
  });

  it('intraday: a stale previous-day snapshot stays off today’s chart; the fresh stock keeps its real values', async () => {
    const app = makeApp(EXAMPLE.slice(0, 2));
    const snaps = app.data.snapshots;
    const real = snaps.load.bind(snaps);
    // 005930: 장 시작 전(07:50)에 받은 전 거래일(10/8) 결과를 갱신 실패로 그대로 쓰는 중. 000660: 오늘(10/12) 결과.
    vi.spyOn(snaps, 'load').mockImplementation(async (args) => {
      if (args.meta.symbol !== '005930') return real(args);
      const prev = await real({ ...args, now: kstEpoch(DAY, '07:50:00') });
      return { ...prev, stale: true };
    });
    render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd });
    await vi.waitFor(() => expect(screen.queryByText(/불러오는 중/)).toBeNull(), { timeout: 3000 });
    const chart = lwcCharts.at(-1)!;
    // 000660만 그린다(점선 + 실선).
    expect(chart.series.length).toBe(2);
    const values = chart.series.flatMap((s) => s.data as { time: number; value?: number }[]).map((d) => d.value);
    expect(values.some((v) => typeof v === 'number' && v !== 0)).toBe(true);
    expect(within(rowOf('삼성전자')).getByText('10/8 거래일 값')).toBeTruthy();
    expect(within(rowOf('SK하이닉스')).queryByText(/거래일 값|기준$/)).toBeNull();
    expect(screen.getByText('오늘 · 등락률 · 기준 전일 종가')).toBeTruthy();
  });

  it('excess with a failed index refresh stays on and says which time the index is from', async () => {
    const app = makeApp(EXAMPLE.slice(0, 1), { metric: 'excess' });
    render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd });
    await vi.waitFor(() => expect(screen.queryByText(/불러오는 중/)).toBeNull(), { timeout: 3000 });
    await vi.waitFor(() => expect(screen.getByText('오늘 · 시장 대비 초과수익 · 기준 전일 종가')).toBeTruthy());
    expect(screen.queryByText(/^지수는 /)).toBeNull();
    vi.mocked(loadIndexSeries).mockRejectedValueOnce(new Error('down'));
    window.dispatchEvent(new Event('online'));
    const note = await screen.findByText('지수는 10:00 기준이에요');
    expect(note.getAttribute('role')).toBe('status');
    expect(screen.getByText('오늘 · 시장 대비 초과수익 · 기준 전일 종가')).toBeTruthy();
  });

  it('excess without an index close on the stock’s base date shows why instead of silently empty values', async () => {
    const mock = vi.mocked(loadIndexSeries);
    const real = mock.getMockImplementation()!;
    // 지수 일봉에서 기준일(직전 거래일) 종가가 빠진 경우
    mock.mockImplementation(async (args) => {
      const r = await real(args);
      return r && { ...r, daily: r.daily.filter((c) => kstDate(c.t) !== r.baseDate) };
    });
    try {
      const app = makeApp(EXAMPLE.slice(0, 1), { metric: 'excess' });
      render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd });
      await vi.waitFor(() => expect(screen.queryByText(/불러오는 중/)).toBeNull(), { timeout: 3000 });
      const note = await screen.findByText('지수 기준일 값이 없어 초과수익을 계산할 수 없어요');
      expect(note.getAttribute('role')).toBe('status');
      expect(within(rowOf('삼성전자')).getByText('데이터 없음')).toBeTruthy();
    } finally {
      mock.mockImplementation(real);
    }
  });

  it('NXT mode, a stock added to NXT mid-period: the headline shows the KRX base date the base came from', async () => {
    const app = makeApp(EXAMPLE.slice(0, 1), { period: { unit: 'W', n: 1 }, venueMode: 'NXT' });
    const snaps = app.data.snapshots;
    const real = snaps.load.bind(snaps);
    let baseDate: string | null = null;
    // NXT 일봉은 기간 안에만 있다(기간 전 NXT 봉 없음). 기준가·기준일은 KRX 일봉에서 나온다.
    vi.spyOn(snaps, 'load').mockImplementation(async (args) => {
      const s = await real(args);
      baseDate = s.baseDate;
      const first = s.candles[0]?.t ?? Infinity;
      return { ...s, daily: s.daily.filter((c) => c.t >= first) };
    });
    render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd });
    await vi.waitFor(() => expect(screen.queryByText(/불러오는 중/)).toBeNull(), { timeout: 3000 });
    expect(baseDate).not.toBeNull();
    const [, m, d] = baseDate!.split('-').map(Number);
    expect(screen.getByText(`1주 · 등락률 · 기준 ${m}/${d} 종가`)).toBeTruthy();
  });

  it('RVOL on 1 day in AUTO says the denominator is the KRX average; KRX mode and other metrics do not', async () => {
    const app = makeApp(EXAMPLE.slice(0, 1), { metric: 'rvol', venueMode: 'AUTO' });
    render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd });
    await vi.waitFor(() => expect(screen.queryByText(/불러오는 중/)).toBeNull(), { timeout: 3000 });
    // 자동 모드는 NXT 프리마켓 분봉이 섞이고 분모는 KRX 평균
    const note = await screen.findByText('KRX 20일 평균 거래량 대비예요');
    expect(note.getAttribute('role')).toBe('status');
    app.updateSettings({ metric: 'change' });
    await vi.waitFor(() => expect(screen.queryByText('KRX 20일 평균 거래량 대비예요')).toBeNull());
    app.updateSettings({ metric: 'rvol', venueMode: 'KRX' });
    await vi.waitFor(() => expect(screen.getByText('오늘 · 상대 거래량 · 기준 전일 종가')).toBeTruthy(), { timeout: 3000 });
    await vi.waitFor(() => expect(screen.queryByText(/불러오는 중/)).toBeNull(), { timeout: 3000 });
    expect(screen.queryByText('KRX 20일 평균 거래량 대비예요')).toBeNull();
  });

  it('an unavailable metric falls back to 등락률 and says why under the headline', async () => {
    const app = makeApp(EXAMPLE.slice(0, 2), { metric: 'excess' });
    // 지수 봉을 주지 않는 공급자(토스 지수 미지원과 같은 경우)
    app.provider.capabilities.hasIndexCandles = false;
    render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd });
    await vi.waitFor(() => expect(screen.queryByText(/불러오는 중/)).toBeNull(), { timeout: 3000 });
    expect(screen.getByText('시장 대비 초과수익 대신 등락률을 보여 줘요 · 이 데이터 소스는 지수 데이터를 주지 않아요').getAttribute('role')).toBe(
      'status',
    );
    expect(screen.getByText('오늘 · 등락률 · 기준 전일 종가')).toBeTruthy();
    expect(app.settings.metric).toBe('excess');
  });

  it('a v1.1 metric on 1 day says 1개월 이상에서 볼 수 있어요; an available metric shows no note', async () => {
    const app = makeApp(EXAMPLE.slice(0, 1), { metric: 'volatility' });
    render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd });
    expect(screen.getByText('변동성 대신 등락률을 보여 줘요 · 1개월 이상에서 볼 수 있어요')).toBeTruthy();
    app.updateSettings({ metric: 'drawdown' });
    await vi.waitFor(() => expect(screen.queryByText(/대신 등락률을 보여 줘요/)).toBeNull());
  });

  it('empty group: 예시 그룹 불러오기 fills it with the four example stocks', async () => {
    const app = makeApp([]);
    render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd });
    expect(screen.getByText('비교할 종목을 추가해 보세요')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: '예시 그룹 불러오기' }));
    expect(app.watchlists.groups[0].items.map((i) => i.symbol)).toEqual(EXAMPLE);
    await vi.waitFor(() => expect(board().getByText('DB하이텍')).toBeTruthy(), { timeout: 3000 });
  });

  it('the color dot hides a series and changing the period is saved', async () => {
    const app = makeApp(EXAMPLE.slice(0, 2));
    render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd });
    await vi.waitFor(() => expect(screen.queryByText(/불러오는 중/)).toBeNull(), { timeout: 3000 });
    await fireEvent.click(within(rowOf('삼성전자')).getByRole('button', { name: '삼성전자 차트에 숨기기' }));
    expect(app.watchlists.groups[0].items[0].hidden).toBe(true);
    await fireEvent.click(screen.getByRole('radio', { name: '주' }));
    expect(app.settings.period).toEqual({ unit: 'W', n: 2 });
    await vi.waitFor(() => expect(screen.getByText(/^2주 · 등락률 · 기준 \d+\/\d+ 종가$/)).toBeTruthy(), { timeout: 3000 });
  });
});

describe('Compare sheets', () => {
  it('the metric chip opens 비교 지표; choosing a metric saves it and closes', async () => {
    const app = makeApp(EXAMPLE.slice(0, 1));
    render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd });
    await fireEvent.click(screen.getByRole('button', { name: /^등락률/ }));
    const dialog = screen.getByRole('dialog', { name: '비교 지표' });
    expect(within(dialog).getByRole('button', { name: /^변동성 / }).getAttribute('aria-disabled')).toBe('true');
    await fireEvent.click(within(dialog).getByRole('button', { name: /^고점 대비 하락률 / }));
    expect(app.settings.metric).toBe('drawdown');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('＋ 종목 추가 opens the add sheet for the current group', async () => {
    const app = makeApp(EXAMPLE);
    render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd });
    await fireEvent.click(board().getByRole('button', { name: '＋ 종목 추가' }));
    const dialog = screen.getByRole('dialog', { name: '종목 추가' });
    expect(within(dialog).getByText('반도체 그룹 · 4/10 · 6개 더 추가할 수 있어요')).toBeTruthy();
  });

  it('below 1024 a row opens the detail sheet; deleting closes it and removes the row', async () => {
    const app = makeApp(EXAMPLE.slice(0, 2));
    render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd });
    await vi.waitFor(() => expect(screen.queryByText(/불러오는 중/)).toBeNull(), { timeout: 3000 });
    await fireEvent.click(rowOf('SK하이닉스').querySelector('.main-btn')!);
    const dialog = screen.getByRole('dialog', { name: '종목 상세' });
    expect(within(dialog).getByText('SK하이닉스')).toBeTruthy();
    await fireEvent.click(within(dialog).getByRole('button', { name: '삭제' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(app.watchlists.groups[0].items.map((i) => i.symbol)).toEqual(['005930']);
  });

  describe('focus after deleting from the detail', () => {
    const mainButtons = () => [...screen.getByRole('region', { name: '리더보드' }).querySelectorAll<HTMLElement>('li .main-btn')];
    const addButton = () => board().getByRole('button', { name: '＋ 종목 추가' });
    const deleteAt = async (index: number, wide: boolean) => {
      const btn = mainButtons()[index];
      btn.focus();
      await fireEvent.click(btn);
      const detail = wide ? screen.getByRole('region', { name: '선택한 종목' }) : screen.getByRole('dialog', { name: '종목 상세' });
      const del = within(detail).getByRole('button', { name: '삭제' });
      del.focus();
      await fireEvent.click(del);
      await tick();
    };
    const emptyAdd = () => screen.getByText('비교할 종목을 추가해 보세요').parentElement!.querySelector<HTMLElement>('button')!;
    for (const wide of [false, true]) {
      const label = wide ? 'inline (≥1024)' : 'sheet (<1024)';
      it(`${label}: deleting the only stock focuses the empty state's ＋ 종목 추가, and 되돌리기 focuses the restored row`, async () => {
        const app = makeApp(EXAMPLE.slice(0, 1));
        render(SnackbarHost);
        render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd, wide });
        await vi.waitFor(() => expect(screen.queryByText(/불러오는 중/)).toBeNull(), { timeout: 3000 });
        await deleteAt(0, wide);
        expect(screen.queryByRole('region', { name: '리더보드' })).toBeNull();
        expect(document.activeElement).toBe(emptyAdd());

        await fireEvent.click(screen.getByRole('button', { name: '되돌리기' }));
        await tick();
        await tick();
        expect(mainButtons()).toHaveLength(1);
        expect(document.activeElement).toBe(mainButtons()[0]);
      });

      it(`${label}: moving the only stock to another group focuses the empty state's ＋ 종목 추가`, async () => {
        const app = makeApp(EXAMPLE.slice(0, 1));
        app.setWatchlists({ ...app.watchlists, groups: [...app.watchlists.groups, { id: 'g2', name: '배당', items: [] }] });
        render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd, wide });
        await vi.waitFor(() => expect(screen.queryByText(/불러오는 중/)).toBeNull(), { timeout: 3000 });
        const btn = mainButtons()[0];
        btn.focus();
        await fireEvent.click(btn);
        const detail = wide ? screen.getByRole('region', { name: '선택한 종목' }) : screen.getByRole('dialog', { name: '종목 상세' });
        await fireEvent.click(within(detail).getByRole('button', { name: '그룹 이동' }));
        const target = within(detail).getByRole('button', { name: /^배당 / });
        target.focus();
        await fireEvent.click(target);
        await tick();
        expect(app.watchlists.groups[1].items.map((i) => i.symbol)).toEqual([EXAMPLE[0]]);
        expect(document.activeElement).toBe(emptyAdd());
      });

      it(`${label}: 되돌리기 focuses the restored row`, async () => {
        const app = makeApp(EXAMPLE.slice(0, 3));
        render(SnackbarHost);
        render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd, wide });
        await vi.waitFor(() => expect(screen.queryByText(/불러오는 중/)).toBeNull(), { timeout: 3000 });
        const symbol = mainButtons()[1].closest('li')!.dataset.symbol;
        await deleteAt(1, wide);
        await fireEvent.click(screen.getByRole('button', { name: '되돌리기' }));
        await tick();
        expect(document.activeElement?.closest('li')?.dataset.symbol).toBe(symbol);
        expect(document.activeElement?.classList.contains('main-btn')).toBe(true);
      });

      it(`${label}: focus lands on the row now at the same position`, async () => {
        const app = makeApp(EXAMPLE.slice(0, 3));
        render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd, wide });
        await vi.waitFor(() => expect(screen.queryByText(/불러오는 중/)).toBeNull(), { timeout: 3000 });
        await deleteAt(1, wide);
        expect(mainButtons()).toHaveLength(2);
        expect(document.activeElement).toBe(mainButtons()[1]);
      });

      it(`${label}: after deleting with the keyboard, 되돌리기 stays while focus rests on the next row, then the remaining time runs`, async () => {
        const app = makeApp(EXAMPLE.slice(0, 3));
        render(SnackbarHost);
        render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd, wide });
        await vi.waitFor(() => expect(screen.queryByText(/불러오는 중/)).toBeNull(), { timeout: 3000 });
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        try {
          await deleteAt(1, wide);
          await tick();
          expect(document.activeElement).toBe(mainButtons()[1]);
          vi.advanceTimersByTime(6000);
          expect(currentSnackbar()?.message).toMatch(/삭제했어요$/);
          // 포커스가 떠나면 멈춘 때의 남은 시간(5초)부터
          addButton().focus();
          vi.advanceTimersByTime(4999);
          expect(currentSnackbar()).not.toBeNull();
          vi.advanceTimersByTime(1);
          expect(currentSnackbar()).toBeNull();
        } finally {
          vi.useRealTimers();
        }
      });

      it(`${label}: deleting the last row focuses ＋ 종목 추가`, async () => {
        const app = makeApp(EXAMPLE.slice(0, 2));
        render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd, wide });
        await vi.waitFor(() => expect(screen.queryByText(/불러오는 중/)).toBeNull(), { timeout: 3000 });
        await deleteAt(1, wide);
        expect(mainButtons()).toHaveLength(1);
        expect(document.activeElement).toBe(addButton());
      });
    }
  });

  it('when the delete leaves focus on the page (e.g. a browser where clicks do not focus) the usual 5 seconds apply', async () => {
    const app = makeApp(EXAMPLE.slice(0, 3));
    render(SnackbarHost);
    render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd, wide: false });
    await vi.waitFor(() => expect(screen.queryByText(/불러오는 중/)).toBeNull(), { timeout: 3000 });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      (document.activeElement as HTMLElement | null)?.blur();
      await fireEvent.click(rowOf('SK하이닉스').querySelector('.main-btn')!);
      await fireEvent.click(within(screen.getByRole('dialog', { name: '종목 상세' })).getByRole('button', { name: '삭제' }));
      await tick();
      await tick();
      expect(document.activeElement).toBe(document.body);
      vi.advanceTimersByTime(4999);
      expect(currentSnackbar()).not.toBeNull();
      vi.advanceTimersByTime(1);
      expect(currentSnackbar()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('되돌리기 after switching groups does not focus the same symbol’s row in the group now shown', async () => {
    const app = makeApp(EXAMPLE.slice(0, 3));
    app.setWatchlists({ ...app.watchlists, groups: [...app.watchlists.groups, { id: 'g2', name: '배당', items: items([EXAMPLE[1], EXAMPLE[3]]) }] });
    render(SnackbarHost);
    render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd, wide: true });
    await vi.waitFor(() => expect(screen.queryByText(/불러오는 중/)).toBeNull(), { timeout: 3000 });
    const btn = rowOf('SK하이닉스').querySelector<HTMLElement>('.main-btn')!;
    btn.focus();
    await fireEvent.click(btn);
    const del = within(screen.getByRole('region', { name: '선택한 종목' })).getByRole('button', { name: '삭제' });
    del.focus();
    await fireEvent.click(del);
    await tick();
    app.navigate({ name: 'compare', groupId: 'g2' });
    await tick();
    await vi.waitFor(() => expect(rowOf('SK하이닉스')).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: '되돌리기' }));
    await tick();
    await tick();
    expect(app.watchlists.groups[0].items.map((i) => i.symbol)).toContain(EXAMPLE[1]);
    expect(document.activeElement).not.toBe(rowOf('SK하이닉스').querySelector('.main-btn'));
  });

  it('≥1024: 되돌리기 with another sheet open does not move focus to a leaderboard row behind it', async () => {
    const app = makeApp(EXAMPLE.slice(0, 3));
    render(SnackbarHost);
    render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd, wide: true });
    await vi.waitFor(() => expect(screen.queryByText(/불러오는 중/)).toBeNull(), { timeout: 3000 });
    const rowButtons = () => [...screen.getByRole('region', { name: '리더보드' }).querySelectorAll<HTMLElement>('li .main-btn')];
    const btn = rowButtons()[1];
    btn.focus();
    await fireEvent.click(btn);
    const del = within(screen.getByRole('region', { name: '선택한 종목' })).getByRole('button', { name: '삭제' });
    del.focus();
    await fireEvent.click(del);
    await tick();
    // 패널에서 지운 뒤 다른 시트를 열고, 그 안에서 되돌리기를 누른다
    await fireEvent.click(board().getByRole('button', { name: '＋ 종목 추가' }));
    const dialog = screen.getByRole('dialog', { name: '종목 추가' });
    await fireEvent.click(screen.getByRole('button', { name: '되돌리기' }));
    await tick();
    await tick();
    expect(rowButtons()).toHaveLength(3);
    expect(document.activeElement?.classList.contains('main-btn')).toBe(false);
    expect(rowButtons()).not.toContain(document.activeElement);
    expect(dialog.isConnected).toBe(true);
  });

  it('at ≥1024 the detail renders inline in the side panel, not as a sheet', async () => {
    const app = makeApp(EXAMPLE.slice(0, 2));
    render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd, wide: true });
    await vi.waitFor(() => expect(screen.queryByText(/불러오는 중/)).toBeNull(), { timeout: 3000 });
    expect(screen.getByText('리더보드에서 종목을 누르면 여기서 상세를 볼 수 있어요')).toBeTruthy();
    await fireEvent.click(rowOf('SK하이닉스').querySelector('.main-btn')!);
    expect(screen.queryByRole('dialog')).toBeNull();
    const panel = screen.getByRole('region', { name: '선택한 종목' });
    expect(within(panel).getByText('SK하이닉스')).toBeTruthy();
    expect(panel.closest('aside')).toBeTruthy();
  });

  it('becoming ≥1024 while the detail sheet is open closes it (the detail is inline there) and it stays closed', async () => {
    const app = makeApp(EXAMPLE.slice(0, 2));
    const view = render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd, wide: false });
    await vi.waitFor(() => expect(screen.queryByText(/불러오는 중/)).toBeNull(), { timeout: 3000 });
    await fireEvent.click(rowOf('SK하이닉스').querySelector('.main-btn')!);
    expect(screen.getByRole('dialog', { name: '종목 상세' })).toBeTruthy();
    await view.rerender({ app, now: NOW, sessions, isOpenToday: true, barEnd, wide: true });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('region', { name: '선택한 종목' })).toBeTruthy();
    await view.rerender({ app, now: NOW, sessions, isOpenToday: true, barEnd, wide: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('그룹 관리 opens from the ⋯ button next to the group tabs', async () => {
    const app = makeApp(EXAMPLE.slice(0, 1));
    render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd });
    await fireEvent.click(screen.getAllByRole('button', { name: '그룹 관리' })[0]);
    expect(screen.getByRole('dialog', { name: '그룹 관리' })).toBeTruthy();
  });

  describe('keyboard shortcuts', () => {
    const key = (k: string, target: Document | Element | Window = document.body) => fireEvent.keyDown(target, { key: k });
    const loaded = async (symbols = EXAMPLE.slice(0, 2), settings: Partial<Settings> = {}) => {
      const app = makeApp(symbols, settings);
      render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd });
      await vi.waitFor(() => expect(screen.queryByText(/불러오는 중/)).toBeNull(), { timeout: 3000 });
      return app;
    };

    it('/ opens the add-stock sheet and Esc closes it', async () => {
      await loaded();
      await key('/');
      expect(screen.getByRole('dialog', { name: '종목 추가' })).toBeTruthy();
      await key('Escape', window);
      await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    // Codex 리뷰(PR #36) 1: 다른 모달(메뉴 처음 안내 등)이 열려 있으면 단축키로 시트를 겹쳐 열지 않는다.
    it('shortcuts do nothing while another modal dialog (the menu intro) is open', async () => {
      const app = await loaded();
      const other = document.createElement('div');
      other.setAttribute('role', 'dialog');
      other.setAttribute('aria-modal', 'true');
      document.body.append(other);
      await key('/');
      await key('m');
      await key('?');
      await key(']');
      expect(screen.queryByRole('dialog', { name: '종목 추가' })).toBeNull();
      expect(screen.queryByRole('dialog', { name: '비교 지표' })).toBeNull();
      expect(screen.queryByRole('dialog', { name: '단축키' })).toBeNull();
      expect(app.settings.period).toEqual({ unit: 'D', n: 1 });
      other.remove();
      await key('/');
      expect(screen.getByRole('dialog', { name: '종목 추가' })).toBeTruthy();
    });

    it('[ and ] step the period and stop at the ends', async () => {
      const app = await loaded();
      expect(app.settings.period).toEqual({ unit: 'D', n: 1 });
      await key(']');
      expect(app.settings.period).toEqual({ unit: 'W', n: 1 });
      await key(']');
      expect(app.settings.period).toEqual({ unit: 'W', n: 2 });
      await key('[');
      await key('[');
      await key('[');
      expect(app.settings.period).toEqual({ unit: 'D', n: 1 });
    });

    it('m opens the metric sheet; ? opens the shortcut help and lists the keys', async () => {
      await loaded();
      await key('m');
      expect(screen.getByRole('dialog', { name: '비교 지표' })).toBeTruthy();
      await key('Escape', window);
      await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await key('?');
      const help = screen.getByRole('dialog', { name: '단축키' });
      for (const label of ['종목 검색', '기간 이동 (짧게 · 길게)', '지표 선택', '거래소 모드 순환', '선택 종목 숨기기·보이기', '시트 닫기'])
        expect(within(help).getByText(label)).toBeTruthy();
    });

    it('v cycles 자동 → KRX → NXT → 통합; a provider with only 통합 stays put', async () => {
      const app = await loaded();
      expect(app.settings.venueMode).toBe('AUTO');
      await key('v');
      expect(app.settings.venueMode).toBe('KRX');
      await key('v');
      expect(app.settings.venueMode).toBe('NXT');
      await key('v');
      expect(app.settings.venueMode).toBe('UNIFIED');
      await key('v');
      expect(app.settings.venueMode).toBe('AUTO');
      app.provider.capabilities.venues = ['UNIFIED'];
      await key('v');
      expect(app.settings.venueMode).toBe('AUTO');
    });

    it('h without a selected stock asks to select one; with one it toggles that stock', async () => {
      const app = await loaded();
      await key('h');
      expect(currentSnackbar()?.message).toBe('먼저 종목을 선택하세요');
      expect(app.watchlists.groups[0].items.some((i) => i.hidden)).toBe(false);
      await fireEvent.click(rowOf('삼성전자').querySelector('button.main-btn')!);
      await vi.waitFor(() => screen.getByRole('dialog'));
      await key('Escape', window);
      await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await key('h');
      expect(app.watchlists.groups[0].items.map((i) => i.hidden)).toEqual([true, false]);
      await key('h');
      expect(app.watchlists.groups[0].items.map((i) => i.hidden)).toEqual([false, false]);
    });

    it('does nothing while typing in a field or while a sheet is open', async () => {
      const app = await loaded();
      await key('/');
      const search = screen.getByRole('dialog', { name: '종목 추가' }).querySelector('input')!;
      await key(']', search);
      await key('m', search);
      expect(app.settings.period).toEqual({ unit: 'D', n: 1 });
      expect(screen.queryByRole('dialog', { name: '비교 지표' })).toBeNull();
    });
  });

  describe('row value and the 5-second quote (spec §4.4)', () => {
    const PRICE = 100_000;
    /** 불러온 시리즈를 엿보고, 현재가는 지금 시각의 PRICE로 고정한다. */
    function quoteAt(app: App) {
      const got: { series?: LoadedSeries } = {};
      const snaps = app.data.snapshots;
      const real = snaps.load.bind(snaps);
      vi.spyOn(snaps, 'load').mockImplementation(async (args) => {
        const r = await real(args);
        got.series = r;
        return r;
      });
      vi.spyOn(app.provider, 'getQuotes').mockImplementation(async (symbols, venue) => symbols.map((symbol) => ({ symbol, venue, price: PRICE, ts: NOW })));
      return got;
    }
    const pct = (price: number, base: number) => formatMetricValue(((price - base) * 100) / base, '%');
    const chartValues = () =>
      lwcCharts.at(-1)!.series.flatMap((s) => s.data as { time: number; value?: number }[]).filter((d) => typeof d.value === 'number');

    it('1 day: the row value follows the quote the row shows; the chart keeps the candles', async () => {
      const app = makeApp(['005930']);
      const got = quoteAt(app);
      render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd });
      await vi.waitFor(() => expect(screen.queryByText(/불러오는 중/)).toBeNull(), { timeout: 3000 });
      const base = got.series!.base!;
      const row = rowOf('삼성전자');
      await vi.waitFor(() => expect(within(row).getByText('100,000원')).toBeTruthy());
      expect(within(row).getByText(pct(PRICE, base))).toBeTruthy();
      // 차트는 시세 시각의 점 없이 마지막 1분봉까지
      const last = got.series!.candles.at(-1)!;
      const times = chartValues().map((d) => d.time);
      expect(Math.max(...times)).toBe(toChartTime(last.t));
    });

    it('daily: today’s close is the quote in the row', async () => {
      const app = makeApp(['005930'], { period: { unit: 'M', n: 1 } });
      const got = quoteAt(app);
      render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd });
      await vi.waitFor(() => expect(screen.queryByText(/불러오는 중/)).toBeNull(), { timeout: 3000 });
      await vi.waitFor(() => expect(within(rowOf('삼성전자')).getByText(pct(PRICE, got.series!.base!))).toBeTruthy());
    });

    // 일봉 시리즈는 KRX(자동·통합 모드의 v.series). 다른 거래소 시세면 가격도 %도 캔들 종가 기준.
    it.each([
      // 이 날 시간표에서 자동 모드가 NXT 시세를 고르는 시각(KRX 시간외 종가 단일가, NXT 애프터마켓 접속매매)
      { venueMode: 'AUTO' as const, period: { unit: 'W' as const, n: 1 }, now: kstEpoch(DAY, '15:45:00'), venue: 'NXT' },
      { venueMode: 'UNIFIED' as const, period: { unit: 'M' as const, n: 1 }, now: NOW, venue: 'UNIFIED' },
    ])('$venueMode daily with a $venue quote: price and value both come from the KRX candle close', async ({ venueMode, period, now, venue }) => {
      const app = makeApp(['005930'], { venueMode, period });
      const got = quoteAt(app);
      const quotes = vi.mocked(app.provider.getQuotes);
      render(Compare, { app, now, sessions, isOpenToday: true, barEnd });
      await vi.waitFor(() => expect(screen.queryByText(/불러오는 중/)).toBeNull(), { timeout: 3000 });
      await vi.waitFor(() => expect(quotes).toHaveBeenCalledWith(['005930'], venue));
      const s = got.series!;
      const last = s.candles.at(-1)!;
      expect(s.segments.at(-1)!.venue).toBe('KRX');
      await vi.waitFor(() => expect(within(rowOf('삼성전자')).getByText(`${fmtWon(last.c)}원`)).toBeTruthy());
      expect(within(rowOf('삼성전자')).getByText(pct(last.c, s.base!))).toBeTruthy();
      expect(within(rowOf('삼성전자')).queryByText('100,000원')).toBeNull();
    });

    it('while scrubbing, the row shows the candle value at the scrub time, not the quote', async () => {
      const app = makeApp(['005930'], { period: { unit: 'M', n: 1 } });
      const got = quoteAt(app);
      const todayBar = kstEpoch(DAY, '00:00:00');
      lwcStubHooks.crosshairOnSetData = { time: toChartTime(todayBar) };
      render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd });
      await vi.waitFor(() => expect(screen.queryByText(/불러오는 중/)).toBeNull(), { timeout: 3000 });
      const s = got.series!;
      const today = s.candles.at(-1)!;
      expect(today.t).toBe(todayBar);
      expect(today.c).not.toBe(PRICE);
      await vi.waitFor(() => expect(within(rowOf('삼성전자')).getByText(pct(today.c, s.base!))).toBeTruthy());
      expect(within(rowOf('삼성전자')).queryByText(pct(PRICE, s.base!))).toBeNull();
    });
  });

  describe('leaderboard order while keyboard focus is inside (D2)', () => {
    /** 종목마다 기준가 대비 pct[symbol]%의 현재가를 준다. 바꾼 뒤 'online'으로 바로 새로 받는다. */
    function controlQuotes(app: App, pct: Record<string, number>) {
      const bases: Record<string, number> = {};
      const snaps = app.data.snapshots;
      const real = snaps.load.bind(snaps);
      vi.spyOn(snaps, 'load').mockImplementation(async (args) => {
        const r = await real(args);
        if (r.base !== null) bases[r.symbol] = r.base;
        return r;
      });
      const priceOf = (symbol: string) => Math.round(bases[symbol] * (1 + (pct[symbol] ?? 0) / 100));
      vi.spyOn(app.provider, 'getQuotes').mockImplementation(async (symbols, venue) =>
        symbols.filter((s) => bases[s] !== undefined).map((symbol) => ({ symbol, venue, price: priceOf(symbol), ts: NOW })),
      );
      const valueText = (symbol: string) => formatMetricValue(((priceOf(symbol) - bases[symbol]) * 100) / bases[symbol], '%');
      return { valueText };
    }
    const order = () => [...screen.getByRole('region', { name: '리더보드' }).querySelectorAll<HTMLElement>('li')].map((li) => li.dataset.symbol);
    const mainOf = (symbol: string) => screen.getByRole('region', { name: '리더보드' }).querySelector<HTMLElement>(`li[data-symbol="${symbol}"] .main-btn`)!;
    const [A, B, C, D] = EXAMPLE;
    const refreshQuotes = () => window.dispatchEvent(new Event('online'));
    async function setup(pct: Record<string, number>, wide = false, symbols = [A, B, C]) {
      const app = makeApp(symbols);
      const q = controlQuotes(app, pct);
      render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd, wide });
      await vi.waitFor(() => expect(screen.queryByText(/불러오는 중/)).toBeNull(), { timeout: 3000 });
      // 첫 시세는 기준가를 알기 전에 오므로 한 번 더 받는다
      refreshQuotes();
      await vi.waitFor(() => expect(within(mainOf(C)).getByText(q.valueText(C))).toBeTruthy(), { timeout: 3000 });
      return { app, ...q };
    }

    it('values update but the rows keep their order; focus leaving the list re-sorts', async () => {
      const pct = { [A]: 3, [B]: 2, [C]: 1 };
      const { valueText } = await setup(pct);
      expect(order()).toEqual([A, B, C]);
      mainOf(B).focus();
      Object.assign(pct, { [A]: 1, [C]: 3 });
      refreshQuotes();
      await vi.waitFor(() => expect(within(mainOf(C)).getByText(valueText(C))).toBeTruthy(), { timeout: 3000 });
      expect(within(mainOf(A)).getByText(valueText(A))).toBeTruthy();
      expect(order()).toEqual([A, B, C]);
      expect(document.activeElement).toBe(mainOf(B));
      // 목록 밖(머리줄의 ＋ 종목 추가)으로 나가면 바로 다시 정렬한다
      board().getByRole('button', { name: '＋ 종목 추가' }).focus();
      await tick();
      expect(order()).toEqual([C, B, A]);
    });

    it('a click outside (focus to nowhere) also lifts the hold', async () => {
      const pct = { [A]: 3, [B]: 2, [C]: 1 };
      const { valueText } = await setup(pct);
      mainOf(A).focus();
      Object.assign(pct, { [A]: 1, [C]: 3 });
      refreshQuotes();
      await vi.waitFor(() => expect(within(mainOf(C)).getByText(valueText(C))).toBeTruthy(), { timeout: 3000 });
      expect(order()).toEqual([A, B, C]);
      mainOf(A).blur();
      await tick();
      expect(order()).toEqual([C, B, A]);
    });

    it('adding and removing stocks while held keeps one row per stock; new ones go last', async () => {
      const { app, valueText } = await setup({ [A]: 3, [B]: 2, [C]: 1, [D]: 9 });
      mainOf(C).focus();
      const g = app.watchlists.groups[0];
      app.setWatchlists({ ...app.watchlists, groups: [addItem(removeItem(g, B).group, D, NOW)] });
      await tick();
      await vi.waitFor(() => expect(screen.queryByText(/불러오는 중/)).toBeNull(), { timeout: 3000 });
      refreshQuotes();
      await vi.waitFor(() => expect(within(mainOf(D)).getByText(valueText(D))).toBeTruthy(), { timeout: 3000 });
      expect(order()).toEqual([A, C, D]);
      expect(document.activeElement).toBe(mainOf(C));
    });

    it('deleting from the detail sheet uses the row’s position just before the delete, not when it was opened', async () => {
      const pct = { [A]: 3, [B]: 2, [C]: 1 };
      const { app, valueText } = await setup(pct);
      mainOf(A).focus();
      await fireEvent.click(mainOf(A));
      const dialog = screen.getByRole('dialog', { name: '종목 상세' });
      // 시트에 포커스가 있으니 고정이 풀려 있고, 값이 바뀌면 A가 맨 아래로 간다
      Object.assign(pct, { [A]: 0 });
      refreshQuotes();
      await vi.waitFor(() => expect(within(mainOf(A)).getByText(valueText(A))).toBeTruthy(), { timeout: 3000 });
      expect(order()).toEqual([B, C, A]);
      // 다시 정렬해도 포커스를 리더보드로 끌어오지 않는다
      expect(dialog.contains(document.activeElement)).toBe(true);
      const del = within(dialog).getByRole('button', { name: '삭제' });
      del.focus();
      await fireEvent.click(del);
      await tick();
      expect(app.watchlists.groups[0].items.map((i) => i.symbol)).toEqual([B, C]);
      expect(document.activeElement).toBe(board().getByRole('button', { name: '＋ 종목 추가' }));
    });

    it('≥1024: a row clicked with the mouse keeps focus but does not hold the order', async () => {
      const pct = { [A]: 3, [B]: 2, [C]: 1 };
      const { valueText } = await setup(pct, true);
      await fireEvent.pointerDown(mainOf(B));
      mainOf(B).focus();
      await fireEvent.pointerUp(mainOf(B));
      await fireEvent.click(mainOf(B));
      expect(screen.getByRole('region', { name: '선택한 종목' })).toBeTruthy();
      Object.assign(pct, { [A]: 1, [C]: 3 });
      refreshQuotes();
      await vi.waitFor(() => expect(within(mainOf(C)).getByText(valueText(C))).toBeTruthy(), { timeout: 3000 });
      expect(order()).toEqual([C, B, A]);
      expect(document.activeElement).toBe(mainOf(B));
    });

    it('a key press on a row that was focused with the mouse starts holding the order; focus leaving re-sorts', async () => {
      const pct = { [A]: 3, [B]: 2, [C]: 1 };
      const { valueText } = await setup(pct);
      const dot = screen.getByRole('button', { name: /삼성전자 차트에/ });
      await fireEvent.pointerDown(dot);
      dot.focus();
      await fireEvent.pointerUp(dot);
      expect(document.activeElement).toBe(dot);
      // 같은 버튼에서 이어 키보드를 쓴다: 새 focusin은 없지만 마지막 입력이 키보드다
      await fireEvent.keyDown(dot, { key: ' ' });
      await fireEvent.keyUp(dot, { key: ' ' });
      await fireEvent.click(dot);
      Object.assign(pct, { [A]: 1, [C]: 3 });
      refreshQuotes();
      await vi.waitFor(() => expect(within(mainOf(C)).getByText(valueText(C))).toBeTruthy(), { timeout: 3000 });
      expect(order()).toEqual([A, B, C]);
      expect(document.activeElement).toBe(dot);
      board().getByRole('button', { name: '＋ 종목 추가' }).focus();
      await tick();
      expect(order()).toEqual([C, B, A]);
    });

    it('undo snackbar hold survives the focused row moving in a re-sort (focusout then focus back)', async () => {
      const pct = { [A]: 3, [B]: 2, [C]: 1, [D]: 0 };
      const { valueText } = await setup(pct, false, [A, B, C, D]);
      // jsdom은 포커스가 있는 노드를 옮겨도 focusout을 보내지 않는다. 브라우저처럼 옮긴 직후 보낸다.
      const spies = [Element.prototype, CharacterData.prototype].map((proto) => {
        const real = proto.before;
        return vi.spyOn(proto, 'before').mockImplementation(function (this: ChildNode, ...nodes) {
          const active = document.activeElement;
          real.apply(this, nodes);
          if (active && active !== document.activeElement) {
            active.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
          }
        });
      });
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      try {
        // 마우스로 B를 열어 삭제한다: 포커스는 그 자리의 C로 가고, 스낵바는 C에 머무는 동안 멈춘다
        await fireEvent.pointerDown(mainOf(B));
        mainOf(B).focus();
        await fireEvent.click(mainOf(B));
        const del = within(screen.getByRole('dialog', { name: '종목 상세' })).getByRole('button', { name: '삭제' });
        del.focus();
        await fireEvent.click(del);
        await tick();
        expect(document.activeElement).toBe(mainOf(C));
        expect(currentSnackbar()).not.toBeNull();
        // C가 꼴찌로 내려가 C의 행이 옮겨진다: [A,C,D] → [A,D,C]
        Object.assign(pct, { [C]: -5 });
        refreshQuotes();
        await vi.waitFor(() => expect(within(mainOf(C)).getByText(valueText(C))).toBeTruthy(), { timeout: 3000 });
        expect(order()).toEqual([A, D, C]);
        expect(document.activeElement).toBe(mainOf(C));
        vi.advanceTimersByTime(6000);
        expect(currentSnackbar()).not.toBeNull();
        // 포커스가 떠나면 남은 시간 뒤에 사라진다
        board().getByRole('button', { name: '＋ 종목 추가' }).focus();
        await tick();
        expect(currentSnackbar()).not.toBeNull();
        vi.advanceTimersByTime(5000);
        expect(currentSnackbar()).toBeNull();
      } finally {
        vi.useRealTimers();
        for (const spy of spies) spy.mockRestore();
      }
    });

    it('<1024: closing the detail sheet with the mouse returns focus to the row without holding the order', async () => {
      const pct = { [A]: 3, [B]: 2, [C]: 1 };
      const { valueText } = await setup(pct);
      mainOf(B).focus();
      await fireEvent.click(mainOf(B));
      const close = within(screen.getByRole('dialog', { name: '종목 상세' })).getByRole('button', { name: '닫기' });
      await fireEvent.pointerDown(close);
      await fireEvent.click(close);
      await tick();
      expect(document.activeElement).toBe(mainOf(B));
      Object.assign(pct, { [A]: 1, [C]: 3 });
      refreshQuotes();
      await vi.waitFor(() => expect(within(mainOf(C)).getByText(valueText(C))).toBeTruthy(), { timeout: 3000 });
      expect(order()).toEqual([C, B, A]);
    });

    it('값 순: Alt+Arrow does not move the row and says where to reorder', async () => {
      const { app } = await setup({ [A]: 0, [B]: 0, [C]: 0 });
      expect(order()).toEqual([A, B, C]);
      mainOf(A).focus();
      await fireEvent.keyDown(mainOf(A), { key: 'ArrowDown', altKey: true });
      expect(order()).toEqual([A, B, C]);
      expect(app.watchlists.groups[0].items.map((i) => i.symbol)).toEqual([A, B, C]);
      expect(board().getByRole('status').textContent).toContain('내 순서에서 바꿀 수 있어요');
    });

    it('내 순서: rows keep the group order as values change, the choice is saved, and Alt+Arrow moves the row', async () => {
      const pct = { [A]: 1, [B]: 2, [C]: 3 };
      const { app, valueText } = await setup(pct);
      expect(order()).toEqual([C, B, A]);
      await fireEvent.click(board().getByRole('button', { name: '내 순서' }));
      expect(app.settings.boardOrder).toBe('mine');
      expect(order()).toEqual([A, B, C]);
      expect(board().getByText('내 순서 · 3/10')).toBeTruthy();
      Object.assign(pct, { [A]: 5 });
      refreshQuotes();
      await vi.waitFor(() => expect(within(mainOf(A)).getByText(valueText(A))).toBeTruthy(), { timeout: 3000 });
      expect(order()).toEqual([A, B, C]);
      mainOf(A).focus();
      await fireEvent.keyDown(mainOf(A), { key: 'ArrowDown', altKey: true });
      expect(order()).toEqual([B, A, C]);
      expect(app.watchlists.groups[0].items.map((i) => i.symbol)).toEqual([B, A, C]);
      expect(document.activeElement).toBe(mainOf(A));
      await fireEvent.click(board().getByRole('button', { name: '값 순' }));
      expect(app.settings.boardOrder).toBe('value');
      expect(order()).toEqual([A, C, B]);
    });
  });

  it('표 보기 shows the chart values as a table with the metric and period in the caption', async () => {
    const app = makeApp(EXAMPLE.slice(0, 2));
    render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd });
    await vi.waitFor(() => expect(screen.queryByText(/불러오는 중/)).toBeNull(), { timeout: 3000 });
    expect(screen.queryByRole('table')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: '표 보기' }));
    const table = screen.getByRole('table', { name: '등락률 표 · 1일' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent?.trim())).toEqual(['시각', '삼성전자', 'SK하이닉스']);
    expect(within(table).getAllByRole('row').length).toBeGreaterThan(2);
  });
});

describe('Compare load errors (spec §11)', () => {
  function failAll(app: App, err: () => Error, only?: string) {
    const real = app.provider.getCandles.bind(app.provider);
    return vi.spyOn(app.provider, 'getCandles').mockImplementation(async (q) => {
      if (only === undefined || q.symbol === only) throw err();
      return real(q);
    });
  }
  // 진행률(`불러오는 중 n/m`)만 본다. 툴바 안내 `잠시 천천히 불러오는 중`과 겹치지 않게.
  const loaded = () => vi.waitFor(() => expect(screen.queryByText(/불러오는 중 \d/)).toBeNull(), { timeout: 3000 });

  it('proxy unreachable: top banner with 진단 열기 → settings diagnostics; no ● 실시간', async () => {
    const app = makeApp(EXAMPLE);
    failAll(app, () => new ApiError('proxy-unreachable'));
    const { container } = render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd });
    await loaded();
    const banner = await screen.findByRole('alert');
    expect(banner.textContent).toContain('프록시에 연결할 수 없어요');
    expect(container.querySelector('.fresh')?.textContent).not.toContain('실시간');
    expect(container.querySelector('.fresh')?.textContent).toContain('새로 받지 못했어요');
    await fireEvent.click(within(banner).getByRole('button', { name: '진단 열기' }));
    expect(app.route).toEqual({ name: 'settings', section: 'diagnostics' });
  });

  it('invalid credentials: 키가 맞지 않아요 with 키 다시 입력 → settings connection', async () => {
    const app = makeApp(EXAMPLE);
    failAll(app, () => new ApiError('invalid-credentials', undefined, { status: 401 }));
    render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd });
    await loaded();
    const banner = await screen.findByRole('alert');
    expect(banner.textContent).toContain('키가 맞지 않아요');
    await fireEvent.click(within(banner).getByRole('button', { name: '키 다시 입력' }));
    expect(app.route).toEqual({ name: 'settings', section: 'connection' });
  });

  it('rate limited on one row: toolbar 잠시 천천히 불러오는 중, no banner, others stay live', async () => {
    const app = makeApp(EXAMPLE);
    failAll(app, () => new ApiError('rate-limited', undefined, { status: 429 }), '042700');
    const { container } = render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd });
    await loaded();
    expect(await screen.findByText('잠시 천천히 불러오는 중')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(container.querySelector('.fresh')?.textContent).toContain('실시간');
  });

  it('a row-level error (upstream on one stock) shows no banner', async () => {
    const app = makeApp(EXAMPLE);
    failAll(app, () => new ApiError('upstream'), '042700');
    render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd });
    await loaded();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('잠시 천천히 불러오는 중')).toBeNull();
  });

  it('going back online refreshes now; the listener is removed on unmount', async () => {
    const app = makeApp(['005930']);
    // 시리즈는 캐시에 있을 수 있으니 새로고침이 늘 다시 부르는 현재가 조회로 센다.
    const spy = vi.spyOn(app.provider, 'getQuotes');
    const { unmount } = render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd });
    await loaded();
    const before = spy.mock.calls.length;
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(spy.mock.calls.length).toBeGreaterThan(before));
    unmount();
    const after = spy.mock.calls.length;
    window.dispatchEvent(new Event('online'));
    await new Promise((r) => setTimeout(r, 20));
    expect(spy.mock.calls.length).toBe(after);
  });
});

describe('비교 화면 공유', () => {
  afterEach(() => {
    closeShare();
    setShareController(null);
  });

  it('로그인했고 보이는 종목이 있으면 공유 단추로 비교 화면 스냅샷을 연다', async () => {
    setShareController({ account: { email: 'me@example.test' } } as SyncController);
    const app = makeApp(EXAMPLE);
    render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd });
    await fireEvent.click(screen.getByRole('button', { name: '공유' }));
    const req = currentShare()!;
    expect(req.kind).toBe('compare');
    const b = req.build(true);
    expect(b.ok && b.snapshot).toMatchObject({ kind: 'compare', title: '반도체', symbols: EXAMPLE, view: { period: app.settings.period, metric: app.settings.metric } });
    expect(typeof req.capture).toBe('function');
  });

  it('로그인하지 않았으면 공유 단추가 없다', () => {
    setShareController({ account: null } as SyncController);
    const app = makeApp(EXAMPLE);
    render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd });
    expect(screen.queryByRole('button', { name: '공유' })).toBeNull();
  });
});

describe('비교 카드 캡처와 표시 지표', () => {
  let texts: { text: string; color: string }[];
  let swatches: string[];
  beforeEach(() => {
    setShareController({ account: { email: 'me@example.test' } } as SyncController);
    texts = [];
    swatches = [];
    const ctx = {
      fillStyle: '', scale() {}, drawImage() {},
      fillRect(_x: number, _y: number, w: number, h: number) { if (w === 10 && h === 10) swatches.push(this.fillStyle); },
      fillText(text: string) { texts.push({ text, color: this.fillStyle }); },
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
    for (const [k, v] of Object.entries({ '--s1': '#123456', '--up': '#ee1122', '--down': '#1122ee', '--t1': '#111111' })) {
      document.documentElement.style.setProperty(k, v);
    }
  });
  afterEach(() => {
    closeShare();
    setShareController(null);
    vi.restoreAllMocks();
    for (const k of ['--s1', '--up', '--down', '--t1']) document.documentElement.style.removeProperty(k);
  });
  const loaded = () => vi.waitFor(() => expect(screen.queryByText(/불러오는 중 \d/)).toBeNull(), { timeout: 3000 });
  async function share() {
    await fireEvent.click(screen.getByRole('button', { name: '공유' }));
    return currentShare()!;
  }

  it.each([false, true])('로그인했어도 보이는 종목이 없으면 단추가 없다(전부 숨김=%s)', (hidden) => {
    const app = makeApp(hidden ? EXAMPLE : []);
    if (hidden) app.setWatchlists({ ...app.watchlists, groups: app.watchlists.groups.map((g) => ({ ...g, items: g.items.map((i) => ({ ...i, hidden: true })) })) });
    render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd });
    expect(screen.queryByRole('button', { name: '공유' })).toBeNull();
  });

  it('보이는 종목이 있으면 단추가 있고, 캡처는 리더보드 상위 5개·선 색·둘째 줄을 담으며 받는 중이면 null', async () => {
    const app = makeApp([...EXAMPLE, '035420', '035720', '051910']);
    const g = app.watchlists.groups[0];
    app.setWatchlists({ ...app.watchlists, groups: [{ ...g, items: g.items.map((i, k) => ({ ...i, hidden: k === 1 })) }] });
    render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd });
    const req = await share();
    expect(screen.getByText(/불러오는 중 \d/)).toBeTruthy();
    expect(req.capture!()).toBeNull();
    await loaded();
    // 숨긴 종목은 목록에 남지만 카드에는 넣지 않는다.
    const visible = [...screen.getByRole('region', { name: '리더보드' }).querySelectorAll('li')]
      .filter((li) => li.querySelector('.dotbtn')?.getAttribute('aria-pressed') === 'true');
    expect(visible).toHaveLength(6);
    const top = visible.slice(0, 5).map((li) => li.querySelector('.nm b')!.childNodes[0].textContent!.trim());
    const card = req.capture!()!;
    expect(card.canvas.width).toBe(1600);
    expect(card.line).toBeTruthy();
    expect(texts.slice(3, -1).filter((_, i) => i % 2 === 0).map((t) => t.text)).toEqual(top);
    expect(swatches).toHaveLength(5);
    const chartItems = app.watchlists.groups[0].items.filter((i) => !i.hidden);
    expect(swatches).toEqual(visible.slice(0, 5).map((li) => {
      const index = chartItems.findIndex((i) => i.symbol === li.getAttribute('data-symbol'));
      return lwcCharts.at(-1)!.series[index * 2 + 1].options.color;
    }));
    expect(card.line).toContain(top[0]);
    expect(card.line).toContain(top[1]);
    expect(lwcCharts.at(-1)!.screenshots).toEqual([[true, false]]);
  });

  it('받은 뒤 시계만 움직여도 카드와 둘째 줄 기준 시각은 마지막 수신 시각이다', async () => {
    const app = makeApp(EXAMPLE);
    const { rerender } = render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd });
    await loaded();
    const req = await share();
    const first = req.capture!()!;
    await rerender({ app, now: NOW + 60_000, sessions, isOpenToday: true, barEnd });
    const next = req.capture!()!;
    expect(next.line).toBe(first.line);
    expect(next.alt).toBe(first.alt);
  });

  it('대체 등락률을 보이면 스냅샷도 실제 화면 지표를 쓴다(설정 프록시 포함)', async () => {
    const app = makeApp(EXAMPLE, { metric: 'rsi' });
    render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd });
    await loaded();
    const req = await share();
    const built = req.build(false);
    expect(built.ok && built.snapshot).toMatchObject({ view: { metric: 'change' } });
    expect(req.capture!()?.alt).toContain('등락률');
    expect(app.settings.metric).toBe('rsi');
  });

  it.each(['rvol', 'mcap'] as const)('%s 값에는 등락 색을 쓰지 않는다', async (metric) => {
    const app = makeApp(EXAMPLE, { metric });
    render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd });
    await loaded();
    const req = await share();
    req.capture!();
    expect(texts.slice(3, -1).filter((_, i) => i % 2 === 1).map((t) => t.color)).toEqual(Array(4).fill('#111111'));
  });

  it.each(['kr', 'global'] as const)('%s: 작은 등락도 리더보드의 둘째 자리 반올림과 같은 색이다', async (colorConvention) => {
    const app = makeApp(EXAMPLE, { colorConvention });
    const real = app.data.snapshots.load.bind(app.data.snapshots);
    vi.spyOn(app.data.snapshots, 'load').mockImplementation(async (args) => ({ ...await real(args), base: 1_000_000 }));
    const changes = [0.006, -0.006, 0.004, -0.004];
    vi.spyOn(app.provider, 'getQuotes').mockImplementation(async (symbols, venue) => symbols.map((symbol) => ({ symbol, venue, price: 1_000_000 * (1 + changes[EXAMPLE.indexOf(symbol)] / 100), ts: NOW })));
    render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd });
    await loaded();
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(within(rowOf('삼성전자')).getByText('▲ +0.01%')).toBeTruthy());
    const req = await share();
    req.capture!();
    expect(texts.filter((t) => t.text === '▲ +0.01%')[0]?.color).toBe('#ee1122');
    expect(texts.filter((t) => t.text === '▼ -0.01%')[0]?.color).toBe('#1122ee');
    expect(texts.filter((t) => t.text === '0.00%').map((t) => t.color)).toEqual(['#111111', '#111111']);
  });
});
