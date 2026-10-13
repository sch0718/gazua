// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UniverseItem } from '../../data/universe';
import { newStrategy } from '../../sim/defaults';
import type { Strategy } from '../../sim/types';
import type { App } from '../../state/app.svelte';
import { kstEpoch } from '../../time/kst';
import { makeTestApp, itemsOf } from '../../../sheets/testApp';
import { currentSnackbar, dismissSnackbar } from '../components/snackbarStore.svelte';
import StrategyEditor from './StrategyEditor.svelte';

const NOW = kstEpoch('2026-10-12', '10:00:00');
const UNIVERSE: UniverseItem[] = [
  { s: '005930', n: '삼성전자', m: 'KOSPI', t: 'STOCK' },
  { s: '000660', n: 'SK하이닉스', m: 'KOSPI', t: 'STOCK' },
  { s: '009150', n: '삼성전기', m: 'KOSPI', t: 'STOCK' },
  { s: '069500', n: 'KODEX 200', m: 'KOSPI', t: 'ETF' },
];
const TITLES = ['종목', '기간·자금', '매수', '분할 매수', '매도', '비교 기준', '비용'];

let apps: App[] = [];
function setup(patch: (s: Strategy) => void = () => {}) {
  const app = makeTestApp({
    groups: [
      { id: 'g1', name: '반도체', items: itemsOf(['005930', '000660']) },
      { id: 'g2', name: '2차전지', items: itemsOf(['373220']) },
    ],
    now: NOW,
  });
  apps.push(app);
  const s: Strategy = { ...newStrategy(NOW, 'g1', '눌림목'), id: 's1' };
  patch(s);
  app.setStrategies([s]);
  const onRun = vi.fn();
  const view = render(StrategyEditor, { app, strategy: s, onRun, loadItems: async () => UNIVERSE });
  return { app, onRun, view };
}
const saved = (app: App) => app.strategies[0];
const header = (title: string) => screen.getAllByRole('button').find((b) => b.hasAttribute('aria-expanded') && b.querySelector('b')?.textContent === title)!;
const openSection = async (title: string) => fireEvent.click(header(title));
const settle = async () => {
  await vi.advanceTimersByTimeAsync(500);
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW + 1000);
});
afterEach(() => {
  vi.useRealTimers();
  for (const a of apps) a.destroy();
  apps = [];
  dismissSnackbar();
});

describe('StrategyEditor 구역', () => {
  it('seven collapsed sections in spec order with one-line summaries', async () => {
    setup();
    const heads = screen.getAllByRole('button').filter((b) => b.hasAttribute('aria-expanded'));
    expect(heads.map((b) => b.querySelector('b')?.textContent)).toEqual(TITLES);
    expect(heads.every((b) => b.getAttribute('aria-expanded') === 'false')).toBe(true);
    expect(screen.getByText('반도체 · 2종목')).toBeTruthy();
    expect(screen.getByText('고점 대비 10%↓ 뒤 → 3일 연속 상승 또는 B 돌파')).toBeTruthy();
    expect(screen.getByText('끔')).toBeTruthy();
    expect(screen.getByText('익절 +15% 전량 · 손절 −5% 분할 완료 후 평단')).toBeTruthy();
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByText('같은 종목 보유 · KOSPI · KODEX 200')).toBeTruthy(); // 유니버스에서 이름을 찾는다
  });

  it('changing the breakout level to A saves after 500ms', async () => {
    const { app } = setup();
    await openSection('매수');
    await fireEvent.click(screen.getByRole('radio', { name: /^A / }));
    await vi.advanceTimersByTimeAsync(499);
    expect(saved(app).entry.triggers.breakout.level).toBe('B');
    await vi.advanceTimersByTimeAsync(1);
    expect(saved(app).entry.triggers.breakout.level).toBe('A');
    expect(saved(app).updatedAt).toBe(NOW + 1000 + 500);
    expect(screen.getByText('고점 대비 10%↓ 뒤 → 3일 연속 상승 또는 A 돌파')).toBeTruthy();
  });

  it('a pending edit is saved when the editor goes away', async () => {
    const { app, view } = setup();
    await openSection('분할 매수');
    await fireEvent.click(screen.getByRole('switch', { name: '분할 매수 사용' }));
    expect(saved(app).scaleIn.on).toBe(false);
    view.unmount();
    expect(saved(app).scaleIn.on).toBe(true);
  });
});

