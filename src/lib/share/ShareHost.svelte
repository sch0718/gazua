<script lang="ts">
  import ShareDialog from './ShareDialog.svelte';
  import { closeShare, currentShare, shareController } from './shareStore.svelte';

  const sync = $derived(shareController());
</script>

{#if sync}
  <ShareDialog request={currentShare()} {sync} onclose={closeShare} />
{/if}
