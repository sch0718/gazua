// 앱이 쓰는 운영 의존성의 라이선스 전문을 모아 public/licenses.txt를 만든다(설정 → 정보 → 오픈소스와 데이터 출처).
// 번들러가 라이선스 주석을 지우므로, MIT·BSD·Apache의 고지 의무를 이 파일로 지킨다.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUTPUT = fileURLToPath(new URL('../public/licenses.txt', import.meta.url));
const NOTICE_FILE = /^(licen[cs]e|copying|notice)(\..*)?$/i;

/** pnpm licenses list --json 결과를 [{name, version, license, path}]로 편다. */
export function flatten(byLicense) {
  const out = [];
  for (const [license, pkgs] of Object.entries(byLicense)) {
    for (const p of pkgs) {
      p.versions.forEach((version, i) => out.push({ name: p.name, version, license, author: p.author, path: p.paths[i] }));
    }
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.version < b.version ? -1 : 1));
}

/** 패키지마다 라이선스·NOTICE 파일 본문을 붙여 하나의 텍스트로 만든다.
 * 파일이 없는 패키지(@firebase/* 등)는 같은 라이선스의 전문을 맨 끝에 한 번 싣고 그쪽을 가리킨다. */
export function render(pkgs, readTexts) {
  const texts = new Map(pkgs.map((p) => [p, readTexts(p.path)]));
  const common = new Map();
  for (const p of pkgs) {
    if (texts.get(p).length || common.has(p.license)) continue;
    const donor = pkgs.find((q) => q.license === p.license && texts.get(q).some((t) => /^licen[cs]e/i.test(t.file)));
    common.set(p.license, donor ? texts.get(donor).find((t) => /^licen[cs]e/i.test(t.file)).text : null);
  }
  const head = [
    '가즈아가 쓰는 오픈소스 소프트웨어',
    '',
    '가즈아 자체는 PolyForm Noncommercial 1.0.0을 따릅니다: https://github.com/sch0718/gazua/blob/main/LICENSE',
    '아래는 앱에 포함되거나 함께 쓰이는 패키지와 그 라이선스 전문입니다.',
  ].join('\n');
  const blocks = pkgs.map((p) => {
    const own = texts.get(p);
    const by = p.author ? `, 저작권자: ${p.author}` : '';
    const body = own.length
      ? own.map((t) => `--- ${t.file} ---\n${t.text.trim()}`).join('\n\n')
      : common.get(p.license)
        ? `(패키지에 라이선스 파일이 없어요. 맨 끝의 ${p.license} 전문을 따라요${by})`
        : `(라이선스 파일 없음 — ${p.license}${by})`;
    return `${'='.repeat(72)}\n${p.name} ${p.version} (${p.license})\n${'='.repeat(72)}\n${body}`;
  });
  const tails = [...common].filter(([, text]) => text).map(([id, text]) => `${'='.repeat(72)}\n${id} 전문\n${'='.repeat(72)}\n${text.trim()}`);
  return `${head}\n\n${[...blocks, ...tails].join('\n\n')}\n`;
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
  const json = execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const pkgs = flatten(JSON.parse(json));
  mkdirSync(dirname(OUTPUT), { recursive: true });
  const tmp = `${OUTPUT}.tmp`;
  writeFileSync(tmp, render(pkgs, readTexts));
  renameSync(tmp, OUTPUT);
  console.log(`licenses.txt: 패키지 ${pkgs.length}개`);
}
