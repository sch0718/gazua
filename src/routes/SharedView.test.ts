// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lwcCharts, resetLwcStub, ResizeObserverStub } from '../lib/chart/lwcStub';
import { newCriteria } from '../lib/screen/defaults';
import { compareSnapshot } from '../lib/share/compact';
import { clearImport, IMPORT_KEY } from '../lib/share/pendingImport';
import { criteriaSnapshot, type ShareSnapshot } from '../lib/share/snapshot';
import { expectNoAxeViolations } from '../lib/share/testAxe';
import { NOW, simResultFixture, validationFixture } from '../lib/share/testFixtures';
import type { ApiResult, SharedRead } from '../lib/sync/api';
import SharedView from './SharedView.svelte';

vi.mock('lightweight-charts', async () => (await import('../lib/chart/lwcStub')).lwcModule());
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  resetLwcStub();
});
afterEach(() => {
  vi.unstubAllGlobals();
  clearImport();
});

const dataOf = (snapshot: unknown, kind = (snapshot as { kind: string }).kind): SharedRead =>
  ({ kind, title: (snapshot as { title: string }).title, snapshot, createdAt: NOW, expiresAt: NOW + 7 * 864e5 }) as SharedRead;
const readOf = (snapshot: unknown, kind?: string) => vi.fn(async (): Promise<ApiResult<SharedRead>> => ({ ok: true, data: dataOf(snapshot, kind) }));
const names = vi.fn(async () => [
  { s: '005930', n: '삼성전자', m: 'KOSPI', t: 'STOCK' as const },
  { s: '000660', n: 'SK하이닉스', m: 'KOSPI', t: 'STOCK' as const },
]);
const cmp = compareSnapshot(
  { id: 'g', name: '반도체', items: [{ symbol: '005930', colorSlot: 1, hidden: false, addedAt: 1 }] },
  { period: { unit: 'M', n: 1 }, metric: 'change', benchmark: 'AUTO', boardOrder: 'value' },
);

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

