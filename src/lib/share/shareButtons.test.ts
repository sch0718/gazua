// @vitest-environment jsdom
// 그룹 관리·선정 기준 행 메뉴의 「공유」: 로그인했을 때만 보이고, 원본 ID 없는 스냅샷으로 대화상자를 연다.
import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeTestApp } from '../../sheets/testApp';
import GroupSheet from '../../sheets/GroupSheet.svelte';
import { newCriteria } from '../screen/defaults';
import type { App } from '../state/app.svelte';
import type { SyncController } from '../sync/controller.svelte';
import CriteriaList from '../ui/screen/CriteriaList.svelte';
import { closeShare, currentShare, setShareController } from './shareStore.svelte';

const NOW = Date.UTC(2026, 9, 25);
let apps: App[] = [];
afterEach(() => {
  for (const a of apps) a.destroy();
  apps = [];
  closeShare();
  setShareController(null);
});

function signedIn(on: boolean) {
  setShareController({ account: on ? { email: 'me@example.test' } : null } as SyncController);
}

function app() {
  const a = makeTestApp({ groups: [{ id: 'g-secret-id', name: '반도체', items: [{ symbol: '005930', colorSlot: 1, hidden: false, addedAt: 1 }] }], now: NOW });
  apps.push(a);
  return a;
}

describe('공유 버튼', () => {
  it('로그인하지 않았으면 보이지 않는다', () => {
    signedIn(false);
    render(GroupSheet, { open: true, app: app(), onclose: vi.fn() });
    expect(screen.queryByRole('button', { name: '반도체 공유' })).toBeNull();
  });

  it('그룹 관리에서 공유를 누르면 시트를 닫고 그룹 스냅샷으로 연다', async () => {
    signedIn(true);
    const a = app();
    const onclose = vi.fn();
    render(GroupSheet, { open: true, app: a, onclose });
    await fireEvent.click(screen.getByRole('button', { name: '반도체 공유' }));
    expect(onclose).toHaveBeenCalled();
    const req = currentShare()!;
    expect(req).toMatchObject({ kind: 'group', profileId: a.meta.activeProfileId });
    expect(req.build(true).ok).toBe(true);
    expect(JSON.stringify(req.build(true))).not.toContain('g-secret-id');
  });

  it('선정 기준 행 메뉴에서 공유를 연다', async () => {
    signedIn(true);
    const a = app();
    a.setCriteria([{ ...newCriteria(NOW, null, '저평가'), id: 'c-secret-id' }]);
    a.navigate({ name: 'simulate', tab: 'criteria' });
    render(CriteriaList, { app: a, dataRange: null, lastResults: {} });
    await fireEvent.click(screen.getByRole('button', { name: '저평가 메뉴' }));
    await fireEvent.click(screen.getByRole('button', { name: '공유' }));
    const req = currentShare()!;
    expect(req.kind).toBe('criteria');
    expect(req.build(true).ok).toBe(true);
    expect(JSON.stringify(req.build(true))).not.toContain('c-secret-id');
  });
});
