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
import editorSectionSource from './editor/EditorSection.svelte?raw';
import periodSource from './editor/PeriodSection.svelte?raw';
import numberFieldSource from './editor/NumberField.svelte?raw';
import entrySource from './editor/EntrySection.svelte?raw';

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
  it('openRequest로 지정한 구역이 열린다(자금은 기간·자금), 같은 요청 번호는 다시 열지 않는다', async () => {
    const { view } = setup();
    expect(header('기간·자금').getAttribute('aria-expanded')).toBe('false');
    await view.rerender({ openRequest: { section: 'capital', seq: 1 } });
    expect(header('기간·자금').getAttribute('aria-expanded')).toBe('true');
    expect(header('매수').getAttribute('aria-expanded')).toBe('false');
    await openSection('기간·자금'); // 사용자가 접는다
    await view.rerender({ openRequest: { section: 'capital', seq: 1 } });
    expect(header('기간·자금').getAttribute('aria-expanded')).toBe('false');
    await view.rerender({ openRequest: { section: 'capital', seq: 2 } });
    expect(header('기간·자금').getAttribute('aria-expanded')).toBe('true');
  });

  it('seven collapsed sections in spec order with one-line summaries', async () => {
    setup();
    const heads = screen.getAllByRole('button').filter((b) => b.hasAttribute('aria-expanded'));
    expect(heads.map((b) => b.querySelector('b')?.textContent)).toEqual(TITLES);
    expect(heads.every((b) => b.getAttribute('aria-expanded') === 'false')).toBe(true);
    expect(screen.getByText('반도체 · 2종목')).toBeTruthy();
    expect(screen.getByText('고점 대비 10% 하락 뒤 → 3일 연속 상승 또는 B 돌파')).toBeTruthy();
    expect(screen.getByText('끔')).toBeTruthy();
    expect(screen.getByText('익절 +15%에 전량 · 손절 −5%')).toBeTruthy();
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByText('같은 종목 사서 보유 · KOSPI · KODEX 200')).toBeTruthy(); // 유니버스에서 이름을 찾는다
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
    expect(screen.getByText('고점 대비 10% 하락 뒤 → 3일 연속 상승 또는 A 돌파')).toBeTruthy();
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
    const banner = screen.getByText('사는 신호가 하나도 켜져 있지 않아요. ②에서 하나 이상 켜 주세요').closest('[tabindex="-1"]') as HTMLElement;
    expect(banner).toBeTruthy();
    expect(document.activeElement).toBe(banner);
  });

  it('구역 안 경고 Banner는 라이브 영역이 아니다(펼칠 때마다 다시 알리지 않고, 막힌 실행은 포커스로 읽힌다)', async () => {
    setup((s) => {
      s.scaleIn.on = true;
      s.capital.perBuyPct = 40; // 자금 경고가 두 구역에
    });
    await openSection('기간·자금');
    await openSection('분할 매수');
    expect(screen.getAllByText('모든 종목이 한꺼번에 사면 현금이 모자라요. 신호 일부를 건너뛸 수 있어요')).toHaveLength(2);
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.queryAllByRole('status')).toHaveLength(0);
  });

  it('id가 숫자로 시작하는 난수여도 Banner로 포커스를 옮긴다', async () => {
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.05); // base36 "0.1w…" -> 숫자로 시작
    const { onRun } = setup((s) => {
      s.entry.triggers.reboundDays.on = s.entry.triggers.breakout.on = false;
    });
    rnd.mockRestore();
    await fireEvent.click(screen.getByRole('button', { name: '시뮬레이션 실행' }));
    expect(onRun).not.toHaveBeenCalled();
    const banner = screen.getByText('사는 신호가 하나도 켜져 있지 않아요. ②에서 하나 이상 켜 주세요').closest('[tabindex="-1"]') as HTMLElement;
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

describe('편집 행 (설정 .row 패턴)', () => {
  const field = (name: string) => screen.getByRole('textbox', { name }).closest('.field') as HTMLElement;

  it('라벨을 누르면 같은 줄의 토글이 바뀐다', async () => {
    const { app } = setup();
    await openSection('매수');
    const sw = screen.getByRole('switch', { name: '고점 대비 하락폭 사용' });
    expect(sw.getAttribute('aria-checked')).toBe('true');
    await fireEvent.click(screen.getByText('고점 대비 하락폭', { selector: 'label' }));
    expect(sw.getAttribute('aria-checked')).toBe('false');
    await fireEvent.click(screen.getByText('골든크로스', { selector: 'label' }));
    expect(screen.getByRole('switch', { name: '골든크로스 사용' }).getAttribute('aria-checked')).toBe('true');
    await settle();
    expect(saved(app).entry.decline.dropPct.on).toBe(false);
    expect(saved(app).entry.triggers.goldenCross.on).toBe(true);
  });

  it('토글 이름은 그 줄의 보이는 라벨 + 사용(WCAG 2.5.3 이름 안의 라벨)', async () => {
    setup((s) => (s.scaleIn.on = true));
    await openSection('매수');
    await openSection('분할 매수');
    const switches = screen.getAllByRole('switch');
    expect(switches.map((sw) => sw.getAttribute('aria-label'))).toEqual([
      '고점 대비 하락폭 사용',
      '고점 뒤 지난 거래일 사용',
      '저점 뒤 연속 상승 사용',
      '전 고점 돌파 사용',
      '이동평균선 돌파 사용',
      '골든크로스 사용',
      '종가가 이동평균선 위 사용',
      '분할 매수 사용',
    ]);
    // 이름은 연결된 보이는 라벨로 시작한다
    for (const sw of switches) {
      const label = document.querySelector(`label[for="${sw.id}"]`)?.textContent?.trim();
      expect(label, sw.id).toBeTruthy();
      expect(sw.getAttribute('aria-label')).toBe(`${label} 사용`);
    }
  });

  it('익절 단계 칸 이름은 단계 + 라벨(1단계 목표 · 1단계 파는 양)', async () => {
    setup((s) => {
      s.exit.takeProfit = [{ pct: 15, sellPct: 50 }, { pct: 25, sellPct: 100 }];
    });
    await openSection('매도');
    expect(screen.getByRole('textbox', { name: '1단계 목표' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '1단계 파는 양' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '2단계 목표' })).toBeTruthy();
    // 보이는 라벨은 그대로
    expect(screen.getAllByText('목표', { selector: 'label' })).toHaveLength(2);
  });

  it('숫자 칸은 단위·금액 힌트·오류를 설명(aria-describedby)으로 읽힌다', async () => {
    setup();
    await openSection('기간·자금');
    const described = (el: HTMLElement) =>
      (el.getAttribute('aria-describedby') ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent?.trim());
    const cap = screen.getByRole('textbox', { name: '처음 자금' });
    expect(described(cap)).toEqual(['원', '= 1,000만 원']);
    const per = screen.getByRole('textbox', { name: '회당 매수 비중' });
    expect(described(per)).toEqual(['% (처음 자금 대비)']);
    await fireEvent.input(per, { target: { value: '0' } });
    expect(described(per)).toEqual(['% (처음 자금 대비)', '1~100 사이로 적어 주세요']);
  });

  it('꺼진 조건의 숫자 칸·A/B 세그먼트·골든크로스 칸은 muted, 입력은 그대로 된다', async () => {
    const { app } = setup((s) => {
      s.entry.triggers.breakout.on = false;
    });
    await openSection('매수');
    expect(field('고점 대비 하락폭').classList.contains('muted')).toBe(false);
    expect(field('고점 뒤 지난 거래일').classList.contains('muted')).toBe(true); // 기본 끔
    expect(field('짧은 이동평균').classList.contains('muted')).toBe(true);
    expect(field('긴 이동평균').classList.contains('muted')).toBe(true);
    expect(screen.getByRole('radiogroup', { name: '전 고점' }).closest('.muted')).toBeTruthy();
    const days = screen.getByRole('textbox', { name: '고점 뒤 지난 거래일' }) as HTMLInputElement;
    expect(days.disabled).toBe(false);
    await fireEvent.input(days, { target: { value: '12' } });
    await settle();
    expect(saved(app).entry.decline.days.value).toBe(12);

    await fireEvent.click(screen.getByRole('switch', { name: '전 고점 돌파 사용' }));
    expect(screen.getByRole('radiogroup', { name: '전 고점' }).closest('.muted')).toBeNull();
  });

  it('muted는 투명도로 흐리지 않는다: 박스 배경·테두리만 낮추고 글자는 --t3(AA)', () => {
    // jsdom은 컴포넌트 스타일을 계산하지 않으므로 소스의 규칙을 읽는다. 실제 대비는 e2e a11y가 잰다.
    const rules = (src: string) => [...src.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]*\.muted[^{}]*)\{([^}]*)\}/g)].map((m) => [m[1].trim(), m[2]] as const);
    for (const [sel, body] of [...rules(numberFieldSource), ...rules(entrySource)]) expect(body, sel).not.toMatch(/opacity/);
    const box = rules(numberFieldSource).find(([sel]) => /^\.muted \.box$/.test(sel))?.[1] ?? '';
    expect(box).toMatch(/background:\s*transparent/);
    expect(box).toMatch(/border-color:\s*var\(--line\)/);
    const text = rules(numberFieldSource).find(([sel]) => sel.includes('.muted input') && sel.includes('.muted .suffix'))?.[1] ?? '';
    expect(text).toMatch(/color:\s*var\(--t3\)/);
    const seg = rules(entrySource).find(([sel]) => sel.includes('.seg'))?.[1] ?? '';
    expect(seg).toMatch(/color:\s*var\(--t3\)/);
  });

  it('숫자 칸의 박스는 입력과 연결된 label(for)이고 입력은 num', async () => {
    setup();
    await openSection('매도');
    const input = screen.getByRole('textbox', { name: '손절폭' }) as HTMLInputElement;
    const box = input.closest('.box') as HTMLLabelElement;
    expect(box.tagName).toBe('LABEL');
    expect(box.htmlFor).toBe(input.id);
    expect(input.classList.contains('num')).toBe(true);
    // jsdom은 label 클릭으로 글자 입력에 포커스를 옮기지 않는다. 실제 포커스는 e2e(simulate.spec)에서 본다.
  });

  it('금액 칸은 포커스가 없을 때 천 단위로 보이고 아래에 = 만 원 힌트', async () => {
    const { app } = setup();
    await openSection('기간·자금');
    const cap = screen.getByRole('textbox', { name: '처음 자금' }) as HTMLInputElement;
    expect(cap.value).toBe('10,000,000');
    expect(screen.getByText('= 1,000만 원')).toBeTruthy();
    await fireEvent.focus(cap);
    expect(cap.value).toBe('10000000');
    await fireEvent.input(cap, { target: { value: '15000000' } });
    expect(screen.getByText('= 1,500만 원')).toBeTruthy();
    await fireEvent.blur(cap);
    expect(cap.value).toBe('15,000,000');
    await settle();
    expect(saved(app).capital.initial).toBe(15_000_000);
  });

  it('금액 칸 범위 오류의 최소·최대도 천 단위로', async () => {
    setup();
    await openSection('기간·자금');
    const cap = screen.getByRole('textbox', { name: '처음 자금' });
    await fireEvent.focus(cap);
    await fireEvent.input(cap, { target: { value: '0' } });
    expect(screen.getByText('1~10,000,000,000,000 사이로 적어 주세요')).toBeTruthy();
  });

  it('정수 칸에 소수를 적으면 정수로 적어 주세요', async () => {
    const { app } = setup();
    await openSection('매수');
    await fireEvent.input(screen.getByRole('textbox', { name: '저점 뒤 연속 상승' }), { target: { value: '3.5' } });
    expect(screen.getByText('정수로 적어 주세요')).toBeTruthy();
    await settle();
    expect(saved(app).entry.triggers.reboundDays.value).toBe(3);
  });

  it('기간·자금 문구: 회당 매수 비중 · % (처음 자금 대비), 날짜 칸은 카드 안에 맞춘다', async () => {
    setup();
    await openSection('기간·자금');
    expect(screen.getByRole('textbox', { name: '회당 매수 비중' })).toBeTruthy();
    expect(screen.getByText('% (처음 자금 대비)')).toBeTruthy();
    const dates = /\.dates\s*\{([^}]*)\}/.exec(periodSource)?.[1] ?? '';
    expect(dates).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/);
    const input = /\binput\s*\{([^}]*)\}/.exec(periodSource)?.[1] ?? '';
    expect(input).toMatch(/width:\s*100%/);
    expect(input).toMatch(/min-width:\s*0/);
  });
});

