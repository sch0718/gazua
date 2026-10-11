<script lang="ts">
  import { untrack } from 'svelte';
  import { createQuotePoller } from '../lib/data/quotePoller';
  import type { DaySession } from '../lib/market/sessions';
  import { sessionLabelAt, type Venue } from '../lib/market/tradable';
  import type { Quote, StockMeta } from '../lib/providers/types';
  import type { App } from '../lib/state/app.svelte';
  import { MAX_ITEMS } from '../lib/state/watchlist';
  import type { SnapshotSeries } from '../lib/ui/compare/compareController.svelte';
  import Badge from '../lib/ui/components/Badge.svelte';
  import Sheet from '../lib/ui/components/Sheet.svelte';
  import { fmtPct, fmtWon, trendClass } from '../lib/ui/format';
  import { moveToGroup, removeWithUndo } from './groupActions';
  import { detailView, quoteVenuesFor } from './stockDetail';

  // 종목 상세(스펙 7.3): <1024는 바텀 시트, ≥1024는 오른쪽 패널 안(inline).
  let {
    app,
    groupId,
    symbol,
    meta,
    series,
    now,
    sessions,
    isOpenToday,
    open = false,
    inline = false,
    onclose,
  }: {
    app: App;
    groupId: string;
    symbol: string;
    meta: StockMeta | undefined;
    series: SnapshotSeries | null;
    now: number;
    sessions: DaySession[];
    isOpenToday: boolean;
    open?: boolean;
    inline?: boolean;
    /** 시트를 닫거나(모바일) 선택을 푼다(PC). 삭제·이동 뒤에도 부른다. */
    onclose: () => void;
  } = $props();

  const active = $derived(inline || open);
  const provider = $derived(app.provider);
  const nxtSupported = $derived(meta?.nxtSupported ?? false);

  // 거래소마다 현재가를 받는다. 장중에는 리더보드와 같은 현재가 폴러(같은 주기·세션 판단·탭 숨김 처리)로 계속 받고,
  // 장 밖에서는 열 때 한 번만 받는다. 닫거나 종목·공급자가 바뀌면 멈춘다.
  let quotes = $state.raw<Partial<Record<Venue, Quote>>>({});
  const inSessionNow = () => untrack(() => isOpenToday && sessionLabelAt(sessions, now) !== null);
  $effect(() => {
    if (!active) return;
    const sym = symbol;
    const p = provider;
    let alive = true;
    quotes = {};
    const accept = (venue: Venue, list: Quote[]) => {
      const q = list.find((x) => x.symbol === sym);
      if (alive && q) quotes = { ...quotes, [venue]: q };
    };
    const venues = quoteVenuesFor(p.capabilities.venues, nxtSupported, app.settings.venueMode);
    // 폴러는 세션 안에서만 시작하자마자 받으므로, 장 밖이면 여기서 한 번 받는다.
    if (!inSessionNow()) {
      for (const venue of venues) {
        p.getQuotes([sym], venue).then(
          (list) => accept(venue, list),
          () => {
            // 받지 못한 거래소는 '—'로 둔다.
          },
        );
      }
    }
    const pollers = venues.map((venue) =>
      createQuotePoller({
        provider: p,
        symbols: () => [sym],
        venue: () => venue,
        inSession: inSessionNow,
        onQuotes: (list) => accept(venue, list),
      }),
    );
    untrack(() => {
      for (const poller of pollers) poller.start();
    });
    return () => {
      alive = false;
      for (const poller of pollers) poller.stop();
    };
  });

  const view = $derived(
    detailView({
      meta,
      series,
      quotes,
      venues: provider.capabilities.venues,
      venueMode: app.settings.venueMode,
      sessions,
      isOpenToday,
      now,
    }),
  );
  const name = $derived(meta?.name ?? symbol);
  const group = $derived(app.watchlists.groups.find((g) => g.id === groupId));
  const slot = $derived(group?.items.find((i) => i.symbol === symbol)?.colorSlot ?? 1);
  const others = $derived(app.watchlists.groups.filter((g) => g.id !== groupId));
  const conv = $derived(app.settings.colorConvention);

  let picking = $state(false);
  $effect(() => {
    void symbol;
    picking = false;
  });

  function remove() {
    if (removeWithUndo(app, groupId, symbol, name)) onclose();
  }

  function moveTo(target: string) {
    if (moveToGroup(app, groupId, target, symbol, now) === 'moved') onclose();
  }
</script>

