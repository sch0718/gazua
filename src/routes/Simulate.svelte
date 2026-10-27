<script lang="ts">
  // 시뮬레이션 화면. 전략을 고르지 않았으면 목록, 골랐으면 편집과 결과.
  // 좁은 화면은 실행하면 결과가 편집을 대신하고(머리줄 `규칙`↔`결과`로 오감), PC(≥1024)는 좌우로 둘 다 보인다.
  // 화면이 바뀌어 누른 버튼이 사라지면 포커스를 옮긴다: 실행 → 결과 자리, 취소 → 실행 버튼, 구역 없는 규칙 고치기 → 이름 칸(좁은 화면).
  import { onDestroy, onMount, tick, untrack, type Snippet } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { hasMacroFormat } from '../lib/marketData/format';
  import { openMarketData, type MarketDataInfo, type MarketDataStore, type MarketSector, type MarketThemeSummary } from '../lib/marketData/store';
  import type { UniverseItem } from '../lib/data/universe';
  import type { Basket } from '../lib/screen/baskets';
  import { usesMacro } from '../lib/screen/precompute';
  import type { MacroSeriesKey, SelectionCriteria } from '../lib/screen/types';
  import { createValidationController, type WorkerLike } from '../lib/screen/validationController.svelte';
  import type { Strategy } from '../lib/sim/types';
  import { strategyIssues, type Issue } from '../lib/sim/validate';
  import type { App } from '../lib/state/app.svelte';
  import { runIssueAction } from '../lib/ui/compare/loadIssue';
  import { showSnackbar } from '@sch0718/ui-svelte';
  import Layout from '../lib/ui/Layout.svelte';
  import Rail from '../lib/ui/Rail.svelte';
  import { sharedUniverse } from '../sheets/universeSource';
  import CriteriaEditor from '../lib/ui/screen/CriteriaEditor.svelte';
  import CriteriaList from '../lib/ui/screen/CriteriaList.svelte';
  import MarketDataNotice from '../lib/ui/screen/MarketDataNotice.svelte';
  import { dataAgeDays, finRunSnap, flowRunSnap, lastResultSummary, type FinRunSnap, type FlowRunSnap, type LastResult } from '../lib/ui/screen/screenText';
  import ValidationResult from '../lib/ui/screen/ValidationResult.svelte';
  import ValidationRun from '../lib/ui/screen/ValidationRun.svelte';
  import SimulateTabs, { type SimulateTab } from '../lib/ui/screen/SimulateTabs.svelte';
  import RunPanel from '../lib/ui/simulate/RunPanel.svelte';
  import { createRunController } from '../lib/ui/simulate/runController.svelte';
  import StrategyEditor from '../lib/ui/simulate/StrategyEditor.svelte';
  import StrategyList from '../lib/ui/simulate/StrategyList.svelte';
  import { rulesChanged } from '../lib/ui/simulate/strategyActions.svelte';

  let {
    app,
    barEnd,
    marketData = openMarketData(),
    makeWorker,
    loadItems = sharedUniverse,
    now = Date.now,
  }: {
    app: App;
    barEnd: Snippet<[boolean]>;
    /** 가져온 시장 데이터(선정 기준 탭). 테스트는 가짜를 넣는다 */
    marketData?: Pick<MarketDataStore, 'info' | 'sectors'> & Partial<Pick<MarketDataStore, 'themes' | 'load'>>;
    /** 검증 Worker 만들기. 테스트는 가짜를 넣는다 */
    makeWorker?: () => WorkerLike;
    /** 종목 이름표(오늘 기준 선별·선정 이력). 테스트는 가짜를 넣는다 */
    loadItems?: () => Promise<UniverseItem[]>;
    now?: () => number;
  } = $props();

  const strategy = $derived(app.strategies.find((s) => s.id === app.route.strategyId) ?? null);

  // 결과는 이 컨트롤러 메모리에만 있다(경로를 떠나면 버린다).
  const ctl = createRunController({
    get provider() {
      return app.provider;
    },
    get watchlists() {
      return app.watchlists;
    },
  });
  const wideQuery = typeof matchMedia === 'function' ? new MediaQuery('min-width: 1024px') : null;
  const wide = $derived(wideQuery?.current ?? false);
  // 폰 폭(<600)에서는 앱 바에 상태 칩을 그리지 않는다(제목·`규칙`/`결과`·아이콘 2개가 들어가야 한다).
  const compactQuery = typeof matchMedia === 'function' ? new MediaQuery('max-width: 599px') : null;
  const compact = $derived(compactQuery?.current ?? false);
  let showResult = $state(false);
  // 편집기의 최신 작업본. 오래된 결과 비교와 `다시 실행`·`다시 시도`가 이걸 쓴다(편집기가 내려가도 남는다).
  let draft = $state.raw<Strategy | null>(null);
  // 좁은 화면도 `규칙`에서 고친 뒤 `결과`로 돌아오면 오래된 결과다
  const stale = $derived(ctl.state.kind === 'done' && draft !== null && rulesChanged(ctl.state.meta.strategy, draft));
  let panel = $state<RunPanel>();
  let editor = $state<StrategyEditor>();
  // 결과의 `규칙 고치기`가 열어 달라는 편집 구역(번호가 바뀔 때마다 한 번 연다)
  let openRequest = $state<{ section: Issue['section']; seq: number } | null>(null);
  let openSeq = 0;

  // 다른 전략·프로필로 가면 실행을 멈추고 편집으로 돌아간다. 저장으로 객체만 바뀐 것은 무시한다(id로 비교).
  const strategyId = $derived(strategy?.id ?? null);
  $effect(() => {
    void strategyId;
    void app.meta.activeProfileId;
    untrack(() => {
      ctl.cancel();
      showResult = false;
      openRequest = null;
    });
  });
  onDestroy(() => ctl.cancel());

  function run(next: Strategy) {
    draft = next;
    ctl.run(next);
    // 좁은 화면에서 편집기(누른 실행 버튼)가 내려가면 결과 자리로 포커스
    const leavingEditor = !wide && !showResult;
    showResult = true;
    if (leavingEditor) void tick().then(() => panel?.focus());
  }
  function edit(section?: Issue['section']) {
    showResult = false;
    // 구역 없이 돌아가면 이전 요청을 지운다 — 좁은 화면에서 편집기가 다시 만들어질 때 옛 요청을 다시 열지 않도록
    openRequest = typeof section === 'string' ? { section, seq: ++openSeq } : null;
  }
  // 결과의 `규칙 고치기`: 구역이 있으면 편집기가 그 구역(막는 경고·머리)으로 포커스를 옮긴다.
  // 구역 없이 좁은 화면에서 편집으로 가면 누른 버튼이 사라지므로 편집 화면 첫 컨트롤(이름 칸)로. 넓은 화면은 그대로 둔다
  function fixRules(section?: Issue['section']) {
    const leavingResult = !wide && showResult;
    edit(section);
    if (leavingResult && typeof section !== 'string') void tick().then(() => editor?.focusName());
  }
  const showRun = () => (showResult = true);
  function cancel() {
    ctl.cancel();
    if (!wide && showResult) void tick().then(() => editor?.focusRun());
    showResult = false;
  }
  // 다시 실행·다시 시도는 편집기의 현재 작업본으로 돌린다. 막는 경고가 있으면 실행하지 않고 그 구역을 연다.
  function retry() {
    if (!draft) return;
    const blocked = strategyIssues(draft, app.watchlists).find((i) => i.blocking);
    if (blocked) edit(blocked.section);
    else run(draft);
  }

  // ── 선정 기준 탭 ──
  const criteriaTab = $derived(app.route.tab === 'criteria');
  const crit = $derived(criteriaTab ? (app.criteria.find((c) => c.id === app.route.criteriaId) ?? null) : null);
  const resultView = $derived(crit !== null && app.route.view === 'result');
  const tabKey: SimulateTab = $derived(criteriaTab ? 'criteria' : 'rules');
  const panelId = `sim-panel-${Math.random().toString(36).slice(2, 9)}`;

  // 검증은 Worker가 돌린다. 결과는 이 컨트롤러 메모리에만 있다(화면을 떠나면 버린다)
  const vctl = createValidationController({ makeWorker: untrack(() => makeWorker) });
  onDestroy(() => vctl.cancel());
  // 선정 기준 탭을 떠나면 Worker(전 종목 데이터와 미리 계산을 쥐고 있다)를 끝낸다. 다음에 쓸 때 다시 만든다
  $effect(() => {
    if (!criteriaTab) untrack(() => vctl.cancel());
  });
  // 결과 화면은 실행할 때의 이름·자본을 쓴다(실행 뒤 기준이 바뀌어도 결과와 맞게)
  let runSnap = $state.raw<{ name: string; capital: number; macro: { used: boolean; lookback: Partial<Record<MacroSeriesKey, number>> }; flow: FlowRunSnap; fin: FinRunSnap } | null>(null);
  // undefined = 아직 읽는 중
  let info = $state.raw<MarketDataInfo | null | undefined>(undefined);
  let sectors = $state.raw<MarketSector[]>([]);
  // undefined = 아직 읽는 중
  let themes = $state.raw<MarketThemeSummary[] | undefined>(undefined);
  // 테마의 종목은 본문에만 있다. 묶음으로 가져올 때만 파일을 읽는다
  async function loadThemeSymbols(code: string): Promise<string[]> {
    const body = await marketData.load?.();
    return body && hasMacroFormat(body) ? (body.themes.find((t) => t.code === code)?.symbols ?? []) : [];
  }
  onMount(() => {
    marketData.info().then(
      (i) => {
        info = i;
        if (i) marketData.sectors().then((x) => (sectors = x), () => {});
        // v1 파일은 테마가 없다(빈 목록). 읽지 못해도 빈 목록으로 둔다
        if (i) {
          if ((i.version ?? 1) < 2 || !marketData.themes) themes = [];
          else marketData.themes().then((x) => (themes = x), () => (themes = []));
        }
      },
      () => (info = null),
    );
  });
  let staleDismissed = $state(false);
  // 닫은 경고는 다음 실행까지 숨긴다
  const ageDays = $derived(info && !staleDismissed ? dataAgeDays(info.collectedAt, now()) : null);
  const dataRange = $derived(info?.range ?? null);
  // 목록 행의 마지막 결과(이 탭에서 실행한 것만, 화면을 떠나면 사라진다)
  let lastResults = $state.raw<Record<string, LastResult>>({});
  let runId = $state<string | null>(null);
  let resultHead = $state<HTMLElement>();
  let criteriaEditor = $state<CriteriaEditor>();

  $effect(() => {
    void app.meta.activeProfileId;
    untrack(() => {
      vctl.cancel();
      runId = null;
      lastResults = {};
    });
  });
  $effect(() => {
    if (vctl.state !== 'done' || !vctl.result || runId === null) return;
    const line = lastResultSummary(vctl.result);
    const id = runId;
    untrack(() => (lastResults = { ...lastResults, [id]: line }));
  });
  // 결과가 나오면 종목 이름을 한 번 읽는다(못 읽으면 코드로 보인다)
  let names = $state.raw<Record<string, string>>({});
  let namesLoaded = false;
  $effect(() => {
    if (vctl.state !== 'done' || namesLoaded) return;
    namesLoaded = true;
    untrack(() =>
      loadItems().then(
        (list) => (names = Object.fromEntries(list.map((i) => [i.s, i.n]))),
        () => (namesLoaded = false),
      ),
    );
  });
  // 실행 없이 결과 주소로 들어오면(새로 고침·다른 기준) 편집으로 돌려보낸다
  $effect(() => {
    if (!resultView || !crit) return;
    if (vctl.state === 'idle' || runId !== crit.id) {
      const id = crit.id;
      untrack(() => app.navigate({ name: 'simulate', tab: 'criteria', criteriaId: id }));
    }
  });

  function selectTab(t: SimulateTab) {
    app.navigate(t === 'criteria' ? { name: 'simulate', tab: 'criteria' } : { name: 'simulate' });
  }
  function runCriteria(c: SelectionCriteria) {
    runId = c.id;
    const fx = c.conditions.macro;
    runSnap = {
      name: c.name,
      capital: c.capital,
      macro: { used: usesMacro(c), lookback: { usdkrw: fx.usdkrw.trend.lookback, wti: fx.wti.trend.lookback } },
      flow: flowRunSnap(c),
      fin: finRunSnap(c),
    };
    staleDismissed = false; // 닫아도 다음 실행에 다시 뜬다
    vctl.run({ criteria: c, strategies: $state.snapshot(app.strategies) as Strategy[], baskets: $state.snapshot(app.baskets) as Basket[] });
    app.navigate({ name: 'simulate', tab: 'criteria', criteriaId: c.id, view: 'result' });
    // 누른 실행 버튼이 사라지므로 결과 자리로 포커스
    void tick().then(() => resultHead?.focus());
  }
  function cancelCriteria() {
    const id = crit?.id;
    vctl.cancel();
    if (!id) return;
    app.navigate({ name: 'simulate', tab: 'criteria', criteriaId: id });
    void tick().then(() => criteriaEditor?.focusRun());
  }
  const goData = () => app.navigate({ name: 'settings', section: 'data' });

  // 경로를 바로잡았다는 안내(없는 전략)는 여기서 한 번만 보여 준다.
  // 프로필 전환 때는 App이 같은 흐름에서 스낵바를 닫으므로, 그것이 끝난 뒤(tick) 띄운다.
  $effect(() => {
    const notice = app.routeNotice;
    if (!notice) return;
    app.clearRouteNotice();
    void tick().then(() => showSnackbar(notice));
  });
