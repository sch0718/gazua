<script lang="ts">
  let {
    message,
    actionLabel,
    onaction,
    onhold,
    onrelease,
  }: {
    message: string;
    actionLabel?: string;
    onaction?: () => void;
    /** 포커스가 스낵바 안으로 들어왔을 때(타이머 멈춤) */
    onhold?: () => void;
    /** 포커스가 스낵바 밖으로 나갔을 때(타이머 다시 흐름) */
    onrelease?: () => void;
  } = $props();

  function onfocusout(e: FocusEvent) {
    const next = e.relatedTarget as Node | null;
    if (!next || !(e.currentTarget as HTMLElement).contains(next)) onrelease?.();
  }
</script>

<!-- 시트가 열려 있으면 Sheet가 data-snackbar-action을 Tab 순환의 끝에 넣는다. -->
<div class="snack" onfocusin={() => onhold?.()} {onfocusout}>
  <span>{message}</span>
  {#if actionLabel}
    <button type="button" data-snackbar-action onclick={() => onaction?.()}>{actionLabel}</button>
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
