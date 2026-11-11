import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { fetchFredSeries } from './fred';

it.each(['observation_date', 'DATE'])('FRED %s CSV를 읽고 결측·범위 밖·잘못된 값을 버린다', async (header) => {
  let url = '';
  const fetch = (async (input) => {
    url = String(input);
    return new Response(`${header},DGS10\n2026-11-01,4\n2026-11-02,.\n2026-11-03,4.1\n2026-11-04,\n2026-11-05,NaN\n2026-11-06,5\n`);
  }) as typeof globalThis.fetch;
  expect(await fetchFredSeries({ fetch }, 'DGS10', '2026-11-02', '2026-11-05')).toEqual({ d: ['20261103'], v: [4.1] });
  expect(new URL(url).searchParams.toString()).toBe('id=DGS10&cosd=2026-11-02&coed=2026-11-05');
});

it('고정 CSV를 읽고 HTTP 오류와 잘못된 헤더는 실패한다', async () => {
  const csv = readFileSync(new URL('../fixtures/fred/DGS10.csv', import.meta.url), 'utf8');
  const ctx = { fetch: (async () => new Response(csv)) as typeof fetch };
  const series = await fetchFredSeries(ctx, 'DGS10', '2024-09-01', '2026-11-11');
  expect(series.d.length).toBeGreaterThan(120);
  expect(series.d.length).toBe(series.v.length);
  expect(series.v.every(Number.isFinite)).toBe(true);
  await expect(fetchFredSeries({ fetch: (async () => new Response('', { status: 503 })) as typeof fetch }, 'DGS10', '', '')).rejects.toThrow('503');
  await expect(fetchFredSeries({ fetch: (async () => new Response('wrong,DGS10')) as typeof fetch }, 'DGS10', '', '')).rejects.toThrow();
});
