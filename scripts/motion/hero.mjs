import { at, card, chart, chip, motionCss, segmented, svgDocument, text, textWidth, walk } from './kit.mjs';

// README 맨 위의 소개 그림. 장면 넷(비교하기 → 규칙 시험하기 → 기준 검증하기 → 내 성과 보기)이 이어서 돈다.

const W = 960;
const H = 440;
/** 장면 하나의 길이(초). */
const SCENE = 4.2;
const SCENES = 4;
const delay = at(SCENE);

/** 오른쪽 패널 안쪽 영역. */
const P = { x: 396, y: 64, w: 500, r: 896 };

const rise = (scene, offset, body) => `<g class="rise" style="${delay(scene, offset)}">${body}</g>`;

function legend(t, x, y, items) {
  let cx = x;
  return items
    .map(([name, color, dash]) => {
      const svg = `<path d="M${cx} ${y - 4} h16" stroke="${color}" stroke-width="2.5"${dash ? ` stroke-dasharray="${dash}"` : ''}/>${text(cx + 21, y, name, { size: 12, fill: t.t2 })}`;
      cx += 34 + textWidth(name, 12);
      return svg;
    })
    .join('');
}

function stat(t, scene, offset, x, y, w, name, value, sub, color) {
  return rise(
    scene,
    offset,
    `${card(x, y, w, 76, t)}${text(x + 14, y + 22, name, { size: 12, fill: t.t3 })}${text(x + 14, y + 50, value, { size: 22, weight: 800, fill: color ?? t.t1 })}${sub ? text(x + 14, y + 67, sub, { size: 11, fill: t.t3 }) : ''}`,
  );
}

