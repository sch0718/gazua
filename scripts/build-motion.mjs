import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadTheme } from './motion/kit.mjs';
import { renderHero } from './motion/hero.mjs';
import { HELP_PAGES, renderHelp, renderHelpContent, renderHelpIndex, renderHelpMarkdown } from './motion/help.mjs';

// README 소개 그림(docs/readme/hero-*.svg)과 메뉴별 도움말 그림(public/help/img/*-*.svg)을
// 라이트·다크 두 장씩 만들고, 도움말 글(docs/help/*.md)과 앱 도움말 문구(src/lib/help/content.ts)도 같은 단계 정의로 만든다.
// 그림은 앱(설정 › 도움말)과 문서가 같은 파일을 쓴다.
// 색은 범용 토큰(@sch0718/ui-svelte/tokens.css)과 앱 토큰(src/lib/ui/tokens.css)에서 읽는다. 화면 문구가 바뀌면 scripts/motion/*.mjs를 고치고 `corepack pnpm build:motion`.

const root = new URL('../', import.meta.url);
const theme = loadTheme([
  fileURLToPath(import.meta.resolve('@sch0718/ui-svelte/tokens.css')),
  fileURLToPath(new URL('src/lib/ui/tokens.css', root)),
]);
const icon = await readFile(new URL('public/icon.svg', root), 'utf8');
const logo = icon
  .replace(/^[\s\S]*?<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .trim();

async function write(path, content) {
  await writeFile(new URL(path, root), content);
  console.log(`${path}: ${Buffer.byteLength(content)} bytes`);
}

await mkdir(new URL('docs/readme/', root), { recursive: true });
await mkdir(new URL('public/help/img/', root), { recursive: true });
await mkdir(new URL('src/lib/help/', root), { recursive: true });
for (const mode of ['light', 'dark']) {
  await write(`docs/readme/hero-${mode}.svg`, renderHero(theme[mode], logo));
  for (const page of HELP_PAGES) await write(`public/help/img/${page.id}-${mode}.svg`, renderHelp(page, theme[mode], mode));
}
for (const page of HELP_PAGES) await write(`docs/help/${page.id}.md`, renderHelpMarkdown(page));
await write('docs/help/README.md', renderHelpIndex(HELP_PAGES));
await write('src/lib/help/content.ts', renderHelpContent(HELP_PAGES));
