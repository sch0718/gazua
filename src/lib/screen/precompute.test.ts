import { describe, expect, it } from 'vitest';
import { newStrategy } from '../sim/defaults';
import { sma } from '../sim/indicators';
import { createPatternTracker } from '../sim/pattern';
import { tradingDates } from '../sim/testBars';
import { kstEpoch } from '../time/kst';
import { MissingStrategyError, precompute, rebalanceDates, resolveReboundEntry, tradingAxis } from './precompute';
import { DATES, mkFile, mkStock, NOW, offCriteria, reboundAt, reboundEntry, sampleStdPct, ymd } from './testData';

describe('tradingAxis', () => {
  it('지수 날짜 ∪ 종목 날짜를 YYYY-MM-DD 오름차순으로 낸다', () => {
    const f = mkFile([mkStock('A', [null, 1, 1, null, 1, 1])], 3);
    f.indices[0].d = [ymd(DATES[0]), ymd(DATES[2])];
    f.indices[0].o = [1, 1];
    f.indices[0].c = [1, 1];
    f.indices.push({ id: 'KOSDAQ', d: [ymd(DATES[3])], o: [1], c: [1] });
    expect(tradingAxis(f)).toEqual(DATES.slice(0, 6));
  });

  it('지수가 없어도 종목 날짜로 축을 만든다', () => {
    const f = mkFile([mkStock('A', [1, 1]), mkStock('B', [null, 1, 1])], 1);
    f.indices = [];
    expect(tradingAxis(f)).toEqual(DATES.slice(0, 3));
  });
});

describe('rebalanceDates', () => {
  const axis = tradingDates('2025-01-02', 300); // 평일만, 2026-02 말까지

  it('월 첫 거래일', () => {
    expect(rebalanceDates(axis, { from: '2025-01-02', to: '2025-04-30' }, 'monthly')).toEqual([
      '2025-01-02',
      '2025-02-03',
      '2025-03-03',
      '2025-04-01',
    ]);
  });

  it('1월 2일 휴장이면 1월 3일이 그달 첫 거래일이다', () => {
    const ax = tradingDates('2024-12-23', 20).filter((d) => d !== '2025-01-01' && d !== '2025-01-02');
    expect(rebalanceDates(ax, { from: '2024-12-23', to: '2025-01-17' }, 'monthly')).toEqual(['2024-12-23', '2025-01-03']);
    expect(rebalanceDates(ax, { from: '2025-01-01', to: '2025-01-17' }, 'monthly')).toEqual(['2025-01-03']);
  });

  it('분기(1·4·7·10월)와 반기(1·7월) 첫 거래일', () => {
    const period = { from: '2025-01-02', to: '2025-12-31' };
    expect(rebalanceDates(axis, period, 'quarterly')).toEqual(['2025-01-02', '2025-04-01', '2025-07-01', '2025-10-01']);
    expect(rebalanceDates(axis, period, 'semiannual')).toEqual(['2025-01-02', '2025-07-01']);
  });

  it('기간 시작이 비거래일이면 그 뒤 첫 거래일부터, 거래일이면 그날부터', () => {
    expect(rebalanceDates(axis, { from: '2025-03-15', to: '2025-05-31' }, 'monthly')).toEqual([
      '2025-03-17',
      '2025-04-01',
      '2025-05-01',
    ]);
    expect(rebalanceDates(axis, { from: '2025-03-14', to: '2025-04-30' }, 'monthly')).toEqual(['2025-03-14', '2025-04-01']);
    expect(rebalanceDates(axis, { from: '2025-02-15', to: '2025-09-30' }, 'quarterly')).toEqual([
      '2025-02-17',
      '2025-04-01',
      '2025-07-01',
    ]);
  });

  it('기간 끝 뒤는 넣지 않고, 기간 안에 거래일이 없으면 빈 배열', () => {
    expect(rebalanceDates(axis, { from: '2025-01-02', to: '2025-02-28' }, 'monthly')).toEqual(['2025-01-02', '2025-02-03']);
    expect(rebalanceDates(axis, { from: '2025-03-01', to: '2025-03-02' }, 'monthly')).toEqual([]);
    expect(rebalanceDates(axis, { from: '2030-01-01', to: '2030-12-31' }, 'monthly')).toEqual([]);
  });
});

describe('resolveReboundEntry', () => {
  const strategy = newStrategy(NOW, null);
  strategy.entry.triggers.maCross = { on: true, period: 33 };

  it('반등 조건이 꺼져 있으면 null', () => {
    const c = offCriteria();
    c.conditions.rebound.pattern = { from: 'strategy', strategyId: 'gone' };
    expect(resolveReboundEntry(c, [])).toBeNull();
  });

  it('custom이면 그 값, strategy면 그 전략의 entry', () => {
    const c = offCriteria();
    c.conditions.rebound.on = true;
    const custom = reboundEntry();
    c.conditions.rebound.pattern = { from: 'custom', entry: custom };
    expect(resolveReboundEntry(c, [strategy])).toEqual(custom);
    c.conditions.rebound.pattern = { from: 'strategy', strategyId: strategy.id };
    expect(resolveReboundEntry(c, [strategy])).toEqual(strategy.entry);
  });

  it('가리키는 전략이 없으면 MissingStrategyError', () => {
    const c = offCriteria();
    c.conditions.rebound.on = true;
    c.conditions.rebound.pattern = { from: 'strategy', strategyId: 'gone' };
    expect(() => resolveReboundEntry(c, [strategy])).toThrow(MissingStrategyError);
  });
});

