<script lang="ts">
  // 기간·자금: 시작일·종료일(KST), 처음 자금, 회당 매수 비중.
  import type { Strategy } from '../../../sim/types';
  import NumberField from './NumberField.svelte';

  let { s, update }: { s: Strategy; update: (fn: (s: Strategy) => void) => void } = $props();

  function setDate(key: 'from' | 'to', value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return; // 지우면 값이 비므로 이전 날짜를 둔다
    update((x) => (x.period[key] = value));
  }
</script>

<div class="dates">
  <label>
    <span>시작일</span>
    <input type="date" value={s.period.from} onchange={(e) => setDate('from', e.currentTarget.value)} />
  </label>
  <label>
    <span>종료일</span>
    <input type="date" value={s.period.to} onchange={(e) => setDate('to', e.currentTarget.value)} />
  </label>
</div>
<p class="hint">날짜는 한국 시간 기준이고, 시작일과 종료일 모두 포함해요.</p>
<div class="row">
  <NumberField label="처음 자금" value={s.capital.initial} min={1} max={1e13} step={1} suffix="원" onchange={(v) => update((x) => (x.capital.initial = v))} />
</div>
<div class="row">
  <NumberField label="한 번에 사는 금액" value={s.capital.perBuyPct} min={1} max={100} suffix="% (자금 대비)" onchange={(v) => update((x) => (x.capital.perBuyPct = v))} />
</div>

<style>
  .dates {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  input {
    min-height: var(--touch);
    padding: 0 10px;
    border-radius: 10px;
    border: 1px solid transparent;
    background: var(--surface2);
    color: var(--t1);
    font: inherit;
    font-size: 16px;
  }
  input:focus {
    border-color: var(--accent);
    outline: none;
  }
</style>
