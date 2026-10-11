// KIS 종목 마스터 파일(kospi_code.mst / kosdaq_code.mst) 파서.
// 한 줄은 CP949 고정폭 바이트열이다. 줄 끝 개행을 뗀 뒤 "바이트 기준"으로 자른다.
//   앞부분: [0:9] 단축코드, [9:21] ISIN, [21:뒷부분 직전] 한글명
//   뒷부분: 시장별 고정 길이(KOSPI 227, KOSDAQ 221)이며 첫 2바이트가 그룹코드
// 2026-10-11 실제 파일 기준: 그룹코드는 뒷부분의 [0:2]에 있다.

const TAIL_LENGTH = { KOSPI: 227, KOSDAQ: 221 };
const GROUP_TYPE = { ST: 'STOCK', EF: 'ETF', EN: 'ETN', RT: 'REIT' };
const SYMBOL_PATTERN = /^[0-9A-Z]{6}$/;
const NL = 0x0a;
const CR = 0x0d;

const decoder = new TextDecoder('euc-kr');
const ascii = new TextDecoder('ascii');

/**
 * @param {Uint8Array} bytes
 * @param {'KOSPI'|'KOSDAQ'} market
 * @returns {{ s: string; n: string; m: 'KOSPI'|'KOSDAQ'; t: 'STOCK'|'ETF'|'ETN'|'REIT'|'OTHER' }[]}
 */
export function parseMaster(bytes, market) {
  const tailLength = TAIL_LENGTH[market];
  if (tailLength === undefined) throw new Error(`unknown market: ${market}`);

  const rows = [];
  let start = 0;
  while (start < bytes.length) {
    let end = bytes.indexOf(NL, start);
    if (end === -1) end = bytes.length;
    let lineEnd = end;
    if (lineEnd > start && bytes[lineEnd - 1] === CR) lineEnd -= 1;
    const line = bytes.subarray(start, lineEnd);
    start = end + 1;

    const headLength = line.length - tailLength;
    if (headLength < 21) continue;

    const symbol = ascii.decode(line.subarray(0, 9)).trim();
    if (!SYMBOL_PATTERN.test(symbol)) continue;

    const name = decoder.decode(line.subarray(21, headLength)).trim();
    if (!name) continue;
    const group = ascii.decode(line.subarray(headLength, headLength + 2));
    rows.push({ s: symbol, n: name, m: market, t: GROUP_TYPE[group] ?? 'OTHER' });
  }
  return rows.sort((a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : 0));
}
