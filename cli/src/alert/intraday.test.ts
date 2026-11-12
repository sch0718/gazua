import { describe, expect, it } from 'vitest';
import { kstEpoch } from '../../../src/lib/time/kst';
import type { Bar10 } from '../naverMarket';
import { allowSend, detectSpike, formatSpike, formatStockSpikes, markSent, rankMovers, returns10, STEP_MS, type WatchState } from './intraday';

const at = (d: string, t: string) => kstEpoch(d, `${t}:00`);
const empty = (): WatchState => ({ lastBar: {}, lastSent: {}, sentByDate: {} });
function history(): Bar10[] {
  let price = 100;
  return ['05', '06', '09', '10', '11'].flatMap((d) => Array.from({ length: 39 }, (_, i) => {
    price *= Math.exp(i % 2 ? 0.0001 : -0.0001);
    return { end: at(`2026-11-${d}`, '09:10') + i * STEP_MS, close: price };
  }));
}

describe('장중 급변', () => {
  it('밤사이·빠진 봉·NXT 시간대 수익률을 제외한다', () => {
    const bars = [
      { end: at('2026-11-10', '15:30'), close: 100 },
      { end: at('2026-11-11', '09:00'), close: 110 },
      { end: at('2026-11-11', '09:10'), close: 111 },
      { end: at('2026-11-11', '09:30'), close: 112 },
      { end: at('2026-11-11', '15:30'), close: 113 },
      { end: at('2026-11-11', '15:40'), close: 114 },
    ];
    expect([...returns10(bars).keys()]).toEqual([at('2026-11-11', '09:10')]);
  });
  it('과거 정규장 표준편차보다 큰 마지막 완성 봉을 찾는다', () => {
    const bars = history();
    const last = bars.at(-1)!;
    last.close = bars.at(-2)!.close * 1.01;
    const spike = detectSpike('ES', bars, last.end + STEP_MS, 2.5)!;
    expect(spike.sym).toBe('ES');
    expect(spike.change).toBeCloseTo(Math.log(1.01));
    expect(spike.end).toBe(last.end);
    expect(detectSpike('ES', bars, last.end + 35 * 60_000, 2.5)).toBeNull();
    expect(detectSpike('ES', bars.filter((_, i) => i !== bars.length - 2), last.end, 2.5)).toBeNull();
    expect(detectSpike('ES', bars.map((b) => ({ ...b, close: 100 })), last.end, 2.5)).toBeNull();
    expect(detectSpike('ES', bars.slice(-20), last.end, 2.5)).toBeNull();
    expect(detectSpike('ES', bars, last.end - STEP_MS, 2.5)).toBeNull();
  });
  it('같은 시각으로 짝지은 베타로 오름·내림 종목을 고른다', () => {
    const fut = new Map(Array.from({ length: 40 }, (_, i) => [i, (i - 20) / 10000]));
    const stocks = [1, -2, 0].map((beta, i) => ({ code: String(i), name: String(i), ret: new Map([...fut].map(([t, x]) => [t, beta * x])) }));
    const spike = { sym: 'ES' as const, end: 40, change: 0.01, sigma: 0.001 };
    const result = rankMovers(spike, fut, [...stocks, { code: '짧음', name: '짧음', ret: new Map() }], 5);
    expect(result.up.map((m) => m.code)).toEqual(['0']);
    expect(result.down.map((m) => m.code)).toEqual(['1']);
    expect(result.down[0].expected).toBeCloseTo(-0.02);
  });
  it('같은 봉은 막고 제한 0이면 서로 다른 봉은 계속 보낸다', () => {
    let st = empty();
    const now = at('2026-11-11', '10:40');
    for (let i = 0; i < 10; i++) {
      const s = { sym: 'ES' as const, end: now + i * STEP_MS, change: 0.01, sigma: 0.001 };
      expect(allowSend(st, s, s.end, 0, 0)).toBe(true);
      st = markSent(st, s, s.end);
      expect(allowSend(st, s, s.end, 0, 0)).toBe(false);
    }
    expect(st.sentByDate['2026-11-11']).toBe(10);
  });
  it('쿨다운·KST 날짜별 상한을 적용하고 원래 상태를 바꾸지 않는다', () => {
    const now = at('2026-11-11', '10:40');
    const s = { sym: 'ES' as const, end: now, change: 0.01, sigma: 0.001 };
    const original = empty(), st = markSent(original, s, now);
    expect(original).toEqual(empty());
    expect(allowSend(st, { ...s, end: now + 1 }, now + 20 * 60_000, 30, 0)).toBe(false);
    expect(allowSend(st, { ...s, end: now + 1 }, now + 31 * 60_000, 30, 0)).toBe(true);
    const twice = markSent(st, { ...s, sym: 'NQ' }, now);
    expect(allowSend(twice, { ...s, end: now + 1 }, now, 0, 2)).toBe(false);
    expect(allowSend(twice, { ...s, end: now + 1 }, at('2026-11-12', '09:10'), 0, 2)).toBe(true);
  });
  it('문구에 지연·봉 구간·빠진 지표와 참고 금리 bp를 표시한다', () => {
    const s = { sym: 'ES' as const, end: at('2026-11-11', '10:30'), change: -0.005, sigma: 0.001 };
    const msg = formatSpike(s, { up: [], down: [{ code: '000660', name: 'SK하이닉스', expected: -0.009 }] }, { rate: { changeAbs: 0.02, changePct: 0.5, tradedAt: s.end } }, ['달러']);
    const text = msg.title + msg.body;
    for (const word of ['10분 늦게', '10:20~10:30', '같이 내릴 것 같은 종목\n· SK하이닉스 −0.9%', '못 가져온 자료: 달러', '미국 금리 +0.02%p', '급락']) expect(text).toContain(word);
    expect(text).not.toMatch(/투자|매수|매도/);
    expect(formatSpike({ ...s, change: 0.005 }, { up: [], down: [] }, {}, []).body).toContain('같이 오를 것 같은 종목\n· 없음');
  });
  it('관심 종목 급변은 큰 움직임부터 평소 대비 배수와 봉 구간을 보여 준다', () => {
    const end = at('2026-11-11', '10:40');
    const msg = formatStockSpikes([
      { sym: '005930', name: '삼성전자', end, change: Math.log(1.02), sigma: 0.005 },
      { sym: '000660', name: 'SK하이닉스', end, change: Math.log(0.97), sigma: 0.01 },
    ]);
    expect(msg.title).toBe('장중 알림 · 관심 종목 2개 급변');
    expect(msg.body.split('\n').slice(0, 2)).toEqual(['· SK하이닉스 −3.0% 급락 (평소의 3.0배, 10:30~10:40)', '· 삼성전자 +2.0% 급등 (평소의 4.0배, 10:30~10:40)']);
    expect(formatStockSpikes([{ sym: '005930', name: '삼성전자', end, change: Math.log(1.02), sigma: 0.005 }]).title).toBe('장중 알림 · 삼성전자 10분 새 +2.0% 급등');
  });
});
