<script lang="ts">
  // 도움말: 메뉴 목록(#/help)과 메뉴별 도움말(#/help/:id). 문구와 그림은 build:motion이 만든 것을 그대로 쓴다.
  import { tick, type Snippet } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { HELP_PAGES } from '../lib/help/content';
  import type { App } from '../lib/state/app.svelte';
  import HelpFigure from '../lib/ui/help/HelpFigure.svelte';
  import HelpText from '../lib/ui/help/HelpText.svelte';
  import { showSnackbar } from '@sch0718/ui-svelte';
  import Layout from '../lib/ui/Layout.svelte';
  import Rail from '../lib/ui/Rail.svelte';

  let { app, barEnd }: { app: App; barEnd: Snippet<[boolean]> } = $props();

  const compactQuery = typeof matchMedia === 'function' ? new MediaQuery('max-width: 599px') : null;
  const compact = $derived(compactQuery?.current ?? false);

  const helpId = $derived(app.route.name === 'help' ? app.route.helpId : undefined);
  const index = $derived(HELP_PAGES.findIndex((p) => p.id === helpId));
  const page = $derived(index >= 0 ? HELP_PAGES[index] : null);
  const prev = $derived(index > 0 ? HELP_PAGES[index - 1] : null);
  const next = $derived(index >= 0 && index < HELP_PAGES.length - 1 ? HELP_PAGES[index + 1] : null);

  const open = (id?: string) => app.navigate(id ? { name: 'help', helpId: id } : { name: 'help' });

  // 이전·다음으로 메뉴를 바꾸면 새 메뉴는 맨 위부터 보인다. PC(≥1024)에서는 문서가 아니라 .main이 스크롤 칸이다.
  let root = $state<HTMLElement>();
  $effect(() => {
    void helpId;
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
    for (let n = root?.parentElement; n; n = n.parentElement) {
      const { overflowY } = getComputedStyle(n);
      if (overflowY === 'auto' || overflowY === 'scroll') n.scrollTop = 0;
    }
  });

  // 없는 도움말 주소를 목록으로 바로잡았다는 안내는 여기서 한 번만 보여 준다(다른 화면으로 넘기지 않는다).
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
    {#if page}
      <button type="button" class="back" aria-label="도움말 목록으로" onclick={() => open()}>‹</button>
    {:else}
      <button type="button" class="back" aria-label="비교로 돌아가기" onclick={() => app.navigate({ name: 'compare' })}>‹</button>
    {/if}
    <span class="title">{page ? '도움말' : '가즈아 도움말'}</span>
    {@render barEnd(compact)}
  {/snippet}

  {#snippet main()}
    <div class="help" bind:this={root}>
      {#if page}
        <h1>{page.title}</h1>
        <HelpFigure {page} theme={app.settings.theme} />
        <p class="lead"><HelpText text={page.lead.join(' ')} /></p>
        <h2 id="help-steps">이렇게 써요</h2>
        <ol aria-labelledby="help-steps">
          {#each page.steps as s (s.title)}
            <li><b><HelpText text={s.title} /></b><span><HelpText text={s.sub} /></span></li>
          {/each}
        </ol>
        <h2 id="help-tips">알아 두면 좋아요</h2>
        <ul aria-labelledby="help-tips" class="tips">
          {#each page.tips as tip (tip)}
            <li><HelpText text={tip} /></li>
          {/each}
        </ul>
        <nav class="pager" aria-label="다른 메뉴 도움말">
          {#if prev}<button type="button" class="btn" onclick={() => open(prev.id)}>← 이전: {prev.title}</button>{/if}
          <span class="spacer"></span>
          {#if next}<button type="button" class="btn" onclick={() => open(next.id)}>다음: {next.title} →</button>{/if}
        </nav>
      {:else}
        <h1>도움말</h1>
        <p class="lead">메뉴마다 실제 화면 흐름을 움직이는 그림으로 보여 줘요.</p>
        <ul class="menu" aria-label="메뉴별 도움말">
          {#each HELP_PAGES as p (p.id)}
            <li>
              <button type="button" onclick={() => open(p.id)}>
                <b>{p.title}</b>
                <span>{p.steps.map((s) => s.title.replace(/`/g, '')).join(' → ')}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
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
  .help {
    max-width: 960px;
    padding: 4px var(--gutter) 48px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    line-height: 1.6;
  }
  h1 {
    font-size: var(--fs-headline);
    font-weight: 800;
    letter-spacing: -0.02em;
  }
  h2 {
    font-size: var(--fs-title);
    font-weight: 800;
    margin-top: 12px;
  }
  .lead {
    color: var(--t2);
  }
  ol,
  ul.tips {
    padding-left: 22px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  ol li {
    display: flex;
    flex-direction: column;
  }
  ol li span {
    color: var(--t2);
    font-size: var(--fs-sub);
  }
  .menu {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .menu button {
    width: 100%;
    min-height: var(--touch);
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 12px 16px;
    border-radius: var(--r-card);
    background: var(--surface);
  }
  .menu button:hover {
    background: var(--surface2);
  }
  .menu span {
    font-size: var(--fs-sub);
    color: var(--t3);
  }
  .pager {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 16px;
  }
  .spacer {
    flex: 1;
  }
  .btn {
    min-height: var(--touch);
    padding: 0 14px;
    border-radius: 12px;
    background: var(--surface2);
    color: var(--t1);
    font-weight: 700;
  }
</style>
