import { describe, expect, it } from 'vitest';
import { agoText, cliCodeComplete, formatCliCode } from './cliCode';

describe('formatCliCode', () => {
  it.each([
    ['', ''], ['b', 'B'], ['bcdf', 'BCDF'], ['bcdfg', 'BCDF-G'],
    ['bcdf ghjk', 'BCDF-GHJK'], ['bcdf-ghjk', 'BCDF-GHJK'],
    ['bcdfghjklmn', 'BCDF-GHJK'], ['12bc!', 'BC'],
  ])('%j → %j', (raw, want) => expect(formatCliCode(raw)).toBe(want));
});
describe('cliCodeComplete', () => {
  it('자음 20자로 된 XXXX-XXXX만 완성으로 본다', () => {
    expect(cliCodeComplete('BCDF-GHJK')).toBe(true);
    expect(cliCodeComplete('BCDF-GHJ')).toBe(false);
    expect(cliCodeComplete('BCDFGHJK')).toBe(false);
    expect(cliCodeComplete('ABCD-EFGH')).toBe(false);
  });
});
describe('agoText', () => {
  it('방금 · N분 전 · N시간 전', () => {
    expect(agoText(1000, 1000)).toBe('방금');
    expect(agoText(0, 59_999)).toBe('방금');
    expect(agoText(0, 120_000)).toBe('2분 전');
    expect(agoText(0, 2 * 3600_000)).toBe('2시간 전');
    expect(agoText(5000, 1000)).toBe('방금');
  });
});
