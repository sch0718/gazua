// @vitest-environment jsdom
import { currentSnackbar, dismissSnackbar } from '@sch0718/ui-svelte';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { itemsOf, makeTestApp } from '../../sheets/testApp';
import { newStrategy } from '../sim/defaults';
import { STRATEGY_CAP_MESSAGE } from '../sim/strategyStore';
import type { App } from '../state/app.svelte';
import { compareSnapshot } from './compact';
import ImportHost from './ImportHost.svelte';
import { clearImport, markImported, peekImport, stashImport } from './pendingImport';
import { groupSnapshot, strategySnapshot } from './snapshot';
import { expectNoAxeViolations } from './testAxe';
import { NOW, validationFixture } from './testFixtures';

let apps: App[] = [];
const universe = async () => ['005930', '000660'].map((s) => ({ s, n: s, m: 'KOSPI', t: 'STOCK' as const }));
const g = groupSnapshot({ id: 'x', name: '반도체', items: itemsOf(['005930', '000660']) });
const TITLE = '이 프로필에 저장할까요?';

function setup(o: { onboarded?: boolean; ua?: string } = {}) {
  const app = makeTestApp({ groups: [{ id: 'g1', name: '기존', items: [] }], now: NOW, settings: { onboarded: o.onboarded ?? true } });
  apps.push(app);
  render(ImportHost, { app, universe, now: () => NOW, ua: o.ua ?? 'Mozilla/5.0' });
  return app;
}
afterEach(() => {
  for (const a of apps) a.destroy();
  apps = [];
  clearImport();
  localStorage.clear();
  dismissSnackbar();
});

describe('ImportHost', () => {
  it('관문·온보딩 화면에서는 열리지 않고 대기 값이 남는다. 일반 화면이 되면 연다', async () => {
    stashImport(g, NOW);
    const app = setup({ onboarded: false });
    expect(app.route.name).toBe('onboarding');
    await tick();
    expect(screen.queryByText(TITLE)).toBeNull();
    expect(peekImport(NOW)).not.toBeNull();
    app.updateSettings({ onboarded: true });
    app.navigate({ name: 'compare' });
    expect(await screen.findByText(TITLE)).toBeTruthy();
    expect(screen.getByText('「내 프로필」 프로필에 저장해요')).toBeTruthy();
    expect(screen.getByRole('list', { name: '만들 것' }).textContent).toContain('그룹 「반도체」 · 종목 2개');
  });

  it('저장하면 새 그룹을 만들고 그 비교 화면으로 가며 대기 값을 지운다', async () => {
    stashImport(g, NOW);
    const app = setup();
    await fireEvent.click(await screen.findByRole('button', { name: '저장' }));
    const made = app.watchlists.groups.find((x) => x.name === '반도체')!;
    expect(made.items.map((i) => i.symbol)).toEqual(['005930', '000660']);
    expect(app.route).toEqual({ name: 'compare', groupId: made.id });
    expect(peekImport(NOW)).toBeNull();
    expect(currentSnackbar()?.message).toBe('가져왔어요');
  });

  it('비교 화면: 보기 설정 체크를 끄면 설정은 그대로다', async () => {
    const cmp = compareSnapshot({ id: 'x', name: '반도체', items: itemsOf(['005930']) }, { period: { unit: 'M', n: 6 }, metric: 'rsi', benchmark: 'KOSDAQ', boardOrder: 'mine' });
    stashImport(cmp, NOW);
    const app = setup();
    const before = { ...app.settings };
    const check = (await screen.findByLabelText('보기 설정도 적용')) as HTMLInputElement;
    expect(check.checked).toBe(true);
    expect(screen.getByText('기간 6개월 · 지표 RSI(14) · 벤치마크 KOSDAQ · 정렬 내 순서', { exact: false })).toBeTruthy();
    await fireEvent.click(check);
    await fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(app.settings.period).toEqual(before.period);
    expect(app.settings.metric).toBe(before.metric);
  });

  it('검증 결과에서 온 기준: ②·결과 안내, 저장하면 기준 편집으로 간다', async () => {
    stashImport(validationFixture(), NOW);
    const app = setup();
    expect(await screen.findByText('② 매매 규칙은 함께 오지 않아요. 저장한 뒤 매매 규칙을 골라 주세요')).toBeTruthy();
    expect(screen.getByText('결과는 저장하지 않아요. 저장한 뒤 실행하면 내 데이터로 다시 계산해요')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: '저장' }));
    const c = app.criteria.find((x) => x.name === '대형 우량')!;
    expect(app.baskets.map((b) => b.id)).toEqual(c.pool.baskets);
    expect(app.route).toEqual({ name: 'simulate', tab: 'criteria', criteriaId: c.id });
  });

  it('한도로 막히면 이유를 alert로 보이고 저장 단추 대신 닫기만 둔다', async () => {
    const app = setup();
    app.setStrategies(Array.from({ length: 20 }, (_, i) => newStrategy(NOW, null, `s${i}`)));
    stashImport(strategySnapshot(newStrategy(NOW, null, '눌림목'), app.watchlists, { hideCapital: false, now: NOW }), NOW);
    app.navigate({ name: 'simulate' });
    expect((await screen.findByRole('alert')).textContent).toBe(STRATEGY_CAP_MESSAGE);
    expect(screen.queryByRole('button', { name: '저장' })).toBeNull();
    expect(screen.getByText('목록을 정리한 뒤 공유 링크를 다시 열면 가져올 수 있어요')).toBeTruthy();
  });

  it('저장하지 않기: 아무것도 만들지 않고 대기 값을 지워 다시 열리지 않는다', async () => {
    stashImport(g, NOW);
    const app = setup();
    await fireEvent.click(await screen.findByRole('button', { name: '저장하지 않기' }));
    expect(app.watchlists.groups.map((x) => x.name)).toEqual(['기존']);
    expect(peekImport(NOW)).toBeNull();
    app.navigate({ name: 'settings' });
    await tick();
    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it('이미 가져온 대기 값(탭 복제)은 창 대신 스낵바', async () => {
    stashImport(g, NOW);
    markImported(peekImport(NOW)!.id);
    setup();
    await waitFor(() => expect(currentSnackbar()?.message).toBe('이미 가져왔어요'));
    expect(screen.queryByText(TITLE)).toBeNull();
    expect(peekImport(NOW)).toBeNull();
  });

  it('카카오톡 인앱이면 이 브라우저에 저장된다고 먼저 알린다', async () => {
    stashImport(g, NOW);
    setup({ ua: 'Mozilla/5.0 (Linux; Android 14) KAKAOTALK 10.8.0' });
    expect(await screen.findByText('지금 이 브라우저(카카오톡)에 저장돼요')).toBeTruthy();
  });

  it('axe 위반이 없다', async () => {
    stashImport(g, NOW);
    setup();
    await screen.findByText(TITLE);
    await expectNoAxeViolations(document.body);
  });
});
