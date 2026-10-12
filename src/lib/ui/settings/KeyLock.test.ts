// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeTestApp } from '../../../sheets/testApp';
import type { App } from '../../state/app.svelte';
import type { Settings } from '../../state/schema';
import type { Secrets } from '../../state/secrets';
import { kstEpoch } from '../../time/kst';
import { currentSnackbar, dismissSnackbar } from '../components/snackbarStore.svelte';
import KeyLock, {
  KEY_LOCK_NOT_CLEARED,
  KEY_LOCK_NOT_SAVED,
  KEY_LOCK_NO_STORAGE,
  KEY_UNLOCK_NOT_SAVED,
  KEY_UNLOCK_NO_STORAGE,
  KEYS_NOT_REMOVED,
  keyLockFailureText,
} from './KeyLock.svelte';
import { KeyLockNotSavedError, createApp } from '../../state/app.svelte';
import { DEFAULT_SETTINGS } from '../../state/schema';
import { createSafeStorage } from '../../state/storage';
import { memoryBacking, seed } from '../../state/testStorage';
import { lockSecrets } from '../../state/secrets';
import { memoryCache } from '../../data/testCache';

const NOW = kstEpoch('2026-10-12', '10:00:00');
const TOSS: Secrets = { toss: { clientId: 'toss-id-1234', clientSecret: 'toss-secret-5678' } };
const KIS: Secrets = { kis: { appKey: 'kis-key-1234', appSecret: 'kis-secret-5678' } };

let apps: App[] = [];
async function setup(settings: Partial<Settings>, secrets: Secrets | null, confirmFn = vi.fn(() => true)) {
  const app = makeTestApp({ groups: [{ id: 'g1', name: '내 관심', items: [] }], now: NOW, settings });
  apps.push(app);
  if (secrets) await app.setSecrets(secrets);
  render(KeyLock, { app, confirmFn });
  return app;
}
const toggle = () => screen.getByRole('switch', { name: '키를 암호로 잠그기' });
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

afterEach(() => {
  for (const a of apps) a.destroy();
  apps = [];
  dismissSnackbar();
});

