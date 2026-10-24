// README·도움말의 움직이는 그림(애니메이션 SVG)이 함께 쓰는 그리기 도구.
// GitHub는 SVG를 <img>로 보여 주므로 스크립트·웹 글꼴 없이 CSS 애니메이션만 쓴다.
import { readFileSync } from 'node:fs';

export const FONT =
  "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";

/** 앱 토큰(src/lib/ui/tokens.css)에서 라이트(`:root`)·다크(`:root[data-theme='dark']`) 색을 읽는다. */
export function loadTheme(cssPath) {
  const css = readFileSync(cssPath, 'utf8');
  const block = (selector) => {
    const start = css.indexOf(`${selector} {`);
    if (start < 0) throw new Error(`tokens.css에 ${selector} 블록이 없어요`);
    const body = css.slice(start, css.indexOf('\n}', start));
    return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  };
  const light = block(':root');
  const dark = { ...light, ...block(":root[data-theme='dark']") };
  const pick = (v) => ({
    bg: v.bg,
    surface: v.surface,
    surface2: v.surface2,
    line: v.line,
    t1: v.t1,
    t2: v.t2,
    t3: v.t3,
    accent: v.accent,
    accentSoft: v['accent-soft'],
    onAccent: v['on-accent'],
    up: v.up,
    down: v.down,
    ok: v.ok,
    warn: v.warn,
    err: v.err,
    scrim: v.scrim,
    bench: v['line-bench'],
    etf: v['etf-1'],
    s: Array.from({ length: 10 }, (_, i) => v[`s${i + 1}`]),
  });
  return { light: pick(light), dark: pick(dark) };
}

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 장면 `scene`(0부터)이 시작하고 `offset`초 뒤에 움직임을 시작한다. */
export const at =
  (sceneLength) =>
  (scene, offset = 0) =>
    `animation-delay:${(scene * sceneLength + offset).toFixed(2)}s`;

export function text(x, y, value, { size = 14, weight = 400, fill, anchor = 'start', cls = '', style = '' } = {}) {
  const extra = `${cls ? ` class="${cls}"` : ''}${style ? ` style="${style}"` : ''}`;
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${extra}>${esc(value)}</text>`;
}

/** 글자 폭 근사(한글 1em, 이모지 1.2em, 그 밖 0.6em). */
export function textWidth(label, size) {
  let w = 0;
  for (const ch of String(label)) {
    if (/\p{Extended_Pictographic}/u.test(ch)) w += size * 1.2;
    else if (/[ㄱ-힝]/u.test(ch)) w += size;
    else if (ch !== '️') w += size * 0.6;
  }
  return Math.round(w);
}

/** 폭 `maxW`를 넘으면 뒤를 자르고 …를 붙인다. */
export function fit(label, size, maxW) {
  let out = String(label);
  if (textWidth(out, size) <= maxW) return out;
  while (out.length > 1 && textWidth(`${out}…`, size) > maxW) out = out.slice(0, -1);
  return `${out.trimEnd()}…`;
}

/** 둥근 칩. `on`이면 강조색 바탕. */
export function chip(x, y, label, t, { on = false, size = 12, h = 26, fill, color } = {}) {
  const w = textWidth(label, size) + 22;
  const bg = fill ?? (on ? t.accent : t.surface2);
  const fg = color ?? (on ? t.onAccent : t.t2);
  return {
    w,
    svg: `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${bg}"/>${text(x + w / 2, y + h / 2 + size * 0.36, label, { size, weight: 700, fill: fg, anchor: 'middle' })}`,
  };
}

export function card(x, y, w, h, t, { rx = 14, fill, stroke } = {}) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill ?? t.surface}" stroke="${stroke ?? t.line}"/>`;
}