describe('매도 구역', () => {
  it('익절 단계는 세 개까지, 지우면 마지막 단계가 전량이 된다', async () => {
    const { app } = setup();
    await openSection('매도');
    await fireEvent.click(screen.getByRole('button', { name: '＋ 단계 추가' }));
    expect(screen.getByRole('button', { name: '＋ 단계 추가' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: '＋ 단계 추가' }));
    expect(screen.queryByRole('button', { name: '＋ 단계 추가' })).toBeNull();
    await settle();
    expect(saved(app).exit.takeProfit).toHaveLength(3);
    expect(saved(app).exit.takeProfit[2].sellPct).toBe(100);
    // 앞 단계들이 나머지를 남겨서 모든 단계가 실행될 수 있다
    expect(saved(app).exit.takeProfit.map((t) => t.sellPct)).toEqual([50, 25, 100]);
    expect(screen.queryByText('마지막 단계 전에 모두 팔려서 뒤 단계가 실행되지 않아요')).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: '3단계 삭제' }));
    await settle();
    const tp = saved(app).exit.takeProfit;
    expect(tp).toHaveLength(2);
    expect(tp[1].sellPct).toBe(100);
    expect(screen.getByRole('button', { name: '＋ 단계 추가' })).toBeTruthy();
  });

  it('avgAlways + 분할 간격 ≥ 손절폭: Banner 경고, 실행은 그대로 된다', async () => {
    const { onRun } = setup((s) => {
      s.exit.stopLoss.basis = 'avgAlways';
      s.scaleIn = { on: true, stepPct: 6, maxAdds: 2 };
    });
    await openSection('매도');
    const msg = '추가 매수보다 손절이 먼저 일어나요. 추가 매수 간격을 손절폭보다 작게 해 주세요';
    expect(screen.getByText(msg)).toBeTruthy();
    const run = screen.getByRole('button', { name: '시뮬레이션 실행' });
    expect((run as HTMLButtonElement).disabled).toBe(false);
    await fireEvent.click(run);
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it('앞 단계들이 모두 팔면 Banner 경고, 실행은 그대로 된다', async () => {
    const { onRun } = setup((s) => {
      s.exit.takeProfit = [{ pct: 10, sellPct: 50 }, { pct: 20, sellPct: 50 }, { pct: 30, sellPct: 100 }];
    });
    await openSection('매도');
    expect(screen.getByText('마지막 단계 전에 모두 팔려서 뒤 단계가 실행되지 않아요')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: '시뮬레이션 실행' }));
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it('손절폭이 범위를 벗어나면 칸 아래 오류가 뜨고 저장값은 그대로다', async () => {
    const { app } = setup();
    await openSection('매도');
    const field = screen.getByRole('textbox', { name: '손절폭' });
    expect(field.getAttribute('inputmode')).toBe('decimal');
    await fireEvent.input(field, { target: { value: '99' } });
    expect(screen.getByText('0.5~50 사이로 적어 주세요')).toBeTruthy();
    await settle();
    expect(saved(app).exit.stopLoss.pct).toBe(5);
    await fireEvent.input(field, { target: { value: '7.5' } });
    expect(screen.queryByText('0.5~50 사이로 적어 주세요')).toBeNull();
    await settle();
    expect(saved(app).exit.stopLoss.pct).toBe(7.5);
  });
});

