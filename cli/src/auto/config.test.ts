import { describe, expect, it } from 'vitest';
import { readAutoConfig } from './config';

describe('자동 실행 설정', () => {
  it('전략은 필수이고 기본은 연습 모드다', () => {
    expect(() => readAutoConfig({})).toThrow();
    expect(readAutoConfig({ AUTO_STRATEGY: ' 전략 ', AUTO_INTERVAL_MIN: '2' })).toEqual({ strategy: '전략', mode: 'dry', buySlipPct: 1, sellSlipPct: 2 });
  });
  it('모드 오타를 거절한다', () => {
    expect(() => readAutoConfig({ AUTO_STRATEGY: '전략', AUTO_MODE: 'lve' })).toThrow();
  });
  it('모르는 AUTO_ 키를 거절한다', () => {
    expect(() => readAutoConfig({ AUTO_STRATEGY: '전략', AUTO_BUY_SLIPAGE_PCT: '2' })).toThrow();
  });
  it('가격 여유 범위를 검증한다', () => {
    expect(readAutoConfig({ AUTO_STRATEGY: '전략', AUTO_PROFILE: '내 프로필', AUTO_MODE: 'live', AUTO_BUY_SLIPPAGE_PCT: '0', AUTO_SELL_SLIPPAGE_PCT: '10' })).toEqual({ strategy: '전략', profile: '내 프로필', mode: 'live', buySlipPct: 0, sellSlipPct: 10 });
    for (const [key, value] of [['AUTO_BUY_SLIPPAGE_PCT', '5.1'], ['AUTO_SELL_SLIPPAGE_PCT', '-1'], ['AUTO_BUY_SLIPPAGE_PCT', ''], ['AUTO_SELL_SLIPPAGE_PCT', 'NaN']]) {
      expect(() => readAutoConfig({ AUTO_STRATEGY: '전략', [key]: value })).toThrow();
    }
  });
});
