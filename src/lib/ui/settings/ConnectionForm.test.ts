// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeTestApp } from '../../../sheets/testApp';
import type { App } from '../../state/app.svelte';
import type { Settings } from '../../state/schema';
import { kstEpoch } from '../../time/kst';
import { currentSnackbar, dismissSnackbar } from '../components/snackbarStore.svelte';
import ConnectionForm, { KEY_LOCKED_ELSEWHERE, KEYS_NOT_REMOVED_SAVE } from './ConnectionForm.svelte';
import { createApp } from '../../state/app.svelte';
import { DEFAULT_SETTINGS } from '../../state/schema';
import { isLocked, lockSecrets } from '../../state/secrets';
import { createSafeStorage } from '../../state/storage';
import { memoryBacking, seed } from '../../state/testStorage';
import { memoryCache } from '../../data/testCache';

const NOW = kstEpoch('2026-10-12', '10:00:00');
let apps: App[] = [];
function setup(settings: Partial<Settings> = { provider: 'kis' }, props: Record<string, unknown> = {}) {
  const app = makeTestApp({ groups: [{ id: 'g1', name: '내 관심', items: [] }], now: NOW, settings });
  apps.push(app);
  render(ConnectionForm, { app, ...props });
  return app;
}
const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

afterEach(() => {
  for (const a of apps) a.destroy();
  apps = [];
  dismissSnackbar();
});

