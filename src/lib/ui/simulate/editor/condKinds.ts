// 조건 줄의 종류 선택지(스펙 §10.2). 순서가 곧 선택지 순서다.
import type { Cond } from '../../../sim/types';

export const COND_KINDS: readonly { kind: Cond['kind']; label: string }[] = [
  { kind: 'maPrice', label: '이동평균 위·아래' },
  { kind: 'maCross', label: '이평 교차' },
  { kind: 'rsi', label: 'RSI' },
  { kind: 'volume', label: '거래량' },
  { kind: 'change', label: 'N일 등락률' },
  { kind: 'fromHigh', label: '고점 대비 하락' },
  { kind: 'newHigh', label: '신고가 돌파' },
  { kind: 'pattern', label: '반등 패턴' },
];
