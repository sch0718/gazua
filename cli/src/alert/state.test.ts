import { appendFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { kstEpoch } from '../../../src/lib/time/kst';
import { cleanupDirs, tempDir } from '../testing';
import { alertsDir, appendLog, readLogs, readState, writeState, type LogLine } from './state';

afterEach(cleanupDirs);
const line = (at: number): LogLine => ({ kind: 'watch', receivedAt: at, sentAt: at, changes: { ES: 0.01 }, picks: [{ code: '000660', expected: 0.02 }], delivered: true });
describe('알람 상태와 기록', () => {
  it('상태가 없거나 깨졌으면 기본값을 쓰고 원자적으로 저장한다', () => {
    const dir = tempDir();
    expect(readState(dir, 'watch', { n: 0 })).toEqual({ n: 0 });
    writeState(dir, 'watch', { n: 1 });
    expect(readState(dir, 'watch', { n: 0 })).toEqual({ n: 1 });
    writeFileSync(join(alertsDir(dir), 'watch-state.json'), '{깨짐');
    expect(readState(dir, 'watch', { n: 0 })).toEqual({ n: 0 });
    expect(statSync(join(alertsDir(dir), 'watch-state.json')).mode & 0o777).toBe(0o600);
  });
  it('KST 월 경계로 파일을 나누고 600으로 저장하며 깨진 줄을 건너뛴다', () => {
    const dir = tempDir();
    appendLog(dir, line(kstEpoch('2026-11-30', '23:59:00')));
    appendLog(dir, line(kstEpoch('2026-12-01', '00:01:00')));
    const files = readdirSync(alertsDir(dir));
    expect(files).toEqual(['2026-11.jsonl', '2026-12.jsonl']);
    for (const f of files) expect(statSync(join(alertsDir(dir), f)).mode & 0o777).toBe(0o600);
    appendFileSync(join(alertsDir(dir), files[0]), '{깨짐\nnull\n{}\n');
    expect(readLogs(dir)).toHaveLength(2);
    expect(readLogs(tempDir())).toEqual([]);
  });
});
