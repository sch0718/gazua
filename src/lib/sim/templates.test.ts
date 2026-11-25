import { describe, expect, it } from 'vitest';
import { newStrategy } from './defaults';
import { sanitizeStrategiesV2 } from './strategyV2';
import { fromTemplate, TEMPLATES, templatesByRegime } from './templates';
import { ruleIssues } from './validate';

describe('템플릿(§3.4)', () => {
  it('여섯 개, 첫 번째는 지금 새 전략과 같다', () => {
    expect(TEMPLATES.map((t) => t.name)).toEqual(['하락 후 반등', '200일선 추세 추종', '골든크로스 50/200', '52주 신고가 돌파', 'RSI(2) 눌림목', '급락 후 단기 반등']);
    const a = fromTemplate(TEMPLATES[0], 0, 'g0', '새 전략');
    expect({ ...a, id: 'x' }).toEqual({ ...newStrategy(0, 'g0', '새 전략'), id: 'x' });
  });
  it('프리셋을 시황 순서대로 묶고 시황 표시가 없는 전략은 마지막에 둔다', () => {
    expect(templatesByRegime().map(({ id, title, templates }) => [id, title, templates.map((t) => t.id)])).toEqual([
      ['up', '상승장', ['ma200', 'breakout']],
      ['range', '횡보장', ['rsi2']],
      ['down', '하락장', ['rsi2', 'crash']],
      ['crash', '급락·고변동장', ['crash']],
      ['other', '그 밖의 전략', ['rebound', 'golden']],
    ]);
  });
  it('시황 표시가 있는 프리셋에만 과거 시험 근거가 있다', () => {
    for (const t of TEMPLATES) {
      if (t.regimes.length > 0) expect(t.evidence).toMatch(/^과거 .+장 구간에서 시험: .+/);
      else expect(t.evidence).toBeNull();
    }
  });
  it('규칙만 바꾸고 종목·기간·비교·비용은 기본값', () => {
    const b = fromTemplate(TEMPLATES[2], 0, 'g0', '새 전략');
    const d = newStrategy(0, 'g0', '새 전략');
    expect([b.universe, b.period, b.benchmarks, b.costs, b.capital]).toEqual([d.universe, d.period, d.benchmarks, d.costs, d.capital]);
    expect(b.rules.buy).toEqual([{ conds: [{ kind: 'maCross', short: 50, long: 200, dir: 'golden' }] }]);
    expect(b.rules.sell.signal).toEqual({ on: true, groups: [{ conds: [{ kind: 'maCross', short: 50, long: 200, dir: 'dead' }] }] });
    expect([b.rules.sell.takeProfit.on, b.rules.sell.stopLoss.on]).toEqual([false, false]);
  });
  it('모든 템플릿은 저장 검증을 고침 없이 통과하고 막는 경고가 없다', () => {
    for (const t of TEMPLATES) {
      const s = { ...fromTemplate(t, 0, null, t.name), id: t.id };
      expect(sanitizeStrategiesV2({ strategies: [s] }, 0)).toEqual({ strategies: [s], repaired: false });
      expect(ruleIssues(s).filter((i) => i.blocking)).toEqual([]);
    }
  });
});
