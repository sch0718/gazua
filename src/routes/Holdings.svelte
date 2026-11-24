<script lang="ts">
  // 보유 종목(첫 화면): 토스 계좌의 실제 보유 + 직접 넣은 보유를 관심 종목과 같은 차트·실시간 리더보드로 보고,
  // 아래에 계좌 라벨별 합계와 평가손익을 둔다. 차트·시세는 Compare의 보유 모드가 맡는다.
  import { onDestroy, untrack, type Snippet } from 'svelte';
  import { showSnackbar } from '@sch0718/ui-svelte';
  import { Badge } from '@sch0718/ui-svelte';
  import { DEFAULT_ACCOUNT_LABEL, DEMO_LABEL, TOSS_LABEL, cleanLabel, newManualHolding } from '../lib/holdings/manual';
  import { accountLabels, buildRows, summarize, type HoldingRow } from '../lib/holdings/rows';
  import type { App } from '../lib/state/app.svelte';
  import type { Group, WatchItem } from '../lib/state/schema';
  import type { DaySession } from '../lib/market/sessions';
  import { fmtPct, fmtWon, trendClass } from '../lib/ui/format';
  import { createHoldingsController } from '../lib/ui/holdings/holdingsController.svelte';
  import { signedWon } from '../lib/ui/perf/perfText';
  import AddStockSheet from '../sheets/AddStockSheet.svelte';
  import ManualHoldingSheet, { type Draft } from '../sheets/ManualHoldingSheet.svelte';
  import Compare from './Compare.svelte';

  let {
    app,
    now,
    sessions,
    isOpenToday,
    barEnd,
    wide,
  }: { app: App; now: number; sessions: DaySession[]; isOpenToday: boolean; barEnd: Snippet; wide?: boolean } = $props();

  const conv = $derived(app.settings.colorConvention);
  const ctl = createHoldingsController({ now: () => untrack(() => now) });
  onDestroy(() => ctl.destroy());

  const manual = $derived(app.manualHoldings);
  const manualSymbols = $derived([...new Set(manual.map((m) => m.symbol))].sort().join(','));

  // 공급자·프로필·직접 넣은 종목이 바뀌면 계좌 보유와 전일 종가를 다시 받는다.
  $effect(() => {
    const provider = app.provider;
    void app.meta.activeProfileId;
    const symbols = manualSymbols === '' ? [] : manualSymbols.split(',');
    untrack(() => void ctl.load(provider, symbols));
  });

  const accountLabel = $derived(app.provider.id === 'demo' ? DEMO_LABEL : TOSS_LABEL);
  // 계좌 보유를 주는 공급자(토스·데모)인지. KIS는 직접 넣은 보유만 보인다.
  const hasAccount = $derived(app.provider.account !== undefined);
  const NO_MARKET = { prices: {}, prevClose: {} };
  // 종목·라벨만 쓰는 행(가격 없음). 차트 그룹을 가격과 무관하게 유지한다.
  const plainRows = $derived(buildRows(ctl.account, accountLabel, manual, NO_MARKET));
  const labels = $derived(accountLabels(plainRows));
  let filter = $state<string>('all');
  $effect(() => {
    if (filter !== 'all' && !labels.includes(filter)) filter = 'all';
  });
  const inFilter = (r: HoldingRow) => filter === 'all' || r.account === filter;

  // ── 차트용 읽기 전용 그룹 ────────────────────────────────
  // 색은 전체 보유에서의 자리로 정해 라벨을 바꿔도 같은 종목은 같은 색이다. 숨김·순서는 이 화면에서만 기억한다.
  let hidden = $state<Record<string, boolean>>({});
  let order = $state.raw<string[]>([]);
  const allSymbols = $derived([...new Set(plainRows.map((r) => r.symbol))]);
  const group = $derived.by((): Group => {
    const shown = new Set(plainRows.filter(inFilter).map((r) => r.symbol));
    const rank = (s: string) => {
      const i = order.indexOf(s);
      return i < 0 ? order.length + allSymbols.indexOf(s) : i;
    };
    const items: WatchItem[] = allSymbols
      .filter((s) => shown.has(s))
      .sort((a, b) => rank(a) - rank(b))
      .map((s) => ({ symbol: s, colorSlot: ((allSymbols.indexOf(s) % 10) + 1) as WatchItem['colorSlot'], hidden: !!hidden[s], addedAt: 0 }));
    return { id: 'holdings', name: filter === 'all' ? '보유' : filter, items };
  });
  function onchange(g: Group) {
    hidden = { ...hidden, ...Object.fromEntries(g.items.map((i) => [i.symbol, i.hidden])) };
    const moved = g.items.map((i) => i.symbol);
    order = [...moved, ...order.filter((s) => !moved.includes(s))];
  }

  const pnlText = (pnl: number | null, pct: number | null) => (pnl === null ? '—' : `${signedWon(pnl)} (${fmtPct(pct)})`);
  const cls = (v: number | null) => trendClass(v, conv);

  // ── 직접 넣기 ───────────────────────────────────────────
  let picking = $state(false);
  let draft = $state<Draft | null>(null);

  function startEdit(r: HoldingRow) {
    const m = manual.find((x) => x.id === r.manualId);
    if (!m) return;
    draft = { id: m.id, symbol: m.symbol, name: m.name, qty: m.qty, avgPrice: m.avgPrice, account: m.account };
  }
  function save(d: Draft & { qty: number }) {
    const account = cleanLabel(d.account);
    try {
      if (d.id) {
        app.setManualHoldings(manual.map((m) => (m.id === d.id ? { ...m, qty: d.qty, avgPrice: d.avgPrice, account } : m)));
      } else {
        app.setManualHoldings([...manual, newManualHolding({ symbol: d.symbol, name: d.name, qty: d.qty, avgPrice: d.avgPrice, account })]);
      }
      draft = null;
    } catch (e) {
      showSnackbar(e instanceof Error ? e.message : '저장하지 못했어요');
    }
  }
  function remove(id: string) {
    const prev = manual;
    app.setManualHoldings(manual.filter((m) => m.id !== id));
    draft = null;
    showSnackbar('보유 종목을 뺐어요', { label: '되돌리기', run: () => app.setManualHoldings(prev) });
  }
