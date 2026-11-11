import { describe, expect, it, vi } from 'vitest';
import { addDays } from '../../../src/lib/time/kst';
import type { DayBar } from '../naverMarket';
import { backtest, fitModel, formatPremarket, futAt, macroSide, predict, samples, type Sample } from './premarket';
import * as regress from './regress';

const bar = (date: string, close: number, open = close): DayBar => ({ date, open, close });
const history = (n: number): Sample[] => Array.from({ length: n }, (_, i) => {
  const x = Math.sin(i * 1.7) * 0.01;
  return { date: addDays('2025-01-01', i), x, y: 0.001 + 1.5 * x };
});

describe('개장 전 계산', () => {
  it('진행 중인 선물 봉을 빼고 국내 연휴 동안 쌓인 세션을 쓴다', () => {
    const fut = [bar('2026-10-02', 100), bar('2026-10-05', 101), bar('2026-10-06', 102), bar('2026-10-07', 103), bar('2026-10-08', 999)];
    expect(futAt(fut, '2026-10-08')).toBe(103);
    expect(futAt([...fut].reverse(), '2026-10-08')).toBe(103);
    expect(futAt(fut, '2026-10-02')).toBeNull();
    const stock = [bar('2026-10-05', 100), bar('2026-10-08', 104, 103)];
    expect(samples(stock, fut)).toEqual([{ date: '2026-10-08', x: Math.log(103 / 100), y: Math.log(103 / 100) }]);
  });
  it('분할 의심·비유한 표본과 선물 자료가 없는 날을 뺀다', () => {
    const fut = [bar('2026-10-01', 100), bar('2026-10-02', 101), bar('2026-10-03', 102)];
    expect(samples([bar('2026-10-01', 100), bar('2026-10-02', 100), bar('2026-10-03', 100, 200), bar('2026-10-04', 100, Infinity)], fut)).toEqual([]);
  });
  it('평가일 전 마지막 250표본만 학습하고 결정계수가 큰 선물을 고른다', () => {
    const ES = history(400), NQ = ES.map((s, i) => ({ ...s, x: Math.cos(i) }));
    const asOf = ES[350].date;
    const m = fitModel({ ES, NQ }, asOf)!;
    expect(m.sym).toBe('ES');
    expect(m.fit.n).toBe(250);
    expect(m.fit.beta).toBeCloseTo(1.5);
    const poison = (ss: Sample[]) => ss.map((s) => s.date >= asOf ? { ...s, x: 999, y: -999 } : s);
    expect(fitModel({ ES: poison(ES), NQ: poison(NQ) }, asOf)).toEqual(m);
    expect(fitModel({ ES: ES.slice(0, 119), NQ: [] }, asOf)).toBeNull();
    expect(fitModel({ ES: ES.map((s) => ({ ...s, x: 1 })), NQ: [] }, asOf)).toBeNull();
  });
  it('로그 예상을 퍼센트 비율로 돌려준다', () => {
    expect(predict({ sym: 'ES', fit: { alpha: 0, beta: 1, r2: 1, t: Infinity, n: 120 } }, Math.log(1.01))).toBeCloseTo(0.01);
  });
  it('마지막 60일을 날짜별로 재학습하며 0인 정답과 부족한 학습을 뺀다', () => {
    const ES = history(200);
    const result = backtest([{ ES, NQ: [] }, { ES, NQ: [] }]);
    expect(result).toEqual({ hit: 1, baseUp: ES.slice(-60).filter((s) => s.y > 0).length / 60, n: 120, days: 60 });
    expect(backtest([{ ES: ES.slice(0, 120), NQ: [] }])).toEqual({ hit: 0, baseUp: 0, n: 0, days: 0 });
    const lastZero = ES.map((s, i) => i === 199 ? { ...s, y: 0 } : s);
    expect(backtest([{ ES: lastZero, NQ: [] }], 1).n).toBe(0);
    // 평가일의 큰 이상값도 학습하지 않는다. 부호가 같으면 성적도 같다.
    expect(backtest([{ ES: ES.map((s, i) => i === 199 ? { ...s, y: Math.sign(s.y) * 0.2 } : s), NQ: [] }], 1)).toEqual(backtest([{ ES, NQ: [] }], 1));
  });
  it('미래의 x와 y를 모두 바꿔도 백테스트 첫 평가일의 회귀와 예측이 같다', () => {
    const ES = history(200), NQ = ES.map((s, i) => ({ ...s, x: Math.cos(i) * 0.01 }));
    const first = ES[140]; // 마지막 60개 거래일 중 첫 평가일
    const spy = vi.spyOn(regress, 'fitLine');
    try {
      backtest([{ ES, NQ }]);
      const before = spy.mock.results.slice(0, 2).map((r) => r.value);
      expect(before[0]).toMatchObject({ n: 140 });
      expect(before[0].r2).toBeGreaterThan(before[1].r2);
      const expected = predict({ sym: 'ES', fit: before[0] }, first.x);
      spy.mockClear();
      const poison = (ss: Sample[]) => ss.map((s) => s.date > first.date ? { ...s, x: 999, y: -999 } : s);
      backtest([{ ES: poison(ES), NQ: poison(NQ) }]);
      const after = spy.mock.results.slice(0, 2).map((r) => r.value);
      expect(after).toEqual(before);
      expect(predict({ sym: 'ES', fit: after[0] }, first.x)).toBe(expected);
    } finally { spy.mockRestore(); }
  });
});

