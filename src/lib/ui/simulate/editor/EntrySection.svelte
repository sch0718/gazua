<script lang="ts">
  // 매수: 하락 조건 2줄, 트리거 4줄, 필터 1줄(스펙 7.3). 줄마다 라벨 · 숫자 칸 · 오른쪽 토글(이름 `{라벨} 사용`).
  import type { Strategy } from '../../../sim/types';
  import Segmented from '../../components/Segmented.svelte';
  import Toggle from '../../components/Toggle.svelte';
  import NumberField from './NumberField.svelte';
  import PatternHelp from './PatternHelp.svelte';

  let { s, update }: { s: Strategy; update: (fn: (s: Strategy) => void) => void } = $props();
  const d = $derived(s.entry.decline);
  const t = $derived(s.entry.triggers);
  const f = $derived(s.entry.filter.aboveMa);
  const uid = Math.random().toString(36).slice(2, 9);
</script>

<p class="group-title">① 먼저 이만큼 떨어져야 해요</p>
<p class="hint">켠 조건을 모두 만족해야 하고, 둘 다 끄면 항상 만족해요.</p>
<div class="row">
  <NumberField
    label="고점 대비 하락폭"
    value={d.dropPct.value}
    min={1}
    max={90}
    suffix="% 이상"
    muted={!d.dropPct.on}
    toggle={{ checked: d.dropPct.on, onchange: (v) => update((x) => (x.entry.decline.dropPct.on = v)) }}
    onchange={(v) => update((x) => (x.entry.decline.dropPct.value = v))}
  />
</div>
<div class="row">
  <NumberField
    label="고점 뒤 지난 거래일"
    value={d.days.value}
    min={1}
    max={60}
    step={1}
    suffix="일 이상"
    muted={!d.days.on}
    toggle={{ checked: d.days.on, onchange: (v) => update((x) => (x.entry.decline.days.on = v)) }}
    onchange={(v) => update((x) => (x.entry.decline.days.value = v))}
  />
</div>

<p class="group-title">② 그다음 이 중 하나가 나오면 사요</p>
<div class="row">
  <NumberField
    label="저점 뒤 연속 상승"
    value={t.reboundDays.value}
    min={1}
    max={60}
    step={1}
    suffix="일 이상"
    muted={!t.reboundDays.on}
    toggle={{ checked: t.reboundDays.on, onchange: (v) => update((x) => (x.entry.triggers.reboundDays.on = v)) }}
    onchange={(v) => update((x) => (x.entry.triggers.reboundDays.value = v))}
  />
</div>
<div class="row">
  <label for="{uid}-bo">전 고점 돌파</label>
  <Toggle id="{uid}-bo" label="전 고점 돌파 사용" checked={t.breakout.on} onchange={(v) => update((x) => (x.entry.triggers.breakout.on = v))} />
</div>
<div class:muted={!t.breakout.on}>
  <Segmented
    wide
    onSurface
    label="전 고점"
    value={t.breakout.level}
    onchange={(v) => update((x) => (x.entry.triggers.breakout.level = v as 'A' | 'B'))}
    options={[
      { value: 'A', label: 'A 하락 시작 전 고점' },
      { value: 'B', label: 'B 마지막 반등 고점' },
    ]}
  />
</div>
<PatternHelp />
<div class="row">
  <NumberField
    label="이동평균선 돌파"
    value={t.maCross.period}
    min={2}
    max={250}
    step={1}
    suffix="일선"
    muted={!t.maCross.on}
    toggle={{ checked: t.maCross.on, onchange: (v) => update((x) => (x.entry.triggers.maCross.on = v)) }}
    onchange={(v) => update((x) => (x.entry.triggers.maCross.period = v))}
  />
</div>
<div class="row">
  <label for="{uid}-gc">골든크로스</label>
  <Toggle id="{uid}-gc" label="골든크로스 사용" checked={t.goldenCross.on} onchange={(v) => update((x) => (x.entry.triggers.goldenCross.on = v))} />
</div>
<div class="indent">
  <div class="row">
    <NumberField label="짧은 이동평균" value={t.goldenCross.short} min={2} max={250} step={1} suffix="일" muted={!t.goldenCross.on} onchange={(v) => update((x) => (x.entry.triggers.goldenCross.short = v))} />
  </div>
  <div class="row">
    <NumberField label="긴 이동평균" value={t.goldenCross.long} min={2} max={250} step={1} suffix="일" muted={!t.goldenCross.on} onchange={(v) => update((x) => (x.entry.triggers.goldenCross.long = v))} />
  </div>
</div>

<p class="group-title">③ 이 조건일 때만 사요 (선택)</p>
<div class="row">
  <NumberField
    label="종가가 이동평균선 위"
    value={f.period}
    min={2}
    max={250}
    step={1}
    suffix="일선"
    muted={!f.on}
    toggle={{ checked: f.on, onchange: (v) => update((x) => (x.entry.filter.aboveMa.on = v)) }}
    onchange={(v) => update((x) => (x.entry.filter.aboveMa.period = v))}
  />
</div>

<style>
  /* 전 고점 돌파를 끄면 A/B는 글자만 --t3로(투명도는 대비를 깨므로 쓰지 않는다; --bg 위 4.86:1 · 선택 --surface2 위 4.61:1, 다크 5.60 · 4.71) */
  .muted :global(.seg button[role='radio']) {
    color: var(--t3);
  }
  .muted :global(.seg button[role='radio'].on) {
    box-shadow: none;
  }
  /* 오른쪽은 토글 폭(52) + 간격(12)만큼 비워 위아래 숫자 칸과 줄을 맞춘다 */
  .indent {
    padding: 0 64px 0 16px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
</style>
