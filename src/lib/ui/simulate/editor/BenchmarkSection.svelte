<script lang="ts">
  // 비교 기준: 지수 하나와, 원하면 종목 하나를 더 골라 결과와 견준다.
  import type { UniverseItem } from '../../../data/universe';
  import type { Strategy } from '../../../sim/types';
  import type { App } from '../../../state/app.svelte';
  import AddStockSheet from '../../../../sheets/AddStockSheet.svelte';
  import Segmented from '../../components/Segmented.svelte';

  let {
    app,
    s,
    update,
    names,
    loadItems,
  }: {
    app: App;
    s: Strategy;
    update: (fn: (s: Strategy) => void) => void;
    names: Record<string, string>;
    loadItems?: () => Promise<UniverseItem[]>;
  } = $props();

  let picking = $state(false);
  const sym = $derived(s.benchmarks.symbol);
</script>

<p class="hint">같은 종목을 사서 그대로 둔 경우와 아래 지수는 항상 함께 비교해요.</p>
<Segmented
  label="비교 지수"
  value={s.benchmarks.index}
  onchange={(v) => update((x) => (x.benchmarks.index = v as 'KOSPI' | 'KOSDAQ'))}
  options={[
    { value: 'KOSPI', label: 'KOSPI' },
    { value: 'KOSDAQ', label: 'KOSDAQ' },
  ]}
/>
<div class="row">
  <span class="grow">비교 종목: <b>{sym ? (names[sym] ?? sym) : '없음'}</b></span>
  <button type="button" class="act" onclick={() => (picking = true)}>{sym ? '종목 바꾸기' : '종목 고르기'}</button>
  {#if sym}
    <button type="button" class="act danger" aria-label="비교 종목 지우기" onclick={() => update((x) => (x.benchmarks.symbol = null))}>지우기</button>
  {/if}
</div>
<AddStockSheet
  open={picking}
  {app}
  mode="single"
  title="비교 종목"
  metas={{}}
  now={Date.now()}
  {loadItems}
  onpick={(item) => update((x) => (x.benchmarks.symbol = item.s))}
  onclose={() => (picking = false)}
/>

<style>
  .grow {
    flex: 1;
    min-width: 0;
  }
</style>
