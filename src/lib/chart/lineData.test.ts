import { describe, expect, it } from 'vitest';
import type { Point } from '../data/metrics';
import type { TradeInterval } from '../market/tradable';
import { kstEpoch } from '../time/kst';
import {
  buildLineData,
  fillMissingDays,
  fromChartTime,
  haltDays,
  minuteGrid,
  toChartTime,
  withLineBreaks,
  type LineDatum,
} from './lineData';

const DAY = '2026-10-08';
const at = (hms: string) => kstEpoch(DAY, hms);
const ct = (hms: string) => toChartTime(at(hms));
const valueAt = (data: LineDatum[], hms: string) => {
  const d = data.find((x) => x.time === ct(hms));
  if (!d) throw new Error(`no datum at ${hms}`);
  return 'value' in d ? d.value : undefined;
};
const cont = (start: string, end: string, venue: TradeInterval['venue'] = 'KRX'): TradeInterval => ({
  start: at(start),
  end: at(end),
  venue,
  kind: 'continuous',
});
const auction = (start: string, end: string): TradeInterval => ({
  start: at(start),
  end: at(end),
  venue: 'KRX',
  kind: 'auction',
});

describe('toChartTime', () => {
  it('shifts epoch ms to UTC seconds that read as KST wall-clock', () => {
    expect(toChartTime(kstEpoch('2026-10-08', '09:00:00'))).toBe(Date.UTC(2026, 9, 8, 9, 0) / 1000);
  });

  it('round-trips through fromChartTime', () => {
    const t = kstEpoch('2026-10-08', '15:30:00');
    expect(fromChartTime(toChartTime(t))).toBe(t);
  });
});

describe('minuteGrid', () => {
  it('lists every minute from 08:00 to 19:59 KST', () => {
    const grid = minuteGrid(DAY);
    expect(grid).toHaveLength(720);
    expect(grid[0]).toBe(at('08:00:00'));
    expect(grid[1] - grid[0]).toBe(60_000);
    expect(grid.at(-1)).toBe(at('19:59:00'));
  });
});

