<script lang="ts">
  import Badge from '../components/Badge.svelte';
  import { fmtWon, trendClass } from '../format';
  import { formatMetricValue, prevDayBadge, staleBadge, type MetricUnit } from './compareText';
  import { sortRows, type LeaderRow } from './rows';

  // 리더보드(범례 겸용, 스펙 7.2-6·7). 값 내림차순, 스크럽 중에는 frozenOrder를 지킨다.
  let {
    rows,
    frozenOrder,
    unit,
    conv,
    metricLabel,
    count,
    scrubLabel = null,
    now,
    onselect,
    ontogglehidden,
    onreorder,
    onopenadd,
  }: {
    rows: LeaderRow[];
    frozenOrder: string[] | null;
    unit: MetricUnit;
    conv: 'kr' | 'global';
    metricLabel: string;
    /** 그룹의 종목 수 */
    count: number;
    /** 스크럽 중이면 그 시각(`14:32`) */
    scrubLabel?: string | null;
    now: number;
    onselect: (symbol: string) => void;
    ontogglehidden: (symbol: string) => void;
    /** `symbol`을 그룹에서 `target` 자리로 옮긴다. */
    onreorder: (symbol: string, target: string) => void;
    onopenadd: () => void;
  } = $props();

  const LONG_PRESS_MS = 500;
  const MOVE_TOLERANCE_PX = 8;

  const ordered = $derived(sortRows(rows, frozenOrder));

  let listEl: HTMLUListElement;
  let press: { symbol: string; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null;
  let dragging = $state<string | null>(null);
  let dropTarget = $state<string | null>(null);
  let suppressClick = false;

  function valueText(r: LeaderRow): { text: string; cls: string } {
    if (r.error) return { text: r.error, cls: 'muted' };
    if (r.loading) return { text: '불러오는 중', cls: 'muted' };
    if (r.value === null) return { text: '데이터 없음', cls: 'muted' };
    return { text: formatMetricValue(r.value, unit), cls: unit === '%' ? trendClass(r.value, conv) : '' };
  }

  function rowAt(y: number): string | null {
    for (const li of listEl.querySelectorAll<HTMLLIElement>('li[data-symbol]')) {
      const box = li.getBoundingClientRect();
      if (y >= box.top && y < box.bottom) return li.dataset.symbol ?? null;
    }
    return null;
  }

  function cancelPress() {
    if (press) clearTimeout(press.timer);
    press = null;
  }

  function onpointerdown(e: PointerEvent, symbol: string) {
    // 터치로 끈 뒤에는 click이 오지 않을 수 있다. 새로 누르면 막아 둔 click을 푼다.
    suppressClick = false;
    if (e.button > 0) return;
    cancelPress();
    const el = e.currentTarget as HTMLElement;
    const pointerId = e.pointerId;
    press = {
      symbol,
      x: e.clientX,
      y: e.clientY,
      timer: setTimeout(() => {
        press = null;
        dragging = symbol;
        dropTarget = symbol;
        try {
          el.setPointerCapture?.(pointerId);
        } catch {
          // 포인터가 이미 사라졌으면 캡처 없이 진행한다.
        }
        navigator.vibrate?.(8);
      }, LONG_PRESS_MS),
    };
  }

  function onpointermove(e: PointerEvent) {
    if (dragging) {
      e.preventDefault();
      dropTarget = rowAt(e.clientY) ?? dropTarget;
    } else if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > MOVE_TOLERANCE_PX) {
      cancelPress();
    }
  }

  function onpointerup() {
    cancelPress();
    if (!dragging) return;
    const from = dragging;
    const to = dropTarget;
    dragging = null;
    dropTarget = null;
    suppressClick = true;
    if (to && to !== from) onreorder(from, to);
  }

  function onpointercancel() {
    cancelPress();
    dragging = null;
    dropTarget = null;
  }

  function onclick(symbol: string) {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    onselect(symbol);
  }

  function onkeydown(e: KeyboardEvent, symbol: string) {
    suppressClick = false;
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const i = ordered.findIndex((r) => r.symbol === symbol);
    const neighbor = ordered[i + (e.key === 'ArrowUp' ? -1 : 1)];
    if (neighbor) onreorder(symbol, neighbor.symbol);
  }

  // 끄는 동안 터치 스크롤을 막는다(Svelte의 touchmove 속성은 passive라 직접 단다).
  $effect(() => {
    const el = listEl;
    const block = (e: TouchEvent) => {
      if (dragging) e.preventDefault();
    };
    el.addEventListener('touchmove', block, { passive: false });
    return () => {
      el.removeEventListener('touchmove', block);
      cancelPress();
    };
  });
