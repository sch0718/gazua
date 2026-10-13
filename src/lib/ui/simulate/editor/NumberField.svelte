<script lang="ts">
  // 숫자 칸 한 줄: 라벨 · 숫자 칸 · (있으면) 오른쪽 토글 — 설정 화면 .row와 같은 순서.
  // 토글이 있으면 라벨은 토글과 연결된다(라벨을 누르면 켜고 끈다). 숫자 칸 박스는 입력과 연결된 label이라 어디를 눌러도 입력에 포커스.
  // 토글 이름은 `{라벨} 사용`(보이는 라벨로 시작, WCAG 2.5.3). 단위·금액 힌트·오류는 입력의 설명(aria-describedby).
  import { tick, untrack } from 'svelte';
  import Toggle from '../../components/Toggle.svelte';
  import { fmtWon } from '../../format';
  import { money } from '../simText';

  let {
    label,
    value,
    min,
    max,
    step,
    suffix,
    onchange,
    muted = false,
    format,
    toggle,
    namePrefixId,
  }: {
    label: string;
    value: number;
    min: number;
    max: number;
    /** 정수면 소수 입력을 막는다 */
    step?: number;
    suffix?: string;
    onchange: (v: number) => void;
    /** 꺼진 조건의 칸: 흐리게 보이지만 계속 고칠 수 있다 */
    muted?: boolean;
    /** 'won': 포커스가 없을 때 천 단위로 보이고 아래에 `= 1,000만 원` */
    format?: 'won';
    /** 같은 줄 오른쪽 토글(이름 `{label} 사용`). 라벨이 이 토글과 연결된다 */
    toggle?: { checked: boolean; onchange: (v: boolean) => void };
    /** 입력 이름 앞에 붙일 요소 id(예: 익절 `1단계` 제목 → `1단계 목표`). 보이는 라벨은 그대로 */
    namePrefixId?: string;
  } = $props();

  const uid = Math.random().toString(36).slice(2, 9);
  const inputId = `nf-${uid}`;
  const toggleId = `nf-${uid}-t`;
  const integer = $derived(step !== undefined && Number.isInteger(step));
  const won = $derived(format === 'won');

  let focused = $state(false);
  const show = (v: number) => (won && !focused ? fmtWon(v) : String(v));
  let text = $state(untrack(() => show(value)));
  let bad = $state(false);
  let inputEl: HTMLInputElement;
  // 금액 힌트(`= 1억 2,000만 원`)는 만 원 단위일 때만. 아니면 값과 같은 글이라 숨긴다
  const showMoney = $derived(won && !bad && value % 10_000 === 0);

  // 붙여 넣은 `10,000,000원`·`1 000 000`도 숫자로 읽는다
  function parse(t: string): number {
    const clean = t.replace(/[,\s원]/g, '');
    return clean === '' ? NaN : Number(clean);
  }
  const inRange = (v: number) => Number.isFinite(v) && v >= min && v <= max;
  const valid = (v: number) => inRange(v) && (!integer || Number.isInteger(v));

  const bound = (n: number) => (won ? fmtWon(n) : String(n));
  const errText = $derived(
    inRange(parse(text)) && integer ? '정수로 적어 주세요' : `${bound(min)}~${bound(max)} 사이로 적어 주세요`,
  );

  // 밖에서 값이 바뀌면(다른 칸·되돌리기) 입력 칸도 맞춘다. 고치는 중인 틀린 입력은 건드리지 않는다.
  $effect(() => {
    const v = value;
    untrack(() => {
      if (!bad && parse(text) !== v) text = show(v);
    });
  });

  const describedBy = $derived(
    [suffix ? `${inputId}-sfx` : null, bad ? `${inputId}-err` : showMoney ? `${inputId}-money` : null].filter(Boolean).join(' ') || undefined,
  );

  function oninput() {
    const v = parse(text);
    bad = !valid(v);
    if (!bad && v !== value) onchange(v);
  }

  function onfocus() {
    focused = true;
    if (won && !bad) {
      // Tab으로 들어오면 브라우저가 전체를 선택한다. 쉼표를 빼며 값을 바꾸면 선택이 풀리므로 다시 전체 선택한다
      const all = inputEl.value.length > 0 && inputEl.selectionStart === 0 && inputEl.selectionEnd === inputEl.value.length;
      text = String(value);
      if (all) void tick().then(() => document.activeElement === inputEl && inputEl.select());
    }
  }

  function onblur() {
    focused = false;
    bad = false;
    text = show(value);
  }
