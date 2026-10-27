<script lang="ts">
  // 메뉴 처음 안내: 비교·매매 규칙·선정 기준·내 성과에 처음 들어오면 그림과 단계를 담은 시트를 한 번 띄운다.
  // 다른 시트·대화상자가 열려 있으면 닫힐 때까지 기다린다. 본 기록은 이 브라우저에만 남는다(설정 › 도움말에서 다시 보기).
  import { untrack } from 'svelte';
  import { HELP_PAGES, type HelpPageId } from '../../help/content';
  import { helpIdForRoute, introIdFor } from '../../help/routing';
  import { helpSeen, type HelpSeenStore } from '../../help/seen';
  import type { App } from '../../state/app.svelte';
  import { Sheet } from '@sch0718/ui-svelte';
  import HelpFigure from './HelpFigure.svelte';
  import HelpText from './HelpText.svelte';

  let { app, store = helpSeen }: { app: App; store?: HelpSeenStore } = $props();

  let shown = $state<HelpPageId | null>(null);
  let host = $state<HTMLElement>();
  const page = $derived(shown === null ? null : (HELP_PAGES.find((p) => p.id === shown) ?? null));

  /** 이 안내 말고 열린 대화상자가 있나. */
  function otherDialogOpen(): boolean {
    return [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].some((d) => !host?.contains(d));
  }

  $effect(() => {
    const route = app.route;
    let live = true;
    const check = () => {
      if (!live) return;
      // 띄운 안내는 같은 메뉴에 있는 동안 그대로 둔다.
      if (untrack(() => shown) !== null && helpIdForRoute(route) === untrack(() => shown)) return;
      shown = introIdFor(route, store.read(), otherDialogOpen());
    };
    // 같은 렌더에서 열린 시트를 확인한 뒤 정한다.
    queueMicrotask(check);
    if (introIdFor(route, store.read(), false) === null) {
      return () => {
        live = false;
      };
    }
    // 다른 시트가 닫히면 다시 본다.
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      live = false;
      observer.disconnect();
    };
  });

  function close() {
    if (shown !== null) store.mark(shown);
    shown = null;
  }

  function more() {
    const id = shown;
    close();
    if (id !== null) app.navigate({ name: 'help', helpId: id });
  }
</script>

<div bind:this={host}>
  {#if page}
    <Sheet open title={page.title} onclose={close}>
      <div class="intro">
        <HelpFigure {page} theme={app.settings.theme} compact />
        <p><HelpText text={page.lead.join(' ')} /></p>
        <ol>
          {#each page.steps as s (s.title)}
            <li><HelpText text={s.title} /></li>
          {/each}
        </ol>
        <div class="actions">
          <button type="button" class="btn" onclick={more}>도움말 자세히</button>
          <button type="button" class="btn primary" data-autofocus onclick={close}>시작하기</button>
        </div>
      </div>
    </Sheet>
  {/if}
</div>

<style>
  .intro {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 4px 20px 16px;
  }
  p {
    color: var(--t2);
  }
  ol {
    padding-left: 22px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 8px;
  }
  .btn {
    min-height: var(--touch);
    padding: 0 16px;
    border-radius: 12px;
    background: var(--surface2);
    color: var(--t1);
    font-weight: 700;
  }
  .btn.primary {
    background: var(--accent);
    color: var(--on-accent);
  }
</style>