/** 단추. `variant`: 'filled'(강조 바탕) · 'tonal'(표면 2) · 'outlined'. */
export function button(x, y, w, label, t, { variant = 'filled', h = 36, size = 13 } = {}) {
  const cx = x + w / 2;
  const ty = y + h / 2 + size * 0.36;
  if (variant === 'filled')
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${t.accent}"/>${text(cx, ty, label, { size, weight: 800, fill: t.onAccent, anchor: 'middle' })}`;
  if (variant === 'tonal')
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${t.surface2}"/>${text(cx, ty, label, { size, weight: 700, fill: t.t1, anchor: 'middle' })}`;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="none" stroke="${t.line}"/>${text(cx, ty, label, { size, weight: 700, fill: t.t1, anchor: 'middle' })}`;
}

/** 세그먼트(일·주·월·년 같은 한 줄 선택). `on`은 고른 칸 번호. */
export function segmented(x, y, w, items, on, t, { h = 34, size = 13, onStyle = '' } = {}) {
  const cw = w / items.length;
  const cells = items
    .map((label, i) => {
      const cx = x + cw * i + cw / 2;
      return text(cx, y + h / 2 + size * 0.36, label, { size, weight: i === on ? 800 : 600, fill: i === on ? t.t1 : t.t3, anchor: 'middle' });
    })
    .join('');
  const thumb = `<rect${onStyle ? ` ${onStyle}` : ''} x="${x + cw * on + 3}" y="${y + 3}" width="${cw - 6}" height="${h - 6}" rx="${(h - 6) / 2}" fill="${t.surface}" stroke="${t.line}"/>`;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${t.surface2}"/>${thumb}${cells}`;
}

/** 누르는 곳을 알리는 동그라미. */
export function tap(x, y, t, style) {
  return `<circle class="tap" style="${style}" cx="${x}" cy="${y}" r="16" fill="${t.t1}" fill-opacity=".22" stroke="${t.t1}" stroke-opacity=".5" stroke-width="2"/>`;
}

/** 시드가 같으면 같은 값이 나오는 무작위 걷기. 차트 선 모양에 쓴다. */
export function walk(seed, n, { drift = 0, vol = 1 } = {}) {
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
  const out = [0];
  for (let i = 1; i < n; i++) out.push(out[i - 1] + drift + (rnd() - 0.5) * 2 * vol);
  return out;
}

/** 값 배열을 상자 안 꺾은선 경로로. `min`·`max`를 주면 여러 선이 같은 축을 쓴다. */
export function linePath(values, { x, y, w, h }, min = Math.min(...values), max = Math.max(...values)) {
  const span = max - min || 1;
  return values
    .map((v, i) => `${i ? 'L' : 'M'}${(x + (w * i) / (values.length - 1)).toFixed(1)} ${(y + h - ((v - min) / span) * h).toFixed(1)}`)
    .join(' ');
}

/** 마지막 값의 y 좌표(선 끝 이름표 위치). */
export function lastY(values, { y, h }, min, max) {
  const span = max - min || 1;
  return y + h - ((values.at(-1) - min) / span) * h;
}

/** 여러 선을 한 축에 그린다. `lines`: [{ values, color, width?, dash? }]. 선은 왼쪽부터 그려진다(`.draw`). */
export function chart(box, lines, { style = '', grid, zero } = {}) {
  const all = lines.flatMap((l) => l.values);
  const min = Math.min(...all);
  const max = Math.max(...all);
  const gridLines = grid
    ? [0.25, 0.5, 0.75]
        .map((f) => `<path d="M${box.x} ${(box.y + box.h * f).toFixed(1)} H${box.x + box.w}" stroke="${grid}" stroke-width="1"/>`)
        .join('')
    : '';
  const zeroLine =
    zero && min < 0 && max > 0
      ? `<path d="M${box.x} ${(box.y + box.h - ((0 - min) / (max - min)) * box.h).toFixed(1)} H${box.x + box.w}" stroke="${zero}" stroke-width="1" stroke-dasharray="2 3"/>`
      : '';
  // 점선은 그려지는 효과(stroke-dasharray)와 겹치므로 나타나기만 한다.
  const paths = lines
    .map(
      (l) =>
        `<path class="${l.dash ? 'fade' : 'draw'}" style="${style}"${l.dash ? '' : ' pathLength="1"'} d="${linePath(l.values, box, min, max)}" fill="none" stroke="${l.color}" stroke-width="${l.width ?? 2}" stroke-linejoin="round" stroke-linecap="round"${l.dash ? ` stroke-dasharray="${l.dash}"` : ''}/>`,
    )
    .join('');
  return { svg: `${gridLines}${zeroLine}${paths}`, min, max };
}

