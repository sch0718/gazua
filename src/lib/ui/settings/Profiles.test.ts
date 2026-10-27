// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeTestApp } from '../../../sheets/testApp';
import type { App } from '../../state/app.svelte';
import { kstEpoch } from '../../time/kst';
import { dismissSnackbar } from '@sch0718/ui-svelte';
import Profiles from './Profiles.svelte';

const NOW = kstEpoch('2026-10-12', '10:00:00');
let apps: App[] = [];
function setup(confirmFn = vi.fn(() => true)) {
  const app = makeTestApp({ groups: [{ id: 'g1', name: '내 관심', items: [] }], now: NOW });
  apps.push(app);
  render(Profiles, { app, confirmFn });
  return app;
}
const names = (app: App) => app.meta.profiles.map((p) => p.name);

afterEach(() => {
  for (const a of apps) a.destroy();
  apps = [];
  dismissSnackbar();
});

describe('Profiles', () => {
  it('cannot delete the last profile', () => {
    setup();
    expect(screen.getByRole('button', { name: '내 프로필 삭제' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('사용 중')).toBeTruthy();
  });

  it('adds, renames, switches and deletes (after confirmation) profiles', async () => {
    const confirmFn = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    const app = setup(confirmFn);
    await fireEvent.click(screen.getByRole('button', { name: '＋ 새 프로필' }));
    await fireEvent.input(screen.getByLabelText('새 프로필 이름'), { target: { value: '회사' } });
    await fireEvent.click(screen.getByRole('button', { name: '추가' }));
    expect(names(app)).toEqual(['내 프로필', '회사']);

    await fireEvent.click(screen.getByRole('button', { name: '회사 이름 바꾸기' }));
    const input = screen.getByLabelText('프로필 이름');
    await fireEvent.input(input, { target: { value: '  출장  ' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(names(app)).toEqual(['내 프로필', '출장']);

    const other = app.meta.profiles[1].id;
    await fireEvent.click(screen.getByRole('button', { name: '출장 프로필로 전환' }));
    expect(app.meta.activeProfileId).toBe(other);

    await fireEvent.click(screen.getByRole('button', { name: '내 프로필 삭제' }));
    expect(names(app)).toEqual(['내 프로필', '출장']);
    await fireEvent.click(screen.getByRole('button', { name: '내 프로필 삭제' }));
    expect(names(app)).toEqual(['출장']);
  });
});
