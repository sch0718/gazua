// 시뮬레이션 재생(설계 §3): DOM 없는 컨트롤러. 상태는 룬으로 갖고 시계(now·raf·caf)는 주입한다(테스트는 가짜 시계).
export type ReplaySpeed = 1 | 2 | 4 | 8 | 16;
/** 1배 = 초당 1거래일 */
export const REPLAY_SPEEDS: readonly ReplaySpeed[] = [1, 2, 4, 8, 16];
/** 프레임 사이 경과 시간 상한(ms). 다른 탭에 갔다 오면 raf가 멈췄다가 큰 경과로 돌아온다 */
const MAX_FRAME_MS = 1000;

export interface Replay {
  readonly length: number;
  /** 0..length−1. 처음 값은 마지막 날(지금 결과 화면과 같음) */
  readonly index: number;
  readonly playing: boolean;
  readonly speed: ReplaySpeed;
  /** play·seek·step 중 하나라도 하면 true, reset()이 false로 */
  readonly touched: boolean;
  /** 마지막으로 index가 바뀐 양(부호 있음). 처음과 제자리 이동은 0 */
  readonly delta: number;
  /** 마지막 날에서 누르면 0으로 돌아가 시작 */
  play(): void;
  pause(): void;
  toggle(): void;
  /** 범위로 자르고 일시정지 */
  seek(i: number): void;
  /** 일시정지하고 하루 이동 */
  step(d: 1 | -1): void;
  setSpeed(s: ReplaySpeed): void;
  /** 일시정지, index = length−1, touched = false */
  reset(): void;
  destroy(): void;
}

export interface ReplayOptions {
  length: number;
  now?: () => number;
  raf?: (cb: (t: number) => void) => number;
  caf?: (id: number) => void;
}

export function createReplay(opts: ReplayOptions): Replay {
  const n = Math.max(1, opts.length);
  const last = n - 1;
  const now = opts.now ?? (() => performance.now());
  const raf = opts.raf ?? ((cb: (t: number) => void) => requestAnimationFrame(cb));
  const caf = opts.caf ?? ((id: number) => cancelAnimationFrame(id));

  let index = $state(last);
  let delta = $state(0);
  let playing = $state(false);
  let speed = $state<ReplaySpeed>(1);
  let touched = $state(false);
  let frame: number | null = null;
  let prev = 0;
  let acc = 0; // 아직 넘기지 않은 소수 거래일
  let dead = false;

  const clamp = (i: number) => Math.min(last, Math.max(0, Math.round(i)));
  function moveTo(i: number) {
    const next = clamp(i);
    delta = next - index;
    index = next;
  }
  function stopLoop() {
    if (frame !== null) caf(frame);
    frame = null;
  }
  function loop() {
    frame = null;
    if (!playing) return;
    const t = now();
    const dt = Math.min(MAX_FRAME_MS, Math.max(0, t - prev));
    prev = t;
    acc += (dt / 1000) * speed;
    const whole = Math.floor(acc);
    if (whole > 0) {
      acc -= whole;
      moveTo(index + whole);
    }
    if (index >= last) {
      pause();
      return;
    }
    frame = raf(loop);
  }
  function play() {
    if (dead || playing) return;
    touched = true;
    if (index >= last) moveTo(0);
    playing = true;
    acc = 0;
    prev = now();
    frame = raf(loop);
  }
  function pause() {
    playing = false;
    acc = 0;
    stopLoop();
  }

  return {
    get length() {
      return n;
    },
    get index() {
      return index;
    },
    get playing() {
      return playing;
    },
    get speed() {
      return speed;
    },
    get touched() {
      return touched;
    },
    get delta() {
      return delta;
    },
    play,
    pause,
    toggle() {
      if (playing) pause();
      else play();
    },
    seek(i) {
      if (dead) return;
      pause();
      touched = true;
      moveTo(i);
    },
    step(d) {
      if (dead) return;
      pause();
      touched = true;
      moveTo(index + d);
    },
    setSpeed(s) {
      speed = s;
    },
    reset() {
      pause();
      touched = false;
      moveTo(last);
    },
    destroy() {
      dead = true;
      pause();
    },
  };
}

/** 움직임 효과(설계 §4.5): 하루만 움직였고(멈춘 채 이동이거나 1·2배 재생) 움직임 줄이기가 아닐 때만 */
export function replayMotion(r: Pick<Replay, 'delta' | 'playing' | 'speed'>, reduced: boolean): boolean {
  return !reduced && Math.abs(r.delta) === 1 && (!r.playing || r.speed <= 2);
}
