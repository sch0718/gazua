<script lang="ts">
  import { untrack, type Snippet } from 'svelte';

  let {
    open,
    title,
    onclose,
    children,
    returnFocus,
  }: {
    open: boolean;
    title: string;
    onclose: () => void;
    children: Snippet;
    /** 닫을 때 열기 전 요소가 문서에서 사라졌으면(예: 지운 행) 대신 포커스할 요소. */
    returnFocus?: () => HTMLElement | null | undefined;
  } = $props();

  const titleId = `sheet-title-${Math.random().toString(36).slice(2, 9)}`;
  const SWIPE_CLOSE_PX = 80;
  // tabindex="-1"은 Tab으로 닿지 않으므로 모든 선택자에서 제외한다(Segmented의 roving tabindex 등).
  const FOCUSABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]',
  ]
    .map((sel) => `${sel}:not([tabindex="-1"])`)
    .join(', ');

  /** 대화상자 안에서 보이지 않는 요소(hidden 속성, display:none, visibility:hidden)는 건너뛴다. */
  function isHidden(el: HTMLElement): boolean {
    for (let n: HTMLElement | null = el; n && n !== dialogEl; n = n.parentElement) {
      if (n.hidden) return true;
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') return true;
    }
    return false;
  }

  let dialogEl = $state<HTMLElement>();
  let dragStartY: number | null = null;
  let dragY = $state(0);

  function focusables(): HTMLElement[] {
    return dialogEl ? [...dialogEl.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !isHidden(el)) : [];
  }

  /** 시트 밖(SnackbarHost)에 떠 있는 스낵바 동작 버튼. 시트가 열려 있는 동안 Tab 순환의 끝에 넣는다. */
  function snackbarAction(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[data-snackbar-action]');
  }

  // 열릴 때: 이전 포커스를 기억하고 첫 요소(data-autofocus 우선)로 이동. 닫힐 때: 복원.
  // 스크롤도 함께 잠근다.
  $effect(() => {
    if (!open) return;
    // dialogEl은 이 시점에 이미 바인딩돼 있다. 의존성으로 잡으면 포커스가 다시 움직이므로 untrack.
    return untrack(() => {
      const previous = document.activeElement as HTMLElement | null;
      const overflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      const first = dialogEl?.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0] ?? dialogEl;
      first?.focus();
      return () => {
        document.body.style.overflow = overflow;
        if (previous && !previous.isConnected && returnFocus) returnFocus()?.focus();
        else previous?.focus?.();
      };
    });
  });

  function onkeydown(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      onclose();
      return;
    }
    if (e.key !== 'Tab' || !dialogEl) return;
    const inside = focusables();
    if (inside.length === 0) {
      e.preventDefault();
      dialogEl.focus();
      return;
    }
    // 스낵바 동작(되돌리기 등)이 있으면 시트의 마지막 컨트롤 다음에 둔다. DOM에서는 떨어져 있어 직접 옮긴다.
    const snack = snackbarAction();
    const items = snack ? [...inside, snack] : inside;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    const i = items.indexOf(active as HTMLElement);
    if (!dialogEl.contains(active) && active !== snack) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && (active === first || active === dialogEl)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    } else if (snack && (active === snack || (!e.shiftKey && i === inside.length - 1))) {
      e.preventDefault();
      items[i + (e.shiftKey ? -1 : 1)].focus();
    }
  }

  function dragStart(e: PointerEvent) {
    dragStartY = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function dragMove(e: PointerEvent) {
    if (dragStartY === null) return;
    dragY = Math.max(0, e.clientY - dragStartY);
  }
  function dragEnd(e: PointerEvent) {
    if (dragStartY === null) return;
    const dy = e.clientY - dragStartY;
    dragStartY = null;
    dragY = 0;
    if (dy > SWIPE_CLOSE_PX) onclose();
  }
  function dragCancel() {
    dragStartY = null;
    dragY = 0;
  }
</script>

<svelte:window {onkeydown} />

{#if open}
  <div class="root">
    <!-- 스크림은 마우스·터치용 보조 수단이다. 키보드 사용자는 Esc와 닫기 버튼을 쓴다. -->
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="scrim" onclick={onclose}></div>
    <div
      class="sheet"
      class:dragging={dragY > 0}
      style:transform={dragY > 0 ? `translateY(${dragY}px)` : undefined}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabindex="-1"
      bind:this={dialogEl}
    >
      <div
        class="grab"
        onpointerdown={dragStart}
        onpointermove={dragMove}
        onpointerup={dragEnd}
        onpointercancel={dragCancel}
        aria-hidden="true"
      >
        <span></span>
      </div>
      <header>
        <h3 id={titleId}>{title}</h3>
        <button type="button" class="close" aria-label="닫기" data-sheet-close onclick={onclose}>✕</button>
      </header>
      <div class="body">{@render children()}</div>
    </div>
  </div>
{/if}

<style>
  .root {
    position: fixed;
    inset: 0;
    z-index: 80;
  }
  .scrim {
    position: absolute;
    inset: 0;
    background: var(--scrim);
    animation: fade var(--dur-base) var(--ease);
  }
  .sheet {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    max-height: 88vh;
    max-height: 88dvh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--surface);
    color: var(--t1);
    border-radius: 24px 24px 0 0;
    box-shadow: var(--shadow);
    animation: up var(--dur-slow) var(--ease);
  }
  .sheet:focus {
    outline: none;
  }
  .sheet.dragging {
    transition: none;
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    padding-bottom: calc(24px + env(safe-area-inset-bottom, 0px));
  }
  .grab {
    flex: none;
    display: flex;
    justify-content: center;
    align-items: center;
    height: 28px;
    touch-action: none;
    cursor: grab;
  }
  .grab span {
    width: 36px;
    height: 5px;
    border-radius: 3px;
    background: var(--line);
  }
  header {
    flex: none;
    display: flex;
    align-items: center;
    padding: 0 8px 2px 20px;
  }
  h3 {
    flex: 1;
    font-size: 19px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .close {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    color: var(--t2);
    display: grid;
    place-items: center;
  }
  .close:hover {
    background: var(--surface2);
  }

  @media (min-width: 1024px) {
    .sheet {
      left: 50%;
      right: auto;
      bottom: auto;
      top: 50%;
      transform: translate(-50%, -50%);
      width: 440px;
      max-height: min(88vh, 720px);
      max-height: min(88dvh, 720px);
      border-radius: 20px;
      animation: pop var(--dur-base) var(--ease);
    }
    .sheet.dragging {
      transform: translate(-50%, -50%) !important;
    }
    .grab {
      display: none;
    }
    header {
      padding-top: 16px;
    }
  }

  @keyframes up {
    from {
      transform: translateY(40px);
      opacity: 0.4;
    }
  }
  @keyframes pop {
    from {
      transform: translate(-50%, -46%);
      opacity: 0;
    }
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  /* 움직임을 줄이는 설정이면 페이드만 쓴다. */
  @media (prefers-reduced-motion: reduce) {
    .sheet {
      animation: fade var(--dur-fast) linear;
    }
  }
</style>
