import { describe, it, expect, vi } from 'vitest';
import { createMarketSource } from './source';
const info = { collectedAt: '2026-11-12', stocks: 1, range: { from: '2026-01-01', to: '2026-11-12' } };
const local = (present = false) => ({ info: vi.fn(async () => present ? info : null), sectors: vi.fn(async () => []), themes: vi.fn(async () => []), themeSymbols: vi.fn(async () => []) });
describe('시장 데이터 원본 선택', () => {
  it('이 기기 파일이 있으면 원격에 요청하지 않는다', async () => {
    const remote = { meta: vi.fn(), screen: vi.fn() }; const source = createMarketSource({ local: local(true), remote });
    expect(await source.info()).toEqual(info); expect(source.mode()).toBe('local'); await source.sectors(); expect(remote.meta).not.toHaveBeenCalled();
  });
  it('이 기기 파일이 없으면 원격 요약과 테마를 쓴다', async () => {
    const remote = { meta: vi.fn(async () => ({ info, sectors: [], themes: [{ code: '1', name: '테마', symbols: ['005930'] }] })), screen: vi.fn() };
    const source = createMarketSource({ local: local(), remote });
    expect(await source.info()).toEqual(info); expect(source.mode()).toBe('remote'); expect(await source.themes()).toEqual([{ code: '1', name: '테마', count: 1 }]); expect(await source.themeSymbols('1')).toEqual(['005930']);
  });
  it('설정도 파일도 없으면 없음이다', async () => { const source = createMarketSource({ local: local() }); expect(await source.info()).toBeNull(); expect(source.mode()).toBe('none'); });
  it('원격에 닿지 않으면 별도 오류 상태다', async () => { const source = createMarketSource({ local: local(), remote: { meta: vi.fn().mockRejectedValue(new Error()), screen: vi.fn() } }); expect(await source.info()).toBeNull(); expect(source.mode()).toBe('remote-error'); });
});
