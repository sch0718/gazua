// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lwcCharts, resetLwcStub, ResizeObserverStub } from '../../chart/lwcStub';
import { makeTestApp } from '../../../sheets/testApp';
import type { ValidationResult as Result } from '../../screen/runValidation';
import { NOW } from '../../screen/testData';
import type { App } from '../../state/app.svelte';
import { stats, validationResult } from './resultFixture';
import ValidationResult from './ValidationResult.svelte';

vi.mock('lightweight-charts', async () => (await import('../../chart/lwcStub')).lwcModule());

let apps: App[] = [];
function setup(result: Result = validationResult(), names: Record<string, string> = {}, extra: { macro?: { used: boolean; lookback?: { usdkrw?: number; wti?: number } } } = {}) {
  const app = makeTestApp({ groups: [{ id: 'g1', name: '반도체', items: [] }], now: NOW });
  apps.push(app);
  render(ValidationResult, { app, result, names, criteriaName: '반등 기준', capital: 10_000_000, ...extra });
  return app;
}
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  resetLwcStub();
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const a of apps) a.destroy();
  apps = [];
});

const card = (id: string) => document.querySelector<HTMLElement>(`[data-card="${id}"]`)!;
// 텍스트 조각을 공백으로 이어 붙인다(블록·플렉스 사이는 공백이 없어도 눈에는 떨어져 보인다)
function squash(el: Element): string {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const out: string[] = [];
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const t = n.textContent!.replace(/\s+/g, ' ').trim();
    if (t) out.push(t);
  }
  return out.join(' ');
}

