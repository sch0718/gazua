<script lang="ts">
  // 직접 넣은 보유 종목 추가·수정. 종목은 종목 추가 시트(단일 선택)에서 골라 넘겨받는다.
  import { untrack } from 'svelte';
  import { Sheet } from '@sch0718/ui-svelte';
  import { ACCOUNT_LABEL_MAX, DEFAULT_ACCOUNT_LABEL } from '../lib/holdings/manual';
  import { isImeComposing } from '../lib/ui/ime';

  export interface Draft {
    /** 수정이면 기존 항목 id */
    id: string | null;
    symbol: string;
    name: string;
    qty: number | null;
    avgPrice: number | null;
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

  // type=number 입력은 숫자(비어 있으면 null)로 묶인다
  let qty = $state<number | null>(null);
  let avg = $state<number | null>(null);
  let account = $state('');
  let error = $state('');

  // 열 때마다 초안으로 채운다.
  $effect(() => {
    const d = draft;
    if (!open || !d) return;
    untrack(() => {
      qty = d.qty;
      avg = d.avgPrice;
      account = d.account;
      error = '';
    });
  });

  function save() {
    if (!draft) return;
    const q = qty;
    if (q === null || !Number.isInteger(q) || q < 1) {
      error = '수량은 1주 이상의 정수로 넣어 주세요';
      return;
    }
    const a = avg;
    if (a !== null && (!Number.isFinite(a) || a <= 0)) {
      error = '평균 매수가는 0보다 큰 숫자로 넣어 주세요';
      return;
    }
    onsave({ ...draft, qty: q, avgPrice: a, account });
  }
</script>

<Sheet {open} title={draft?.id ? '보유 종목 수정' : '보유 종목 추가'} {onclose}>
  {#if draft}
    <form
      class="form"
      onsubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <p class="stock"><b>{draft.name}</b> <em class="num">{draft.symbol}</em></p>
      <label>
        <span>수량(주)</span>
        <input type="number" inputmode="numeric" min="1" step="1" bind:value={qty} data-autofocus required />
      </label>
      <label>
        <span>평균 매수가(원) · 모르면 비워 둬요</span>
        <input type="number" inputmode="decimal" min="0" step="any" bind:value={avg} />
      </label>
      <label>
        <span>계좌 라벨</span>
        <input
          type="text"
          bind:value={account}
          maxlength={ACCOUNT_LABEL_MAX}
          placeholder={DEFAULT_ACCOUNT_LABEL}
          list="holding-labels"
          autocomplete="off"
          onkeydown={(e) => {
            // 한글 조합을 확정하는 Enter로는 제출하지 않는다(마지막 글자가 빠진 채 저장되지 않게).
            if (e.key === 'Enter' && isImeComposing(e)) e.preventDefault();
          }}
        />
        <datalist id="holding-labels">
          {#each labels as l (l)}<option value={l}></option>{/each}
        </datalist>
      </label>
      {#if labels.length > 0}
        <div class="chips" role="group" aria-label="쓰던 라벨">
          {#each labels as l (l)}
            <button type="button" class="chip" class:on={account === l} onclick={() => (account = l)}>{l}</button>
          {/each}
        </div>
      {/if}
      {#if error}<p class="err" role="alert">{error}</p>{/if}
      <div class="actions">
        {#if draft.id}
          <button type="button" class="danger" onclick={() => draft?.id && ondelete(draft.id)}>삭제</button>
        {/if}
        <button type="submit" class="primary">저장</button>
      </div>
    </form>
  {/if}
</Sheet>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 4px 0 8px;
  }
  .stock {
    margin: 0;
    font-size: var(--fs-body);
  }
  .stock em {
    font-style: normal;
    color: var(--t3);
    margin-left: 6px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: var(--fs-sub);
    color: var(--t3);
  }
  input {
    min-height: var(--touch);
    padding: 0 12px;
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
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    min-height: 36px;
    padding: 0 12px;
    border-radius: 18px;
    background: var(--surface2);
    color: var(--t2);
    font-size: var(--fs-sub);
  }
  .chip.on {
    background: var(--accent);
    color: var(--on-accent);
  }
  .err {
    margin: 0;
    color: var(--down, #d33);
    font-size: var(--fs-sub);
  }
  .actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }
  .primary,
  .danger {
    min-height: var(--touch);
    padding: 0 18px;
    border-radius: 12px;
    font-weight: 600;
  }
  .primary {
    background: var(--accent);
    color: var(--on-accent);
  }
  .danger {
    background: var(--surface2);
    color: var(--t1);
  }
</style>
