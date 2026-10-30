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
  fillText: (t: string, x: number, y: number) => calls.push(['text', t, x, y]),
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
});
