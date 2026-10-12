// 비교 화면의 데이터 흐름: 종목 메타 → 시리즈(병렬, 진행률) → 지수(초과수익일 때) → 5초 현재가.
// 시리즈는 장중 60초, 장 밖 10분마다 다시 받고, 탭이 숨으면 멈춘다(스펙 4.4).
import { loadIndexSeries, type LoadedSeries } from '../../data/candleService';
import { createQuotePoller, type QuotePoller } from '../../data/quotePoller';
import type { DaySession } from '../../market/sessions';
import type { VenueMode } from '../../market/tradable';
import { ApiError } from '../../providers/errors';
import type { MarketDataProvider, Quote, StockMeta } from '../../providers/types';
import type { AppData } from '../../state/app.svelte';
import type { Period, Settings } from '../../state/schema';
import { dominantFault, type LoadFault, type LoadIssue } from './loadIssue';
import { quoteVenue } from './venue';

export type SnapshotSeries = LoadedSeries & { stale: boolean; staleError?: ApiError };
export type IndexName = 'KOSPI' | 'KOSDAQ';

export interface SeriesEntry {
  series: SnapshotSeries | null;
  error: string | null;
  /** 마지막 시도가 ApiError로 실패했으면 그 코드(마지막 성공 결과를 stale로 보여 줄 때도). */
  fault?: LoadFault;
}

export interface IndexEntry {
  status: 'loading' | 'ok' | 'null' | 'failed';
  series: LoadedSeries | null;
  /** 다시 받기에 실패해 이전에 받은 지수를 계속 쓰는 중 */
  stale?: boolean;
}

/** 초과수익에서 한 종목 시리즈와 짝지을 지수. until이 있으면 그 시각(지수 마지막 봉) 뒤의 종목 점은 비운다. */
export interface ExcessIndex {
  series: LoadedSeries | null;
  until: number | null;
}

export interface CompareQuery {
  provider: MarketDataProvider;
  data: AppData;
  /** 그룹 순서 */
  symbols: string[];
  period: Period;
  venueMode: VenueMode;
  /** 시장 대비 초과수익을 볼 때만 지수를 받는다 */
  excess: boolean;
  benchmark: Settings['benchmark'];
}

type VisibilityDoc = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;

export interface CompareControllerDeps {
  now: () => number;
  /** 지금 시장 전체 기준 어느 세션 안인지 */
  inSession: () => boolean;
  /** 오늘 세션(자동 모드 현재가 거래소) */
  sessions: () => DaySession[];
  doc?: VisibilityDoc;
  quoteIntervalMs?: number;
}

export interface CompareController {
  readonly metas: Record<string, StockMeta>;
  readonly entries: Record<string, SeriesEntry>;
  readonly indexes: Partial<Record<IndexName, IndexEntry>>;
  readonly quotes: Record<string, Quote>;
  /**
   * 지금 그룹의 마지막 로딩에서 가장 중요한 오류(스펙 11절 배너용). 오류가 없으면 null.
   * allFailed면 새로 받은 종목이 하나도 없다(● 실시간을 보이지 않는다).
   */
  readonly issue: LoadIssue | null;
  /** 마지막으로 새 시리즈를 받은 시각(이 화면 키 기준). 없으면 null */
  readonly lastOkAt: number | null;
  /** 화면을 바꾼 뒤 첫 로딩 중일 때만. 주기 갱신은 조용히 한다. */
  readonly progress: { done: number; total: number } | null;
  /** 바뀐 것만 다시 받는다. 반응형 효과 안에서 부를 때는 untrack으로 감싼다. */
  setQuery(q: CompareQuery): void;
  /** 시리즈·지수·현재가를 지금 다시 받는다(당겨서 새로고침). */
  refresh(): Promise<void>;
  /** 초과수익에 쓰는 지수: 벤치마크가 자동이면 종목 시장의 지수. */
  indexFor(symbol: string): IndexName;
  /**
   * 종목 시리즈와 같은 시점의 지수(초과수익용). 새로 받은 종목은 같은 갱신이나 그 전에 시작한 지수 조회의 결과와만
   * 짝짓고, 지수가 갱신에 실패했거나 다시 받는 중이라 이전 것이면 그 지수의 마지막 봉까지만 쓴다. 이전 결과(stale)를 보여 주는 종목은 그 결과를 새로 보여 줄 때
   * 기억한 지수 짝을 계속 쓴다(값이 바뀌지 않게). 기억한 짝이 없으면 series는 null.
   * 지수 등락률의 기준은 metricPoints가 종목 기준일의 지수 종가로 다시 맞춘다.
   */
  excessIndex(symbol: string, index: IndexName): ExcessIndex;
  destroy(): void;
}

