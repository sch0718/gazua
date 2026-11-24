// 직접 넣은 보유 종목(토스 계좌에 없는 것). 이 기기의 프로필에만 저장하고 동기화·공유·내보내기 문서에는 넣지 않는다
// (보유 수량·평단은 sync/forbidden.ts가 막는 계좌 정보다).
import { profileKeys } from '../state/profileStore';
import type { SafeStorage } from '../state/storage';

export const MAX_MANUAL_HOLDINGS = 100;
export const ACCOUNT_LABEL_MAX = 12;
/** 계좌 라벨을 비워 두면 쓰는 이름 */
export const DEFAULT_ACCOUNT_LABEL = '기타';
/** 공급자 계좌(토스)에서 가져온 보유의 라벨 */
export const TOSS_LABEL = '토스';
export const DEMO_LABEL = '데모';

export interface ManualHolding {
  id: string;
  /** 6자리 코드(ETN은 Q 포함 7자리) */
  symbol: string;
  name: string;
  qty: number;
  /** 평균 매수가. 모르면 null(평가손익은 비운다) */
  avgPrice: number | null;
  /** 계좌 라벨(예: 연금저축, ISA). 1~12자 */
  account: string;
}

const SYMBOL_RE = /^[0-9A-Z]{6,7}$/;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function cleanLabel(raw: string): string {
  const t = [...raw.trim()].slice(0, ACCOUNT_LABEL_MAX).join('').trim();
  return t === '' ? DEFAULT_ACCOUNT_LABEL : t;
}

export function newManualHolding(input: Omit<ManualHolding, 'id'>): ManualHolding {
  return { ...input, id: crypto.randomUUID(), account: cleanLabel(input.account) };
}

/** `{ holdings: [...] }`를 고친다. 모양이 틀린 항목·id가 겹치는 항목·100개 초과는 버린다. */
export function sanitizeManualHoldings(raw: unknown): { holdings: ManualHolding[]; repaired: boolean } {
  if (!isRecord(raw) || !Array.isArray(raw.holdings)) return { holdings: [], repaired: raw !== null && raw !== undefined };
  const holdings: ManualHolding[] = [];
  const ids = new Set<string>();
  let repaired = false;
  for (const item of raw.holdings) {
    if (
      !isRecord(item) ||
      typeof item.id !== 'string' ||
      item.id === '' ||
      ids.has(item.id) ||
      typeof item.symbol !== 'string' ||
      !SYMBOL_RE.test(item.symbol) ||
      typeof item.name !== 'string' ||
      typeof item.qty !== 'number' ||
      !Number.isInteger(item.qty) ||
      item.qty < 1 ||
      holdings.length >= MAX_MANUAL_HOLDINGS
    ) {
      repaired = true;
      continue;
    }
    const avg = typeof item.avgPrice === 'number' && Number.isFinite(item.avgPrice) && item.avgPrice > 0 ? item.avgPrice : null;
    const account = typeof item.account === 'string' ? cleanLabel(item.account) : DEFAULT_ACCOUNT_LABEL;
    ids.add(item.id);
    holdings.push({ id: item.id, symbol: item.symbol, name: item.name, qty: item.qty, avgPrice: avg, account });
  }
  return { holdings, repaired };
}

export function loadManualHoldings(st: SafeStorage, profileId: string): ManualHolding[] {
  return sanitizeManualHoldings(st.get<unknown>(profileKeys.manualHoldings(profileId), null)).holdings;
}

export function assertManualWritable(list: ManualHolding[]): void {
  if (list.length > MAX_MANUAL_HOLDINGS) throw new Error(`직접 넣은 보유 종목은 ${MAX_MANUAL_HOLDINGS}개까지예요`);
}
