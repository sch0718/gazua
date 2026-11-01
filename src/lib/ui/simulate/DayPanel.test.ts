// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { newStrategy } from '../../sim/defaults';
import type { DayFrame, HoldingFrame, Skip, Strategy, Trade } from '../../sim/types';
import { expectNoAxeViolations } from '../../share/testAxe';
import DayPanel from './DayPanel.svelte';
import HoldingCard from './HoldingCard.svelte';

const names = { '005930': '삼성전자', '000660': 'SK하이닉스' };
const holding = (over: Partial<HoldingFrame> = {}): HoldingFrame => ({
  symbol: '005930',
  qty: 14,
  avgPrice: 70_000,
  close: 71_000,
  value: 994_000,
  pnlPct: (71_000 / 70_000 - 1) * 100,
  stop: 66_500,
  trail: null,
  nextAdd: 67_900,
  takes: [{ stage: 1, price: 73_500 }, { stage: 2, price: 77_000 }],
  openDate: '2023-10-12',
  heldDays: 1,
  ...over,
});
const frame = (over: Partial<DayFrame> = {}): DayFrame => ({ date: '2023-10-12', cash: 9_000_000, value: 10_100_000, holdings: [], pending: [], pendingSells: [], ...over });
const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim();
const panel = (over: { frame?: DayFrame; trades?: Trade[]; skipped?: Skip[]; strategy?: Strategy } = {}) =>
  render(DayPanel, { frame: frame(), trades: [], skipped: [], names, initial: 10_000_000, strategy: newStrategy(0, null), ...over });

describe('DayPanel', () => {
  it('머리: 날짜(요일) · 총자산 · 현금(비중) · 그날까지 수익률', () => {
    panel();
    const region = screen.getByRole('region', { name: '그날 상황' });
    expect(within(region).getByText('2023.10.12(목)')).toBeTruthy();
    const totals = within(region).getByRole('list', { name: '그날 자산' });
    expect(within(totals).getAllByRole('listitem').map(text)).toEqual(['총자산 10,100,000원', '현금 9,000,000원 (89%)', '그날까지 수익률 ▲ +1.0%']);
  });

  it('보유가 없으면 「보유한 종목이 없어요」', () => {
    panel();
    expect(screen.getByText('보유한 종목이 없어요')).toBeTruthy();
    expect(screen.queryByRole('list', { name: '보유 종목' })).toBeNull();
  });

  it('보유 카드: 종목명·수익률·수량·평단·종가·평가액·보유 시작, 가격 눈금과 「다음 거래일 기준」', () => {
    panel({ frame: frame({ holdings: [holding()] }) });
    expect(screen.queryByText('보유한 종목이 없어요')).toBeNull();
    const card = screen.getByRole('article', { name: '삼성전자' });
    expect(text(card.querySelector('.top'))).toBe('삼성전자 ▲ +1.4%');
    expect([...card.querySelectorAll('.facts > div')].map(text)).toEqual(['수량 14주', '평단 70,000원', '종가 71,000원', '평가액 994,000원', '보유 시작 2023.10.12']);
    expect(within(card).getAllByRole('listitem').map(text)).toEqual(['손절 66,500원', '다음 추가 67,900원', '평단 70,000원', '익절 1 73,500원', '익절 2 77,000원']);
    expect(within(card).getByText('다음 거래일 기준')).toBeTruthy();
    expect(within(card).queryByText('손절: 분할 매수 끝나면 정해져요')).toBeNull();
  });

  it('손절이 null이면 안내 문구, 다음 추가가 null이면 그 눈금만 뺀다', () => {
    panel({ frame: frame({ holdings: [holding({ stop: null, nextAdd: null })] }) });
    const card = screen.getByRole('article', { name: '삼성전자' });
    expect(within(card).getByText('손절: 분할 매수 끝나면 정해져요')).toBeTruthy();
    expect(within(card).getAllByRole('listitem').map(text)).toEqual(['평단 70,000원', '익절 1 73,500원', '익절 2 77,000원']);
  });

  it('예약 매수 · 그날 체결 · 그날 건너뜀(사유별)', () => {
    const trades: Trade[] = [
      { date: '2023-10-12', symbol: '005930', kind: 'buy', price: 70_000, qty: 14, fee: 147, tax: 0, reason: 'B 돌파' },
      { date: '2023-10-12', symbol: '000660', kind: 'take', stage: 1, price: 80_500, qty: 12, fee: 1, tax: 0, reason: '1단계 익절 80%', pnlPct: 15 },
    ];
    const skipped: Skip[] = [
      { date: '2023-10-12', symbol: '000660', reason: '현금 부족' },
      { date: '2023-10-12', symbol: '005930', reason: '현금 부족' },
    ];
    panel({ frame: frame({ pending: [{ symbol: '005930', reason: '3일 연속 상승' }] }), trades, skipped });
    expect(within(screen.getByRole('list', { name: '예약 매수' })).getAllByRole('listitem').map(text)).toEqual(['다음 거래일 시가에 사요: 삼성전자 — 3일 연속 상승']);
    expect(within(screen.getByRole('list', { name: '그날 체결' })).getAllByRole('listitem').map(text)).toEqual([
      '삼성전자 · B 돌파 매수 · 14주 · 70,000원',
      'SK하이닉스 · 1단계 익절(80% 매도) · 12주 · 80,500원',
    ]);
    expect(within(screen.getByRole('list', { name: '그날 건너뜀' })).getAllByRole('listitem').map(text)).toEqual(['현금이 모자랐어요 · SK하이닉스, 삼성전자']);
  });

  it('체결·건너뜀·예약이 없으면 그 목록을 그리지 않는다', () => {
    panel();
    for (const name of ['예약 매수', '그날 체결', '그날 건너뜀']) expect(screen.queryByRole('list', { name })).toBeNull();
  });

  it('axe 위반이 없다', async () => {
    const { container } = panel({
      frame: frame({ holdings: [holding(), holding({ symbol: '000660', stop: null })], pending: [{ symbol: '005930', reason: 'B 돌파' }] }),
      trades: [{ date: '2023-10-12', symbol: '005930', kind: 'add', price: 68_000, qty: 3, fee: 1, tax: 0, reason: '추가 매수' }],
      skipped: [{ date: '2023-10-12', symbol: '000660', reason: '거래 없음' }],
    });
    await expectNoAxeViolations(container);
  });

  it('motion이면 보유가 0에서 1로 바뀌어 목록이 새로 생길 때도 떠오름 효과가 돈다(|global)', async () => {
    // jsdom에는 Web Animations가 없다. Svelte 전환이 부르는 element.animate를 스텁으로 센다
    const anim = { cancel() {}, finish() {}, play() {}, pause() {}, onfinish: null as null | (() => void), currentTime: 0 };
    const animate = vi.fn(() => anim);
    const had = 'animate' in Element.prototype;
    const orig = (Element.prototype as { animate?: unknown }).animate;
    (Element.prototype as { animate?: unknown }).animate = animate;
    try {
      const { rerender } = panel({ frame: frame() });
      await rerender({ frame: frame({ holdings: [holding()] }), trades: [], skipped: [], names, initial: 10_000_000, strategy: newStrategy(0, null), motion: true });
      await vi.waitFor(() => expect(animate.mock.calls.length).toBeGreaterThan(0));
    } finally {
      if (had) (Element.prototype as { animate?: unknown }).animate = orig;
      else delete (Element.prototype as { animate?: unknown }).animate;
    }
  });
});

