// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { doneState } from '../ui/simulate/resultFixture';
import { fmtReturnPct, trendReturn } from '../ui/simulate/simText';
import { validationResult } from '../ui/screen/resultFixture';
import { CARD_FILE_MAX, cardAlt, cardFile, compareCardLine, compareCardText, composeCard, readCardColors, simResultCardText, validationCardText } from './cardImage';

type Call = [op: string, ...args: unknown[]];
let calls: Call[] = [];
/** jsdom에는 canvas 그리기가 없으므로 호출을 기록하는 가짜 2D context(설계 6.3) */
const ctx = {
  fillStyle: '',
  font: '',
  textBaseline: '',
  scale: (x: number, y: number) => calls.push(['scale', x, y]),
  fillRect: (...a: number[]) => calls.push(['rect', ...a]),
  fillText: (t: string, x: number, y: number, maxWidth?: number) => calls.push(['text', t, x, y, maxWidth]),
  drawImage: (img: unknown, ...a: number[]) => calls.push(['image', img, ...a]),
};
beforeEach(() => {
  calls = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
});
afterEach(() => vi.restoreAllMocks());

const COLORS = { bg: '#fff', text: '#111', sub: '#666', up: '#e00', down: '#00e', accent: '#53e' };
const TEXT = {
  title: '반도체',
  subtitle: '1개월 · 등락률 · 10.29 14:32 기준',
  rows: Array.from({ length: 6 }, (_, i) => ({ label: `종목${i}`, value: `+${i}.0%`, tone: 'up' as const })),
  footer: '한국투자증권',
};

describe('composeCard', () => {
  it('1600×800(표시 800×400), 위 띠에 가즈아·제목·부제, 왼쪽에 차트, 오른쪽에 값 5개, 아래에 출처', () => {
    const chart = Object.assign(document.createElement('canvas'), { width: 1200, height: 600 });
    const card = composeCard(chart, TEXT, COLORS);
    expect([card.width, card.height]).toEqual([1600, 800]);
    expect(calls[0]).toEqual(['scale', 2, 2]);
    const texts = calls.filter((c) => c[0] === 'text').map((c) => c[1]);
    expect(texts.slice(0, 3)).toEqual(['가즈아', '반도체', '1개월 · 등락률 · 10.29 14:32 기준']);
    expect(texts).toContain('종목4');
    expect(texts).not.toContain('종목5');
    expect(texts.at(-1)).toBe('한국투자증권');
    const footer = calls.filter((c) => c[0] === 'text').at(-1)!;
    expect(footer[3] as number).toBeGreaterThanOrEqual(376);
    const img = calls.find((c) => c[0] === 'image')!;
    expect(img[1]).toBe(chart);
    const [, , x, y, w, h] = img as [string, unknown, number, number, number, number];
    expect(x).toBe(16);
    expect(y).toBeGreaterThanOrEqual(64);
    expect(w).toBeLessThanOrEqual(496);
    expect(w / h).toBeCloseTo(2, 5);
    const valueXs = calls.filter((c) => c[0] === 'text' && String(c[1]).startsWith('종목')).map((c) => c[2] as number);
    expect(Math.min(...valueXs)).toBeGreaterThanOrEqual(496);
  });

  it('swatch가 있는 행만 선 색 칸을 그린다', () => {
    composeCard(document.createElement('canvas'), { ...TEXT, rows: [
      { label: '삼성전자', value: '+3.2%', tone: 'up', swatch: '#123456' },
      { label: '최대 낙폭', value: '−1.0%', tone: 'down' },
    ] }, COLORS);
    expect(calls.filter((c) => c[0] === 'rect')).toEqual([
      ['rect', 0, 0, 800, 400], ['rect', 512, 84, 10, 10],
    ]);
  });

  it('긴 제목·라벨·값은 maxWidth로 카드 오른쪽 여백 안에 그린다', () => {
    const title = '반도체'.repeat(10);
    const label = '삼성전자'.repeat(10);
    const value = '+1234567890.00%';
    composeCard(document.createElement('canvas'), { ...TEXT, title, rows: [{ label, value, tone: 'up', swatch: '#123456' }] }, COLORS);
    expect(calls.find((c) => c[1] === title)).toEqual(['text', title, 100, 10, 680]);
    expect(calls.find((c) => c[1] === label)).toEqual(['text', label, 528, 80, 256]);
    expect(calls.find((c) => c[1] === value)).toEqual(['text', value, 512, 100, 272]);
  });

});

describe('cardFile', () => {
  const fake = (blob: Blob | null | 'throw') =>
    ({
      toBlob: (cb: (b: Blob | null) => void, type: string, q: number) => {
        if (blob === 'throw') throw new Error('tainted');
        expect([type, q]).toEqual(['image/jpeg', 0.85]);
        cb(blob);
      },
    }) as unknown as HTMLCanvasElement;
  it('JPEG 0.85 파일, 5 MB를 넘거나 실패하면 null', async () => {
    const f = await cardFile(fake(new Blob(['x'], { type: 'image/jpeg' })));
    expect(f?.type).toBe('image/jpeg');
    expect(await cardFile(fake(new Blob([new Uint8Array(CARD_FILE_MAX + 1)])))).toBeNull();
    expect(await cardFile(fake(null))).toBeNull();
    expect(await cardFile(fake('throw'))).toBeNull();
  });
});

