import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRemoteMarketData, makeRemoteWorker } from './remote';

const meta = { info: { collectedAt: '2026-11-12', stocks: 1, range: { from: '2026-01-01', to: '2026-11-12' } }, sectors: [], themes: [] };
describe('원격 시장 데이터', () => {
  afterEach(() => vi.useRealTimers());
  it('요약을 10분 동안 한 번 받아 토큰과 수동 리디렉션을 쓴다', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => Response.json(meta));
    const remote = createRemoteMarketData({ baseUrl: 'https://mac.test/', token: 'market-test-token', fetchImpl });
    await Promise.all([remote.meta(), remote.meta()]);
    await remote.meta();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]).toEqual(['https://mac.test/market/meta', expect.objectContaining({ redirect: 'manual', headers: expect.objectContaining({ 'x-proxy-token': 'market-test-token' }) })]);
    vi.advanceTimersByTime(600_001);
    await remote.meta();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('원격 Worker는 결과와 오류에 요청 번호를 유지한다', async () => {
    const response = { type: 'error' as const, code: 'no-data' as const, id: 7 };
    const remote = { meta: vi.fn(), screen: vi.fn().mockResolvedValueOnce(response).mockRejectedValueOnce(new Error()) };
    const worker = makeRemoteWorker(remote);
    const messages = vi.fn(); worker.onmessage = messages;
    const msg = { type: 'preview' as const, id: 7, input: {} as never };
    worker.postMessage(msg);
    await vi.waitFor(() => expect(messages).toHaveBeenCalledWith({ data: response }));
    worker.postMessage(msg);
    await vi.waitFor(() => expect(messages).toHaveBeenCalledWith({ data: { type: 'error', code: 'remote', id: 7 } }));
  });
  it('종료하면 진행 중 요청을 모두 끊고 결과를 전달하지 않는다', async () => {
    let signal: AbortSignal | undefined;
    const remote = { meta: vi.fn(), screen: vi.fn((_m, s) => { signal = s; return new Promise<never>(() => {}); }) };
    const worker = makeRemoteWorker(remote); const receive = vi.fn(); worker.onmessage = receive;
    worker.postMessage({ type: 'run', input: {} as never });
    worker.terminate();
    expect(signal?.aborted).toBe(true); expect(receive).not.toHaveBeenCalled();
  });
  it('계산은 120초 뒤 끊고 프록시 HTTP 오류를 거절한다', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const remote = createRemoteMarketData({ baseUrl: 'https://mac.test', fetchImpl: vi.fn(async (_u, init) => {
      signal = init?.signal as AbortSignal;
      return await new Promise<Response>((_, reject) => signal?.addEventListener('abort', () => reject(new Error('중단'))));
    }) });
    const pending = remote.screen({ type: 'run', input: {} as never });
    const rejected = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(120_000); await rejected; expect(signal?.aborted).toBe(true);
    const broken = createRemoteMarketData({ baseUrl: 'https://mac.test', fetchImpl: async () => new Response('', { status: 503 }) });
    await expect(broken.meta()).rejects.toThrow();
  });
});
