<script lang="ts">
  // 환율·유가 소구역(스펙 5.2): 계열마다(원/달러, WTI) 민감도와 흐름 따라가기 두 줄 + 공통 민감도 계산 기간.
  // 데이터에 환율·유가가 없으면(v1) 새로 켜는 것과 값 고치기를 막는다. 이미 켜져 있던 조건은 끌 수 있다.
  import type { MacroSeriesKey, SelectionCriteria } from '../../screen/types';
  import Segmented from '../components/Segmented.svelte';
  import NumberField from '../simulate/editor/NumberField.svelte';
  import ConditionRow from './ConditionRow.svelte';
  import { macroBetaHelp, macroTrendHelp, NEED_RECOLLECT_TEXT, SERIES_LABEL, SERIES_ORDER } from './screenText';

  type Macro = SelectionCriteria['conditions']['macro'];
  type NF = (key: string) => { keepInvalid: boolean; invalidText: string | undefined; oninvalid: (bad: boolean, text: string) => void };

  let {
    macro,
    update,
    nf,
    unavailable = false,
  }: {
    macro: Macro;
    update: (fn: (m: Macro) => void) => void;
    nf: NF;
    /** 이 데이터에는 환율·유가가 없다 */
    unavailable?: boolean;
  } = $props();

  const lab = (k: MacroSeriesKey) => SERIES_LABEL[k];
</script>

<div class="macro">
  <p class="group-title">환율·유가</p>
  {#if unavailable}<p class="hint" id="macro-off">{NEED_RECOLLECT_TEXT}</p>{/if}
  <fieldset class="fs" disabled={unavailable} aria-describedby={unavailable ? 'macro-off' : undefined}>
    <NumberField
      label="민감도 계산 기간"
      value={macro.betaDays}
      min={30}
      max={250}
      step={1}
      suffix="거래일"
      {...nf('fx-days')}
      onchange={(v) => update((m) => (m.betaDays = v))}
    />
  </fieldset>
  {#each SERIES_ORDER as key (key)}
    {@const m = macro[key]}
    <ConditionRow label="{lab(key)} 민감도" help={macroBetaHelp(key)} on={m.beta.on} disabled={unavailable && !m.beta.on} ontoggle={(v) => update((x) => (x[key].beta.on = v))}>
      <fieldset class="fs" disabled={unavailable}>
        <NumberField label="{lab(key)} 최소 민감도" value={m.beta.min} min={-20} max={20} suffix="이상" muted={!m.beta.on} {...nf(`fx-${key}-bmin`)} onchange={(v) => update((x) => (x[key].beta.min = v))} />
        <NumberField label="{lab(key)} 최대 민감도" value={m.beta.max} min={-20} max={20} suffix="이하" muted={!m.beta.on} {...nf(`fx-${key}-bmax`)} onchange={(v) => update((x) => (x[key].beta.max = v))} />
      </fieldset>
    </ConditionRow>
    <ConditionRow label="{lab(key)} 흐름 따라가기" help={macroTrendHelp(key)} on={m.trend.on} disabled={unavailable && !m.trend.on} ontoggle={(v) => update((x) => (x[key].trend.on = v))}>
      <fieldset class="fs" disabled={unavailable}>
        <NumberField label="{lab(key)} 흐름 기간" value={m.trend.lookback} min={5} max={120} step={1} suffix="일" muted={!m.trend.on} {...nf(`fx-${key}-tlb`)} onchange={(v) => update((x) => (x[key].trend.lookback = v))} />
        <NumberField label="{lab(key)} 흐름 기준" value={m.trend.thresholdPct} min={0.5} max={50} suffix="% 이상 움직이면" muted={!m.trend.on} {...nf(`fx-${key}-tth`)} onchange={(v) => update((x) => (x[key].trend.thresholdPct = v))} />
        <NumberField label="{lab(key)} 흐름 최소 민감도" value={m.trend.minAbsBeta} min={0} max={20} suffix="이상" muted={!m.trend.on} {...nf(`fx-${key}-tmb`)} onchange={(v) => update((x) => (x[key].trend.minAbsBeta = v))} />
        <Segmented
          wide
          onSurface
          label="{lab(key)} 흐름이 약할 때"
          value={m.trend.whenFlat}
          onchange={(v) => update((x) => (x[key].trend.whenFlat = v === 'none' ? 'none' : 'pass'))}
          options={[
            { value: 'pass', label: '이 조건 건너뛰기' },
            { value: 'none', label: '현금으로 두기' },
          ]}
        />
      </fieldset>
    </ConditionRow>
  {/each}
</div>

<style>
  .macro {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .macro > :global(.cond:first-of-type) {
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