</script>

{#snippet titleBar()}
  <span class="title" data-landing-title tabindex="-1">보유 종목</span>
{/snippet}

{#snippet top()}
  <div class="htop">
    {#if ctl.indexes.length > 0}
      <p class="market" aria-label="시장 상황">
        {#each ctl.indexes as i (i.name)}
          <span>{i.name} <b class="num {cls(i.pct)}">{fmtPct(i.pct)}</b></span>
        {/each}
      </p>
    {/if}
    <div class="chips" role="group" aria-label="계좌 구분">
      <button type="button" class="chip" class:on={filter === 'all'} aria-pressed={filter === 'all'} onclick={() => (filter = 'all')}>전체</button>
      {#each labels as l (l)}
        <button type="button" class="chip" class:on={filter === l} aria-pressed={filter === l} onclick={() => (filter = l)}>{l}</button>
      {/each}
      <button type="button" class="chip add" onclick={() => (picking = true)}>＋ 직접 추가</button>
    </div>
    {#if ctl.accountFailed}
      <p class="warn" role="alert">
        {accountLabel} 보유를 받지 못해 직접 넣은 종목만 보여 줘요. <button type="button" class="link" onclick={() => app.navigate({ name: 'settings' })}>설정 열기</button>
      </p>
    {/if}
    {#if plainRows.length === 0 && !ctl.loading}
      <section class="empty">
        <h2>보유 종목이 없어요</h2>
        <p>{app.provider.id === 'toss' ? '토스 계좌에 없는 종목은 직접 추가할 수 있어요.' : hasAccount ? '설정에서 토스를 연결하면 실제 보유가 들어와요. 토스에 없는 종목은 직접 넣을 수 있어요.' : '보유 종목을 직접 추가할 수 있어요. 토스를 연결하면 실제 보유도 들어와요.'}</p>
        <button type="button" class="primary" onclick={() => (picking = true)}>직접 추가</button>
      </section>
    {/if}
  </div>
{/snippet}

{#snippet below(prices: Record<string, number>)}
  {@const allRows = buildRows(ctl.account, accountLabel, manual, { prices, prevClose: ctl.prevClose })}
  {@const rows = allRows.filter(inFilter)}
  {@const total = summarize(rows)}
  <div class="hbelow">
    <section class="summary" aria-label="합계">
      <div>
        <span class="k">평가금액</span>
        <b class="num big">{fmtWon(total.value)}원</b>
      </div>
      <div>
        <span class="k">평가손익</span>
        <b class="num {cls(total.pnl)}">{pnlText(total.cost > 0 ? total.pnl : null, total.pnlPct)}</b>
      </div>
      <div>
        <span class="k">오늘</span>
        <b class="num {cls(total.dayPnl)}">{total.dayPct === null ? '—' : `${signedWon(total.dayPnl)} (${fmtPct(total.dayPct)})`}</b>
      </div>
    </section>

    {#if filter === 'all' && labels.length > 1}
      <ul class="accounts" aria-label="계좌별">
        {#each labels as l (l)}
          {@const a = summarize(allRows.filter((r) => r.account === l))}
          <li>
            <button type="button" onclick={() => (filter = l)}>
              <span>{l} <em>{a.count}종목</em></span>
              <span class="num">{fmtWon(a.value)}원 · <i class={cls(a.pnlPct)}>{fmtPct(a.pnlPct)}</i></span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    <ul class="rows" aria-label="보유 내역">
      {#each rows as r (r.key)}
        <li>
          <button type="button" class="row" disabled={r.manualId === null} onclick={() => startEdit(r)} aria-label={r.manualId ? `${r.name} 수정` : r.name}>
            <span class="name">
              <b>{r.name}</b>
              <Badge>{r.account}</Badge>
            </span>
            <span class="num qty">{fmtWon(r.qty)}주{r.avgPrice !== null ? ` · 평단 ${fmtWon(r.avgPrice)}` : ''}</span>
            <span class="num price">{r.value === null ? '—' : `${fmtWon(r.value)}원`}</span>
            <span class="num pnl {cls(r.pnl)}">{pnlText(r.pnl, r.pnlPct)}</span>
          </button>
        </li>
      {/each}
    </ul>
    <p class="foot">직접 넣은 종목은 이 기기에만 저장돼요(동기화·공유 안 함) · 누르면 수정해요</p>
  </div>
{/snippet}

<Compare {app} {now} {sessions} {isOpenToday} {barEnd} {wide} holdings={{ group, onchange, onadd: () => (picking = true), bar: titleBar, top, below }} />

<AddStockSheet
  open={picking}
  {app}
  mode="single"
  title="보유 종목 고르기"
  metas={{}}
  {now}
  onclose={() => (picking = false)}
  onpick={(item) => {
    draft = { id: null, symbol: item.s, name: item.n, qty: null, avgPrice: null, account: filter !== 'all' && filter !== TOSS_LABEL && filter !== DEMO_LABEL ? filter : DEFAULT_ACCOUNT_LABEL };
  }}
/>
<ManualHoldingSheet
  open={draft !== null}
  {draft}
  labels={[...new Set(manual.map((m) => m.account))]}
  onsave={save}
  ondelete={remove}
  onclose={() => (draft = null)}
/>

<style>
  .title {
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -0.01em;
    flex: 1 1 auto;
  }
  .htop,
  .hbelow {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  /* 비교 화면 본문은 flex order로 차트(2)·컨트롤(3)을 놓는다. 합계·목록은 그 아래. */
  .hbelow {
    order: 4;
    margin-top: 8px;
    padding: 0 var(--gutter) 24px;
  }
  .htop {
    padding: 4px var(--gutter) 0;
  }
  .market {
    display: flex;
    gap: 16px;
    margin: 0;
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
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
  .chip.on {
    background: var(--accent);
    color: var(--on-accent);
  }
  .chip.add {
    background: transparent;
    border: 1px dashed var(--line);
  }
  .summary {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    background: var(--surface);
    border-radius: var(--r-card);
    padding: 14px;
  }
  .summary > div {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    font-size: var(--fs-sub);
  }
  .k {
    color: var(--t3);
  }
  .big {
    font-size: var(--fs-title);
  }
  .accounts,
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .accounts button {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    min-height: var(--touch);
    padding: 0 12px;
    align-items: center;
    border-radius: 12px;
    background: var(--surface);
    color: var(--t1);
    font-size: var(--fs-sub);
  }
  .accounts em,

  .accounts i {
    font-style: normal;
  }
  .row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas: 'name price' 'qty pnl';
    gap: 2px 12px;
    width: 100%;
    padding: 10px 12px;
    text-align: left;
    border-radius: 12px;
    background: var(--surface);
    color: var(--t1);
  }
  .row:disabled {
    opacity: 1;
    cursor: default;
  }
  .name {
    grid-area: name;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
    align-items: center;
    min-width: 0;
  }
  .qty {
    grid-area: qty;
    color: var(--t3);
    font-size: var(--fs-sub);
  }
  .price {
    grid-area: price;
    text-align: right;
    font-size: var(--fs-sub);
  }
  .pnl {
    grid-area: pnl;
    text-align: right;
    font-size: var(--fs-sub);
  }
  .warn {
    margin: 0;
    padding: 10px 12px;
    border-radius: 12px;
    background: var(--surface2);
    color: var(--t2);
    font-size: var(--fs-sub);
  }
  .link {
    color: var(--accent);
    text-decoration: underline;
  }
  .empty {
    padding: 24px 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
    align-items: flex-start;
  }
  .empty h2 {
    font-size: var(--fs-title);
    margin: 0;
  }
  .empty p {
    margin: 0;
    color: var(--t2);
  }
  .primary {
    min-height: var(--touch);
    padding: 0 16px;
    border-radius: 12px;
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
  }
  .foot {
    margin: 0;
    color: var(--t3);
    font-size: var(--fs-sub);
  }
</style>
