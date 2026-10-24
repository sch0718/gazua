// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from '../../state/app.svelte';
import { makeTestApp } from '../../../sheets/testApp';
import HelpButton from './HelpButton.svelte';

let apps: App[] = [];
afterEach(() => {
  for (const a of apps) a.destroy();
  apps = [];
});

describe('HelpButton', () => {
  it('opens the help for its menu after running onbefore (closing the sheet it sits in)', async () => {
    const app = makeTestApp({ groups: [{ id: 'g1', name: '반도체', items: [] }], now: Date.UTC(2026, 9, 16) });
    apps.push(app);
    const onbefore = vi.fn();
    render(HelpButton, { app, page: 'add', onbefore });
    const b = screen.getByRole('button', { name: '종목 추가 도움말' });
    await fireEvent.click(b);
    expect(onbefore).toHaveBeenCalled();
    expect(app.route).toEqual({ name: 'help', helpId: 'add' });
  });
});
