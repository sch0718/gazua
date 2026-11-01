// 조건식 평가기(전략 빌더 스펙 §4.1). PatternTracker와 같은 계약(signal/update/reset)이라 엔진이 그 자리에 그대로 넣는다.
// 반등 패턴 블록은 기존 createPatternTracker를 감싸 판정·상태·통계를 바꾸지 않는다.
import type { Candle } from '../data/metrics';
import { rollingMax, rsi, sma, volumeRatio } from './indicators';
import { createPatternTracker, type PatternTracker } from './pattern';
import type { Cond, CondGroup, PatternEntry } from './strategyV2';
import type { PatternSnapshot } from './types';

/** RSI는 기간 첫날 앞 이만큼의 봉에서 평활을 시작한다(스펙 §5.1) */
export const RSI_START_BARS = 250;
/** 체결 사유 상한. 공유 검사(checkResult.REASON_MAX)와 같아야 한다(테스트가 확인) */
export const REASON_MAX = 40;
/** 「이상·이하」 비교의 부동소수 여유 */
const EPS = 1e-9;

export interface RuleEvaluator {
  /** i번째 봉 종가로 묶음을 판정한다. 처음 맞은 묶음의 사유(패턴 블록이 맞았으면 스냅샷도). 상태는 바꾸지 않는다 */
  signal(i: number): { reason: string; snapshot?: PatternSnapshot } | null;
  /** i번째 봉 종가로 상태를 갱신한다. 판정과 상관없이 봉이 있는 날마다 부른다 */
  update(i: number): void;
  /** 전량 매도한 날 i에 부른다 */
  reset(i: number): void;
  /** 패턴 블록 통계(nearMiss). 패턴 블록이 없으면 null */
  stats(): { maxDropPct: number; declineDays: number } | null;
  resetStats(): void;
}

