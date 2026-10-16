import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MarketDataFile } from '../marketData/format';
import type { MarketDataInfo } from '../marketData/store';
import { newCriteria } from './defaults';
import { precompute } from './precompute';
import type { WorkerResponse } from './runValidation';
import { NOW } from './testData';
import { createWorkerHandler } from './workerHandler';

vi.mock('./precompute', async (orig) => {
  const m = await orig<typeof import('./precompute')>();
  return { ...m, precompute: vi.fn(m.precompute) };
});

const fixture = JSON.parse(gunzipSync(readFileSync('tests/fixtures/market-data-demo.json.gz')).toString()) as MarketDataFile;
const INFO: MarketDataInfo = { collectedAt: fixture.collectedAt, stocks: fixture.stocks.length, range: fixture.range };

function crit() {
  const c = newCriteria(NOW, fixture.range);
  c.conditions.rebound.on = false;
  return c;
}

function setup() {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const store = {
    info: vi.fn(async () => INFO),
    load: vi.fn(async () => {
      await gate;
      return fixture;
    }),
  };
  const posted: WorkerResponse[] = [];
  const handle = createWorkerHandler({ store, post: (m) => posted.push(m) });
  return { store, posted, handle, release };
}

afterEach(() => vi.mocked(precompute).mockClear());

describe('createWorkerHandler', () => {
  it('읽는 중에 온 메시지는 같은 읽기를 기다린다: 미리 보기 3개에 load 한 번', async () => {
    const { store, posted, handle, release } = setup();
    const c = crit();
    const all = [1, 2, 3].map((id) => handle({ type: 'preview', id, input: { criteria: c, strategies: [] } }));
    await Promise.resolve();
    await Promise.resolve();
    release();
    await Promise.all(all);
    expect(store.load).toHaveBeenCalledTimes(1);
    expect(posted.map((m) => m.type === 'preview' && m.id).sort()).toEqual([1, 2, 3]);
  });

  it('같은 기준 값이면 미리 계산을 다시 하지 않고, 값을 바꾸면 다시 한다', async () => {
    const { posted, handle, release } = setup();
    release();
    const c = crit();
    await handle({ type: 'preview', id: 1, input: { criteria: c, strategies: [] } });
    const c2 = crit();
    c2.name = '이름만 다름';
    c2.conditions.tradingValue.minEok = 50; // 문턱 값은 미리 계산과 무관하다
    await handle({ type: 'preview', id: 2, input: { criteria: c2, strategies: [] } });
    expect(precompute).toHaveBeenCalledTimes(1);
    await handle({ type: 'run', input: { criteria: c, strategies: [] } });
    expect(precompute).toHaveBeenCalledTimes(1);
    expect(posted.at(-1)!.type).toBe('result');

    const c3 = crit();
    c3.conditions.tradingValue.days = 5;
    await handle({ type: 'preview', id: 3, input: { criteria: c3, strategies: [] } });
    expect(precompute).toHaveBeenCalledTimes(2);
    expect(posted.filter((m) => m.type === 'error')).toEqual([]);
  });
});
