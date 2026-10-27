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

// 배포본에 라이선스 파일이 없는 패키지는 upstream 저장소의 원문을 scripts/licenses/에 두고 쓴다.
export function upstreamFile(name) {
  if (name === 'firebase' || name.startsWith('@firebase/')) return 'firebase.txt';
  if (name === 'fancy-canvas') return 'fancy-canvas.txt';
  return null;
}

/** 패키지마다 라이선스·NOTICE 파일 본문을 붙여 하나의 텍스트로 만든다.
 * 패키지에 파일이 없으면 readUpstream(scripts/licenses/)의 원문을 쓰고, 그것도 없으면 멈춘다(고지가 빠진 채 배포하지 않는다). */
export function render(pkgs, readTexts, readUpstream) {
  const head = [
    '가즈아가 쓰는 오픈소스 소프트웨어',
    '',
    '가즈아 자체는 PolyForm Noncommercial 1.0.0을 따릅니다: https://github.com/sch0718/gazua/blob/main/LICENSE',
    '아래는 앱에 포함되거나 함께 쓰이는 패키지와 그 라이선스 전문입니다.',
  ].join('\n');
  const missing = [];
  const shown = new Map(); // upstream 파일 → 처음 실은 패키지(같은 원문은 한 번만 싣는다. @firebase/* 44개가 한 파일을 쓴다)
  const blocks = pkgs.map((p) => {
    let texts = readTexts(p.path);
    if (!texts.length) {
      const file = upstreamFile(p.name);
      const text = file && readUpstream(file);
      const label = `upstream LICENSE (scripts/licenses/${file})`;
      if (!text) missing.push(`${p.name}@${p.version}`);
      else if (shown.has(file)) texts = [{ file: label, text: `(위 ${shown.get(file)}에 실은 원문과 같아요)` }];
      else {
        shown.set(file, `${p.name} ${p.version}`);
        texts = [{ file: label, text }];
      }
    }
    const body = texts.map((t) => `--- ${t.file} ---\n${t.text.trim()}`).join('\n\n');
    return `${'='.repeat(72)}\n${p.name} ${p.version} (${p.license})\n${'='.repeat(72)}\n${body}`;
  });
  if (missing.length) {
    throw new Error(`라이선스 원문을 찾지 못한 패키지: ${missing.join(', ')}. upstream LICENSE를 scripts/licenses/에 두고 upstreamFile()에 등록하세요`);
  }
  return `${head}\n\n${blocks.join('\n\n')}\n`;
}

// 패키지 루트에 없으면 dist/에서 찾는다(pretendard는 dist/LICENSE.txt에 둔다).
const LICENSES_DIR = fileURLToPath(new URL('./licenses/', import.meta.url));
const readUpstream = (file) => {
  try {
    return readFileSync(join(LICENSES_DIR, file), 'utf8');
  } catch {
    return null;
  }
};

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
  // pnpm 스크립트로 돌면 npm_execpath가 pnpm의 JS 진입점이라 node로 바로 띄운다(Windows의 .cmd 심은 execFileSync로 못 띄운다).
  const viaNode = /\.c?js$/.test(process.env.npm_execpath ?? '');
  const [cmd, pre, shell] = viaNode ? [process.execPath, [process.env.npm_execpath], false] : ['pnpm', [], process.platform === 'win32'];
  const list = (...args) =>
    JSON.parse(execFileSync(cmd, [...pre, 'licenses', 'list', ...args, '--json'], { encoding: 'utf8', maxBuffer: 64 << 20, shell }));
  const prod = flatten(list('--prod'));
  const seen = new Set(prod.map((p) => `${p.name}@${p.version}`));
  const extra = flatten(list(), BUNDLED_DEV).filter((p) => !seen.has(`${p.name}@${p.version}`));
  const pkgs = [...prod, ...extra].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.version < b.version ? -1 : 1));
  mkdirSync(dirname(OUTPUT), { recursive: true });
  const tmp = `${OUTPUT}.tmp`;
  writeFileSync(tmp, render(pkgs, readTexts, readUpstream));
  renameSync(tmp, OUTPUT);
  console.log(`licenses.txt: 패키지 ${pkgs.length}개`);
}
