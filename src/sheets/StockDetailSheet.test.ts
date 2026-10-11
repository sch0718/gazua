// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Candle } from '../lib/data/metrics';
import { sessionsForDay } from '../lib/market/sessions';
import type { StockMeta } from '../lib/providers/types';
import type { App } from '../lib/state/app.svelte';
import type { Group } from '../lib/state/schema';
import { addItem } from '../lib/state/watchlist';
import { kstEpoch } from '../lib/time/kst';
import type { SnapshotSeries } from '../lib/ui/compare/compareController.svelte';
import SnackbarHost from '../lib/ui/components/SnackbarHost.svelte';
import { dismissSnackbar } from '../lib/ui/components/snackbarStore.svelte';
import { QUOTE_INTERVAL_MS } from '../lib/data/quotePoller';
import StockDetailSheet from './StockDetailSheet.svelte';
import { itemsOf, makeTestApp } from './testApp';

const DAY = '2026-10-12';
const at = (hhmm: string) => kstEpoch(DAY, `${hhmm}:00`);
const sessions = sessionsForDay({ date: DAY, isOpen: true });
const EXAMPLE = ['005930', '000660', '042700', '000990'];
const EIGHT = ['005930', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8'];

const SAMSUNG: StockMeta = {
  symbol: '005930',
  name: '삼성전자',
  market: 'KOSPI',
  securityType: 'STOCK',
  nxtSupported: true,
  krxSuspended: false,
  nxtSuspended: null,
  liquidationTrading: false,
};
const candle = (t: number, c: number): Candle => ({ t, o: c, h: c, l: c, c, v: 1 });
const series = (p: Partial<SnapshotSeries> = {}): SnapshotSeries => ({
  symbol: '005930',
  tradingDate: DAY,
  base: 70_000,
  avgDailyVolume: null,
  candles: [candle(at('09:00'), 70_500), candle(at('10:00'), 71_400)],
  daily: [candle(kstEpoch('2026-10-08', '00:00:00'), 69_000)],
  segments: [],
  intervals: [],
  computedAt: at('10:00'),
  stale: false,
  ...p,
});

let apps: App[] = [];
function setup(opts: { groups?: Group[]; now?: number; series?: SnapshotSeries; inline?: boolean } = {}) {
  const groups = opts.groups ?? [
    { id: 'g1', name: '반도체', items: itemsOf(EXAMPLE) },
    { id: 'g2', name: '배당', items: [] },
  ];
  const now = opts.now ?? at('10:00');
  const app = makeTestApp({ groups, now });
  apps.push(app);
  const onclose = vi.fn();
  render(SnackbarHost);
  render(StockDetailSheet, {
    app,
    groupId: 'g1',
    symbol: '005930',
    meta: SAMSUNG,
    series: opts.series ?? series(),
    now,
    sessions,
    isOpenToday: true,
    open: true,
    inline: opts.inline ?? false,
    onclose,
  });
  return { app, onclose };
}
const cell = (label: string) => screen.getByText(label, { selector: '.vcmp span' }).parentElement!;
const g1 = (app: App) => app.watchlists.groups.find((g) => g.id === 'g1')!;
const undo = () => fireEvent.click(screen.getByRole('button', { name: '되돌리기' }));

afterEach(() => {
  for (const a of apps) a.destroy();
  apps = [];
  dismissSnackbar();
});

describe('StockDetailSheet', () => {
  it('an NXT stock shows KRX and NXT prices side by side, NXT 지원 and the current session', async () => {
    setup();
    const dialog = screen.getByRole('dialog', { name: '종목 상세' });
    expect(within(dialog).getByText('NXT 지원')).toBeTruthy();
    expect(within(dialog).getByText('005930 · KOSPI')).toBeTruthy();
    expect(within(dialog).getByText('KRX 정규 · 지금 KRX 가격 · 자동(KRX 우선)')).toBeTruthy();
    await vi.waitFor(() => {
      expect(within(cell('KRX 현재')).getByText(/^\d{1,3}(,\d{3})+$/)).toBeTruthy();
      expect(within(cell('NXT')).getByText(/^\d{1,3}(,\d{3})+$/)).toBeTruthy();
    });
    expect(within(cell('KRX 정규 종가')).getByText('장중')).toBeTruthy();
    expect(screen.getByText('KRX 정규 · 지금').closest('li')?.textContent).toContain('09:00–15:20');
    expect(screen.getByText('정상 거래')).toBeTruthy();
  });

  it('삭제 shows 삭제했어요; 되돌리기 restores the original position and color slot', async () => {
    const { app, onclose } = setup();
    await fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    expect(onclose).toHaveBeenCalled();
    expect(g1(app).items.map((i) => i.symbol)).toEqual(EXAMPLE.slice(1));
    expect(screen.getByRole('status').textContent).toContain('삼성전자을(를) 삭제했어요');
    await undo();
    expect(g1(app).items.map((i) => i.symbol)).toEqual(EXAMPLE);
    expect(g1(app).items[0].colorSlot).toBe(1);
    expect(screen.getByRole('status').textContent).toContain('되돌렸어요');
  });

  it('undo race: delete from 8, add another, 되돌리기 → still 8 with unique slots and an explanation', async () => {
    const { app } = setup({ groups: [{ id: 'g1', name: '반도체', items: itemsOf(EIGHT) }] });
    await fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    app.setWatchlists({ groups: [addItem(g1(app), 'Z9', 2)] });
    await undo();
    expect(g1(app).items).toHaveLength(8);
    expect(g1(app).items.map((i) => i.symbol)).not.toContain('005930');
    expect(new Set(g1(app).items.map((i) => i.colorSlot)).size).toBe(8);
    expect(screen.getByRole('status').textContent).toContain('그룹이 가득 차서 되돌릴 수 없어요');
  });

  it('undo when only the slot was reused restores with a new color and says so', async () => {
    const { app } = setup();
    await fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    app.setWatchlists({ ...app.watchlists, groups: app.watchlists.groups.map((g) => (g.id === 'g1' ? addItem(g, 'Z9', 2) : g)) });
    expect(g1(app).items.find((i) => i.symbol === 'Z9')?.colorSlot).toBe(1);
    await undo();
    const slots = g1(app).items.map((i) => i.colorSlot);
    expect(g1(app).items[0]).toMatchObject({ symbol: '005930', colorSlot: 5 });
    expect(new Set(slots).size).toBe(slots.length);
    expect(screen.getByRole('status').textContent).toContain('되돌렸어요 · 색이 겹쳐 새 색을 줬어요');
  });

  it('a stale snapshot shows the 17:20 기준 badge with the snapshot price above live prices labelled 실시간', async () => {
    setup({ now: at('17:40'), series: series({ stale: true, computedAt: at('17:20') }) });
    expect(screen.getByText('17:20 기준')).toBeTruthy();
    expect(screen.getByText('71,400원')).toBeTruthy();
    const live = screen.getByRole('group', { name: '실시간' });
    expect(within(live).getByText('KRX 애프터')).toBeTruthy();
    expect(within(live).getByText('NXT')).toBeTruthy();
    await vi.waitFor(() => expect(within(cell('NXT')).getByText(/^\d{1,3}(,\d{3})+$/)).toBeTruthy());
  });

  it('그룹 이동 moves the stock to the chosen group', async () => {
    const { app, onclose } = setup();
    await fireEvent.click(screen.getByRole('button', { name: '그룹 이동' }));
    await fireEvent.click(screen.getByRole('button', { name: '배당 (0/8)' }));
    expect(g1(app).items.map((i) => i.symbol)).not.toContain('005930');
    expect(app.watchlists.groups[1].items.map((i) => i.symbol)).toEqual(['005930']);
    expect(screen.getByRole('status').textContent).toContain("'배당' 그룹으로 옮겼어요");
    expect(onclose).toHaveBeenCalled();
  });

  it('그룹 이동 into a full group is refused with the 8-limit message', async () => {
    const { app } = setup({
      groups: [
        { id: 'g1', name: '반도체', items: itemsOf(['005930']) },
        { id: 'g2', name: '배당', items: itemsOf(EIGHT.slice(1).concat('B8')) },
      ],
    });
    await fireEvent.click(screen.getByRole('button', { name: '그룹 이동' }));
    const full = screen.getByRole('button', { name: '배당 (8/8)' });
    expect(full.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(full.getAttribute('aria-describedby')!)?.textContent).toBe('가득 참');
    await fireEvent.click(full);
    expect(g1(app).items.map((i) => i.symbol)).toEqual(['005930']);
    expect(screen.getByRole('status').textContent).toContain('한 차트에 8개까지 비교할 수 있어요');
  });

  it('inline (≥1024) renders in place without a dialog', () => {
    setup({ inline: true });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('region', { name: '선택한 종목' })).toBeTruthy();
    expect(screen.getByText('삼성전자')).toBeTruthy();
  });
});

