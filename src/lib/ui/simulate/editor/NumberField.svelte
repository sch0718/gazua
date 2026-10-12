<script lang="ts">
  import { untrack } from 'svelte';

  let {
    label,
    value,
    min,
    max,
    step,
    suffix,
    onchange,
  }: {
    label: string;
    value: number;
    min: number;
    max: number;
    /** 정수면 소수 입력을 막는다 */
    step?: number;
    suffix?: string;
    onchange: (v: number) => void;
  } = $props();

  const uid = Math.random().toString(36).slice(2, 9);
  const integer = $derived(step !== undefined && Number.isInteger(step));

  let text = $state(untrack(() => String(value)));
  let bad = $state(false);

  function parse(t: string): number {
    const clean = t.replaceAll(',', '').trim();
    return clean === '' ? NaN : Number(clean);
  }
  const valid = (v: number) => Number.isFinite(v) && v >= min && v <= max && (!integer || Number.isInteger(v));

  // 밖에서 값이 바뀌면(다른 칸·되돌리기) 입력 칸도 맞춘다. 고치는 중인 틀린 입력은 건드리지 않는다.
  $effect(() => {
    const v = value;
    untrack(() => {
      if (!bad && parse(text) !== v) text = String(v);
    });
  });

  function oninput() {
    const v = parse(text);
    bad = !valid(v);
    if (!bad && v !== value) onchange(v);
  }

  function onblur() {
    if (!bad) return;
    bad = false;
    text = String(value);
  }
</script>

<div class="field">
  <label for="nf-{uid}">{label}</label>
  <span class="box" class:bad>
    <input
      id="nf-{uid}"
      type="text"
      inputmode="decimal"
      autocomplete="off"
      bind:value={text}
      {oninput}
      {onblur}
      aria-invalid={bad ? 'true' : undefined}
      aria-describedby={bad ? `nf-err-${uid}` : undefined}
    />
    {#if suffix}<span class="suffix">{suffix}</span>{/if}
  </span>
  {#if bad}
    <p class="err" id="nf-err-{uid}" role="alert">{min}~{max} 사이로 적어 주세요</p>
  {/if}
</div>

<style>
  .field {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    column-gap: 12px;
    flex: 1;
    min-width: 0;
  }
  label {
    font-size: var(--fs-body);
    color: var(--t1);
  }
  .box {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: var(--touch);
    padding: 0 12px;
    border-radius: 10px;
    background: var(--surface2);
    border: 1px solid transparent;
  }
  .box:focus-within {
    border-color: var(--accent);
  }
  .box.bad {
    border-color: var(--err);
  }
  input {
    width: 84px;
    min-width: 0;
    border: 0;
    background: none;
    color: var(--t1);
    font-size: 16px;
    text-align: right;
    outline: none;
    padding: 0;
  }
  .suffix {
    font-size: var(--fs-sub);
    color: var(--t2);
    white-space: nowrap;
  }
  .err {
    grid-column: 1 / -1;
    margin: 4px 0 0;
    font-size: var(--fs-sub);
    color: var(--err);
    text-align: right;
  }
</style>
