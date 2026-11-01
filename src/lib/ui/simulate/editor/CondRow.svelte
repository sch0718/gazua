<script lang="ts">
  // 조건 한 줄(스펙 §10.2): 종류 선택 → 종류별 숫자 칸 → 지우기. 반등 패턴이면 아래에 PatternFields를 펼친다.
  // 종류를 바꾸면 그 종류의 기본값으로 바꾼다(앞 종류 값은 기억하지 않는다).
  import { defaultCond } from '../../../sim/strategyV2';
  import type { Cond } from '../../../sim/types';
  import { COND_KINDS } from './condKinds';
  import NumberField from './NumberField.svelte';
  import PatternFields from './PatternFields.svelte';

  let {
    cond,
    label,
    allowPattern,
    patternTaken,
    update,
    onremove,
  }: {
    cond: Cond;
    /** `매수 묶음 1의 조건 2` — 칸·지우기 버튼 이름의 앞부분 */
    label: string;
    allowPattern: boolean;
    /** 다른 줄이 반등 패턴을 쓰고 있으면 true(이 줄 선택지에서 막는다) */
    patternTaken: boolean;
    /** 이 줄을 바꾼다. 반환값이 있으면 그 조건으로 갈아 끼운다 */
    update: (fn: (c: Cond) => Cond | void) => void;
    onremove: () => void;
  } = $props();

  const titleId = $props.id();
  let kindEl: HTMLSelectElement;
  /** 새 줄을 더한 뒤 종류 선택으로 포커스 */
  export function focusKind() {
    kindEl?.focus();
  }
  const set = <K extends Cond['kind']>(kind: K, fn: (c: Extract<Cond, { kind: K }>) => void) =>
    update((c) => {
      if (c.kind === kind) fn(c as Extract<Cond, { kind: K }>);
    });
</script>

