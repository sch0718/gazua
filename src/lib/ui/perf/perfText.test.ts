import { describe, expect, it } from 'vitest';
import { ApiError } from '../../providers/errors';
import { axisWon, irrText, perfErrorText, periodText, ppText, signClass, signedWon } from './perfText';

describe('perfText', () => {
  it('formats rates, money and differences', () => {
    expect(irrText(0.1234)).toBe('+12.3%');
    expect(irrText(-0.05)).toBe('−5.0%');
    expect(irrText(null)).toBe('계산할 수 없어요');
    expect(signedWon(141000.4)).toBe('+141,000원');
    expect(signedWon(-88000)).toBe('−88,000원');
    expect(signedWon(0.3)).toBe('0원');
    expect(ppText(4.21)).toBe('+4.2%p');
    expect(ppText(null)).toBe('—');
    expect(axisWon(123_456_789)).toBe('1.23억');
    expect(axisWon(12_345_678)).toBe('1,235만');
    expect(axisWon(9_999)).toBe('9,999원');
    expect(signClass(0.04)).toBe('');
    expect(signClass(-3)).toBe('down');
    expect(periodText({ irr: 0.1, periodReturn: 0.041, profit: 0, invested: 0, endValue: 0 })).toBe('기간 +4.1%');
    expect(periodText({ irr: 0.1, periodReturn: null, profit: 0, invested: 0, endValue: 0 })).toBeNull();
  });

  it('explains a blocked proxy path, and uses the shared error titles otherwise', () => {
    expect(perfErrorText(new ApiError('path-blocked'))).toBe('프록시가 주문 조회를 막고 있어요 · 프록시를 새 버전으로 바꿔 주세요');
    expect(perfErrorText(new ApiError('timeout'))).toBe('응답이 늦어요');
    expect(perfErrorText(new Error('x'))).toBe('계좌 내역을 받지 못했어요');
  });
});
