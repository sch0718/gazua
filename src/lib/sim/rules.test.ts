import { describe, expect, it } from 'vitest';
import type { Candle } from '../data/metrics';
import { REASON_MAX as SHARE_REASON_MAX } from '../share/checkResult';
import { createPatternTracker } from './pattern';
import { condReason, createRuleEvaluator, REASON_MAX, rulesLookback } from './rules';
import type { Cond, CondGroup } from './strategyV2';
import { defaultCond } from './strategyV2';
import { randomWalk } from './testInputs';
import { bar, tradingDates } from './testBars';

const D = tradingDates('2026-01-05', 80);
const closes = (xs: number[], vols?: number[]): Candle[] => xs.map((c, i) => ({ ...bar(D[i], c, c, c, c), v: vols ? vols[i] : 100 }));
const one = (cond: Cond): CondGroup[] => [{ conds: [cond] }];
const hits = (candles: Candle[], groups: CondGroup[]) => {
  const ev = createRuleEvaluator(candles, groups, 0);
  const out: number[] = [];
  candles.forEach((_, i) => {
    if (ev.signal(i)) out.push(i);
    ev.update(i);
  });
  return out;
};

describe('condReason', () => {
  it('스펙 §4.7 문구', () => {
    expect(condReason({ kind: 'maPrice', period: 20, side: 'above' })).toBe('종가 20일선 위');
    expect(condReason({ kind: 'maCross', short: 20, long: 60, dir: 'golden' })).toBe('골든크로스 20/60');
    expect(condReason({ kind: 'maCross', short: 20, long: 60, dir: 'dead' })).toBe('데드크로스 20/60');
    expect(condReason({ kind: 'rsi', period: 14, level: 30, op: 'crossUp' })).toBe('RSI14 30 상향 돌파');
    expect(condReason({ kind: 'rsi', period: 14, level: 70, op: 'above' })).toBe('RSI14 70 위');
    expect(condReason({ kind: 'volume', days: 20, ratio: 1.5 })).toBe('거래량 20일 평균 1.5배↑');
    expect(condReason({ kind: 'change', days: 5, pct: 10, op: 'above' })).toBe('5일 +10% 이상');
    expect(condReason({ kind: 'change', days: 5, pct: -10, op: 'below' })).toBe('5일 −10% 이하');
    expect(condReason({ kind: 'fromHigh', days: 60, pct: 20 })).toBe('60일 고점 −20%↓');
    expect(condReason({ kind: 'newHigh', days: 60 })).toBe('60일 신고가');
  });
  it('사유 상한이 공유 검사(checkResult)와 같다', () => expect(REASON_MAX).toBe(SHARE_REASON_MAX));
});

describe('조건 판정(§5.2)', () => {
  it('maPrice: 같으면 위·아래 둘 다 불만족', () => {
    const c = closes([10, 10, 10, 12, 8, 10]);
    expect(hits(c, one({ kind: 'maPrice', period: 3, side: 'above' }))).toEqual([3]);
    expect(hits(c, one({ kind: 'maPrice', period: 3, side: 'below' }))).toEqual([4]);
  });
  it('maCross: 전날 이하 → 오늘 초과만 골든', () => {
    const c = closes([5, 5, 5, 5, 9, 9, 1, 1]);
    expect(hits(c, one({ kind: 'maCross', short: 1, long: 3, dir: 'golden' }))).toEqual([4]);
    expect(hits(c, one({ kind: 'maCross', short: 1, long: 3, dir: 'dead' }))).toEqual([6]);
  });
  it('rsi: 상향 돌파는 전날 ≤ 기준 < 오늘(같으면 넘은 것이 아님)', () => {
    // RSI(2): i=2 0, i=3 0, i=4 50, i=5 75. i=4는 50이라 「기준 초과」가 아니고 i=5에서 넘는다
    const c = closes([10, 9, 8, 7, 8, 9, 10, 11]);
    expect(hits(c, one({ kind: 'rsi', period: 2, level: 50, op: 'crossUp' }))).toEqual([5]);
  });
  it('rsi: 충분한 워밍업 앞에 봉을 더 받아도 첫 거래일부터 판정이 같다', () => {
    const dates = tradingDates('2024-01-02', 306);
    const tail = [100, 101, 100, 100, 99, 100];
    // 고정 시작점 앞은 상승, 뒤 250봉은 보합이다
    const candles = dates.map((dt, i) => {
      const c = i < 50 ? 50 + i : i < 300 ? 100 : tail[i - 300];
      return bar(dt, c, c, c, c);
    });
    const groups = one({ kind: 'rsi', period: 14, level: 50, op: 'above' });
    const full = createRuleEvaluator(candles, groups, 300);
    const shorter = createRuleEvaluator(candles.slice(50), groups, 250);
    const signals = tail.map((_, i) => full.signal(300 + i));

    expect(signals).toEqual(tail.map((_, i) => shorter.signal(250 + i)));
    expect(signals.map((s) => s !== null)).toEqual([false, true, false, false, false, true]);
  });
  it('volume: 배 이상은 같음 포함', () => {
    const c = closes([1, 1, 1, 1], [10, 10, 10, 20]);
    expect(hits(c, one({ kind: 'volume', days: 3, ratio: 2 }))).toEqual([3]);
  });
  it('change: 이하는 같음 포함(부동소수 오차 무시)', () => {
    const c = closes([100, 95, 90]);
    expect(hits(c, one({ kind: 'change', days: 2, pct: -10, op: 'below' }))).toEqual([2]);
    expect(hits(c, one({ kind: 'change', days: 2, pct: 10, op: 'above' }))).toEqual([]);
  });
  it('fromHigh: days개 최고 종가 대비', () => {
    const c = closes([100, 90, 80, 85]);
    expect(hits(c, one({ kind: 'fromHigh', days: 3, pct: 20 }))).toEqual([2]);
  });
  it('newHigh: 어제까지 days개 최고 종가를 넘으면(같으면 아님)', () => {
    const c = closes([10, 12, 11, 12, 13]);
    expect(hits(c, one({ kind: 'newHigh', days: 2 }))).toEqual([4]);
  });
  it('값이 모자란 구간은 불만족', () => {
    expect(hits(closes([1, 2]), one({ kind: 'maPrice', period: 5, side: 'above' }))).toEqual([]);
  });
});

