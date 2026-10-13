import { describe, expect, it } from 'vitest';
import { newStrategy } from '../../sim/defaults';
import type { Watchlists } from '../../state/schema';
import { kstEpoch } from '../../time/kst';
import { fmtReturnPct, money, nearMissText, resultHeadline, returnClass, sectionSummary, skipReasonLabel, startsLate, strategyLine, trendReturn } from './simText';

const NOW = Date.UTC(2026, 9, 12, 1); // 2026-10-12 KST
const W: Watchlists = {
  groups: [
    {
      id: 'g1',
      name: '반도체',
      items: [
        { symbol: '005930', colorSlot: 1, hidden: false, addedAt: 1 },
        { symbol: '000660', colorSlot: 2, hidden: false, addedAt: 1 },
      ],
    },
  ],
};
const s = () => newStrategy(NOW, 'g1');

describe('fmtReturnPct', () => {
  it('uses a real minus sign and one decimal', () => {
    expect(fmtReturnPct(38.2, true)).toBe('+38.2%');
    expect(fmtReturnPct(-12.4, true)).toBe('−12.4%');
    expect(fmtReturnPct(-12.4)).toBe('−12.4%');
    expect(fmtReturnPct(5)).toBe('5.0%');
    expect(fmtReturnPct(0, true)).toBe('0.0%');
    expect(fmtReturnPct(-0.04, true)).toBe('0.0%');
  });
});

describe('strategyLine', () => {
  it('group name and period', () => {
    const x = s();
    x.period = { from: '2023-10-11', to: '2026-10-11' };
    expect(strategyLine(x, W)).toBe('반도체 · 2023.10.11~2026.10.11');
  });
  it('direct symbols and missing groups', () => {
    const x = s();
    x.period = { from: '2023-10-11', to: '2026-10-11' };
    x.universe = { kind: 'symbols', symbols: ['005930'] };
    expect(strategyLine(x, W)).toBe('직접 고른 1종목 · 2023.10.11~2026.10.11');
    x.universe = { kind: 'group', groupId: 'zz' };
    expect(strategyLine(x, W)).toBe('그룹 없음 · 2023.10.11~2026.10.11');
  });
});

describe('sectionSummary (default strategy)', () => {
  const x = s();
  x.period = { from: '2023-10-11', to: '2026-10-11' };
  const sum = (sec: Parameters<typeof sectionSummary>[1], bench: string | null = null) =>
    sectionSummary(x, sec, W, bench);

  it('universe: group name · count', () => expect(sum('universe')).toBe('반도체 · 2종목'));
  it('period and capital', () => {
    expect(sum('period')).toBe('2023.10.11 ~ 2026.10.11');
    expect(sum('capital')).toBe('1,000만 원 · 회당 10%');
  });
  it('entry', () => expect(sum('entry')).toBe('고점 대비 10% 하락 뒤 → 3일 연속 상승 또는 B 돌파'));
  it('scaleIn off', () => expect(sum('scaleIn')).toBe('끔'));
  it('exit: 단계 하나는 전량, 분할 매수를 끄면 손절 기준을 뺀다', () => expect(sum('exit')).toBe('익절 +15%에 전량 · 손절 −5%'));
  it('benchmarks', () => {
    expect(sum('benchmarks')).toBe('같은 종목 사서 보유 · KOSPI · 069500');
    expect(sum('benchmarks', 'KODEX 200')).toBe('같은 종목 사서 보유 · KOSPI · KODEX 200');
  });
  it('costs', () => expect(sum('costs')).toBe('수수료 0.015% · 팔 때 세금 포함'));

  it('other variants', () => {
    const y = structuredClone(x);
    y.capital.initial = 15_000_000;
    y.entry.decline.dropPct.on = false;
    y.entry.decline.days = { on: true, value: 7 };
    y.entry.triggers = {
      reboundDays: { on: false, value: 3 },
      breakout: { on: true, level: 'A' },
      maCross: { on: true, period: 20 },
      goldenCross: { on: true, short: 5, long: 20 },
    };
    y.entry.filter.aboveMa = { on: true, period: 60 };
    y.scaleIn = { on: true, stepPct: 3, maxAdds: 2 };
    y.exit.takeProfit = [
      { pct: 10, sellPct: 50 },
      { pct: 20, sellPct: 100 },
    ];
    y.exit.stopLoss = { pct: 7, basis: 'firstBuy' };
    y.benchmarks.symbol = null;
    expect(sectionSummary(y, 'capital', W, null)).toBe('1,500만 원 · 회당 10%');
    expect(sectionSummary(y, 'entry', W, null)).toBe(
      '7일 하락 뒤 → A 돌파 또는 20일선 돌파 또는 5·20 골든크로스 · 60일선 위',
    );
    expect(sectionSummary(y, 'scaleIn', W, null)).toBe('3% 내릴 때마다 최대 2번 더');
    expect(sectionSummary(y, 'exit', W, null)).toBe('익절 +10%에 50% → +20%에 나머지 · 손절 −7% 첫 매수가');
    expect(sectionSummary(y, 'benchmarks', W, null)).toBe('같은 종목 사서 보유 · KOSPI');
  });

  it('익절 세 단계는 마지막이 나머지, 분할 매수를 켜면 손절 기준을 보인다', () => {
    const y = structuredClone(x);
    y.exit.takeProfit = [
      { pct: 15, sellPct: 50 },
      { pct: 25, sellPct: 25 },
      { pct: 35, sellPct: 100 },
    ];
    y.scaleIn = { on: true, stepPct: 3, maxAdds: 2 };
    expect(sectionSummary(y, 'exit', W, null)).toBe('익절 +15%에 50% → +25%에 25% → +35%에 나머지 · 손절 −5% 분할 후 평단');
    y.exit.stopLoss.basis = 'avgAlways';
    expect(sectionSummary(y, 'exit', W, null)).toBe('익절 +15%에 50% → +25%에 25% → +35%에 나머지 · 손절 −5% 매번 평단');
  });

  it('사는 신호가 하나도 없으면 사는 신호 없음', () => {
    const y = structuredClone(x);
    y.entry.triggers.reboundDays.on = y.entry.triggers.breakout.on = false;
    expect(sectionSummary(y, 'entry', W, null)).toBe('고점 대비 10% 하락 뒤 → 사는 신호 없음');
  });
});