describe('buildLineData (intraday, with grid)', () => {
  const grid = minuteGrid(DAY);

  it('holds the previous value (0 before any) as dotted while untradable, then solid from the first tradable minute', () => {
    const points: Point[] = [
      { t: at('08:50:00'), v: 1 },
      { t: at('08:51:00'), v: 1.5 },
      { t: at('08:52:00'), v: 2 },
    ];
    const { solid, dotted } = buildLineData(points, [cont('08:50:00', '15:20:00')], grid);

    expect(solid).toHaveLength(720);
    expect(dotted).toHaveLength(720);
    for (const hms of ['08:00:00', '08:20:00', '08:49:00']) {
      expect(valueAt(solid, hms)).toBeUndefined();
      expect(valueAt(dotted, hms)).toBe(0);
    }
    expect(valueAt(solid, '08:50:00')).toBe(1);
    expect(valueAt(solid, '08:51:00')).toBe(1.5);
    expect(valueAt(solid, '08:52:00')).toBe(2);
    // the dotted segment ends where the solid line resumes, at the held value
    expect(valueAt(dotted, '08:50:00')).toBe(0);
    expect(valueAt(dotted, '08:51:00')).toBeUndefined();
  });

  it('leaves both lines as whitespace after the last real bar (future)', () => {
    const points: Point[] = [
      { t: at('09:00:00'), v: 1 },
      { t: at('09:01:00'), v: 2 },
    ];
    const { solid, dotted } = buildLineData(points, [cont('09:00:00', '15:20:00')], grid);
    for (const hms of ['09:02:00', '12:00:00', '19:59:00']) {
      expect(valueAt(solid, hms)).toBeUndefined();
      expect(valueAt(dotted, hms)).toBeUndefined();
    }
  });

  it('uses startValue before any value', () => {
    const points: Point[] = [{ t: at('09:00:00'), v: 3 }];
    const { dotted } = buildLineData(points, [cont('09:00:00', '15:20:00')], grid, { startValue: 1 });
    expect(valueAt(dotted, '08:00:00')).toBe(1);
    expect(valueAt(dotted, '09:00:00')).toBe(1);
  });

  it('leaves the line empty before the first value when startValue is null', () => {
    const points: Point[] = [{ t: at('09:00:00'), v: 3 }];
    const { solid, dotted } = buildLineData(points, [cont('09:00:00', '15:20:00')], grid, { startValue: null });
    expect(valueAt(dotted, '08:00:00')).toBeUndefined();
    expect(valueAt(dotted, '09:00:00')).toBeUndefined();
    expect(valueAt(solid, '09:00:00')).toBe(3);
  });

  it('bridges an untradable gap with the last value and touches both solid ends', () => {
    const points: Point[] = [
      { t: at('15:18:00'), v: 1 },
      { t: at('15:19:00'), v: 2 },
      { t: at('16:00:00'), v: 5 },
      { t: at('16:01:00'), v: 6 },
    ];
    const { solid, dotted } = buildLineData(
      points,
      [cont('09:00:00', '15:20:00'), cont('16:00:00', '20:00:00')],
      grid,
    );
    expect(valueAt(solid, '15:19:00')).toBe(2);
    expect(valueAt(dotted, '15:19:00')).toBe(2); // start anchor
    // before the first bar the line waits at 0, and that dotted run ends at the first solid point
    expect(valueAt(dotted, '15:17:00')).toBe(0);
    expect(valueAt(dotted, '15:18:00')).toBe(0);
    for (const hms of ['15:20:00', '15:30:00', '15:59:00']) {
      expect(valueAt(solid, hms)).toBeUndefined();
      expect(valueAt(dotted, hms)).toBe(2);
    }
    expect(valueAt(solid, '16:00:00')).toBe(5);
    expect(valueAt(dotted, '16:00:00')).toBe(2); // end anchor at the held value
    expect(valueAt(dotted, '16:01:00')).toBeUndefined();
  });

  it('treats auction minutes as dotted, picking up an auction bar as the new held value', () => {
    const points: Point[] = [
      { t: at('15:19:00'), v: 1 },
      { t: at('15:30:00'), v: 4 }, // closing-auction print
      { t: at('16:00:00'), v: 4.5 },
    ];
    const { solid, dotted } = buildLineData(
      points,
      [cont('09:00:00', '15:20:00'), auction('15:20:00', '15:30:00'), cont('16:00:00', '20:00:00')],
      grid,
    );
    expect(valueAt(solid, '15:25:00')).toBeUndefined();
    expect(valueAt(dotted, '15:25:00')).toBe(1);
    expect(valueAt(dotted, '15:30:00')).toBe(4);
    expect(valueAt(dotted, '15:45:00')).toBe(4);
    expect(valueAt(dotted, '16:00:00')).toBe(4);
    expect(valueAt(solid, '16:00:00')).toBe(4.5);
  });

  it('carries the last value on the solid line through tradable minutes without a bar', () => {
    const points: Point[] = [
      { t: at('09:00:00'), v: 1 },
      { t: at('09:05:00'), v: 2 },
    ];
    const { solid, dotted } = buildLineData(points, [cont('09:00:00', '15:20:00')], grid);
    expect(valueAt(solid, '09:03:00')).toBe(1);
    expect(valueAt(dotted, '09:03:00')).toBeUndefined();
    expect(valueAt(solid, '09:05:00')).toBe(2);
  });

  it('extends the held value up to `until` when given (another series is still trading)', () => {
    const points: Point[] = [{ t: at('15:19:00'), v: 1 }];
    const { solid, dotted } = buildLineData(points, [cont('09:00:00', '15:20:00')], grid, {
      until: at('17:42:00'),
    });
    expect(valueAt(dotted, '17:42:00')).toBe(1);
    expect(valueAt(dotted, '17:43:00')).toBeUndefined();
    expect(valueAt(solid, '17:00:00')).toBeUndefined();
  });

  it('returns only whitespace when there is no value at all', () => {
    const { solid, dotted } = buildLineData([], [cont('09:00:00', '15:20:00')], grid, {
      until: at('17:00:00'),
    });
    expect(solid.every((d) => !('value' in d))).toBe(true);
    expect(dotted.every((d) => !('value' in d))).toBe(true);
  });
});

