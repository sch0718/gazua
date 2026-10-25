// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { ApiResult, SharedRead } from '../lib/sync/api';
import SharedView from './SharedView.svelte';

const CAP = 'k'.repeat(43);
const DATA: SharedRead = { kind: 'group', title: '반도체', snapshot: { kind: 'group', v: 1, title: '반도체', symbols: ['005930'] }, createdAt: 1, expiresAt: Date.UTC(2026, 10, 1) };

describe('SharedView', () => {
  it('capability로 읽어 읽기 전용으로 보여 주고 저장소에 남기지 않는다', async () => {
    const read = vi.fn(async (): Promise<ApiResult<SharedRead>> => ({ ok: true, data: DATA }));
    const before = localStorage.length;
    render(SharedView, { capability: CAP, read, onexit: () => {} });
    await waitFor(() => expect(screen.getByRole('heading', { name: '반도체' })).toBeTruthy());
    expect(read).toHaveBeenCalledWith(CAP);
    expect(screen.getByText(/005930/)).toBeTruthy();
    expect(localStorage.length).toBe(before);
  });

  it.each([
    ['gone', '만료됐거나 철회된 공유예요.'],
    ['not-found', '링크가 맞지 않아요'],
    ['offline', '서버에 연결할 수 없어요'],
  ] as const)('%s면 안내한다', async (kind, text) => {
    const read = vi.fn(async () => ({ ok: false, kind }) as ApiResult<SharedRead>);
    render(SharedView, { capability: CAP, read, onexit: () => {} });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(text));
  });

  it('형식이 틀린 링크는 서버에 묻지 않는다', async () => {
    const read = vi.fn();
    render(SharedView, { capability: undefined, read, onexit: () => {} });
    expect(screen.getByRole('alert').textContent).toContain('링크가 맞지 않아요');
    expect(read).not.toHaveBeenCalled();
  });

  it('공유 기능이 없는 빌드면 안내한다', () => {
    render(SharedView, { capability: CAP, read: null, onexit: () => {} });
    expect(screen.getByRole('alert').textContent).toContain('설정되지 않았어요');
  });
});
