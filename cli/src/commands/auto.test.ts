import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { run } from '../main';
import { TOOLS } from '../mcp/tools';
import { cleanupDirs, fakeFetch, makeIo } from '../testing';

afterEach(cleanupDirs);
it.each([['auto', '--yes'], ['auto', '남은인자']])('잘못된 자동 실행 인자는 원장·네트워크보다 먼저 거절한다: %s', async (...argv) => {
  const f = fakeFetch(() => { throw new Error('호출하면 안 돼요'); });
  const t = makeIo({ fetch: f });
  await run(argv, t.io);
  expect(t.result().error.code).toBe('invalid-args');
  expect(f.calls).toHaveLength(0);
  expect(existsSync(join(t.dir, 'auto-positions.dry.json'))).toBe(false);
});
it('자동 실행은 CLI에서만 제공하고 MCP에는 내보내지 않는다', async () => {
  const t = makeIo({ env: { AUTO_STRATEGY: '전략' }, now: Date.parse('2026-11-13T00:00:00+09:00') });
  expect(await run(['auto'], t.io)).toBe(0);
  expect(t.result().data).toMatchObject({ mode: 'dry', skipped: 'hours' });
  expect(TOOLS.some((t) => t.name === 'auto')).toBe(false);
});