describe('구역 머리', () => {
  it('막는 경고는 !와 sr-only `· 고쳐야 실행돼요`, 비차단 경고는 △와 `· 확인할 점이 있어요`', async () => {
    setup((s) => {
      s.entry.triggers.reboundDays.on = s.entry.triggers.breakout.on = false;
      s.exit.stopLoss.basis = 'avgAlways';
      s.scaleIn = { on: true, stepPct: 6, maxAdds: 1 };
    });
    const entry = header('매수');
    expect(entry.querySelector('.flag')?.textContent).toBe('!');
    expect(entry.querySelector('.sr-only')?.textContent).toBe('· 고쳐야 실행돼요');
    const exit = header('매도');
    expect(exit.querySelector('.flag')?.textContent).toBe('△');
    expect(exit.querySelector('.sr-only')?.textContent).toBe('· 확인할 점이 있어요');
    expect(header('비용').querySelector('.flag')).toBeNull();
    expect(header('비용').querySelector('.sr-only')).toBeNull();
  });

  it('접혀 있으면 aria-controls가 없고, 펼치면 본문을 가리킨다', async () => {
    setup();
    const h = header('비용');
    expect(h.hasAttribute('aria-controls')).toBe(false);
    await openSection('비용');
    const id = h.getAttribute('aria-controls');
    expect(id).toBeTruthy();
    expect(document.getElementById(id!)).toBeTruthy();
  });

  it('셰브런은 회전하는 ▾ 하나, 열리면 open 클래스', async () => {
    setup();
    const chev = () => header('비용').querySelector('.chev')!;
    expect(chev().textContent).toBe('▾');
    expect(chev().classList.contains('open')).toBe(false);
    await openSection('비용');
    expect(chev().textContent).toBe('▾');
    expect(chev().classList.contains('open')).toBe(true);
    expect(/\.chev\s*\{([^}]*)\}/.exec(editorSectionSource)?.[1]).toMatch(/grid-column:\s*-2\s*\/\s*-1/);
    expect(/\.chev\.open\s*\{([^}]*)\}/.exec(editorSectionSource)?.[1]).toMatch(/rotate\(180deg\)/);
  });

  it('요약은 숫자 정렬(num)', () => {
    setup();
    expect(header('기간·자금').querySelector('.sum')!.classList.contains('num')).toBe(true);
  });
});

