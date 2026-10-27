<script lang="ts">
  // 조건 하나: 이름 · 켜기 토글 · 한 줄 설명 · (아래에, 있으면) 숫자 칸. 꺼도 칸은 흐리게 보이고 계속 고칠 수 있다.
  import type { Snippet } from 'svelte';
  import { Toggle } from '@sch0718/ui-svelte';

  let {
    label,
    help,
    on,
    ontoggle,
    disabled = false,
    softDisabled = false,
    describedby,
    children,
  }: {
    label: string;
    help: string;
    on: boolean;
    ontoggle: (v: boolean) => void;
    disabled?: boolean;
    /** 포커스를 지키며 막을 때: aria-disabled만 켠다 */
    softDisabled?: boolean;
    describedby?: string;
    /** 숫자 칸. 켜고 끄기만 있는 조건(흑자)은 없다 */
    children?: Snippet;
  } = $props();

  const uid = Math.random().toString(36).slice(2, 9);
</script>

<div class="cond" class:off={!on}>
  <div class="row">
    <label for="cond-{uid}">{label}</label>
    <Toggle id="cond-{uid}" label="{label} 사용" checked={on} onchange={ontoggle} {disabled} {softDisabled} {describedby} />
  </div>
  <p class="help">{help}</p>
  {#if children}<div class="fields">{@render children()}</div>{/if}
</div>

<style>
  .cond {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px 0;
    border-top: 1px solid var(--line);
  }
  .cond:first-of-type {
    border-top: 0;
    padding-top: 0;
  }
  .row label {
    font-weight: 700;
  }
  .help {
    margin: 0;
    font-size: var(--fs-sub);
    color: var(--t2);
    word-break: keep-all;
  }
  .fields {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .fields :global(.field) {
    flex: none;
  }
</style>
