<script lang="ts">
  // 비용: 수수료율. 매도 세금은 엔진이 따로 계산한다.
  import type { Strategy } from '../../../sim/types';
  import NumberField from './NumberField.svelte';

  let { s, update }: { s: Strategy; update: (fn: (s: Strategy) => void) => void } = $props();
</script>

<div class="row">
  <NumberField label="수수료" value={s.costs.feePct} min={0} max={1} suffix="% (사고팔 때 각각)" onchange={(v) => update((x) => (x.costs.feePct = v))} />
</div>
<p class="hint">팔 때 내는 세금은 따로 계산해서 결과에 넣어요.</p>