describe('자금 경고 위치', () => {
  const msg = '모든 종목이 한꺼번에 사면 현금이 모자라요. 신호 일부를 건너뛸 수 있어요';

  it('분할 매수가 켜져 있으면 기간·자금과 분할 매수 두 구역 모두에 보인다', async () => {
    setup((s) => {
      s.capital.perBuyPct = 30;
      s.scaleIn = { on: true, stepPct: 3, maxAdds: 2 }; // 30 × 3 × 2종목 = 180
    });
    expect(header('기간·자금').querySelector('.flag')?.textContent).toBe('△');
    expect(header('분할 매수').querySelector('.flag')?.textContent).toBe('△');
    await openSection('기간·자금');
    await openSection('분할 매수');
    const banners = screen.getAllByText(msg).map((el) => el.closest('.banner') as HTMLElement);
    expect(banners).toHaveLength(2);
    expect(new Set(banners.map((b) => b.id)).size).toBe(2); // id가 겹치지 않는다
  });

  it('분할 매수가 꺼져 있으면 기간·자금에만', async () => {
    setup((s) => {
      s.capital.perBuyPct = 60; // 60 × 1 × 2종목 = 120
    });
    expect(header('분할 매수').querySelector('.flag')).toBeNull();
    await openSection('기간·자금');
    await openSection('분할 매수');
    expect(screen.getAllByText(msg)).toHaveLength(1);
  });
});

