/** 단순 이동평균. 앞 period-1개는 null. 경계 비교가 흔들리지 않게 창마다 새로 더한다. */
export function sma(closes: number[], period: number): (number | null)[] {
  return closes.map((_, i) => {
    if (period < 1 || i < period - 1) return null;
    let sum = 0;
    for (let k = i - period + 1; k <= i; k++) sum += closes[k];
    return sum / period;
  });
}

/**
 * Wilder RSI(스펙 §5.1). start부터 평활을 시작해 받은 워밍업 길이와 상관없이 같은 기간이면 같은 값이 나온다.
 * start+period 앞은 null. 평균 하락이 0이면 100, 상승·하락이 모두 0이면 50.
 */
export function rsi(closes: number[], period: number, start = 0): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  const s = Math.max(0, start);
  if (period < 1 || closes.length <= s + period) return out;
  let gain = 0;
  let loss = 0;
  for (let k = s + 1; k <= s + period; k++) {
    const d = closes[k] - closes[k - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  const value = () => (loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
  out[s + period] = value();
  for (let i = s + period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + (d > 0 ? d : 0)) / period;
    loss = (loss * (period - 1) + (d < 0 ? -d : 0)) / period;
    out[i] = value();
  }
  return out;
}

/** 거래량이 있는 봉인가. 0 이하·NaN·Infinity는 값 없음(스펙 §5.1) */
const hasVolume = (v: number): boolean => Number.isFinite(v) && v > 0;

/** 오늘 거래량 ÷ 전날까지 period개 봉 중 거래량이 있는 봉의 평균. 오늘 값이 없거나 창에 값이 없으면 null */
export function volumeRatio(volumes: number[], period: number): (number | null)[] {
  return volumes.map((v, i) => {
    if (period < 1 || i < period || !hasVolume(v)) return null;
    let sum = 0;
    let n = 0;
    for (let k = i - period; k < i; k++) {
      if (!hasVolume(volumes[k])) continue;
      sum += volumes[k];
      n++;
    }
    return n === 0 ? null : v / (sum / n);
  });
}

/** 최근 window개 최대(오늘 포함). 개수가 min 미만이면 null. 단조 덱으로 O(n). 선정 기준(precompute)과 엔진이 같이 쓴다 */
export function rollingMax(c: number[], window: number, min: number): (number | null)[] {
  const out: (number | null)[] = new Array(c.length);
  const dq: number[] = [];
  let head = 0;
  for (let i = 0; i < c.length; i++) {
    while (dq.length > head && c[dq[dq.length - 1]] <= c[i]) dq.pop();
    dq.push(i);
    if (dq[head] <= i - window) head++;
    out[i] = Math.min(i + 1, window) < min ? null : c[dq[head]];
  }
  return out;
}