/** ▲·▼가 붙은 등락 글자. 한국 관례(빨강 상승·파랑 하락). */
export function change(x, y, value, t, { size = 13, anchor = 'end', weight = 800, unit = '%' } = {}) {
  const up = value >= 0;
  const label = `${up ? '▲ +' : '▼ −'}${Math.abs(value).toFixed(2)}${unit}`;
  return text(x, y, label, { size, weight, fill: up ? t.up : t.down, anchor });
}

/**
 * 애니메이션 CSS. 장면 길이 `sceneLength`초, 장면 수 `scenes`. 각 장면의 요소는 `at(scene, offset)`으로 늦춘다.
 * 모든 움직임은 한 바퀴(`cycle`) 동안 한 번 일어나고, 장면 그룹(`.sc`)이 자기 차례에만 보인다.
 */
export function motionCss({ sceneLength, scenes, font = FONT }) {
  const cycle = sceneLength * scenes;
  const p = (s) => `${((s / cycle) * 100).toFixed(3)}%`;
  return `
text{font-family:${font}}
.sc{opacity:0;animation:scene ${cycle}s linear infinite backwards}
.rise{transform-box:fill-box;animation:rise ${cycle}s cubic-bezier(.2,.8,.2,1) infinite backwards}
.pop{transform-box:fill-box;transform-origin:center;animation:pop ${cycle}s ease-out infinite backwards}
.draw{stroke-dasharray:1;stroke-dashoffset:1;animation:draw ${cycle}s ease-out infinite backwards}
.fade{opacity:0;animation:fade ${cycle}s linear infinite backwards}
.tap{transform-box:fill-box;transform-origin:center;opacity:0;animation:tap ${cycle}s ease-out infinite backwards}
@keyframes scene{0%{opacity:0}${p(0.35)}{opacity:1}${p(sceneLength - 0.35)}{opacity:1}${p(sceneLength)}{opacity:0}100%{opacity:0}}
@keyframes rise{0%{opacity:0;transform:translateY(14px)}${p(0.45)}{opacity:1;transform:none}100%{opacity:1;transform:none}}
@keyframes pop{0%{transform:scale(0)}${p(0.3)}{transform:scale(1.15)}${p(0.45)}{transform:scale(1)}100%{transform:scale(1)}}
@keyframes draw{0%{stroke-dashoffset:1}${p(1.2)}{stroke-dashoffset:0}100%{stroke-dashoffset:0}}
@keyframes fade{0%{opacity:0}${p(0.3)}{opacity:1}100%{opacity:1}}
@keyframes tap{0%{opacity:0;transform:scale(.4)}${p(0.12)}{opacity:1;transform:scale(1)}${p(0.7)}{opacity:0;transform:scale(1.9)}100%{opacity:0;transform:scale(1.9)}}
@media (prefers-reduced-motion:reduce){
*{animation:none!important}
.s0{opacity:1}
.rise,.fade{opacity:1;transform:none}
.pop{transform:none}
.draw{stroke-dasharray:none;stroke-dashoffset:0}
}`;
}

export function svgDocument({ w, h, title, desc, css, body }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="motion-title motion-desc">
<title id="motion-title">${esc(title)}</title>
<desc id="motion-desc">${esc(desc)}</desc>
<style>${css}</style>
${body}
</svg>
`;
}