describe('카드 글', () => {
  it('색은 CSS 변수에서, 없으면 기본값', () => {
    const el = document.createElement('div');
    el.style.setProperty('--bg', '#010203');
    el.style.setProperty('--up', '#ff0000');
    document.body.append(el);
    expect(readCardColors(el)).toMatchObject({ bg: '#010203', up: '#ff0000' });
    expect(readCardColors(el).text).toMatch(/^#/);
    el.remove();
  });

  it('비교 화면: 부제는 기간 · 지표 · 기준 시각, 출처는 공급자(데모면 데모 데이터), 둘째 줄 후보', () => {
    const at = Date.UTC(2026, 9, 29, 5, 32); // KST 14:32
    const t = compareCardText({ title: '반도체', period: '1개월', metric: '등락률', at, rows: [{ name: '삼성전자', value: '+3.2%', tone: 'up' }], provider: 'demo' });
    expect(t.subtitle).toBe('1개월 · 등락률 · 10.29 14:32 기준');
    expect(t.footer).toBe('데모 데이터');
    expect(t.rows).toEqual([{ label: '삼성전자', value: '+3.2%', tone: 'up' }]);
    expect(compareCardText({ title: 'x', period: '1일', metric: 'RSI(14)', at, rows: [], provider: 'kis' }).footer).toBe('한국투자증권');
    expect(compareCardLine([{ name: '삼성전자', value: '+3.2%' }, { name: 'SK하이닉스', value: '+2.1%' }], at)).toBe('삼성전자 +3.2% · SK하이닉스 +2.1% · 10.29 14:32 기준');
    expect(cardAlt(t, '비교 화면')).toBe('반도체 비교 화면 캡처: 1개월 · 등락률 · 10.29 14:32 기준, 삼성전자 +3.2%');
  });

  it('시뮬레이션 결과: 총수익률·최대 낙폭·같은 종목 보유·지수, 부제는 기간', () => {
    const t = simResultCardText(doneState());
    expect(t.subtitle).toBe('2023.10.11 ~ 2026.10.11');
    expect(t.rows.map((r) => [r.label, r.value])).toEqual([
      ['총수익률', trendReturn(32.4)],
      ['최대 낙폭', fmtReturnPct(-12.3)],
      ['같은 종목 보유', trendReturn(16.3)],
      ['KOSPI', trendReturn(11)],
    ]);
    expect(t.footer).toBe('데모 데이터');
  });

  it('검증 결과: ① 선정만, ②(있으면), 첫 지수', () => {
    const t = validationCardText(validationResult(), '반등 기준');
    expect(t.title).toBe('반등 기준');
    expect(t.subtitle).toBe('2026.01.05 ~ 2026.02.03');
    expect(t.rows.map((r) => r.label)).toEqual(['① 선정만', 'KOSPI']);
    expect(t.footer).toBe('시장 데이터 파일');
  });

  it.each([
    ['  ' + '가'.repeat(31) + '  ', '가'.repeat(30)],
    ['가'.repeat(29) + '😀끝', '가'.repeat(29)],
  ])('시뮬레이션 카드의 긴 제목을 UTF-16 30자 안으로 자른다: %s', (name, title) => {
    const done = doneState((s) => { s.meta.strategy.name = name; });
    expect(simResultCardText(done).title).toBe(title);
  });
});

describe('카드 선 색과 등락', () => {
  it('비교 카드 글은 입력의 swatch를 옮긴다', () => {
    const t = compareCardText({ title: '반도체', period: '1개월', metric: '등락률', at: 1, provider: 'demo', rows: [
      { name: '삼성전자', value: '+3.2%', tone: 'up', swatch: '#123456' },
    ] });
    expect(t.rows[0].swatch).toBe('#123456');
  });

  it('시뮬레이션 카드 글은 전략·보유·지수 선 색을 넣고 낙폭에는 색 칸이 없다', () => {
    const t = simResultCardText(doneState(), { strategy: '#123456', hold: '#234567', index: '#345678' });
    expect(t.rows.map((r) => r.swatch)).toEqual(['#123456', undefined, '#234567', '#345678']);
  });

  it('검증 카드 글은 ①·②·첫 지수의 선 색을 넣는다', () => {
    const r = validationResult();
    r.trading = { curve: r.hold.equity, stats: r.hold.stats, trades: 5, skipCounts: {} };
    const t = validationCardText(r, '반등 기준', { hold: '#123456', trading: '#234567', 'idx-KOSPI': '#345678' });
    expect(t.rows.map((r) => r.swatch)).toEqual(['#123456', '#234567', '#345678']);
  });

  it.each([0.006, -0.006])('결과 카드의 %s는 화면처럼 소수 첫째 자리 0.0%%·중립색이다', (value) => {
    const done = doneState((s) => {
      s.result.summary.totalReturnPct = value;
      s.result.benchmarks.holdReturnPct = value;
      s.result.benchmarks.indexReturnPct = value;
    });
    const simRows = simResultCardText(done).rows.filter((r) => r.label !== '최대 낙폭');
    expect(simRows.map((r) => [r.value, r.tone])).toEqual(Array(3).fill(['0.0%', 'flat']));
    const result = validationResult();
    result.hold.stats.totalPct = value;
    result.indices[0].stats!.totalPct = value;
    expect(validationCardText(result, '반등 기준').rows.map((r) => [r.value, r.tone])).toEqual(Array(2).fill(['0.0%', 'flat']));
  });
});
