import { describe, expect, it } from 'vitest';
import {
  changePct,
  drawdownPct,
  excessPct,
  marketCapTrillion,
  rvolDaily,
  rvolIntraday,
  type Candle,
  type Point,
} from './metrics';
import { METRICS, metricAvailability } from './metricRegistry';

const candle = (t: number, v: number, c = 1): Candle => ({ t, o: c, h: c, l: c, c, v });
const pts = (values: (number | null)[]): Point[] => values.map((v, t) => ({ t, v }));
const vals = (points: Point[]) => points.map((p) => p.v);

const days21WithVol10Then20: Candle[] = [
  ...Array.from({ length: 20 }, (_, i) => candle(i, 10)),
  candle(20, 20),
];

describe('changePct', () => {
  it('computes (P/base - 1) * 100', () => {
    expect(vals(changePct(pts([100, 110, 99, 121]), 100))).toEqual([0, 10, -1, 21]);
  });
  it('keeps null as null and preserves t', () => {
    const out = changePct([{ t: 7, v: null }, { t: 9, v: 110 }], 100);
    expect(out).toEqual([{ t: 7, v: null }, { t: 9, v: 10 }]);
  });
  it('returns null for a zero or invalid base', () => {
    expect(vals(changePct(pts([100]), 0))).toEqual([null]);
  });
});

describe('drawdownPct', () => {
  it('measures decline from the running max', () => {
    expect(drawdownPct(pts([100, 110, 99, 121])).map((p) => p.v!.toFixed(2))).toEqual([
      '0.00',
      '0.00',
      '-10.00',
      '0.00',
    ]);
  });
  it('null yields null and does not reset the running max', () => {
    const out = vals(drawdownPct(pts([100, null, 50])));
    expect(out).toEqual([0, null, -50]);
  });
  it('leading nulls stay null', () => {
    expect(vals(drawdownPct(pts([null, 100, 90])))).toEqual([null, 0, -10]);
  });
});

describe('excessPct', () => {
  it('differences same-t values and carries the latest earlier index value', () => {
    expect(vals(excessPct(pts([5, 7]), [{ t: 0, v: 2 }]))).toEqual([3, 5]);
  });
  it('is null when no index point at or before t exists', () => {
    expect(vals(excessPct([{ t: 0, v: 5 }], [{ t: 1, v: 2 }]))).toEqual([null]);
  });
  it('is null when either value is null', () => {
    const stock = pts([null, 4]);
    const index = [{ t: 0, v: 1 }, { t: 1, v: null }];
    expect(vals(excessPct(stock, index))).toEqual([null, null]);
  });
  it('handles an empty index', () => {
    expect(vals(excessPct(pts([1, 2]), []))).toEqual([null, null]);
  });
});

describe('marketCapTrillion', () => {
  it('computes P * shares / 1e12', () => {
    expect(marketCapTrillion([{ t: 0, v: 70000 }], 5_919_637_922)[0].v!.toFixed(1)).toBe('414.4');
  });
  it('keeps null', () => {
    expect(vals(marketCapTrillion(pts([null]), 100))).toEqual([null]);
  });
});

describe('rvolDaily', () => {
  it('divides by the average of the previous 20 candles', () => {
    expect(rvolDaily(days21WithVol10Then20, 20).at(-1)!.v).toBe(2);
  });
  it('is null while fewer than 20 prior candles exist', () => {
    const out = vals(rvolDaily(days21WithVol10Then20, 20));
    expect(out.slice(0, 20).every((v) => v === null)).toBe(true);
    expect(out).toHaveLength(21);
  });
  it('is null when the prior average is zero', () => {
    const zeros = [...Array.from({ length: 20 }, (_, i) => candle(i, 0)), candle(20, 5)];
    expect(rvolDaily(zeros, 20).at(-1)!.v).toBeNull();
  });
  it('keeps input t', () => {
    expect(rvolDaily(days21WithVol10Then20, 20).map((p) => p.t)).toEqual(
      days21WithVol10Then20.map((c) => c.t),
    );
  });
});

