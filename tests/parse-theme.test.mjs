import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseThemes, parseThemesDetailed } from '../scripts/parse-theme.mjs';

test('실제 파일 fixture를 테마별로 묶는다', () => {
  const themes = parseThemes(readFileSync(new URL('./fixtures/theme_code.sample.mst', import.meta.url)));
  assert.equal(themes.length, 2);
  assert.deepEqual(themes[0], { code: '027', name: '2018 신규 상장주', symbols: ['027360', '110790'] });
  assert.equal(themes[1].code, '989');
  assert.equal(themes[1].name, '2차전지(소재,부품,장비)');
  assert.deepEqual(themes[1].symbols, ['047310']);
});

test('종목코드의 A 접두를 떼고 6자리로 만든다, CRLF도 받는다', () => {
  const pad = (s, n) => s.padEnd(n, ' ');
  const row = (c, n, s) => `${c}${pad(n, 40)}${pad(s, 9)}\r\n`;
  const bytes = Buffer.from(row('001', 'HBM', 'A005930') + row('001', 'HBM', '000660') + row('001', 'HBM', 'A005930'), 'ascii');
  assert.deepEqual(parseThemes(bytes), [{ code: '001', name: 'HBM', symbols: ['005930', '000660'] }]);
});

test('영문자·숫자 6자리 코드(ETF 0000D0)는 남기고, 6자리가 아닌 행은 버리며 센다', () => {
  const pad = (s, n) => s.padEnd(n, ' ');
  const row = (c, n, s) => `${c}${pad(n, 40)}${pad(s, 9)}\n`;
  const bytes = Buffer.from(row('001', 'ETF', '0000D0') + row('001', 'ETF', 'A0000D1') + row('001', 'ETF', '12345') + row('002', '빈', 'A12') , 'ascii');
  const { themes, dropped } = parseThemesDetailed(bytes);
  assert.deepEqual(themes, [{ code: '001', name: 'ETF', symbols: ['0000D0', '0000D1'] }]);
  assert.equal(dropped, 2);
  assert.deepEqual(parseThemes(bytes), themes);
});
