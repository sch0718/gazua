<script lang="ts">
  import { HELP_PAGES, type HelpPageId } from '../../help/content';
  import type { App } from '../../state/app.svelte';

  // 지금 화면의 도움말로 가는 44px 물음표 단추. 시트 안에서는 `onbefore`로 시트를 먼저 닫는다.
  // `narrowHide`면 폰 폭(<600)에서 숨긴다: 비교 화면 앱 바는 그룹 탭(＋ 포함)에 자리를 남겨야 한다.
  // 폰에서는 처음 안내·설정 › 도움말·그룹 관리 시트의 도움말 단추로 간다.
  let { app, page, onbefore, narrowHide = false }: { app: App; page: HelpPageId; onbefore?: () => void; narrowHide?: boolean } = $props();
  const title = $derived(HELP_PAGES.find((p) => p.id === page)?.title ?? '');
</script>

<button
  type="button"
  class="help-btn"
  class:narrow-hide={narrowHide}
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
  @media (max-width: 599px) {
    .narrow-hide {
      display: none;
    }
  }
</style>