describe('SharedView 새 종류', () => {
  const show = (snapshot: unknown, o: Record<string, unknown> = {}) =>
    render(SharedView, { capability: CAP, read: readOf(snapshot), onexit: vi.fn(), universe: names, ...o });

  it('비교 화면: 요약 줄과 가져오면 볼 수 있다는 안내, 규칙 원문은 없다', async () => {
    show(cmp);
    expect(await screen.findByText('보기: 기간 1개월 · 지표 등락률 · 벤치마크 자동 · 정렬 값 순')).toBeTruthy();
    expect(screen.getByText('가져오면 내 연결이나 데모로 같은 화면을 볼 수 있어요')).toBeTruthy();
    expect(screen.getByText(/비교 화면 · .*까지 볼 수 있어요/)).toBeTruthy();
    expect(screen.queryByText('규칙 전체 보기')).toBeNull();
  });

  it('시뮬레이션 결과: 머리줄·요약 카드·거래 줄(종목 이름)·규칙 원문(결과 없음)', async () => {
    show(simResultFixture());
    expect(await screen.findByText(/^2024\.01\.02 ~ 2024\.01\.12(?: \(요청 \d{4}\.\d{2}\.\d{2}부터\))? · KRX 일봉 · \d{2}\/\d{2} \d{2}:\d{2} 받음$/)).toBeTruthy();
    expect(screen.getAllByText(/받음/)).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2, name: '시뮬레이션 결과' })).toBeTruthy();
    expect(screen.getByRole('list', { name: '요약' }).textContent).toContain('총수익률');
    await waitFor(() => expect(screen.getAllByText('삼성전자').length).toBeGreaterThan(0));
    const rules = screen.getByText('규칙 전체 보기').closest('details')!;
    expect(rules.textContent).toContain('"strategy"');
    expect(rules.textContent).not.toContain('"axis"');
    expect(rules.textContent).not.toContain('"result"');
    expect(lwcCharts.length).toBeGreaterThan(0);
  });

  it('자금 숨김: 배지와 가격만 보이는 거래 줄, 종목별은 자금 대비 %', async () => {
    show(simResultFixture({ capitalHidden: true }));
    expect(await screen.findByText('초기 자금 비공개')).toBeTruthy();
    expect(screen.getByText('70,000원')).toBeTruthy();
    expect(screen.queryByText(/14주/)).toBeNull();
    await fireEvent.click(screen.getByRole('radio', { name: '종목별' }));
    const symbols = screen.getByRole('list', { name: '종목별' });
    expect(within(symbols).getByText('자금 대비 +1.41%')).toBeTruthy();
    expect(within(symbols).getByText('자금 대비 −0.88%')).toBeTruthy();
    expect(symbols.textContent).not.toContain('원');
  });

  it('시뮬레이션 데모 실행은 ResultView 배지만 하나 보인다', async () => {
    const s = simResultFixture();
    s.run.demo = true;
    const { container } = show(s);
    expect(await screen.findAllByText('데모 데이터')).toHaveLength(1);
    expect(screen.getAllByText(/받음/)).toHaveLength(1);
    expect(container.querySelector('.badges')).toBeNull();
  });

  it.each([
    ['simResult', simResultFixture()],
    ['validation', validationFixture()],
  ])('%s: 배지가 없으면 배지 문단을 그리지 않는다', async (_kind, snapshot) => {
    const { container } = show(snapshot);
    await screen.findByRole('button', { name: '내 앱에 가져오기' });
    expect(container.querySelector('.badges')).toBeNull();
  });

  it('건너뜀 목록이 있는 결과에는 목록을 뺐다는 안내가 없다', async () => {
    show(simResultFixture());
    await fireEvent.click(await screen.findByRole('radio', { name: '건너뛴 신호 3' }));
    expect(screen.getByRole('list', { name: '건너뛴 신호' })).toBeTruthy();
    expect(screen.queryByText('목록은 크기 때문에 빼고 보냈어요')).toBeNull();
  });

  it('건너뜀 목록이 없는 결과는 개수로 탭 이름을 단다', async () => {
    const s = simResultFixture();
    s.result.skipped.rows = null;
    show(s);
    expect(await screen.findByRole('radio', { name: '건너뛴 신호 3' })).toBeTruthy();
  });

  it('솎은 곡선은 안내를 적는다', async () => {
    const s = simResultFixture();
    s.result.sampled = { from: 900 };
    show(s);
    expect(await screen.findByText('곡선은 900점 중 5점으로 줄였어요 · 수치는 전체 기간 기준이에요')).toBeTruthy();
  });

  it('검증 결과: 카드·오늘 선별·선정 이력', async () => {
    show(validationFixture());
    expect(await screen.findByRole('heading', { name: '오늘 기준 선별' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: '검증 결과' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '선정 이력' })).toBeTruthy();
    expect(screen.getAllByText('① 선정만').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: '관심 그룹으로 만들기' })).toBeNull();
  });

  it('검증 결과의 실행 정보·데모·자금 숨김 배지는 SharedView에 남긴다', async () => {
    const s = validationFixture({ capitalHidden: true });
    s.run.demo = true;
    const { container } = show(s);
    expect(await screen.findByText(/^2026\.01\.05 ~ 2026\.02\.03 · 시장 데이터 파일 · \d{4}\.\d{2}\.\d{2} \d{2}:\d{2} 받음$/)).toBeTruthy();
    expect(screen.getAllByText(/받음/)).toHaveLength(1);
    const badges = within(container.querySelector('.badges')!);
    expect(badges.getAllByText('데모 데이터')).toHaveLength(1);
    expect(badges.getByText('초기 자금 비공개')).toBeTruthy();
  });

  it('모르는 종류와 읽을 수 없는 공유를 나눠 안내한다', async () => {
    render(SharedView, { capability: CAP, read: readOf({ kind: 'future', v: 1, title: '새 종류' }), onexit: () => {}, universe: names });
    expect((await screen.findByRole('alert')).textContent).toBe('이 공유는 새 버전 앱에서 볼 수 있어요. 앱을 새로 고쳐 주세요.');
    const broken = simResultFixture();
    broken.result.trades[0][1] = 9;
    render(SharedView, { capability: CAP, read: readOf(broken), onexit: () => {}, universe: names });
    await waitFor(() => expect(screen.getAllByRole('alert').map((a) => a.textContent)).toContain('이 공유를 읽을 수 없어요. 보낸 사람에게 다시 만들어 달라고 해 주세요.'));
  });

  it('카카오톡 인앱이면 안내와 기본 브라우저 단추, iOS면 홈 화면 안내를 덧붙인다', async () => {
    show(cmp, { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) KAKAOTALK 10.8.0' });
    const note = await screen.findByRole('note');
    expect(note.textContent).toContain('카카오톡 안에서 열었어요. 여기서 가져오면 이 카카오톡 브라우저에만 저장돼요.');
    expect(note.textContent).toContain('홈 화면에 추가한 가즈아는 Safari와 저장소가 따로라');
    expect(within(note).getByRole('button', { name: '기본 브라우저로 열기' })).toBeTruthy();
  });

  it('Android 카카오톡은 인앱 안내만 보이고 홈 화면 앱 안내는 없다', async () => {
    show(cmp, { ua: 'Mozilla/5.0 (Linux; Android 14) KAKAOTALK 10.8.0' });
    const note = await screen.findByRole('note');
    expect(note.textContent).toContain('카카오톡 안에서 열었어요.');
    expect(screen.queryByText(/홈 화면에 추가한 가즈아/)).toBeNull();
  });

  it('일반 브라우저에는 인앱 안내가 없다', async () => {
    show(cmp, { ua: 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0.0.0 Mobile Safari/537.36' });
    await screen.findByRole('button', { name: '내 앱에 가져오기' });
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('내 앱에 가져오기: 대기 값을 넣고 onexit을 부른다(결과는 규칙만)', async () => {
    const onexit = vi.fn();
    show(simResultFixture(), { onexit, now: () => NOW });
    await fireEvent.click(await screen.findByRole('button', { name: '내 앱에 가져오기' }));
    expect(onexit).toHaveBeenCalledTimes(1);
    const stored = JSON.parse(sessionStorage.getItem(IMPORT_KEY)!);
    expect(stored).toMatchObject({ at: NOW, from: 'simResult', snapshot: { kind: 'strategy', title: '눌림목' } });
    expect(screen.getByText(/결과는 저장하지 않고 규칙만 가져와요/)).toBeTruthy();
  });

  it('가져오기에서 예외가 나도 앱으로 이동한다', async () => {
    const error = new Error('가져오기 실패');
    const onexit = vi.fn();
    const onimport = vi.fn(() => { throw error; });
    const errors: unknown[] = [];
    const handleError = (event: ErrorEvent) => {
      errors.push(event.error);
      event.preventDefault();
    };
    window.addEventListener('error', handleError);
    try {
      show(cmp, { onimport, onexit });
      await fireEvent.click(await screen.findByRole('button', { name: '내 앱에 가져오기' }));
      expect(onimport).toHaveBeenCalledWith(cmp);
      expect(errors).toEqual([error]);
      expect(onexit).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('error', handleError);
    }
  });

  it('읽을 수 없는 오류 안내에도 axe 위반이 없다', async () => {
    const broken = simResultFixture();
    broken.result.trades[0][1] = 9;
    const { container } = show(broken);
    expect((await screen.findByRole('alert')).textContent).toBe('이 공유를 읽을 수 없어요. 보낸 사람에게 다시 만들어 달라고 해 주세요.');
    await expectNoAxeViolations(container);
  });

  it('카카오톡 인앱 안내에도 axe 위반이 없다', async () => {
    const { container } = show(cmp, { ua: 'Mozilla/5.0 (Linux; Android 14) KAKAOTALK 10.8.0' });
    await screen.findByRole('button', { name: '내 앱에 가져오기' });
    expect(screen.getByRole('note')).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it.each<[string, ShareSnapshot]>([
    ['compare', cmp],
    ['simResult', simResultFixture()],
    ['validation', validationFixture()],
  ])('%s: axe 위반이 없다', async (_k, snapshot) => {
    const { container } = show(snapshot);
    await screen.findByRole('button', { name: '내 앱에 가져오기' });
    await expectNoAxeViolations(container);
  });
});
