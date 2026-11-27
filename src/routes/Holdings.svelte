<script lang="ts">
  // 보유 종목(첫 화면): 토스 계좌의 실제 보유 + 직접 넣은 보유를 관심 종목과 같은 차트·실시간 리더보드로 보고,
  // 아래에 계좌 라벨별 합계와 평가손익을 둔다. 차트·시세는 Compare의 보유 모드가 맡는다.
  import { onDestroy, untrack, type Snippet } from 'svelte';
  import { showSnackbar } from '@sch0718/ui-svelte';
  import { Badge } from '@sch0718/ui-svelte';
  import { DEMO_LABEL, TOSS_LABEL, cleanLabel, newManualHolding } from '../lib/holdings/manual';
  import { accountLabels, buildRows, sortByMine, summarize, symbolPnl, type HoldingRow, type MineSort } from '../lib/holdings/rows';
  import type { App } from '../lib/state/app.svelte';
  import type { Group, WatchItem } from '../lib/state/schema';
  import type { DaySession } from '../lib/market/sessions';
  import { fmtPct, fmtWon, trendClass } from '../lib/ui/format';
  import { createHoldingsController } from '../lib/ui/holdings/holdingsController.svelte';
  import { signedWon } from '../lib/ui/perf/perfText';
  import { kstDate } from '../lib/time/kst';
  import { monthDay } from '../lib/ui/compare/compareText';
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

  const symbolList = () => (manualSymbols === '' ? [] : manualSymbols.split(','));
  // 공급자·직접 넣은 종목·날짜가 바뀌면 계좌 보유와 전일 종가를 다시 받는다(켜 둔 채 날이 바뀌어도 「오늘」 기준이 맞게).
  const today = $derived(kstDate(now));
  $effect(() => {
    const provider = app.provider;
    const symbols = symbolList();
    void today;
    untrack(() => void ctl.load(provider, symbols));
  });
  /** 당겨서 새로고침: 시세와 함께 계좌 보유(토스에서 사고판 것)도 다시 받는다. */
  const refresh = () => ctl.load(app.provider, symbolList());

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
  const holdingRows = (prices: Record<string, number>) =>
    buildRows(ctl.account, accountLabel, manual, { prices, prevClose: ctl.prevClose });
  const mine = (prices: Record<string, number>) => symbolPnl(holdingRows(prices).filter(inFilter));
  let sort = $state<MineSort | null>(null);
  const onsort = (key: MineSort | null) => (sort = key);

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
    const at = manual.findIndex((m) => m.id === id);
    if (at < 0) return;
    const removed = manual[at];
    app.setManualHoldings(manual.filter((m) => m.id !== id));
    draft = null;
    // 되돌리기는 뺀 항목만 원래 자리에 다시 넣는다(그사이 넣은 보유는 그대로 둔다).
    const undo = () => {
      const cur = app.manualHoldings;
      if (cur.some((m) => m.id === removed.id)) return;
      try {
        app.setManualHoldings([...cur.slice(0, at), removed, ...cur.slice(at)]);
      } catch (e) {
        showSnackbar(e instanceof Error ? e.message : '되돌리지 못했어요');
      }
    };
    showSnackbar('보유 종목을 뺐어요', { label: '되돌리기', run: undo });
  }
</script>

