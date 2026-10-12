import { describe, expect, it } from 'vitest';
import { newStrategy } from '../../sim/defaults';
import type { Watchlists } from '../../state/schema';
import { fmtPct, sectionSummary, strategyLine } from './simText';

const NOW = Date.UTC(2026, 9, 12, 1); // 2026-10-12 KST
const W: Watchlists = {
  groups: [
    {
      id: 'g1',
      name: '반도체',
      items: [
        { symbol: '005930', colorSlot: 1, hidden: false, addedAt: 1 },
        { symbol: '000660', colorSlot: 2, hidden: false, addedAt: 1 },
      ],
    },
  ],
};
const s = () => newStrategy(NOW, 'g1');

describe('fmtPct', () => {
  it('uses a real minus sign and one decimal', () => {
    expect(fmtPct(38.2, true)).toBe('+38.2%');
    expect(fmtPct(-12.4, true)).toBe('−12.4%');
    expect(fmtPct(-12.4)).toBe('−12.4%');
    expect(fmtPct(5)).toBe('5.0%');
    expect(fmtPct(0, true)).toBe('0.0%');
    expect(fmtPct(-0.04, true)).toBe('0.0%');
  });
});

describe('strategyLine', () => {
  it('group name and period', () => {
    const x = s();
    x.period = { from: '2023-10-11', to: '2026-10-11' };
    expect(strategyLine(x, W)).toBe('반도체 · 2023.10.11~2026.10.11');
  });
  it('direct symbols and missing groups', () => {
    const x = s();
    x.period = { from: '2023-10-11', to: '2026-10-11' };
    x.universe = { kind: 'symbols', symbols: ['005930'] };
    expect(strategyLine(x, W)).toBe('직접 고른 1종목 · 2023.10.11~2026.10.11');
    x.universe = { kind: 'group', groupId: 'zz' };
    expect(strategyLine(x, W)).toBe('그룹 없음 · 2023.10.11~2026.10.11');
  });
});

describe('sectionSummary (default strategy)', () => {
  const x = s();
  x.period = { from: '2023-10-11', to: '2026-10-11' };
  const sum = (sec: Parameters<typeof sectionSummary>[1], bench: string | null = null) =>
    sectionSummary(x, sec, W, bench);

  it('universe: group name · count', () => expect(sum('universe')).toBe('반도체 · 2종목'));
  it('period and capital', () => {
    expect(sum('period')).toBe('2023.10.11 ~ 2026.10.11');
    expect(sum('capital')).toBe('1,000만 원 · 회당 10%');
  });
  it('entry', () => expect(sum('entry')).toBe('고점 대비 10%↓ 뒤 → 3일 연속 상승 또는 B 돌파'));
  it('scaleIn off', () => expect(sum('scaleIn')).toBe('끔'));
  it('exit', () => expect(sum('exit')).toBe('익절 +15% 전량 · 손절 −5% 분할 완료 후 평단'));
  it('benchmarks', () => {
    expect(sum('benchmarks')).toBe('같은 종목 보유 · KOSPI · 069500');
    expect(sum('benchmarks', 'KODEX 200')).toBe('같은 종목 보유 · KOSPI · KODEX 200');
  });
  it('costs', () => expect(sum('costs')).toBe('수수료 0.015% · 매도 세금'));

  it('other variants', () => {
    const y = structuredClone(x);
    y.capital.initial = 15_000_000;
    y.entry.decline.dropPct.on = false;
    y.entry.decline.days = { on: true, value: 7 };
    y.entry.triggers = {
      reboundDays: { on: false, value: 3 },
      breakout: { on: true, level: 'A' },
      maCross: { on: true, period: 20 },
      goldenCross: { on: true, short: 5, long: 20 },
    };
    y.entry.filter.aboveMa = { on: true, period: 60 };
    y.scaleIn = { on: true, stepPct: 3, maxAdds: 2 };
    y.exit.takeProfit = [
      { pct: 10, sellPct: 50 },
      { pct: 20, sellPct: 100 },
    ];
    y.exit.stopLoss = { pct: 7, basis: 'firstBuy' };
    y.benchmarks.symbol = null;
    expect(sectionSummary(y, 'capital', W, null)).toBe('1,500만 원 · 회당 10%');
    expect(sectionSummary(y, 'entry', W, null)).toBe(
      '7일 하락 뒤 → A 돌파 또는 20일선 돌파 또는 5·20 골든크로스 · 60일선 위',
    );
    expect(sectionSummary(y, 'scaleIn', W, null)).toBe('3%씩 최대 2번');
    expect(sectionSummary(y, 'exit', W, null)).toBe('익절 +10% 50% → +20% 전량 · 손절 −7% 첫 매수가');
    expect(sectionSummary(y, 'benchmarks', W, null)).toBe('같은 종목 보유 · KOSPI');
  });
});
