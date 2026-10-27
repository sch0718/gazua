import { at, esc, motionCss, svgDocument, text, textWidth } from '@sch0718/motion-kit';
import { MOTION } from './kit.mjs';
import { PAGES } from './help-pages.mjs';

// 메뉴별 도움말 그림. 왼쪽에 단계 목록, 오른쪽에 휴대폰 화면을 두고 단계마다 실제 화면 흐름을 보여 준다.
// 누르는 곳은 동그라미(`tap`)로 알리고, 다음 단계에서 그 결과 화면이 나온다.

const W = 960;
const H = 520;
/** 단계 하나의 길이(초). */
const STEP = 3.8;

/** 휴대폰 화면 안쪽 영역. 단계 화면은 help-pages.mjs에서 이 좌표로 그린다. */
export const SCREEN = { x: 612, y: 32, w: 276, h: 456 };

export const HELP_PAGES = PAGES;

/** 도움말 글의 `단추 이름`을 그림 글자로 바꾼다(그림에는 ‘단추 이름’). */
const plain = (s) => s.replace(/`([^`]+)`/g, '‘$1’');

/** 앱 바 오른쪽 아이콘(내 성과·시뮬레이션·설정). 지금 메뉴의 아이콘에 바탕을 깐다. */
function appIcons(t, active) {
  const y = SCREEN.y + 40;
  const icons = [
    ['performance', (x) => `<rect x="${x - 8}" y="${y - 6}" width="16" height="12" rx="3" fill="none" stroke="${t.t1}" stroke-width="1.6"/><path d="M${x - 3} ${y - 6} v-2.5 h6 v2.5 M${x - 5} ${y + 2} l3 -3 2 2 3 -3" fill="none" stroke="${t.t1}" stroke-width="1.6" stroke-linejoin="round"/>`],
    ['simulate', (x) => `<path d="M${x - 8} ${y - 8} v16 h16 M${x - 5} ${y + 3} l4 -5 3 3 5 -6" fill="none" stroke="${t.t1}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>`],
    ['settings', (x) => `<circle cx="${x}" cy="${y}" r="3" fill="none" stroke="${t.t1}" stroke-width="1.6"/><circle cx="${x}" cy="${y}" r="7.5" fill="none" stroke="${t.t1}" stroke-width="1.6" stroke-dasharray="3.2 2.7"/>`],
  ];
  return icons
    .map(([key, draw], i) => {
      const x = SCREEN.x + SCREEN.w - 94 + i * 38;
      const on = key === active;
      return `${on ? `<rect x="${x - 16}" y="${y - 16}" width="32" height="32" rx="10" fill="${t.surface2}"/>` : ''}${draw(x)}`;
    })
    .join('');
}

/** 앱 바. 비교 화면은 그룹 이름과 ＋, 다른 화면은 ‹ 와 화면 이름. */
function appBar(t, page, title) {
  const y = SCREEN.y + 46;
  const left =
    page.tab === 'compare'
      ? `${text(SCREEN.x + 16, y, title, { size: 17, weight: 800, fill: t.t1 })}${text(SCREEN.x + 30 + textWidth(title, 17), y, '＋', { size: 15, weight: 600, fill: t.t2 })}`
      : `${text(SCREEN.x + 16, y, '‹', { size: 20, weight: 600, fill: t.t2 })}${text(SCREEN.x + 34, y, title, { size: 17, weight: 800, fill: t.t1 })}`;
  return `${left}${appIcons(t, page.tab)}`;
}

