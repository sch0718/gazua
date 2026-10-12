<script lang="ts">
  // 매수: 하락 조건 2줄, 트리거 4줄, 필터 1줄(스펙 7.3).
  import type { Strategy } from '../../../sim/types';
  import Segmented from '../../components/Segmented.svelte';
  import Toggle from '../../components/Toggle.svelte';
  import NumberField from './NumberField.svelte';
  import PatternHelp from './PatternHelp.svelte';

  let { s, update }: { s: Strategy; update: (fn: (s: Strategy) => void) => void } = $props();
  const d = $derived(s.entry.decline);
  const t = $derived(s.entry.triggers);
  const f = $derived(s.entry.filter.aboveMa);
</script>

<p class="group-title">① 먼저 이만큼 떨어져야 해요</p>
<p class="hint">켠 조건을 모두 만족해야 하고, 둘 다 끄면 항상 만족해요.</p>
<div class="row">
  <Toggle label="하락폭 조건 사용" checked={d.dropPct.on} onchange={(v) => update((x) => (x.entry.decline.dropPct.on = v))} />
  <NumberField label="고점 대비 하락폭" value={d.dropPct.value} min={1} max={90} suffix="% 이상" onchange={(v) => update((x) => (x.entry.decline.dropPct.value = v))} />
</div>
<div class="row">
  <Toggle label="하락 기간 조건 사용" checked={d.days.on} onchange={(v) => update((x) => (x.entry.decline.days.on = v))} />
  <NumberField label="고점 뒤 지난 거래일" value={d.days.value} min={1} max={60} step={1} suffix="일 이상" onchange={(v) => update((x) => (x.entry.decline.days.value = v))} />
</div>

<p class="group-title">② 그다음 이 중 하나가 나오면 사요</p>
<div class="row">
  <Toggle label="연속 상승 트리거 사용" checked={t.reboundDays.on} onchange={(v) => update((x) => (x.entry.triggers.reboundDays.on = v))} />
  <NumberField label="저점 뒤 연속 상승" value={t.reboundDays.value} min={1} max={60} step={1} suffix="일 이상" onchange={(v) => update((x) => (x.entry.triggers.reboundDays.value = v))} />
</div>
<div class="row">
  <Toggle label="전 고점 돌파 트리거 사용" checked={t.breakout.on} onchange={(v) => update((x) => (x.entry.triggers.breakout.on = v))} />
  <span class="cap">전 고점 돌파</span>
</div>
<Segmented
  wide
  label="전 고점"
  value={t.breakout.level}
  onchange={(v) => update((x) => (x.entry.triggers.breakout.level = v as 'A' | 'B'))}
  options={[
    { value: 'A', label: 'A 하락 시작 전 고점' },
    { value: 'B', label: 'B 마지막 반등 고점' },
  ]}
/>
<PatternHelp />
<div class="row">
  <Toggle label="이동평균선 돌파 트리거 사용" checked={t.maCross.on} onchange={(v) => update((x) => (x.entry.triggers.maCross.on = v))} />
  <NumberField label="이동평균선 돌파" value={t.maCross.period} min={2} max={250} step={1} suffix="일선" onchange={(v) => update((x) => (x.entry.triggers.maCross.period = v))} />
</div>
<div class="row">
  <Toggle label="골든크로스 트리거 사용" checked={t.goldenCross.on} onchange={(v) => update((x) => (x.entry.triggers.goldenCross.on = v))} />
  <span class="cap">골든크로스</span>
</div>
<div class="indent">
  <div class="row">
    <NumberField label="짧은 이동평균" value={t.goldenCross.short} min={2} max={250} step={1} suffix="일" onchange={(v) => update((x) => (x.entry.triggers.goldenCross.short = v))} />
  </div>
  <div class="row">
    <NumberField label="긴 이동평균" value={t.goldenCross.long} min={2} max={250} step={1} suffix="일" onchange={(v) => update((x) => (x.entry.triggers.goldenCross.long = v))} />
  </div>
</div>

<p class="group-title">③ 이 조건일 때만 사요 (선택)</p>
<div class="row">
  <Toggle label="이동평균선 위 필터 사용" checked={f.on} onchange={(v) => update((x) => (x.entry.filter.aboveMa.on = v))} />
  <NumberField label="종가가 이동평균선 위" value={f.period} min={2} max={250} step={1} suffix="일선" onchange={(v) => update((x) => (x.entry.filter.aboveMa.period = v))} />
</div>

<style>
  .cap {
    font-size: var(--fs-body);
  }
  .indent {
    padding-left: 60px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
</style>
