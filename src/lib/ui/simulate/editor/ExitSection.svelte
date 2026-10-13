<script lang="ts">
  // 매도: 익절 단계(최대 3), 손절폭·기준, 1단계 익절 뒤 손절선.
  import { MAX_TAKE_STAGES } from '../../../sim/defaults';
  import type { StopBasis, Strategy } from '../../../sim/types';
  import Segmented from '../../components/Segmented.svelte';
  import NumberField from './NumberField.svelte';

  let { s, update }: { s: Strategy; update: (fn: (s: Strategy) => void) => void } = $props();
  const stages = $derived(s.exit.takeProfit);

  function addStage() {
    update((x) => {
      const tp = x.exit.takeProfit;
      if (tp.length >= MAX_TAKE_STAGES) return;
      const last = tp[tp.length - 1];
      // 이제 마지막이 아니니 남은 몫의 절반만 판다(앞 단계 합이 100 미만이어야 새 단계가 실행된다)
      const sold = tp.slice(0, -1).reduce((a, t) => a + t.sellPct, 0);
      last.sellPct = Math.max(1, Math.floor((100 - sold) / 2));
      tp.push({ pct: Math.min(500, last.pct + 10), sellPct: 100 });
    });
  }

  function removeStage(i: number) {
    update((x) => {
      const tp = x.exit.takeProfit;
      if (tp.length <= 1) return;
      tp.splice(i, 1);
      tp[tp.length - 1].sellPct = 100; // 마지막 단계는 나머지 전부
    });
  }
</script>

<p class="group-title">익절</p>
{#each stages as st, i (i)}
  {@const last = i === stages.length - 1}
  <div class="stage">
    <div class="row">
      <NumberField label="{i + 1}단계 목표" value={st.pct} min={0.5} max={500} suffix="% 오르면" onchange={(v) => update((x) => (x.exit.takeProfit[i].pct = v))} />
      {#if stages.length > 1}
        <button type="button" class="act danger" aria-label="{i + 1}단계 삭제" onclick={() => removeStage(i)}>삭제</button>
      {/if}
    </div>
    <div class="row">
      {#if last}
        <span class="rest">{i + 1}단계 파는 양</span><span class="rest-v">나머지 전부</span>
      {:else}
        <NumberField label="{i + 1}단계 파는 양" value={st.sellPct} min={1} max={100} suffix="%" onchange={(v) => update((x) => (x.exit.takeProfit[i].sellPct = v))} />
      {/if}
    </div>
  </div>
{/each}
{#if stages.length < MAX_TAKE_STAGES}
  <button type="button" class="act" onclick={addStage}>＋ 단계 추가</button>
{/if}
<p class="hint">파는 양은 처음 산 수량을 기준으로 한 비율이에요.</p>

<p class="group-title">손절</p>
<div class="row">
  <NumberField label="손절폭" value={s.exit.stopLoss.pct} min={0.5} max={50} suffix="% 내리면" onchange={(v) => update((x) => (x.exit.stopLoss.pct = v))} />
</div>
<span class="seg-label">손절 기준 가격</span>
<Segmented
  wide
  label="손절 기준 가격"
  value={s.exit.stopLoss.basis}
  onchange={(v) => update((x) => (x.exit.stopLoss.basis = v as StopBasis))}
  options={[
    { value: 'avgAfterScaleIn', label: '분할 완료 후 평단' },
    { value: 'avgAlways', label: '평단' },
    { value: 'firstBuy', label: '첫 매수가' },
  ]}
/>
<span class="seg-label">1단계 익절 뒤 손절선</span>
<Segmented
  wide
  label="1단계 익절 뒤 손절선"
  value={s.exit.afterFirstTake}
  onchange={(v) => update((x) => (x.exit.afterFirstTake = v as 'keep' | 'breakeven'))}
  options={[
    { value: 'keep', label: '그대로' },
    { value: 'breakeven', label: '본전으로 올리기' },
  ]}
/>

<style>
  .stage {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .rest {
    flex: 1;
  }
  .rest-v {
    color: var(--t2);
    padding-right: 12px;
  }
  .seg-label {
    font-size: var(--fs-sub);
    color: var(--t2);
  }
</style>