export const RELOAD_IN_SESSION_MS = 60_000;
export const RELOAD_OUTSIDE_MS = 600_000;
export const META_ERROR = '종목 정보를 받지 못했어요';

/** 행에 보이는 짧은 오류 문구. 오류 메시지 원문(요청 정보가 섞일 수 있음)은 쓰지 않는다. */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'offline':
      case 'proxy-unreachable':
      case 'timeout':
        return '연결할 수 없어요';
      case 'rate-limited':
      case 'token-throttled':
        return '잠시 후 다시 불러올게요';
    }
  }
  return '불러오지 못했어요';
}

/** 초과수익의 지수: 벤치마크가 자동이면 종목 시장(KOSDAQ이 아니면 KOSPI). */
export function indexForMeta(meta: StockMeta | undefined, benchmark: Settings['benchmark']): IndexName {
  if (benchmark !== 'AUTO') return benchmark;
  return meta?.market === 'KOSDAQ' ? 'KOSDAQ' : 'KOSPI';
}

function faultOf(e: unknown, at: number): LoadFault | undefined {
  if (!(e instanceof ApiError)) return undefined;
  return e.retryAfterMs === undefined ? { code: e.code, at } : { code: e.code, at, retryAfterMs: e.retryAfterMs };
}

const NO_INDEX: ExcessIndex = { series: null, until: null };
const lastBarT = (s: LoadedSeries): number | null => s.candles.at(-1)?.t ?? null;

/**
 * 지금 지수 entry와의 짝. 갱신에 실패했거나(stale) 다시 받는 중(loading)이면 아직 이전 지수라
 * 마지막 봉까지만 쓴다(새 종목 봉을 이전 지수 값으로 이어 붙이지 않게).
 */
const pairOf = (entry: IndexEntry): ExcessIndex =>
  entry.series ? { series: entry.series, until: entry.stale === true || entry.status === 'loading' ? lastBarT(entry.series) : null } : NO_INDEX;

const pick = <T>(rec: Record<string, T>, keys: string[]): Record<string, T> =>
  Object.fromEntries(Object.entries(rec).filter(([k]) => keys.includes(k)));

