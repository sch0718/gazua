<script lang="ts">
  // 시뮬레이션 화면. 전략을 고르지 않았으면 목록, 골랐으면 편집(결과는 Task 11이 채운다).
  import type { Snippet } from 'svelte';
  import type { App } from '../lib/state/app.svelte';
  import { showSnackbar } from '../lib/ui/components/snackbarStore.svelte';
  import Layout from '../lib/ui/Layout.svelte';
  import Rail from '../lib/ui/Rail.svelte';
  import StrategyEditor from '../lib/ui/simulate/StrategyEditor.svelte';
  import StrategyList from '../lib/ui/simulate/StrategyList.svelte';

  let { app, barEnd }: { app: App; barEnd: Snippet } = $props();

  const strategy = $derived(app.strategies.find((s) => s.id === app.route.strategyId) ?? null);

  // 경로를 바로잡았다는 안내(없는 전략)는 여기서 한 번만 보여 준다.
  $effect(() => {
    const notice = app.routeNotice;
    if (!notice) return;
    app.clearRouteNotice();
    showSnackbar(notice);
  });
</script>

<Layout>
  {#snippet rail()}
    <Rail {app} />
  {/snippet}

  {#snippet bar()}
    {#if strategy}
      <button type="button" class="back" aria-label="전략 목록으로" onclick={() => app.navigate({ name: 'simulate' })}>‹</button>
      <span class="title">{strategy.name}</span>
    {:else}
      <button type="button" class="back" aria-label="비교로 돌아가기" onclick={() => app.navigate({ name: 'compare' })}>‹</button>
      <span class="title">시뮬레이션</span>
    {/if}
    <span class="spacer"></span>
    {@render barEnd()}
  {/snippet}

  {#snippet main()}
    {#key app.meta.activeProfileId}
      {#if strategy}
        <!-- 전략마다 편집기를 새로 만든다. 실행·결과는 Task 11이 onRun에 잇는다. -->
        {#key strategy.id}
          <StrategyEditor {app} {strategy} onRun={() => {}} />
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
  }
  .spacer {
    flex: 1;
  }
</style>
