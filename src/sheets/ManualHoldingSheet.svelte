<script lang="ts">
  // 직접 넣은 보유 종목 추가·수정. 종목은 종목 추가 시트(단일 선택)에서 골라 넘겨받는다.
  // 숫자 칸은 앱의 다른 숫자 칸(NumberField)처럼 글 입력 + 숫자 자판 + 단위이고, 칸을 떠나면 천 단위로 보여 준다.
  import { untrack } from 'svelte';
  import { Sheet } from '@sch0718/ui-svelte';
  import { ACCOUNT_LABEL_MAX, DEFAULT_ACCOUNT_LABEL } from '../lib/holdings/manual';
  import { fmtWon } from '../lib/ui/format';
  import { isImeComposing } from '../lib/ui/ime';

  export interface Draft {
    /** 수정이면 기존 항목 id */
    id: string | null;
    symbol: string;
    name: string;
    qty: number | null;
    avgPrice: number | null;
    /** 비어 있으면 저장할 때 `기타` */
    account: string;
  }

  let {
    open,
    draft,
    labels,
    onsave,
    ondelete,
    onclose,
  }: {
    open: boolean;
    draft: Draft | null;
    /** 이미 쓰는 계좌 라벨(빠른 선택용) */
    labels: string[];
    onsave: (d: Draft & { qty: number }) => void;
    ondelete: (id: string) => void;
    onclose: () => void;
  } = $props();

  const uid = Math.random().toString(36).slice(2, 9);
  let qtyText = $state('');
  let avgText = $state('');
  let account = $state('');
  let error = $state<{ field: 'qty' | 'avg'; text: string } | null>(null);

  const show = (n: number | null) => (n === null ? '' : fmtWon(n));
  /** 붙여 넣은 `1,200주`·`70,000원`도 숫자로 읽는다. 비어 있으면 null, 숫자가 아니면 NaN */
  function parse(t: string): number | null {
    const clean = t.replace(/[,\s원주]/g, '');
    return clean === '' ? null : Number(clean);
  }

  // 열 때마다 초안으로 채운다.
  $effect(() => {
    const d = draft;
    if (!open || !d) return;
    untrack(() => {
      qtyText = show(d.qty);
      avgText = show(d.avgPrice);
      account = d.account;
      error = null;
    });
  });

  function save() {
    if (!draft) return;
    const q = parse(qtyText);
    if (q === null || !Number.isInteger(q) || q < 1) {
      error = { field: 'qty', text: '수량은 1주 이상의 정수로 적어 주세요' };
      return;
    }
    const a = parse(avgText);
    if (a !== null && (!Number.isFinite(a) || a <= 0)) {
      error = { field: 'avg', text: '평균 매수가는 0보다 큰 숫자로 적어 주세요' };
      return;
    }
    onsave({ ...draft, qty: q, avgPrice: a, account });
  }

  /** 칸을 떠나면 천 단위로 보여 준다(틀린 글은 그대로 둔다). */
  function tidy(which: 'qty' | 'avg') {
    const t = which === 'qty' ? qtyText : avgText;
    const n = parse(t);
    if (n === null || !Number.isFinite(n)) return;
    if (which === 'qty') qtyText = fmtWon(n);
    else avgText = fmtWon(n);
  }
</script>

