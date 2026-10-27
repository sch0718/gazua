// @vitest-environment jsdom
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { Selection } from '../../screen/select';
import PreviewPanel from './PreviewPanel.svelte';

const selection: Selection = { date: '2026-10-16', passed: 3, picked: [{ symbol: '005930', values: {} }] };
const props = { hasData: true, asOf: '2026.10.16', selection, pending: false, failed: false, names: { '005930': '삼성전자' } };

describe('PreviewPanel', () => {
  it('막히지 않았으면 기준일과 결과를 보인다', () => {
    render(PreviewPanel, props);
    expect(screen.getByText('2026.10.16 기준')).toBeTruthy();
    expect(screen.getByRole('status').textContent?.trim()).toBe('통과 3개 · 상위 1개');
    expect(screen.getByText('삼성전자')).toBeTruthy();
  });

  it('막혔으면 기준일 줄과 옛 결과 없이 안내만 상태 영역에 보인다', () => {
    render(PreviewPanel, { ...props, blocked: true });
    expect(screen.queryByText('2026.10.16 기준')).toBeNull();
    expect(screen.queryByText('삼성전자')).toBeNull();
    expect(screen.getByRole('status').textContent?.trim()).toBe('고칠 곳을 고치면 미리 볼 수 있어요');
  });
});
