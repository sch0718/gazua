import { describe, expect, it } from 'vitest';
import { kstDate, kstEpoch } from '../time/kst';
import { newStrategy } from './defaults';
import { sma } from './indicators';
import { createPatternTracker } from './pattern';
import { bar, barsFromCloses, tradingDates } from './testBars';
import type { Strategy } from './types';

type Entry = Strategy['entry'];

const entry: Entry = newStrategy(0, null).entry;
const off: Entry['triggers'] = {
  reboundDays: { on: false, value: 3 },
  breakout: { on: false, level: 'B' },
  maCross: { on: false, period: 20 },
  goldenCross: { on: false, short: 5, long: 20 },
};
const noDecline: Entry['decline'] = { dropPct: { on: false, value: 10 }, days: { on: false, value: 10 } };
const d = (i: number) => tradingDates('2026-01-05', i + 1)[i];

function signalsOf(closes: number[], e: Entry) {
  const tr = createPatternTracker(barsFromCloses(closes), e);
  const out: { i: number; reason: string }[] = [];
  for (let i = 0; i < closes.length; i++) {
    const s = tr.signal(i);
    if (s) out.push({ i, reason: s.reason });
    tr.update(i);
  }
  return out;
}

function snapAt(closes: number[], e: Entry, at: number) {
  const tr = createPatternTracker(barsFromCloses(closes), e);
  for (let i = 0; i < at; i++) {
    tr.signal(i);
    tr.update(i);
  }
  return tr.signal(at)?.snapshot;
}

describe('testBars', () => {
  it('주말을 건너뛴 거래일과 KST 자정 봉', () => {
    expect(tradingDates('2026-01-09', 3)).toEqual(['2026-01-09', '2026-01-12', '2026-01-13']);
    expect(tradingDates('2026-01-10', 1)).toEqual(['2026-01-12']);
    const bs = barsFromCloses([10, 11]);
    expect(bs[1]).toEqual({ t: kstEpoch('2026-01-06', '00:00:00'), o: 11, h: 11, l: 11, c: 11, v: 0 });
    expect(kstDate(bs[0].t)).toBe('2026-01-05');
    expect(bar('2026-01-07', 1, 3, 0.5, 2)).toEqual({ t: kstEpoch('2026-01-07', '00:00:00'), o: 1, h: 3, l: 0.5, c: 2, v: 0 });
  });
});

describe('sma', () => {
  it('앞 period-1개는 null', () => {
    expect(sma([1, 2, 3, 4], 3)).toEqual([null, null, 2, 3]);
    expect(sma([1, 2], 3)).toEqual([null, null]);
  });
});

