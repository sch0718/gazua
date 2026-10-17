<script lang="ts">
  // 재무·가치 소구역(재무 스펙 4.1): 가치 · 수익성 · 성장 · 안정성 네 묶음 + 공통 안내.
  // 데이터에 재무가 없으면(v3까지) 새로 켜는 것과 값 고치기를 막는다. 이미 켜져 있던 조건은 끌 수 있다(FlowConditions와 같다).
  import type { SelectionCriteria } from '../../screen/types';
  import NumberField from '../simulate/editor/NumberField.svelte';
  import ConditionRow from './ConditionRow.svelte';
  import {
    FIN_DEBT_HELP,
    FIN_GROWTH_HELP,
    FIN_LAG_HINT,
    FIN_METRIC_LABEL as L,
    FIN_OP_MARGIN_HELP,
    FIN_PBR_HELP,
    FIN_PER_HELP,
    FIN_PROFITABLE_HELP,
    FIN_PROFITABLE_LABEL,
    FIN_ROE_HELP,
    NEED_RECOLLECT_TEXT,
  } from './screenText';

  type Fin = SelectionCriteria['conditions']['fin'];
  type NF = (key: string) => { keepInvalid: boolean; invalidText: string | undefined; oninvalid: (bad: boolean, text: string) => void };

  let {
    fin,
    update,
    nf,
    unavailable = false,
  }: {
    fin: Fin;
    update: (fn: (f: Fin) => void) => void;
    nf: NF;
    /** 이 데이터에는 재무 정보가 없다 */
    unavailable?: boolean;
  } = $props();

  const uid = Math.random().toString(36).slice(2, 9);
  const offId = `fin-off-${uid}`;
  // 데이터에 없으면 새로 켜는 것만 막는다. 이미 켜진 조건은 끌 수 있고, 끈 뒤에도 토글이 포커스를 지킨다
  const gate = (turn: (v: boolean) => void) => (v: boolean) => {
    if (unavailable && v) return;
    turn(v);
  };
  const row = (on: boolean) => ({ on, softDisabled: unavailable && !on, describedby: unavailable ? offId : undefined });
</script>

<div class="fin">
  <p class="group-title">재무·가치</p>
  <p class="hint">{FIN_LAG_HINT}</p>
  {#if unavailable}<p class="hint" id={offId}>{NEED_RECOLLECT_TEXT}</p>{/if}

  <p class="sub-title">가치</p>
  <ConditionRow label={L.per} help={FIN_PER_HELP} {...row(fin.per.on)} ontoggle={gate((v) => update((f) => (f.per.on = v)))}>
    <fieldset class="fs" disabled={unavailable}>
      <NumberField label="최소 PER" value={fin.per.min} min={0} max={1000} suffix="배 이상" muted={!fin.per.on} {...nf('fin-per-min')} onchange={(v) => update((f) => (f.per.min = v))} />
      <NumberField label="최대 PER" value={fin.per.max} min={0} max={1000} suffix="배 이하" muted={!fin.per.on} {...nf('fin-per-max')} onchange={(v) => update((f) => (f.per.max = v))} />
    </fieldset>
  </ConditionRow>
  <ConditionRow label={L.pbr} help={FIN_PBR_HELP} {...row(fin.pbr.on)} ontoggle={gate((v) => update((f) => (f.pbr.on = v)))}>
    <fieldset class="fs" disabled={unavailable}>
      <NumberField label="최소 PBR" value={fin.pbr.min} min={0} max={100} suffix="배 이상" muted={!fin.pbr.on} {...nf('fin-pbr-min')} onchange={(v) => update((f) => (f.pbr.min = v))} />
      <NumberField label="최대 PBR" value={fin.pbr.max} min={0} max={100} suffix="배 이하" muted={!fin.pbr.on} {...nf('fin-pbr-max')} onchange={(v) => update((f) => (f.pbr.max = v))} />
    </fieldset>
  </ConditionRow>

  <p class="sub-title">수익성</p>
  <ConditionRow label={L.roe} help={FIN_ROE_HELP} {...row(fin.roe.on)} ontoggle={gate((v) => update((f) => (f.roe.on = v)))}>
    <fieldset class="fs" disabled={unavailable}>
      <NumberField label="최소 ROE" value={fin.roe.min} min={-100} max={100} suffix="% 이상" muted={!fin.roe.on} {...nf('fin-roe')} onchange={(v) => update((f) => (f.roe.min = v))} />
    </fieldset>
  </ConditionRow>
  <ConditionRow label={L.opMargin} help={FIN_OP_MARGIN_HELP} {...row(fin.opMargin.on)} ontoggle={gate((v) => update((f) => (f.opMargin.on = v)))}>
    <fieldset class="fs" disabled={unavailable}>
      <NumberField label="최소 영업이익률" value={fin.opMargin.min} min={-100} max={100} suffix="% 이상" muted={!fin.opMargin.on} {...nf('fin-om')} onchange={(v) => update((f) => (f.opMargin.min = v))} />
    </fieldset>
  </ConditionRow>

  <p class="sub-title">성장</p>
  <ConditionRow label={L.revGrowth} help={FIN_GROWTH_HELP} {...row(fin.revGrowth.on)} ontoggle={gate((v) => update((f) => (f.revGrowth.on = v)))}>
    <fieldset class="fs" disabled={unavailable}>
      <NumberField label="최소 매출 증가율" value={fin.revGrowth.min} min={-100} max={1000} suffix="% 이상" muted={!fin.revGrowth.on} {...nf('fin-rg')} onchange={(v) => update((f) => (f.revGrowth.min = v))} />
    </fieldset>
  </ConditionRow>
  <ConditionRow label={L.opGrowth} help={FIN_GROWTH_HELP} {...row(fin.opGrowth.on)} ontoggle={gate((v) => update((f) => (f.opGrowth.on = v)))}>
    <fieldset class="fs" disabled={unavailable}>
      <NumberField label="최소 영업이익 증가율" value={fin.opGrowth.min} min={-100} max={1000} suffix="% 이상" muted={!fin.opGrowth.on} {...nf('fin-og')} onchange={(v) => update((f) => (f.opGrowth.min = v))} />
    </fieldset>
  </ConditionRow>

  <p class="sub-title">안정성</p>
  <ConditionRow label={L.debtRatio} help={FIN_DEBT_HELP} {...row(fin.debtRatio.on)} ontoggle={gate((v) => update((f) => (f.debtRatio.on = v)))}>
    <fieldset class="fs" disabled={unavailable}>
      <NumberField label="최대 부채비율" value={fin.debtRatio.max} min={0} max={10000} suffix="% 이하" muted={!fin.debtRatio.on} {...nf('fin-dr')} onchange={(v) => update((f) => (f.debtRatio.max = v))} />
    </fieldset>
  </ConditionRow>
  <ConditionRow label={FIN_PROFITABLE_LABEL} help={FIN_PROFITABLE_HELP} {...row(fin.profitable.on)} ontoggle={gate((v) => update((f) => (f.profitable.on = v)))} />
</div>

<style>
  .fin {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .fin > :global(.cond:first-of-type) {
    border-top: 1px solid var(--line);
    padding-top: 12px;
  }
  .sub-title {
    margin: 8px 0 0;
    font-size: var(--fs-sub);
    color: var(--t3);
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