describe('실행 버튼', () => {
  it('막는 경고가 있으면 실행하지 않고 그 구역을 열어 Banner로 포커스를 옮긴다', async () => {
    const { onRun } = setup((s) => {
      const t = s.entry.triggers;
      t.reboundDays.on = t.breakout.on = false;
    });
    const run = screen.getByRole('button', { name: '시뮬레이션 실행' });
    expect((run as HTMLButtonElement).disabled).toBe(false);
    await fireEvent.click(run);
    expect(onRun).not.toHaveBeenCalled();
    expect(header('매수').getAttribute('aria-expanded')).toBe('true');
    const banner = screen.getByText('매수 신호가 나지 않아요. 트리거를 하나 이상 켜 주세요').closest('[tabindex="-1"]') as HTMLElement;
    expect(banner).toBeTruthy();
    expect(document.activeElement).toBe(banner);
  });

  it('id가 숫자로 시작하는 난수여도 Banner로 포커스를 옮긴다', async () => {
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.05); // base36 "0.1w…" -> 숫자로 시작
    const { onRun } = setup((s) => {
      s.entry.triggers.reboundDays.on = s.entry.triggers.breakout.on = false;
    });
    rnd.mockRestore();
    await fireEvent.click(screen.getByRole('button', { name: '시뮬레이션 실행' }));
    expect(onRun).not.toHaveBeenCalled();
    const banner = screen.getByText('매수 신호가 나지 않아요. 트리거를 하나 이상 켜 주세요').closest('[tabindex="-1"]') as HTMLElement;
    expect(/^\d/.test(banner.id)).toBe(false);
    expect(document.activeElement).toBe(banner);
  });

  it('경고가 없으면 onRun을 부른다', async () => {
    const { onRun } = setup();
    await fireEvent.click(screen.getByRole('button', { name: '시뮬레이션 실행' }));
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it('실행 직전에 저장 대기분을 저장하고, 작업본을 onRun에 넘긴다', async () => {
    const { app, onRun } = setup();
    await fireEvent.input(screen.getByRole('textbox', { name: '전략 이름' }), { target: { value: '반등' } });
    await fireEvent.click(screen.getByRole('button', { name: '시뮬레이션 실행' }));
    expect(app.strategies[0].name).toBe('반등');
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ id: app.strategies[0].id, name: '반등' }));
  });
});

describe('종목 구역', () => {
  it('그룹을 고르면 그 그룹으로 바뀐다', async () => {
    const { app } = setup();
    await openSection('종목');
    await fireEvent.click(screen.getByRole('button', { name: '2차전지' }));
    await settle();
    expect(saved(app).universe).toEqual({ kind: 'group', groupId: 'g2' });
    expect(screen.getByText('2차전지 · 1종목')).toBeTruthy();
  });

  it('직접 고르기는 지금 그룹의 종목을 가져오고 종목 추가 시트로 더한다', async () => {
    const { app } = setup();
    await openSection('종목');
    await fireEvent.click(screen.getByRole('radio', { name: '직접 고르기' }));
    await settle();
    expect(saved(app).universe).toEqual({ kind: 'symbols', symbols: ['005930', '000660'] });
    await fireEvent.click(screen.getByRole('button', { name: '＋ 종목 추가' }));
    await fireEvent.input(screen.getByRole('searchbox', { name: '종목 검색' }), { target: { value: '삼성전기' } });
    await fireEvent.click(await screen.findByRole('button', { name: '삼성전기 추가' }));
    await settle();
    expect(saved(app).universe).toEqual({ kind: 'symbols', symbols: ['005930', '000660', '009150'] });
    expect(app.watchlists.groups[0].items).toHaveLength(2); // 관심 그룹은 건드리지 않는다
  });

  it('8종목이 차 있으면 추가 대신 스낵바', async () => {
    const eight = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8'];
    const { app } = setup((s) => {
      s.universe = { kind: 'symbols', symbols: eight };
    });
    await openSection('종목');
    await fireEvent.click(screen.getByRole('button', { name: '＋ 종목 추가' }));
    await fireEvent.input(screen.getByRole('searchbox', { name: '종목 검색' }), { target: { value: '삼성전기' } });
    await fireEvent.click(await screen.findByRole('button', { name: '삼성전기 추가' }));
    expect(currentSnackbar()?.message).toBe('8종목까지 넣을 수 있어요');
    await settle();
    expect(saved(app).universe).toEqual({ kind: 'symbols', symbols: eight });
  });

  it('종목을 뺄 수 있다', async () => {
    const { app } = setup((s) => {
      s.universe = { kind: 'symbols', symbols: ['005930', '000660'] };
    });
    await openSection('종목');
    await fireEvent.click(await screen.findByRole('button', { name: '삼성전자 빼기' }));
    await settle();
    expect(saved(app).universe).toEqual({ kind: 'symbols', symbols: ['000660'] });
  });
});