describe('createPatternTracker', () => {
  // A=100, 하락 중 반등 고점 B=95(인덱스 3), 저점 L=80(인덱스 5)
  const closes = [90, 100, 92, 95, 88, 80, 82, 84, 86, 96];

  it('기본 entry: 3일 연속 상승, 우선순위', () => {
    // 9는 B 돌파도 맞지만 reason 우선순위상 연속 상승
    expect(signalsOf(closes, entry)).toEqual([
      { i: 8, reason: '3일 연속 상승' },
      { i: 9, reason: '3일 연속 상승' },
    ]);
  });

  it('신호 스냅샷은 어제까지의 A·B·L', () => {
    expect(snapAt(closes, entry, 8)).toEqual({ a: 100, aDate: d(1), b: 95, l: 80, lDate: d(5) });
  });

  it('B 돌파만 켬', () => {
    expect(signalsOf(closes, { ...entry, triggers: { ...off, breakout: { on: true, level: 'B' } } })).toEqual([
      { i: 9, reason: 'B 돌파' },
    ]);
  });

  it('B 돌파 경계: 어제 ≤ B, 오늘 > B', () => {
    const e = { ...entry, triggers: { ...off, breakout: { on: true, level: 'B' as const } } };
    // B=95(인덱스 2), L=80(인덱스 3). 4일째는 95 = B라 아님, 5일째 어제 95 = B, 오늘 96
    expect(signalsOf([100, 90, 95, 80, 95, 96], e)).toEqual([{ i: 5, reason: 'B 돌파' }]);
  });

  it('하락이 9%면 신호 없음', () => {
    expect(signalsOf([100, 95, 91, 93, 95, 97, 99], entry)).toEqual([]);
  });

  it('반등이 저점 다음 날부터가 아니면 연속 상승 아님', () => {
    expect(signalsOf([100, 85, 80, 79, 81, 83], entry)).toEqual([]);
  });

  it('B가 없으면 B=A', () => {
    expect(snapAt([100, 95, 90, 85, 87, 89, 91], entry, 6)?.b).toBe(100);
  });

  it('같은 저점이면 나중 것이 L', () => {
    expect(snapAt([100, 80, 85, 80, 82, 84, 86], entry, 6)).toEqual({ a: 100, aDate: d(0), b: 85, l: 80, lDate: d(3) });
    expect(signalsOf([100, 80, 85, 80, 82, 84, 86], entry)).toEqual([{ i: 6, reason: '3일 연속 상승' }]);
  });

  it('하락 조건 둘 다 끄면 L만 있으면 됨', () => {
    const e = { ...entry, decline: noDecline, triggers: { ...off, breakout: { on: true, level: 'B' as const } } };
    expect(signalsOf([100, 99, 100.5], e)).toEqual([{ i: 2, reason: 'B 돌파' }]);
    expect(signalsOf([100, 99, 100.5], { ...e, decline: entry.decline })).toEqual([]);
  });

  it('days 조건만 켬(10일): A 이후 10거래일 전에는 신호 없음', () => {
    const e = { ...entry, decline: { ...noDecline, days: { on: true, value: 10 } } };
    const cs = [100, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99];
    expect(signalsOf(cs, e)).toEqual([{ i: 10, reason: '3일 연속 상승' }]);
  });

  it('A 돌파: 새 최고 종가가 나온 날 신호, 그날 update 뒤 A는 그 종가', () => {
    const e = { ...entry, triggers: { ...off, breakout: { on: true, level: 'A' as const } } };
    const cs = [100, 85, 95, 105, 90, 80, 82, 84, 86, 106];
    expect(signalsOf(cs, e)).toEqual([
      { i: 3, reason: 'A 돌파' },
      { i: 9, reason: 'A 돌파' },
    ]);
    expect(snapAt(cs, e, 9)).toEqual({ a: 105, aDate: d(3), b: 105, l: 80, lDate: d(5) });
  });

  describe('이동평균', () => {
    // MA3: [-, -, 90, 83.3, 80, 83.3], MA2: [-, 95, 85, 80, 80, 85]
    const cs = [100, 90, 80, 80, 80, 90];

    it('maCross: 어제 ≤ MA(경계 포함), 오늘 > MA', () => {
      const e = { ...entry, triggers: { ...off, maCross: { on: true, period: 3 } } };
      expect(signalsOf(cs, e)).toEqual([{ i: 5, reason: '3일선 돌파' }]);
    });

    it('maCross: 봉 수가 기간보다 적으면 불만족', () => {
      const e = { ...entry, triggers: { ...off, maCross: { on: true, period: 10 } } };
      expect(signalsOf(cs, e)).toEqual([]);
    });

    it('goldenCross: 어제 단기 ≤ 장기(경계 포함), 오늘 단기 > 장기', () => {
      const e = { ...entry, triggers: { ...off, goldenCross: { on: true, short: 2, long: 3 } } };
      expect(signalsOf(cs, e)).toEqual([{ i: 5, reason: '골든크로스 2/3' }]);
    });

    it('goldenCross: 봉 수가 장기 기간보다 적으면 불만족', () => {
      const e = { ...entry, triggers: { ...off, goldenCross: { on: true, short: 2, long: 10 } } };
      expect(signalsOf(cs, e)).toEqual([]);
    });

    it('aboveMa 필터: 종가 > MA인 날만, 봉 수가 모자라면 불만족', () => {
      expect(signalsOf(closes, { ...entry, filter: { aboveMa: { on: true, period: 3 } } }).map((s) => s.i)).toEqual([8, 9]);
      // MA10은 9에서 처음 생김(89.3)
      expect(signalsOf(closes, { ...entry, filter: { aboveMa: { on: true, period: 10 } } })).toEqual([
        { i: 9, reason: '3일 연속 상승' },
      ]);
      expect(signalsOf(closes, { ...entry, filter: { aboveMa: { on: true, period: 11 } } })).toEqual([]);
    });

    it('MA 트리거도 L이 있어야 함(하락 조건 둘 다 꺼도)', () => {
      const e = { ...entry, decline: noDecline, triggers: { ...off, maCross: { on: true, period: 3 } } };
      const xs = [100, 100, 100, 50, 55, 120];
      const run = (resetAt: number | null) => {
        const tr = createPatternTracker(barsFromCloses(xs), e);
        const out: number[] = [];
        for (let i = 0; i < xs.length; i++) {
          if (tr.signal(i)) out.push(i);
          tr.update(i);
          if (i === resetAt) tr.reset(i);
        }
        return out;
      };
      expect(run(null)).toEqual([5]);
      // 3일 리셋: A=50, 4일 55가 새 A → L 없음
      expect(run(3)).toEqual([]);
    });
  });

  it('reset(i) 뒤에는 이전 하락으로 신호가 나지 않음', () => {
    const xs = [100, 85, 80, 82, 84, 86];
    expect(signalsOf(xs, entry)).toEqual([{ i: 5, reason: '3일 연속 상승' }]);
    for (const resetFirst of [false, true]) {
      const tr = createPatternTracker(barsFromCloses(xs), entry);
      const out: number[] = [];
      for (let i = 0; i < xs.length; i++) {
        if (tr.signal(i)) out.push(i);
        if (resetFirst && i === 2) tr.reset(i);
        tr.update(i);
        if (!resetFirst && i === 2) tr.reset(i);
      }
      expect(out).toEqual([]);
    }
  });

  it('stats: 최대 하락률과 하락 조건을 만족한 날 수', () => {
    const tr = createPatternTracker(barsFromCloses(closes), entry);
    expect(tr.stats()).toEqual({ maxDropPct: 0, declineDays: 0 });
    for (let i = 0; i < closes.length; i++) {
      tr.signal(i);
      tr.update(i);
    }
    // 하락 조건(어제까지 상태)은 5..9일에 만족
    expect(tr.stats()).toEqual({ maxDropPct: 20, declineDays: 5 });
  });
});
