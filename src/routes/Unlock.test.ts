// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { App } from '../lib/state/app.svelte';
import { WrongPassphraseError } from '../lib/state/secrets';
import Unlock from './Unlock.svelte';

function fakeApp(unlock: App['unlock']) {
  return { unlock: vi.fn(unlock), clearSecrets: vi.fn() } as unknown as App & {
    unlock: ReturnType<typeof vi.fn>;
    clearSecrets: ReturnType<typeof vi.fn>;
  };
}

describe('Unlock', () => {
  it('uses a password field and shows 암호가 맞지 않아요 on a wrong passphrase', async () => {
    const app = fakeApp(async () => {
      throw new WrongPassphraseError();
    });
    render(Unlock, { app });
    const input = screen.getByLabelText('암호') as HTMLInputElement;
    expect(input.type).toBe('password');
    await fireEvent.input(input, { target: { value: 'nope' } });
    await fireEvent.click(screen.getByRole('button', { name: '잠금 해제' }));
    expect(app.unlock).toHaveBeenCalledWith('nope');
    expect((await screen.findByRole('alert')).textContent).toBe('암호가 맞지 않아요');
  });

  it('clears keys only after confirmation', async () => {
    const app = fakeApp(async () => {});
    const confirmFn = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(Unlock, { app, confirmFn });
    const link = screen.getByRole('button', { name: '이 기기에서 키 삭제' });
    await fireEvent.click(link);
    expect(app.clearSecrets).not.toHaveBeenCalled();
    await fireEvent.click(link);
    expect(app.clearSecrets).toHaveBeenCalledTimes(1);
  });
});
