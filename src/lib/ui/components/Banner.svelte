<script lang="ts">
  let {
    message,
    actionLabel,
    onaction,
    tone = 'info',
  }: {
    message: string;
    actionLabel?: string;
    onaction?: () => void;
    tone?: 'info' | 'warn' | 'error';
  } = $props();
</script>

<div class="banner {tone}" role={tone === 'error' ? 'alert' : 'status'}>
  <span>{message}</span>
  {#if actionLabel}
    <button type="button" onclick={() => onaction?.()}>{actionLabel}</button>
  {/if}
</div>

<style>
  .banner {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 4px 12px;
    font-size: 13px;
    color: var(--t2);
    background: var(--surface2);
    padding: 4px 16px;
    text-align: center;
  }
  .warn {
    color: var(--warn);
    background: color-mix(in srgb, var(--warn) 12%, var(--surface));
  }
  .error {
    color: var(--err);
    background: color-mix(in srgb, var(--err) 12%, var(--surface));
  }
  button {
    color: var(--accent);
    font-weight: 800;
    min-height: 44px;
    min-width: 44px;
    padding: 0 8px;
  }
</style>
