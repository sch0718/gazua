<script lang="ts">
  // 받은 검증 결과를 검증 화면(ValidationResult)으로 읽기 전용으로 보인다. 흐름 기간·수급·재무 표시는 받은 기준에서 다시 만든다(설계 2.5).
  import { usesMacro } from '../../screen/precompute';
  import ValidationResult from '../../ui/screen/ValidationResult.svelte';
  import { finRunSnap, flowRunSnap } from '../../ui/screen/screenText';
  import { expandValidation } from '../compact';
  import { sampledText, type SymbolNames } from '../shareText';
  import type { ValidationSnapshot } from '../snapshot';

  let { snapshot, names, colorConvention, theme }: { snapshot: ValidationSnapshot; names?: SymbolNames; colorConvention: 'kr' | 'global'; theme?: string } = $props();

  const result = $derived(expandValidation(snapshot));
  const c = $derived(snapshot.criteria);
  const nameMap = $derived<Record<string, string>>(names ? Object.fromEntries(names) : {});
  const r = $derived(snapshot.result);
</script>

<ValidationResult
  app={null}
  {colorConvention}
  {result}
  names={nameMap}
  criteriaName={snapshot.title}
  capital={c.capital}
  {theme}
  macro={{ used: usesMacro(c), lookback: { usdkrw: c.conditions.macro.usdkrw.trend.lookback, wti: c.conditions.macro.wti.trend.lookback } }}
  flow={flowRunSnap(c)}
  fin={finRunSnap(c)}
  sampledNote={r.sampled ? sampledText(r.sampled, r.axis.offsets.length) : undefined}
/>
