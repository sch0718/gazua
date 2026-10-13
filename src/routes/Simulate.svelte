<script lang="ts">
  // 시뮬레이션 화면. 전략을 고르지 않았으면 목록, 골랐으면 편집과 결과.
  // 좁은 화면은 실행하면 결과가 편집을 대신하고(머리줄 `규칙`↔`결과`로 오감), PC(≥1024)는 좌우로 둘 다 보인다.
  // 화면이 바뀌어 누른 버튼이 사라지면 포커스를 옮긴다: 실행 → 결과 자리, 취소 → 실행 버튼, 구역 없는 규칙 고치기 → 이름 칸(좁은 화면).
  import { onDestroy, tick, untrack, type Snippet } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import type { Strategy } from '../lib/sim/types';
  import { strategyIssues, type Issue } from '../lib/sim/validate';
  import type { App } from '../lib/state/app.svelte';
  import { runIssueAction } from '../lib/ui/compare/loadIssue';
  import { showSnackbar } from '../lib/ui/components/snackbarStore.svelte';
  import Layout from '../lib/ui/Layout.svelte';
  import Rail from '../lib/ui/Rail.svelte';
  import RunPanel from '../lib/ui/simulate/RunPanel.svelte';
  import { createRunController } from '../lib/ui/simulate/runController.svelte';
  import StrategyEditor from '../lib/ui/simulate/StrategyEditor.svelte';
  import StrategyList from '../lib/ui/simulate/StrategyList.svelte';
  import { rulesChanged } from '../lib/ui/simulate/strategyActions.svelte';

  let { app, barEnd }: { app: App; barEnd: Snippet<[boolean]> } = $props();

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
    {#if strategy}
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
      {#if strategy}
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
        <StrategyList {app} />
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
</style>