describe('money', () => {
  it('만 원 단위면 만 원, 아니면 원', () => {
    expect(money(10_000_000)).toBe('1,000만 원');
    expect(money(12_345)).toBe('12,345원');
  });
  it('억·조 단위로 끊어 읽는다', () => {
    expect(money(100_000_000)).toBe('1억 원');
    expect(money(120_000_000)).toBe('1억 2,000만 원');
    expect(money(1_000_050_000)).toBe('10억 5만 원');
    expect(money(10_000_000_000_000)).toBe('10조 원');
    expect(money(1_234_567_890_000)).toBe('1조 2,345억 6,789만 원');
    expect(money(99_990_000)).toBe('9,999만 원');
  });
});

describe('resultHeadline', () => {
  const at = kstEpoch('2026-10-12', '14:05:00');
  it('실제 데이터 기간을 보이고, 요청보다 늦게 시작하면 요청 시작일을 덧붙인다', () => {
    expect(resultHeadline('2025-01-02', '2026-10-12', 'KRX 일봉', at, '2023-10-12')).toBe(
      '2025.01.02 ~ 2026.10.12 (요청 2023.10.12부터) · KRX 일봉 · 10/12 14:05 받음',
    );
  });
  it('요청 시작일과 같으면 덧붙이지 않는다', () => {
    expect(resultHeadline('2023-10-12', '2026-10-12', 'KRX 일봉', at, '2023-10-12')).toBe(
      '2023.10.12 ~ 2026.10.12 · KRX 일봉 · 10/12 14:05 받음',
    );
  });
});

describe('startsLate', () => {
  it('is false across a weekend or a 5-day holiday', () => {
    expect(startsLate('2026-03-02', '2026-03-01')).toBe(false);
    expect(startsLate('2026-09-29', '2026-09-24')).toBe(false);
    expect(startsLate('2026-03-08', '2026-03-01')).toBe(false); // 정확히 7일
  });
  it('is true only when the gap is more than 7 days', () => {
    expect(startsLate('2026-03-09', '2026-03-01')).toBe(true);
    expect(startsLate('2025-01-02', '2023-10-12')).toBe(true);
    expect(startsLate('2023-10-12', '2023-10-12')).toBe(false);
  });
});

describe('resultHeadline requested note', () => {
  const at = kstEpoch('2026-10-12', '14:05:00');
  it('요청 시작일이 일요일이라 월요일에 시작해도 요청 문구가 없다', () => {
    expect(resultHeadline('2026-03-02', '2026-10-12', 'KRX 일봉', at, '2026-03-01')).not.toContain('(요청');
  });
});

describe('trendReturn near zero', () => {
  it('반올림해서 0.0%면 화살표도 색도 없다', () => {
    expect(trendReturn(0.04)).toBe('0.0%');
    expect(trendReturn(-0.04)).toBe('0.0%');
    expect(returnClass(0.04)).toBe('');
    expect(returnClass(-0.04)).toBe('');
    expect(trendReturn(0.05)).toBe('▲ +0.1%');
    expect(returnClass(0.05)).toBe('up');
    expect(returnClass(-0.06)).toBe('down');
    expect(returnClass(null)).toBe('');
  });
});

describe('skipReasonLabel', () => {
  it('maps the engine reasons to friendly text', () => {
    expect(skipReasonLabel('현금 부족')).toBe('현금이 모자랐어요');
    expect(skipReasonLabel('1주가 1회 금액보다 비쌈')).toBe('1주가 회당 금액보다 비싸요');
    expect(skipReasonLabel('거래 없음')).toBe('그날 거래가 없었어요');
  });
});

describe('nearMissText', () => {
  const s = () => newStrategy(kstEpoch('2026-10-12', '10:00:00'), 'g1');
  it('① 하락 폭이 조건에 못 미쳤을 때', () => {
    const x = s();
    x.entry.decline.dropPct = { on: true, value: 85 };
    expect(nearMissText({ maxDropPct: 27, declineDays: 0 }, x)).toBe('고점 대비 가장 크게 빠진 때도 27.0%라, 하락 조건(85% 이상)에 닿지 않았어요');
  });
  it('② 하락 조건은 채웠지만 사는 신호가 없었을 때', () => {
    const x = s();
    x.entry.decline.dropPct = { on: true, value: 10 };
    expect(nearMissText({ maxDropPct: 30, declineDays: 12 }, x)).toBe(
      '충분히 떨어진 날은 12일 있었지만, 그 뒤 ②의 사는 신호(연속 상승·돌파 등)가 한 번도 나오지 않았어요',
    );
  });
  it('③ 일수 조건 때문일 때', () => {
    const x = s();
    x.entry.decline.dropPct = { on: false, value: 10 };
    x.entry.decline.days = { on: true, value: 7 };
    expect(nearMissText({ maxDropPct: 30, declineDays: 0 }, x)).toBe('고점 뒤 하락이 7거래일 이상 이어진 적이 없었어요');
  });
});
