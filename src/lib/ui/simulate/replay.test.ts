import { describe, expect, it } from 'vitest';
import { createReplay, replayMotion } from './replay.svelte';

/** 가짜 시계: frame(ms)는 시간을 ms만큼 보내고 대기 중인 raf 콜백을 한 번 부른다 */
function clock() {
  let t = 0;
  let id = 0;
  const cbs = new Map<number, (t: number) => void>();
  return {
    now: () => t,
    raf: (cb: (t: number) => void) => {
      cbs.set(++id, cb);
      return id;
    },
    caf: (i: number) => void cbs.delete(i),
    frame(ms: number) {
      t += ms;
      const due = [...cbs.values()];
      cbs.clear();
      for (const cb of due) cb(t);
    },
    get waiting() {
      return cbs.size;
    },
  };
}

function make(length = 10) {
  const c = clock();
  return { c, r: createReplay({ length, now: c.now, raf: c.raf, caf: c.caf }) };
}

describe('createReplay', () => {
  it('처음: 마지막 날, 멈춤, 1배, touched 아님, delta 0', () => {
    const { r } = make();
    expect([r.length, r.index, r.playing, r.speed, r.touched, r.delta]).toEqual([10, 9, false, 1, false, 0]);
  });

  it('마지막 날에서 play하면 0으로 돌아가 시작하고 touched', () => {
    const { r, c } = make();
    r.play();
    expect([r.index, r.playing, r.touched, r.delta]).toEqual([0, true, true, -9]);
    expect(c.waiting).toBe(1);
    r.play(); // 재생 중에 또 눌러도 프레임을 겹쳐 걸지 않는다
    expect(c.waiting).toBe(1);
  });

  it('1배: 초당 하루, 소수는 누적한다', () => {
    const { r, c } = make();
    r.play();
    c.frame(400);
    expect(r.index).toBe(0);
    c.frame(400);
    expect(r.index).toBe(0);
    c.frame(400);
    expect([r.index, r.delta]).toEqual([1, 1]);
  });

  it('16배: 한 프레임에 여러 날을 건너뛸 수 있다', () => {
    const { r, c } = make(100);
    r.setSpeed(16);
    r.play();
    c.frame(250);
    expect([r.index, r.delta]).toEqual([4, 4]);
  });

  it('프레임 사이 경과 시간은 1초로 자른다(다른 탭에서 돌아온 경우)', () => {
    const { r, c } = make();
    r.play();
    c.frame(5000);
    expect(r.index).toBe(1);
  });

  it('마지막 날에 닿으면 멈추고 프레임을 더 걸지 않는다', () => {
    const { r, c } = make(5);
    r.setSpeed(16);
    r.play();
    c.frame(1000);
    expect([r.index, r.playing]).toEqual([4, false]);
    expect(c.waiting).toBe(0);
  });

  it('재생 중 배속을 바꾸면 다음 프레임부터 그 배속', () => {
    const { r, c } = make();
    r.play();
    c.frame(500);
    r.setSpeed(4);
    c.frame(500); // 0.5 + 2 = 2.5일
    expect(r.index).toBe(2);
  });

  it('seek: 범위로 자르고 반올림하며 일시정지, touched', () => {
    const { r, c } = make();
    r.play();
    r.seek(-3);
    expect([r.index, r.playing]).toEqual([0, false]);
    expect(c.waiting).toBe(0);
    r.seek(99);
    expect(r.index).toBe(9);
    r.seek(2.6);
    expect([r.index, r.delta]).toEqual([3, -6]);
    const fresh = make().r;
    fresh.seek(fresh.index); // 제자리 seek: 움직이지 않고 touched만 켠다
    expect([fresh.index, fresh.touched, fresh.delta]).toEqual([9, true, 0]);
  });

  it('step: 일시정지하고 하루 이동, 끝에서는 그대로', () => {
    const { r, c } = make();
    r.step(1);
    expect([r.index, r.delta, r.touched]).toEqual([9, 0, true]);
    r.step(-1);
    expect([r.index, r.delta]).toEqual([8, -1]);
    r.play();
    r.step(1);
    expect([r.index, r.playing]).toEqual([9, false]);
    expect(c.waiting).toBe(0);
  });

  it('toggle: 재생 ↔ 일시정지', () => {
    const { r } = make();
    r.toggle();
    expect(r.playing).toBe(true);
    r.toggle();
    expect(r.playing).toBe(false);
  });

  it('reset: 일시정지, 마지막 날, touched 끔', () => {
    const { r, c } = make();
    r.play();
    c.frame(1000);
    r.reset();
    expect([r.index, r.playing, r.touched]).toEqual([9, false, false]);
    expect(c.waiting).toBe(0);
  });

  it('destroy 뒤에는 raf가 멈추고 play·seek도 하지 않는다', () => {
    const { r, c } = make();
    r.play();
    r.destroy();
    expect(c.waiting).toBe(0);
    expect(r.playing).toBe(false);
    r.play();
    r.seek(5);
    expect(c.waiting).toBe(0);
    expect(r.index).toBe(0);
  });
});

describe('replayMotion', () => {
  it('하루만 움직였고(멈춤 또는 1·2배) 움직임 줄이기가 아닐 때만 켠다', () => {
    expect(replayMotion({ delta: 1, playing: false, speed: 16 }, false)).toBe(true); // step
    expect(replayMotion({ delta: -1, playing: false, speed: 1 }, false)).toBe(true);
    expect(replayMotion({ delta: 1, playing: true, speed: 2 }, false)).toBe(true);
    expect(replayMotion({ delta: 1, playing: true, speed: 4 }, false)).toBe(false);
    expect(replayMotion({ delta: 3, playing: true, speed: 1 }, false)).toBe(false);
    expect(replayMotion({ delta: 0, playing: false, speed: 1 }, false)).toBe(false);
    expect(replayMotion({ delta: 1, playing: false, speed: 1 }, true)).toBe(false);
  });
});