describe('rvolIntraday', () => {
  it('uses cumulative volume over the average daily volume', () => {
    expect(vals(rvolIntraday([candle(0, 50), candle(1, 150)], 400))).toEqual([0.125, 0.5]);
  });
  it('is all null when the average is unavailable', () => {
    expect(vals(rvolIntraday([candle(0, 50), candle(1, 150)], null))).toEqual([null, null]);
  });
  it('is all null when the average is zero', () => {
    expect(vals(rvolIntraday([candle(0, 50)], 0))).toEqual([null]);
  });
});

describe('METRICS registry', () => {
  it('lists the seven metrics in order with exact copy', () => {
    expect(METRICS.map((m) => [m.id, m.label, m.description, m.unit, m.v1])).toEqual([
      ['change', '등락률', '기간 시작 직전 종가 대비 몇 % 올랐나', '%', true],
      ['drawdown', '고점 대비 하락률', '기간 중 최고가에서 얼마나 내려왔나', '%', true],
      ['excess', '시장 대비 초과수익', 'KOSPI·KOSDAQ보다 얼마나 더 올랐나', '%', true],
      ['rvol', '상대 거래량', '평소(20일 평균) 대비 거래량 배수', 'x', true],
      ['mcap', '시가총액', '발행주식수 × 가격 (조 원)', '조', true],
      ['volatility', '변동성', '20일 수익률 표준편차(연율)', '%', false],
      ['rsi', 'RSI(14)', '과열·침체 비교 (0–100)', '', false],
    ]);
  });
  it('declares needs', () => {
    const byId = Object.fromEntries(METRICS.map((m) => [m.id, m.needs]));
    expect(byId.excess).toEqual({ indexCandles: true });
    expect(byId.mcap).toEqual({ shares: true });
    expect(byId.volatility.minPeriodDays).toBeGreaterThan(0);
    expect(byId.rsi.minPeriodDays).toBeGreaterThan(0);
  });
});

describe('metricAvailability', () => {
  const base = { period: { unit: 'M', n: 1 } as const, index: 'ok' as const, hasShares: true };
  it('excess reasons by index state', () => {
    expect(
      metricAvailability('excess', { period: { unit: 'D', n: 1 }, index: 'none', hasShares: true }),
    ).toEqual({ ok: false, reason: '이 데이터 소스는 지수 데이터를 주지 않아요' });
    expect(
      metricAvailability('excess', {
        period: { unit: 'D', n: 1 },
        index: 'no-past-minutes',
        hasShares: true,
      }),
    ).toEqual({ ok: false, reason: '휴장일에는 이 데이터 소스가 지수 분봉을 주지 않아요' });
    expect(
      metricAvailability('excess', { period: { unit: 'W', n: 2 }, index: 'failed', hasShares: true }),
    ).toEqual({ ok: false, reason: '지수 데이터를 받지 못했어요' });
    expect(metricAvailability('excess', base)).toEqual({ ok: true });
  });
  it('mcap needs shares', () => {
    expect(metricAvailability('mcap', { ...base, hasShares: false })).toEqual({
      ok: false,
      reason: '발행주식수 정보가 없어요',
    });
    expect(metricAvailability('mcap', base)).toEqual({ ok: true });
  });
  it('v1.1 metrics: short periods vs longer', () => {
    for (const id of ['volatility', 'rsi'] as const) {
      expect(metricAvailability(id, { ...base, period: { unit: 'D', n: 1 } })).toEqual({
        ok: false,
        reason: '1개월 이상에서 볼 수 있어요',
      });
      expect(metricAvailability(id, { ...base, period: { unit: 'W', n: 3 } })).toEqual({
        ok: false,
        reason: '1개월 이상에서 볼 수 있어요',
      });
      expect(metricAvailability(id, base)).toEqual({ ok: false, reason: '곧 추가될 예정이에요' });
    }
  });
  it('change/drawdown/rvol are always ok', () => {
    for (const id of ['change', 'drawdown', 'rvol'] as const) {
      expect(metricAvailability(id, { ...base, index: 'none', hasShares: false })).toEqual({
        ok: true,
      });
    }
  });
});
