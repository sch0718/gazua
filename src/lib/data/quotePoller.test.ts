import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Venue } from '../market/tradable';
import type { Quote } from '../providers/types';
import { createQuotePoller } from './quotePoller';

/** visibilitychange만 흉내 내는 문서. */
function fakeDoc() {
  const listeners = new Set<() => void>();
  return {
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    set(state: DocumentVisibilityState) {
      this.visibilityState = state;
      for (const fn of listeners) fn();
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

function setup(over: { inSession?: () => boolean; venue?: (s: string) => Venue; symbols?: () => string[] } = {}) {
  const doc = fakeDoc();
  const getQuotes = vi.fn(async (symbols: string[], venue: Venue): Promise<Quote[]> =>
    symbols.map((symbol) => ({ symbol, venue, price: 100, ts: null })),
  );
  const onQuotes = vi.fn();
  const poller = createQuotePoller({
    provider: { getQuotes },
    symbols: over.symbols ?? (() => ['005930', '000660']),
    venue: over.venue ?? (() => 'KRX'),
    inSession: over.inSession ?? (() => true),
    onQuotes,
    doc: doc as unknown as Document,
  });
  return { doc, getQuotes, onQuotes, poller };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('createQuotePoller', () => {
  it('polls right away and then every 5 seconds while in session', async () => {
    const { getQuotes, onQuotes, poller } = setup();
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(getQuotes).toHaveBeenCalledTimes(1);
    expect(getQuotes).toHaveBeenCalledWith(['005930', '000660'], 'KRX');
    expect(onQuotes).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(getQuotes).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(getQuotes).toHaveBeenCalledTimes(4);
    poller.stop();
  });

  it('does not call the provider outside sessions', async () => {
    const { getQuotes, poller } = setup({ inSession: () => false });
    poller.start();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(getQuotes).not.toHaveBeenCalled();
    poller.stop();
  });

  it('stops when the tab is hidden and polls once immediately when visible again', async () => {
    const { doc, getQuotes, poller } = setup();
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(getQuotes).toHaveBeenCalledTimes(1);
    doc.set('hidden');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(getQuotes).toHaveBeenCalledTimes(1);
    doc.set('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(getQuotes).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(getQuotes).toHaveBeenCalledTimes(3);
    poller.stop();
  });

  it('groups symbols by their venue, one call per venue', async () => {
    const { getQuotes, onQuotes, poller } = setup({ venue: (s) => (s === '005930' ? 'NXT' : 'KRX') });
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(getQuotes).toHaveBeenCalledWith(['005930'], 'NXT');
    expect(getQuotes).toHaveBeenCalledWith(['000660'], 'KRX');
    expect(onQuotes.mock.calls[0][0].map((q: Quote) => q.symbol).sort()).toEqual(['000660', '005930']);
    poller.stop();
  });

  it('a failing venue does not drop the other quotes', async () => {
    const { getQuotes, onQuotes, poller } = setup({ venue: (s) => (s === '005930' ? 'NXT' : 'KRX') });
    getQuotes.mockImplementation(async (symbols, venue) => {
      if (venue === 'NXT') throw new Error('boom');
      return symbols.map((symbol) => ({ symbol, venue, price: 1, ts: null }));
    });
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(onQuotes).toHaveBeenCalledWith([{ symbol: '000660', venue: 'KRX', price: 1, ts: null }]);
    poller.stop();
  });

  it('skips a tick while the previous call is still running', async () => {
    const { getQuotes, poller } = setup();
    let release!: () => void;
    getQuotes.mockImplementationOnce(() => new Promise<Quote[]>((r) => (release = () => r([]))));
    poller.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(getQuotes).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(5000);
    expect(getQuotes).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it('no symbols → no call; stop removes the listener and ignores late results', async () => {
    const empty = setup({ symbols: () => [] });
    empty.poller.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(empty.getQuotes).not.toHaveBeenCalled();
    empty.poller.stop();
    expect(empty.doc.listenerCount).toBe(0);

    const { getQuotes, onQuotes, poller } = setup();
    let release!: () => void;
    getQuotes.mockImplementationOnce(
      () => new Promise<Quote[]>((r) => (release = () => r([{ symbol: '005930', venue: 'KRX', price: 1, ts: null }]))),
    );
    poller.start();
    poller.stop();
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(onQuotes).not.toHaveBeenCalled();
  });

  it('refresh() polls now', async () => {
    const { getQuotes, poller } = setup();
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    await poller.refresh();
    expect(getQuotes).toHaveBeenCalledTimes(2);
    poller.stop();
  });
});
