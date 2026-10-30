// @vitest-environment jsdom
import { currentSnackbar, dismissSnackbar } from '@sch0718/ui-svelte';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { itemsOf, makeTestApp } from '../../sheets/testApp';
import { newBasket } from '../screen/baskets';
import { newCriteria } from '../screen/defaults';
import { newStrategy } from '../sim/defaults';
import { STRATEGY_CAP_MESSAGE } from '../sim/strategyStore';
import type { App } from '../state/app.svelte';
import type { RouteName } from '../state/routes';
import { compareSnapshot } from './compact';
import ImportHost from './ImportHost.svelte';
import { clearImport, markImported, peekImport, stashImport } from './pendingImport';
import { criteriaSnapshot, groupSnapshot, strategySnapshot } from './snapshot';
import { expectNoAxeViolations } from './testAxe';
import { NOW, validationFixture } from './testFixtures';

let apps: App[] = [];
let landings: HTMLElement[] = [];
const universe = async () => ['005930', '000660'].map((s) => ({ s, n: s, m: 'KOSPI', t: 'STOCK' as const }));
const g = groupSnapshot({ id: 'x', name: '반도체', items: itemsOf(['005930', '000660']) });
const TITLE = '이 프로필에 저장할까요?';

function setup(o: { onboarded?: boolean; ua?: string; route?: RouteName; universe?: typeof universe } = {}) {
  const app = makeTestApp({ groups: [{ id: 'g1', name: '기존', items: [] }], now: NOW, settings: { onboarded: o.onboarded ?? true } });
  apps.push(app);
  if (o.route) app.navigate({ name: o.route });
  render(ImportHost, { app, universe: o.universe ?? universe, now: () => NOW, ua: o.ua ?? 'Mozilla/5.0' });
  return app;
}
afterEach(() => {
  cleanup();
  for (const landing of landings) landing.remove();
  landings = [];
  for (const a of apps) a.destroy();
  apps = [];
  clearImport();
  localStorage.clear();
  dismissSnackbar();
  vi.restoreAllMocks();
  vi.useRealTimers();
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
    await expectNoAxeViolations(document.body);
    await fireEvent.click(check);
    expect(check.checked).toBe(false);
    await expectNoAxeViolations(document.body);
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
    await expectNoAxeViolations(document.body);
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

  it.each(['profiles', 'unlock', 'shared'] as const)('%s에서는 창을 열지 않고 대기 값을 유지한다', async (route) => {
    stashImport(g, NOW);
    const pending = peekImport(NOW);
    const load = vi.fn(universe);
    const app = setup({ route, universe: load });
    expect(app.route.name).toBe(route);
    await tick();
    expect(screen.queryByText(TITLE)).toBeNull();
    expect(peekImport(NOW)).toEqual(pending);
    expect(load).not.toHaveBeenCalled();
  });

  it('기준과 묶음이 같은 이름으로 바뀌어도 확인 창을 렌더한다', async () => {
    const app = setup({ route: 'profiles' });
    const c = newCriteria(NOW, null, '대형');
    const b = newBasket(NOW, '대형', ['005930']);
    c.pool.baskets = [b.id];
    app.setCriteria([c]);
    app.setBaskets([b]);
    stashImport(criteriaSnapshot(c, { baskets: [b], strategies: [] }, { hideCapital: false, now: NOW }), NOW);
    app.navigate({ name: 'compare' });
    expect(await screen.findByText(TITLE)).toBeTruthy();
    expect(screen.getByRole('list', { name: '만들 것' }).textContent).toContain('선정 기준 「대형 2」 · 묶음 1개');
    expect(screen.getAllByText('같은 이름이 있어 「대형 2」로 저장해요')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '저장' })).toBeTruthy();
  });

  it.each([
    ['도착 제목', '<h1>바깥 제목</h1><main><h1>본문 제목</h1><h2>소제목</h2></main><span data-landing-title tabindex="-1" data-target>도착 제목</span>'],
    ['main h1', '<h1>바깥 제목</h1><main><h2>소제목</h2><h1 data-target>본문 제목</h1></main>'],
    ['main h2', '<h1>바깥 제목</h1><main><h2 data-target>본문 제목</h2></main>'],
    ['바깥 제목', '<h2 data-target>바깥 제목</h2><main>본문</main>'],
    ['제목 없는 main', '<main data-target>본문</main>'],
    ['hidden 도착 제목을 건너뛴 main', '<span data-landing-title hidden data-skipped>숨은 제목</span><main data-target>본문</main>'],
    ['display:none 도착 제목을 건너뛴 main', '<span data-landing-title style="display:none" data-skipped>숨은 제목</span><main data-target>본문</main>'],
    ['같은 선택자의 다음 도착 제목', '<span data-landing-title hidden data-skipped>숨은 제목</span><span data-landing-title data-target>도착 제목</span><main>본문</main>'],
    ['포커스 실패 뒤 다음 도착 제목', '<span data-landing-title data-focus-fails data-skipped>포커스 불가 제목</span><span data-landing-title data-target>도착 제목</span><main>본문</main>'],
  ])('저장 뒤 %s에 포커스를 둔다', async (_, html) => {
    stashImport(g, NOW);
    const app = setup();
    const landing = document.createElement('div');
    landings.push(landing);
    // 도착 화면이 navigate 때 렌더되는 상황을 흉내 낸다.
    const navigate = app.navigate;
    vi.spyOn(app, 'navigate').mockImplementation((route) => {
      navigate(route);
      landing.innerHTML = html;
      document.body.append(landing);
      // jsdom이 재현하지 못하는 브라우저의 포커스 거부를 흉내 낸다.
      for (const el of landing.querySelectorAll<HTMLElement>('[data-focus-fails]')) {
        vi.spyOn(el, 'focus').mockImplementation(() => {});
      }
    });
    await fireEvent.click(await screen.findByRole('button', { name: '저장' }));
    await waitFor(() => expect(document.activeElement).toBe(landing.querySelector('[data-target]')));
    expect(document.activeElement?.getAttribute('tabindex')).toBe('-1');
    for (const skipped of landing.querySelectorAll('[data-skipped]')) {
      expect(skipped.hasAttribute('tabindex')).toBe(false);
    }
  });

  it('종목 목록 대기 중 이탈하면 열지 않고, 복귀할 때 다시 요청한다', async () => {
    vi.useFakeTimers();
    stashImport(g, NOW);
    const pending = peekImport(NOW);
    let resolve!: (items: Awaited<ReturnType<typeof universe>>) => void;
    const load = vi.fn<typeof universe>().mockImplementationOnce(() => new Promise((done) => { resolve = done; })).mockImplementation(universe);
    const app = setup({ universe: load });
    await tick();
    // 앱 초기화가 예약한 hashchange를 먼저 처리한 뒤 화면을 벗어난다.
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    app.navigate({ name: 'shared' });
    await tick();
    resolve(await universe());
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.queryByText(TITLE)).toBeNull();
    expect(peekImport(NOW)).toEqual(pending);
    app.navigate({ name: 'compare' });
    await tick();
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByText(TITLE)).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('종목 목록이 10초 안에 오지 않으면 거르지 않고 진행하고 늦은 응답은 무시한다', async () => {
    vi.useFakeTimers();
    stashImport(g, NOW);
    let resolve!: (items: Awaited<ReturnType<typeof universe>>) => void;
    setup({ universe: () => new Promise((done) => { resolve = done; }) });
    await tick();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(screen.queryByText(TITLE)).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await tick();
    expect(screen.getByText(TITLE)).toBeTruthy();
    expect(screen.getByRole('list', { name: '만들 것' }).textContent).toContain('종목 2개');
    resolve([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.queryByRole('alert')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(currentSnackbar()?.message).toBe('가져왔어요');
  });

  it('열린 뒤 일반 화면을 벗어나면 창만 닫고 복귀하면 다시 연다', async () => {
    stashImport(g, NOW);
    const pending = peekImport(NOW);
    const app = setup();
    await screen.findByText(TITLE);
    app.navigate({ name: 'shared' });
    await waitFor(() => expect(screen.queryByText(TITLE)).toBeNull());
    expect(peekImport(NOW)).toEqual(pending);
    app.navigate({ name: 'compare' });
    expect(await screen.findByText(TITLE)).toBeTruthy();
  });

  it('기준 저장이 실패하면 오류를 알리고 묶음을 원래대로 되돌린다', async () => {
    stashImport(validationFixture(), NOW);
    const app = setup();
    app.setBaskets([newBasket(NOW, '기존 묶음', ['005930'])]);
    const before = structuredClone(app.baskets);
    const setBaskets = vi.spyOn(app, 'setBaskets');
    vi.spyOn(app, 'setCriteria').mockImplementation(() => { throw new Error('쓰기 실패'); });
    await fireEvent.click(await screen.findByRole('button', { name: '저장' }));
    expect(currentSnackbar()?.message).toBe('가져오지 못했어요');
    expect(setBaskets).toHaveBeenCalledTimes(2);
    expect(setBaskets.mock.calls[0][0]).toHaveLength(before.length + 1);
    expect(app.baskets).toEqual(before);
    expect(app.criteria).toEqual([]);
    expect(peekImport(NOW)).not.toBeNull();
  });

  it('창을 연 뒤 다른 탭에서 가져왔으면 저장 직전에 막는다', async () => {
    stashImport(g, NOW);
    const app = setup();
    const save = await screen.findByRole('button', { name: '저장' });
    markImported(peekImport(NOW)!.id);
    await fireEvent.click(save);
    expect(currentSnackbar()?.message).toBe('이미 가져왔어요');
    expect(app.watchlists.groups.map((x) => x.name)).toEqual(['기존']);
    expect(peekImport(NOW)).toBeNull();
    expect(screen.queryByText(TITLE)).toBeNull();
  });
});
