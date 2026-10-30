import { describe, expect, it } from 'vitest';
import { FORBIDDEN_KEYS } from '../sync/forbidden';
import { axisDate, checkSimResult, dayOffset, isIsoDate } from './checkResult';
import { checkShareSnapshot } from './snapshot';
import { NOW, simResultFixture, validationFixture } from './testFixtures';

type Edit = (s: any) => void; // 고정 데이터 한 곳을 고친다
const sim = (edit: Edit, hidden = false) => {
  const s = simResultFixture({ capitalHidden: hidden });
  edit(s);
  return checkShareSnapshot(s, 'simResult', NOW);
};
const val = (edit: Edit) => {
  const s = validationFixture();
  edit(s);
  return checkShareSnapshot(s, 'validation', NOW);
};

/** 값 안의 모든 객체 키 */
function allKeys(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => allKeys(x, out));
  else if (typeof v === 'object' && v !== null) for (const [k, x] of Object.entries(v)) (out.add(k), allKeys(x, out));
  return out;
}

describe('날짜 도구', () => {
  it('ISO 날짜·일수 변환', () => {
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2023-02-29')).toBe(false);
    expect(isIsoDate('2024-1-02')).toBe(false);
    expect(axisDate('2024-01-30', 3)).toBe('2024-02-02');
    expect(dayOffset('2024-01-30', '2024-02-02')).toBe(3);
    expect(dayOffset('2023-12-31', '2026-12-31')).toBe(1096);
  });
});

