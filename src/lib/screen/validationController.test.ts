import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MarketDataFile } from '../marketData/format';
import { newCriteria } from './defaults';
import { errorCode, preview, runValidation, type WorkerRequest, type WorkerResponse } from './runValidation';
import { NOW } from './testData';
import { createValidationController, type WorkerLike } from './validationController.svelte';

const fixture = JSON.parse(gunzipSync(readFileSync('tests/fixtures/market-data-demo.json.gz')).toString()) as MarketDataFile;

function crit() {
  const c = newCriteria(NOW, fixture.range);
  c.conditions.rebound.on = false;
  return c;
}

/** 같은 스레드에서 도는 가짜 Worker. step()을 부를 때마다 쌓인 메시지를 하나씩 보낸다 */
function fakeWorker() {
  const queue: WorkerResponse[] = [];
  const posted: WorkerRequest[] = [];
  const w: WorkerLike & { terminated: boolean } = {
    onmessage: null,
    onerror: null,
    terminated: false,
    postMessage(msg: WorkerRequest) {
      posted.push(msg);
      const input = { ...msg.input, data: msg.input.data ?? fixture };
      try {
        if (msg.type === 'preview') {
          queue.push({ type: 'preview', id: msg.id, selection: preview(input.data, input.criteria, input.strategies) });
          return;
        }
        const r = runValidation(input, (done, total) => queue.push({ type: 'progress', done, total }));
        if (!('cancelled' in r)) queue.push({ type: 'result', result: r });
      } catch (e) {
        queue.push({ type: 'error', code: errorCode(e), ...(msg.type === 'preview' && { id: msg.id }) });
      }
    },
    terminate() {
      w.terminated = true;
    },
  };
  const step = () => {
    const m = queue.shift();
    if (m && !w.terminated) w.onmessage?.({ data: m });
  };
  const flush = () => {
    while (queue.length) step();
  };
  return { w, posted, queue, step, flush };
}

describe('createValidationController', () => {
  it('실행 → 진행 → 완료', () => {
    const f = fakeWorker();
    const ctl = createValidationController({ makeWorker: () => f.w });
    expect(ctl.state).toBe('idle');
    ctl.run({ criteria: crit(), strategies: [] });
    expect(ctl.state).toBe('running');
    expect(f.posted[0]).toEqual({ type: 'run', input: { criteria: expect.any(Object), strategies: [] } });
    expect(f.posted[0].input).not.toHaveProperty('data'); // Worker가 IndexedDB에서 직접 읽는다
    f.step();
    expect(ctl.progress).toEqual({ done: 1, total: expect.any(Number) });
    expect(ctl.state).toBe('running');
    f.flush();
    expect(ctl.state).toBe('done');
    expect(ctl.progress.done).toBe(ctl.progress.total);
    expect(ctl.result!.rebalances.length).toBe(ctl.progress.total);
    expect(ctl.error).toBeNull();
  });

  it('취소하면 Worker를 끝내고 idle로 돌아간다. 늦게 온 메시지는 무시한다', () => {
    const f = fakeWorker();
    const ctl = createValidationController({ makeWorker: () => f.w });
    ctl.run({ criteria: crit(), strategies: [] });
    f.step();
    ctl.cancel();
    expect(f.w.terminated).toBe(true);
    expect(ctl.state).toBe('idle');
    expect(ctl.progress).toEqual({ done: 0, total: 0 });
    expect(ctl.result).toBeNull();
    f.w.onmessage?.({ data: { type: 'progress', done: 5, total: 9 } });
    expect(ctl.state).toBe('idle');
  });

  it('취소 뒤 다시 실행하면 새 Worker를 만든다', () => {
    const made: ReturnType<typeof fakeWorker>[] = [];
    const ctl = createValidationController({
      makeWorker: () => {
        const f = fakeWorker();
        made.push(f);
        return f.w;
      },
    });
    ctl.run({ criteria: crit(), strategies: [] });
    ctl.cancel();
    ctl.run({ criteria: crit(), strategies: [] });
    expect(made).toHaveLength(2);
    made[1].flush();
    expect(ctl.state).toBe('done');
  });

  it('오류 코드를 error로 둔다', () => {
    const f = fakeWorker();
    const ctl = createValidationController({ makeWorker: () => f.w });
    const c = crit();
    c.period = { from: '2026-10-17', to: '2026-10-30' };
    ctl.run({ criteria: c, strategies: [] });
    f.flush();
    expect(ctl.state).toBe('error');
    expect(ctl.error).toBe('no-rebalance');
    expect(ctl.result).toBeNull();
  });

  it('Worker 자체 오류는 crash', () => {
    const f = fakeWorker();
    const ctl = createValidationController({ makeWorker: () => f.w });
    ctl.run({ criteria: crit(), strategies: [] });
    f.w.onerror?.(new Event('error'));
    expect(ctl.state).toBe('error');
    expect(ctl.error).toBe('crash');
    expect(f.w.terminated).toBe(true);
  });

  it('미리 보기는 같은 Worker의 preview 메시지로 선별을 돌려준다', async () => {
    const f = fakeWorker();
    const ctl = createValidationController({ makeWorker: () => f.w });
    const c = crit();
    const p = ctl.preview({ criteria: c, strategies: [] });
    expect(f.posted[0]).toMatchObject({ type: 'preview', id: expect.any(Number) });
    f.flush();
    expect(await p).toEqual(preview(fixture, c, []));
    expect(ctl.state).toBe('idle');
  });
});
