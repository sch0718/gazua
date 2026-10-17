// FRED 일별 계열 CSV를 받는다. 키는 쓰지 않는다.
// 헤더는 observation_date,<ID> (2026-10-16 확인). 예전 DATE,<ID>도 받는다. 값이 '.'인 날은 버린다.
// 4xx(429 제외)는 다시 보내도 같으므로 바로 실패한다. 5xx·429·네트워크 오류·시간 초과만 다시 보낸다.

const URL_BASE = 'https://fred.stlouisfed.org/graph/fredgraph.csv';
const TIMEOUT_MS = 20_000;
const ATTEMPTS = 3;

/**
 * @param {string} id
 * @param {{ fetchImpl?: typeof fetch; from?: string; to?: string; sleep?: (ms: number) => Promise<void>; timeoutMs?: number }} [opts]
 * @returns {Promise<{ d: string[]; v: number[] }>}
 */
export async function fetchFredSeries(id, opts = {}) {
  const { fetchImpl = fetch, from, to, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), timeoutMs = TIMEOUT_MS } = opts;
  const params = new URLSearchParams({ id });
  if (from) params.set('cosd', from);
  if (to) params.set('coed', to);
  const url = `${URL_BASE}?${params}`;
  let lastErr;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) {
        const err = new Error(`FRED ${id}: HTTP ${res.status}`);
        if (res.status >= 400 && res.status < 500 && res.status !== 429) throw Object.assign(err, { final: true });
        throw err;
      }
      return parseCsv(id, await res.text(), from, to);
    } catch (e) {
      lastErr = e;
      if (e?.final) break;
      if (attempt < ATTEMPTS) await sleep(1000 * attempt);
    }
  }
  throw new Error(`FRED ${id} 요청 실패: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

function parseCsv(id, text, from, to) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const header = (lines[0] ?? '').split(',');
  if (!['observation_date', 'DATE'].includes(header[0]?.trim()) || header[1]?.trim() !== id) {
    throw new Error(`FRED ${id}: 예상하지 못한 CSV 헤더`);
  }
  const d = [];
  const v = [];
  for (const line of lines.slice(1)) {
    const [date, raw] = line.split(',');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (from && date < from) continue;
    if (to && date > to) continue;
    const value = raw?.trim();
    if (!value || value === '.') continue;
    const n = Number(value);
    if (!Number.isFinite(n)) continue;
    d.push(date.replaceAll('-', ''));
    v.push(n);
  }
  return { d, v };
}
