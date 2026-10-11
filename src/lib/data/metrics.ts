export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  value?: number;
}

export interface Point {
  t: number;
  v: number | null;
}

/** (P / base - 1) * 100, 곱셈을 먼저 해 부동소수 오차를 줄인다. null 입력(거래 없음 구간)은 null로 보존한다. */
export function changePct(closes: Point[], base: number): Point[] {
  const baseOk = Number.isFinite(base) && base !== 0;
  return closes.map(({ t, v }) => ({
    t,
    v: v === null || !baseOk ? null : ((v - base) * 100) / base,
  }));
}

/** (P / max(P up to t) - 1) * 100. null은 null을 내고 최고가를 초기화하지 않는다. */
export function drawdownPct(closes: Point[]): Point[] {
  let max = -Infinity;
  return closes.map(({ t, v }) => {
    if (v === null) return { t, v: null };
    if (v > max) max = v;
    return { t, v: max === 0 ? null : ((v - max) * 100) / max };
  });
}

/** 종목 등락률 - 지수 등락률. 지수는 t 이하에서 가장 최근 값을 쓴다. */
export function excessPct(stockPct: Point[], indexPct: Point[]): Point[] {
  const index = [...indexPct].sort((a, b) => a.t - b.t);
  return stockPct.map(({ t, v }) => {
    let lo = 0;
    let hi = index.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (index[mid].t <= t) lo = mid + 1;
      else hi = mid;
    }
    const idx = lo > 0 ? index[lo - 1].v : null;
    return { t, v: v === null || idx === null ? null : v - idx };
  });
}

/** V_t / 직전 lookback개 봉 거래량 평균(현재 봉 제외). 직전 봉이 모자라면 null. */
export function rvolDaily(candles: Candle[], lookback: number): Point[] {
  return candles.map(({ t, v }, i) => {
    if (i < lookback) return { t, v: null };
    let sum = 0;
    for (let j = i - lookback; j < i; j++) sum += candles[j].v;
    const avg = sum / lookback;
    return { t, v: avg > 0 ? v / avg : null };
  });
}

/** 누적 거래량 / 평균 일 거래량. 평균이 없으면(20거래일 부족 등) 모든 값 null. */
export function rvolIntraday(candles1m: Candle[], avgDailyVolume: number | null): Point[] {
  const avgOk = avgDailyVolume !== null && avgDailyVolume > 0;
  let cumulative = 0;
  return candles1m.map(({ t, v }) => {
    cumulative += v;
    return { t, v: avgOk ? cumulative / avgDailyVolume : null };
  });
}

/** P * shares / 1e12 (조 원). */
export function marketCapTrillion(closes: Point[], shares: number): Point[] {
  return closes.map(({ t, v }) => ({ t, v: v === null ? null : (v * shares) / 1e12 }));
}