describe('묶음', () => {
  const c = closes([10, 10, 10, 12, 13, 14], [1, 1, 1, 5, 1, 1]);
  it('묶음 안 AND: 하나라도 틀리면 불만족', () => {
    const g: CondGroup[] = [{ conds: [{ kind: 'maPrice', period: 3, side: 'above' }, { kind: 'volume', days: 3, ratio: 2 }] }];
    expect(hits(c, g)).toEqual([3]);
  });
  it('묶음끼리 OR: 처음 맞은 묶음의 사유', () => {
    const g: CondGroup[] = [{ conds: [{ kind: 'volume', days: 3, ratio: 2 }] }, { conds: [{ kind: 'maPrice', period: 3, side: 'above' }] }];
    const ev = createRuleEvaluator(c, g, 0);
    expect(ev.signal(3)?.reason).toBe('거래량 3일 평균 2배↑');
    expect(ev.signal(4)?.reason).toBe('종가 3일선 위');
  });
  it('빈 묶음은 맞지 않는다', () => {
    expect(hits(c, [{ conds: [] }])).toEqual([]);
  });
  it('사유가 40자를 넘으면 39자 + …', () => {
    const conds: Cond[] = Array.from({ length: 5 }, () => ({ kind: 'volume', days: 3, ratio: 1 }) as Cond);
    const r = createRuleEvaluator(c, [{ conds }], 0).signal(3)!.reason;
    expect(r).toHaveLength(40);
    expect(r.endsWith('…')).toBe(true);
  });
});

describe('패턴 블록 = 기존 추적기', () => {
  it('신호 날짜·사유·스냅샷·통계가 같다(reset 포함)', () => {
    const candles = randomWalk(tradingDates('2025-01-02', 300), 7);
    const entry = defaultCond('pattern').entry;
    const ev = createRuleEvaluator(candles, one({ kind: 'pattern', entry }), 0);
    const tr = createPatternTracker(candles, entry);
    for (let i = 0; i < candles.length; i++) {
      const a = ev.signal(i);
      const b = tr.signal(i);
      expect(a).toEqual(b ? { reason: b.reason, snapshot: b.snapshot } : null);
      ev.update(i);
      tr.update(i);
      if (i % 37 === 0) {
        ev.reset(i);
        tr.reset(i);
      }
    }
    expect(ev.stats()).toEqual(tr.stats());
  });
  it('패턴 블록이 없으면 stats()는 null이고 스냅샷이 없다', () => {
    const ev = createRuleEvaluator(closes([1, 2, 3, 4]), one({ kind: 'maPrice', period: 2, side: 'above' }), 0);
    expect(ev.stats()).toBeNull();
    expect(ev.signal(3)).toEqual({ reason: '종가 2일선 위' });
  });
});

describe('rulesLookback(§5.4)', () => {
  it('조건별 L의 최댓값', () => {
    expect(rulesLookback([])).toBe(0);
    expect(rulesLookback(one({ kind: 'rsi', period: 14, level: 30, op: 'crossUp' }))).toBe(251);
    expect(rulesLookback([{ conds: [{ kind: 'maCross', short: 20, long: 60, dir: 'golden' }, { kind: 'volume', days: 20, ratio: 1 }] }])).toBe(60);
    expect(rulesLookback(one({ kind: 'newHigh', days: 60 }))).toBe(61);
    const entry = defaultCond('pattern').entry;
    expect(rulesLookback(one({ kind: 'pattern', entry }))).toBe(0); // 기본 패턴은 이평을 쓰지 않는다
    expect(rulesLookback(one({ kind: 'pattern', entry: { ...entry, filter: { aboveMa: { on: true, period: 120 } } } }))).toBe(120);
  });
});