</script>

<section class="board" aria-label="리더보드">
  <div class="board-head">
    <span>{metricLabel} 순 · {count}/8{scrubLabel ? ` · ${scrubLabel} 값` : ''}</span>
    <button type="button" class="btn-add" onclick={onopenadd}>＋ 종목 추가</button>
  </div>
  <ul bind:this={listEl}>
    {#each ordered as r (r.symbol)}
      {@const v = valueText(r)}
      {@const stale = r.prevDay !== undefined ? prevDayBadge(r.prevDay) : r.staleAt !== undefined ? staleBadge(r.staleAt, now) : null}
      <li
        class="lrow"
        data-symbol={r.symbol}
        class:dim={r.hidden}
        class:dragging={dragging === r.symbol}
        class:drop={dragging !== null && dropTarget === r.symbol && dropTarget !== dragging}
      >
        <button
          type="button"
          class="dotbtn"
          aria-pressed={!r.hidden}
          aria-label="{r.name} 차트에 {r.hidden ? '보이기' : '숨기기'}"
          onclick={() => ontogglehidden(r.symbol)}
        >
          <i style:background="var(--s{r.slot})"></i>
        </button>
        <button
          type="button"
          class="main-btn"
          onclick={() => onclick(r.symbol)}
          onkeydown={(e) => onkeydown(e, r.symbol)}
          onpointerdown={(e) => onpointerdown(e, r.symbol)}
          {onpointermove}
          {onpointerup}
          {onpointercancel}
          oncontextmenu={(e) => {
            if (press || dragging) e.preventDefault();
          }}
        >
          <span class="nm">
            <b>{r.name}{#if r.nxt}<Badge tone="nxt">NXT</Badge>{/if}</b>
            <em class="num"
              >{r.symbol}{#each r.badges as b (b)}<Badge tone={b === 'ETF' || b === 'ETN' ? 'neutral' : 'warn'}
                  >{b}</Badge
                >{/each}{#if stale}<span role="img" aria-label={stale.label}><Badge tone="warn">{stale.text}</Badge></span
                >{/if}</em
            >
          </span>
          <span class="val num">
            <b class={v.cls}>{v.text}</b>
            <em>{r.price === null ? '—' : `${fmtWon(r.price)}원`}</em>
          </span>
        </button>
      </li>
    {/each}
  </ul>
</section>

<style>
  .board-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 8px 4px;
    font-size: var(--fs-sub);
    color: var(--t2);
    font-weight: 700;
  }
  .btn-add {
    background: var(--t1);
    color: var(--bg);
    font-weight: 700;
    font-size: 13.5px;
    padding: 8px 14px;
    border-radius: var(--r-chip);
    min-height: 36px;
    white-space: nowrap;
    position: relative;
  }
  .btn-add::before {
    content: '';
    position: absolute;
    inset: -4px -2px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .lrow {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border-radius: 14px;
    min-height: 58px;
    -webkit-touch-callout: none;
    user-select: none;
    -webkit-user-select: none;
  }
  .lrow:hover {
    background: var(--surface2);
  }
  .lrow.dragging {
    background: var(--surface2);
    box-shadow: var(--shadow);
  }
  .lrow.drop {
    box-shadow: inset 0 2px 0 var(--accent);
  }
  .lrow.dim .nm,
  .lrow.dim .val {
    opacity: 0.4;
  }
  .dotbtn {
    width: var(--touch);
    height: var(--touch);
    display: grid;
    place-items: center;
    flex: none;
    border-radius: 12px;
  }
  .dotbtn i {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    display: block;
  }
  .dotbtn[aria-pressed='false'] i {
    background: transparent !important;
    box-shadow: inset 0 0 0 2px var(--t3);
  }
  .main-btn {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    min-height: var(--touch);
    text-align: left;
    padding: 6px 4px;
    border-radius: 10px;
    touch-action: pan-y;
  }
  .nm {
    flex: 1;
    min-width: 0;
  }
  .nm b {
    font-size: var(--fs-body);
    font-weight: 700;
    display: block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .nm em {
    font-style: normal;
    font-size: 12px;
    color: var(--t3);
  }
  .val {
    text-align: right;
    white-space: nowrap;
  }
  .val b {
    font-size: var(--fs-body);
    font-weight: 800;
    display: block;
  }
  .val b.up {
    color: var(--up);
  }
  .val b.down {
    color: var(--down);
  }
  .val b.muted {
    color: var(--t3);
    font-weight: 600;
  }
  .val em {
    font-style: normal;
    font-size: 12px;
    color: var(--t2);
  }
</style>
