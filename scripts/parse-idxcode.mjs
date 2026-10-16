// KIS 업종 마스터(idxcode.mst) 파서. CP949 고정폭 45바이트 줄이다.
//   [0:5] 업종 코드(5자리), [5:45] 업종 이름(오른쪽 공백 패딩)
// 2026-10-16 실제 파일로 확인했다. 종목 마스터 tail의 4자리 업종코드는 이 코드의 [1:5]와 맞는다
// (예: 전기·전자 = '00013', 삼성전자 tail = '0013').

const NL = 0x0a;
const CR = 0x0d;
const decoder = new TextDecoder('euc-kr');
const ascii = new TextDecoder('ascii');

/**
 * @param {Uint8Array} bytes
 * @returns {{ code: string; name: string }[]}
 */
export function parseIdxcode(bytes) {
  const rows = [];
  let start = 0;
  while (start < bytes.length) {
    let end = bytes.indexOf(NL, start);
    if (end === -1) end = bytes.length;
    let lineEnd = end;
    if (lineEnd > start && bytes[lineEnd - 1] === CR) lineEnd -= 1;
    const line = bytes.subarray(start, lineEnd);
    start = end + 1;
    if (line.length < 6) continue;
    const code = ascii.decode(line.subarray(0, 5)).trim();
    const name = decoder.decode(line.subarray(5)).trim();
    if (code && name) rows.push({ code, name });
  }
  return rows;
}
