<script lang="ts">
  import { untrack, type Snippet } from 'svelte';

  let {
    open,
    title,
    onclose,
    children,
  }: { open: boolean; title: string; onclose: () => void; children: Snippet } = $props();

  const titleId = `sheet-title-${Math.random().toString(36).slice(2, 9)}`;
  const SWIPE_CLOSE_PX = 80;
  const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  let dialogEl = $state<HTMLElement>();
  let dragStartY: number | null = null;
  let dragY = $state(0);

  function focusables(): HTMLElement[] {
    return dialogEl ? [...dialogEl.querySelectorAll<HTMLElement>(FOCUSABLE)] : [];
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
        previous?.focus?.();
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
    const items = focusables();
    if (items.length === 0) {
      e.preventDefault();
      dialogEl.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (!dialogEl.contains(active)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && (active === first || active === dialogEl)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
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
        <button type="button" class="close" aria-label="닫기" onclick={onclose}>✕</button>
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
    overflow: auto;
    background: var(--surface);
    color: var(--t1);
    border-radius: 24px 24px 0 0;
    padding: 0 0 calc(24px + env(safe-area-inset-bottom, 0px));
    box-shadow: var(--shadow);
    animation: up var(--dur-slow) var(--ease);
    overscroll-behavior: contain;
  }
  .sheet:focus {
    outline: none;
  }
  .sheet.dragging {
    transition: none;
  }
  .grab {
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
      border-radius: 20px;
      padding-bottom: 24px;
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