<div class="cond" role="group" aria-label={label}>
  <span id={titleId} class="sr-only">{label}</span>
  <div class="head">
    <span id="{titleId}-kind" class="sr-only">종류</span>
    <select
      class="pick"
      bind:this={kindEl}
      aria-labelledby="{titleId} {titleId}-kind"
      value={cond.kind}
      onchange={(e) => {
        const kind = e.currentTarget.value as Cond['kind'];
        update(() => defaultCond(kind, Date.now()));
      }}
    >
      {#each COND_KINDS as k (k.kind)}
        {#if k.kind !== 'pattern' || allowPattern}
          <option value={k.kind} disabled={k.kind === 'pattern' && patternTaken && cond.kind !== 'pattern'}>{k.label}</option>
        {/if}
      {/each}
    </select>
    <button type="button" class="x danger" aria-label="{label} 지우기" onclick={onremove}>✕</button>
  </div>
  {#if cond.kind === 'maPrice'}
    <div class="row"><NumberField namePrefixId={titleId} label="이동평균" value={cond.period} min={2} max={250} step={1} suffix="일선" onchange={(v) => set('maPrice', (c) => (c.period = v))} /></div>
    <label class="sel"><span id="{titleId}-side">종가가</span>
      <select class="pick" aria-labelledby="{titleId} {titleId}-side" value={cond.side} onchange={(e) => set('maPrice', (c) => (c.side = e.currentTarget.value as 'above' | 'below'))}>
        <option value="above">위</option><option value="below">아래</option>
      </select>
    </label>
  {:else if cond.kind === 'maCross'}
    <div class="row"><NumberField namePrefixId={titleId} label="짧은 이동평균" value={cond.short} min={2} max={250} step={1} suffix="일" onchange={(v) => set('maCross', (c) => (c.short = v))} /></div>
    <div class="row"><NumberField namePrefixId={titleId} label="긴 이동평균" value={cond.long} min={2} max={250} step={1} suffix="일" onchange={(v) => set('maCross', (c) => (c.long = v))} /></div>
    <label class="sel"><span id="{titleId}-dir">교차</span>
      <select class="pick" aria-labelledby="{titleId} {titleId}-dir" value={cond.dir} onchange={(e) => set('maCross', (c) => (c.dir = e.currentTarget.value as 'golden' | 'dead'))}>
        <option value="golden">골든크로스</option><option value="dead">데드크로스</option>
      </select>
    </label>
  {:else if cond.kind === 'rsi'}
    <div class="row"><NumberField namePrefixId={titleId} label="RSI 기간" value={cond.period} min={2} max={50} step={1} suffix="일" onchange={(v) => set('rsi', (c) => (c.period = v))} /></div>
    <div class="row"><NumberField namePrefixId={titleId} label="기준" value={cond.level} min={1} max={99} onchange={(v) => set('rsi', (c) => (c.level = v))} /></div>
    <label class="sel"><span id="{titleId}-op">RSI가 기준</span>
      <select class="pick" aria-labelledby="{titleId} {titleId}-op" value={cond.op} onchange={(e) => set('rsi', (c) => (c.op = e.currentTarget.value as typeof c.op))}>
        <option value="above">위</option><option value="below">아래</option><option value="crossUp">상향 돌파</option><option value="crossDown">하향 돌파</option>
      </select>
    </label>
  {:else if cond.kind === 'volume'}
    <div class="row"><NumberField namePrefixId={titleId} label="평균 기간" value={cond.days} min={2} max={120} step={1} suffix="일" onchange={(v) => set('volume', (c) => (c.days = v))} /></div>
    <div class="row"><NumberField namePrefixId={titleId} label="거래량" value={cond.ratio} min={1} max={20} suffix="배 이상" onchange={(v) => set('volume', (c) => (c.ratio = v))} /></div>
  {:else if cond.kind === 'change'}
    <div class="row"><NumberField namePrefixId={titleId} label="기간" value={cond.days} min={1} max={250} step={1} suffix="일" onchange={(v) => set('change', (c) => (c.days = v))} /></div>
    <div class="row"><NumberField namePrefixId={titleId} label="등락률" value={cond.pct} min={-90} max={500} suffix="%" onchange={(v) => set('change', (c) => (c.pct = v))} /></div>
    <label class="sel"><span id="{titleId}-op">등락률이</span>
      <select class="pick" aria-labelledby="{titleId} {titleId}-op" value={cond.op} onchange={(e) => set('change', (c) => (c.op = e.currentTarget.value as 'above' | 'below'))}>
        <option value="above">이상</option><option value="below">이하</option>
      </select>
    </label>
  {:else if cond.kind === 'fromHigh'}
    <div class="row"><NumberField namePrefixId={titleId} label="고점 기간" value={cond.days} min={2} max={250} step={1} suffix="일" onchange={(v) => set('fromHigh', (c) => (c.days = v))} /></div>
    <div class="row"><NumberField namePrefixId={titleId} label="하락폭" value={cond.pct} min={1} max={90} suffix="% 이상" onchange={(v) => set('fromHigh', (c) => (c.pct = v))} /></div>
  {:else if cond.kind === 'newHigh'}
    <div class="row"><NumberField namePrefixId={titleId} label="신고가 기간" value={cond.days} min={2} max={250} step={1} suffix="일" onchange={(v) => set('newHigh', (c) => (c.days = v))} /></div>
  {:else}
    <PatternFields entry={cond.entry} nf={() => ({ namePrefixId: titleId })} update={(fn) => set('pattern', (c) => fn(c.entry))} />
  {/if}
</div>

<style>
  .cond {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 0;
    border-top: 1px solid var(--line);
  }
  .head {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .head .pick {
    flex: 1;
    min-width: 0;
  }
  .pick {
    min-height: 44px;
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: var(--r-chip);
    background: var(--surface);
    color: var(--t1);
    font: inherit;
  }
  .x {
    min-width: 44px;
    min-height: 44px;
  }
  .sel {
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
  }
</style>
