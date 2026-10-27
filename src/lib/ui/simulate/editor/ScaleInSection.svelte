<script lang="ts">
  // 분할 매수: 산 뒤 일정 %씩 더 떨어질 때마다 추가로 산다.
  import type { Strategy } from '../../../sim/types';
  import { Toggle } from '@sch0718/ui-svelte';
  import NumberField from './NumberField.svelte';

  let { s, update }: { s: Strategy; update: (fn: (s: Strategy) => void) => void } = $props();
  const uid = Math.random().toString(36).slice(2, 9);
</script>

<div class="row">
  <label for="{uid}-on">분할 매수</label>
  <Toggle id="{uid}-on" label="분할 매수 사용" checked={s.scaleIn.on} onchange={(v) => update((x) => (x.scaleIn.on = v))} />
</div>
{#if s.scaleIn.on}
  <div class="row">
    <NumberField label="추가 매수 간격" value={s.scaleIn.stepPct} min={0.5} max={50} suffix="% 더 떨어질 때마다" onchange={(v) => update((x) => (x.scaleIn.stepPct = v))} />
  </div>
  <div class="row">
    <NumberField label="추가 매수 최대" value={s.scaleIn.maxAdds} min={1} max={5} step={1} suffix="번" onchange={(v) => update((x) => (x.scaleIn.maxAdds = v))} />
  </div>
  <p class="hint">추가 매수 한 번도 처음과 같은 금액으로 사요.</p>
{:else}
  <p class="hint">켜면 처음 산 가격보다 떨어질 때 나눠서 더 사요.</p>
{/if}
