// 웹의 순수 계산기를 포함한 Node 프록시를 한 파일로 묶는다.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const forbidden = ['import.meta.env', 'window.', 'navigator.locks'];

export async function bundle(outfile = join(root, 'dist/node/server.js')) {
  await build({
    entryPoints: [join(root, 'node/server.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'warning',
  });
  const text = readFileSync(outfile, 'utf8');
  const hits = forbidden.filter((s) => text.includes(s));
  if (hits.length) throw new Error(`번들에 브라우저 전용 코드가 들어왔다: ${hits.join(', ')}`);
  return outfile;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  bundle().then(
    (file) => console.log(`프록시 번들 생성: ${file}`),
    (err) => { console.error(err instanceof Error ? err.message : err); process.exitCode = 1; },
  );
}