describe('HoldingCard 가격 막대', () => {
  it('눈금·점 위치는 %로, 막대는 화면 낭독기에서 숨긴다', () => {
    const { container } = render(HoldingCard, { h: holding({ stop: 95, nextAdd: null, avgPrice: 100, takes: [{ stage: 1, price: 105 }, { stage: 2, price: 110 }], close: 102 }), name: '삼성전자', stopOn: true, timeExitDays: null });
    const bar = container.querySelector('.bar')!;
    expect(bar.getAttribute('aria-hidden')).toBe('true');
    const left = (sel: string) => parseFloat((bar.querySelector(sel) as HTMLElement).style.left);
    expect(left('.tick.stop')).toBeCloseTo((0.75 / 16.5) * 100, 6);
    expect(left('.dot')).toBeCloseTo((7.75 / 16.5) * 100, 6);
    expect(bar.querySelectorAll('.tick')).toHaveLength(4);
    expect(bar.classList.contains('slide')).toBe(false);
  });

  it('motion이면 점이 미끄러지는 클래스를 단다', () => {
    const { container } = render(HoldingCard, { h: holding(), name: '삼성전자', stopOn: true, timeExitDays: null, motion: true });
    expect(container.querySelector('.bar')!.classList.contains('slide')).toBe(true);
  });
});

describe('전략 빌더 표시', () => {
  it('예약 매도·손절 꺼짐·기간 청산 남은 날', () => {
    const strategy = newStrategy(0, null);
    strategy.rules.sell.stopLoss.on = false;
    strategy.rules.sell.timeExit = { on: true, days: 20 };
    panel({ frame: frame({ holdings: [holding({ stop: null, trail: null, heldDays: 3 })], pendingSells: [{ symbol: '005930', reason: '보유 20일 청산' }] }), strategy });
    expect(screen.getByText('다음 거래일 시가에 팔아요: 삼성전자 — 보유 20일 청산')).toBeTruthy();
    expect(screen.getByText('손절 꺼짐')).toBeTruthy();
    expect(screen.getByText('보유 3거래일째 · 17일 뒤 청산')).toBeTruthy();
  });
});
