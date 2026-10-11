import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMaster } from './parse-master.mjs';

const fixture = (name) => new Uint8Array(readFileSync(new URL(`../tests/fixtures/${name}`, import.meta.url)));

describe('parseMaster', () => {
  it('parses KOSPI rows by byte offsets and drops fund rows', () => {
    expect(parseMaster(fixture('kospi_code.sample.mst'), 'KOSPI')).toEqual([
      { s: '000660', n: 'SK하이닉스', m: 'KOSPI', t: 'STOCK' },
      { s: '005930', n: '삼성전자', m: 'KOSPI', t: 'STOCK' },
      { s: '005935', n: '삼성전자우', m: 'KOSPI', t: 'STOCK' },
      { s: '069500', n: 'KODEX 200', m: 'KOSPI', t: 'ETF' },
    ]);
  });

  it('parses KOSDAQ rows with the 221-byte tail', () => {
    expect(parseMaster(fixture('kosdaq_code.sample.mst'), 'KOSDAQ')).toEqual([
      { s: '247540', n: '에코프로비엠', m: 'KOSDAQ', t: 'STOCK' },
      { s: '900110', n: '딥커머스', m: 'KOSDAQ', t: 'OTHER' },
    ]);
  });

  it('accepts CRLF line endings and a missing final newline', () => {
    const text = new TextDecoder('latin1').decode(fixture('kospi_code.sample.mst'));
    const crlf = Uint8Array.from(text.replace(/\n/g, '\r\n').trimEnd(), (c) => c.charCodeAt(0));
    expect(parseMaster(crlf, 'KOSPI').map((r) => r.s)).toEqual(['000660', '005930', '005935', '069500']);
  });

  it('returns an empty list for empty input', () => {
    expect(parseMaster(new Uint8Array(), 'KOSPI')).toEqual([]);
  });
});