</script>

<Layout>
  {#snippet rail()}
    <Rail {app} />
  {/snippet}

  {#snippet bar()}
    {#if crit}
      <button type="button" class="back" aria-label={resultView ? '기준 편집으로' : '선정 기준 목록으로'} onclick={() => (resultView ? cancelCriteria() : app.navigate({ name: 'simulate', tab: 'criteria' }))}>‹</button>
      <span class="title">시뮬레이션</span>
    {:else if strategy}
      <button type="button" class="back" aria-label="전략 목록으로" onclick={() => app.navigate({ name: 'simulate' })}>‹</button>
      <span class="title">시뮬레이션</span>
      <!-- `규칙`↔`결과`는 같은 버튼(이름·동작만 바뀐다): 눌러도 포커스가 남는다 -->
      {#if !wide && (showResult || ctl.state.kind !== 'idle')}
        <button type="button" class="rules" onclick={() => (showResult ? edit() : showRun())}>{showResult ? '규칙' : '결과'}</button>
      {/if}
    {:else}
      <button type="button" class="back" aria-label="비교로 돌아가기" onclick={() => app.navigate({ name: 'compare' })}>‹</button>
      <span class="title">시뮬레이션</span>
    {/if}
    {@render barEnd(compact)}
  {/snippet}

  {#snippet main()}
    {#key app.meta.activeProfileId}
      {#if crit}
        {#if resultView}
          <div class="result">
            <h2 tabindex="-1" bind:this={resultHead}>검증 결과</h2>
            {#if vctl.state === 'done' && vctl.result}
              <button type="button" class="cancel" onclick={cancelCriteria}>기준 고치기</button>
              <ValidationResult {app} result={vctl.result} {names} criteriaName={runSnap?.name ?? crit.name} capital={runSnap?.capital ?? crit.capital} theme={app.settings.theme} macro={runSnap?.macro} flow={runSnap?.flow ?? flowRunSnap(crit)} fin={runSnap?.fin ?? finRunSnap(crit)} />
            {:else}
              <ValidationRun running={vctl.state === 'running'} progress={vctl.progress} error={vctl.error} oncancel={cancelCriteria} onfix={cancelCriteria} />
            {/if}
          </div>
        {:else if info !== undefined}
          <!-- 기준마다 편집기를 새로 만든다 -->
          {#key crit.id}
            <div class="notice">
              <MarketDataNotice {info} {ageDays} onimport={goData} ondismiss={() => (staleDismissed = true)} />
            </div>
            <CriteriaEditor
              bind:this={criteriaEditor}
              {app}
              criteria={crit}
              {info}
              {sectors}
              {themes}
              {loadThemeSymbols}
              {loadItems}
              preview={(input) => vctl.preview(input)}
              onRun={runCriteria}
            />
          {/key}
        {/if}
      {:else if strategy}
        <!-- 전략마다 편집기를 새로 만든다. 좁은 화면에서 결과로 바꾸면 편집기는 저장하고 내려간다. -->
        {#key strategy.id}
          <div class="sim" class:split={wide}>
            {#if wide || !showResult}
              <div class="pane">
                <StrategyEditor bind:this={editor} {app} {strategy} onRun={run} ondraft={(d) => (draft = d)} {openRequest} />
              </div>
            {/if}
            {#if wide || showResult}
              <div class="pane">
                <RunPanel
                  bind:this={panel}
                  state={ctl.state}
                  colorConvention={app.settings.colorConvention}
                  theme={app.settings.theme}
                  {stale}
                  onEdit={fixRules}
                  onRetry={retry}
                  onCancel={cancel}
                  onIssueAction={(target) => runIssueAction(app, target)}
                />
              </div>
            {/if}
          </div>
        {/key}
      {:else}
        <SimulateTabs tab={tabKey} onselect={selectTab} {panelId} />
        <div role="tabpanel" id={panelId} aria-label={criteriaTab ? '선정 기준' : '매매 규칙'}>
          {#if criteriaTab}
            {#if info !== undefined}
              <div class="notice">
                <MarketDataNotice info={info} {ageDays} onimport={goData} ondismiss={() => (staleDismissed = true)} />
              </div>
            {/if}
            <CriteriaList {app} {dataRange} {lastResults} {sectors} />
          {:else}
            <StrategyList {app} />
          {/if}
        </div>
      {/if}
    {/key}
  {/snippet}
</Layout>

<style>
  .back {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    font-size: 24px;
    color: var(--t2);
    flex: none;
  }
  .back:hover {
    background: var(--surface2);
  }
  .title {
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1 1 auto;
    min-width: 0;
  }
  .rules {
    flex: none;
    min-height: 44px;
    padding: 0 12px;
    border-radius: 12px;
    font-weight: 700;
    color: var(--accent);
  }
  .rules:hover {
    background: var(--surface2);
  }
  .split {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 16px;
    align-items: start;
  }
  .pane {
    min-width: 0;
  }
  .notice {
    max-width: 720px;
    padding: 0 var(--gutter) 8px;
  }
  .notice:empty {
    display: none;
  }
  .result {
    max-width: 720px;
    padding: 4px var(--gutter);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .result h2 {
    margin: 0;
    font-size: 18px;
  }
  .cancel {
    min-height: var(--touch);
    padding: 0 20px;
    border-radius: 12px;
    background: var(--surface);
    font-weight: 700;
    align-self: flex-start;
  }
</style>
