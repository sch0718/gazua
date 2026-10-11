// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { ChartSeriesInput } from '../../chart/lineData';
import { kstEpoch } from '../../time/kst';
import { kstHHMM } from './compareText';
import DataTable, { tableTimes } from './DataTable.svelte';

const DAY = '2026-10-12';
const at = (hhmm: string) => kstEpoch(DAY, `${hhmm}:00`);

/** 09:00부터 count분 동안 매 분 봉을 만든다. 값은 분 단위 순번 × step. */
function minutes(count: number, step: number) {
  return Array.from({ length: count }, (_, i) => ({ t: at('09:00') + i * 60_000, v: i * step }));
}

const input = (id: string, label: string, slot: ChartSeriesInput['slot'], points: ChartSeriesInput['points'], hidden = false): ChartSeriesInput => ({
  id,
  slot,
  label,
  points,
  intervals: [],
  hidden,
});

function setup(over: Record<string, unknown> = {}) {
  return render(DataTable, {
    series: [input('A', '삼성전자', 1, minutes(68, 0.01)), input('B', 'SK하이닉스', 2, minutes(68, -0.02))],
    mode: 'intraday',
    unit: '%',
    metricLabel: '등락률',
    periodLabel: '1일',
    conv: 'kr',
    ...over,
  });
}

describe('tableTimes', () => {
  it('intraday keeps every 30 minutes and the last point, sorted and deduplicated', () => {
    const ts = [...minutes(68, 1).map((p) => p.t), at('09:30')];
    expect(tableTimes(ts, 'intraday').map(kstHHMM)).toEqual(['09:00', '09:30', '10:00', '10:07']);
  });

  it('intraday does not repeat the last point when it falls on a 30-minute mark', () => {
    expect(tableTimes(minutes(61, 1).map((p) => p.t), 'intraday').map(kstHHMM)).toEqual(['09:00', '09:30', '10:00']);
  });

  it('daily keeps every bar', () => {
    const ts = [3, 1, 2, 2].map((d) => kstEpoch(`2026-10-0${d}`, '00:00:00'));
    expect(tableTimes(ts, 'daily')).toEqual([1, 2, 3].map((d) => kstEpoch(`2026-10-0${d}`, '00:00:00')));
  });

  it('is empty without points', () => {
    expect(tableTimes([], 'intraday')).toEqual([]);
  });
});

describe('DataTable', () => {
  it('starts collapsed behind a 표 보기 toggle', async () => {
    setup();
    const btn = screen.getByRole('button', { name: '표 보기' });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('table')).toBeNull();
    await fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('table')).toBeTruthy();
    await fireEvent.click(btn);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('is a table with caption, one column per visible stock and one row per time', async () => {
    setup({
      series: [
        input('A', '삼성전자', 1, minutes(68, 0.01)),
        input('B', 'SK하이닉스', 2, minutes(68, -0.02)),
        input('C', '숨김종목', 3, minutes(68, 1), true),
      ],
    });
    await fireEvent.click(screen.getByRole('button', { name: '표 보기' }));
    const table = screen.getByRole('table', { name: '등락률 표 · 1일' });
    expect(table.querySelector('caption')?.textContent).toBe('등락률 표 · 1일');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent?.trim())).toEqual(['시각', '삼성전자', 'SK하이닉스']);
    const rows = within(table.querySelector('tbody')!).getAllByRole('row');
    expect(rows.map((r) => within(r).getByRole('rowheader').textContent)).toEqual(['09:00', '09:30', '10:00', '10:07']);
    // 값은 리더보드와 같은 형식(▲▼ 기호와 함께)
    expect(within(rows[0]).getAllByRole('cell').map((c) => c.textContent?.trim())).toEqual(['0.00%', '0.00%']);
    expect(within(rows[1]).getAllByRole('cell').map((c) => c.textContent?.trim())).toEqual(['▲ +0.30%', '▼ -0.60%']);
    expect(screen.queryByText('숨김종목')).toBeNull();
  });

  it('shows — where a stock has no value yet, and holds the last value intraday', async () => {
    setup({
      series: [
        input('A', '삼성전자', 1, [
          { t: at('09:00'), v: 1 },
          { t: at('09:10'), v: null },
          { t: at('09:30'), v: null },
        ]),
        input('B', 'SK하이닉스', 2, [
          { t: at('09:00'), v: null },
          { t: at('09:30'), v: 2 },
        ]),
      ],
      unit: 'x',
      metricLabel: '상대 거래량',
    });
    await fireEvent.click(screen.getByRole('button', { name: '표 보기' }));
    const rows = within(screen.getByRole('table').querySelector('tbody')!).getAllByRole('row');
    expect(within(rows[0]).getAllByRole('cell').map((c) => c.textContent?.trim())).toEqual(['1.00x', '—']);
    expect(within(rows[1]).getAllByRole('cell').map((c) => c.textContent?.trim())).toEqual(['1.00x', '2.00x']);
  });

  it('daily mode lists every bar by date', async () => {
    const d = (date: string, v: number | null) => ({ t: kstEpoch(date, '00:00:00'), v });
    setup({
      mode: 'daily',
      periodLabel: '2주',
      series: [input('A', '삼성전자', 1, [d('2026-10-05', 0), d('2026-10-06', null), d('2026-10-07', 1.5)])],
    });
    await fireEvent.click(screen.getByRole('button', { name: '표 보기' }));
    const table = screen.getByRole('table', { name: '등락률 표 · 2주' });
    const rows = within(table.querySelector('tbody')!).getAllByRole('row');
    expect(rows.map((r) => within(r).getByRole('rowheader').textContent)).toEqual(['10/5', '10/6', '10/7']);
    expect(rows.map((r) => within(r).getByRole('cell').textContent?.trim())).toEqual(['0.00%', '—', '▲ +1.50%']);
  });

  it('says so when no stock is visible instead of rendering an empty table', async () => {
    setup({ series: [input('A', '삼성전자', 1, minutes(3, 1), true)] });
    await fireEvent.click(screen.getByRole('button', { name: '표 보기' }));
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('차트에 보이는 종목이 없어요')).toBeTruthy();
  });
});