describe('precompute', () => {
  it('날짜·종가와 메타를 옮긴다(봉이 빠진 날은 건너뛴다)', () => {
    const st = mkStock('A', [10, null, 30], { m: 'KOSDAQ', t: 'ETF', sec: ['11028', '', ''], shares: 7, managed: true });
    const pre = precompute(mkFile([st], 3), offCriteria(), null);
    expect(pre.axis).toEqual(DATES.slice(0, 3));
    const s = pre.stocks[0];
    expect(s.d).toEqual([DATES[0], DATES[2]]);
    expect(s.close).toEqual([10, 30]);
    expect([s.s, s.m, s.t, s.sec, s.shares, s.managed, s.halted]).toEqual(['A', 'KOSDAQ', 'ETF', ['11028', '', ''], 7, true, false]);
  });

  it('거래대금 이동평균은 tradingValue.days개 평균이고 모자라면 null', () => {
    const c = offCriteria();
    c.conditions.tradingValue.days = 3;
    const tv = [1, 2, 3, 4, 5];
    const pre = precompute(mkFile([mkStock('A', [1, 1, 1, 1, 1], { tv })], 5), c, null);
    expect(pre.stocks[0].tvAvg).toEqual([null, null, 2, 3, 4]);
  });

  it('이동평균은 vsMa.period일 단순이동평균', () => {
    const c = offCriteria();
    c.conditions.vsMa = { on: true, period: 3, side: 'above' };
    const closes = [10, 20, 30, 40, 50, 60];
    const pre = precompute(mkFile([mkStock('A', closes)], 6), c, null);
    expect(pre.stocks[0].ma).toEqual(sma(closes, 3));
  });

  it('250일 롤링 최대: 120개 미만이면 null, 120~249개는 있는 만큼, 그 뒤는 최근 250개', () => {
    const closes = Array.from({ length: 300 }, (_, i) => 100 + (i === 5 ? 500 : 0) + (i === 100 ? 200 : 0));
    const hi = precompute(mkFile([mkStock('A', closes)], 300), offCriteria(), null).stocks[0].high;
    expect(hi[118]).toBeNull();
    expect(hi[119]).toBe(600);
    expect(hi[254]).toBe(600); // 5..254
    expect(hi[255]).toBe(300); // 6..255, 5번 봉은 창 밖
    expect(hi[299]).toBe(300); // 50..299
  });

  it('변동성은 days개 일간 수익률의 표본 표준편차(%), 꺼져 있으면 20일', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + ((i * 7) % 5) - (i % 3));
    const c = offCriteria();
    c.conditions.volatility = { on: true, days: 4, maxPct: 3 };
    const vol = precompute(mkFile([mkStock('A', closes)], 30), c, null).stocks[0].vol;
    expect(vol[3]).toBeNull();
    expect(vol[4]).toBeCloseTo(sampleStdPct(closes.slice(0, 5)), 10);
    expect(vol[29]).toBeCloseTo(sampleStdPct(closes.slice(25, 30)), 10);

    c.conditions.volatility.on = false;
    const vol20 = precompute(mkFile([mkStock('A', closes)], 30), c, null).stocks[0].vol;
    expect(vol20[19]).toBeNull();
    expect(vol20[20]).toBeCloseTo(sampleStdPct(closes.slice(0, 21)), 10);
    expect(vol20[29]).toBeCloseTo(sampleStdPct(closes.slice(9, 30)), 10);
  });

  it('반등 신호일은 패턴 추적기를 날짜순으로 돌려 신호가 난 날이다(reset 없음)', () => {
    const closes = [...reboundAt(5, 12), 75, 80, 60, 61, 62]; // 5·13·16에서 신호
    const st = mkStock('A', closes);
    const entry = reboundEntry();
    const s = precompute(mkFile([st], closes.length), offCriteria(), entry).stocks[0];

    const candles = DATES.slice(0, closes.length).map((d, i) => ({ t: kstEpoch(d, '00:00:00'), o: closes[i], h: closes[i], l: closes[i], c: closes[i], v: 1 }));
    const tr = createPatternTracker(candles, entry);
    const want: string[] = [];
    closes.forEach((_, i) => {
      if (tr.signal(i)) want.push(DATES[i]);
      tr.update(i);
    });
    expect(want.length).toBeGreaterThan(1);
    expect(s.signalDays).toEqual(want);
    expect(s.signalDays).toEqual([DATES[5], DATES[13], DATES[16]]);
  });

  it('반등 패턴이 없으면 신호일도 없다', () => {
    const s = precompute(mkFile([mkStock('A', reboundAt(5, 12))], 12), offCriteria(), null).stocks[0];
    expect(s.signalDays).toEqual([]);
  });
});
