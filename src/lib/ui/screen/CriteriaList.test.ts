// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { makeTestApp } from '../../../sheets/testApp';
import { MAX_CRITERIA, newCriteria } from '../../screen/defaults';
import { CRITERIA_CAP_MESSAGE } from '../../screen/criteriaStore';
import { NOW } from '../../screen/testData';
import type { App } from '../../state/app.svelte';
import { currentSnackbar, dismissSnackbar } from '../components/snackbarStore.svelte';
import CriteriaList from './CriteriaList.svelte';
import type { LastResult } from './screenText';

const RANGE = { from: '2024-10-16', to: '2026-10-15' };
let apps: App[] = [];
function setup(names: string[] = [], lastResults: Record<string, LastResult> = {}) {
  const app = makeTestApp({ groups: [{ id: 'g1', name: '반도체', items: [] }], now: NOW });
  apps.push(app);
  app.setCriteria(names.map((n, i) => ({ ...newCriteria(NOW - i, RANGE, n), id: `c${i}` })));
  app.navigate({ name: 'simulate', tab: 'criteria' });
  render(CriteriaList, { app, dataRange: RANGE, lastResults });
  return app;
}
afterEach(() => {
  for (const a of apps) a.destroy();
  apps = [];
  dismissSnackbar();
});