describe('결과 스냅샷 검사', () => {
  it('고정 데이터는 통과한다(자금 숨김 포함)', () => {
    expect(checkShareSnapshot(simResultFixture(), 'simResult', NOW).ok).toBe(true);
    expect(checkShareSnapshot(simResultFixture({ capitalHidden: true }), 'simResult', NOW).ok).toBe(true);
    expect(checkShareSnapshot(validationFixture(), 'validation', NOW).ok).toBe(true);
  });

  it('새 타입의 키는 금지 키와 겹치지 않고, 결과 안 아무 곳의 token은 forbidden-field', () => {
    const keys = new Set([...allKeys(simResultFixture()), ...allKeys(validationFixture())]);
    const forbidden = new Set(FORBIDDEN_KEYS.map((k) => k.toLowerCase()));
    for (const k of keys) expect(forbidden.has(k.toLowerCase()), k).toBe(false);
    expect(sim((s) => (s.result.nearMiss = { token: 'x' }))).toMatchObject({ code: 'forbidden-field', path: 'result.nearMiss.token' });
  });

  it('거래 이유에 UUID가 있으면 reference', () => {
    expect(sim((s) => (s.result.trades[0][6] = crypto.randomUUID()))).toMatchObject({ code: 'reference' });
  });

  it('필드를 더하면 unknown-field, 빼면 invalid', () => {
    expect(sim((s) => (s.result.extra = 1))).toMatchObject({ code: 'unknown-field', path: 'result.extra' });
    expect(sim((s) => delete s.result.nearMiss)).toMatchObject({ code: 'invalid', path: 'result.nearMiss' });
    expect(sim((s) => (s.run.x = 1))).toMatchObject({ code: 'unknown-field', path: 'run.x' });
    expect(val((s) => (s.result.hold.extra = 1))).toMatchObject({ code: 'unknown-field', path: 'result.hold.extra' });
  });

  it.each<[string, Edit, string]>([
    ['축 첫 점이 0이 아님', (s) => (s.result.axis.offsets[0] = 1), 'result.axis'],
    ['축이 오름차순이 아님', (s) => (s.result.axis.offsets[2] = 1), 'result.axis'],
    ['축 시작 날짜가 틀림', (s) => (s.result.axis.start = '2024-13-01'), 'result.axis'],
    ['축 길이가 AXIS_MAX 초과', (s) => (s.result.axis.offsets = Array.from({ length: 3701 }, (_, i) => i)), 'result.axis'],
    ['곡선 길이가 축과 다름', (s) => s.result.curves.strategy.pop(), 'result.curves.strategy'],
    ['곡선 소수 셋째 자리', (s) => (s.result.curves.strategy[1] = 1.234), 'result.curves.strategy'],
    ['주 곡선에 null', (s) => (s.result.curves.hold[1] = null), 'result.curves.hold'],
    ['요약 소수 셋째 자리', (s) => (s.result.summary.totalReturnPct = 4.123), 'result.summary.totalReturnPct'],
    ['요약 횟수가 정수가 아님', (s) => (s.result.summary.wins = 1.5), 'result.summary.wins'],
    ['솎기 from이 점 수 이하', (s) => (s.result.sampled = { from: 5 }), 'result.sampled'],
    ['run.from이 축 첫날과 다름', (s) => (s.run.from = '2024-01-03'), 'run.from'],
    ['run.to가 축 마지막 날과 다름', (s) => (s.run.to = '2024-01-11'), 'run.to'],
    ['출처가 비었음', (s) => (s.run.source = ''), 'run.source'],
    ['demo가 boolean 아님', (s) => (s.run.demo = 1), 'run.demo'],
    ['fetchedAt이 양의 정수가 아님', (s) => (s.run.fetchedAt = 0), 'run.fetchedAt'],
    ['symbols가 전략 종목과 다름', (s) => s.result.symbols.reverse(), 'result.symbols'],
    ['거래 날짜가 축 밖', (s) => (s.result.trades[3][0] = 11), 'result.trades[3]'],
    ['거래 날짜가 거꾸로', (s) => (s.result.trades[1][0] = 0), 'result.trades[1]'],
    ['모르는 거래 종류', (s) => (s.result.trades[0][2] = 'sell'), 'result.trades[0]'],
    ['매수에 단계', (s) => (s.result.trades[0][3] = 1), 'result.trades[0]'],
    ['익절에 단계 없음', (s) => (s.result.trades[3][3] = null), 'result.trades[3]'],
    ['손절에 단계', (s) => (s.result.trades[2][3] = 1), 'result.trades[2]'],
    ['갭 손절에 단계', (s) => ((s.result.trades[2][2] = 'gapStop'), (s.result.trades[2][3] = 1)), 'result.trades[2]'],
    ['갭 익절에 단계 없음', (s) => ((s.result.trades[3][2] = 'gapTake'), (s.result.trades[3][3] = null)), 'result.trades[3]'],
    ['단계가 4', (s) => (s.result.trades[3][3] = 4), 'result.trades[3]'],
    ['매도에 손익 없음', (s) => (s.result.trades[2][7] = null), 'result.trades[2]'],
    ['매수에 손익', (s) => (s.result.trades[0][7] = 1), 'result.trades[0]'],
    ['추가 매수에 손익', (s) => ((s.result.trades[0][2] = 'add'), (s.result.trades[0][7] = 1)), 'result.trades[0]'],
    ['갭 익절에 손익 없음', (s) => ((s.result.trades[3][2] = 'gapTake'), (s.result.trades[3][7] = null)), 'result.trades[3]'],
    ['가격이 정수가 아님', (s) => (s.result.trades[0][4] = 70000.5), 'result.trades[0]'],
    ['수량이 0', (s) => (s.result.trades[0][5] = 0), 'result.trades[0]'],
    ['이유가 40자 넘음', (s) => (s.result.trades[0][6] = '가'.repeat(41)), 'result.trades[0]'],
    ['종목별 길이가 symbols − failed와 다름', (s) => s.result.perSymbol.pop(), 'result.perSymbol'],
    ['종목별 순서가 거꾸로', (s) => s.result.perSymbol.reverse(), 'result.perSymbol'],
    ['종목별 round trip이 음수', (s) => (s.result.perSymbol[0][3] = -1), 'result.perSymbol[0]'],
    ['failed가 종목별과 겹침', (s) => (s.result.failed = [{ symbol: '005930', reason: '받지 못했어요' }]), 'result.failed'],
    ['failed 이유가 모르는 값', (s) => (s.result.failed[0].reason = '없음'), 'result.failed[0]'],
    ['건너뜀 개수 합이 요약과 다름', (s) => (s.result.summary.skippedSignals = 4), 'result.skipped.counts'],
    ['건너뜀 이유 순서가 틀림', (s) => s.result.skipped.counts.reverse(), 'result.skipped.counts'],
    ['건너뜀 개수가 음수', (s) => (s.result.skipped.counts[0][1] = -1), 'result.skipped.counts'],
    ['건너뜀 개수가 소수', (s) => (s.result.skipped.counts[0][1] = 1.5), 'result.skipped.counts'],
    ['건너뜀 목록과 개수가 다름', (s) => (s.result.skipped.rows[2][2] = 1), 'result.skipped.rows'],
    ['지수 실패 값이 모르는 문구', (s) => (s.result.indexFailed = '없음'), 'result.indexFailed'],
  ])('시뮬레이션 대응 검사: %s → invalid', (_name, edit, path) => {
    expect(sim(edit)).toMatchObject({ ok: false, code: 'invalid', path });
  });

  it.each<[string, Edit, string]>([
    ['거래 종목 위치가 범위 밖', (s) => (s.result.trades[0][1] = 3), 'result.trades[0]'],
    ['종목별 종목 위치가 범위 밖', (s) => (s.result.perSymbol[1][0] = 9), 'result.perSymbol[1]'],
    ['건너뜀 종목 위치가 범위 밖', (s) => (s.result.skipped.rows[0][1] = 3), 'result.skipped.rows[0]'],
    ['failed 종목이 symbols 밖', (s) => (s.result.failed[0].symbol = '035720'), 'result.failed[0]'],
  ])('시뮬레이션 참조: %s → reference', (_name, edit, path) => {
    expect(sim(edit)).toMatchObject({ ok: false, code: 'reference', path });
  });

  it('자금 숨김이면 수량·종목별 손익은 null이어야 하고, 아니면 숫자여야 한다', () => {
    expect(sim((s) => (s.result.trades[0][5] = 14), true)).toMatchObject({ code: 'invalid', path: 'result.trades[0]' });
    expect(sim((s) => (s.result.perSymbol[0][1] = 1), true)).toMatchObject({ code: 'invalid', path: 'result.perSymbol[0]' });
    expect(sim((s) => (s.result.trades[0][5] = null))).toMatchObject({ code: 'invalid', path: 'result.trades[0]' });
    expect(sim((s) => (s.result.perSymbol[0][1] = null))).toMatchObject({ code: 'invalid', path: 'result.perSymbol[0]' });
  });

  it('결과 종목 코드: 소문자·경로 문자열·중복은 거절, ETN은 통과', () => {
    for (const symbols of [['abc123', '000660', 'Q500023'], ['005930', '005930', 'Q500023']]) {
      const { result } = simResultFixture();
      result.symbols = symbols;
      expect(checkSimResult(result, { universe: symbols, capitalHidden: false })).toEqual({ code: 'invalid', path: 'result.symbols' });
    }
    const { result } = simResultFixture();
    result.failed[0].symbol = '../x';
    expect(checkSimResult(result, { universe: result.symbols, capitalHidden: false })).toEqual({ code: 'invalid', path: 'result.failed[0]' });
    expect(val((s) => (s.result.today.picks[0].symbol = '../x'))).toMatchObject({ code: 'invalid', path: 'result.today.picks[0]' });
    expect(val((s) => (s.result.rebalances[0].picks[1][0] = '005930'))).toMatchObject({ code: 'invalid', path: 'result.rebalances[0].picks' });
    expect(checkShareSnapshot(simResultFixture(), 'simResult', NOW).ok).toBe(true); // Q500023 포함
  });

  it.each<[string, Edit, string]>([
    ['축 길이가 AXIS_MAX 초과', (s) => (s.result.axis.offsets = Array.from({ length: 3701 }, (_, i) => i)), 'result.axis'],
    ['지수 순서가 기준과 다름', (s) => (s.result.indices[0].id = 'KOSDAQ'), 'result.indices[0]'],
    ['지수 개수가 기준과 다름', (s) => s.result.indices.push({ ...s.result.indices[0] }), 'result.indices'],
    ['지정 ETF 순서가 기준과 다름', (s) => (s.result.benchmarks[0].symbol = '229200'), 'result.benchmarks[0]'],
    ['지정 ETF 개수가 기준과 다름', (s) => s.result.benchmarks.pop(), 'result.benchmarks'],
    ['곡선 없음인데 이유 없음', (s) => (s.result.benchmarks[0].reason = null), 'result.benchmarks[0].reason'],
    ['곡선 있음인데 통계 없음', (s) => (s.result.indices[0].stats = null), 'result.indices[0].stats'],
    ['ETF 이름이 30자 넘음', (s) => (s.result.benchmarks[0].name = 'x'.repeat(31)), 'result.benchmarks[0]'],
    ['시장별 순서가 틀림', (s) => s.result.byMarket.reverse(), 'result.byMarket[0]'],
    ['시장별 개수가 다름', (s) => s.result.byMarket.pop(), 'result.byMarket'],
    ['시장별 평균이 음수', (s) => (s.result.byMarket[0].avgPicked = -1), 'result.byMarket[0]'],
    ['모르는 안내', (s) => s.result.notes.push('magic'), 'result.notes'],
    ['안내 중복', (s) => s.result.notes.push('survivorship'), 'result.notes'],
    ['재선정일이 축 밖 날짜', (s) => (s.result.rebalances[1].day = 27), 'result.rebalances[1]'],
    ['재선정일이 거꾸로', (s) => (s.result.rebalances[1].day = 0), 'result.rebalances[1]'],
    ['선정 수가 통과 수보다 많음', (s) => (s.result.rebalances[0].passed = 1), 'result.rebalances[0]'],
    ['이력 수준과 모양이 다름', (s) => (s.result.history = 'codes'), 'result.rebalances[0].picks'],
    ['계산값 뺌인데 값이 있음', (s) => (s.result.history = 'noValues'), 'result.rebalances[0].picks[0]'],
    ['ValuePairs 길이가 홀수', (s) => s.result.rebalances[0].picks[0][3].pop(), 'result.rebalances[0].picks[0]'],
    ['ValuePairs 키 위치가 범위 밖', (s) => (s.result.rebalances[0].picks[0][3][0] = 9), 'result.rebalances[0].picks[0]'],
    ['ValuePairs 키가 겹침', (s) => (s.result.rebalances[0].picks[0][3][2] = 0), 'result.rebalances[0].picks[0]'],
    ['정수 키에 소수', (s) => (s.result.rebalances[0].picks[0][3][7] = 202406.5), 'result.rebalances[0].picks[0]'],
    ['4자리 키에 5자리', (s) => (s.result.rebalances[0].picks[0][3][3] = -12.345), 'result.rebalances[0].picks[0]'],
    ['boolean 키에 숫자', (s) => (s.result.rebalances[0].picks[0][3][5] = 1), 'result.rebalances[0].picks[0]'],
    ['목록 밖 값 키', (s) => (s.result.valueKeys[0] = '__proto__'), 'result.valueKeys'],
    ['값 키 중복', (s) => (s.result.valueKeys[1] = 'tradingValue'), 'result.valueKeys'],
    ['오늘 날짜가 틀림', (s) => (s.result.today.date = '2026-02-30'), 'result.today.date'],
    ['오늘 선정이 통과 수보다 많음', (s) => (s.result.today.passed = 0), 'result.today'],
    ['오늘 선정 종목 중복', (s) => s.result.today.picks.push({ ...s.result.today.picks[0] }), 'result.today.picks[1]'],
    ['비교 우위 횟수가 전체보다 많음', (s) => (s.result.hold.beat.beat = 3), 'result.hold.beat'],
    ['② 횟수가 음수', (s) => (s.result.trading = { curve: [0, 0, 0, 0], stats: s.result.hold.stats, trades: -1, skipCounts: [] }), 'result.trading.trades'],
    ['② 건너뜀 개수가 음수', (s) => (s.result.trading = { curve: [0, 0, 0, 0], stats: s.result.hold.stats, trades: 0, skipCounts: [['현금 부족', -1]] }), 'result.trading.skipCounts'],
    ['② 건너뜀 개수가 소수', (s) => (s.result.trading = { curve: [0, 0, 0, 0], stats: s.result.hold.stats, trades: 0, skipCounts: [['현금 부족', 1.5]] }), 'result.trading.skipCounts'],
    ['표시 없음 mark가 2', (s) => (s.result.rebalances[0].picks[0][2] = 2), 'result.rebalances[0].picks[0]'],
  ])('검증 대응 검사: %s → invalid', (_name, edit, path) => {
    expect(val(edit)).toMatchObject({ ok: false, code: 'invalid', path });
  });

  describe.each(['indices', 'benchmarks'] as const)('%s의 곡선·이유·통계 세부 경로', (key) => {
    it.each<[string, Edit, string]>([
      ['곡선과 이유가 모두 있음', (row) => (row.reason = '받지 못했어요'), 'reason'],
      ['곡선이 null인데 이유 없음', (row) => (row.curve = null), 'reason'],
      ['곡선이 null인데 통계 있음', (row) => ((row.curve = null), (row.reason = '받지 못했어요')), 'stats'],
      ['곡선 길이가 축과 다름', (row) => row.curve.pop(), 'curve'],
      ['통계 없음', (row) => (row.stats = null), 'stats'],
      ['통계 소수 셋째 자리', (row) => (row.stats.totalPct = 1.234), 'stats.totalPct'],
    ])('%s → invalid', (_name, edit, path) => {
      expect(val((s) => {
        const row = s.result[key][0];
        Object.assign(row, { curve: [...s.result.hold.curve], reason: null, stats: { ...s.result.hold.stats } });
        edit(row);
      })).toMatchObject({ ok: false, code: 'invalid', path: `result.${key}[0].${path}` });
    });

    it('모르는 통계 필드의 코드와 경로를 보존한다', () => {
      expect(val((s) => Object.assign(s.result[key][0], {
        curve: [...s.result.hold.curve], reason: null, stats: { ...s.result.hold.stats, extra: 1 },
      }))).toMatchObject({ ok: false, code: 'unknown-field', path: `result.${key}[0].stats.extra` });
    });
  });

  it('값 반올림 규칙: 정수 키는 그대로, 4자리 키는 4자리면 통과', () => {
    expect(val((s) => (s.result.rebalances[0].picks[0][3] = [3, 202406, 1, -12.35]))).toMatchObject({ ok: true });
    expect(val((s) => ((s.result.valueKeys = ['leaderRank', 'flowStreak', 'marketCap']), (s.result.rebalances[0].picks[0][3] = [0, 3, 1, 12, 2, 1234000]), (s.result.rebalances[0].picks[1][3] = []), (s.result.today.picks[0].values = [])))).toMatchObject({ ok: true });
  });

  it('코드만 이력은 종목 코드 배열이고 오늘 선정은 계산값을 담는다', () => {
    expect(val((s) => ((s.result.history = 'codes'), (s.result.rebalances[0].picks = ['005930', '000660'])))).toMatchObject({ ok: true });
    expect(val((s) => ((s.result.history = 'noValues'), (s.result.rebalances[0].picks = [['005930', 5.5, 1, null]])))).toMatchObject({ ok: true });
  });

  it('검증 묶음에 ETN이 있으면 거절한다', () => {
    expect(val((s) => (s.baskets[0].symbols = ['Q500023']))).toMatchObject({ code: 'invalid', path: 'baskets[0].symbols' });
  });

  it('검증 결과의 기준은 read 모드에서 빠진 필드를 채워 받는다', () => {
    const s = validationFixture() as any;
    delete s.criteria.costs;
    expect(checkShareSnapshot(s, 'validation', NOW, 'create')).toMatchObject({ ok: false, path: 'criteria.costs' });
    expect(checkShareSnapshot(s, 'validation', NOW, 'read').ok).toBe(true);
  });
});
