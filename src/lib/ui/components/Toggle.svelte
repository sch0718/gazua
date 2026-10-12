<script lang="ts">
  let {
    checked,
    label,
    onchange,
    disabled = false,
  }: {
    checked: boolean;
    label: string;
    onchange: (checked: boolean) => void;
    disabled?: boolean;
  } = $props();
</script>

<button
  type="button"
  class="toggle"
  role="switch"
  aria-checked={checked}
  aria-label={label}
  {disabled}
  onclick={() => onchange(!checked)}
>
  <span class="track" class:on={checked}><span class="thumb"></span></span>
</button>

<style>
  .toggle {
    display: inline-grid;
    place-items: center;
    min-width: 52px;
    min-height: 44px;
  }
  .toggle:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .track {
    width: 44px;
    height: 26px;
    border-radius: 999px;
    background: var(--line);
    padding: 3px;
    display: block;
    transition: background var(--dur-base) var(--ease);
  }
  .track.on {
    background: var(--accent);
  }
  .thumb {
    display: block;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
    transition: transform var(--dur-base) var(--ease);
  }
  .on .thumb {
    transform: translateX(18px);
  }
</style>