{#snippet titleBar()}
  <span class="title" data-landing-title tabindex="-1">보유 종목</span>
{/snippet}

{#snippet top(prices: Record<string, number>)}
  {@const shownRows = holdingRows(prices).filter(inFilter)}
  {@const total = summarize(shownRows)}
  <!-- 가격이 다 들어오기 전에는 일부 종목만 더한 합계를 보이지 않는다 -->
  {@const pending = shownRows.some((r) => r.price === null)}
  <div class="htop">
    {#if ctl.indexes.length > 0}
      <p class="market" aria-label="시장 상황">
        {#each ctl.indexes as i (i.name)}
          <span>{i.name} <b class="num {cls(i.pct)}">{fmtPct(i.pct)}</b>{#if i.date !== today}<em class="num"> ({monthDay(i.date)})</em>{/if}</span>
        {/each}
      </p>
    {/if}
    <div class="chips" role="group" aria-label="계좌 구분">
      <button type="button" class="chip" class:on={filter === 'all'} aria-pressed={filter === 'all'} onclick={() => (filter = 'all')}>전체</button>
      {#each labels as l (l)}
        <button type="button" class="chip" class:on={filter === l} aria-pressed={filter === l} onclick={() => (filter = l)}>{l}</button>
      {/each}
    </div>
    {#if ctl.accountFailed}
      <p class="warn" role="alert">
        {accountLabel} 보유를 받지 못해 직접 넣은 종목만 보여 줘요. <button type="button" class="link" onclick={() => app.navigate({ name: 'settings' })}>설정 열기</button>
      </p>
    {/if}
    {#if plainRows.length > 0}
      <section class="summary" aria-label="합계" aria-busy={pending}>
        <div class="stat">
          <span class="k">평가금액</span>
          <b class="num v">{pending ? '불러오는 중' : `${fmtWon(total.value)}원`}</b>
          <span class="num s">{total.count}종목</span>
        </div>
        <div class="stat">
          <span class="k">평가손익</span>
          {#if pending}
            <b class="num v">—</b>
          {:else if total.cost > 0}
            <b class="num v {cls(total.pnl)}">{fmtPct(total.pnlPct)}</b>
            <span class="num s {cls(total.pnl)}">{signedWon(total.pnl)}</span>
          {:else}
            <b class="num v">—</b>
            <span class="s">평단을 넣으면 보여요</span>
          {/if}
        </div>
        <div class="stat">
          <span class="k">오늘</span>
          {#if !pending && total.dayPct !== null}
            <b class="num v {cls(total.dayPnl)}">{fmtPct(total.dayPct)}</b>
            <span class="num s {cls(total.dayPnl)}">{signedWon(total.dayPnl)}</span>
          {:else}
            <b class="num v">—</b>
          {/if}
        </div>
      </section>
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
  {@const allRows = holdingRows(prices)}
  {@const rows = allRows.filter(inFilter)}
  {@const ordered = sort
    ? sortByMine(rows, sort, (r) => r.pnl !== null && r.pnlPct !== null ? { state: 'ok', pnl: r.pnl, pct: r.pnlPct } : undefined)
    : rows}
  <div class="hbelow">

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

    {#if rows.length > 0}
      <div class="chips" role="group" aria-label="보유 내역 정렬">
        {#each [['pnl', '수익금순'], ['pct', '수익률순']] as const as [key, label] (key)}
          <button type="button" class="chip" class:on={sort === key} aria-pressed={sort === key}
            onclick={() => onsort(sort === key ? null : key)}>{label}</button>
        {/each}
      </div>
    {/if}
    <ul class="rows" aria-label="보유 내역">
      {#each ordered as r (r.key)}
        <li>
          <!-- 계좌에서 온 보유는 고칠 수 없어 단추가 아니다. 직접 넣은 보유만 눌러 고친다 -->
          <svelte:element
            this={r.manualId ? 'button' : 'div'}
            type={r.manualId ? 'button' : undefined}
            class="row"
            class:editable={r.manualId !== null}
            onclick={r.manualId ? () => startEdit(r) : undefined}
            aria-label={r.manualId ? `${r.name} 수정` : undefined}
            role={r.manualId ? undefined : 'group'}
            aria-labelledby={r.manualId ? undefined : `hr-${r.key}`}
          >
            <span class="name">
              <b id="hr-{r.key}">{r.name}</b>
              <Badge>{r.account}</Badge>
            </span>
            <span class="num qty"><span class="nw">{fmtWon(r.qty)}주</span>{#if r.avgPrice !== null} · <span class="nw">평단 {fmtWon(r.avgPrice)}원</span>{/if}</span>
            <span class="num price">{r.value === null ? '—' : `${fmtWon(r.value)}원`}</span>
            <span class="num pnl {cls(r.pnl)}">
              {#if r.pnl !== null}
                <span class="nw">{fmtPct(r.pnlPct)}</span> <span class="nw">{signedWon(r.pnl)}</span>
              {:else}
                {r.price === null && r.avgPrice !== null ? '—' : '평단 없음'}
              {/if}
            </span>
          </svelte:element>
        </li>
      {/each}
    </ul>
    {#if manual.length > 0}<p class="foot">직접 넣은 종목은 이 기기에만 저장돼요(동기화·공유 안 함) · 누르면 고쳐요</p>{/if}
  </div>
{/snippet}

<Compare {app} {now} {sessions} {isOpenToday} {barEnd} {wide} holdings={{ group, onchange, onadd: () => (picking = true), refresh, mine, sort, onsort, bar: titleBar, top, below }} />

<AddStockSheet
  open={picking}
  {app}
  mode="single"
  title="보유 종목 고르기"
  metas={{}}
  {now}
  onclose={() => (picking = false)}
  onpick={(item) => {
    draft = { id: null, symbol: item.s, name: item.n, qty: null, avgPrice: null, account: filter !== 'all' && filter !== TOSS_LABEL && filter !== DEMO_LABEL ? filter : '' };
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
    gap: 10px;
    padding: 4px var(--gutter) 14px;
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
  /* 평가금액을 위 한 줄에, 평가손익·오늘을 아래 두 칸에(폰·PC 가운데 열 모두 좁다) */
  .summary {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    background: var(--surface);
    border-radius: var(--r-card);
    padding: 14px;
  }
  .stat:first-child {
    grid-column: 1 / -1;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: 8px;
  }
  .stat:first-child .k {
    flex-basis: 100%;
  }
  .stat:first-child .v {
    font-size: 22px;
  }
  .stat {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .k {
    color: var(--t3);
    font-size: var(--fs-sub);
  }
  .v {
    font-size: 17px;
    font-weight: 800;
    overflow-wrap: anywhere;
  }
  .s {
    color: var(--t3);
    font-size: var(--fs-sub);
  }
  .s.up,
  .s.down {
    opacity: 0.85;
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
  .accounts i,
  .market em {
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
  .row.editable {
    cursor: pointer;
  }
  .row.editable:hover {
    background: var(--surface2);
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
  .nw {
    white-space: nowrap;
  }
  .price {
    white-space: nowrap;
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
