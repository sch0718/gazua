import type { Ctx } from '../context';

export interface FredSeries { d: string[]; v: number[] }

/** 키 없는 FRED CSV. 기존 수집 스크립트와 같이 날짜는 YYYYMMDD로 돌려준다. */
export async function fetchFredSeries(ctx: Pick<Ctx, 'fetch'>, id: string, from: string, to: string): Promise<FredSeries> {
  const params = new URLSearchParams({ id, cosd: from, coed: to });
  const res = await ctx.fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?${params}`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`FRED HTTP ${res.status}`);
  const lines = (await res.text()).trim().split(/\r?\n/);
  const header = lines[0].split(',').map((s) => s.trim());
  if (!['observation_date', 'DATE'].includes(header[0]) || header[1] !== id) throw new Error('FRED CSV 헤더 오류');
  const series: FredSeries = { d: [], v: [] };
  for (const line of lines.slice(1)) {
    const [date, raw] = line.split(',').map((s) => s.trim());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (from && date < from) || (to && date > to) || !raw || raw === '.') continue;
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    series.d.push(date.replaceAll('-', ''));
    series.v.push(n);
  }
  return series;
}
