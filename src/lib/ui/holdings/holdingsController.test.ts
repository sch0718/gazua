import { describe, expect, it } from 'vitest';
import type { AccountHolding, MarketDataProvider } from '../../providers/types';
import { kstEpoch } from '../../time/kst';
import { createHoldingsController } from './holdingsController.svelte';

const NOW = kstEpoch('2026-10-16', '10:00:00');

function fakeProvider(holdings: () => Promise<AccountHolding[]>): MarketDataProvider {
  return {
    capabilities: { venues: ['KRX'], hasIndexCandles: false },
    account: { holdings },
    getCandles: async () => [],
  } as unknown as MarketDataProvider;
}

describe('createHoldingsController', () => {
  it('같은 공급자로 다시 받는 동안 지금 보유를 비우지 않는다(직접 추가·새로고침 때 깜빡이지 않게)', async () => {
    let resolve!: (h: AccountHolding[]) => void;
    let calls = 0;
    const p = fakeProvider(() => {
      calls++;
      return calls === 1 ? Promise.resolve([{ symbol: '005930', name: '삼성전자', quantity: 1 }]) : new Promise((r) => (resolve = r));
    });
    const ctl = createHoldingsController({ now: () => NOW });
    await ctl.load(p, []);
    expect(ctl.account.map((h) => h.symbol)).toEqual(['005930']);

    const again = ctl.load(p, ['000660']);
    expect(ctl.account.map((h) => h.symbol)).toEqual(['005930']);
    resolve([{ symbol: '005930', name: '삼성전자', quantity: 2 }]);
    await again;
    expect(ctl.account[0].quantity).toBe(2);
  });

  it('지수 등락률에 그 거래일을 붙인다(장 전·쉬는 날에는 오늘이 아님을 알 수 있게)', async () => {
    const day = (d: string, c: number) => ({ t: kstEpoch(d, '00:00:00'), o: c, h: c, l: c, c, v: 0 });
    const p = {
      ...fakeProvider(async () => []),
      capabilities: { venues: ['KRX'], hasIndexCandles: true },
      getIndexCandles: async () => [day('2026-10-14', 100), day('2026-10-15', 102)],
    } as unknown as MarketDataProvider;
    const ctl = createHoldingsController({ now: () => NOW });
    await ctl.load(p, []);
    expect(ctl.indexes[0]).toMatchObject({ name: '코스피', date: '2026-10-15' });
    expect(ctl.indexes[0].pct).toBeCloseTo(2);
  });

  it('공급자가 바뀌면 새 응답 전까지 이전 계좌 보유를 비운다', async () => {
    const ctl = createHoldingsController({ now: () => NOW });
    await ctl.load(fakeProvider(async () => [{ symbol: '005930', name: '삼성전자', quantity: 1 }]), []);
    void ctl.load(fakeProvider(() => new Promise(() => {})), []);
    expect(ctl.account).toEqual([]);
  });
});
