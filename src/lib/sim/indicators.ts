/** 단순 이동평균. 앞 period-1개는 null. 경계 비교가 흔들리지 않게 창마다 새로 더한다. */
export function sma(closes: number[], period: number): (number | null)[] {
  return closes.map((_, i) => {
    if (period < 1 || i < period - 1) return null;
    let sum = 0;
    for (let k = i - period + 1; k <= i; k++) sum += closes[k];
    return sum / period;
  });
}