<Sheet {open} title={draft?.id ? '보유 종목 수정' : '보유 종목 추가'} {onclose}>
  {#if draft}
    <form
      class="wrap"
      novalidate
      onsubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <p class="stock"><b>{draft.name}</b> <span class="num">{draft.symbol}</span></p>

      <div class="field">
        <label for="mh-{uid}-q">수량</label>
        <span class="box" class:bad={error?.field === 'qty'}>
          <input
            id="mh-{uid}-q"
            class="num"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            bind:value={qtyText}
            onblur={() => tidy('qty')}
            data-autofocus
            aria-invalid={error?.field === 'qty' ? 'true' : undefined}
            aria-describedby={error?.field === 'qty' ? `mh-${uid}-err` : undefined}
          />
          <span class="suffix" aria-hidden="true">주</span>
        </span>
      </div>

      <div class="field">
        <label for="mh-{uid}-a">평균 매수가 <small>모르면 비워 둬요</small></label>
        <span class="box" class:bad={error?.field === 'avg'}>
          <input
            id="mh-{uid}-a"
            class="num"
            type="text"
            inputmode="decimal"
            autocomplete="off"
            bind:value={avgText}
            onblur={() => tidy('avg')}
            aria-invalid={error?.field === 'avg' ? 'true' : undefined}
            aria-describedby={error?.field === 'avg' ? `mh-${uid}-err` : undefined}
          />
          <span class="suffix" aria-hidden="true">원</span>
        </span>
      </div>

      <div class="field">
        <label for="mh-{uid}-l">계좌 라벨</label>
        <span class="box">
          <input
            id="mh-{uid}-l"
            type="text"
            bind:value={account}
            maxlength={ACCOUNT_LABEL_MAX}
            placeholder="{DEFAULT_ACCOUNT_LABEL} (예: 연금저축, ISA)"
            list="mh-{uid}-labels"
            autocomplete="off"
            onkeydown={(e) => {
              // 한글 조합을 확정하는 Enter로는 제출하지 않는다(마지막 글자가 빠진 채 저장되지 않게).
              if (e.key === 'Enter' && isImeComposing(e)) e.preventDefault();
            }}
          />
        </span>
        <datalist id="mh-{uid}-labels">
          {#each labels as l (l)}<option value={l}></option>{/each}
        </datalist>
      </div>
      {#if labels.length > 0}
        <div class="chips" role="group" aria-label="쓰던 라벨">
          {#each labels as l (l)}
            <button type="button" class="chip" aria-pressed={account === l} onclick={() => (account = l)}>{l}</button>
          {/each}
        </div>
      {/if}

      {#if error}<p class="err" id="mh-{uid}-err" role="alert">{error.text}</p>{/if}

      <div class="actions">
        {#if draft.id}
          <button type="button" class="btn danger" onclick={() => draft?.id && ondelete(draft.id)}>삭제</button>
        {/if}
        <button type="submit" class="btn primary">저장</button>
      </div>
    </form>
  {/if}
</Sheet>

<style>
  .wrap {
    display: flex;
    flex-direction: column;
    gap: 14px;
    /* Sheet 제목(왼쪽 20px)과 맞춘다. 아래 여백은 Sheet 본문이 둔다 */
    padding: 4px 20px 0;
  }
  .stock {
    margin: 0;
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: var(--fs-body);
  }
  .stock .num {
    color: var(--t3);
    font-size: var(--fs-sub);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .field label {
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  .field small {
    margin-left: 4px;
    color: var(--t3);
    font-size: var(--fs-sub);
  }
  .box {
    display: flex;
    align-items: center;
    gap: 6px;
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
  .box input {
    flex: 1;
    min-width: 0;
    min-height: calc(var(--touch) - 2px);
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--t1);
    font: inherit;
    font-size: 16px;
    outline: none;
  }
  .box input::placeholder {
    color: var(--t3);
  }
  .suffix {
    font-size: var(--fs-sub);
    color: var(--t2);
    white-space: nowrap;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: -6px;
  }
  .chip {
    min-height: 36px;
    padding: 0 14px;
    border-radius: 18px;
    background: var(--surface2);
    color: var(--t2);
    font-size: var(--fs-sub);
    font-weight: 600;
  }
  .chip[aria-pressed='true'] {
    background: var(--accent);
    color: var(--on-accent);
  }
  .err {
    margin: 0;
    color: var(--err);
    font-size: var(--fs-sub);
  }
  .actions {
    display: flex;
    gap: 8px;
    margin-top: 4px;
  }
  .btn {
    flex: 1;
    min-height: var(--touch);
    padding: 0 16px;
    border-radius: 12px;
    font-size: 15px;
    font-weight: 700;
    background: var(--surface2);
    color: var(--t1);
  }
  .btn.primary {
    background: var(--accent);
    color: var(--on-accent);
  }
  .btn.danger {
    flex: 0 0 auto;
    color: var(--err);
  }
</style>