{#snippet body()}
  <div class="d-top">
    <i class="dot" style:background="var(--s{slot})" aria-hidden="true"></i>
    <b class="name">{name}</b>
    {#if meta}
      {#if meta.nxtSupported}<Badge tone="nxt">NXT 지원</Badge>{:else}<Badge>NXT 미지원</Badge>{/if}
      {#if meta.securityType === 'ETF' || meta.securityType === 'ETN'}<Badge>{meta.securityType}</Badge>{/if}
    {/if}
    <span class="code num">{symbol}{meta ? ` · ${meta.market}` : ''}</span>
  </div>
  <p class="d-sub">{view.sub}</p>
  {#if view.stale}
    <span class="stale" role="img" aria-label={view.stale.label}><Badge tone="warn">{view.stale.text}</Badge></span>
  {/if}
  <p class="price-big num">
    <span>{view.price === null ? '—' : `${fmtWon(view.price)}원`}</span>
    <span class="chg {trendClass(view.change, conv)}">{fmtPct(view.change)}</span>
  </p>

  {#snippet cells()}
    <div class="vcmp num">
      {#each view.cells as c (c.key)}
        <div class:cur={c.current}><span>{c.label}</span><b>{c.value}</b></div>
      {/each}
    </div>
  {/snippet}
  {#if view.stale}
    <div role="group" aria-label="실시간">
      <p class="live">실시간</p>
      {@render cells()}
    </div>
  {:else}
    {@render cells()}
  {/if}

  <h4>오늘 거래 가능 시간 (KST)</h4>
  {#if view.timetable.length === 0}
    <p class="kv"><span>{isOpenToday ? '거래할 수 있는 시간이 없어요' : '오늘은 휴장이에요'}</span></p>
  {:else}
    <ul>
      {#each view.timetable as r (r.key)}
        <li class="kv num" class:now={r.now} aria-current={r.now ? 'true' : undefined}>
          <span>{r.label}{r.now ? ' · 지금' : ''}</span><b>{r.range}</b>
        </li>
      {/each}
    </ul>
  {/if}
  <p class="kv">
    <span>상태</span><b class:ok={view.status === '정상 거래'} class:warn={view.status !== '정상 거래'}>{view.status}</b>
  </p>

  <div class="btns">
    <button type="button" class="btn ghost" aria-expanded={picking} onclick={() => (picking = !picking)}>그룹 이동</button>
    <button type="button" class="btn danger" onclick={remove}>삭제</button>
  </div>
  {#if picking}
    <div class="pick">
      {#if others.length === 0}
        <p class="hint">옮길 다른 그룹이 없어요</p>
      {:else}
        {#each others as g (g.id)}
          {@const isFull = g.items.length >= MAX_ITEMS}
          {@const whyId = `move-full-${g.id}`}
          <div class="target">
            <button
              type="button"
              class="ritem"
              aria-disabled={isFull ? 'true' : undefined}
              aria-describedby={isFull ? whyId : undefined}
              onclick={() => moveTo(g.id)}
            >
              {g.name} ({g.items.length}/{MAX_ITEMS})
            </button>
            {#if isFull}<span class="why" id={whyId}>가득 참</span>{/if}
          </div>
        {/each}
      {/if}
    </div>
  {/if}
{/snippet}

{#if inline}
  <section class="detail" aria-labelledby="detail-inline-title">
    <h4 id="detail-inline-title">선택한 종목</h4>
    {@render body()}
  </section>
{:else}
  <Sheet {open} title="종목 상세" {onclose}>
    <div class="detail">{@render body()}</div>
  </Sheet>
{/if}

<style>
  .detail {
    padding: 4px 4px 8px;
  }
  h4 {
    font-size: 13px;
    color: var(--t2);
    padding: 12px 12px 6px;
    font-weight: 700;
  }
  .d-top {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px 8px;
    padding: 2px 12px;
  }
  .dot {
    width: 11px;
    height: 11px;
    border-radius: 50%;
    display: block;
    flex: none;
  }
  .name {
    font-size: 18px;
  }
  .code {
    margin-left: auto;
    font-size: 12px;
    color: var(--t3);
  }
  .d-sub {
    font-size: 12.5px;
    color: var(--t2);
    padding: 4px 12px 0;
  }
  .stale {
    display: inline-block;
    padding: 6px 12px 0 8px;
  }
  .price-big {
    font-size: 30px;
    font-weight: 800;
    letter-spacing: -0.02em;
    padding: 0 12px;
  }
  .price-big .chg {
    font-size: 16px;
    margin-left: 6px;
  }
  .chg.up {
    color: var(--up);
  }
  .chg.down {
    color: var(--down);
  }
  .live {
    font-size: 12px;
    font-weight: 700;
    color: var(--t3);
    padding: 8px 12px 0;
  }
  .vcmp {
    display: flex;
    margin: 10px 8px 4px;
    background: var(--surface2);
    border-radius: 14px;
  }
  .vcmp div {
    flex: 1;
    padding: 10px 12px;
    min-width: 0;
  }
  .vcmp div + div {
    border-left: 1px solid var(--line);
  }
  .vcmp span {
    font-size: 11.5px;
    color: var(--t2);
    display: block;
  }
  .vcmp b {
    font-size: 15px;
  }
  .vcmp .cur b {
    color: var(--accent);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .kv {
    display: flex;
    justify-content: space-between;
    padding: 7px 12px;
    font-size: 14px;
    gap: 12px;
  }
  .kv span {
    color: var(--t2);
  }
  .kv.now,
  .kv.now span {
    color: var(--accent);
    font-weight: 800;
  }
  .ok {
    color: var(--ok);
  }
  .warn {
    color: var(--warn);
  }
  .btns {
    display: flex;
    gap: 8px;
    padding: 12px 8px 0;
  }
  .btn {
    flex: 1;
    padding: 12px 18px;
    border-radius: 14px;
    font-weight: 800;
    font-size: 15px;
    min-height: 46px;
    background: var(--surface2);
    color: var(--t1);
  }
  .btn.danger {
    color: var(--err);
  }
  .pick {
    padding: 8px 8px 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .target {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .why {
    font-size: 12px;
    color: var(--t3);
    padding-right: 12px;
    white-space: nowrap;
  }
  .ritem {
    flex: 1;
    text-align: left;
    padding: 10px 12px;
    min-height: var(--touch);
    border-radius: 10px;
    font-size: 14px;
  }
  .ritem:hover {
    background: var(--surface2);
  }
  .ritem[aria-disabled='true'] {
    opacity: 0.42;
    cursor: not-allowed;
  }
  .hint {
    font-size: 13px;
    color: var(--t3);
    padding: 8px 12px;
  }
</style>
