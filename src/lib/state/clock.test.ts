import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClock } from './clock.svelte';

class FakeDoc extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';
  set(v: DocumentVisibilityState) {
    this.visibilityState = v;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

let t = 0;
const now = () => t;

beforeEach(() => {
  vi.useFakeTimers();
  t = 1_000;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('createClock', () => {
  it('ticks every second', () => {
    const clock = createClock(now, new FakeDoc());
    expect(clock.now).toBe(1_000);
    t = 2_000;
    vi.advanceTimersByTime(999);
    expect(clock.now).toBe(1_000);
    vi.advanceTimersByTime(1);
    expect(clock.now).toBe(2_000);
    clock.destroy();
  });

  it('pauses while hidden and ticks immediately when visible again', () => {
    const doc = new FakeDoc();
    const clock = createClock(now, doc);
    doc.set('hidden');
    t = 9_000;
    vi.advanceTimersByTime(5_000);
    expect(clock.now).toBe(1_000);

    doc.set('visible');
    expect(clock.now).toBe(9_000);
    t = 10_000;
    vi.advanceTimersByTime(1_000);
    expect(clock.now).toBe(10_000);
    clock.destroy();
  });

  it('does not start while created hidden, and stops after destroy', () => {
    const doc = new FakeDoc();
    doc.visibilityState = 'hidden';
    const clock = createClock(now, doc);
    t = 5_000;
    vi.advanceTimersByTime(3_000);
    expect(clock.now).toBe(1_000);
    clock.destroy();
    doc.set('visible');
    expect(clock.now).toBe(1_000);
    expect(vi.getTimerCount()).toBe(0);
  });
});
