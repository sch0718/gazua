<script lang="ts">
  import Snackbar from './Snackbar.svelte';
  import { currentSnackbar, runSnackbarAction } from './snackbarStore.svelte';

  const item = $derived(currentSnackbar());
</script>

<!-- 라이브 영역은 항상 존재해야 내용이 바뀔 때 스크린리더가 읽는다. -->
<div class="host" role="status" aria-live="polite">
  {#if item}
    {#key item.id}
      <Snackbar
        message={item.message}
        actionLabel={item.action?.label}
        onaction={runSnackbarAction}
      />
    {/key}
  {/if}
</div>

<style>
  .host {
    position: fixed;
    left: 0;
    right: 0;
    bottom: calc(96px + env(safe-area-inset-bottom, 0px));
    display: flex;
    justify-content: center;
    z-index: 85;
    pointer-events: none;
  }
  @media (min-width: 1024px) {
    .host {
      bottom: 32px;
    }
  }
</style>