describe('CriteriaList', () => {
  it('empty state invites a first criteria', () => {
    setup();
    expect(screen.getByRole('button', { name: '＋ 새 기준' })).toBeTruthy();
  });

  it('a row shows the name, the one-line summary and — only when run in this tab — the last result', () => {
    setup(['반등 기준', '다른 기준'], { c0: { hold: 12.34, index: { id: 'KOSPI', pct: 8.06 } } });
    expect(screen.getByText('반등 기준')).toBeTruthy();
    expect(screen.getAllByText('KOSPI·KOSDAQ 주식 · 거래대금 10억↑ · 반등 10일 · 상위 10 · 매월')).toHaveLength(2);
    const last = document.querySelectorAll('[data-last-result]');
    expect(last).toHaveLength(1);
    expect(last[0].textContent!.replace(/\s+/g, ' ').trim()).toBe('① ▲ +12.3% vs KOSPI ▲ +8.1%');
  });

  it('when the first index has no curve the reason replaces its number', () => {
    setup(['가'], { c0: { hold: 2, index: { id: 'KOSPI', pct: null, reason: '받지 못했어요' } } });
    expect(document.querySelector('[data-last-result]')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('① ▲ +2.0% vs KOSPI 받지 못했어요');
  });

  it('the last result carries the arrows and trend colours; a loss reads ▼ and no index leaves ① alone', () => {
    setup(['가', '나'], { c0: { hold: -3.24, index: { id: 'KOSPI', pct: 8.06 } }, c1: { hold: 1, index: null } });
    const [a, b] = document.querySelectorAll('[data-last-result]');
    expect(a.textContent!.replace(/\s+/g, ' ').trim()).toBe('① ▼ −3.2% vs KOSPI ▲ +8.1%');
    expect([...a.querySelectorAll('b')].map((x) => (x.classList.contains('down') ? 'down' : x.classList.contains('up') ? 'up' : ''))).toEqual(['down', 'up']);
    expect(b.textContent!.replace(/\s+/g, ' ').trim()).toBe('① ▲ +1.0%');
  });

  it('＋ 새 기준 adds a numbered criteria with the data range as its period and opens it', async () => {
    const app = setup(['새 기준']);
    await fireEvent.click(screen.getByRole('button', { name: '＋ 새 기준' }));
    expect(app.criteria.map((c) => c.name)).toEqual(['새 기준', '새 기준 2']);
    expect(app.criteria[1].period).toEqual({ from: '2025-10-16', to: '2026-10-15' });
    expect(app.route).toEqual({ name: 'simulate', tab: 'criteria', criteriaId: app.criteria[1].id });
  });

  it('at the cap a snackbar says so and nothing is added', async () => {
    const app = setup(Array.from({ length: MAX_CRITERIA }, (_, i) => `기준 ${i}`));
    await fireEvent.click(screen.getByRole('button', { name: '＋ 새 기준' }));
    expect(app.criteria).toHaveLength(MAX_CRITERIA);
    expect(currentSnackbar()?.message).toBe(CRITERIA_CAP_MESSAGE);
  });

  it('tapping a row opens it', async () => {
    const app = setup(['반등 기준']);
    await fireEvent.click(screen.getByText('반등 기준'));
    expect(app.route).toEqual({ name: 'simulate', tab: 'criteria', criteriaId: 'c0' });
  });

  it('menu: duplicate puts a 사본 right after the original with a new id', async () => {
    const app = setup(['가', '나']);
    await fireEvent.click(screen.getByRole('button', { name: '가 메뉴' }));
    await fireEvent.click(screen.getByRole('button', { name: '복제' }));
    expect(app.criteria.map((c) => c.name)).toEqual(['가', '가 사본', '나']);
    expect(new Set(app.criteria.map((c) => c.id)).size).toBe(3);
  });

  it('menu: duplicate at the cap shows the cap message', async () => {
    const app = setup(Array.from({ length: MAX_CRITERIA }, (_, i) => `기준 ${i}`));
    await fireEvent.click(screen.getByRole('button', { name: '기준 0 메뉴' }));
    await fireEvent.click(screen.getByRole('button', { name: '복제' }));
    expect(app.criteria).toHaveLength(MAX_CRITERIA);
    expect(currentSnackbar()?.message).toBe(CRITERIA_CAP_MESSAGE);
  });

  it('menu: rename saves, and an empty name shows an error under the field', async () => {
    const app = setup(['가']);
    await fireEvent.click(screen.getByRole('button', { name: '가 메뉴' }));
    await fireEvent.click(screen.getByRole('button', { name: '이름 바꾸기' }));
    const input = screen.getByRole('textbox', { name: '기준 이름' });
    await fireEvent.input(input, { target: { value: '   ' } });
    await fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(app.criteria[0].name).toBe('가');
    await fireEvent.input(input, { target: { value: '반등 기준' } });
    await fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(app.criteria[0].name).toBe('반등 기준');
  });

  it('menu: delete shows 되돌리기 and restores in place', async () => {
    const app = setup(['가', '나', '다']);
    await fireEvent.click(screen.getByRole('button', { name: '나 메뉴' }));
    await fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    expect(app.criteria.map((c) => c.name)).toEqual(['가', '다']);
    expect(currentSnackbar()?.message).toBe("'나'을(를) 삭제했어요");
    expect(currentSnackbar()?.action?.label).toBe('되돌리기');
    currentSnackbar()!.action!.run();
    expect(app.criteria.map((c) => c.name)).toEqual(['가', '나', '다']);
  });

  describe('delete returns focus like the strategy list', () => {
    const row = (id: string) => [...document.querySelectorAll<HTMLElement>('[data-criteria-row]')].find((el) => el.dataset.criteriaRow === id) ?? null;
    const del = async (name: string) => {
      const more = screen.getByRole('button', { name: `${name} 메뉴` });
      more.focus();
      await fireEvent.click(more);
      await fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    };

    it('a middle row sends focus to the next row', async () => {
      setup(['가', '나', '다']);
      await del('나');
      await waitFor(() => expect(document.activeElement).toBe(row('c2')));
    });

    it('the last row sends focus to the previous row', async () => {
      setup(['가', '나', '다']);
      await del('다');
      await waitFor(() => expect(document.activeElement).toBe(row('c1')));
    });

    it('the only row sends focus to ＋ 새 기준', async () => {
      setup(['가']);
      await del('가');
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '＋ 새 기준' })));
    });
  });
});
