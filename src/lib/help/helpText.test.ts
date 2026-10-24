import { describe, expect, it } from 'vitest';
import { parseHelpText } from './helpText';

describe('parseHelpText', () => {
  it('splits button names, bold text and links out of plain text', () => {
    expect(parseHelpText('`＋ 종목 추가`를 눌러요')).toEqual([
      { kind: 'key', text: '＋ 종목 추가' },
      { kind: 'text', text: '를 눌러요' },
    ]);
    expect(parseHelpText('주문 목록 **조회**만 전달해요')).toEqual([
      { kind: 'text', text: '주문 목록 ' },
      { kind: 'strong', text: '조회' },
      { kind: 'text', text: '만 전달해요' },
    ]);
    expect(parseHelpText('방법은 [개발 문서](https://github.com/sch0718/gazua/blob/main/docs/development.md#x)에 있어요')).toEqual([
      { kind: 'text', text: '방법은 ' },
      { kind: 'link', text: '개발 문서', href: 'https://github.com/sch0718/gazua/blob/main/docs/development.md#x' },
      { kind: 'text', text: '에 있어요' },
    ]);
  });

  it('keeps a lone backtick or bracket as text and drops links that are not https', () => {
    expect(parseHelpText('a ` b')).toEqual([{ kind: 'text', text: 'a ` b' }]);
    expect(parseHelpText('[x](javascript:alert(1))')).toEqual([{ kind: 'text', text: 'x' }]);
  });
});