</script>

<div class="field" class:muted class:won class:has-toggle={!!toggle}>
  <label class="lab" id="{inputId}-l" for={toggle ? toggleId : inputId}>{label}</label>
  <label class="box" class:bad for={inputId}>
    <input
      id={inputId}
      class="num"
      type="text"
      inputmode="decimal"
      autocomplete="off"
      aria-labelledby={namePrefixId ? `${namePrefixId} ${inputId}-l` : `${inputId}-l`}
      bind:value={text}
      bind:this={inputEl}
      {oninput}
      {onfocus}
      {onblur}
      aria-invalid={bad ? 'true' : undefined}
      aria-describedby={describedBy}
    />
    {#if suffix}<span class="suffix" id="{inputId}-sfx">{suffix}</span>{/if}
  </label>
  {#if toggle}
    <Toggle id={toggleId} label="{label} 사용" checked={toggle.checked} onchange={toggle.onchange} />
  {/if}
  {#if bad}
    <p class="err" id="{inputId}-err" role="alert">{errText}</p>
  {:else if showMoney}
    <p class="money num" id="{inputId}-money">= {money(value)}</p>
  {/if}
</div>

<style>
  .field {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    column-gap: 12px;
    flex: 1;
    min-width: 0;
  }
  .field.has-toggle {
    grid-template-columns: minmax(0, 1fr) auto auto;
  }
  .lab {
    font-size: var(--fs-body);
    color: var(--t1);
    word-break: keep-all;
    overflow-wrap: break-word;
  }
  .box {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    min-width: 128px;
    min-height: var(--touch);
    padding: 0 12px;
    border-radius: 10px;
    background: var(--surface2);
    border: 1px solid transparent;
    cursor: text;
  }
  .box:focus-within {
    border-color: var(--accent);
  }
  .box.bad {
    border-color: var(--err);
  }
  /* 꺼진 조건: 계속 고칠 수 있으므로 투명도로 흐리지 않는다(글자 대비 AA).
     박스 배경을 빼고 테두리는 --t3 1px 점선(켜진 칸과 모양으로도 구분, 경계 3:1 이상), 글자도 --t3
     (--surface 위 라이트 5.21:1 · 다크 5.19:1) */
  .muted .box {
    background: transparent;
    border: 1px dashed var(--t3);
  }
  /* 포커스·오류는 실선(입력에 outline이 없어 이 테두리가 포커스 표시다) */
  .muted .box:focus-within {
    border-style: solid;
    border-color: var(--accent);
  }
  .muted .box.bad {
    border-style: solid;
    border-color: var(--err);
  }
  input {
    width: 7ch;
    min-width: 0;
    border: 0;
    background: none;
    color: var(--t1);
    font-size: 16px;
    text-align: right;
    outline: none;
    padding: 0;
  }
  /* 천 단위 쉼표가 들어가므로 최댓값 `10,000,000,000,000`(18자)까지 보이게.
     좁은 화면에서는 라벨이 가장 긴 낱말 폭(min-content)을 지키고 숫자 칸 박스가 남은 폭으로 줄어든다 */
  .field.won {
    grid-template-columns: minmax(min-content, 1fr) minmax(0, auto);
  }
  .won input {
    width: 18ch;
  }
  /* 아주 좁은 폭에서도 박스가 줄 밖으로 나가지 않게(128px 하한을 풀고 칸 폭까지만) */
  .won .box {
    min-width: 0;
    max-width: 100%;
  }
  .suffix {
    font-size: var(--fs-sub);
    color: var(--t2);
    white-space: nowrap;
  }
  .muted input,
  .muted .suffix {
    color: var(--t3);
  }
  .err,
  .money {
    grid-column: 1 / -1;
    margin: 4px 0 0;
    font-size: var(--fs-sub);
    text-align: right;
  }
  .err {
    color: var(--err);
  }
  .money {
    color: var(--t3);
  }
</style>