describe('StockDetailSheet quote refresh', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function mount(now: number) {
    const app = makeTestApp({ groups: [{ id: 'g1', name: '반도체', items: itemsOf(EXAMPLE) }], now });
    apps.push(app);
    const quote = { price: 111 };
    const getQuotes = vi
      .spyOn(app.provider, 'getQuotes')
      .mockImplementation(async (symbols, venue) => symbols.map((symbol) => ({ symbol, venue, price: quote.price, ts: now })));
    const r = render(StockDetailSheet, {
      app,
      groupId: 'g1',
      symbol: '005930',
      meta: SAMSUNG,
      series: series(),
      now,
      sessions,
      isOpenToday: true,
      inline: true,
      onclose: vi.fn(),
    });
    const big = () => document.querySelector('.price-big span')?.textContent;
    return { getQuotes, quote, big, unmount: r.unmount };
  }

  it('in session it re-fetches on the quote poller interval and shows the new price; unmounting stops it', async () => {
    vi.useFakeTimers();
    const t = mount(at('10:00'));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.big()).toBe('111원');
    const first = t.getQuotes.mock.calls.length;
    expect(first).toBe(2); // KRX, NXT
    t.quote.price = 120;
    await vi.advanceTimersByTimeAsync(QUOTE_INTERVAL_MS);
    expect(t.getQuotes.mock.calls.length).toBe(first * 2);
    expect(t.big()).toBe('120원');
    t.unmount();
    await vi.advanceTimersByTimeAsync(QUOTE_INTERVAL_MS * 3);
    expect(t.getQuotes.mock.calls.length).toBe(first * 2);
  });

  it('out of session it fetches once when opened and does not poll', async () => {
    vi.useFakeTimers();
    const t = mount(at('21:00'));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.getQuotes.mock.calls.length).toBe(2);
    await vi.advanceTimersByTimeAsync(QUOTE_INTERVAL_MS * 3);
    expect(t.getQuotes.mock.calls.length).toBe(2);
    t.unmount();
  });
});

