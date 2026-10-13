<script lang="ts">
  let {
    checked,
    label,
    onchange,
    disabled = false,
    id,
  }: {
    checked: boolean;
    label: string;
    onchange: (checked: boolean) => void;
    disabled?: boolean;
    /** 바깥 <label for>와 연결할 때 */
    id?: string;
  } = $props();
</script>

<button
  type="button"
  class="toggle"
  role="switch"
  aria-checked={checked}
  aria-label={label}
  {id}
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
    background: var(--t3); /* 끔 트랙: 면 위 3:1 이상, 흰 손잡이 대비도 3:1 이상 */
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
    background: var(--on-accent); /* 켬 트랙(--accent) 위 3:1 이상 */
    transform: translateX(18px);
  }
</style>
