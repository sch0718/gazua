<script lang="ts">
  // 기간·자금: 시작일·종료일(KST), 처음 자금, 배분 방식.
  import { MAX_INITIAL } from '../../../sim/defaults';
  import { roundMoney } from '../../../sim/money';
  import type { SizingMode, Strategy } from '../../../sim/types';
  import { Segmented } from '@sch0718/ui-svelte';
  import { money } from '../simText';
  import NumberField from './NumberField.svelte';

  let { s, update, count }: { s: Strategy; update: (fn: (s: Strategy) => void) => void; count: number } = $props();

  const SUFFIX: Record<Exclude<SizingMode, 'equal'>, string> = { fixed: '% (처음 자금 대비)', equityPct: '% (그날 총자산 대비)', cashPct: '% (남은 현금 대비)' };

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  // 비우거나 덜 적은 값은 모델에 넣지 않고, 입력 표시를 모델 날짜로 되돌려 화면과 실행 기간을 같게 둔다
  function restore(key: 'from' | 'to', input: HTMLInputElement): boolean {
    if (DATE_RE.test(input.value)) return false;
    input.value = s.period[key];
    return true;
  }
  function setDate(key: 'from' | 'to', input: HTMLInputElement) {
    if (restore(key, input)) return;
    update((x) => (x.period[key] = input.value));
  }
</script>

<div class="dates">
  <label>
    <span>시작일</span>
    <input type="date" value={s.period.from} onchange={(e) => setDate('from', e.currentTarget)} onblur={(e) => restore('from', e.currentTarget)} />
  </label>
  <label>
    <span>종료일</span>
    <input type="date" value={s.period.to} onchange={(e) => setDate('to', e.currentTarget)} onblur={(e) => restore('to', e.currentTarget)} />
  </label>
</div>
<p class="hint">날짜는 한국 시간 기준이고, 시작일과 종료일 모두 포함해요.</p>
<div class="row">
  <NumberField label="처음 자금" value={s.capital.initial} min={1} max={MAX_INITIAL} step={1} suffix="원" format="won" onchange={(v) => update((x) => (x.capital.initial = v))} />
</div>
<span class="seg-label">배분 방식</span>
<Segmented
  wide
  wrap
  onSurface
  label="배분 방식"
  value={s.sizing.mode}
  onchange={(v) => update((x) => (x.sizing.mode = v as SizingMode))}
  options={[
    { value: 'fixed', label: '처음 자금' },
    { value: 'equityPct', label: '총자산' },
    { value: 'cashPct', label: '남은 현금' },
    { value: 'equal', label: '균등' },
  ]}
/>
{#if s.sizing.mode === 'equal'}
  <p class="hint">처음 자금 ÷ 종목 수(지금 {count}종목 → 회당 {money(count ? roundMoney(s.capital.initial / count) : 0)})</p>
{:else}
  <div class="row">
    <NumberField label="회당 비율" value={s.sizing.pct} min={1} max={100} suffix={SUFFIX[s.sizing.mode]} onchange={(v) => update((x) => (x.sizing.pct = v))} />
  </div>
{/if}

<style>
  .seg-label {
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  .dates {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 12px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  input {
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
  input:focus {
    border-color: var(--accent);
    outline: none;
  }
</style>
