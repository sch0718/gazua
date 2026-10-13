<script module lang="ts">
  // 마지막 입력이 포인터인지 키보드인지. 보드가 다시 마운트돼도(빈 상태에서 마우스로 되돌리기) 이어지도록
  // 모듈에 두고 한 번만 등록한다. 리스너가 둘뿐이라 떼지 않는다(인스턴스 수를 세는 쪽이 더 복잡하고 틈이 생긴다).
  let pointerFocus = false;
  if (typeof document !== 'undefined') {
    document.addEventListener('pointerdown', () => (pointerFocus = true), true);
    document.addEventListener('keydown', () => (pointerFocus = false), true);
  }
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import Badge from '../components/Badge.svelte';
  import { fmtWon, trendClass } from '../format';
  import { formatMetricValue, prevDayBadge, staleBadge, type MetricUnit } from './compareText';
  import { sortRows, type LeaderRow } from './rows';

  // 리더보드(범례 겸용, 스펙 7.2-6·7). 값 내림차순, 고정 중(스크럽·키보드 포커스)에는 frozenOrder를 지킨다.
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
    onfocuswithin,
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
    /** 포커스가 목록 안으로 들어오면 그때 보이는 순서를, 목록 밖으로 나가면 null을 알린다. */
    onfocuswithin?: (order: string[] | null) => void;
  } = $props();

  const LONG_PRESS_MS = 500;
  const MOVE_TOLERANCE_PX = 8;

  const ordered = $derived(sortRows(rows, frozenOrder));

  let listEl: HTMLUListElement;
  let addBtn: HTMLButtonElement;

  /** 지운 종목 자리로 포커스를 옮길 때: 지금 index번째 행의 버튼, 그 자리에 행이 없으면 `＋ 종목 추가`. */
  export function rowButtonAt(index: number): HTMLElement | undefined {
    return (index >= 0 ? listEl?.querySelectorAll<HTMLElement>(':scope > li > .main-btn')[index] : undefined) ?? addBtn;
  }

  const shownRows = () => [...(listEl?.querySelectorAll<HTMLElement>(':scope > li') ?? [])];

  /** symbol 행이 지금 몇 번째로 보이는지(없으면 -1). */
  export function indexOf(symbol: string): number {
    return shownRows().findIndex((l) => l.dataset.symbol === symbol);
  }

  /** symbol 행의 버튼(되돌린 행으로 포커스를 옮길 때). */
  export function rowButtonFor(symbol: string): HTMLElement | undefined {
    const li = shownRows().find((l) => l.dataset.symbol === symbol);
    return li?.querySelector<HTMLElement>(':scope > .main-btn') ?? undefined;
  }

  // 키보드 포커스가 목록 안에 있는지. 들어오고 나갈 때만 알린다(목록 안에서 옮길 때는 알리지 않는다).
  // 마우스·터치로 누른 뒤의 포커스는 고정하지 않는다(마지막 입력이 포인터인지 키보드인지로 가린다).
  // 이미 고정 중이면 포인터로 눌러도 풀지 않는다(누르고 떼는 사이에 행이 옮겨지면 클릭이 빗나간다).
  let focusInside = false;
  function hold() {
    focusInside = true;
    onfocuswithin?.(ordered.map((r) => r.symbol));
  }
  function onfocusin() {
    if (focusInside || pointerFocus) return;
    hold();
  }
  // 마우스로 포커스한 요소에서 이어 키보드를 쓰면 새 focusin이 없다. 키를 누르는 시점에 고정을 시작한다.
  function onlistkeydown() {
    if (focusInside || !listEl.contains(document.activeElement)) return;
    hold();
  }
  function leave() {
    focusInside = false;
    onfocuswithin?.(null);
  }
  function onfocusout(e: FocusEvent) {
    const next = e.relatedTarget as Node | null;
    // 목록 안에서 시작한 누름 중에는 풀지 않는다. Safari는 클릭이 포커스를 주지 않아 누르자마자 포커스가 빠진다.
    if (focusInside && !pressInside && (!next || !listEl.contains(next))) leave();
  }

  // 고정 중인 목록 안에서 시작한 누름. 클릭까지 끝난 뒤에 푼다(떼는 순간 풀면 행이 옮겨져 그 행이 click을 못 받는다, WebKit).
  // 뗀 뒤에는 click이 오면 바로, 안 오면 RELEASE_FALLBACK_MS 뒤에, 목록 밖의 새 누름·키 입력이 먼저 오면 그 즉시 푼다. 취소(pointercancel)는 바로 푼다.
  const RELEASE_FALLBACK_MS = 300;
  const DOC_EVENTS = ['pointerup', 'pointercancel', 'click', 'pointerdown', 'keydown'] as const;
  let pressInside = false;
  let pressReleased = false;
  let releaseTimer: ReturnType<typeof setTimeout> | undefined;
  function stopWatchingPress() {
    clearTimeout(releaseTimer);
    for (const t of DOC_EVENTS) document.removeEventListener(t, onpressevent, true);
    pressInside = false;
    pressReleased = false;
  }
  function finishPress() {
    stopWatchingPress();
    // 포커스가 목록 안에 남아 있으면(Chromium) 그대로 둔다. 밖이면 이제 푼다.
    if (focusInside && !listEl?.contains(document.activeElement)) leave();
  }
  function onpressevent(e: Event) {
    switch (e.type) {
      case 'pointerup':
        pressReleased = true;
        clearTimeout(releaseTimer);
        releaseTimer = setTimeout(finishPress, RELEASE_FALLBACK_MS);
        break;
      case 'click':
        // click 핸들러가 끝난 뒤에 푼다.
        if (pressReleased) {
          clearTimeout(releaseTimer);
          releaseTimer = setTimeout(finishPress, 0);
        }
        break;
      case 'pointerdown':
        if (!pressReleased) break;
        if (listEl?.contains(e.target as Node)) {
          // 목록 안의 새 누름은 같은 누름의 이어짐이다. 유예 타이머만 끄고 계속 지켜본다.
          clearTimeout(releaseTimer);
          pressReleased = false;
        } else {
          finishPress();
        }
        break;
      case 'keydown':
        // 키로 포커스를 옮기면 focusout이 오므로 누름 표시만 끄고, 포커스가 이미 body였던 경우는 직후에 확인한다.
        pressInside = false;
        clearTimeout(releaseTimer);
        releaseTimer = setTimeout(finishPress, 0);
        break;
      default:
        finishPress();
    }
  }
  function onlistpointerdown() {
    if (pressInside) return;
    pressInside = true;
    for (const t of DOC_EVENTS) document.addEventListener(t, onpressevent, true);
  }
  onDestroy(() => {
    stopWatchingPress();
    if (focusInside) leave();
  });

  // 다시 정렬하며 행(DOM 노드)을 옮기면 브라우저가 그 안의 포커스를 버린다(예: 되돌린 행에 값이 들어와 위로 갈 때).
  // 옮기기 전에 리스트 안의 포커스를 기억했다가, body로 빠졌으면 같은 요소로 되돌린다.
  let focusBeforeSort: HTMLElement | null = null;
  $effect.pre(() => {
    void ordered;
    const a = document.activeElement;
    focusBeforeSort = a instanceof HTMLElement && listEl?.contains(a) ? a : null;
  });
  $effect(() => {
    void ordered;
    const el = focusBeforeSort;
    focusBeforeSort = null;
    const lost = document.activeElement === null || document.activeElement === document.body;
    if (el?.isConnected && lost) el.focus({ preventScroll: true });
    // 포커스가 있던 행이 사라지면 focusout이 오지 않을 수 있다. 목록에 포커스가 없으면 고정을 푼다.
    if (focusInside && !pressInside && !listEl?.contains(document.activeElement)) leave();
  });

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
    <button type="button" class="btn-add" bind:this={addBtn} onclick={onopenadd}>＋ 종목 추가</button>
  </div>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <ul bind:this={listEl} {onfocusin} {onfocusout} onkeydown={onlistkeydown} onpointerdown={onlistpointerdown}>
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
