// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import Segmented from './Segmented.svelte';
import segmentedSource from './Segmented.svelte?raw';

const options = [
  { value: 'auto', label: '자동', sub: 'KRX' },
  { value: 'krx', label: 'KRX' },
  { value: 'nxt', label: 'NXT', disabled: true, reason: '토스는 통합 시세만 제공해요' },
];

describe('Segmented', () => {
  it('marks the selected option as checked', () => {
    render(Segmented, { options, value: 'krx', onchange: vi.fn() });
    expect(screen.getByRole('radio', { name: 'KRX' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: /자동/ }).getAttribute('aria-checked')).toBe('false');
  });

  it('shows the sub label', () => {
    render(Segmented, { options, value: 'auto', onchange: vi.fn() });
    expect(screen.getByText('KRX', { selector: 'small' })).toBeTruthy();
  });

  it('calls onchange with the clicked value', async () => {
    const onchange = vi.fn();
    render(Segmented, { options, value: 'auto', onchange });
    await fireEvent.click(screen.getByRole('radio', { name: 'KRX' }));
    expect(onchange).toHaveBeenCalledExactlyOnceWith('krx');
  });

  it('does not call onchange for the already selected option', async () => {
    const onchange = vi.fn();
    render(Segmented, { options, value: 'krx', onchange });
    await fireEvent.click(screen.getByRole('radio', { name: 'KRX' }));
    expect(onchange).not.toHaveBeenCalled();
  });

  it('disabled options expose aria-disabled and reason, and ignore clicks', async () => {
    const onchange = vi.fn();
    render(Segmented, { options, value: 'auto', onchange });
    const nxt = screen.getByRole('radio', { name: 'NXT' });
    expect(nxt.getAttribute('aria-disabled')).toBe('true');
    expect(nxt.getAttribute('title')).toBe('토스는 통합 시세만 제공해요');
    await fireEvent.click(nxt);
    expect(onchange).not.toHaveBeenCalled();
  });

  it('moves selection with arrow keys, skipping disabled options', async () => {
    const onchange = vi.fn();
    render(Segmented, { options, value: 'krx', onchange });
    await fireEvent.keyDown(screen.getByRole('radio', { name: 'KRX' }), { key: 'ArrowRight' });
    // nxt is disabled, so wraps to auto
    expect(onchange).toHaveBeenCalledExactlyOnceWith('auto');
  });

  it('uses a roving tabindex', () => {
    render(Segmented, { options, value: 'krx', onchange: vi.fn() });
    expect(screen.getByRole('radio', { name: 'KRX' }).getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('radio', { name: /자동/ }).getAttribute('tabindex')).toBe('-1');
  });

  it('onSurface: 카드 위 변형은 켤 때만 붙는다(트랙·선택 색은 테마별 토큰)', () => {
    const { container, unmount } = render(Segmented, { options, value: 'krx', onchange: vi.fn() });
    expect(container.querySelector('.seg')!.classList.contains('on-surface')).toBe(false);
    unmount();
    const r = render(Segmented, { options, value: 'krx', onchange: vi.fn(), onSurface: true });
    expect(r.container.querySelector('.seg')!.classList.contains('on-surface')).toBe(true);
    // jsdom은 컴포넌트 스타일을 계산하지 않으므로 소스의 규칙을 읽는다
    const track = /\.seg\.on-surface\s*\{([^}]*)\}/.exec(segmentedSource)?.[1] ?? '';
    expect(track).toMatch(/background:\s*var\(--seg-card-track\)/);
    const sel = /\.on-surface button\.on\s*\{([^}]*)\}/.exec(segmentedSource)?.[1] ?? '';
    expect(sel).toMatch(/background:\s*var\(--seg-card-on\)/);
  });
});
