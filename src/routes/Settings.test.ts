// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { makeTestApp } from '../sheets/testApp';
import type { App } from '../lib/state/app.svelte';
import type { Settings as SettingsT } from '../lib/state/schema';
import { kstEpoch } from '../lib/time/kst';
import { dismissSnackbar } from '../lib/ui/components/snackbarStore.svelte';
import Settings from './Settings.svelte';

const NOW = kstEpoch('2026-10-12', '10:00:00');
const barEnd = createRawSnippet(() => ({ render: () => '<span></span>' }));

let apps: App[] = [];
function setup(settings: Partial<SettingsT> = {}) {
  const app = makeTestApp({ groups: [{ id: 'g1', name: '내 관심', items: [] }], now: NOW, settings });
  apps.push(app);
  app.navigate({ name: 'settings' });
  render(Settings, { app, barEnd });
  return app;
}

afterEach(() => {
  for (const a of apps) a.destroy();
  apps = [];
  dismissSnackbar();
});

describe('Settings', () => {
  it('shows the sections in order and the profile note at the top', () => {
    setup();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['데이터 공급자', '연결', '연결 진단', '키 보호', '표시', '데이터', '프로필']);
    expect(screen.getByText('프로필은 편의 기능이지 보안 경계가 아니에요')).toBeTruthy();
  });

  it('provider cards switch the provider (mockup ⑤ wording)', async () => {
    const app = setup();
    const group = screen.getByRole('radiogroup', { name: '데이터 공급자' });
    expect(within(group).getByText('Cloudflare Worker 프록시(무료)')).toBeTruthy();
    expect(within(group).getByText('고정 IP 프록시 필요(집 PC·NAS)')).toBeTruthy();
    await fireEvent.click(within(group).getByRole('radio', { name: '토스증권' }));
    expect(app.settings.provider).toBe('toss');
    expect(within(group).getByRole('radio', { name: '토스증권' }).getAttribute('aria-checked')).toBe('true');
    // 공급자가 바뀌면 키 칸도 그 공급자의 것으로 바뀐다.
    expect(screen.getByLabelText('Client ID')).toBeTruthy();
  });

  it('recommends locking once Toss keys are saved with the lock off', async () => {
    const app = setup({ provider: 'toss' });
    expect(screen.queryByText('토스 키는 주문 권한이 있어요. 암호로 잠그는 걸 권해요')).toBeNull();
    await app.setSecrets({ toss: { clientId: 'cid-1234', clientSecret: 'csec-5678' } });
    expect(await screen.findByText('토스 키는 주문 권한이 있어요. 암호로 잠그는 걸 권해요')).toBeTruthy();
  });

  it('display settings change theme and color convention', async () => {
    const app = setup();
    await fireEvent.click(screen.getByRole('radio', { name: '다크' }));
    expect(app.settings.theme).toBe('dark');
    await fireEvent.click(screen.getByRole('radio', { name: /글로벌/ }));
    expect(app.settings.colorConvention).toBe('global');
  });
});