describe('buildLineData (daily, no grid)', () => {
  const d = (date: string) => kstEpoch(date, '00:00:00');
  const dt = (date: string) => toChartTime(d(date));
  const v = (data: LineDatum[], date: string) => {
    const x = data.find((y) => y.time === dt(date));
    return x && 'value' in x ? x.value : undefined;
  };

  it('draws values solid and bridges a null day dotted at the previous value', () => {
    const points: Point[] = [
      { t: d('2026-10-05'), v: 1 },
      { t: d('2026-10-06'), v: 2 },
      { t: d('2026-10-07'), v: null },
      { t: d('2026-10-08'), v: 3 },
    ];
    const { solid, dotted } = buildLineData(points, []);
    expect(solid.map((x) => x.time)).toEqual(points.map((p) => toChartTime(p.t)));
    expect(v(solid, '2026-10-05')).toBe(1);
    expect(v(solid, '2026-10-07')).toBeUndefined();
    expect(v(solid, '2026-10-08')).toBe(3);
    expect(v(dotted, '2026-10-05')).toBeUndefined();
    expect(v(dotted, '2026-10-06')).toBe(2);
    expect(v(dotted, '2026-10-07')).toBe(2);
    expect(v(dotted, '2026-10-08')).toBe(2);
  });

  it('has no dotted values when every day has a value', () => {
    const points: Point[] = [
      { t: d('2026-10-05'), v: 1 },
      { t: d('2026-10-06'), v: 2 },
    ];
    const { dotted } = buildLineData(points, []);
    expect(dotted.every((x) => !('value' in x))).toBe(true);
  });
});

describe('withLineBreaks', () => {
  it('hides the segment that would cross a whitespace gap, but not the final point', () => {
    const data: LineDatum[] = [
      { time: 1, value: 1 },
      { time: 2, value: 2 },
      { time: 3 },
      { time: 4, value: 3 },
      { time: 5 },
    ];
    const out = withLineBreaks(data, 'transparent');
    expect(out[0]).toEqual({ time: 1, value: 1 });
    expect(out[1]).toEqual({ time: 2, value: 2, color: 'transparent' });
    expect(out[3]).toEqual({ time: 4, value: 3 });
    expect(out[2]).toEqual({ time: 3 });
  });
});

describe('fillMissingDays', () => {
  it('adds a null point for each listed day that has no point, keeping time order', () => {
    const d = (date: string) => kstEpoch(date, '00:00:00');
    const points: Point[] = [
      { t: d('2026-10-05'), v: 1 },
      { t: d('2026-10-07'), v: 2 },
    ];
    expect(fillMissingDays(points, [d('2026-10-05'), d('2026-10-06'), d('2026-10-07')])).toEqual([
      { t: d('2026-10-05'), v: 1 },
      { t: d('2026-10-06'), v: null },
      { t: d('2026-10-07'), v: 2 },
    ]);
  });
});

describe('haltDays', () => {
  it('lists open days on which a series has no value, with the halted labels', () => {
    const d = (date: string) => kstEpoch(date, '00:00:00');
    const days = [d('2026-10-05'), d('2026-10-06'), d('2026-10-07')];
    const result = haltDays(
      [
        { label: '삼성전자', points: [{ t: days[0], v: 1 }, { t: days[1], v: 1 }, { t: days[2], v: 1 }] },
        { label: '한미반도체', points: [{ t: days[0], v: 1 }, { t: days[1], v: null }, { t: days[2], v: 1 }] },
        { label: 'DB하이텍', points: [{ t: days[0], v: 1 }, { t: days[2], v: 1 }] },
      ],
      days,
    );
    expect(result).toEqual([{ t: days[1], labels: ['한미반도체', 'DB하이텍'] }]);
  });

  it('ignores days after the latest value of any series (not yet traded)', () => {
    const d = (date: string) => kstEpoch(date, '00:00:00');
    const days = [d('2026-10-05'), d('2026-10-06')];
    expect(haltDays([{ label: 'A', points: [{ t: days[0], v: 1 }] }], days)).toEqual([]);
  });
});
