<script lang="ts">
  let {
    checked,
    label,
    onchange,
    disabled = false,
    id,
    describedby,
    softDisabled = false,
  }: {
    checked: boolean;
    label: string;
    onchange: (checked: boolean) => void;
    disabled?: boolean;
    /** 바깥 <label for>와 연결할 때 */
    id?: string;
    /** 설명 문구 요소 id */
    describedby?: string;
    /** aria-disabled만 켠다(포커스를 잃지 않게 disabled는 쓰지 않는다). 누름 처리는 부르는 쪽 몫 */
    softDisabled?: boolean;
  } = $props();
</script>

<button
  type="button"
  class="toggle"
  role="switch"
  aria-checked={checked}
  aria-label={label}
  aria-describedby={describedby}
  aria-disabled={softDisabled ? 'true' : undefined}
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
  .toggle:disabled,
  .toggle[aria-disabled='true'] {
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
