<script lang="ts">
  import { onDestroy, onMount, untrack, type Snippet } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import type { ChartSeriesInput } from '../lib/chart/lineData';
  import { indexAvailabilityFor } from '../lib/data/candleService';
  import { METRICS, metricAvailability } from '../lib/data/metricRegistry';
  import type { Point } from '../lib/data/metrics';
  import { baseDateFor, metricPoints } from '../lib/data/seriesMetrics';
  import { fetchPlanFor, stepPeriod } from '../lib/market/periods';
  import type { DaySession } from '../lib/market/sessions';
  import { sessionLabelAt } from '../lib/market/tradable';
  import type { App } from '../lib/state/app.svelte';
  import type { Group } from '../lib/state/schema';
  import { addItem, createGroup, moveItem, toggleHidden } from '../lib/state/watchlist';
  import { kstDate } from '../lib/time/kst';
  import ChartPanel from '../lib/ui/compare/ChartPanel.svelte';
  import DataTable from '../lib/ui/compare/DataTable.svelte';
  import CompareSheets, { type CompareSheet } from '../lib/ui/compare/CompareSheets.svelte';
  import Controls from '../lib/ui/compare/Controls.svelte';
  import EmptyState from '../lib/ui/compare/EmptyState.svelte';
  import GroupTabs from '../lib/ui/compare/GroupTabs.svelte';
  import Headline from '../lib/ui/compare/Headline.svelte';
  import Leaderboard from '../lib/ui/compare/Leaderboard.svelte';
  import { createCompareController, indexForMeta } from '../lib/ui/compare/compareController.svelte';
  import { kstHHMM, monthDay, periodLabel } from '../lib/ui/compare/compareText';
  import { EXAMPLE_SYMBOLS, indexLoadOf, lastSessionEnd, marketAutoVenue, openDaysOf, sessionsOn } from '../lib/ui/compare/compareView';
  import { PULL_THRESHOLD_PX, pullToRefresh } from '../lib/ui/compare/pullToRefresh';
  import { buildRows, sortRows } from '../lib/ui/compare/rows';
  import { effectiveVenueMode, nextVenueMode } from '../lib/ui/compare/venue';
  import { showSnackbar } from '../lib/ui/components/snackbarStore.svelte';
  import Layout from '../lib/ui/Layout.svelte';
  import Rail from '../lib/ui/Rail.svelte';
  import { bindShortcuts } from '../lib/ui/shortcuts';
  import StockDetailSheet from '../sheets/StockDetailSheet.svelte';

  // 비교(홈) 화면, 스펙 7.2·7.6. 데이터 흐름은 compareController, 표시 규칙은 compare/*.ts에 있다.
  let {
    app,
    now,
    sessions,
    isOpenToday,
    barEnd,
    wide: wideOverride,
  }: {
    app: App;
    /** 1초마다 바뀌는 현재 시각 */
    now: number;
    /** 오늘 세션(캘린더 반영) */
    sessions: DaySession[];
    isOpenToday: boolean;
    /** 앱 바 오른쪽(상태 칩·설정) */
    barEnd: Snippet;
    /** ≥1024 배치 여부. 없으면 미디어 쿼리로 정한다(테스트에서 고정할 때 쓴다). */
    wide?: boolean;
  } = $props();

  let openSheet = $state<CompareSheet>(null);
  let selected = $state<string | null>(null);
  const wideQuery = typeof matchMedia === 'function' ? new MediaQuery('min-width: 1024px') : null;
  // ≥1024에서는 종목 상세를 시트가 아니라 오른쪽 패널 안에 그린다(스펙 7.6).
  const wide = $derived(wideOverride ?? wideQuery?.current ?? false);

  const inSessionAt = (t: number) => isOpenToday && sessionLabelAt(sessions, t) !== null;
  // 컨트롤러는 시계를 구독하지 않는다(1초마다 다시 계산하지 않게).
  const ctl = createCompareController({
    now: () => untrack(() => now),
    inSession: () => untrack(() => inSessionAt(now)),
    sessions: () => untrack(() => sessions),
  });
  onDestroy(() => ctl.destroy());

  const group = $derived(app.watchlists.groups.find((g) => g.id === app.route.groupId));
  const items = $derived(group?.items ?? []);
  const period = $derived(app.settings.period);
  const venueMode = $derived(app.settings.venueMode);
  const benchmark = $derived(app.settings.benchmark);
  const venues = $derived(app.provider.capabilities.venues);

  $effect(() => {
    const q = {
      provider: app.provider,
      data: app.data,
      symbols: items.map((i) => i.symbol),
      period,
      venueMode,
      excess: app.settings.metric === 'excess',
      benchmark,
    };
    untrack(() => ctl.setQuery(q));
  });

  // 마지막으로 본 그룹을 기억한다.
  $effect(() => {
    const id = group?.id;
    if (id && untrack(() => app.settings.lastGroupId) !== id) untrack(() => app.updateSettings({ lastGroupId: id }));
  });

  // ── 불러온 상태에서 뽑는 값 ──────────────────────────────
  const today = $derived(kstDate(now));
  const loaded = $derived(items.flatMap((i) => ctl.entries[i.symbol]?.series ?? []));
  const tradingDate = $derived(loaded[0]?.tradingDate ?? null);
  const mode = $derived<'intraday' | 'daily'>(period.unit === 'D' ? 'intraday' : 'daily');
  const indexOf = (symbol: string) => indexForMeta(ctl.metas[symbol], benchmark);

  const metricCtx = $derived.by(() => {
    const indexLoad = indexLoadOf(items.map((i) => ctl.indexes[indexOf(i.symbol)]));
    const index = indexAvailabilityFor({
      caps: app.provider.capabilities,
      period,
      tradingDate: tradingDate ?? today,
      today,
      indexLoad,
    });
    const metasKnown = items.some((i) => ctl.metas[i.symbol]);
    const hasShares = !metasKnown || items.some((i) => ctl.metas[i.symbol]?.sharesOutstanding !== undefined);
    return { period, index, hasShares };
  });
  const availability = $derived(metricAvailability(app.settings.metric, metricCtx));
  // 지금 고를 수 없는 지표(지수 없음·발행주식수 없음 등)는 등락률로 보여 주고, 헤드라인 아래에 그 사실과 이유를 알린다.
  const metric = $derived(availability.ok ? app.settings.metric : 'change');
  const fallbackNote = $derived.by(() => {
    if (availability.ok) return null;
    const chosen = METRICS.find((m) => m.id === app.settings.metric)?.label ?? app.settings.metric;
    return `${chosen} 대신 등락률을 보여 줘요 · ${availability.reason}`;
  });
  const metricDef = $derived(METRICS.find((m) => m.id === metric) ?? METRICS[0]);
  const unit = $derived(metricDef.unit === '' ? '%' : metricDef.unit);

  // 차트 입력은 불러온 상태에서만 만든다(시계·현재가와 무관하게 참조가 유지되도록).
  const pointsBySymbol = $derived.by(() => {
    const out: Record<string, Point[] | null> = {};
    for (const i of items) {
      const series = ctl.entries[i.symbol]?.series;
      const index = metric === 'excess' ? (ctl.indexes[indexOf(i.symbol)]?.series ?? null) : null;
      out[i.symbol] = series ? metricPoints(series, metric, { index, period }) : null;
    }
    return out;
  });
  const chartSeries = $derived<ChartSeriesInput[]>(
    items.flatMap((i) => {
      const series = ctl.entries[i.symbol]?.series;
      const points = pointsBySymbol[i.symbol];
      if (!series || !points) return [];
      const label = ctl.metas[i.symbol]?.name ?? i.symbol;
      // 일봉 차트의 거래정지 띠는 지표 값이 아니라 실제 봉이 있는 날로 판정한다.
      const bars = mode === 'daily' ? series.candles.map((c) => c.t) : undefined;
      return [{ id: i.symbol, slot: i.colorSlot, label, points, intervals: series.intervals, hidden: i.hidden, bars }];
    }),
  );
  const chartSessions = $derived(tradingDate && mode === 'intraday' ? sessionsOn(tradingDate, today, sessions) : []);
  const openDays = $derived(mode === 'daily' ? openDaysOf(loaded) : []);
  const markers = $derived(tradingDate !== null && fetchPlanFor(period, tradingDate).markers);
  const baseDate = $derived(loaded[0] ? baseDateFor(loaded[0], period) : null);
  const closeAt = $derived(tradingDate ? lastSessionEnd(sessionsOn(tradingDate, today, sessions)) : null);

  // ── 스크럽과 리더보드 ───────────────────────────────────
  let scrubT = $state<number | null>(null);
  let frozenOrder = $state.raw<string[] | null>(null);

  const rows = $derived(
    buildRows(
      items.map((item) => {
        const e = ctl.entries[item.symbol];
        return {
          item,
          meta: ctl.metas[item.symbol],
          series: e?.series ?? null,
          error: e?.error ?? null,
          points: pointsBySymbol[item.symbol],
          quote: ctl.quotes[item.symbol],
        };
      }),
      { scrubT, venueMode: effectiveVenueMode(venues, venueMode) },
    ),
  );
  const scrubLabel = $derived(scrubT === null ? null : mode === 'intraday' ? kstHHMM(scrubT) : monthDay(kstDate(scrubT)));

  /** 스크럽을 시작할 때의 순서를 고정한다(값이 바뀌어도 행이 튀지 않게). */
  function oncrosshair(t: number | null) {
    if (t === null) {
      scrubT = null;
      frozenOrder = null;
      return;
    }
    if (scrubT === null) frozenOrder = sortRows(rows, null).map((r) => r.symbol);
    scrubT = t;
  }

  // ── 그룹 바꾸기 ────────────────────────────────────────
  function saveGroup(g: Group) {
    const w = app.watchlists;
    app.setWatchlists({ ...w, groups: w.groups.map((x) => (x.id === g.id ? g : x)) });
  }

  function reorder(symbol: string, target: string) {
    if (!group) return;
    const from = group.items.findIndex((i) => i.symbol === symbol);
    const to = group.items.findIndex((i) => i.symbol === target);
    if (from >= 0 && to >= 0) saveGroup(moveItem(group, from, to));
  }

  function addGroup() {
    const w = createGroup(app.watchlists, `새 그룹 ${app.watchlists.groups.length + 1}`);
    app.setWatchlists(w);
    app.navigate({ name: 'compare', groupId: w.groups[w.groups.length - 1].id });
  }

  /** 빈 그룹을 반도체 대형주 4종으로 채운다. 그룹이 하나도 없으면 `반도체` 그룹을 만든다. */
  function loadExample() {
    const t = untrack(() => now);
    const fill = (g: Group) => EXAMPLE_SYMBOLS.reduce((acc, s) => addItem(acc, s, t), g);
    if (group) {
      saveGroup(fill(group));
      return;
    }
    const w = createGroup(app.watchlists, '반도체');
    const created = w.groups[w.groups.length - 1];
    app.setWatchlists({ ...w, groups: w.groups.map((x) => (x.id === created.id ? fill(x) : x)) });
    app.navigate({ name: 'compare', groupId: created.id });
  }

  function select(symbol: string) {
    selected = symbol;
    if (!wide) openSheet = 'detail';
  }

  // ── 단축키 ─────────────────────────────────────────────
  // 시트가 열려 있으면 시트가 키를 쓴다(Esc·Tab). 단축키는 닫혀 있을 때만 동작한다.
  function whenClosed(run: () => void) {
    return () => {
      if (openSheet === null) run();
    };
  }
  onMount(() =>
    bindShortcuts(document, {
      search: whenClosed(() => (openSheet = 'add')),
      prevPeriod: whenClosed(() => app.updateSettings({ period: stepPeriod(app.settings.period, -1) })),
      nextPeriod: whenClosed(() => app.updateSettings({ period: stepPeriod(app.settings.period, 1) })),
      metric: whenClosed(() => (openSheet = 'metric')),
      cycleVenue: whenClosed(() => {
        const next = nextVenueMode(app.provider.capabilities.venues, app.settings.venueMode);
        if (next !== effectiveVenueMode(app.provider.capabilities.venues, app.settings.venueMode)) app.updateSettings({ venueMode: next });
      }),
      toggleHidden: whenClosed(() => {
        if (!group || !selected || !items.some((i) => i.symbol === selected)) {
          showSnackbar('먼저 종목을 선택하세요');
          return;
        }
        saveGroup(toggleHidden(group, selected));
      }),
      help: () => {
        if (openSheet === null) openSheet = 'help';
      },
    }),
  );

  // ── 당겨서 새로고침 ────────────────────────────────────
  let pull = $state(0);
  let refreshing = $state(false);
  async function refreshNow() {
    if (refreshing) return;
    refreshing = true;
    try {
      await ctl.refresh();
    } finally {
      refreshing = false;
    }
  }
