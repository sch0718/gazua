<script lang="ts">
  let {
    message,
    actionLabel,
    onaction,
  }: { message: string; actionLabel?: string; onaction?: () => void } = $props();
</script>

<div class="snack">
  <span>{message}</span>
  {#if actionLabel}
    <button type="button" onclick={() => onaction?.()}>{actionLabel}</button>
  {/if}
</div>

<style>
  .snack {
    pointer-events: auto;
    background: var(--t1);
    color: var(--bg);
    border-radius: 14px;
    padding: 6px 6px 6px 16px;
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 14px;
    box-shadow: var(--shadow);
    min-width: 280px;
    max-width: calc(100vw - 32px);
    animation: snack-in var(--dur-base) var(--ease);
  }
  span {
    flex: 1;
  }
  button {
    color: var(--snack-action);
    font-weight: 800;
    padding: 8px 12px;
    min-height: 44px;
    min-width: 44px;
    border-radius: 10px;
  }
  @keyframes snack-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .snack {
      animation-name: snack-fade;
    }
    @keyframes snack-fade {
      from {
        opacity: 0;
      }
    }
  }
</style>
