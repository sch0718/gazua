<script lang="ts">
  // 투자자 매매동향 소구역(3단계 스펙 4.1): 순매수 규모 · 연속 순매수 두 줄 + 공통 안내.
  // 데이터에 수급이 없으면(v1·v2) 새로 켜는 것과 값 고치기를 막는다. 이미 켜져 있던 조건은 끌 수 있다(MacroConditions와 같다).
  import type { FlowWho, SelectionCriteria } from '../../screen/types';
  import Segmented from '../components/Segmented.svelte';
  import NumberField from '../simulate/editor/NumberField.svelte';
  import ConditionRow from './ConditionRow.svelte';
  import { FLOW_AMOUNT_HELP, FLOW_LAG_HINT, FLOW_STREAK_HELP, FLOW_WHO_LABEL, FLOW_WHO_ORDER, NEED_RECOLLECT_TEXT } from './screenText';

  type Flow = SelectionCriteria['conditions']['flow'];
  type NF = (key: string) => { keepInvalid: boolean; invalidText: string | undefined; oninvalid: (bad: boolean, text: string) => void };

  let {
    flow,
    update,
    nf,
    unavailable = false,
  }: {
    flow: Flow;
    update: (fn: (f: Flow) => void) => void;
    nf: NF;
    /** 이 데이터에는 투자자 매매동향이 없다 */
    unavailable?: boolean;
  } = $props();

  const uid = Math.random().toString(36).slice(2, 9);
  const offId = `flow-off-${uid}`;
  // 데이터에 없으면 새로 켜는 것만 막는다. 이미 켜진 조건은 끌 수 있고, 끈 뒤에도 토글이 포커스를 지킨다
  const gate = (turn: (v: boolean) => void) => (v: boolean) => {
    if (unavailable && v) return;
    turn(v);
  };
  const whoOptions = FLOW_WHO_ORDER.map((w) => ({ value: w, label: FLOW_WHO_LABEL[w] }));
  const asWho = (v: string): FlowWho => (FLOW_WHO_ORDER.includes(v as FlowWho) ? (v as FlowWho) : 'foreign');
</script>

<div class="flow">
  <p class="group-title">투자자 매매동향</p>
  <p class="hint">{FLOW_LAG_HINT}</p>
  {#if unavailable}<p class="hint" id={offId}>{NEED_RECOLLECT_TEXT}</p>{/if}
  <ConditionRow label="순매수 규모" help={FLOW_AMOUNT_HELP} on={flow.amount.on} softDisabled={unavailable && !flow.amount.on} describedby={unavailable ? offId : undefined} ontoggle={gate((v) => update((f) => (f.amount.on = v)))}>
    <fieldset class="fs" disabled={unavailable}>
      <Segmented wide onSurface label="순매수 규모 주체" value={flow.amount.who} onchange={(v) => update((f) => (f.amount.who = asWho(v)))} options={whoOptions} />
      <NumberField label="순매수 기간" value={flow.amount.days} min={5} max={120} step={1} suffix="일" muted={!flow.amount.on} {...nf('flow-days')} onchange={(v) => update((f) => (f.amount.days = v))} />
      <NumberField label="최소 순매수 비율" value={flow.amount.minPct} min={-100} max={100} suffix="% 이상" muted={!flow.amount.on} {...nf('flow-min')} onchange={(v) => update((f) => (f.amount.minPct = v))} />
      <NumberField label="최대 순매수 비율" value={flow.amount.maxPct} min={-100} max={100} suffix="% 이하" muted={!flow.amount.on} {...nf('flow-max')} onchange={(v) => update((f) => (f.amount.maxPct = v))} />
    </fieldset>
  </ConditionRow>
  <ConditionRow label="연속 순매수" help={FLOW_STREAK_HELP} on={flow.streak.on} softDisabled={unavailable && !flow.streak.on} describedby={unavailable ? offId : undefined} ontoggle={gate((v) => update((f) => (f.streak.on = v)))}>
    <fieldset class="fs" disabled={unavailable}>
      <Segmented wide onSurface label="연속 순매수 주체" value={flow.streak.who} onchange={(v) => update((f) => (f.streak.who = asWho(v)))} options={whoOptions} />
      <NumberField label="최소 연속 일수" value={flow.streak.minDays} min={1} max={60} step={1} suffix="일 이상" muted={!flow.streak.on} {...nf('flow-streak')} onchange={(v) => update((f) => (f.streak.minDays = v))} />
    </fieldset>
  </ConditionRow>
</div>

<style>
  .flow {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .flow > :global(.cond:first-of-type) {
    border-top: 1px solid var(--line);
    padding-top: 12px;
  }
  .fs {
    border: 0;
    margin: 0;
    padding: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
</style>
