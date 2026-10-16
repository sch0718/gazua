import { describe, expect, it } from 'vitest';
import { newStrategy } from '../sim/defaults';
import { sma } from '../sim/indicators';
import { createPatternTracker } from '../sim/pattern';
import { tradingDates } from '../sim/testBars';
import { kstEpoch } from '../time/kst';
import { MissingStrategyError, precompute, rebalanceDates, resolveReboundEntry, stableJson, tradingAxis } from './precompute';
import { lastUsablePair, macroKnownFrom, rollingBeta } from './macro';
import { DATES, lcg, mkFile, mkFileV2, mkStock, NOW, offCriteria, olsSlope, reboundAt, reboundEntry, sampleStdPct, usWeekdays, ymd } from './testData';

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

  it('쓴 기준 값을 params로 둔다(이동평균이 꺼져 있으면 null, 변동성이 꺼져 있으면 20, 패턴은 키 순서와 무관한 JSON)', () => {
    const c = offCriteria();
    c.conditions.tradingValue.days = 7;
    const f = mkFile([mkStock('A', [1, 2, 3])], 3);
    expect(precompute(f, c, null).params).toEqual({ tvDays: 7, maPeriod: null, volDays: 20, reboundEntryKey: null, betaDays: null });
    c.conditions.vsMa = { on: true, period: 9, side: 'below' };
    c.conditions.volatility = { on: true, days: 4, maxPct: 1 };
    const e = reboundEntry();
    const reordered = Object.fromEntries(Object.entries(e).reverse()) as typeof e;
    const params = precompute(f, c, e).params;
    expect(params).toEqual({ tvDays: 7, maPeriod: 9, volDays: 4, reboundEntryKey: stableJson(e), betaDays: null });
    expect(stableJson(reordered)).toBe(params.reboundEntryKey);
    expect(JSON.parse(params.reboundEntryKey!)).toEqual(e);
  });

  it('반등 패턴이 없으면 신호일도 없다', () => {
    const s = precompute(mkFile([mkStock('A', reboundAt(5, 12))], 12), offCriteria(), null).stocks[0];
    expect(s.signalDays).toEqual([]);
  });
});

describe('macroKnownFrom: 공개 시점 규칙(스펙 2.3)', () => {
  it.each([
    // 원/달러: 관측일이 속한 주(월~일)의 월요일 + 9일
    ['usdkrw', '20261005', '2026-10-14'], // 월
    ['usdkrw', '20261006', '2026-10-14'], // 화
    ['usdkrw', '20261007', '2026-10-14'], // 수
    ['usdkrw', '20261008', '2026-10-14'], // 목
    ['usdkrw', '20261009', '2026-10-14'], // 금
    ['usdkrw', '20261010', '2026-10-14'], // 토
    ['usdkrw', '20261011', '2026-10-14'], // 일: 같은 주의 끝
    ['usdkrw', '20261012', '2026-10-21'], // 다음 월요일은 다음 주
    ['usdkrw', '20261231', '2027-01-06'], // 해 경계
    // WTI: 관측 다음 날 이후 첫 수요일 + 2일
    ['wti', '20261012', '2026-10-16'], // 월 → 화 다음 첫 수(10-14) + 2
    ['wti', '20261013', '2026-10-16'], // 화 → 수(10-14) 당일 + 2
    ['wti', '20261014', '2026-10-23'], // 수 → 목 다음 첫 수(10-21) + 2
    ['wti', '20261015', '2026-10-23'], // 목
    ['wti', '20261229', '2027-01-01'], // 해 경계
  ] as const)('%s %s → %s', (series, obs, want) => {
    expect(macroKnownFrom(series, obs)).toBe(want);
  });
});