describe('매도 구역 문구·삭제', () => {
  it('손절 기준 라벨과 평단 힌트', async () => {
    setup();
    await openSection('매도');
    for (const name of ['분할 후 평단', '매번 평단', '첫 매수가']) expect(screen.getByRole('radio', { name })).toBeTruthy();
    expect(screen.getByText('평단 = 평균 매수가예요. 분할 매수를 끄면 세 기준이 같아요')).toBeTruthy();
  });

  it('구역 표시(!·△)와 .act 버튼 글자 크기는 토큰', () => {
    const css = editorSectionSource.slice(editorSectionSource.indexOf('<style>'));
    expect(css).not.toMatch(/font-size:\s*\d+px/);
    expect(/\.flag\s*\{([^}]*)\}/.exec(css)?.[1]).toMatch(/font-size:\s*var\(--fs-sub\)/);
    expect(/\.flag\.blocked\s*\{([^}]*)\}/.exec(css)?.[1]).toMatch(/font-size:\s*var\(--fs-label\)/);
    expect(/:global\(\.act\)\s*\{([^}]*)\}/.exec(css)?.[1]).toMatch(/font-size:\s*var\(--fs-sub\)/);
  });

  it('익절 단계 삭제는 단계 제목 줄 끝의 ✕(--err)', async () => {
    setup((s) => {
      s.exit.takeProfit = [{ pct: 15, sellPct: 50 }, { pct: 25, sellPct: 100 }];
    });
    await openSection('매도');
    const del = screen.getByRole('button', { name: '2단계 삭제' });
    expect(del.textContent?.trim()).toBe('✕');
    expect(del.classList.contains('x')).toBe(true);
    expect(del.classList.contains('danger')).toBe(true);
    expect(del.closest('.stage-title')?.textContent).toContain('2단계');
    expect(/:global\(\.x\.danger\)\s*\{([^}]*)\}/.exec(editorSectionSource)?.[1]).toMatch(/color:\s*var\(--err\)/);
    expect(/:global\(\.act\.danger\)\s*\{([^}]*)\}/.exec(editorSectionSource)?.[1]).toMatch(/color:\s*var\(--err\)/);
    expect(editorSectionSource).not.toMatch(/var\(--down\)/);
  });

  it('카드 안 세그먼트는 onSurface 변형', async () => {
    setup();
    await openSection('매도');
    expect(screen.getByRole('radiogroup', { name: '손절 기준 가격' }).classList.contains('on-surface')).toBe(true);
    expect(screen.getByRole('radiogroup', { name: '1단계 익절 뒤 손절선' }).classList.contains('on-surface')).toBe(true);
    await openSection('매수');
    expect(screen.getByRole('radiogroup', { name: '전 고점' }).classList.contains('on-surface')).toBe(true);
    await openSection('종목');
    expect(screen.getByRole('radiogroup', { name: '종목 고르는 방법' }).classList.contains('on-surface')).toBe(true);
    await openSection('비교 기준');
    expect(screen.getByRole('radiogroup', { name: '비교 지수' }).classList.contains('on-surface')).toBe(true);
  });
});

describe('저장 시점', () => {
  it('pagehide에서 저장 대기분을 바로 저장한다', async () => {
    const { app } = setup();
    const spy = vi.spyOn(app, 'setStrategies');
    await fireEvent.input(screen.getByRole('textbox', { name: '전략 이름' }), { target: { value: '숨김 전' } });
    expect(spy).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('pagehide'));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(saved(app).name).toBe('숨김 전');
  });
});

describe('PatternHelp 문구', () => {
  it('A는 마지막으로 전량 판 뒤(처음이면 기간 시작부터)', async () => {
    setup();
    await openSection('매수');
    await fireEvent.click(screen.getByRole('button', { name: '전 고점이 뭔가요?' }));
    expect(screen.getByText(/마지막으로 전량 판 뒤\(처음이면 기간 시작부터\)/)).toBeTruthy();
  });
});
