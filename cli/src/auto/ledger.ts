import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { kstDate, kstEpoch } from '../../../src/lib/time/kst';
import { writeJsonFile } from '../config';
import { CliError } from '../errors';
export interface AutoPosition {
  symbol: string;
  boughtAt: string;
  buyPrice: number;
  orderId?: string;
  boughtQty: number;
  qty: number;
  peak: number;
  sells: { qty: number; stage?: number }[];
  pendingSell?: { date: string; sentAt: number; qty: number; qtyBefore: number; price: number; reason: string; stage?: number; warned?: boolean };
  unconfirmed?: true;
  sellBlocked?: string;
}
export interface AutoLedger {
  version: 1;
  strategyId: string | null;
  today: { date: string; bought: string[]; sold: string[] };
  positions: AutoPosition[];
  notified: string[];
}
export const ledgerPath = (dir: string, mode: 'dry' | 'live'): string => join(dir, mode === 'dry' ? 'auto-positions.dry.json' : 'auto-positions.json');
type Row = Record<string, unknown>;
const row = (value: unknown): value is Row => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const positive = (value: unknown): value is number => integer(value) && value > 0;
const text = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';
const date = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && kstDate(kstEpoch(value, '00:00:00')) === value;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(text);
const stage = (value: unknown): boolean => value === undefined || positive(value);

function position(value: unknown): value is AutoPosition {
  if (!row(value) || !text(value.symbol) || !date(value.boughtAt) || !positive(value.buyPrice) || !positive(value.boughtQty) || !integer(value.qty) || !positive(value.peak) || value.peak < value.buyPrice ||
      !(value.orderId === undefined || text(value.orderId)) || !(value.unconfirmed === undefined || value.unconfirmed === true) || !(value.sellBlocked === undefined || date(value.sellBlocked)) || !Array.isArray(value.sells)) return false;
  let sold = 0;
  for (const sale of value.sells) {
    if (!row(sale) || !positive(sale.qty) || !stage(sale.stage)) return false;
    sold += sale.qty;
    if (!Number.isSafeInteger(sold)) return false;
  }
  if (!Number.isSafeInteger(sold + value.qty) || sold + value.qty !== value.boughtQty) return false;
  if (value.pendingSell !== undefined) {
    const p = value.pendingSell;
    if (!row(p) || !date(p.date) || !integer(p.sentAt) || !positive(p.qty) || !positive(p.qtyBefore) || !positive(p.price) || !text(p.reason) || !stage(p.stage) ||
        !(p.warned === undefined || typeof p.warned === 'boolean') || p.qty > p.qtyBefore || p.qtyBefore > value.boughtQty || value.qty > p.qtyBefore) return false;
  }
  return true;
}

function valid(value: unknown): value is AutoLedger {
  return row(value) && value.version === 1 && (value.strategyId === null || text(value.strategyId)) && row(value.today) && date(value.today.date) &&
    strings(value.today.bought) && strings(value.today.sold) && strings(value.notified) && value.notified.every((key) => date(key.slice(0, 10)) && key[10] === ':' && key.length > 11) &&
    Array.isArray(value.positions) && value.positions.every(position) && new Set(value.positions.map((p) => p.symbol)).size === value.positions.length &&
    (value.positions.length === 0 || text(value.strategyId));
}

export function readLedger(path: string, today: string): AutoLedger {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, strategyId: null, today: { date: today, bought: [], sold: [] }, positions: [], notified: [] };
    throw new CliError('invalid-args', `자동 실행 원장을 읽을 수 없어요: ${path}`);
  }
  if (!valid(value)) throw new CliError('invalid-args', `자동 실행 원장을 읽을 수 없어요: ${path}`);
  if (value.today.date !== today) value.today = { date: today, bought: [], sold: [] };
  value.notified = value.notified.filter((key) => key.startsWith(`${today}:`));
  return value;
}

export function writeLedger(path: string, ledger: AutoLedger): void {
  writeJsonFile(path, ledger);
}