describe('ConnectionForm', () => {
  it('key fields are password inputs; saved values are trimmed and shown only as the last 4 characters', async () => {
    const app = setup();
    expect(input('App Key').type).toBe('password');
    expect(input('App Secret').type).toBe('password');
    await fireEvent.input(input('App Key'), { target: { value: ' key\n' } });
    await fireEvent.input(input('App Secret'), { target: { value: ' secret-ABCD9876 \n' } });
    await fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(app.secrets?.kis).toEqual({ appKey: 'key', appSecret: 'secret-ABCD9876' }));
    expect(screen.getByText('••••••9876')).toBeTruthy();
    expect(document.body.textContent).not.toContain('secret-ABCD');
    expect(screen.queryByLabelText('App Secret')).toBeNull();
    // 변경을 누르면 빈 비밀번호 칸이 다시 열린다(저장된 값은 채우지 않는다).
    await fireEvent.click(screen.getByRole('button', { name: 'App Secret 변경' }));
    expect(input('App Secret').type).toBe('password');
    expect(input('App Secret').value).toBe('');
  });

  it('trims whitespace from pasted text', async () => {
    setup();
    const field = input('App Key');
    await fireEvent.paste(field, { clipboardData: { getData: () => '  pasted-key-1234\n' } });
    expect(field.value).toBe('pasted-key-1234');
  });

  it('saves a normalised proxy URL and proxy token, and rejects a non-https URL', async () => {
    const app = setup();
    await fireEvent.input(input('프록시 URL'), { target: { value: 'http://p.example.net' } });
    await fireEvent.click(screen.getByRole('button', { name: '저장' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('프록시 URL은 https://로 시작해야 해요');
    expect(input('프록시 URL').getAttribute('aria-invalid')).toBe('true');
    expect(input('프록시 URL').getAttribute('aria-describedby')).toBe(alert.id);
    expect(input('App Key').getAttribute('aria-invalid')).toBeNull();
    expect(app.settings.proxyUrl).toBe('');

    await fireEvent.input(input('프록시 URL'), { target: { value: ' https://p.example.net/ ' } });
    await fireEvent.input(input('프록시 토큰 (선택)'), { target: { value: ' proxy-token-5555 ' } });
    await fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(app.secrets?.proxyToken).toBe('proxy-token-5555'));
    expect(app.settings.proxyUrl).toBe('https://p.example.net');
  });

  describe('cleared proxy address banner', () => {
    afterEach(() => vi.unstubAllEnvs());
    const startCleared = (proxyUrl: string) => {
      vi.stubEnv('DEV', false);
      const backing = memoryBacking();
      seed(backing, 'meta', { schemaVersion: 1, activeProfileId: 'p1', profiles: [{ id: 'p1', name: '내 프로필', createdAt: 1 }] });
      seed(backing, 'p:p1:settings', { ...DEFAULT_SETTINGS, onboarded: true, provider: 'kis', proxyUrl });
      seed(backing, 'p:p1:watchlists', { groups: [{ id: 'g1', name: '내 관심', items: [] }] });
      const app = createApp({ storage: createSafeStorage(backing), now: () => NOW, cache: memoryCache() });
      apps.push(app);
      render(ConnectionForm, { app });
      return app;
    };
    const hasBanner = (app: App) => app.banners.some((b) => b.id.startsWith('proxy-cleared'));

    it('saving with the address field left blank clears the banner', async () => {
      const app = startCleared('http://localhost:8787');
      expect(app.settings.proxyUrl).toBe('');
      expect(hasBanner(app)).toBe(true);
      await fireEvent.click(screen.getByRole('button', { name: '저장' }));
      await waitFor(() => expect(hasBanner(app)).toBe(false));
      expect(app.settings.proxyUrl).toBe('');
    });

    it('saving an unchanged address does not rebuild the provider', async () => {
      const app = startCleared('https://p.example.net');
      const before = app.provider;
      await fireEvent.click(screen.getByRole('button', { name: '저장' }));
      await waitFor(() => expect(currentSnackbar()?.message).toBe('저장했어요'));
      expect(app.settings.proxyUrl).toBe('https://p.example.net');
      expect(app.provider).toBe(before);
    });
  });

  it('refuses to save keys in plaintext when another tab has locked them, and says to reload', async () => {
    const backing = memoryBacking();
    seed(backing, 'meta', { schemaVersion: 1, activeProfileId: 'p1', profiles: [{ id: 'p1', name: '내 프로필', createdAt: 1 }] });
    seed(backing, 'p:p1:settings', { ...DEFAULT_SETTINGS, onboarded: true, provider: 'kis' });
    seed(backing, 'p:p1:watchlists', { groups: [{ id: 'g1', name: '내 관심', items: [] }] });
    const app = createApp({ storage: createSafeStorage(backing), now: () => NOW, cache: memoryCache() });
    apps.push(app);
    render(ConnectionForm, { app });
    // 다른 탭이 키를 잠갔다(이 탭은 storage 이벤트를 아직 받지 못했다).
    seed(backing, 'p:p1:secrets', await lockSecrets({ kis: { appKey: 'other', appSecret: 'other-secret' } }, 'pass1234'));
    await fireEvent.input(input('App Key'), { target: { value: 'key-1111' } });
    await fireEvent.input(input('App Secret'), { target: { value: 'secret-2222' } });
    await fireEvent.click(screen.getByRole('button', { name: '저장' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(KEY_LOCKED_ELSEWHERE);
    expect(isLocked(JSON.parse(backing.getItem('gazua:v1:p:p1:secrets')!))).toBe(true);
    expect(backing.dump()).not.toContain('secret-2222');
  });

  it('after this tab failed to remove its locked keys, saving keys explains that instead of blaming another tab', async () => {
    const backing = memoryBacking();
    seed(backing, 'meta', { schemaVersion: 1, activeProfileId: 'p1', profiles: [{ id: 'p1', name: '내 프로필', createdAt: 1 }] });
    seed(backing, 'p:p1:settings', { ...DEFAULT_SETTINGS, onboarded: true, provider: 'kis' });
    seed(backing, 'p:p1:watchlists', { groups: [{ id: 'g1', name: '내 관심', items: [] }] });
    seed(backing, 'p:p1:secrets', await lockSecrets({ kis: { appKey: 'old', appSecret: 'old-secret' } }, 'pass1234'));
    const app = createApp({ storage: createSafeStorage(backing), now: () => NOW, cache: memoryCache() });
    apps.push(app);
    await app.unlock('pass1234');
    backing.removeItem = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    expect(() => app.clearSecrets()).toThrow();
    render(ConnectionForm, { app });
    await fireEvent.input(input('App Key'), { target: { value: 'key-1111' } });
    await fireEvent.input(input('App Secret'), { target: { value: 'secret-2222' } });
    await fireEvent.click(screen.getByRole('button', { name: '저장' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(KEYS_NOT_REMOVED_SAVE);
    expect(alert.textContent).not.toBe(KEY_LOCKED_ELSEWHERE);
    expect(isLocked(JSON.parse(backing.getItem('gazua:v1:p:p1:secrets')!))).toBe(true);
  });

  it('asks for both values of a provider with nothing saved', async () => {
    const app = setup({ provider: 'toss' });
    await fireEvent.input(input('Client ID'), { target: { value: 'cid' } });
    await fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect((await screen.findByRole('alert')).textContent).toBe('두 값을 모두 입력해 주세요');
    expect(app.secrets).toBeNull();
  });

  it('with keyLock on, needs the current passphrase to save new keys', async () => {
    const app = setup();
    await app.setSecrets({ kis: { appKey: 'oldKey-0000', appSecret: 'oldSecret-0000' } }, 'pass1234');
    await waitFor(() => expect(screen.getByRole('button', { name: 'App Key 변경' })).toBeTruthy());
    expect(screen.queryByLabelText('잠금 암호')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'App Key 변경' }));
    await fireEvent.input(input('App Key'), { target: { value: 'newKey-1111' } });
    await fireEvent.input(input('잠금 암호'), { target: { value: 'nope' } });
    await fireEvent.click(screen.getByRole('button', { name: '저장' }));
    const wrong = await screen.findByRole('alert');
    expect(wrong.textContent).toBe('암호가 맞지 않아요');
    expect(input('잠금 암호').getAttribute('aria-invalid')).toBe('true');
    expect(input('잠금 암호').getAttribute('aria-describedby')).toBe(wrong.id);
    expect(app.secrets?.kis?.appKey).toBe('oldKey-0000');

    await fireEvent.input(input('잠금 암호'), { target: { value: 'pass1234' } });
    await fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(app.secrets?.kis).toEqual({ appKey: 'newKey-1111', appSecret: 'oldSecret-0000' }));
    expect(app.settings.keyLock).toBe(true);
  });

  it('section="keys" shows only the key fields and requires keys before continuing', async () => {
    let saved = 0;
    setup({ provider: 'kis' }, { section: 'keys', submitLabel: '다음', onsaved: () => saved++ });
    expect(screen.queryByLabelText('프록시 URL')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: '다음' }));
    expect((await screen.findByRole('alert')).textContent).toBe('키를 입력해 주세요');
    expect(saved).toBe(0);
    await fireEvent.input(input('App Key'), { target: { value: 'k-1234' } });
    await fireEvent.input(input('App Secret'), { target: { value: 's-5678' } });
    await fireEvent.click(screen.getByRole('button', { name: '다음' }));
    await waitFor(() => expect(saved).toBe(1));
  });
});
