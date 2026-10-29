import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SimFailureReason } from '../sim/loadSimData';
import type { Skip, Trade } from '../sim/types';
import type { NotBoughtReason } from '../screen/holdSelection';
import type { ByMarketKey, MissingReason, ValidationNote } from '../screen/runValidation';
import type { Market } from '../screen/types';
import {
  BY_MARKET_KEYS,
  MARKETS,
  MISSING_REASONS,
  NOT_BOUGHT_REASONS,
  SELL_KINDS,
  SHARE_SYMBOL_RE,
  SIM_FAILURE_REASONS,
  SKIP_REASONS,
  TRADE_KINDS,
  VALIDATION_NOTES,
  VALUE_KEY_RULE,
  VALUE_KEYS,
  type ValueRule,
} from './resultEnums';

// 두 타입이 정확히 같아야 true. 원래 타입에 값이 늘거나 줄면 `corepack pnpm check`가 실패한다.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const tradeKinds: Same<(typeof TRADE_KINDS)[number], Trade['kind']> = true;
const sellKinds: Same<(typeof SELL_KINDS)[number], Exclude<Trade['kind'], 'buy' | 'add'>> = true;
const skipReasons: Same<(typeof SKIP_REASONS)[number], Skip['reason']> = true;
const simFailure: Same<(typeof SIM_FAILURE_REASONS)[number], SimFailureReason> = true;
const missing: Same<(typeof MISSING_REASONS)[number], MissingReason> = true;
const notBought: Same<(typeof NOT_BOUGHT_REASONS)[number], NotBoughtReason> = true;
const byMarket: Same<(typeof BY_MARKET_KEYS)[number], ByMarketKey> = true;
const markets: Same<(typeof MARKETS)[number], Market> = true;
const notes: Same<(typeof VALIDATION_NOTES)[number], ValidationNote> = true;
const valueRule: Same<(typeof VALUE_KEY_RULE)[string], ValueRule | undefined> = true;

describe('결과 열거값', () => {
  it('원래 타입과 같다(타입 검사) · 배열에 중복이 없다', () => {
    expect([tradeKinds, sellKinds, skipReasons, simFailure, missing, notBought, byMarket, markets, notes].every(Boolean)).toBe(true);
    for (const list of [TRADE_KINDS, SELL_KINDS, SKIP_REASONS, SIM_FAILURE_REASONS, MISSING_REASONS, NOT_BOUGHT_REASONS, BY_MARKET_KEYS, MARKETS, VALIDATION_NOTES])
      expect(new Set(list).size).toBe(list.length);
    expect(BY_MARKET_KEYS).toEqual(['KOSPI', 'KOSDAQ', 'ETF']);
  });

  it('값 키 규칙: 정수 키·boolean 키·4자리 키', () => {
    expect(valueRule).toBe(true);
    expect(VALUE_KEY_RULE.finQuarter).toBe('int');
    expect(VALUE_KEY_RULE.leaderRank).toBe('int');
    expect(VALUE_KEY_RULE.flowStreak).toBe('int');
    expect(VALUE_KEY_RULE.rebound).toBe('bool');
    expect(VALUE_KEY_RULE.marketCap).toBe('sig4');
    expect(VALUE_KEY_RULE.return).toBe('sig4');
    expect(Object.hasOwn(VALUE_KEY_RULE, '__proto__')).toBe(false);
    expect(Object.hasOwn(VALUE_KEY_RULE, 'toString')).toBe(false);
    expect(new Set(VALUE_KEYS.map(([k]) => k)).size).toBe(VALUE_KEYS.length);
  });

  it('select.ts가 만드는 값 키는 모두 VALUE_KEYS에 있다', () => {
    const src = readFileSync(new URL('../screen/select.ts', import.meta.url), 'utf8');
    const direct = [...src.matchAll(/values\.(\w+)/g)].map((m) => m[1]);
    const ranged = [...src.matchAll(/'(fin[A-Z]\w*)'\)\) return/g)].map((m) => m[1]);
    const macro = ['usdkrw', 'wti'].flatMap((k) => [`${k}Trend`, `${k}Beta`]);
    const made = new Set([...direct, ...ranged, ...macro]);
    expect(made.size).toBeGreaterThan(20);
    for (const k of made) expect(Object.hasOwn(VALUE_KEY_RULE, k), k).toBe(true);
    // 동적 키(values[...])가 새로 생기면 위 목록 만들기를 고쳐야 한다: 지금은 Trend·Beta 템플릿 3곳과 범위 함수 1곳뿐이다
    expect(src.match(/values\[/g)?.length).toBe(4);
  });

  it('공유 종목 정규식: 6자리와 ETN(Q + 6자리)만', () => {
    for (const ok of ['005930', '0000J0', 'Q500023']) expect(SHARE_SYMBOL_RE.test(ok), ok).toBe(true);
    for (const bad of ['../x', '005930 ', 'q500023', 'Q5000', 'Q5000234', '12345', '0059301', '']) expect(SHARE_SYMBOL_RE.test(bad), bad).toBe(false);
  });
});
