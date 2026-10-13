/** 금액을 0.0001원 단위로 맞춘다. 부동소수점 곱셈 오차(1020153.0000000001)가 경계 비교를 뒤집지 못하게 한다 */
export const roundMoney = (x: number): number => Math.round(x * 1e4) / 1e4;
