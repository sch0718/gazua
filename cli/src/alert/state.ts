import { appendFileSync, chmodSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { kstDate } from '../../../src/lib/time/kst';
import { ensureDir, FILE_MODE, readJsonFile, writeJsonFile } from '../config';

export const alertsDir = (dir: string): string => join(dir, 'alerts');
export function readState<T>(dir: string, name: 'watch' | 'premarket', empty: T): T {
  return readJsonFile<T>(join(alertsDir(dir), `${name}-state.json`)) ?? empty;
}
export function writeState(dir: string, name: 'watch' | 'premarket', value: unknown): void {
  writeJsonFile(join(alertsDir(dir), `${name}-state.json`), value);
}
export interface LogLine {
  kind: 'watch' | 'stock' | 'premarket' | 'test';
  barStart?: number;
  barEnd?: number;
  receivedAt: number;
  sentAt: number | null;
  changes: Record<string, number>;
  picks: { code: string; expected: number }[];
  delivered: boolean;
  note?: string;
}
export function appendLog(dir: string, line: LogLine): void {
  ensureDir(alertsDir(dir));
  const path = join(alertsDir(dir), `${kstDate(line.receivedAt).slice(0, 7)}.jsonl`);
  appendFileSync(path, `${JSON.stringify(line)}\n`, { mode: FILE_MODE });
  chmodSync(path, FILE_MODE);
}

export function readLogs(dir: string): LogLine[] {
  let files: string[];
  try { files = readdirSync(alertsDir(dir)).filter((f) => /^\d{4}-\d{2}\.jsonl$/.test(f)).sort(); } catch { return []; }
  const logs: LogLine[] = [];
  for (const file of files) {
    let text: string;
    try { text = readFileSync(join(alertsDir(dir), file), 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      try {
        const v = JSON.parse(line) as LogLine | null;
        if (!v || !['watch', 'stock', 'premarket', 'test'].includes(v.kind) || !Number.isFinite(v.receivedAt) || (v.sentAt !== null && !Number.isFinite(v.sentAt)) || typeof v.delivered !== 'boolean' || !v.changes || typeof v.changes !== 'object' || !Array.isArray(v.picks)) continue;
        if (!v.picks.every((p) => p && typeof p.code === 'string' && Number.isFinite(p.expected))) continue;
        logs.push(v);
      } catch { /* 잘리거나 깨진 줄은 집계에서 뺀다. */ }
    }
  }
  return logs;
}