export function createCompareController(deps: CompareControllerDeps): CompareController {
  const doc = deps.doc ?? (typeof document === 'undefined' ? undefined : document);

  let metas = $state.raw<Record<string, StockMeta>>({});
  let entries = $state.raw<Record<string, SeriesEntry>>({});
  let indexes = $state.raw<Partial<Record<IndexName, IndexEntry>>>({});
  /** 지수별 지금 entry를 만든 조회의 시작 시각. indexes와 함께 바뀐다. */
  let indexAt: Partial<Record<IndexName, number>> = {};
  /**
   * 종목별로 새로 받은 시리즈(computedAt)와 함께 보여 준 지수 짝(`${symbol}|${index}`). 그 시리즈가 stale이 되면
   * 시작 시각과 상관없이 이 짝을 그대로 써서 값이 바뀌지 않게 한다.
   */
  const pairs = new Map<string, { computedAt: number; pair: ExcessIndex }>();
  let quotes = $state.raw<Record<string, Quote>>({});
  let progress = $state.raw<{ done: number; total: number } | null>(null);
  /** 마지막으로 새 시리즈를 받은 시각 */
  let lastOkAt = $state.raw<number | null>(null);

  let query: CompareQuery | null = null;
  /** 시리즈 키(공급자·데이터·기간·거래소)가 바뀔 때마다 올린다. 이전 키의 늦은 결과는 버린다. */
  let generation = 0;
  /** 지금 키의 진행 중인 시리즈 로딩 수 */
  let inflight = 0;
  let lastLoadAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let poller: QuotePoller | null = null;
  let pollerProvider: MarketDataProvider | null = null;
  let destroyed = false;

  const reloadDelay = () => (deps.inSession() ? RELOAD_IN_SESSION_MS : RELOAD_OUTSIDE_MS);
  const hidden = () => doc?.visibilityState === 'hidden';

  // ── 진행률 ──────────────────────────────────────────────
  let total = 0;
  let done = 0;
  function bumpProgress(addTotal: number, addDone: number) {
    total += addTotal;
    done += addDone;
    if (done >= total) {
      total = 0;
      done = 0;
      progress = null;
    } else {
      progress = { done, total };
    }
  }

  // ── 타이머 ──────────────────────────────────────────────
  function clearTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }
  function schedule(delay = reloadDelay()) {
    clearTimer();
    if (destroyed || !query || hidden()) return;
    timer = setTimeout(() => void reload(), delay);
  }
  function onVisibility() {
    if (destroyed) return;
    if (hidden()) {
      clearTimer();
      return;
    }
    const elapsed = deps.now() - lastLoadAt;
    const delay = reloadDelay();
    if (elapsed >= delay) void reload();
    else schedule(delay - elapsed);
  }
  doc?.addEventListener('visibilitychange', onVisibility);

  // ── 메타 ────────────────────────────────────────────────
  /** 공급자가 돌려주지 않은 종목은 메타 없이 남는다(행 오류, 다음 갱신에 다시 받는다). 호출 자체가 실패하면 그 이유를 돌려준다. */
  async function ensureMetas(provider: MarketDataProvider, symbols: string[]): Promise<LoadFault | undefined> {
    const missing = symbols.filter((s) => !metas[s]);
    if (missing.length === 0) return undefined;
    try {
      const list = await provider.getStockMeta(missing);
      if (query?.provider !== provider) return undefined;
      metas = { ...metas, ...Object.fromEntries(list.map((m) => [m.symbol, m])) };
      return undefined;
    } catch (e) {
      // 메타를 못 받은 종목은 행에 오류로 보인다.
      return faultOf(e, deps.now());
    }
  }

  const indexFor = (symbol: string) => indexForMeta(metas[symbol], query?.benchmark ?? 'AUTO');

  // ── 시리즈 ──────────────────────────────────────────────
  async function loadSymbols(symbols: string[], showProgress: boolean): Promise<void> {
    const q = query;
    if (!q || symbols.length === 0) return;
    const g = generation;
    if (showProgress) bumpProgress(symbols.length, 0);
    inflight++;
    try {
      const metaFault = await ensureMetas(q.provider, symbols);
      if (g !== generation) return;
      syncIndexes(false);
      // 새로 보이는 종목은 5초를 기다리지 않고 현재가를 받는다.
      if (showProgress) void poller?.refresh();
      await Promise.all(
        symbols.map(async (symbol) => {
          const meta = metas[symbol];
          let entry: SeriesEntry;
          if (!meta) {
            entry = metaFault ? { series: null, error: META_ERROR, fault: metaFault } : { series: null, error: META_ERROR };
          } else {
            try {
              const series = await q.data.snapshots.load({
                provider: q.provider,
                cache: q.data.cache,
                memo: q.data.memo,
                meta,
                period: q.period,
                venueMode: q.venueMode,
                now: deps.now(),
              });
              const fault = series.stale ? faultOf(series.staleError, deps.now()) : undefined;
              entry = fault ? { series, error: null, fault } : { series, error: null };
              if (!series.stale && !destroyed && g === generation) lastOkAt = deps.now();
            } catch (e) {
              const fault = faultOf(e, deps.now());
              entry = fault ? { series: null, error: errorText(e), fault } : { series: null, error: errorText(e) };
            }
          }
          if (destroyed || g !== generation) return;
          if (showProgress) bumpProgress(0, 1);
          // 받는 동안 그룹에서 빠진 종목은 버린다.
          if (query?.symbols.includes(symbol)) {
            entries = { ...entries, [symbol]: entry };
            rememberPairs();
          }
        }),
      );
    } finally {
      // 키가 바뀌면 inflight는 0부터 다시 센다. 이전 키의 로딩은 새 키의 주기 갱신을 막지 않는다.
      if (g === generation && !destroyed) {
        inflight--;
        lastLoadAt = deps.now();
        if (inflight === 0) schedule();
      }
    }
  }

  // ── 지수 ────────────────────────────────────────────────
  function neededIndexes(): IndexName[] {
    if (!query?.excess) return [];
    return [...new Set(query.symbols.filter((s) => metas[s]).map(indexFor))];
  }

  /**
   * 새로 받은 종목 시리즈마다 지금 보여 주는 지수 짝을 (종목, 지수)별로 기억한다. 이 시리즈와 처음 짝짓거나, 지수 조회가 이 시리즈 계산
   * 시각까지 시작한 것(같은 갱신)이면 갱신한다. 그보다 늦게 시작한 지수(다음 갱신)로는 덮어쓰지 않는다: 그 갱신에서
   * 종목이 실패해 stale이 되면 이전에 보이던 값이 바뀌기 때문이다. entries·indexes를 바꾼 직후에 부른다.
   */
  function rememberPairs() {
    for (const [symbol, e] of Object.entries(entries)) {
      const s = e.series;
      if (!s || s.stale || !metas[symbol]) continue;
      // 새 결과로 바뀌면 이전 결과에 묶인 짝(다른 지수 포함)은 더 쓸 일이 없다.
      for (const [key, known] of pairs) {
        if (key.startsWith(`${symbol}|`) && known.computedAt !== s.computedAt) pairs.delete(key);
      }
      const name = indexFor(symbol);
      const key = `${symbol}|${name}`;
      const entry = indexes[name];
      if (!entry?.series) continue;
      const known = pairs.get(key);
      if (known?.computedAt === s.computedAt && (indexAt[name] ?? Infinity) > s.computedAt) continue;
      pairs.set(key, { computedAt: s.computedAt, pair: pairOf(entry) });
    }
    // 그룹에서 빠진 종목의 짝만 지운다. 벤치마크를 바꿔도 다른 지수의 짝은 남겨 둔다(되돌아오면 그 값을 다시 쓴다).
    for (const key of pairs.keys()) {
      if (!entries[key.slice(0, key.indexOf('|'))]) pairs.delete(key);
    }
  }

  function loadIndex(index: IndexName): Promise<void> {
    const q = query;
    if (!q) return Promise.resolve();
    const g = generation;
    const prev = indexes[index];
    const at = deps.now();
    // 받는 동안에도 이전 지수가 stale이었다는 사실을 유지한다(안내·짝짓기가 깜박이지 않게).
    indexes = { ...indexes, [index]: { status: 'loading', series: prev?.series ?? null, ...(prev?.stale ? { stale: true } : {}) } };
    indexAt = { ...indexAt, [index]: at };
    rememberPairs();
    const settle = (entry: IndexEntry) => {
      if (destroyed || g !== generation) return;
      indexes = { ...indexes, [index]: entry };
      indexAt = { ...indexAt, [index]: at };
      rememberPairs();
    };
    return loadIndexSeries({ provider: q.provider, cache: q.data.cache, index, period: q.period, now: at }).then(
      (series) => settle(series ? { status: 'ok', series } : { status: 'null', series: null }),
      // 한 번 받은 지수가 있으면 갱신 실패로 초과수익을 끄지 않는다(이전 지수를 그대로 쓴다).
      () => settle(prev?.series ? { status: 'ok', series: prev.series, stale: true } : { status: 'failed', series: null }),
    );
  }

  /** 필요한데 아직 없는 지수를 받는다. force면 필요한 지수를 모두 다시 받는다. */
  function syncIndexes(force: boolean): Promise<void>[] {
    return neededIndexes()
      .filter((i) => force || !indexes[i])
      .map(loadIndex);
  }

  // ── 현재가 ──────────────────────────────────────────────
  function venueOf(provider: MarketDataProvider, symbol: string) {
    return quoteVenue(provider.capabilities.venues, query?.venueMode ?? 'AUTO', metas[symbol], deps.sessions(), deps.now());
  }

  function ensurePoller(provider: MarketDataProvider) {
    if (pollerProvider === provider) return;
    poller?.stop();
    pollerProvider = provider;
    poller = createQuotePoller({
      provider,
      symbols: () => (query ? query.symbols.filter((s) => metas[s]) : []),
      venue: (s) => venueOf(provider, s),
      inSession: deps.inSession,
      intervalMs: deps.quoteIntervalMs,
      doc,
      onQuotes(list) {
        if (destroyed || query?.provider !== provider) return;
        // 조회하는 동안 거래소 모드나 종목이 바뀌었으면 그 시세는 버린다.
        const fresh = list.filter((q) => query?.symbols.includes(q.symbol) && q.venue === venueOf(provider, q.symbol));
        if (fresh.length > 0) quotes = { ...quotes, ...Object.fromEntries(fresh.map((q) => [q.symbol, q])) };
      },
    });
    poller.start();
  }

  async function reload(): Promise<void> {
    clearTimer();
    if (destroyed || !query) return;
    if (inflight > 0) return;
    await Promise.all([loadSymbols(query.symbols, false), ...syncIndexes(true)]);
  }

  return {
    get metas() {
      return metas;
    },
    get entries() {
      return entries;
    },
    get indexes() {
      return indexes;
    },
    get quotes() {
      return quotes;
    },
    get progress() {
      return progress;
    },
    get lastOkAt() {
      return lastOkAt;
    },
    get issue() {
      // entries를 먼저 읽어 둔다: 첫 렌더(아직 query 없음)에도 반응형 의존성이 생기게.
      const all = entries;
      const symbols = query?.symbols ?? [];
      const current = symbols.flatMap((s) => (all[s] ? [all[s]] : []));
      const worst = dominantFault(current.flatMap((e) => (e.fault ? [e.fault] : [])));
      if (!worst) return null;
      const allFailed = current.length === symbols.length && current.every((e) => e.series === null || e.series.stale);
      return { ...worst, allFailed, lastOkAt };
    },

    setQuery(q) {
      if (destroyed) return;
      const prev = query;
      query = q;
      ensurePoller(q.provider);
      if (prev?.provider !== q.provider) metas = {};
      const keyChanged =
        !prev ||
        prev.provider !== q.provider ||
        prev.data !== q.data ||
        prev.period.unit !== q.period.unit ||
        prev.period.n !== q.period.n ||
        prev.venueMode !== q.venueMode;
      if (keyChanged) {
        clearTimer();
        generation++;
        entries = {};
        quotes = {};
        indexes = {};
        indexAt = {};
        pairs.clear();
        lastOkAt = null;
        inflight = 0;
        total = 0;
        done = 0;
        progress = null;
        void loadSymbols(q.symbols, true);
      } else if (prev.symbols.join() !== q.symbols.join()) {
        entries = pick(entries, q.symbols);
        rememberPairs();
        quotes = pick(quotes, q.symbols);
        void loadSymbols(
          q.symbols.filter((s) => !prev.symbols.includes(s)),
          true,
        );
      }
      syncIndexes(false);
    },

    async refresh() {
      await Promise.all([reload(), poller?.refresh()]);
    },

    indexFor,

    excessIndex(symbol, index) {
      // 반응형 상태를 먼저 읽어 둔다(지수·종목이 바뀌면 다시 계산되게).
      const entry = indexes[index];
      const series = entries[symbol]?.series;
      if (!series) return NO_INDEX;
      const known = pairs.get(`${symbol}|${index}`);
      const remembered = known && known.computedAt === series.computedAt ? known.pair : null;
      // 이전 결과(stale)는 그 결과를 새로 보여 줄 때 기억한 짝을 그대로 쓴다. 없으면 계산하지 않는다.
      if (series.stale) return remembered ?? NO_INDEX;
      // 새 결과라도 지금 지수가 이 결과보다 늦게 시작한 조회(다음 갱신)의 것이면, 같은 갱신의 종목이 올 때까지
      // 기억한 짝을 쓴다(지수가 먼저 도착해도 이전 종목 값이 움직였다 돌아오지 않게).
      if (remembered && (indexAt[index] ?? -Infinity) > series.computedAt) return remembered;
      return entry ? pairOf(entry) : NO_INDEX;
    },

    destroy() {
      destroyed = true;
      clearTimer();
      poller?.stop();
      doc?.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
