// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeTestApp } from '../../../sheets/testApp';
import type { App } from '../../state/app.svelte';
import type { Settings } from '../../state/schema';
import type { Secrets } from '../../state/secrets';
import { kstEpoch } from '../../time/kst';
import { dismissSnackbar } from '../components/snackbarStore.svelte';
import KeyLock from './KeyLock.svelte';

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
