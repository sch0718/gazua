export interface Fit { alpha: number; beta: number; r2: number; t: number; n: number }

export function stdev(xs: number[]): number {
  const finite = xs.filter(Number.isFinite);
  if (finite.length < 2) return 0;
  const mean = finite.reduce((a, b) => a + b, 0) / finite.length;
  return Math.sqrt(finite.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (finite.length - 1));
}

/** 유한한 짝만 쓴다. 상수항과 베타를 함께 추정한다. */
export function fitLine(xs: number[], ys: number[], minN: number): Fit | null {
  const pairs = xs.flatMap((x, i) => Number.isFinite(x) && Number.isFinite(ys[i]) ? [[x, ys[i]]] : []);
  const n = pairs.length;
  if (n < minN || n < 2) return null;
  const mx = pairs.reduce((sum, [x]) => sum + x, 0) / n;
  const my = pairs.reduce((sum, [, y]) => sum + y, 0) / n;
  let xx = 0, xy = 0, yy = 0;
  for (const [x, y] of pairs) {
    xx += (x - mx) ** 2;
    xy += (x - mx) * (y - my);
    yy += (y - my) ** 2;
  }
  if (xx === 0) return null;
  const beta = xy / xx, alpha = my - beta * mx;
  const sse = pairs.reduce((sum, [x, y]) => sum + (y - alpha - beta * x) ** 2, 0);
  const se = n > 2 ? Math.sqrt(sse / (n - 2) / xx) : 0;
  return { alpha, beta, r2: yy === 0 ? 0 : Math.max(0, Math.min(1, 1 - sse / yy)), t: se === 0 ? (beta === 0 ? 0 : Math.sign(beta) * Infinity) : beta / se, n };
}