describe('KeyLock', () => {
  it('turning the lock on asks for a passphrase twice, then encrypts the keys', async () => {
    const app = await setup({ provider: 'kis' }, KIS);
    expect(toggle().getAttribute('aria-checked')).toBe('false');
    await fireEvent.click(toggle());
    expect(screen.getByRole('dialog', { name: '키를 암호로 잠그기' })).toBeTruthy();
    expect(field('암호').type).toBe('password');
    await fireEvent.input(field('암호'), { target: { value: 'pass1234' } });
    await fireEvent.input(field('암호 확인'), { target: { value: 'pass9999' } });
    await fireEvent.click(screen.getByRole('button', { name: '잠그기' }));
    const mismatch = await screen.findByRole('alert');
    expect(mismatch.textContent).toBe('암호가 서로 달라요');
    expect(field('암호 확인').getAttribute('aria-invalid')).toBe('true');
    expect(field('암호 확인').getAttribute('aria-describedby')).toBe(mismatch.id);
    expect(field('암호').getAttribute('aria-invalid')).toBeNull();
    expect(app.settings.keyLock).toBe(false);

    await fireEvent.input(field('암호 확인'), { target: { value: 'pass1234' } });
    await fireEvent.click(screen.getByRole('button', { name: '잠그기' }));
    await waitFor(() => expect(app.settings.keyLock).toBe(true));
    expect(app.secrets).toEqual(KIS);
    expect(await app.verifyPassphrase('pass1234')).toBe(true);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(toggle().getAttribute('aria-checked')).toBe('true');
  });

  it('turning the lock off needs the current passphrase; a wrong one shows 암호가 맞지 않아요', async () => {
    const app = await setup({ provider: 'kis' }, null);
    await app.setSecrets(KIS, 'pass1234');
    await waitFor(() => expect(toggle().getAttribute('aria-checked')).toBe('true'));
    await fireEvent.click(toggle());
    expect(screen.getByRole('dialog', { name: '잠금 끄기' })).toBeTruthy();
    await fireEvent.input(field('현재 암호'), { target: { value: 'wrong' } });
    await fireEvent.click(screen.getByRole('button', { name: '끄기' }));
    const wrong = await screen.findByRole('alert');
    expect(wrong.textContent).toBe('암호가 맞지 않아요');
    expect(field('현재 암호').getAttribute('aria-invalid')).toBe('true');
    expect(field('현재 암호').getAttribute('aria-describedby')).toBe(wrong.id);
    expect(app.settings.keyLock).toBe(true);

    await fireEvent.input(field('현재 암호'), { target: { value: 'pass1234' } });
    await fireEvent.click(screen.getByRole('button', { name: '끄기' }));
    await waitFor(() => expect(app.settings.keyLock).toBe(false));
    expect(app.secrets).toEqual(KIS);
  });

  it('a lock that could not be saved shows the failure copy, not 키를 암호로 잠갔어요', async () => {
    const backing = memoryBacking();
    seed(backing, 'meta', { schemaVersion: 1, activeProfileId: 'p1', profiles: [{ id: 'p1', name: '내 프로필', createdAt: 1 }] });
    seed(backing, 'p:p1:settings', { ...DEFAULT_SETTINGS, onboarded: true, provider: 'kis' });
    seed(backing, 'p:p1:watchlists', { groups: [{ id: 'g1', name: '내 관심', items: [] }] });
    seed(backing, 'p:p1:secrets', KIS);
    const app = createApp({ storage: createSafeStorage(backing), now: () => NOW, cache: memoryCache() });
    apps.push(app);
    render(KeyLock, { app });
    backing.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    await fireEvent.click(toggle());
    await fireEvent.input(field('암호'), { target: { value: 'pass1234' } });
    await fireEvent.input(field('암호 확인'), { target: { value: 'pass1234' } });
    await fireEvent.click(screen.getByRole('button', { name: '잠그기' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(KEY_LOCK_NOT_SAVED);
    expect(backing.dump()).not.toContain(KIS.kis!.appKey);
    expect(currentSnackbar()).toBeNull();
  });

  it('the failure copy follows the case: no storage at all, or old keys that could not be removed', async () => {
    expect(keyLockFailureText(new KeyLockNotSavedError('lock', 'cleared'))).toBe(KEY_LOCK_NOT_SAVED);
    expect(keyLockFailureText(new KeyLockNotSavedError('lock', 'not-cleared'))).toBe(KEY_LOCK_NOT_CLEARED);
    expect(keyLockFailureText(new KeyLockNotSavedError('lock', 'no-storage'))).toBe(KEY_LOCK_NO_STORAGE);
    expect(keyLockFailureText(new KeyLockNotSavedError('unlock', 'unsaved'))).toBe(KEY_UNLOCK_NOT_SAVED);
    expect(keyLockFailureText(new KeyLockNotSavedError('unlock', 'no-storage'))).toBe(KEY_UNLOCK_NO_STORAGE);
    expect(KEY_LOCK_NO_STORAGE).not.toContain('지웠어요');
    expect(KEY_LOCK_NOT_CLEARED).not.toContain('지웠어요');
    const backing = memoryBacking();
    seed(backing, 'meta', { schemaVersion: 1, activeProfileId: 'p1', profiles: [{ id: 'p1', name: '내 프로필', createdAt: 1 }] });
    seed(backing, 'p:p1:settings', { ...DEFAULT_SETTINGS, onboarded: true, provider: 'kis' });
    seed(backing, 'p:p1:watchlists', { groups: [{ id: 'g1', name: '내 관심', items: [] }] });
    seed(backing, 'p:p1:secrets', KIS);
    const app = createApp({ storage: createSafeStorage(backing), now: () => NOW, cache: memoryCache() });
    apps.push(app);
    render(KeyLock, { app });
    backing.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    backing.removeItem = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    await fireEvent.click(toggle());
    await fireEvent.input(field('암호'), { target: { value: 'pass1234' } });
    await fireEvent.input(field('암호 확인'), { target: { value: 'pass1234' } });
    await fireEvent.click(screen.getByRole('button', { name: '잠그기' }));
    expect((await screen.findByRole('alert')).textContent).toBe(KEY_LOCK_NOT_CLEARED);
  });

  it('turning the lock off when the plaintext cannot be saved says so instead of 잠금을 껐어요', async () => {
    const backing = memoryBacking();
    seed(backing, 'meta', { schemaVersion: 1, activeProfileId: 'p1', profiles: [{ id: 'p1', name: '내 프로필', createdAt: 1 }] });
    seed(backing, 'p:p1:settings', { ...DEFAULT_SETTINGS, onboarded: true, provider: 'kis' });
    seed(backing, 'p:p1:watchlists', { groups: [{ id: 'g1', name: '내 관심', items: [] }] });
    const app = createApp({ storage: createSafeStorage(backing), now: () => NOW, cache: memoryCache() });
    apps.push(app);
    await app.setSecrets(KIS, 'pass1234');
    render(KeyLock, { app });
    backing.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    await fireEvent.click(toggle());
    await fireEvent.input(field('현재 암호'), { target: { value: 'pass1234' } });
    await fireEvent.click(screen.getByRole('button', { name: '끄기' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(KEY_UNLOCK_NOT_SAVED);
    expect(currentSnackbar()).toBeNull();
  });

  it('a resubmitted 끄기 after a failed save fails again; it says 잠금을 껐어요 only once the plaintext is saved', async () => {
    const backing = memoryBacking();
    seed(backing, 'meta', { schemaVersion: 1, activeProfileId: 'p1', profiles: [{ id: 'p1', name: '내 프로필', createdAt: 1 }] });
    seed(backing, 'p:p1:settings', { ...DEFAULT_SETTINGS, onboarded: true, provider: 'kis' });
    seed(backing, 'p:p1:watchlists', { groups: [{ id: 'g1', name: '내 관심', items: [] }] });
    const app = createApp({ storage: createSafeStorage(backing), now: () => NOW, cache: memoryCache() });
    apps.push(app);
    await app.setSecrets(KIS, 'pass1234');
    render(KeyLock, { app });
    const setItem = backing.setItem;
    backing.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    await fireEvent.click(toggle());
    await fireEvent.input(field('현재 암호'), { target: { value: 'pass1234' } });
    for (let i = 0; i < 2; i++) {
      await fireEvent.click(screen.getByRole('button', { name: '끄기' }));
      await vi.waitFor(() => expect(screen.getByRole('alert').textContent).toBe(KEY_UNLOCK_NOT_SAVED));
      expect(currentSnackbar()).toBeNull();
      expect(app.settings.keyLock).toBe(true);
    }
    backing.setItem = setItem;
    await fireEvent.click(screen.getByRole('button', { name: '끄기' }));
    await vi.waitFor(() => expect(currentSnackbar()?.message).toBe('잠금을 껐어요'));
    expect(app.settings.keyLock).toBe(false);
    expect(JSON.parse(backing.getItem('gazua:v1:p:p1:secrets')!)).toEqual(KIS);
  });

  it('stored keyLock:false with sealed Toss keys shows the lock as on and no 잠금 권장 banner', async () => {
    const backing = memoryBacking();
    seed(backing, 'meta', { schemaVersion: 1, activeProfileId: 'p1', profiles: [{ id: 'p1', name: '내 프로필', createdAt: 1 }] });
    seed(backing, 'p:p1:settings', { ...DEFAULT_SETTINGS, onboarded: true, provider: 'toss', keyLock: false });
    seed(backing, 'p:p1:watchlists', { groups: [{ id: 'g1', name: '내 관심', items: [] }] });
    seed(backing, 'p:p1:secrets', await lockSecrets(TOSS, 'pass1234'));
    const app = createApp({ storage: createSafeStorage(backing), now: () => NOW, cache: memoryCache() });
    apps.push(app);
    await app.unlock('pass1234');
    render(KeyLock, { app });
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByText(/토스 키는 주문 권한이 있어요/)).toBeNull();
  });

  it('이 기기에서 키 삭제 says so when the browser storage refuses the removal', async () => {
    const backing = memoryBacking();
    seed(backing, 'meta', { schemaVersion: 1, activeProfileId: 'p1', profiles: [{ id: 'p1', name: '내 프로필', createdAt: 1 }] });
    seed(backing, 'p:p1:settings', { ...DEFAULT_SETTINGS, onboarded: true, provider: 'kis' });
    seed(backing, 'p:p1:watchlists', { groups: [{ id: 'g1', name: '내 관심', items: [] }] });
    seed(backing, 'p:p1:secrets', KIS);
    const app = createApp({ storage: createSafeStorage(backing), now: () => NOW, cache: memoryCache() });
    apps.push(app);
    render(KeyLock, { app, confirmFn: () => true });
    backing.removeItem = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    await fireEvent.click(screen.getByRole('button', { name: '이 기기에서 키 삭제' }));
    expect(currentSnackbar()?.message).toBe(KEYS_NOT_REMOVED);
  });

  it('recommends locking saved Toss keys; 잠그기 opens the lock dialog and the banner can be dismissed', async () => {
    await setup({ provider: 'toss' }, TOSS);
    const text = '토스 키는 주문 권한이 있어요. 암호로 잠그는 걸 권해요';
    expect(screen.getByText(text)).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: '잠그기' }));
    expect(screen.getByRole('dialog', { name: '키를 암호로 잠그기' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: '취소' }));
    await fireEvent.click(screen.getByRole('button', { name: '권장 닫기' }));
    expect(screen.queryByText(text)).toBeNull();
  });

  it('does not recommend locking for KIS keys or when Toss keys are not saved', async () => {
    await setup({ provider: 'kis' }, KIS);
    expect(screen.queryByText(/토스 키는 주문 권한이 있어요/)).toBeNull();
  });

  it('이 기기에서 키 삭제 clears the keys only after confirmation', async () => {
    const confirmFn = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    const app = await setup({ provider: 'kis' }, KIS, confirmFn);
    const btn = screen.getByRole('button', { name: '이 기기에서 키 삭제' });
    await fireEvent.click(btn);
    expect(app.secrets).toEqual(KIS);
    await fireEvent.click(btn);
    expect(app.secrets).toBeNull();
  });
});
