<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    selected = false,
    tone = 'default',
    disabled = false,
    onclick,
    children,
  }: {
    selected?: boolean;
    /** `metric`: 지표 선택 칩(강조색 + ▾). */
    tone?: 'default' | 'metric';
    disabled?: boolean;
    onclick?: () => void;
    children: Snippet;
  } = $props();
</script>

<button
  type="button"
  class="chip"
  class:on={selected}
  class:metric={tone === 'metric'}
  aria-pressed={tone === 'metric' ? undefined : selected}
  aria-haspopup={tone === 'metric' ? 'dialog' : undefined}
  {disabled}
  {onclick}
>
  {@render children()}
</button>

<style>
  .chip {
    position: relative;
    padding: 7px 13px;
    border-radius: 999px;
    font-size: 13.5px;
    font-weight: 700;
    background: var(--surface2);
    color: var(--t2);
    white-space: nowrap;
    min-height: 36px;
  }
  /* 보이는 크기는 36px, 눌리는 영역은 44px. */
  .chip::before {
    content: '';
    position: absolute;
    inset: -4px -2px;
  }
  .chip.on {
    background: var(--t1);
    color: var(--bg);
  }
  .chip.metric {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .chip.metric::after {
    content: ' ▾';
    font-size: 10px;
  }
  .chip:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
