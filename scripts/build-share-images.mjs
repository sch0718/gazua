// 카카오 카드 고정 이미지(공유 확장 설계 4.6): 종류별 800×400 PNG를 public/share/에 만든다.
// 라이트 토큰 배경, 왼쪽에 로고, 오른쪽에 종류 이름과 단순 도형. 숫자는 넣지 않는다.
// 새 의존성 없이 이미 개발 의존성인 playwright-core의 Chromium으로 찍는다. 손으로 돌리고(prebuild에 넣지 않는다) 결과 PNG를 커밋한다.
//   corepack pnpm build:share-images
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { FONT, loadTheme } from './motion/kit.mjs';

const root = new URL('../', import.meta.url);
const { light: t } = loadTheme([
  fileURLToPath(import.meta.resolve('@sch0718/ui-svelte/tokens.css')),
  fileURLToPath(new URL('src/lib/ui/tokens.css', root)),
]);
const icon = await readFile(new URL('public/icon.svg', root), 'utf8');
const viewBox = icon.match(/viewBox="([^"]+)"/)?.[1] ?? '0 0 512 512';
const logo = icon
  .replace(/^[\s\S]*?<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .trim();

// src/lib/share/kinds.ts의 SHARE_KIND_LABEL과 같은 이름(tests/share-images.test.mjs가 종류 목록을 맞춘다)
const KINDS = [
  ['group', '그룹', 'bars'],
  ['strategy', '전략', 'checks'],
  ['criteria', '선정 기준', 'checks'],
  ['compare', '비교 화면', 'lines'],
  ['simResult', '시뮬레이션 결과', 'lines'],
  ['validation', '검증 결과', 'bars'],
];

const SHAPES = {
  lines: [
    `<polyline points="0,110 70,70 140,90 210,30 300,50" fill="none" stroke="${t.s[0]}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`,
    `<polyline points="0,120 70,105 140,60 210,80 300,40" fill="none" stroke="${t.s[1]}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`,
    `<polyline points="0,100 70,115 140,110 210,120 300,95" fill="none" stroke="${t.s[2]}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`,
  ].join(''),
  bars: [40, 80, 60, 110, 90]
    .map((h, i) => `<rect x="${i * 60}" y="${130 - h}" width="40" height="${h}" rx="8" fill="${i === 3 ? t.accent : t.accentSoft}"/>`)
    .join(''),
  checks: [0, 1, 2]
    .map(
      (i) =>
        `<g transform="translate(0 ${i * 44})"><rect width="32" height="32" rx="8" fill="${t.accent}"/>` +
        `<polyline points="8,17 14,23 25,10" fill="none" stroke="${t.onAccent}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>` +
        `<rect x="48" y="10" width="${200 - i * 40}" height="12" rx="6" fill="${t.line}"/></g>`,
    )
    .join(''),
};

const svg = (label, shape) => `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400" viewBox="0 0 800 400">
  <rect width="800" height="400" fill="${t.bg}"/>
  <svg x="64" y="104" width="192" height="192" viewBox="${viewBox}">${logo}</svg>
  <text x="304" y="140" font-family="${FONT.replaceAll('"', "'")}" font-size="44" font-weight="800" fill="${t.t1}">${label}</text>
  <text x="304" y="180" font-family="${FONT.replaceAll('"', "'")}" font-size="22" fill="${t.t2}">가즈아 공유</text>
  <g transform="translate(304 214)">${SHAPES[shape]}</g>
</svg>`;

await mkdir(new URL('public/share/', root), { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 400 }, deviceScaleFactor: 1 });
  for (const [kind, label, shape] of KINDS) {
    await page.setContent(`<!doctype html><html><body style="margin:0">${svg(label, shape)}</body></html>`);
    const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 800, height: 400 } });
    await writeFile(new URL(`public/share/${kind}.png`, root), png);
    console.log(`public/share/${kind}.png: ${png.length} bytes`);
  }
} finally {
  await browser.close();
}
