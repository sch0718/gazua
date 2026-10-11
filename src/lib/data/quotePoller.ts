// 현재가 5초 폴링. 스펙 4.4: 세션 안에서만, 탭이 숨으면 멈추고 다시 보이면 즉시 1회.
import type { Venue } from '../market/tradable';
import type { MarketDataProvider, Quote } from '../providers/types';

type VisibilityDoc = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;

export interface QuotePollerDeps {
  provider: Pick<MarketDataProvider, 'getQuotes'>;
  symbols: () => string[];
  /** 종목별 조회 거래소. 같은 거래소끼리 한 번에 조회한다(`() => Venue`도 된다). */
  venue: (symbol: string) => Venue;
  inSession: () => boolean;
  onQuotes(q: Quote[]): void;
  intervalMs?: number;
  doc?: VisibilityDoc;
}

export interface QuotePoller {
  start(): void;
  stop(): void;
  /** 세션 안이면 지금 바로 1회 조회한다(당겨서 새로고침). */
  refresh(): Promise<void>;
}

/** 현재가 폴링 주기(리더보드·종목 상세가 함께 쓴다). */
export const QUOTE_INTERVAL_MS = 5000;

export function createQuotePoller(deps: QuotePollerDeps): QuotePoller {
  const intervalMs = deps.intervalMs ?? QUOTE_INTERVAL_MS;
  const doc = deps.doc ?? (typeof document === 'undefined' ? undefined : document);
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let busy = false;
  // stop() 뒤에 도착한 응답은 버린다.
  let generation = 0;

  async function poll(): Promise<void> {
    if (!running || busy || !deps.inSession()) return;
    const symbols = deps.symbols();
    if (symbols.length === 0) return;
    const byVenue = new Map<Venue, string[]>();
    for (const s of symbols) {
      const v = deps.venue(s);
      byVenue.set(v, [...(byVenue.get(v) ?? []), s]);
    }
    const gen = generation;
    busy = true;
    try {
      const settled = await Promise.allSettled([...byVenue].map(([v, list]) => deps.provider.getQuotes(list, v)));
      const quotes = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
      if (gen === generation && quotes.length > 0) deps.onQuotes(quotes);
    } finally {
      if (gen === generation) busy = false;
    }
  }

  const arm = () => {
    if (timer === null) timer = setInterval(() => void poll(), intervalMs);
  };
  const disarm = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  const onVisibility = () => {
    if (!running) return;
    if (doc?.visibilityState === 'hidden') disarm();
    else {
      void poll();
      arm();
    }
  };

  return {
    start() {
      if (running) return;
      running = true;
      doc?.addEventListener('visibilitychange', onVisibility);
      if (doc?.visibilityState !== 'hidden') {
        void poll();
        arm();
      }
    },
    stop() {
      running = false;
      generation++;
      busy = false;
      disarm();
      doc?.removeEventListener('visibilitychange', onVisibility);
    },
    refresh: poll,
  };
}
