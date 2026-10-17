<script lang="ts">
  // 고를 개수·정렬 구역(스펙 7.3): 정렬 기준과 그 기준의 세부(민감도 계열·재무 지표·수급 주체와 기간), 고를 개수.
  import { TAKE_MAX } from '../../screen/defaults';
  import { rankFinOf } from '../../screen/fin';
  import { rankFlowOf } from '../../screen/precompute';
  import type { FinMetric, FlowWho, SelectionCriteria } from '../../screen/types';
  import Segmented from '../components/Segmented.svelte';
  import NumberField from '../simulate/editor/NumberField.svelte';
  import { FIN_METRIC_ORDER, FIN_RANK_LABEL, FLOW_WHO_LABEL, FLOW_WHO_ORDER, RANK_LABEL, SERIES_LABEL } from './screenText';

  type NF = (key: string) => { keepInvalid: boolean; invalidText: string | undefined; oninvalid: (bad: boolean, text: string) => void };

  let {
    criteria,
    update,
    nf,
    forget,
  }: {
    criteria: SelectionCriteria;
    update: (fn: (c: SelectionCriteria) => void) => void;
    nf: NF;
    /** 숨는 칸의 틀린 글을 버린다(칸 없이 실행을 막지 않게) */
    forget: (key: string) => void;
  } = $props();

  const SERIES = ['usdkrw', 'wti'] as const;
  const BY_ORDER = ['marketCap', 'tradingValue', 'return', 'lowVolatility', 'macroBeta', 'flow', 'fin'] as const;
  // 고르는 칸의 수급은 '수급 순'으로 짧게, 요약은 '수급 큰 순'으로 보인다
  const byOptions = BY_ORDER.map((v) => ({ value: v, label: v === 'flow' ? '수급 순' : RANK_LABEL[v] }));

  function setRankBy(v: string) {
    if (v !== 'flow') forget('rank-flow-days');
    update((c) => (c.rank.by = v as SelectionCriteria['rank']['by']));
  }
</script>

<Segmented wrap onSurface label="정렬 기준" value={criteria.rank.by} onchange={setRankBy} options={byOptions} />
{#if criteria.rank.by === 'macroBeta'}
  <select class="pick" aria-label="민감도 계열" onchange={(e) => update((c) => (c.rank.series = e.currentTarget.value === 'wti' ? 'wti' : 'usdkrw'))}>
    {#each SERIES as s (s)}
      <option value={s} selected={(criteria.rank.series ?? 'usdkrw') === s}>{SERIES_LABEL[s]}</option>
    {/each}
  </select>
{:else if criteria.rank.by === 'fin'}
  <select
    class="pick"
    aria-label="재무 지표"
    onchange={(e) => {
      const v = e.currentTarget.value as FinMetric;
      update((c) => {
        c.rank.fin = { metric: FIN_METRIC_ORDER.includes(v) ? v : 'per' };
      });
    }}
  >
    {#each FIN_METRIC_ORDER as m (m)}
      <option value={m} selected={rankFinOf(criteria) === m}>{FIN_RANK_LABEL[m]}</option>
    {/each}
  </select>
{:else if criteria.rank.by === 'flow'}
  {@const rf = rankFlowOf(criteria)}
  <Segmented
    wide
    onSurface
    label="수급 주체"
    value={rf.who}
    onchange={(v) =>
      update((c) => {
        c.rank.flow = { ...rankFlowOf(c), who: FLOW_WHO_ORDER.includes(v as FlowWho) ? (v as FlowWho) : 'foreign' };
      })}
    options={FLOW_WHO_ORDER.map((w) => ({ value: w, label: FLOW_WHO_LABEL[w] }))}
  />
  <div class="row">
    <NumberField label="수급 기간" value={rf.days} min={5} max={120} step={1} suffix="일" {...nf('rank-flow-days')} onchange={(v) =>
        update((c) => {
          c.rank.flow = { ...rankFlowOf(c), days: v };
        })} />
  </div>
{/if}
<p class="hint">조건을 통과한 종목을 이 순서로 줄 세워 위에서부터 골라요. 같으면 종목코드 순이에요.</p>
<div class="row">
  <NumberField label="고를 개수" value={criteria.rank.take} min={1} max={TAKE_MAX} step={1} suffix="개" {...nf('take')} onchange={(v) => update((c) => (c.rank.take = v))} />
</div>

<style>
  .pick {
    width: 100%;
    min-width: 0;
    min-height: var(--touch);
    padding: 0 10px;
    border-radius: 10px;
    border: 1px solid transparent;
    background: var(--surface2);
    color: var(--t1);
    font: inherit;
    font-size: 16px;
  }
  .pick:focus {
    border-color: var(--accent);
    outline: none;
  }
</style>
