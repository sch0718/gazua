// 엔진 동일성 고정(설계 §2.3). 스냅샷은 엔진을 고치기 전에 썼다. 깨지면 엔진 변경이 결과를 바꾼 것이니 -u로 갱신하지 않는다.
import { describe, expect, it } from 'vitest';
import { simulate, simulateCore } from './simulate';
import { goldenInputs } from './testInputs';

const A = '분할 매수 + 3단계 익절 + 본전 손절';
const B = '갭 손절 + 현금 부족 + 봉 없는 날';
const C = '선정 기간 + 지수·지정 종목';

describe('simulate 골든', () => {
  it.each(Object.entries(goldenInputs))('%s: 결과 전체가 스냅샷과 같다', (_name, make) => {
    expect(simulate(make())).toMatchSnapshot();
  });

  it('대표 입력이 고정하려는 경로를 실제로 지난다', () => {
    const a = simulate(goldenInputs[A]());
    expect(a.trades.map((t) => `${t.kind}${t.stage ?? ''}`)).toEqual(['buy', 'add', 'add', 'take1', 'take2', 'stop']);

    const b = simulate(goldenInputs[B]());
    expect(b.trades.map((t) => `${t.symbol}:${t.kind}`)).toEqual(['S0:buy', 'S0:gapStop']);
    expect(b.skipped.length).toBeGreaterThan(0);
    expect(b.skipped.every((k) => k.symbol === 'S1' && k.reason === '현금 부족')).toBe(true);

    const c = simulate(goldenInputs[C]());
    expect(c.trades.map((t) => `${t.symbol}:${t.kind}`)).toEqual(['S1:buy', 'S1:take']);
    expect(c.skipped.some((k) => k.symbol === 'S0' && k.reason === '선정 기간이 아니에요')).toBe(true);
    expect(c.equity.every((e) => e.index !== null && e.benchmark !== null)).toBe(true);
  });
});

describe('timeline 옵션 불변식(설계 §2.3-2)', () => {
  it.each(Object.entries(goldenInputs))('%s: timeline을 켜도 나머지 결과는 끈 결과와 같다', (_name, make) => {
    const { timeline, ...rest } = simulate(make(), { timeline: true });
    expect(rest).toStrictEqual(simulate(make()));
    expect(timeline).toHaveLength(rest.equity.length);
  });

  it('옵션을 끄면 timeline 키 자체가 없다', () => {
    const make = goldenInputs[A];
    expect('timeline' in simulate(make())).toBe(false);
    expect('timeline' in simulate(make(), {})).toBe(false);
    expect('timeline' in simulateCore(make())).toBe(false);
    expect(simulateCore(make(), { timeline: true }).timeline).toHaveLength(make().days.length);
  });
});