describe('rollingBeta: 누적합 롤링 β(스펙 3.1·3.4)', () => {
  /** 매일 ±1%로 번갈아 움직이는 계열 값(봉마다 짝지은 값) */
  const altSeries = (n: number): number[] => {
    const a = [1000];
    for (let i = 1; i < n; i++) a.push(a[i - 1] * (i % 2 ? 1.01 : 0.99));
    return a;
  };
  /** 계열 변화율의 m배로 움직이는 종가 */
  const follow = (a: ArrayLike<number>, m: number): number[] => {
    const c = [100];
    // 짝이 없거나 0 이하인 쌍에서는 움직이지 않는다
    for (let i = 1; i < a.length; i++) c.push(c[i - 1] * (1 + (a[i] > 0 && a[i - 1] > 0 ? m * (a[i] / a[i - 1] - 1) : 0)));
    return c;
  };

  it('환율이 매일 ±1%, 종목이 정확히 2배로 움직이면 β = 2. betaDays번 봉부터 값이 있다', () => {
    const a = altSeries(50);
    const b = rollingBeta(follow(a, 2), a, 30);
    expect(b).toBeInstanceOf(Float64Array);
    expect(Number.isNaN(b[29])).toBe(true);
    for (let i = 30; i < 50; i++) expect(b[i]).toBeCloseTo(2, 9);
    for (let i = 0; i < 30; i++) expect(Number.isNaN(b[i])).toBe(true);
  });

  it('쌍이 betaDays × 0.8개보다 적으면 NaN(값이 없는 봉은 쌍에서 빠진다)', () => {
    const a = altSeries(60);
    const c = follow(a, 2);
    const holes = a.map((v, i) => (i < 10 ? NaN : v)); // 쌍은 11번 봉부터
    const b = rollingBeta(c, holes, 30); // 24쌍이 필요: 창 [i−29, i]에서 i − 10 ≥ 24 → i ≥ 34
    expect(Number.isNaN(b[33])).toBe(true);
    expect(b[34]).toBeCloseTo(2, 9);
  });

  it('움직이다가 betaDays 이상 평평하면(창 안 x가 모두 0) NaN. 누적합 찌꺼기로 β를 만들지 않는다', () => {
    const r = lcg(1);
    const n = 600;
    const a: number[] = [];
    const c: number[] = [];
    let x = 1300;
    let y = 1e4;
    for (let i = 0; i < n; i++) {
      if (i < 300) x *= 1 + (r() - 0.5) * 0.02;
      y *= 1 + (r() - 0.5) * 0.06;
      a.push(x);
      c.push(y);
    }
    for (const days of [30, 60, 120, 250]) {
      const b = rollingBeta(c, a, days);
      expect(Number.isFinite(b[299]), `${days}일 평평하기 전`).toBe(true);
      for (let i = 300 + days; i < n; i++) expect(b[i], `${days}일 봉 ${i}`).toBeNaN();
    }
    // 창 안에 움직인 쌍이 하나뿐이어도 NaN(기울기를 정할 수 없다)
    const one = rollingBeta(c, a, 30);
    expect(one[300 + 28]).toBeNaN();
  });

  it('계열 변화가 모두 0이면(분산 0) NaN', () => {
    const a = Array(50).fill(1000);
    const b = rollingBeta(follow(altSeries(50), 2), a, 30);
    expect([...b].every(Number.isNaN)).toBe(true);
  });

  it('임의 데이터 260일(betaDays보다 긴 구멍 포함): 롤링 β가 창마다 직접 계산한 값과 1e-9 안에서 같다', () => {
    const r = lcg(42);
    const n = 260;
    const a: number[] = [];
    const c: number[] = [];
    let x = 1300;
    let y = 50000;
    for (let i = 0; i < n; i++) {
      x *= 1 + (r() - 0.5) * 0.02;
      y *= 1 + (r() - 0.5) * 0.06;
      // 100~108: 짧은 구멍(쌍 부족), 180~220: betaDays보다 긴 구멍(창이 완전히 비었다가 다시 찬다)
      a.push((i >= 100 && i <= 108) || (i >= 180 && i <= 220) ? NaN : i === 150 ? -5 : i === 170 ? 0 : x);
      c.push(y);
    }
    const days = 30;
    const b = rollingBeta(c, a, days);
    let finite = 0;
    let nan = 0;
    for (let i = 0; i < n; i++) {
      let want = NaN;
      if (i >= days) {
        const rs: number[] = [];
        const xs: number[] = [];
        for (let j = i - days + 1; j <= i; j++) {
          if (!(a[j] > 0 && a[j - 1] > 0)) continue;
          rs.push(c[j] / c[j - 1] - 1);
          xs.push(a[j] / a[j - 1] - 1);
        }
        if (rs.length >= days * 0.8) want = olsSlope(rs, xs);
      }
      if (Number.isNaN(want)) {
        nan++;
        expect(b[i], `봉 ${i}`).toBeNaN();
      } else {
        finite++;
        expect(Math.abs(b[i] - want), `봉 ${i}`).toBeLessThan(1e-9);
      }
    }
    // 창 경계·쌍 부족 구간과 정상 구간이 모두 있어야 검사가 뜻이 있다
    expect(finite).toBeGreaterThan(100);
    expect(nan).toBeGreaterThan(days + 5);
  });

  it('0 이하 값: −36.98 → 8.91 쌍과 0 → 10 쌍은 빠지고, 창이 지나간 뒤에도 NaN이 남지 않는다', () => {
    const r = lcg(7);
    const n = 120;
    const a: number[] = [];
    let x = 20;
    for (let i = 0; i < n; i++) {
      x *= 1 + (r() - 0.5) * 0.05;
      a.push(x);
    }
    a[40] = -36.98;
    a[41] = 8.91;
    a[60] = 0;
    a[61] = 10;
    const c = follow(a, 1.5);
    const b = rollingBeta(c, a, 30);
    for (let i = 30; i < n; i++) expect(Number.isFinite(b[i]), `봉 ${i}`).toBe(true);
    // 빠진 쌍(40·41·42 / 60·61·62의 이웃 쌍)이 창에 있어도 기울기는 나머지 쌍 기준
    const valid = (j: number) => a[j] > 0 && a[j - 1] > 0;
    const rs: number[] = [];
    const xs: number[] = [];
    for (let j = 41; j <= 70; j++)
      if (valid(j)) {
        rs.push(c[j] / c[j - 1] - 1);
        xs.push(a[j] / a[j - 1] - 1);
      }
    expect(b[70]).toBeCloseTo(olsSlope(rs, xs), 9);
  });
});