describe('비교 기준 구역', () => {
  it('지수와 비교 종목을 바꾼다', async () => {
    const { app } = setup();
    await openSection('비교 기준');
    await fireEvent.click(screen.getByRole('radio', { name: 'KOSDAQ' }));
    await fireEvent.click(screen.getByRole('button', { name: '종목 바꾸기' }));
    await fireEvent.input(screen.getByRole('searchbox', { name: '종목 검색' }), { target: { value: '삼성전자' } });
    await fireEvent.click(await screen.findByRole('button', { name: '삼성전자 선택' }));
    await settle();
    expect(saved(app).benchmarks).toEqual({ index: 'KOSDAQ', symbol: '005930' });
    await fireEvent.click(screen.getByRole('button', { name: '비교 종목 지우기' }));
    await settle();
    expect(saved(app).benchmarks.symbol).toBeNull();
  });
});

describe('기간·비용 구역', () => {
  it('날짜는 date 입력이고 바꾸면 저장된다', async () => {
    const { app } = setup();
    await openSection('기간·자금');
    const from = screen.getByLabelText('시작일') as HTMLInputElement;
    expect(from.type).toBe('date');
    await fireEvent.change(from, { target: { value: '2024-01-02' } });
    await settle();
    expect(saved(app).period.from).toBe('2024-01-02');
  });

  it('시작일이 종료일 이후면 Banner', async () => {
    setup((s) => {
      s.period = { from: '2026-10-01', to: '2026-09-01' };
    });
    await openSection('기간·자금');
    expect(screen.getByText('시작일이 종료일보다 앞이어야 해요')).toBeTruthy();
  });

  it('수수료를 바꾼다', async () => {
    const { app } = setup();
    await openSection('비용');
    await fireEvent.input(screen.getByRole('textbox', { name: '수수료' }), { target: { value: '0.1' } });
    await settle();
    expect(saved(app).costs.feePct).toBe(0.1);
  });
});

describe('머리줄', () => {
  it('복제는 사본을 저장하고 주소를 새 id로 바꾼다', async () => {
    const { app } = setup();
    await fireEvent.click(screen.getByRole('button', { name: '복제' }));
    expect(app.strategies.map((s) => s.name)).toEqual(['눌림목', '눌림목 사본']);
    const copy = app.strategies[1];
    expect(copy.id).not.toBe('s1');
    expect(location.hash).toBe(`#/simulate/${copy.id}`);
    expect(app.route).toEqual({ name: 'simulate', strategyId: copy.id });
  });

  it('이름을 고치면 저장되고, 비우면 저장하지 않는다', async () => {
    const { app } = setup();
    const name = screen.getByRole('textbox', { name: '전략 이름' });
    await fireEvent.input(name, { target: { value: '' } });
    await fireEvent.input(name, { target: { value: '반등 매매' } });
    await settle();
    expect(saved(app).name).toBe('반등 매매');
  });
});

describe('PatternHelp', () => {
  it('전 고점이 뭔가요? 를 누르면 A·B·L 그림이 펼쳐진다', async () => {
    setup();
    await openSection('매수');
    expect(screen.queryByRole('img')).toBeNull();
    const toggle = screen.getByRole('button', { name: '전 고점이 뭔가요?' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await fireEvent.click(toggle);
    const img = screen.getByRole('img');
    expect(img.getAttribute('aria-label')).toMatch(/A.*B.*L/);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });
});
