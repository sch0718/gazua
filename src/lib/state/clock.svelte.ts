export interface Clock {
  /** 1초마다 갱신되는 현재 시각(epoch ms). 탭이 숨겨져 있으면 멈춘다. */
  readonly now: number;
  destroy(): void;
}

type VisibilityDoc = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;

const TICK_MS = 1000;

export function createClock(now: () => number = Date.now, doc: VisibilityDoc | undefined = globalThis.document): Clock {
  let current = $state(now());
  let timer: ReturnType<typeof setInterval> | null = null;
  let destroyed = false;

  const tick = () => {
    current = now();
  };
  const start = () => {
    if (timer === null) timer = setInterval(tick, TICK_MS);
  };
  const stop = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  const onVisibility = () => {
    if (destroyed) return;
    if (doc?.visibilityState === 'hidden') stop();
    else {
      tick();
      start();
    }
  };

  if (doc?.visibilityState !== 'hidden') start();
  doc?.addEventListener('visibilitychange', onVisibility);

  return {
    get now() {
      return current;
    },
    destroy() {
      destroyed = true;
      stop();
      doc?.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
