<script lang="ts">
  import { HELP_PAGES, type HelpPageId } from '../../help/content';
  import type { App } from '../../state/app.svelte';

  // 지금 화면의 도움말로 가는 44px 물음표 단추. 시트 안에서는 `onbefore`로 시트를 먼저 닫는다.
  let { app, page, onbefore }: { app: App; page: HelpPageId; onbefore?: () => void } = $props();
  const title = $derived(HELP_PAGES.find((p) => p.id === page)?.title ?? '');
</script>

<button
  type="button"
  class="help-btn"
  aria-label={`${title} 도움말`}
  title="도움말"
  onclick={() => {
    onbefore?.();
    app.navigate({ name: 'help', helpId: page });
  }}
>
  <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.6" />
    <circle cx="12" cy="17" r="0.6" fill="currentColor" />
  </svg>
</button>

<style>
  .help-btn {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    display: grid;
    place-items: center;
    color: var(--t2);
    flex: none;
  }
  .help-btn:hover {
    background: var(--surface2);
  }
</style>
