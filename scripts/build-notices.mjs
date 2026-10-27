// 앱이 쓰는 운영 의존성의 라이선스 전문을 모아 public/licenses.txt를 만든다(설정 → 정보 → 오픈소스와 데이터 출처).
// 번들러가 라이선스 주석을 지우므로, MIT·BSD·Apache의 고지 의무를 이 파일로 지킨다.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUTPUT = fileURLToPath(new URL('../public/licenses.txt', import.meta.url));
export const NOTICE_FILE = /^(licen[cs]e|copying|notice)([-._].*)?$/i; // LICENSE, LICENSE.md, LICENSE-MIT.txt 등
// devDependencies지만 런타임 코드가 번들에 들어가는 패키지(Svelte 런타임, PWA 서비스 워커의 Workbox).
export const BUNDLED_DEV = (name) => ['svelte', 'clsx', 'esm-env'].includes(name) || /^workbox-(?!build$)/.test(name);

/** pnpm licenses list --json 결과를 [{name, version, license, path}]로 편다. keep이 있으면 그 이름만 남긴다. */
export function flatten(byLicense, keep = () => true) {
  const out = [];
  for (const [license, pkgs] of Object.entries(byLicense)) {
    for (const p of pkgs.filter((q) => keep(q.name))) {
      p.versions.forEach((version, i) => out.push({ name: p.name, version, license, author: p.author, path: p.paths[i] }));
    }
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.version < b.version ? -1 : 1));
}

/** 패키지마다 라이선스·NOTICE 파일 본문을 붙여 하나의 텍스트로 만든다.
 * 파일이 없는 패키지(@firebase/* 등)는 다른 패키지의 전문(남의 저작권 줄이 들어 있다)을 빌리지 않고 SPDX 표준 전문과 저작권자를 적는다. */
export function render(pkgs, readTexts) {
  const head = [
    '가즈아가 쓰는 오픈소스 소프트웨어',
    '',
    '가즈아 자체는 PolyForm Noncommercial 1.0.0을 따릅니다: https://github.com/sch0718/gazua/blob/main/LICENSE',
    '아래는 앱에 포함되거나 함께 쓰이는 패키지와 그 라이선스 전문입니다.',
  ].join('\n');
  const blocks = pkgs.map((p) => {
    const own = readTexts(p.path);
    const by = p.author ? `, 저작권자: ${p.author}` : '';
    const body = own.length
      ? own.map((t) => `--- ${t.file} ---\n${t.text.trim()}`).join('\n\n')
      : `(패키지에 라이선스 파일이 없어요. ${p.license} 표준 전문을 따라요: https://spdx.org/licenses/${p.license}.html${by})`;
    return `${'='.repeat(72)}\n${p.name} ${p.version} (${p.license})\n${'='.repeat(72)}\n${body}`;
  });
  return `${head}\n\n${blocks.join('\n\n')}\n`;
}

// 패키지 루트에 없으면 dist/에서 찾는다(pretendard는 dist/LICENSE.txt에 둔다).
function readTexts(dir) {
  for (const d of [dir, join(dir, 'dist')]) {
    try {
      const found = readdirSync(d)
        .filter((f) => NOTICE_FILE.test(f))
        .sort()
        .map((file) => ({ file, text: readFileSync(join(d, file), 'utf8') }));
      if (found.length) return found;
    } catch {
      // 폴더가 없으면 다음 후보
    }
  }
  return [];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const list = (...args) =>
    JSON.parse(execFileSync('pnpm', ['licenses', 'list', ...args, '--json'], { encoding: 'utf8', maxBuffer: 64 << 20 }));
  const prod = flatten(list('--prod'));
  const seen = new Set(prod.map((p) => `${p.name}@${p.version}`));
  const extra = flatten(list(), BUNDLED_DEV).filter((p) => !seen.has(`${p.name}@${p.version}`));
  const pkgs = [...prod, ...extra].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.version < b.version ? -1 : 1));
  mkdirSync(dirname(OUTPUT), { recursive: true });
  const tmp = `${OUTPUT}.tmp`;
  writeFileSync(tmp, render(pkgs, readTexts));
  renameSync(tmp, OUTPUT);
  console.log(`licenses.txt: 패키지 ${pkgs.length}개`);
}