describe('매크로 방향과 알림 문구', () => {
  it.each(['oil', 'dollar', 'rate'] as const)('%s의 같은 방향·반대 방향을 복원하고 무상관은 뺀다', (kind) => {
    const d = Array.from({ length: 180 }, (_, i) => addDays('2025-01-01', i));
    const v = d.map((_, i) => 100 + Math.sin(i * 1.7));
    const fred = { d, v };
    for (const beta of [0.002, -0.002, 0]) {
      let close = 100, seed = 7;
      const noise = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5) * 0.02;
      const stock = d.map((date, i) => {
        // 국내 i일 종가 변화는 그 전 미국 날짜(i-1)의 변화와 짝지어진다
        const x = i > 1 ? (kind === 'rate' ? v[i - 1] - v[i - 2] : Math.log(v[i - 1] / v[i - 2])) : 0;
        close *= Math.exp(beta ? beta * x : noise());
        return bar(date, close);
      });
      expect(macroSide(stock, fred, kind)).toBe(beta === 0 ? null : beta > 0 ? 'same' : 'opposite');
      expect(macroSide(stock, { d: d.slice(0, 100), v: v.slice(0, 100) }, kind)).toBeNull();
    }
  });
  it('FRED는 국내 날짜보다 앞선 미국 날짜와 짝짓고 YYYYMMDD 날짜도 받는다', () => {
    const stock = Array.from({ length: 180 }, (_, i) => bar(addDays('2025-01-01', i), 100 * Math.exp(Math.sin(i) * 0.01)));
    const d = stock.map((s) => s.date.replaceAll('-', ''));
    // 미국 d일 값 = 국내 d+1일 종가 → 국내 변화와 전날 미국 변화가 같다
    expect(macroSide(stock, { d, v: stock.map((_, i) => stock[Math.min(i + 1, stock.length - 1)].close) }, 'oil')).toBe('same');
    expect(macroSide(stock, { d: d.slice(-2), v: [100, 101] }, 'oil')).toBeNull();
  });
  it('백테스트·휴장 불명·빠진 지표·면책 문구와 금리 bp를 표시한다', () => {
    const msg = formatPremarket({ esPct: 0.008, nqPct: null, session: '11/10 미국 세션', up: [{ name: '가', pct: 0.012, sym: 'ES' }], down: [], macro: [{ kind: 'rate', quote: { changeAbs: 0.138, changePct: 2.84, tradedAt: 1 }, same: ['나'], opposite: ['다'] }], record: { hit: 0.6, baseUp: 0.5, n: 100, days: 60, source: '백테스트' }, missing: ['NQ'], statusUnknown: true });
    const text = msg.title + msg.body;
    expect(text).toContain('과거 경향이며 투자 조언이 아님');
    expect(text).not.toMatch(/매수|매도/);
    expect(text).toContain('백테스트');
    expect(text).toContain('휴장 여부 확인 못 함');
    expect(text).toContain('빠진 지표: NQ');
    expect(text).toContain('+14bp');
    expect(text).toContain('+1.2%(ES)');
  });
});