describe('precompute: 환율·유가 β', () => {
  const obs = usWeekdays('2024-11-01', 400);
  const fx = { d: obs, v: obs.map((_, i) => 1000 * (1 + 0.01 * Math.sin(i))) };

  it('macro 조건이 켜져 있으면 betaDays를 params에 두고 종목마다 계열별 β 배열을 만든다', () => {
    const c = offCriteria();
    c.conditions.macro.betaDays = 40;
    c.conditions.macro.usdkrw.beta.on = true;
    const pre = precompute(mkFileV2([mkStock('A', DATES.map((_, i) => 100 + i))], 300, { usdkrw: fx }), c, null);
    expect(pre.params.betaDays).toBe(40);
    const s = pre.stocks[0];
    expect(s.beta.usdkrw).toBeInstanceOf(Float64Array);
    expect(s.beta.usdkrw.length).toBe(300);
    expect(Number.isFinite(s.beta.usdkrw[299])).toBe(true);
    expect([...s.beta.wti].every(Number.isNaN)).toBe(true); // WTI 계열이 비어 있다
  });

  it('정렬이 macroBeta여도 β를 계산한다', () => {
    const c = offCriteria();
    c.rank = { by: 'macroBeta', take: 5, series: 'wti' };
    expect(precompute(mkFileV2([mkStock('A', [1, 2, 3])], 3), c, null).params.betaDays).toBe(120);
  });

  it('v1 데이터면 β는 모두 NaN', () => {
    const c = offCriteria();
    c.conditions.macro.usdkrw.beta.on = true;
    const s = precompute(mkFile([mkStock('A', DATES.map((_, i) => 100 + i))], 300), c, null).stocks[0];
    expect(s.beta.usdkrw.length).toBe(300);
    expect([...s.beta.usdkrw, ...s.beta.wti].every(Number.isNaN)).toBe(true);
  });
});

describe('lastUsablePair: 봉의 쌍은 그다음 관측값이 공개된 뒤에야 확정된다(스펙 2.3)', () => {
  // 관측값 0·1·2의 knownFrom. 봉 0은 짝 없음, 봉 1·2는 관측값 0, 봉 3·4는 1, 봉 5·6은 2(마지막 관측값)
  const known = ['2026-01-10', '2026-01-20', '2026-01-30'];
  const idx = Int32Array.from([-1, 0, 0, 1, 1, 2, 2]);
  it.each([
    ['2026-01-09', -1], // 관측값 0도 공개 전: 봉 0조차 짝이 없는지 알 수 없다
    ['2026-01-10', 0], // 관측값 0이 공개됐다: 봉 0은 짝이 없다고 확정
    ['2026-01-20', 2], // 관측값 1이 공개됐다: 관측값 0과 짝지은 봉 1·2가 확정
    ['2026-01-30', 4],
    ['2026-12-31', 4], // 마지막 관측값과 짝지은 봉 5·6은 다음 관측값이 없어 끝내 확정되지 않는다
  ] as const)('p = %s → i* = %i', (p, want) => {
    expect(lastUsablePair(idx, known, p, 6)).toBe(want);
  });
  it('hi(p의 봉)를 넘지 않는다', () => {
    expect(lastUsablePair(idx, known, '2026-12-31', 3)).toBe(3);
  });
});