export function renderHero(t, logo) {
  const steps = [
    ['비교하기', '관심종목을 한 차트에 나란히'],
    ['규칙 시험하기', '내 매수·매도 규칙을 과거로'],
    ['기준 검증하기', '종목 고르는 기준을 시점마다'],
    ['내 성과 보기', '실제 거래를 지수와 비교'],
  ];
  const stepY = (i) => 196 + i * 50;
  const stepList = steps
    .map(
      ([title, sub], i) => `<g>
<rect class="sc s${i}" style="${delay(i)}" x="40" y="${stepY(i) - 22}" width="300" height="46" rx="14" fill="${t.accentSoft}"/>
<circle cx="64" cy="${stepY(i)}" r="13" fill="none" stroke="${t.t3}" stroke-width="1.5"/>
${text(64, stepY(i) + 4.5, i + 1, { size: 13, weight: 800, fill: t.t2, anchor: 'middle' })}
<g class="sc s${i}" style="${delay(i)}"><circle cx="64" cy="${stepY(i)}" r="13" fill="${t.accent}"/>${text(64, stepY(i) + 4.5, i + 1, { size: 13, weight: 800, fill: t.onAccent, anchor: 'middle' })}</g>
${text(88, stepY(i) - 2, title, { size: 17, weight: 800, fill: t.t1 })}
${text(88, stepY(i) + 16, sub, { size: 13, fill: t.t3 })}
</g>`,
    )
    .join('');

  // 장면 1: 비교 차트와 순위
  const stocks = [
    ['한미반도체', 2, 11, 0.32, 1.73],
    ['DB하이텍', 3, 23, -0.02, -0.39],
    ['SK하이닉스', 1, 37, -0.08, -1.1],
  ];
  const c1 = chart(
    { x: P.x, y: P.y + 52, w: 300, h: 220 },
    stocks.map(([, slot, seed, drift]) => ({ values: walk(seed, 70, { drift, vol: 0.9 }), color: t.s[slot], width: 2.2 })),
    { style: delay(0, 0.4), grid: t.line, zero: t.t3 },
  );
  const scene1 = `<g class="sc s0" style="${delay(0)}">
${text(P.x, P.y + 10, '내 관심', { size: 19, weight: 800, fill: t.t1 })}
${text(P.r, P.y + 10, '10/23(금) · 등락률', { size: 13, fill: t.t3, anchor: 'end' })}
${rise(0, 0.2, segmented(P.x, P.y + 22, 180, ['일', '주', '월', '년'], 0, t, { h: 26, size: 12 }))}
${c1.svg}
${stocks
  .map(([name, slot, , , pct], i) => {
    const y = P.y + 74 + i * 64;
    const up = pct >= 0;
    return rise(
      0,
      0.8 + i * 0.2,
      `${card(P.x + 316, y, 184, 54, t)}<circle cx="${P.x + 332}" cy="${y + 20}" r="6" fill="${t.s[slot]}"/>${text(P.x + 344, y + 25, name, { size: 14, weight: 800, fill: t.t1 })}${text(P.x + 488, y + 44, `${up ? '▲ +' : '▼ −'}${Math.abs(pct).toFixed(2)}%`, { size: 13, weight: 800, fill: up ? t.up : t.down, anchor: 'end' })}`,
    );
  })
  .join('')}
${rise(0, 1.6, text(P.x, P.y + 298, 'KRX·NXT 거래 시간과 단일가 구간까지 한 화면에', { size: 13, fill: t.t2 }))}
</g>`;

  // 장면 2: 매매 규칙 시뮬레이션
  const c2 = chart(
    { x: P.x, y: P.y + 134, w: P.w, h: 150 },
    [
      { values: walk(5, 80, { drift: 0.05, vol: 0.6 }), color: t.t3, width: 1.8 },
      { values: walk(8, 80, { drift: 0.03, vol: 0.9 }), color: t.bench, width: 1.8, dash: '5 4' },
      { values: walk(14, 80, { drift: 0.11, vol: 0.5 }), color: t.accent, width: 2.8 },
    ],
    { style: delay(1, 0.7), grid: t.line, zero: t.t3 },
  );
  const scene2 = `<g class="sc s1" style="${delay(1)}">
${text(P.x, P.y + 10, '매매 규칙 시뮬레이션', { size: 19, weight: 800, fill: t.t1 })}
${text(P.r, P.y + 10, '고점 대비 10% 하락 → 3일 연속 상승', { size: 13, fill: t.t3, anchor: 'end' })}
${stat(t, 1, 0.2, P.x, P.y + 24, 160, '총수익률', '▲ +3.9%', '그냥 보유보다 +5.4%p', t.up)}
${stat(t, 1, 0.3, P.x + 170, P.y + 24, 160, '최대 낙폭', '−2.8%', '')}
${stat(t, 1, 0.4, P.x + 340, P.y + 24, 160, '승률', '44.4%', '4승 5패')}
${rise(1, 0.6, legend(t, P.x, P.y + 124, [['내 전략', t.accent], ['같은 종목 사서 보유', t.t3], ['KODEX 200', t.bench, '5 4']]))}
${c2.svg}
${rise(1, 1.9, text(P.x, P.y + 306, '수수료·세금(결제일 기준)까지 빼고 계산해요', { size: 13, fill: t.t2 }))}
</g>`;

  // 장면 3: 선정 기준 검증
  const conds = ['시가총액 1,000억↑', '거래대금 10억↑', '반등 신호', 'ROE 10%↑', '순매수'];
  let cx = P.x;
  const condChips = conds
    .map((name, i) => {
      const c = chip(cx, P.y + 30, name, t, { on: i !== 3, size: 12, h: 28 });
      cx += c.w + 6;
      return `<g class="pop" style="${delay(2, 0.2 + i * 0.12)}">${c.svg}</g>`;
    })
    .join('');
  const c3 = chart(
    { x: P.x, y: P.y + 112, w: 300, h: 170 },
    [
      { values: walk(31, 70, { drift: 0.04, vol: 0.8 }), color: t.t2, width: 1.6, dash: '2 4' },
      { values: walk(44, 70, { drift: 0.06, vol: 0.7 }), color: t.etf, width: 1.8, dash: '5 4' },
      { values: walk(52, 70, { drift: 0.12, vol: 0.9 }), color: t.accent, width: 2.8 },
    ],
    { style: delay(2, 0.9), grid: t.line, zero: t.t3 },
  );
  const picks = ['삼성전자', 'SK하이닉스', '한미반도체', '현대차', 'NAVER'];
  const scene3 = `<g class="sc s2" style="${delay(2)}">
${text(P.x, P.y + 10, '선정 기준 검증', { size: 19, weight: 800, fill: t.t1 })}
${text(P.r, P.y + 10, '매월 상위 10 · 2023–2026', { size: 13, fill: t.t3, anchor: 'end' })}
${condChips}
${rise(2, 0.7, legend(t, P.x, P.y + 94, [['① 선정만', t.accent], ['ETF', t.etf, '5 4'], ['지수', t.t2, '2 4']]))}
${c3.svg}
${rise(2, 1.2, `${card(P.x + 316, P.y + 78, 184, 204, t)}${text(P.x + 330, P.y + 102, '오늘 기준 선별', { size: 13, weight: 800, fill: t.t1 })}`)}
${picks.map((n, i) => rise(2, 1.4 + i * 0.12, `${text(P.x + 330, P.y + 130 + i * 28, `${i + 1}`, { size: 12, weight: 800, fill: t.t3 })}${text(P.x + 348, P.y + 130 + i * 28, n, { size: 13, weight: 700, fill: t.t1 })}`)).join('')}
${rise(2, 2.2, `<rect x="${P.x + 330}" y="${P.y + 254}" width="156" height="22" rx="11" fill="${t.accent}"/>${text(P.x + 408, P.y + 269, '새 그룹으로 만들기', { size: 11.5, weight: 800, fill: t.onAccent, anchor: 'middle' })}`)}
${rise(2, 1.9, text(P.x, P.y + 306, '재선정일마다 그 전날까지의 데이터만으로 골라요', { size: 13, fill: t.t2 }))}
</g>`;

  // 장면 4: 내 성과
  const stepsUp = (seed, drift) => walk(seed, 80, { drift, vol: 0.5 }).map((v, i) => v + Math.floor(i / 14) * 6);
  const c4 = chart(
    { x: P.x, y: P.y + 132, w: P.w, h: 150 },
    [
      { values: Array.from({ length: 80 }, (_, i) => Math.floor(i / 14) * 6 + 1.5), color: t.t2, width: 1.6, dash: '3 4' },
      { values: stepsUp(71, -0.03), color: t.t3, width: 1.8 },
      { values: stepsUp(74, 0.07), color: t.accent, width: 2.8 },
    ],
    { style: delay(3, 0.8), grid: t.line },
  );
  const scene4 = `<g class="sc s3" style="${delay(3)}">
${text(P.x, P.y + 10, '내 성과', { size: 19, weight: 800, fill: t.t1 })}
${text(P.r, P.y + 10, '토스 계좌 체결 주문 · 같은 날 같은 금액', { size: 13, fill: t.t3, anchor: 'end' })}
${stat(t, 3, 0.2, P.x, P.y + 24, 160, '내 IRR', '−4.2%', '−205,565원', t.down)}
${stat(t, 3, 0.35, P.x + 170, P.y + 24, 160, 'KODEX 200 IRR', '−13.3%', '−646,387원', t.down)}
${stat(t, 3, 0.5, P.x + 340, P.y + 24, 160, '초과', '+9.1%p', '+440,822원', t.up)}
${rise(3, 0.7, legend(t, P.x, P.y + 122, [['내 계좌', t.accent], ['KODEX 200', t.t3], ['넣은 돈', t.t2, '3 4']]))}
${c4.svg}
${rise(3, 1.9, text(P.x, P.y + 306, '종목별 기여도와 보유 수량 대조까지', { size: 13, fill: t.t2 }))}
</g>`;

  return svgDocument({
    w: W,
    h: H,
    title: '가즈아 — 관심종목을 한 차트에 놓고 비교하는 주식 앱',
    desc: '관심종목을 한 차트에 나란히 비교하고, 내 매매 규칙을 과거 데이터로 시험하고, 종목 선정 기준을 시점마다 검증하고, 토스 계좌의 실제 거래를 지수와 비교하는 흐름을 차례로 보여 주는 그림',
    css: motionCss({ sceneLength: SCENE, scenes: SCENES }),
    body: `<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="28" fill="${t.bg}" stroke="${t.line}"/>
<g transform="translate(40 44) scale(0.109375)">${logo}</g>
${text(112, 76, '가즈아', { size: 30, weight: 800, fill: t.t1 })}
${text(112, 100, 'gazua.sch0718.dev', { size: 13, fill: t.t3 })}
${text(40, 140, '관심종목을 한 차트에 놓고', { size: 17, weight: 700, fill: t.t2 })}
${text(40, 163, '비교하고 시험하는 주식 앱', { size: 17, weight: 700, fill: t.t2 })}
${stepList}
<rect x="372" y="40" width="548" height="360" rx="22" fill="${t.surface}" stroke="${t.line}"/>
${scene1}
${scene2}
${scene3}
${scene4}
`,
  });
}