describe('StockDetailSheet in 통합 mode', () => {
  it('asks for the unified quote too and shows it as the big price with the 통합 cell current', async () => {
    const app = makeTestApp({ groups: [{ id: 'g1', name: '반도체', items: itemsOf(EXAMPLE) }], now: at('10:00'), settings: { venueMode: 'UNIFIED' } });
    apps.push(app);
    const prices = { KRX: 120, NXT: 125, UNIFIED: 123 } as const;
    const getQuotes = vi
      .spyOn(app.provider, 'getQuotes')
      .mockImplementation(async (symbols, venue) => symbols.map((symbol) => ({ symbol, venue, price: prices[venue], ts: null })));
    render(StockDetailSheet, {
      app,
      groupId: 'g1',
      symbol: '005930',
      meta: SAMSUNG,
      series: series({ candles: [candle(at('10:00'), 110)] }),
      now: at('10:00'),
      sessions,
      isOpenToday: true,
      inline: true,
      onclose: vi.fn(),
    });
    await vi.waitFor(() => expect(document.querySelector('.price-big span')?.textContent).toBe('123원'));
    expect(getQuotes.mock.calls.map((c) => c[1]).sort()).toEqual(['KRX', 'NXT', 'UNIFIED']);
    expect(screen.getByText(/지금 통합 가격/)).toBeTruthy();
    expect([...document.querySelectorAll('.vcmp .cur span')].map((e) => e.textContent)).toEqual(['통합']);
  });
});
