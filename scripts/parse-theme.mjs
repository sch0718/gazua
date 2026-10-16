// KIS 테마 마스터(theme_code.mst) 파서. CP949 고정폭 52바이트 줄이다.
//   [0:3] 테마 코드(3자리), [3:43] 테마 이름(40바이트, 오른쪽 공백 패딩), [43:52] 종목 코드(6자리 + 공백 패딩)
// 2026-10-16 실제 파일로 확인했다(5528행, 테마 302개). KIS 예제 주석은 이름과 코드 순서가 뒤바뀌어 있다.

const NL = 0x0a;
const CR = 0x0d;
const decoder = new TextDecoder('euc-kr');
const ascii = new TextDecoder('ascii');

/**
 * @param {Uint8Array} bytes
 * @returns {{ code: string; name: string; symbols: string[] }[]}
 */
export function parseThemes(bytes) {
  const byCode = new Map();
  let start = 0;
  while (start < bytes.length) {
    let end = bytes.indexOf(NL, start);
    if (end === -1) end = bytes.length;
    let lineEnd = end;
    if (lineEnd > start && bytes[lineEnd - 1] === CR) lineEnd -= 1;
    const line = bytes.subarray(start, lineEnd);
    start = end + 1;
    if (line.length < 44) continue;
    const code = ascii.decode(line.subarray(0, 3)).trim();
    const name = decoder.decode(line.subarray(3, 43)).trim();
    // 앞의 A 같은 접두를 떼고 6자리만 남긴다
    const symbol = ascii.decode(line.subarray(43)).trim().replace(/^[A-Za-z]/, '');
    if (!code || !name || !/^\d{6}$/.test(symbol)) continue;
    let t = byCode.get(code);
    if (!t) byCode.set(code, (t = { code, name, symbols: [] }));
    if (!t.symbols.includes(symbol)) t.symbols.push(symbol);
  }
  return [...byCode.values()];
}
