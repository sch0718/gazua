// README·도움말의 움직이는 그림(애니메이션 SVG)에서 가즈아만 쓰는 그리기 도구와 값.
// 글자·장면·움직임 CSS·SVG 틀 같은 기반 함수는 @sch0718/motion-kit에 있다.
import { readFileSync } from 'node:fs';
import { effects, text, textWidth } from '@sch0718/motion-kit';

export const FONT =
  "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";

/** motionCss에 넘기는 가즈아의 글꼴과 움직임. `motionCss({ sceneLength, scenes, ...MOTION })` */
export const MOTION = {
  font: FONT,
  effects: [effects.rise, effects.pop, effects.draw({ seconds: 1.2 }), effects.fade, effects.tap],
};

/**
 * 토큰 파일들에서 라이트(`:root`)·다크(`:root[data-theme='dark']`) 색을 읽는다.
 * 앞 파일(범용 토큰)을 뒤 파일(앱 토큰)이 덮는다. 앱이 불러오는 순서와 같다.
 */
export function loadTheme(cssPaths) {
  const block = (css, selector) => {
    const start = css.indexOf(`${selector} {`);
    if (start < 0) throw new Error(`tokens.css에 ${selector} 블록이 없어요`);
    const body = css.slice(start, css.indexOf('\n}', start));
    return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  };
  const files = cssPaths.map((p) => readFileSync(p, 'utf8'));
  const light = Object.assign({}, ...files.map((css) => block(css, ':root')));
  const dark = Object.assign({ ...light }, ...files.map((css) => block(css, ":root[data-theme='dark']")));
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