</script>

<Layout side={items.length > 0 ? side : undefined}>
  {#snippet rail()}
    <Rail {app}>
      <button type="button" class="ritem add" onclick={addGroup}>＋ 새 그룹</button>
      <button type="button" class="ritem add" aria-haspopup="dialog" onclick={() => (openSheet = 'group')}>그룹 관리</button>
      {#if group}
        <div class="rlabel">{group.name} 종목</div>
        {#each group.items as it (it.symbol)}
          <button type="button" class="ritem" class:on={selected === it.symbol} onclick={() => select(it.symbol)}>
            <i class="dot" class:off={it.hidden} style:background="var(--s{it.colorSlot})" aria-hidden="true"></i>
            {ctl.metas[it.symbol]?.name ?? it.symbol}
          </button>
        {/each}
        <button type="button" class="ritem add" onclick={() => (openSheet = 'add')}>＋ 종목 추가</button>
      {/if}
    </Rail>
  {/snippet}

  {#snippet bar()}
    <GroupTabs
      groups={app.watchlists.groups}
      currentId={group?.id}
      onselect={(id) => app.navigate({ name: 'compare', groupId: id })}
      onadd={addGroup}
      onmanage={() => (openSheet = 'group')}
    />
    <span class="title">{group?.name ?? '가즈아'}</span>
    {@render barEnd()}
  {/snippet}

  {#snippet main()}
    <div class="compare" data-sheet={openSheet} use:pullToRefresh={{ onrefresh: refreshNow, onpull: (d) => (pull = d) }}>
      {#if pull > 0 || refreshing}
        <div class="pull" role="status">
          {refreshing ? '새로 불러오는 중' : pull > PULL_THRESHOLD_PX ? '놓으면 새로고침해요' : '당겨서 새로고침'}
        </div>
      {/if}
      {#if items.length === 0}
        <EmptyState onadd={() => (openSheet = 'add')} onexample={loadExample} />
      {:else}
        <Headline
          {period}
          metricLabel={metricDef.label}
          {scrubT}
          {tradingDate}
          {today}
          {baseDate}
          {now}
          inSession={inSessionAt(now)}
          {closeAt}
          anyStale={loaded.some((s) => s.stale)}
        />
        {#if fallbackNote}
          <p class="fallback" role="status">{fallbackNote}</p>
        {/if}
        <div class="chart-slot">
          <ChartPanel
            series={chartSeries}
            {mode}
            sessions={chartSessions}
            {markers}
            {unit}
            {openDays}
            progress={ctl.progress}
            theme={app.settings.theme}
            {oncrosshair}
          />
          <DataTable series={chartSeries} {mode} {unit} metricLabel={metricDef.label} periodLabel={periodLabel(period)} conv={app.settings.colorConvention} />
        </div>
        <div class="controls-slot">
          <Controls
            {period}
            {venueMode}
            {venues}
            autoVenue={isOpenToday ? marketAutoVenue(sessions, now) : null}
            metricLabel={metricDef.label}
            onperiod={(p) => app.updateSettings({ period: p })}
            onvenue={(v) => app.updateSettings({ venueMode: v })}
            onopenmetric={() => (openSheet = 'metric')}
          />
        </div>
      {/if}
    </div>
  {/snippet}
</Layout>

{#snippet side()}
  <Leaderboard
    {rows}
    {frozenOrder}
    {unit}
    conv={app.settings.colorConvention}
    metricLabel={metricDef.label}
    count={items.length}
    {scrubLabel}
    {now}
    onselect={select}
    ontogglehidden={(s) => group && saveGroup(toggleHidden(group, s))}
    onreorder={reorder}
    onopenadd={() => (openSheet = 'add')}
  />
  {#if wide && group}
    {#if selected && items.some((i) => i.symbol === selected)}
      {@const s = selected}
      {@const series = ctl.entries[s]?.series ?? null}
      <StockDetailSheet inline {app} groupId={group.id} symbol={s} meta={ctl.metas[s]} {series} {now} {sessions} {isOpenToday} onclose={() => (selected = null)} />
    {:else}
      <p class="pick-hint">리더보드에서 종목을 누르면 여기서 상세를 볼 수 있어요</p>
    {/if}
  {/if}
{/snippet}

<CompareSheets bind:sheet={openSheet} {app} {group} {ctl} {selected} {wide} {metricCtx} {now} {sessions} {isOpenToday} />

<style>
  .compare {
    display: flex;
    flex-direction: column;
    min-height: 100%;
  }
  .chart-slot {
    order: 2;
  }
  .controls-slot {
    order: 3;
  }
  /* 태블릿 가로·PC: 컨트롤은 차트 위 툴바(스펙 7.6). */
  @media (min-width: 600px) and (orientation: landscape), (min-width: 1024px) {
    .controls-slot {
      order: 1;
    }
  }
  .fallback {
    margin: 2px 0 0;
    padding: 0 var(--gutter);
    font-size: 12.5px;
    color: var(--warn);
  }
  .pull {
    text-align: center;
    font-size: 12px;
    color: var(--t3);
    padding: 6px 0;
  }
  .title {
    display: none;
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    flex: 1;
  }
  @media (min-width: 1024px) {
    .title {
      display: block;
    }
  }
  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    display: block;
    flex: none;
  }
  .dot.off {
    opacity: 0.35;
  }
  .add {
    color: var(--t3);
  }
  .pick-hint {
    padding: 12px;
    color: var(--t3);
    font-size: 13px;
  }
</style>