export function renderHelp(page, t, mode) {
  const delay = at(STEP);
  const ctx = { t, dark: mode === 'dark', delay, SCREEN };

  const stepY = (i) => 236 + i * 52;
  const steps = page.steps
    .map(
      (s, i) => `<g>
<rect class="sc s${i}" style="${delay(i)}" x="32" y="${stepY(i) - 23}" width="540" height="48" rx="14" fill="${t.accentSoft}"/>
<circle cx="58" cy="${stepY(i)}" r="13" fill="none" stroke="${t.t3}" stroke-width="1.5"/>
${text(58, stepY(i) + 4.5, i + 1, { size: 13, weight: 800, fill: t.t2, anchor: 'middle' })}
<g class="sc s${i}" style="${delay(i)}"><circle cx="58" cy="${stepY(i)}" r="13" fill="${t.accent}"/>${text(58, stepY(i) + 4.5, i + 1, { size: 13, weight: 800, fill: t.onAccent, anchor: 'middle' })}</g>
${text(82, stepY(i) - 2, plain(s.title), { size: 16, weight: 800, fill: t.t1 })}
${text(82, stepY(i) + 16, plain(s.sub), { size: 13, fill: t.t3 })}
</g>`,
    )
    .join('');

  const screens = page.steps
    .map((s, i) => {
      const d = (offset = 0) => delay(i, offset);
      return `<g class="sc s${i}" style="${delay(i)}">${appBar(t, page, s.appBar ?? page.appBar ?? page.title)}${s.screen({ ...ctx, d })}</g>`;
    })
    .join('\n');

  const lead = page.lead.map((line, i) => text(40, 150 + i * 23, plain(line), { size: 15, weight: 600, fill: t.t2 })).join('');

  const body = `<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="28" fill="${t.bg}" stroke="${t.line}"/>
${text(40, 66, '가즈아 도움말', { size: 14, weight: 700, fill: t.t3 })}
${text(40, 110, page.title, { size: 30, weight: 800, fill: t.t1 })}
${lead}
${steps}
<rect x="600" y="20" width="300" height="480" rx="42" fill="${t.surface2}" stroke="${t.line}" stroke-width="2"/>
<rect x="${SCREEN.x}" y="${SCREEN.y}" width="${SCREEN.w}" height="${SCREEN.h}" rx="32" fill="${t.bg}"/>
<rect x="${SCREEN.x + SCREEN.w / 2 - 30}" y="${SCREEN.y + 8}" width="60" height="7" rx="3.5" fill="${t.line}"/>
<clipPath id="screen"><rect x="${SCREEN.x}" y="${SCREEN.y}" width="${SCREEN.w}" height="${SCREEN.h}" rx="32"/></clipPath>
<g clip-path="url(#screen)">
${screens}</g>`;

  return svgDocument({
    w: W,
    h: H,
    title: `가즈아 도움말 — ${page.title}`,
    desc: plain(`${page.title} 사용법: ${page.steps.map((s, i) => `${i + 1}. ${s.title}(${s.sub})`).join(' ')}`),
    css: motionCss({ sceneLength: STEP, scenes: page.steps.length, ...MOTION }),
    body,
  });
}

const picture = (page, alt) => `<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../public/help/img/${page.id}-dark.svg">
    <img src="../../public/help/img/${page.id}-light.svg" width="960" alt="${esc(alt).replace(/"/g, '&quot;')}">
  </picture>
</p>`;

/** 메뉴 하나의 도움말 글(docs/help/<id>.md). */
export function renderHelpMarkdown(page) {
  const alt = plain(`${page.title} 사용법: ${page.steps.map((s, i) => `${i + 1}. ${s.title}`).join(', ')}`);
  return `# ${page.title}

<!-- 이 파일은 corepack pnpm build:motion으로 생성합니다. 문구는 scripts/motion/help-pages.mjs에서 고칩니다. -->

${picture(page, alt)}

${page.lead.join(' ')}

## 이렇게 써요

${page.steps.map((s, i) => `${i + 1}. **${s.title}** — ${s.sub}`).join('\n')}

## 알아 두면 좋아요

${page.tips.map((tip) => `- ${tip}`).join('\n')}

---

[도움말 모음](README.md) · [README](../../README.md)
`;
}

/** 도움말 모음(docs/help/README.md). */
export function renderHelpIndex(pages) {
  return `# 가즈아 도움말

<!-- 이 파일은 corepack pnpm build:motion으로 생성합니다. 문구는 scripts/motion/help-pages.mjs에서 고칩니다. -->

메뉴마다 실제 화면 흐름을 움직이는 그림으로 보여 줍니다. 서비스 소개는 [README](../../README.md)에 있습니다.

| 메뉴 | 이렇게 써요 |
| --- | --- |
${pages.map((p) => `| [${p.title}](${p.id}.md) | ${p.steps.map((s) => s.title).join(' → ')} |`).join('\n')}

그림과 글, 앱 도움말 문구는 \`corepack pnpm build:motion\`이 \`scripts/motion/help-pages.mjs\`로 만듭니다. 화면 문구가 바뀌면 그 파일을 고치고 다시 만드세요.
`;
}

/** 앱 도움말이 쓰는 문구(src/lib/help/content.ts). 그림 함수는 빼고, 문서 사이 상대 링크는 GitHub 주소로 바꾼다. */
export function renderHelpContent(pages) {
  const DOCS = 'https://github.com/sch0718/gazua/blob/main/docs/';
  const abs = (s) => s.replace(/\]\(\.\.\/([^)]+)\)/g, (_, path) => `](${DOCS}${path})`);
  const content = pages.map(({ id, title, lead, steps, tips }) => ({
    id,
    title,
    lead,
    steps: steps.map(({ title, sub }) => ({ title, sub })),
    tips: tips.map(abs),
  }));
  return `// 이 파일은 corepack pnpm build:motion으로 생성합니다. 직접 고치지 마세요.
// 도움말 문구는 scripts/motion/help-pages.mjs에서 고칩니다.

export const HELP_PAGES = ${JSON.stringify(content, null, 2)} as const;

export type HelpPageId = (typeof HELP_PAGES)[number]['id'];
export type HelpPage = (typeof HELP_PAGES)[number];
`;
}
