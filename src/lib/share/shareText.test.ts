import { describe, expect, it } from 'vitest';
import { newStrategy } from '../sim/defaults';
import { groupSnapshot, strategySnapshot } from './snapshot';
import { cardLines, compareViewText, snapshotLines, symbolNames } from './shareText';
import { compareSnapshot } from './compact';
import { simResultFixture, validationFixture } from './testFixtures';
import { fmtReturnPct, trendReturn } from '../ui/simulate/simText';
import { trendPp } from '../ui/screen/screenText';
import { newCriteria } from '../screen/defaults';
import { criteriaSnapshot } from './snapshot';

const group = groupSnapshot({
  id: 'g',
  name: '반도체',
  items: [
    { symbol: '000660', colorSlot: 1, hidden: false, addedAt: 1 },
    { symbol: '999999', colorSlot: 2, hidden: false, addedAt: 2 },
  ],
});
const names = symbolNames([
  { s: '000660', n: 'SK하이닉스', m: 'KOSPI', t: 'STOCK' },
  { s: '005930', n: '삼성전자', m: 'KOSPI', t: 'STOCK' },
]);

describe('snapshotLines', () => {
  it('이름을 알면 「이름(코드)」, 모르면 코드만 보인다', () => {
    expect(snapshotLines(group, names)[1]).toBe('종목 2개: SK하이닉스(000660), 999999');
  });

  it('이름 목록이 없으면 코드만 보인다', () => {
    expect(snapshotLines(group)[1]).toBe('종목 2개: 000660, 999999');
  });

  it('전략 종목에도 이름을 붙인다', () => {
    const s = newStrategy(1, null);
    s.universe = { kind: 'symbols', symbols: ['005930'] };
    const snap = strategySnapshot(s, { groups: [], activeGroupId: null } as never, { hideCapital: true });
    expect(snapshotLines(snap, names)[1]).toBe('종목 1개: 삼성전자(005930)');
  });
});

describe('새 종류의 요약', () => {
  const cmp = compareSnapshot(
    { id: 'g', name: '반도체', items: ['000660', '005930', '035420', '051910'].map((symbol, i) => ({ symbol, colorSlot: (i + 1) as 1, hidden: false, addedAt: 1 })) },
    { period: { unit: 'M', n: 1 }, metric: 'change', benchmark: 'AUTO', boardOrder: 'value' },
  );

  it('보기 설정 한 줄', () => {
    expect(compareViewText(cmp.view)).toBe('기간 1개월 · 지표 등락률 · 벤치마크 자동 · 정렬 값 순');
    expect(compareViewText({ ...cmp.view, benchmark: 'KOSDAQ', boardOrder: 'mine' })).toBe('기간 1개월 · 지표 등락률 · 벤치마크 KOSDAQ · 정렬 내 순서');
  });

  it('카드 두 줄: 그룹·전략·기준·비교', () => {
    expect(cardLines(group, names)).toEqual(['종목 2개: SK하이닉스, 999999']);
    expect(cardLines({ ...group, symbols: ['000660', '005930', '035420', '051910', '000270'] }, names)).toEqual(['종목 5개: SK하이닉스, 삼성전자, 035420 외 2개']);
    const s = newStrategy(1, null);
    s.universe = { kind: 'symbols', symbols: ['005930'] };
    s.period = { from: '2023-10-11', to: '2026-10-11' };
    const st = strategySnapshot(s, { groups: [] }, { hideCapital: true });
    const [a, b] = cardLines(st);
    expect(a).toBe('종목 1개 · 2023.10.11 ~ 2026.10.11');
    expect(b).toMatch(/^하락 (\d+%|끔) · 익절 \d+%(\/\d+%)* · 손절 \d+(\.\d+)?%$/);
    const cr = criteriaSnapshot(newCriteria(1, null, '기준'), { baskets: [], strategies: [] }, { hideCapital: false });
    expect(cardLines(cr)[0]).toBe('KOSPI·KOSDAQ 상위 10개 · 매월 재선정');
    expect(cardLines(cmp, names)).toEqual(['종목 4개 · 1개월 등락률', 'SK하이닉스, 삼성전자, 035420']);
    expect(cardLines(cmp, names, '삼성전자 +3.2% · 10.29 14:32 기준')[1]).toBe('삼성전자 +3.2% · 10.29 14:32 기준');
  });

  it('카드 두 줄: 시뮬레이션·검증(데모면 끝에 · 데모)', () => {
    const sim = simResultFixture();
    expect(cardLines(sim)).toEqual([`총수익률 ${trendReturn(4.1)} · 최대 낙폭 ${fmtReturnPct(-3.69)}`, '종목 3개 · 거래 2번 · 2024.01.02 ~ 2024.01.12']);
    expect(cardLines({ ...sim, run: { ...sim.run, demo: true } })[1]).toBe('종목 3개 · 거래 2번 · 2024.01.02 ~ 2024.01.12 · 데모');
    const val = validationFixture();
    expect(cardLines(val)).toEqual([`① 선정만 ${trendReturn(12.34)} · 지수 대비 ${trendPp(12.34 - 8.06)}`, '상위 10개 · 매월 · 2026.01 ~ 2026.02']);
  });

  it('미리 보기 줄: 결과 종류는 제목·두 줄·시세 출처·초기 자금', () => {
    const lines = snapshotLines(simResultFixture({ capitalHidden: true }));
    expect(lines[0]).toBe('제목: 눌림목');
    expect(lines[3]).toMatch(/^시세 출처: KRX 일봉 · \d{4}\.\d{2}\.\d{2} \d{2}:\d{2} 받음$/);
    expect(lines[4]).toBe('초기 자금: 비공개');
    expect(snapshotLines(cmp, names)).toEqual(['제목: 반도체', '종목 4개: SK하이닉스(000660), 삼성전자(005930), 035420, 051910', '보기: 기간 1개월 · 지표 등락률 · 벤치마크 자동 · 정렬 값 순']);
    expect(snapshotLines(validationFixture()).at(-1)).toBe('초기 자금: 10,000,000원');
  });
});
