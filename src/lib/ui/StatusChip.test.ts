// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { sessionsForDay } from '../market/sessions';
import { kstEpoch } from '../time/kst';
import StatusChip from './StatusChip.svelte';

const DAY = '2026-10-12';
const at = (hhmm: string) => kstEpoch(DAY, `${hhmm}:00`);
const sessions = sessionsForDay({ date: DAY, isOpen: true });

function chip(now: number, props: Record<string, unknown> = {}) {
  render(StatusChip, { sessions, isOpenToday: true, now, ...props });
  return screen.getByRole('button', { name: /오늘 세션/ });
}

describe('StatusChip', () => {
  it('in session: ● + session label + KST time', () => {
    const btn = chip(at('17:42'));
    expect(btn.textContent).toContain('●');
    expect(btn.textContent).toContain('KRX 애프터');
    expect(btn.textContent).toContain('17:42');
  });

  it('after the last session: ◌ 장 마감', () => {
    const btn = chip(at('21:00'));
    expect(btn.textContent).toContain('◌ 장 마감');
    expect(btn.textContent).not.toContain('●');
  });

  it('before the first session: ◌ 장 시작 전', () => {
    expect(chip(at('07:30')).textContent).toContain('◌ 장 시작 전');
  });

  it('closed day: 휴장', () => {
    const btn = chip(at('10:00'), { sessions: [], isOpenToday: false });
    expect(btn.textContent).toContain('휴장');
  });

  it('opens today’s timetable with the current row marked', async () => {
    await fireEvent.click(chip(at('17:42')));
    const dialog = screen.getByRole('dialog', { name: '오늘 세션 (KST)' });
    const rows = within(dialog).getAllByRole('listitem').map((li) => li.textContent?.replace(/\s+/g, ' ').trim());
    expect(rows[0]).toBe('NXT 프리 08:00–08:50');
    expect(rows).toContain('KRX 시가 단일가 08:30–09:00');
    expect(rows).toContain('NXT 정규 09:00:30–15:20');
    expect(rows).toContain('NXT 애프터 15:40–20:00');
    const current = rows.filter((r) => r?.includes('· 지금'));
    expect(current).toEqual(['KRX 애프터 (ETF·ETN 제외) · 지금 16:00–20:00']);
  });

  it('computes the timetable from the sessions prop (shifted calendar)', async () => {
    const shifted = sessionsForDay({
      date: DAY,
      isOpen: true,
      integrated: { regularStart: kstEpoch(DAY, '10:00:00') },
    });
    await fireEvent.click(chip(at('09:20'), { sessions: shifted }));
    const dialog = screen.getByRole('dialog');
    const first = within(dialog).getAllByRole('listitem')[0];
    expect(first.textContent?.replace(/\s+/g, ' ').trim()).toBe('NXT 프리 · 지금 09:00–09:50');
  });

  it('closed day timetable says so', async () => {
    await fireEvent.click(chip(at('10:00'), { sessions: [], isOpenToday: false }));
    expect(within(screen.getByRole('dialog')).getByText('오늘은 휴장이에요')).toBeTruthy();
  });
});
