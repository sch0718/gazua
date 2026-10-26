// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { ApiResult, SharedRead } from '../lib/sync/api';
import { newCriteria } from '../lib/screen/defaults';
import { criteriaSnapshot } from '../lib/share/snapshot';
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

  it('종목 목록에서 이름을 찾아 「이름(코드)」로 보여 준다', async () => {
    const read = vi.fn(async (): Promise<ApiResult<SharedRead>> => ({ ok: true, data: DATA }));
    const universe = vi.fn(async () => [{ s: '005930', n: '삼성전자', m: 'KOSPI', t: 'STOCK' as const }]);
    render(SharedView, { capability: CAP, read, onexit: () => {}, universe });
    await waitFor(() => expect(screen.getByText(/삼성전자\(005930\)/)).toBeTruthy());
  });

  it('종목 목록을 받지 못하면 코드만 보여 준다', async () => {
    const read = vi.fn(async (): Promise<ApiResult<SharedRead>> => ({ ok: true, data: DATA }));
    const universe = vi.fn(async () => Promise.reject(new Error('offline')));
    render(SharedView, { capability: CAP, read, onexit: () => {}, universe });
    await waitFor(() => expect(screen.getByText('종목 1개: 005930')).toBeTruthy());
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

  // Codex 리뷰(PR #39) 7: 전략·선정 기준 공유는 요약 줄만으로는 규칙이 다 보이지 않는다. 규칙 전체를 읽기 전용으로 펼쳐 볼 수 있다.
  it('전략·선정 기준은 규칙 전체를 펼쳐 볼 수 있다', async () => {
    const c = newCriteria(1, null, '저평가');
    c.conditions.marketCap = { on: true, minEok: 7777 };
    const snapshot = criteriaSnapshot(c, { baskets: [], strategies: [] }, { hideCapital: true });
    const read = vi.fn(async (): Promise<ApiResult<SharedRead>> => ({ ok: true, data: { ...DATA, kind: 'criteria', title: '저평가', snapshot } }));
    render(SharedView, { capability: CAP, read, onexit: () => {} });
    await waitFor(() => expect(screen.getByRole('heading', { name: '저평가' })).toBeTruthy());
    const details = screen.getByText('규칙 전체 보기').closest('details')!;
    expect(details.textContent).toContain('7777');
  });
});

