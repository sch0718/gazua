<script lang="ts">
  type Option = { value: string; label: string; sub?: string; disabled?: boolean; reason?: string };

  let {
    options,
    value,
    onchange,
    label,
    wide = false,
    onSurface = false,
  }: {
    options: Option[];
    value: string;
    onchange: (value: string) => void;
    label?: string;
    wide?: boolean;
    /** 표면(--surface) 카드 안에 놓을 때: 트랙 --bg, 선택 --surface2(다크에서 선택 항목이 꺼져 보이지 않게) */
    onSurface?: boolean;
  } = $props();

  let buttons = $state<HTMLButtonElement[]>([]);

  function select(o: Option) {
    if (o.disabled || o.value === value) return;
    onchange(o.value);
  }

  function onkeydown(e: KeyboardEvent, index: number) {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const n = options.length;
    for (let step = 1; step < n; step++) {
      const i = (((index + dir * step) % n) + n) % n;
      if (!options[i].disabled) {
        onchange(options[i].value);
        buttons[i]?.focus();
        return;
      }
    }
  }

  // roving tabindex: 선택된 옵션(없으면 첫 활성 옵션)만 탭 정지점.
  const tabStop = $derived.by(() => {
    const sel = options.findIndex((o) => o.value === value && !o.disabled);
    return sel >= 0 ? sel : options.findIndex((o) => !o.disabled);
  });
</script>

<div class="seg" class:wide class:on-surface={onSurface} role="radiogroup" aria-label={label}>
  {#each options as o, i (o.value)}
    <button
      type="button"
      role="radio"
      class:on={o.value === value}
      aria-checked={o.value === value}
      aria-disabled={o.disabled ? 'true' : undefined}
      title={o.disabled ? o.reason : undefined}
      tabindex={i === tabStop ? 0 : -1}
      bind:this={buttons[i]}
      onclick={() => select(o)}
      onkeydown={(e) => onkeydown(e, i)}
    >
      {o.label}
      {#if o.sub}<small>{o.sub}</small>{/if}
    </button>
  {/each}
</div>

<style>
  .seg {
    display: inline-flex;
    background: var(--surface2);
    border-radius: 12px;
    padding: 3px;
    gap: 2px;
  }
  button {
    padding: 6px 13px;
    border-radius: 9px;
    font-size: 14px;
    font-weight: 700;
    color: var(--t2);
    min-height: 44px;
    min-width: 44px;
    line-height: 1.1;
    transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
  }
  button.on {
    background: var(--surface);
    color: var(--t1);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.14);
  }
  .seg.on-surface {
    background: var(--bg);
  }
  .on-surface button.on {
    background: var(--surface2);
  }
  button[aria-disabled='true'] {
    color: var(--t3);
    opacity: 0.5;
    cursor: not-allowed;
  }
  small {
    display: block;
    font-size: 10px;
    font-weight: 600;
    color: var(--accent);
  }
  .wide {
    display: flex;
    width: 100%;
  }
  .wide button {
    flex: 1;
  }
  @media (min-width: 600px) {
    .wide {
      display: inline-flex;
      width: auto;
    }
    .wide button {
      flex: none;
    }
  }
</style>
