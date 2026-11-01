// 읽기 전용 CLI 번들: src/main.ts → dist/gazua.mjs (esbuild 단일 파일, Node 22.13 이상).
// 앱 코드를 상대 경로로 묶으므로 브라우저 전용 코드(import.meta.env, window, navigator.locks)가 딸려 들어오면 빌드를 실패시킨다.
import { build } from 'esbuild';
import { chmodSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

/** 번들에 있으면 안 되는 문자열 */
export const FORBIDDEN = ['import.meta.env', 'window.', 'navigator.locks'];

export const findForbidden = (text) => FORBIDDEN.filter((s) => text.includes(s));

export async function bundle(outfile = join(root, 'dist', 'gazua.mjs'), env = process.env) {
  await build({
    entryPoints: [join(root, 'src', 'main.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22.13',
    external: ['node:sqlite'],
    banner: { js: '#!/usr/bin/env node' },
    // import.meta.env 전체가 아니라 기본 서버 주소 상수 하나만 넣는다(src/main에서 typeof로 읽는다)
    define: { __GAZUA_DEFAULT_SERVER__: JSON.stringify((env.VITE_SYNC_API_URL ?? '').trim().replace(/\/+$/, '')) },
    logLevel: 'warning',
  });
  chmodSync(outfile, 0o755);
  const hits = findForbidden(readFileSync(outfile, 'utf8'));
  if (hits.length) throw new Error(`번들에 브라우저 전용 코드가 들어왔어요: ${hits.join(', ')}`);
  return outfile;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  bundle().then(
    (file) => console.log(`built ${file}`),
    (e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    },
  );
}