describe('ValidationResult', () => {
  it('sections come in the spec order: picks, summary, curve, markets, history, help', () => {
    setup();
    const heads = [...document.querySelectorAll('h3')].map((h) => h.textContent);
    expect(heads).toEqual(['오늘 기준 선별', '요약', '자산 곡선', '시장별 보기', '선정 이력']);
    const help = document.querySelector('.help')!;
    expect(help.compareDocumentPosition(document.querySelector('#hist-h')!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it('summary cards: ① with the beat count, KOSPI, ETF; each with total, CAGR, drawdown and vs index', () => {
    setup();
    expect(squash(card('hold'))).toBe('① 선정만 ▲ +12.3% 연환산 +6.2% · 최대 낙폭 −10.0% 지수 대비 ▲ +4.3%p 지수보다 나은 구간 1/2');
    expect(squash(card('idx-KOSPI'))).toBe('KOSPI ▲ +8.1% 연환산 +4.0% · 최대 낙폭 −10.0%');
    expect(squash(card('etf-069500'))).toContain('KODEX 200 ▲ +5.0%');
    expect(squash(card('etf-069500'))).toContain('지수 대비 ▼ −3.1%p');
    expect(card('hold').querySelector('b.up')).toBeTruthy();
  });

  it('card order is ①, ② (or its notice), indices, ETFs', () => {
    setup();
    expect([...document.querySelectorAll('[data-card]')].map((c) => (c as HTMLElement).dataset.card)).toEqual(['hold', 'trading', 'idx-KOSPI', 'etf-069500']);
    document.body.innerHTML = '';
    setup(validationResult({ trading: { curve: [{ date: '2026-01-05', value: 1e7 }], stats: stats(-4), trades: 5, skipCounts: {} } }));
    expect([...document.querySelectorAll('[data-card]')].map((c) => (c as HTMLElement).dataset.card)).toEqual(['hold', 'trading', 'idx-KOSPI', 'etf-069500']);
  });

  it('without ② the card says 매매 규칙을 고르면 함께 볼 수 있어요', () => {
    setup();
    expect(squash(card('trading'))).toBe('② 선정 + 매매 규칙 매매 규칙을 고르면 함께 볼 수 있어요');
  });

  it('with ② its own card appears instead', () => {
    setup(validationResult({ trading: { curve: [{ date: '2026-01-05', value: 1e7 }], stats: stats(-4), trades: 5, skipCounts: {} } }));
    expect(screen.queryByText('매매 규칙을 고르면 함께 볼 수 있어요')).toBeNull();
    expect(squash(card('trading'))).toContain('▼ −4.0%');
  });

  it('a comparison without a curve says why', () => {
    setup(validationResult({ benchmarks: [{ symbol: '069500', name: '069500', curve: null, reason: '받지 못했어요', stats: null }] }));
    expect(squash(card('etf-069500'))).toBe('069500 받지 못했어요');
  });

  it('market table has 3 rows and marks the original pool', () => {
    setup();
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.querySelector('th')!.textContent!.replace('원래 범위', '|원래 범위').trim())).toEqual(['KOSPI 주식|원래 범위', 'KOSDAQ 주식|원래 범위', 'ETF']);
    expect(squash(rows[0])).toBe('KOSPI 주식 원래 범위 ▲ +10.0% −10.0% 4.3개 ▲ +2.0%p');
    expect(squash(rows[1])).toContain('▼ −2.5%');
  });

  it('each not-bought reason has its own label on the stock row it belongs to', () => {
    setup();
    const rows = [...document.querySelectorAll('.picks li')].slice(0, 7);
    const flag = (i: number) => squash(rows[i]);
    expect(flag(3)).toContain('매수 못 함(재선정일 거래 없음)');
    expect(flag(4)).toContain('매수 못 함(1주 값이 배정 금액보다 커요)');
    expect(flag(5)).toContain('매수 못 함(현금이 모자라요)');
    expect(flag(0)).not.toContain('매수 못 함');
    expect(flag(6)).not.toContain('매수 못 함');
    expect(flag(2)).toContain('거래가 멈춰 마지막 종가로 팔았어요');
    expect(document.querySelectorAll('.hist').length).toBe(1);
    expect(squash(document.querySelector('.hist')!).split('매수 못 함').length - 1).toBe(3);
  });

  it('a row with 0 passes has no expand button', () => {
    setup();
    expect(screen.queryByRole('button', { name: /2026.02.02/ })).toBeNull();
    expect(screen.getByRole('button', { name: /2026.01.05/ })).toBeTruthy();
  });

  it('history: passed 0 reads 통과 0개 · 현금; names fall back to the code; flags show without expanding', () => {
    setup(validationResult(), { '000000': '삼성가짜' });
    expect(screen.getByText('통과 0개 · 현금')).toBeTruthy();
    expect(screen.getByText('통과 25개 · 10종목 선정')).toBeTruthy();
    const hist = document.querySelector('.hist')!;
    expect(hist.textContent).toContain('삼성가짜');
    expect(hist.textContent).toContain('000001');
    expect(hist.textContent).toContain('매수 못 함(재선정일 거래 없음)');
    expect(hist.textContent).toContain('거래가 멈춰 마지막 종가로 팔았어요');
    expect(hist.textContent).toContain('▲ +5.5%');
    expect(hist.textContent).toContain('▼ −3.2%');
    expect(hist.textContent).not.toContain('거래대금');
  });

  it('expanding a history row shows the condition values', async () => {
    setup();
    const head = screen.getAllByRole('button', { name: /2026.01.05/ })[0];
    expect(head.getAttribute('aria-expanded')).toBe('false');
    await fireEvent.click(head);
    expect(head.getAttribute('aria-expanded')).toBe('true');
    const hist = document.querySelector('.hist')!;
    expect(hist.textContent).toContain('거래대금');
    expect(hist.textContent).toContain('250억원');
    expect(hist.textContent).toContain('−12.3%');
    expect(hist.textContent).toContain('반등 신호');
  });

  it('help always shows survivorship, snapshot and dividend; the few-segments line only with that note', () => {
    setup();
    const help = squash(document.querySelector('.help')!);
    expect(help).toContain('지금 상장된 종목만 들어 있어 상장폐지 종목이 빠져요(생존 편향). 결과가 실제보다 좋게 나올 수 있어요');
    expect(help).toContain('업종과 상장주식수는 수집일 기준이에요. 과거 시점에도 지금 값을 써요');
    expect(help).toContain('배당 제외 · 가격 수익률만이에요');
    expect(help).toContain('구간이 적어서 우연일 수 있어요');
  });

  it('with 12+ segments there is no few-segments line, but the always-lines stay', () => {
    setup(validationResult({ notes: [] }));
    const help = squash(document.querySelector('.help')!);
    expect(help).not.toContain('구간이 적어서');
    expect(help).toContain('배당 제외');
  });

  it('allEmpty puts the warning on top', () => {
    setup(validationResult({ notes: ['allEmpty'] }));
    expect(screen.getByText('기간 내내 조건을 통과한 종목이 없어요')).toBeTruthy();
    expect(squash(document.querySelector('.vr')!.firstElementChild!)).toBe('기간 내내 조건을 통과한 종목이 없어요');
  });

  it('warmup and sparse-axis notes are warning banners on top, not help text', () => {
    setup(validationResult({ notes: ['warmup', 'sparseAxis'] }));
    const top = [...document.querySelectorAll('.banner.warn')].map((b) => squash(b));
    expect(top).toEqual(['앞부분은 지표 계산에 필요한 데이터가 모자라요', '일부 재선정일은 전날 거래한 종목이 적어서 선별이 덜 정확할 수 있어요']);
    expect(document.querySelector('.vr')!.firstElementChild!.classList.contains('banner')).toBe(true);
    expect(squash(document.querySelector('.help')!)).not.toContain('앞부분은');
  });

  it('no warning banners without those notes', () => {
    setup();
    expect(document.querySelector('.banner')).toBeNull();
  });

  it('an index without a curve says why on its card', () => {
    setup(validationResult({ indices: [{ id: 'KOSPI', curve: null, reason: '기간 일부만 받았어요', stats: null }] }));
    expect(squash(card('idx-KOSPI'))).toBe('KOSPI 기간 일부만 받았어요');
  });

  it('vs-index uses indices[0] everywhere; when it has no curve the reason shows instead of a silent drop', () => {
    const other = { id: 'KOSDAQ' as const, curve: [], stats: stats(1) };
    setup(validationResult({ indices: [{ id: 'KOSPI', curve: null, reason: '받지 못했어요', stats: null }, other], hold: { ...validationResult().hold, beat: null } }));
    expect(squash(card('hold'))).toContain('지수 대비: KOSPI 받지 못했어요');
    expect(squash(card('etf-069500'))).toContain('지수 대비: KOSPI 받지 못했어요');
    expect(squash(document.querySelector('.mt')!)).toContain('지수 대비: KOSPI 받지 못했어요');
    expect(squash(document.querySelector('.mt tbody tr')!)).toContain('—');
  });

  it('vs-index follows indices[0] even when a later index has stats', () => {
    setup(validationResult({ indices: [{ id: 'KOSDAQ', curve: [], stats: stats(2) }, { id: 'KOSPI', curve: [], stats: stats(50) }] }));
    expect(squash(card('hold'))).toContain('지수 대비 ▲ +10.3%p');
    expect(squash(document.querySelector('.mt')!)).toContain('지수 대비는 KOSDAQ 기준이에요');
  });

  it('ETF curves do not reuse the hold line style, and use palette slots that clear 3:1 on both themes', async () => {
    setup(validationResult({ benchmarks: [
      { symbol: 'A', name: 'A', curve: [{ date: '2026-01-05', value: 1e7 }], stats: stats(1) },
      { symbol: 'B', name: 'B', curve: [{ date: '2026-01-05', value: 1e7 }], stats: stats(1) },
    ] }));
    await vi.waitFor(() => expect(lwcCharts[0]?.series).toHaveLength(4));
    const [hold, , a, b] = lwcCharts[0].series.map((s) => [s.options.color, s.options.lineWidth]);
    expect(a).toEqual(['#008300', 2]);
    expect(b).toEqual(['#4a3aa7', 2]); // 파랑(하락색)이 아닌 --s3
    expect([a, b]).not.toContainEqual(hold);
  });

  it('chart gets one curve per available line and rebalance ticks', async () => {
    setup();
    await vi.waitFor(() => expect(lwcCharts[0]?.series).toHaveLength(3));
    lwcCharts[0].timeToX = (t) => (t === ('2026-01-05' as unknown) ? 10 : null);
    lwcCharts[0].fireVisibleRange();
    await vi.waitFor(() => expect(document.querySelectorAll('[data-rebalance-tick]')).toHaveLength(1));
    expect((document.querySelector('[data-rebalance-tick]') as HTMLElement).style.left).toBe('10px');
  });

  it('legend buttons toggle a curve', async () => {
    setup();
    await vi.waitFor(() => expect(lwcCharts[0]?.series).toHaveLength(3));
    const btn = screen.getByRole('button', { name: /KOSPI/ });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    await fireEvent.click(btn);
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    await vi.waitFor(() => expect(lwcCharts[0].series[1].options.visible).toBe(false));
    await fireEvent.click(btn);
    await vi.waitFor(() => expect(lwcCharts[0].series[1].options.visible).toBe(true));
  });

  describe('stage 4 notes and values', () => {
    const withPicks = (values: Record<string, number | boolean | null>) => {
      const base = validationResult();
      return validationResult({ rebalances: [{ ...base.rebalances[0], picked: [{ symbol: '000000', values }] }, base.rebalances[1]] });
    };

    it('themeSnapshot adds its sentence to the help list (verbatim), and only with that note', () => {
      setup(validationResult({ notes: ['themeSnapshot'] }));
      expect(squash(document.querySelector('.help')!)).toContain('테마·내 묶음은 지금 구성을 과거에도 써요. 그때는 없던 종목이 들어 있어 결과가 실제보다 좋게 나올 수 있어요');
      document.body.innerHTML = '';
      setup(validationResult({ notes: [] }));
      expect(squash(document.querySelector('.help')!)).not.toContain('지금 구성을 과거에도');
    });

    it('the weekly-release line shows only when the run used FX/oil', () => {
      setup(validationResult({ notes: [] }), {}, { macro: { used: true } });
      expect(squash(document.querySelector('.help')!)).toContain('환율·유가는 매주 묶어서 공개돼 최근 1~2주는 반영되지 않아요');
      document.body.innerHTML = '';
      setup(validationResult({ notes: [] }));
      expect(squash(document.querySelector('.help')!)).not.toContain('매주 묶어서');
    });

    it('macroGap is a warning banner on top', () => {
      setup(validationResult({ notes: ['macroGap'] }));
      expect([...document.querySelectorAll('.banner.warn')].map((b) => squash(b))).toEqual(['일부 기간은 환율·유가 값이 없어 그 조건을 통과한 종목이 없어요']);
      expect(squash(document.querySelector('.help')!)).not.toContain('일부 기간은');
    });

    it('expanding a history row shows beta and trend as 원/달러 민감도 0.82 · 최근 20일 +3.4%', async () => {
      setup(withPicks({ usdkrwBeta: 0.8234, usdkrwTrend: 3.44, wtiBeta: null }), {}, { macro: { used: true, lookback: { usdkrw: 20 } } });
      expect(document.querySelector('[data-macro-value]')).toBeNull();
      await fireEvent.click(screen.getByRole('button', { name: /통과 25개/ }));
      expect([...document.querySelectorAll('[data-macro-value]')].map((e) => e.textContent)).toEqual(['원/달러 민감도 0.82 · 최근 20일 +3.4%', '유가 민감도 —']);
      // 환율·유가 값은 일반 값 목록에 따로 나오지 않는다
      expect(document.querySelector('.vals')!.textContent).not.toContain('usdkrw');
    });
  });
});
