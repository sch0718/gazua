// 모바일 당겨서 새로고침: 맨 위에서 손가락을 threshold 넘게 끌어내렸다 떼면 onrefresh.
export interface PullOptions {
  onrefresh: () => void;
  /** 끄는 거리(px, 0 이상). 떼거나 취소하면 0 */
  onpull?: (distance: number) => void;
  threshold?: number;
}

export const PULL_THRESHOLD_PX = 64;

const atTop = (node: HTMLElement) => node.scrollTop <= 0 && (globalThis.scrollY ?? 0) <= 0;

export function pullToRefresh(node: HTMLElement, options: PullOptions) {
  let opts = options;
  let startY: number | null = null;
  let distance = 0;

  const report = (d: number) => {
    distance = d;
    opts.onpull?.(d);
  };
  const onstart = (e: TouchEvent) => {
    startY = e.touches.length === 1 && atTop(node) ? e.touches[0].clientY : null;
    report(0);
  };
  const onmove = (e: TouchEvent) => {
    if (startY === null) return;
    report(Math.max(0, e.touches[0].clientY - startY));
  };
  const onend = () => {
    const pulled = startY !== null && distance > (opts.threshold ?? PULL_THRESHOLD_PX);
    startY = null;
    report(0);
    if (pulled) opts.onrefresh();
  };
  const oncancel = () => {
    startY = null;
    report(0);
  };

  node.addEventListener('touchstart', onstart, { passive: true });
  node.addEventListener('touchmove', onmove, { passive: true });
  node.addEventListener('touchend', onend);
  node.addEventListener('touchcancel', oncancel);
  return {
    update(next: PullOptions) {
      opts = next;
    },
    destroy() {
      node.removeEventListener('touchstart', onstart);
      node.removeEventListener('touchmove', onmove);
      node.removeEventListener('touchend', onend);
      node.removeEventListener('touchcancel', oncancel);
    },
  };
}
