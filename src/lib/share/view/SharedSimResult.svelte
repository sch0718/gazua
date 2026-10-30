<script lang="ts">
  // 받은 시뮬레이션 결과를 결과 화면(ResultView)으로 읽기 전용으로 보인다. 원시 일봉이 없어 거래 차트 시트는 없다.
  import ResultView from '../../ui/simulate/ResultView.svelte';
  import { expandSimResult, perSymbolPct } from '../compact';
  import { sampledText, type SymbolNames } from '../shareText';
  import type { SimResultSnapshot } from '../snapshot';

  let { snapshot, names, colorConvention, theme }: { snapshot: SimResultSnapshot; names?: SymbolNames; colorConvention: 'kr' | 'global'; theme?: string } = $props();

  const done = $derived(expandSimResult(snapshot, names));
  const r = $derived(snapshot.result);
</script>

<ResultView
  state={done}
  {colorConvention}
  {theme}
  readonly
  hideAmounts={snapshot.capitalHidden}
  skippedCounts={r.skipped.rows === null ? r.skipped.counts : undefined}
  pnlPct={snapshot.capitalHidden ? perSymbolPct(snapshot) : undefined}
  sampledNote={r.sampled ? sampledText(r.sampled, r.axis.offsets.length) : undefined}
/>
