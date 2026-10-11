// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lwcCharts, ResizeObserverStub } from '../lib/chart/lwcStub';
import { loadIndexSeries } from '../lib/data/candleService';
import { memoryCache } from '../lib/data/testCache';
import { sessionsForDay } from '../lib/market/sessions';
import { createApp, type App } from '../lib/state/app.svelte';
import { currentSnackbar, dismissSnackbar } from '../lib/ui/components/snackbarStore.svelte';
import { ApiError } from '../lib/providers/errors';
import { DEFAULT_SETTINGS, type Meta, type Settings, type WatchItem } from '../lib/state/schema';
import { createSafeStorage } from '../lib/state/storage';
import { memoryBacking, seed } from '../lib/state/testStorage';
import { kstEpoch } from '../lib/time/kst';
import Compare from './Compare.svelte';

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
  lwcCharts.length = 0;
});
afterEach(() => {
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
    expect(screen.getByText('등락률 순 · 4/8')).toBeTruthy();
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
    expect(within(dialog).getByText('반도체 그룹 · 4/8 · 4개 더 추가할 수 있어요')).toBeTruthy();
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
