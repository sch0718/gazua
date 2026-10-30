<script lang="ts">
  import { onDestroy, onMount, untrack, type Snippet } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import type { ChartSeriesInput } from '../lib/chart/lineData';
  import { seriesColor } from '../lib/chart/CompareChart.svelte';
  import { trendClass } from '../lib/ui/format';
  import { indexAvailabilityFor, type LoadedSeries } from '../lib/data/candleService';
  import { METRICS, metricAvailability } from '../lib/data/metricRegistry';
  import type { Point } from '../lib/data/metrics';
  import { baseDateFor, indexBaseFor, metricPoints } from '../lib/data/seriesMetrics';
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
  import { issueView, runIssueAction } from '../lib/ui/compare/loadIssue';
  import { Banner } from '@sch0718/ui-svelte';
  import { createCompareController, indexForMeta } from '../lib/ui/compare/compareController.svelte';
  import { formatMetricValue, INDEX_BASE_MISSING_NOTE, indexStaleNote, kstHHMM, monthDay, periodLabel, rvolBaseNote } from '../lib/ui/compare/compareText';
  import { EXAMPLE_SYMBOLS, chartTradingDate, indexLoadOf, staleIndexAt, lastSessionEnd, marketAutoVenue, openDaysOf, sessionsOn } from '../lib/ui/compare/compareView';
  import { PULL_THRESHOLD_PX, pullToRefresh } from '../lib/ui/compare/pullToRefresh';
  import { buildRows, isSuspended, orderRows, rowSeries, sortRows } from '../lib/ui/compare/rows';
  import { effectiveVenueMode, nextVenueMode } from '../lib/ui/compare/venue';
  import { showSnackbar } from '@sch0718/ui-svelte';
  import Layout from '../lib/ui/Layout.svelte';
  import Rail from '../lib/ui/Rail.svelte';
  import { bindShortcuts } from '../lib/ui/shortcuts';
  import StockDetailSheet from '../sheets/StockDetailSheet.svelte';
  import { canShare, openShare, type CardCapture } from '../lib/share/shareStore.svelte';
  import { built, shareTitle } from '../lib/share/snapshot';
  import { compareSnapshot } from '../lib/share/compact';
  import { cardAlt, compareCardLine, compareCardText, composeCard, readCardColors } from '../lib/share/cardImage';

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
  const mode = $derived<'intraday' | 'daily'>(period.unit === 'D' ? 'intraday' : 'daily');
  // 1일 차트는 가장 최근 거래일의 분봉 격자를 쓴다. 다른 거래일의 결과(갱신 실패로 남은 전 거래일)는 그리지 않는다.
  const tradingDate = $derived(chartTradingDate(loaded, mode));
  const onChartDay = (s: { tradingDate: string }) => mode !== 'intraday' || s.tradingDate === tradingDate;
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
  // 지수 갱신에 실패해 이전 지수로 초과수익을 계산하는 중이면 그 지수가 언제 기준인지 알린다.
  const indexStaleAtValue = $derived(metric === 'excess' ? staleIndexAt(items.map((i) => ctl.indexes[indexOf(i.symbol)])) : null);
  // 지수 일봉에 종목 기준일의 종가가 없으면 그 종목의 초과수익은 비워 두고(기준이 섞이지 않게), 이유를 알린다.
  const indexBaseMissing = $derived(
    metric === 'excess' &&
      items.some((i) => {
        const series = ctl.entries[i.symbol]?.series;
        const pair = series ? ctl.excessIndex(i.symbol, indexOf(i.symbol)) : null;
        return !!series && !!pair?.series && indexBaseFor(series, pair.series) === null;
      }),
  );
  // 1일 RVOL 분모가 분봉과 다른 거래소(KRX)의 일평균인 종목이 있으면 알린다.
  const rvolNote = $derived(rvolBaseNote({ metric, period, series: loaded.filter(onChartDay) }));
  const metricDef = $derived(METRICS.find((m) => m.id === metric) ?? METRICS[0]);
  const unit = $derived(metricDef.unit === '' ? '%' : metricDef.unit);

  // 차트 입력은 불러온 상태에서만 만든다(시계·현재가와 무관하게 참조가 유지되도록).
  const pointsOf = (symbol: string, series: LoadedSeries) => {
    // 초과수익은 종목 시리즈와 같은 시점의 지수로만 계산한다(새 종목 봉 + 이전 지수, 이전 종목 봉 + 새 지수를 섞지 않는다).
    const pair = metric === 'excess' ? ctl.excessIndex(symbol, indexOf(symbol)) : null;
    return metricPoints(series, metric, { index: pair?.series ?? null, indexUntil: pair?.until ?? null, period });
  };
  const pointsBySymbol = $derived.by(() => {
    const out: Record<string, Point[] | null> = {};
    for (const i of items) {
      const series = ctl.entries[i.symbol]?.series;
      out[i.symbol] = series ? pointsOf(i.symbol, series) : null;
    }
    return out;
  });
  const chartSeries = $derived<ChartSeriesInput[]>(
    items.flatMap((i) => {
      const series = ctl.entries[i.symbol]?.series;
      const points = pointsBySymbol[i.symbol];
      if (!series || !points || !onChartDay(series)) return [];
      const label = ctl.metas[i.symbol]?.name ?? i.symbol;
      // 일봉 차트의 거래정지 띠는 지표 값이 아니라 실제 봉이 있는 날로 판정한다.
      const bars = mode === 'daily' ? series.candles.map((c) => c.t) : undefined;
      // 지금 정지인 종목은 마지막 봉 뒤에도 정지 띠를 낸다(행 배지와 같은 규칙).
      const suspended = isSuspended(ctl.metas[i.symbol], effectiveVenueMode(venues, venueMode));
      return [{ id: i.symbol, slot: i.colorSlot, label, points, intervals: series.intervals, hidden: i.hidden, bars, suspended }];
    }),
  );
  const chartSessions = $derived(tradingDate && mode === 'intraday' ? sessionsOn(tradingDate, today, sessions) : []);
  const openDays = $derived(mode === 'daily' ? openDaysOf(loaded) : []);
  const markers = $derived(tradingDate !== null && fetchPlanFor(period, tradingDate).markers);
  const baseDate = $derived.by(() => {
    const first = loaded.find(onChartDay);
    // 기준가를 낸 일봉(NXT 모드에서도 KRX)의 날짜. 없는 결과에서만 예전처럼 시리즈 일봉에서 구한다.
    if (!first) return null;
    return first.baseDate !== undefined ? first.baseDate : baseDateFor(first, period);
  });
  const closeAt = $derived(tradingDate ? lastSessionEnd(sessionsOn(tradingDate, today, sessions)) : null);

  // ── 오류 안내(스펙 11절) ─────────────────────────────────
  // 연결·키 문제는 상단 배너(해결 행동 버튼), 호출 한도는 툴바 안내, 종목 단위 오류는 그 행에만.
  const issueNotice = $derived(issueView(ctl.issue, now));
  // 지금 그룹의 종목을 하나도 새로 받지 못했으면 장중이어도 ● 실시간을 보이지 않는다.
  const loadFailed = $derived(
    items.length > 0 &&
      items.every((i) => {
        const e = ctl.entries[i.symbol];
        return e !== undefined && (e.series === null || e.series.stale);
      }),
  );
  // 다시 온라인이 되면 바로 새로 받는다.
  onMount(() => {
    const online = () => void ctl.refresh();
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  });

  // ── 스크럽과 리더보드 ───────────────────────────────────
  let scrubT = $state<number | null>(null);
  // 리더보드 순서 고정: 스크럽 중이면 스크럽을 시작할 때의 순서, 아니면 키보드 포커스가 목록에 들어올 때의 순서(D2).
  // 값은 계속 바뀌고, 고정 순서에 없는 종목은 끝에 붙는다(sortRows).
  let scrubOrder = $state.raw<string[] | null>(null);
  let focusOrder = $state.raw<string[] | null>(null);
  const frozenOrder = $derived(scrubOrder ?? focusOrder);

  // 행 값과 가격은 같은 5초 시세로 계산한다(스펙 4.4·7.2-6). 차트·데이터 표는 원래 캔들 그대로.
  // 1초 시계는 구독하지 않는다. withQuote는 now의 날짜만 보므로 날짜나 시세가 바뀔 때만 시각을 새로 읽는다.
  const rowNow = $derived.by(() => {
    void today;
    void ctl.quotes;
    return untrack(() => now);
  });
  const rowOpts = $derived({ scrubT, chartDate: mode === 'intraday' ? tradingDate : null, now: rowNow });
  // 행마다 rowSeries를 한 번만 계산해 값(points)과 가격(buildRows)이 함께 쓴다.
  const quotedBySymbol = $derived.by(() => {
    const out: Record<string, ReturnType<typeof rowSeries> | null> = {};
    for (const i of items) {
      const series = ctl.entries[i.symbol]?.series;
      out[i.symbol] = series ? rowSeries(series, ctl.quotes[i.symbol], rowOpts) : null;
    }
    return out;
  });
  const rowPointsBySymbol = $derived.by(() => {
    const out: Record<string, Point[] | null> = {};
    for (const i of items) {
      const series = ctl.entries[i.symbol]?.series;
      const quoted = quotedBySymbol[i.symbol];
      out[i.symbol] = quoted && quoted !== series ? pointsOf(i.symbol, quoted) : pointsBySymbol[i.symbol];
    }
    return out;
  });

  const rows = $derived(
    buildRows(
      items.map((item) => {
        const e = ctl.entries[item.symbol];
        return {
          item,
          meta: ctl.metas[item.symbol],
          series: e?.series ?? null,
          error: e?.error ?? null,
          points: rowPointsBySymbol[item.symbol],
          quote: ctl.quotes[item.symbol],
          quoted: quotedBySymbol[item.symbol],
        };
      }),
      { ...rowOpts, venueMode: effectiveVenueMode(venues, venueMode) },
    ),
  );
  const scrubLabel = $derived(scrubT === null ? null : mode === 'intraday' ? kstHHMM(scrubT) : monthDay(kstDate(scrubT)));

  /** 스크럽을 시작할 때 보이던 순서를 고정한다(값이 바뀌어도 행이 튀지 않게). */
  function oncrosshair(t: number | null) {
    if (t === null) {
      scrubT = null;
      scrubOrder = null;
      return;
    }
    if (scrubT === null) scrubOrder = sortRows(rows, focusOrder).map((r) => r.symbol);
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
    if (from < 0 || to < 0) return;
    // 리더보드가 내 순서일 때만 온다. 그 순서는 고정 없이 그룹 순서 그대로라 focusOrder를 다시 잡지 않는다.
    saveGroup(moveItem(group, from, to));
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

  // 상세에서 지우거나 옮기면 그 행이 사라진다. 리더보드에서 몇 번째였는지 기억해 두었다가
  // 같은 자리의 다음 행(없으면 `＋ 종목 추가`)으로 포커스를 옮긴다. 시트·오른쪽 패널 모두 같다.
  let board = $state<ReturnType<typeof Leaderboard>>();
  let selectedIndex = -1;
  const readSelectedIndex = (symbol: string) => {
    const i = board?.indexOf(symbol) ?? -1;
    if (i >= 0) selectedIndex = i;
  };
  // 그룹 종목이 바뀔 때(지우기·옮기기) 행이 사라지기 전의 리더보드 DOM에서 다시 읽는다(pre: DOM을 고치기 전).
  $effect.pre(() => {
    void items;
    const s = untrack(() => selected);
    if (s) untrack(() => readSelectedIndex(s));
  });

  function select(symbol: string) {
    selected = symbol;
    readSelectedIndex(symbol);
    if (!wide) openSheet = 'detail';
  }
  // 마지막 종목이었으면 리더보드가 통째로 사라지므로 빈 상태의 `＋ 종목 추가`로.
  const emptyAddButton = () => document.querySelector<HTMLElement>('[data-empty-add]');
  const detailReturnFocus = () => {
    const el = board?.rowButtonAt(selectedIndex);
    return el?.isConnected ? el : emptyAddButton();
  };
  // 되돌리면 그 행으로. 0개에서 되돌리면 리더보드가 다시 그려진 뒤의 새 인스턴스에서 찾는다.
  // 다른 시트가 열려 있으면 그 행은 aria-modal 뒤에 있고, 다른 그룹을 보고 있으면 같은 심볼이어도 다른 그룹의 행이니 옮기지 않는다.
  const detailRestoredFocus = (symbol: string, groupId: string) =>
    openSheet === null && group?.id === groupId ? board?.rowButtonFor(symbol) : null;

  // ── 단축키 ─────────────────────────────────────────────
  // 시트가 열려 있으면 시트가 키를 쓴다(Esc·Tab). 단축키는 닫혀 있을 때만 동작한다.
  // 이 화면 밖의 모달(메뉴 처음 안내 등)이 열려 있어도 쉰다. 모달 위에 시트를 겹쳐 열지 않게.
  const modalOpen = () => document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"]') !== null;
  function whenClosed(run: () => void) {
    return () => {
      if (openSheet === null && !modalOpen()) run();
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
      help: whenClosed(() => (openSheet = 'help')),
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

  let chartPanel = $state<ReturnType<typeof ChartPanel>>();
  const canShareCompare = $derived(canShare() && group !== undefined && items.some((i) => !i.hidden));

  /** 시세가 보이는 화면 캡처(설계 4.3). 불러오는 중이면 반쯤 그린 차트를 보내지 않는다 */
  function captureCard(): CardCapture | null {
    if (!group || ctl.progress) return null;
    const chart = chartPanel?.screenshot();
    if (!chart) return null;
    const ordered = orderRows(rows.filter((r) => !r.hidden), app.settings.boardOrder, null).slice(0, 5);
    const cells = ordered.map((r) => {
      const series = chartSeries.find((s) => s.id === r.symbol);
      const tone = unit === '%' ? trendClass(r.value, app.settings.colorConvention) : '';
      return {
        name: r.name,
        value: r.value === null ? '—' : formatMetricValue(r.value, unit),
        tone: tone || ('flat' as const),
        swatch: series ? seriesColor(series.slot) : undefined,
      };
    });
    const at = ctl.lastOkAt ?? now;
    const text = compareCardText({ title: shareTitle(group.name), period: periodLabel(period), metric: metricDef.label, at, rows: cells, provider: app.provider.id });
    return { canvas: composeCard(chart, text, readCardColors(document.documentElement)), alt: cardAlt(text, '비교 화면'), line: compareCardLine(cells.slice(0, 2), at) };
  }

  function shareCompare() {
    const g = group;
    if (!g) return;
    openShare({ kind: 'compare', name: g.name, profileId: app.meta.activeProfileId, build: () => built(compareSnapshot(g, { ...app.settings, metric })), capture: captureCard });
  }
</script>

<Layout side={items.length > 0 ? side : undefined} barWrap>
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
    {#if canShareCompare}<button type="button" class="share" onclick={shareCompare}>공유</button>{/if}
    <span class="title" data-landing-title tabindex="-1">{group?.name ?? '가즈아'}</span>
    {@render barEnd()}
  {/snippet}

  {#snippet main()}
    <div class="compare" data-sheet={openSheet} use:pullToRefresh={{ onrefresh: refreshNow, onpull: (d) => (pull = d) }}>
      {#if issueNotice?.kind === 'banner'}
        {@const action = issueNotice.action}
        <Banner
          message={issueNotice.text}
          tone={issueNotice.tone}
          actionLabel={action?.label}
          onaction={action ? () => runIssueAction(app, action.target) : undefined}
        />
      {/if}
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
          {loadFailed}
          lastOkAt={ctl.lastOkAt}
        />
        {#if fallbackNote}
          <p class="fallback" role="status">{fallbackNote}</p>
        {/if}
        {#if indexStaleAtValue !== null}
          <p class="fallback" role="status">{indexStaleNote(indexStaleAtValue, now)}</p>
        {/if}
        {#if indexBaseMissing}
          <p class="fallback" role="status">{INDEX_BASE_MISSING_NOTE}</p>
        {/if}
        {#if rvolNote}
          <p class="fallback" role="status">{rvolNote}</p>
        {/if}
        <div class="chart-slot">
          <ChartPanel bind:this={chartPanel}
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
          {#if issueNotice?.kind === 'toolbar'}
            <p class="slow" role="status">{issueNotice.text}</p>
          {/if}
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
    bind:this={board}
    {rows}
    {frozenOrder}
    boardOrder={app.settings.boardOrder}
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
    onfocuswithin={(order) => (focusOrder = order)}
    onorderchange={(o) => app.updateSettings({ boardOrder: o })}
  />
  {#if wide && group}
    {#if selected && items.some((i) => i.symbol === selected)}
      {@const s = selected}
      {@const series = ctl.entries[s]?.series ?? null}
      <StockDetailSheet
        inline
        {app}
        groupId={group.id}
        symbol={s}
        meta={ctl.metas[s]}
        {series}
        {now}
        {sessions}
        {isOpenToday}
        returnFocus={detailReturnFocus}
        restoredFocus={detailRestoredFocus}
        onclose={() => (selected = null)}
      />
    {:else}
      <p class="pick-hint">리더보드에서 종목을 누르면 여기서 상세를 볼 수 있어요</p>
    {/if}
  {/if}
{/snippet}

<CompareSheets bind:sheet={openSheet} {app} {group} {ctl} {selected} {wide} {metricCtx} {now} {sessions} {isOpenToday} {detailReturnFocus} {detailRestoredFocus} />

<style>
  .share {
    min-height: var(--touch);
    padding: 0 12px;
    border-radius: 12px;
    background: var(--surface2);
    font-weight: 700;
    flex-shrink: 0;
  }
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
  .slow {
    margin: 0;
    padding: 2px var(--gutter);
    font-size: 12.5px;
    color: var(--warn);
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