const signed = (x: number): string => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x)}%`;
const RSI_OP: Record<Extract<Cond, { kind: 'rsi' }>['op'], string> = { above: '위', below: '아래', crossUp: '상향 돌파', crossDown: '하향 돌파' };

/** 조건 한 줄의 사유 문구(스펙 §4.7). 패턴 블록은 추적기 사유를 쓰므로 여기서는 이름만 */
export function condReason(c: Cond): string {
  switch (c.kind) {
    case 'maPrice':
      return `종가 ${c.period}일선 ${c.side === 'above' ? '위' : '아래'}`;
    case 'maCross':
      return `${c.dir === 'golden' ? '골든' : '데드'}크로스 ${c.short}/${c.long}`;
    case 'rsi':
      return `RSI${c.period} ${c.level} ${RSI_OP[c.op]}`;
    case 'volume':
      return `거래량 ${c.days}일 평균 ${c.ratio}배↑`;
    case 'change':
      return `${c.days}일 ${signed(c.pct)} ${c.op === 'above' ? '이상' : '이하'}`;
    case 'fromHigh':
      return `${c.days}일 고점 −${c.pct}%↓`;
    case 'newHigh':
      return `${c.days}일 신고가`;
    case 'pattern':
      return '반등 패턴';
  }
}

/** 패턴 블록이 쓰는 켜진 이동평균 기간 중 최댓값(지금 loadSimData.longestMa와 같은 규칙) */
function patternLookback(e: PatternEntry): number {
  const periods = [0];
  if (e.triggers.maCross.on) periods.push(e.triggers.maCross.period);
  if (e.triggers.goldenCross.on) periods.push(e.triggers.goldenCross.short, e.triggers.goldenCross.long);
  if (e.filter.aboveMa.on) periods.push(e.filter.aboveMa.period);
  return Math.max(...periods);
}

/** 조건 하나가 기간 첫날 앞에 필요로 하는 봉 수(스펙 §5.4) */
export function condLookback(c: Cond): number {
  switch (c.kind) {
    case 'maPrice':
      return c.period;
    case 'maCross':
      return Math.max(c.short, c.long);
    case 'rsi':
      return RSI_START_BARS + 1;
    case 'volume':
    case 'change':
    case 'newHigh':
      return c.days + 1;
    case 'fromHigh':
      return c.days;
    case 'pattern':
      return patternLookback(c.entry);
  }
}

export function rulesLookback(groups: CondGroup[]): number {
  let L = 0;
  for (const g of groups) for (const c of g.conds) L = Math.max(L, condLookback(c));
  return L;
}

const cut = (s: string): string => (s.length > REASON_MAX ? `${s.slice(0, REASON_MAX - 1)}…` : s);

interface Compiled {
  cond: Cond;
  check: (t: number) => boolean;
  tracker: PatternTracker | null;
}

/**
 * 종목 하나의 봉 배열에 묶음 목록을 건다. firstDayIdx는 그 배열에서 기간 첫날(이상인 첫 봉)의 인덱스로, RSI 시작점에 쓴다.
 * 지표 배열은 만들 때 한 번 계산하고 같은 기간이면 같이 쓴다.
 */
export function createRuleEvaluator(candles: Candle[], groups: CondGroup[], firstDayIdx: number): RuleEvaluator {
  const c = candles.map((k) => k.c);
  const v = candles.map((k) => k.v);
  const memo = new Map<string, (number | null)[]>();
  const series = (key: string, make: () => (number | null)[]) => {
    let s = memo.get(key);
    if (!s) {
      s = make();
      memo.set(key, s);
    }
    return s;
  };
  const smaOf = (n: number) => series(`sma:${n}`, () => sma(c, n));
  const rsiOf = (n: number) => series(`rsi:${n}`, () => rsi(c, n, Math.max(0, firstDayIdx - RSI_START_BARS)));
  const volOf = (n: number) => series(`vol:${n}`, () => volumeRatio(v, n));
  const maxOf = (n: number) => series(`max:${n}`, () => rollingMax(c, n, n));
  const trackers: PatternTracker[] = [];

  const compile = (cond: Cond): Compiled => {
    const make = (check: (t: number) => boolean): Compiled => ({ cond, check, tracker: null });
    switch (cond.kind) {
      case 'maPrice': {
        const m = smaOf(cond.period);
        return make(cond.side === 'above' ? (t) => m[t] != null && c[t] > m[t]! : (t) => m[t] != null && c[t] < m[t]!);
      }
      case 'maCross': {
        const s = smaOf(cond.short);
        const l = smaOf(cond.long);
        return make((t) => {
          if (t < 1) return false;
          const s0 = s[t - 1];
          const s1 = s[t];
          const l0 = l[t - 1];
          const l1 = l[t];
          if (s0 == null || s1 == null || l0 == null || l1 == null) return false;
          return cond.dir === 'golden' ? s0 <= l0 && s1 > l1 : s0 >= l0 && s1 < l1;
        });
      }
      case 'rsi': {
        const r = rsiOf(cond.period);
        const L = cond.level;
        switch (cond.op) {
          case 'above':
            return make((t) => r[t] != null && r[t]! > L);
          case 'below':
            return make((t) => r[t] != null && r[t]! < L);
          case 'crossUp':
            return make((t) => t >= 1 && r[t - 1] != null && r[t] != null && r[t - 1]! <= L && r[t]! > L);
          case 'crossDown':
            return make((t) => t >= 1 && r[t - 1] != null && r[t] != null && r[t - 1]! >= L && r[t]! < L);
        }
        break;
      }
      case 'volume': {
        const x = volOf(cond.days);
        return make((t) => x[t] != null && x[t]! >= cond.ratio - EPS);
      }
      case 'change':
        return make((t) => {
          if (t < cond.days) return false;
          const p = (c[t] / c[t - cond.days] - 1) * 100;
          return cond.op === 'above' ? p >= cond.pct - EPS : p <= cond.pct + EPS;
        });
      case 'fromHigh': {
        const m = maxOf(cond.days);
        return make((t) => m[t] != null && (1 - c[t] / m[t]!) * 100 >= cond.pct - EPS);
      }
      case 'newHigh': {
        const m = maxOf(cond.days);
        return make((t) => t >= 1 && m[t - 1] != null && c[t] > m[t - 1]!);
      }
      case 'pattern': {
        const tracker = createPatternTracker(candles, cond.entry);
        trackers.push(tracker);
        return { cond, check: (t) => tracker.signal(t) !== null, tracker };
      }
    }
    throw new Error(`알 수 없는 조건: ${(cond as Cond).kind}`);
  };
  const compiled = groups.map((g) => g.conds.map(compile));

  return {
    signal(t) {
      for (const g of compiled) {
        if (g.length === 0) continue; // 빈 묶음은 맞지 않는다(실행은 경고가 막는다)
        const parts: string[] = [];
        let snapshot: PatternSnapshot | undefined;
        let ok = true;
        for (const x of g) {
          if (x.tracker) {
            const s = x.tracker.signal(t);
            if (!s) {
              ok = false;
              break;
            }
            snapshot ??= s.snapshot;
            parts.push(s.reason);
          } else if (x.check(t)) parts.push(condReason(x.cond));
          else {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        const reason = cut(parts.join(' + '));
        return snapshot ? { reason, snapshot } : { reason };
      }
      return null;
    },
    update(i) {
      for (const tr of trackers) tr.update(i);
    },
    reset(i) {
      for (const tr of trackers) tr.reset(i);
    },
    stats() {
      return trackers[0] ? trackers[0].stats() : null;
    },
    resetStats() {
      for (const tr of trackers) tr.resetStats();
    },
  };
}
