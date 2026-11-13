/** 2023-01-25 이후 KRX 주식의 호가 단위다. ETF·ETN은 구분하지 않는다. */
export function tickOf(price: number): number {
  if (price < 2000) return 1;
  if (price < 5000) return 5;
  if (price < 20000) return 10;
  if (price < 50000) return 50;
  if (price < 200000) return 100;
  if (price < 500000) return 500;
  return 1000;
}

/** 가격 여유를 곱할 때 생긴 부동소수 오차만 무시한다. */
export function tickUp(price: number): number {
  return Math.ceil((price - Number.EPSILON * price * 4) / tickOf(price)) * tickOf(price);
}

export function tickDown(price: number): number {
  return Math.floor((price + Number.EPSILON * price * 4) / tickOf(price)) * tickOf(price);
}
