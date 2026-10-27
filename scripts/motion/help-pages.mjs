import { esc, text, textWidth } from '@sch0718/motion-kit';
import { button, card, chart, chip, fit, segmented, tap, walk } from './kit.mjs';

// 메뉴별 도움말의 단계와 휴대폰 화면. 문구는 앱 화면의 실제 문구를 그대로 쓴다(src/routes·src/sheets·src/lib/ui).
// 좌표는 help.mjs의 휴대폰 화면(x 612–888, y 32–488) 기준이다. 본문은 x 626–874, y 102–472.

const X = 626;
const W = 248;
const R = X + W;
const TOP = 102;
const SX = 612;
const SY = 32;
const SW = 276;
const SH = 456;
const TOAST_Y = 428;

/** 데모 종목. 색 번호는 비교 화면의 선 색(--s1…)과 같다. */
const STOCKS = {
  hanmi: { name: '한미반도체', code: '042700', slot: 2, pct: 1.73, price: '130,619원', seed: 11, drift: 0.32 },
  db: { name: 'DB하이텍', code: '000990', slot: 3, pct: -0.39, price: '40,431원', seed: 23, drift: -0.02, nxt: true },
  hynix: { name: 'SK하이닉스', code: '000660', slot: 1, pct: -1.1, price: '199,612원', seed: 37, drift: -0.08, nxt: true },
};

const rise = (c, offset, body) => `<g class="rise" style="${c.d(offset)}">${body}</g>`;
const tapAt = (c, x, y, offset = 2.2) => tap(x, y, c.t, c.d(offset));
const label = (c, x, y, value) => text(x, y, value, { size: 11, weight: 700, fill: c.t.t3 });
const title = (c, y, value) => text(X, y, value, { size: 14, weight: 800, fill: c.t.t1 });

function pctText(c, x, y, v, { size = 13, unit = '%', digits = 2, anchor = 'end' } = {}) {
  const up = v >= 0;
  return text(x, y, `${up ? '▲ +' : '▼ −'}${Math.abs(v).toFixed(digits)}${unit}`, { size, weight: 800, fill: up ? c.t.up : c.t.down, anchor });
}

/** 화면을 덮는 아래쪽 시트. */
function sheet(c, top, name, { close = true, offset = 0.1, sub } = {}) {
  return `<rect x="${SX}" y="${SY}" width="${SW}" height="${SH}" rx="32" fill="${c.t.scrim}"/>
<g class="rise" style="${c.d(offset)}"><path d="M${SX} ${top + 22} q0 -22 22 -22 h${SW - 44} q22 0 22 22 V${SY + SH - 32} q0 32 -32 32 h${-(SW - 64)} q-32 0 -32 -32 Z" fill="${c.t.surface}"/>
<rect x="${SX + SW / 2 - 18}" y="${top + 8}" width="36" height="5" rx="2.5" fill="${c.t.line}"/>
${text(X, top + 40, name, { size: 16, weight: 800, fill: c.t.t1 })}${close ? text(R, top + 40, '✕', { size: 14, weight: 600, fill: c.t.t2, anchor: 'end' }) : ''}
${sub ? text(X, top + 60, sub, { size: 11.5, fill: c.t.t3 }) : ''}</g>`;
}

function toast(c, value, offset) {
  const w = Math.min(W, textWidth(value, 12) + 36);
  return `<g class="rise" style="${c.d(offset)}"><rect x="${X + (W - w) / 2}" y="${TOAST_Y}" width="${w}" height="32" rx="16" fill="${c.t.t1}"/>${text(X + W / 2, TOAST_Y + 20.5, value, { size: 12, weight: 700, fill: c.t.bg, anchor: 'middle' })}</g>`;
}

function badge(c, x, y, value, { color } = {}) {
  const w = textWidth(value, 9.5) + 10;
  return `<rect x="${x}" y="${y}" width="${w}" height="15" rx="4" fill="${c.t.accentSoft}"/>${text(x + w / 2, y + 11, value, { size: 9.5, weight: 800, fill: color ?? c.t.accent, anchor: 'middle' })}`;
}

/** 순위(리더보드) 한 줄. */
function leaderRow(c, y, s, { offset = 0.3, value } = {}) {
  const v = value ?? s.pct;
  return rise(
    c,
    offset,
    `<circle cx="${X + 8}" cy="${y + 12}" r="6" fill="${c.t.s[s.slot]}"/>
${text(X + 24, y + 10, s.name, { size: 13.5, weight: 800, fill: c.t.t1 })}${s.nxt ? badge(c, X + 30 + textWidth(s.name, 13.5), y - 1, 'NXT') : ''}
${text(X + 24, y + 27, s.code, { size: 11, fill: c.t.t3 })}
${pctText(c, R, y + 10, v)}${text(R, y + 27, s.price, { size: 11, fill: c.t.t3, anchor: 'end' })}`,
  );
}

/** 비교 차트: 종목 선 셋과 끝 이름표. */
function compareChart(c, box, seedShift = 0, offset = 0.3) {
  const list = [STOCKS.hanmi, STOCKS.db, STOCKS.hynix];
  const lines = list.map((s) => ({ values: walk(s.seed + seedShift, 60, { drift: s.drift, vol: 0.9 }), color: c.t.s[s.slot] }));
  const ch = chart(box, lines, { style: c.d(offset), grid: c.t.line, zero: c.t.t3 });
  // 선 끝 이름표. 겹치지 않게 12px 이상 띄운다.
  const span = ch.max - ch.min || 1;
  const ends = list
    .map((s, i) => ({ s, y: box.y + box.h - ((lines[i].values.at(-1) - ch.min) / span) * box.h }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 12);
  const tags = ends.map(({ s, y }) => text(box.x + box.w + 4, y + 3.5, s.name, { size: 9.5, weight: 800, fill: c.t.t2 })).join('');
  return `${ch.svg}<g class="fade" style="${c.d(offset + 1.2)}">${tags}</g>`;
}

function selectBox(c, x, y, w, value) {
  return `<rect x="${x}" y="${y}" width="${w}" height="34" rx="10" fill="${c.t.surface}" stroke="${c.t.line}"/>${text(x + 12, y + 22, value, { size: 12.5, weight: 600, fill: c.t.t1 })}${text(x + w - 12, y + 22, '⌄', { size: 13, fill: c.t.t2, anchor: 'end' })}`;
}

/** 시뮬레이션 편집 화면의 접힌 칸. */
function foldCard(c, y, name, summary, { h = 46, on = false, offset = 0.2 } = {}) {
  return rise(
    c,
    offset,
    `${card(X, y, W, h, c.t, { fill: on ? c.t.accentSoft : c.t.surface, stroke: on ? c.t.accent : c.t.line })}
${text(X + 12, y + 19, name, { size: 12.5, weight: 800, fill: c.t.t1 })}${text(X + 12, y + 36, fit(summary, 10.5, W - 40), { size: 10.5, fill: c.t.t2 })}${text(R - 12, y + 26, '▾', { size: 10, fill: c.t.t3, anchor: 'end' })}`,
  );
}

function statCard(c, x, y, w, name, value, sub, { color, h = 70, offset = 0.3 } = {}) {
  return rise(
    c,
    offset,
    `${card(x, y, w, h, c.t)}${text(x + 10, y + 18, name, { size: 10.5, fill: c.t.t3 })}${text(x + 10, y + 42, value, { size: 18, weight: 800, fill: color ?? c.t.t1 })}${sub ? text(x + 10, y + 59, sub, { size: 10, fill: c.t.t3 }) : ''}`,
  );
}

function toggle(c, x, y, on) {
  return on
    ? `<rect x="${x}" y="${y}" width="36" height="22" rx="11" fill="${c.t.accent}"/><circle cx="${x + 25}" cy="${y + 11}" r="8" fill="${c.t.onAccent}"/>`
    : `<rect x="${x}" y="${y}" width="36" height="22" rx="11" fill="${c.t.surface2}" stroke="${c.t.line}"/><circle cx="${x + 11}" cy="${y + 11}" r="8" fill="${c.t.t3}"/>`;
}

function legend(c, x, y, items) {
  let cx = x;
  return items
    .map(([name, color, dash]) => {
      const svg = `<path d="M${cx} ${y - 4} h14" stroke="${color}" stroke-width="2.5"${dash ? ` stroke-dasharray="${dash}"` : ''}/>${text(cx + 18, y, name, { size: 10, fill: c.t.t2 })}`;
      cx += 26 + textWidth(name, 10);
      return svg;
    })
    .join('');
}

const searchBox = (c, y, value, { placeholder } = {}) =>
  `<rect x="${X}" y="${y}" width="${W}" height="36" rx="12" fill="${c.t.surface2}"/>
<circle cx="${X + 18}" cy="${y + 17}" r="5.5" fill="none" stroke="${c.t.t3}" stroke-width="1.6"/><path d="M${X + 22} ${y + 21} l4 4" stroke="${c.t.t3}" stroke-width="1.6"/>
${text(X + 32, y + 23, value ?? placeholder, { size: 13, weight: value ? 700 : 400, fill: value ? c.t.t1 : c.t.t3 })}`;

/** 종목 추가 시트의 한 줄. `state`: 'add'(＋) · 'in'(✓). */
function addRow(c, y, name, code, state, { offset = 0.3, hit = 0 } = {}) {
  const on = state === 'in';
  // 검색어와 맞은 앞부분은 강조색. 한 <text> 안의 <tspan>이라 글자 사이가 벌어지지 않는다.
  const hl = text(X, y + 14, name, { size: 13.5, weight: 800, fill: c.t.t1 }).replace(`>${esc(name)}<`, `><tspan fill="${c.t.accent}">${esc(name.slice(0, hit))}</tspan>${esc(name.slice(hit))}<`);
  return rise(
    c,
    offset,
    `${hl}${text(X, y + 31, code, { size: 11, fill: c.t.t3 })}
<rect x="${R - 34}" y="${y}" width="34" height="34" rx="10" fill="${on ? c.t.accent : c.t.surface2}"/>${text(R - 17, y + 22, on ? '✓' : '＋', { size: 14, weight: 800, fill: on ? c.t.onAccent : c.t.t1, anchor: 'middle' })}`,
  );
}

export const PAGES = [
  {
    id: 'compare',
    tab: 'compare',
    title: '비교 차트',
    appBar: '내 관심',
    lead: ['관심 그룹의 종목을 한 차트에 놓고', '같은 기준으로 비교해요.'],
    tips: [
      '`자동`·`KRX`·`NXT`·`통합`으로 거래소를 골라요. `자동`은 KRX가 거래 중이면 KRX, KRX가 쉴 때만 NXT를 써요. 토스 공급자는 `통합`만 돼요.',
      '차트 아래 막대는 종목마다 거래할 수 있는 시간이에요. 빗금은 거래 불가, 세로줄은 단일가예요. 앱 바의 상태 칩(`KRX 정규 · 10:12`, `휴장`, `장 마감` 등)을 누르면 오늘 세션 시간표가 나와요.',
      '`표 보기`를 누르면 차트와 같은 값을 시각×종목 표로 봐요.',
      '종목을 누르면 상세 시트가 열려요. 오늘 거래 가능 시간을 보고, `그룹 이동`이나 `삭제`를 해요.',
      '`내 순서`에서는 종목을 길게 눌러 끌거나 Alt+↑↓로 순서를 바꿔요. `값 순`에서는 순서를 바꿀 수 없어요.',
      '단축키: `/` 종목 검색 · `[` `]` 기간 이동 · `M` 지표 선택 · `V` 거래소 순환 · `H` 선택 종목 숨기기 · `?` 도움말',
    ],
    steps: [
      {
        title: '그룹 고르기',
        sub: '그룹 탭을 누르면 그 그룹의 종목으로 차트가 바뀌어요',
        screen: (c) => `${rise(c, 0.1, `${chip(X, TOP, '내 관심', c.t, { on: true }).svg}${chip(X + 76, TOP, '반도체', c.t).svg}${chip(X + 146, TOP, '배당', c.t).svg}`)}
${rise(c, 0.2, text(X, TOP + 50, '10/23(금) · 등락률', { size: 12, weight: 700, fill: c.t.t2 }))}
${compareChart(c, { x: X, y: TOP + 66, w: W - 58, h: 170 })}
${leaderRow(c, TOP + 260, STOCKS.hanmi, { offset: 0.6 })}${leaderRow(c, TOP + 302, STOCKS.db, { offset: 0.7 })}${leaderRow(c, TOP + 344, STOCKS.hynix, { offset: 0.8 })}
${tapAt(c, X + 104, TOP + 13)}`,
      },
      {
        title: '기간 바꾸기',
        sub: '`일`·`주`·`월`·`년`을 누르면 같은 종목을 다른 기간으로 봐요',
        appBar: '반도체',
        screen: (c) => `${rise(c, 0.1, text(X, TOP + 6, '9/23 ~ 10/23 · 등락률', { size: 12, weight: 700, fill: c.t.t2 }))}
${compareChart(c, { x: X, y: TOP + 22, w: W - 58, h: 190 }, 5)}
${rise(c, 0.2, segmented(X, TOP + 232, W - 92, ['일', '주', '월', '년'], 2, c.t))}
${rise(c, 0.25, `<rect x="${R - 84}" y="${TOP + 232}" width="84" height="34" rx="17" fill="${c.t.accentSoft}"/>${text(R - 42, TOP + 254, '등락률 ▾', { size: 12.5, weight: 800, fill: c.t.accent, anchor: 'middle' })}`)}
${rise(c, 0.3, segmented(X, TOP + 280, W, ['자동', 'KRX', 'NXT', '통합'], 0, c.t))}
${rise(c, 0.35, text(X, TOP + 334, 'KRX 우선 · KRX가 쉴 때만 NXT', { size: 11.5, fill: c.t.t3 }))}
${tapAt(c, X + 116, TOP + 249)}`,
      },
      {
        title: '지표 고르기',
        sub: '`등락률`을 눌러 고점 대비 하락률·시장 대비 초과수익 등으로',
        appBar: '반도체',
        screen: (c) => {
          const items = [
            ['등락률', '기간 시작 직전 종가 대비 몇 % 올랐나'],
            ['고점 대비 하락률', '기간 중 최고가에서 얼마나 내려왔나'],
            ['시장 대비 초과수익', 'KOSPI·KOSDAQ보다 얼마나 더 올랐나'],
            ['상대 거래량', '평소(20일 평균) 대비 거래량 배수'],
            ['시가총액', '발행주식수 × 가격 (조 원)'],
            ['변동성', '20일 수익률 표준편차(연율)'],
          ];
          const top = TOP + 6;
          return `${compareChart(c, { x: X, y: TOP + 22, w: W - 58, h: 190 }, 5, 0)}
${sheet(c, top, '비교 지표', { sub: '모든 종목을 같은 기준으로 한 축에 놓아요' })}
${items
  .map(([name, desc], i) => {
    const y = top + 78 + i * 52;
    const on = i === 2;
    return rise(
      c,
      0.3 + i * 0.08,
      `${card(X, y, W, 46, c.t, { fill: on ? c.t.accentSoft : c.t.surface, stroke: on ? c.t.accent : c.t.line, rx: 12 })}${text(X + 12, y + 19, name, { size: 12.5, weight: 800, fill: on ? c.t.accent : c.t.t1 })}${text(X + 12, y + 36, desc, { size: 10.5, fill: c.t.t3 })}${on ? text(R - 12, y + 28, '✓', { size: 14, weight: 800, fill: c.t.accent, anchor: 'end' }) : ''}`,
    );
  })
  .join('')}
${tapAt(c, X + 120, top + 78 + 2 * 52 + 23)}`;
        },
      },
      {
        title: '순위 보기',
        sub: '아래 순위는 `값 순`·`내 순서`로 바꿔 봐요',
        appBar: '반도체',
        screen: (c) => `${rise(c, 0.1, text(X, TOP + 6, '9/23 ~ 10/23 · 시장 대비 초과수익', { size: 12, weight: 700, fill: c.t.t2 }))}
${compareChart(c, { x: X, y: TOP + 22, w: W - 58, h: 140 }, 9)}
${rise(
  c,
  0.3,
  `${text(X, TOP + 196, '초과수익 순 · 3/10', { size: 12, weight: 700, fill: c.t.t2 })}
<rect x="${R - 118}" y="${TOP + 178}" width="118" height="28" rx="14" fill="${c.t.surface2}"/><rect x="${R - 116}" y="${TOP + 180}" width="56" height="24" rx="12" fill="${c.t.surface}"/>
${text(R - 88, TOP + 196, '값 순', { size: 11.5, weight: 800, fill: c.t.t1, anchor: 'middle' })}${text(R - 30, TOP + 196, '내 순서', { size: 11.5, weight: 600, fill: c.t.t3, anchor: 'middle' })}`,
)}
${leaderRow(c, TOP + 226, STOCKS.hanmi, { offset: 0.5, value: 6.2 })}${leaderRow(c, TOP + 272, STOCKS.hynix, { offset: 0.6, value: 1.45 })}${leaderRow(c, TOP + 318, STOCKS.db, { offset: 0.7, value: -2.31 })}
${rise(c, 1.0, `<rect x="${X}" y="${TOP + 362}" width="${W}" height="1" fill="${c.t.line}"/>`)}
${tapAt(c, R - 30, TOP + 192, 2.4)}`,
      },
    ],
  },
  {
    id: 'add',
    tab: 'compare',
    title: '종목 추가',
    appBar: '내 관심',
    lead: ['이름·코드·초성으로 찾아', '한 그룹에 10종목까지 담아요.'],
    tips: [
      'ETF·ETN도 찾을 수 있어요. 종목 목록은 평일 아침마다 새로 받아요.',
      '그룹이 가득 차면(10종목) 더 담을 수 없어요. 종목을 빼거나 새 그룹을 만들어요.',
      'PC에서는 `/`를 누르면 바로 종목 검색이 열려요.',
      '담은 종목은 순위의 `내 순서` 끝에 붙어요. 색은 종목마다 정해져 순위가 바뀌어도 그대로예요.',
    ],
    steps: [
      {
        title: '`＋ 종목 추가` 누르기',
        sub: '비교 화면의 순위 목록 오른쪽 위에 있어요',
        screen: (c) => `${compareChart(c, { x: X, y: TOP + 6, w: W - 58, h: 150 })}
${rise(c, 0.3, `${text(X, TOP + 196, '등락률 순 · 3/10', { size: 12, weight: 700, fill: c.t.t2 })}<rect x="${R - 100}" y="${TOP + 176}" width="100" height="32" rx="16" fill="${c.t.t1}"/>${text(R - 50, TOP + 197, '＋ 종목 추가', { size: 12, weight: 800, fill: c.t.bg, anchor: 'middle' })}`)}
${leaderRow(c, TOP + 228, STOCKS.hanmi, { offset: 0.5 })}${leaderRow(c, TOP + 274, STOCKS.db, { offset: 0.6 })}${leaderRow(c, TOP + 320, STOCKS.hynix, { offset: 0.7 })}
${tapAt(c, R - 50, TOP + 192)}`,
      },
      {
        title: '이름·초성으로 찾기',
        sub: '`삼성`, `ㅅㅅ`, `005930` 모두 돼요',
        screen: (c) => {
          const top = TOP + 4;
          return `${sheet(c, top, '종목 추가', { sub: '내 관심 그룹 · 3/10 · 7개 더 추가할 수 있어요' })}
${rise(c, 0.3, searchBox(c, top + 76, '삼성'))}
${rise(c, 0.4, label(c, X, top + 134, '검색 결과 30'))}
${[
  ['삼성화재', '000810 · KOSPI'],
  ['삼성제약', '001360 · KOSPI'],
  ['삼성전자', '005930 · KOSPI'],
  ['삼성공조', '006660 · KOSPI'],
  ['삼성전기', '009150 · KOSPI'],
]
  .map(([n, code], i) => addRow(c, top + 148 + i * 46, n, code, 'add', { offset: 0.5 + i * 0.1, hit: 2 }))
  .join('')}`;
        },
      },
      {
        title: '＋로 담기',
        sub: '여러 개를 연달아 담고 `완료`',
        screen: (c) => {
          const top = TOP + 4;
          return `${sheet(c, top, '종목 추가', { sub: '내 관심 그룹 · 4/10 · 6개 더 추가할 수 있어요', offset: 0 })}
${searchBox(c, top + 76, '삼성')}
${label(c, X, top + 134, '검색 결과 30')}
${addRow(c, top + 148, '삼성화재', '000810 · KOSPI', 'add', { offset: 0, hit: 2 })}${addRow(c, top + 194, '삼성제약', '001360 · KOSPI', 'add', { offset: 0, hit: 2 })}
<g class="pop" style="${c.d(0.9)}">${addRow(c, top + 240, '삼성전자', '005930 · KOSPI', 'in', { offset: 0, hit: 2 })}</g>
${addRow(c, top + 286, '삼성공조', '006660 · KOSPI', 'add', { offset: 0, hit: 2 })}
${rise(c, 0.3, `<rect x="${SX}" y="${SY + SH - 62}" width="${SW}" height="62" fill="${c.t.surface}"/>${text(X, SY + SH - 26, '여러 개를 연달아 추가하고, ✓를 누르면 빼요', { size: 10.5, fill: c.t.t3 })}${button(R - 58, SY + SH - 46, 58, '완료', c.t, { variant: 'tonal', h: 32 })}`)}
${tapAt(c, R - 17, top + 257, 0.4)}`;
        },
      },
      {
        title: '✓ 다시 누르면 빼기',
        sub: '잘못 담은 종목은 그 자리에서 바로 빼요',
        screen: (c) => {
          const top = TOP + 4;
          return `${sheet(c, top, '종목 추가', { sub: '내 관심 그룹 · 3/10 · 7개 더 추가할 수 있어요', offset: 0 })}
${searchBox(c, top + 76, '삼성')}
${label(c, X, top + 134, '검색 결과 30')}
${addRow(c, top + 148, '삼성화재', '000810 · KOSPI', 'add', { offset: 0, hit: 2 })}${addRow(c, top + 194, '삼성제약', '001360 · KOSPI', 'add', { offset: 0, hit: 2 })}
${addRow(c, top + 240, '삼성전자', '005930 · KOSPI', 'in', { offset: 0, hit: 2 })}
<g class="pop" style="${c.d(1.0)}">${addRow(c, top + 240, '삼성전자', '005930 · KOSPI', 'add', { offset: 0, hit: 2 })}</g>
${addRow(c, top + 286, '삼성공조', '006660 · KOSPI', 'add', { offset: 0, hit: 2 })}
${tapAt(c, R - 17, top + 257, 0.5)}`;
        },
      },
    ],
  },
  {
    id: 'groups',
    tab: 'compare',
    title: '그룹 관리',
    appBar: '내 관심',
    lead: ['그룹을 만들고 이름·순서를 바꾸고,', '토스 보유 종목이나 조건으로 새 그룹을 만들어요.'],
    tips: [
      '그룹은 하나 이상 있어야 해서 마지막 그룹은 지울 수 없어요.',
      '`토스에서 가져오기`는 공급자가 토스일 때 그룹 관리 시트 아래에 보여요. 보유 종목은 평가금액 큰 순, 섹터는 시가총액 큰 순으로 앞의 10개를 넣어요. 토스 앱의 관심종목은 공식 API에 없어 가져올 수 없어요.',
      '`조건으로 골라 새 그룹 만들기`의 지표는 시장 대비 초과수익·등락률·고점 대비 하락률·상대 거래량·시가총액이고, 기간은 1주~1년이에요. 후보는 종목 검색·기존 그룹·토스 보유 종목에서 30개까지 담아요.',
      '그룹과 설정은 설정 › 데이터 › `내보내기`로 파일에 저장해 다른 기기로 옮겨요.',
    ],
    steps: [
      {
        title: '새 그룹 만들기',
        sub: '그룹 이름 옆 ＋를 누르면 `새 그룹 2`가 생겨요',
        screen: (c) => `${rise(c, 0.1, `${chip(X, TOP, '내 관심', c.t).svg}${chip(X + 76, TOP, '반도체', c.t).svg}`)}
<g class="pop" style="${c.d(1.0)}">${chip(X + 146, TOP, '새 그룹 2', c.t, { on: true }).svg}</g>
${rise(c, 1.2, `${text(X + W / 2, TOP + 150, '비교할 종목을 추가해 보세요', { size: 13, weight: 700, fill: c.t.t2, anchor: 'middle' })}${button(X + W / 2 - 56, TOP + 168, 112, '＋ 종목 추가', c.t)}`)}
${tapAt(c, SX + 100, SY + 41, 0.4)}`,
      },
      {
        title: '이름·순서 바꾸기',
        sub: '`⋯`(그룹 관리)에서 ✎로 이름, ↑↓로 순서',
        screen: (c) => {
          const top = TOP + 120;
          const row = (y, name, count, i) =>
            rise(
              c,
              0.3 + i * 0.1,
              `${text(X, y + 14, name, { size: 13.5, weight: 800, fill: c.t.t1 })}${text(X, y + 31, count, { size: 11, fill: c.t.t3 })}${['✎', '↑', '↓', '✕'].map((g, j) => text(R - 96 + j * 30, y + 22, g, { size: 13, weight: 700, fill: g === '✕' ? c.t.err : c.t.t2, anchor: 'middle' })).join('')}`,
            );
          return `${compareChart(c, { x: X, y: TOP + 6, w: W - 58, h: 170 }, 0, 0)}
${sheet(c, top, '그룹 관리', { sub: '그룹은 하나 이상 있어야 해요' })}
${row(top + 80, '내 관심', '3종목', 0)}${row(top + 128, '반도체', '5종목', 1)}
${rise(c, 0.5, button(X, top + 188, W, '조건으로 골라 새 그룹 만들기', c.t, { variant: 'tonal', h: 40 }))}
${rise(c, 0.55, text(X, top + 250, '후보를 최대 30개 담고 지표로 순위를 매겨', { size: 10.5, fill: c.t.t3 }))}
${tapAt(c, R - 96, top + 151)}`;
        },
      },
      {
        title: '토스에서 가져오기',
        sub: '토스 보유 종목이나 토스 섹터로 새 그룹',
        screen: (c) => {
          const top = TOP + 40;
          return `${sheet(c, top, '그룹 관리', { sub: '그룹은 하나 이상 있어야 해요' })}
${rise(c, 0.2, `${text(X, top + 92, '토스에서 가져오기', { size: 14, weight: 800, fill: c.t.t1 })}${text(X, top + 112, '새 그룹을 만들어요. 한 그룹에는 10종목까지 넣을 수 있어요.', { size: 10, fill: c.t.t3 })}`)}
${rise(c, 0.3, `${chip(X, top + 124, '보유 종목', c.t).svg}${chip(X + 82, top + 124, '섹터', c.t).svg}`)}
<g class="fade" style="${c.d(1.0)}">${chip(X, top + 124, '보유 종목', c.t, { on: true }).svg}</g>
${rise(c, 1.4, `${text(X, top + 178, '삼성전자, SK하이닉스, 한미반도체,', { size: 12, fill: c.t.t1 })}${text(X, top + 196, 'DB하이텍, 현대차', { size: 12, fill: c.t.t1 })}`)}
${rise(c, 1.6, button(X, top + 214, W, "'토스 보유' 그룹 만들기", c.t, { h: 40 }))}
${tapAt(c, X + 40, top + 137, 0.5)}${tapAt(c, X + W / 2, top + 234, 2.6)}`;
        },
      },
      {
        title: '조건으로 골라 새 그룹',
        sub: '후보를 지표로 줄 세워 상위 10개로 그룹',
        screen: (c) => {
          const top = TOP + 4;
          const rows = [
            ['한미반도체', '+18.4%p', true],
            ['SK하이닉스', '+9.1%p', true],
            ['DB하이텍', '+4.0%p', true],
            ['삼성전자', '−1.2%p', false],
          ];
          return `${sheet(c, top, '조건으로 골라 새 그룹 만들기', { sub: '후보 14/30' })}
${rise(c, 0.25, `${selectBox(c, X, top + 72, 140, '시장 대비 초과수익')}${segmented(X + 148, top + 72, W - 148, ['큰 순', '작은 순'], 0, c.t)}`)}
${rise(c, 0.3, segmented(X, top + 114, W, ['1주', '1개월', '3개월', '6개월', '1년'], 2, c.t, { size: 11 }))}
${rise(c, 0.4, text(X, top + 172, '미리보기 · 3개월 · 시장 대비 초과수익 큰 순', { size: 11, weight: 700, fill: c.t.t2 }))}
${rows
  .map(([n, v, inn], i) =>
    rise(
      c,
      0.6 + i * 0.12,
      `${text(X, top + 200 + i * 32, `${i + 1}`, { size: 12, weight: 800, fill: c.t.t3 })}${text(X + 18, top + 200 + i * 32, n, { size: 13, weight: 800, fill: c.t.t1 })}${inn ? badge(c, X + 26 + textWidth(n, 13), top + 189 + i * 32, '넣음') : ''}${text(R, top + 200 + i * 32, v, { size: 12, weight: 800, fill: v.startsWith('+') ? c.t.up : c.t.down, anchor: 'end' })}`,
    ),
  )
  .join('')}
${rise(c, 1.2, button(X, top + 336, W, '10개로 새 그룹 만들기', c.t, { h: 40 }))}`;
        },
      },
    ],
  },
  {
    id: 'simulate',
    tab: 'simulate',
    title: '매매 규칙 시뮬레이션',
    appBar: '시뮬레이션',
    lead: ['내 매수·매도 규칙을 과거 일봉에 적용해', '그냥 보유·지수·ETF와 비교해요.'],
    tips: [
      '매수는 하락 조건(고점 대비 N%, N거래일) 뒤 반등 트리거(연속 상승·전 고점 돌파·이동평균 돌파·골든크로스)에서 사요. 이동평균 필터를 더할 수 있어요.',
      '분할 매수, 최대 3단계 분할 익절, 손절 기준 3가지, 1단계 익절 뒤 본전 손절을 쓸 수 있어요.',
      '수수료와 팔 때 세금을 빼고 계산해요. 세율은 결제일(체결일+2거래일) 기준이에요.',
      '거래 내역의 행을 누르면 거래 차트에서 매수·매도 지점과 A·B·L 가격선을 봐요. `종목별`·`건너뛴 신호` 탭도 있어요.',
      '일봉으로 계산해서 하루 안의 순서는 시가→저가→고가→종가로 가정해요. 배당은 빠지고, 지금 관심종목만 넣을 수 있어 생존 편향이 있어요.',
      '규칙을 바꾸면 이전 결과에 `이전 결과` 표시가 붙어요. 다시 실행해 주세요.',
    ],
    steps: [
      {
        title: '새 전략 만들기',
        sub: '`매매 규칙` 탭에서 `＋ 새 전략`',
        screen: (c) => `${rise(c, 0.1, segmented(X, TOP, W, ['매매 규칙', '선정 기준'], 0, c.t, { h: 38 }))}
${rise(c, 0.3, text(X + W / 2, TOP + 120, '내 매매 규칙을 과거 데이터로 시험해 보세요', { size: 12, fill: c.t.t2, anchor: 'middle' }))}
${rise(c, 0.4, button(X + W / 2 - 52, TOP + 140, 104, '＋ 새 전략', c.t))}
${tapAt(c, X + W / 2, TOP + 158)}`,
      },
      {
        title: '매수 규칙 정하기',
        sub: '얼마나 떨어진 뒤 어떤 반등에서 살지',
        screen: (c) => `${rise(c, 0.1, `${text(X, TOP + 18, '새 전략', { size: 16, weight: 800, fill: c.t.t1 })}${button(R - 52, TOP, 52, '복제', c.t, { variant: 'tonal', h: 30, size: 12 })}`)}
${foldCard(c, TOP + 42, '종목', '내 관심 · 3종목', { offset: 0.2 })}
${foldCard(c, TOP + 96, '기간·자금', '2023.10.23 ~ 2026.10.23 · 1,000만 원 · 회당 10%', { offset: 0.3 })}
${foldCard(c, TOP + 150, '매수', '고점 대비 10% 하락 뒤 → 3일 연속 상승 또는 B 돌파', { offset: 0.4, on: true })}
${foldCard(c, TOP + 204, '분할 매수', '끔', { offset: 0.5 })}
${foldCard(c, TOP + 258, '매도', '익절 +15%에 전량 · 손절 −5%', { offset: 0.6 })}
${foldCard(c, TOP + 312, '비교 기준', '같은 종목 사서 보유 · KOSPI · KODEX 200', { offset: 0.7 })}
${tapAt(c, X + 40, TOP + 173)}`,
      },
      {
        title: '매도 규칙 정하고 실행',
        sub: '익절 단계와 손절 기준을 정하고 `시뮬레이션 실행`',
        screen: (c) => `${foldCard(c, TOP, '매수', '고점 대비 10% 하락 뒤 → 3일 연속 상승 또는 B 돌파', { offset: 0.1 })}
${foldCard(c, TOP + 54, '분할 매수', '끔', { offset: 0.15 })}
${foldCard(c, TOP + 108, '매도', '익절 +15%에 전량 · 손절 −5%', { offset: 0.2, on: true })}
${foldCard(c, TOP + 162, '비교 기준', '같은 종목 사서 보유 · KOSPI · KODEX 200', { offset: 0.25 })}
${foldCard(c, TOP + 216, '비용', '수수료 0.015% · 팔 때 세금 포함', { offset: 0.3 })}
${rise(c, 0.4, button(X, TOP + 290, W, '시뮬레이션 실행', c.t, { h: 46, size: 14 }))}
${tapAt(c, X + W / 2, TOP + 313)}`,
      },
      {
        title: '결과 보기',
        sub: '수익률·낙폭·승률과 자산 곡선을 비교해요',
        screen: (c) => {
          const box = { x: X, y: TOP + 196, w: W - 30, h: 150 };
          const ch = chart(
            box,
            [
              { values: walk(5, 70, { drift: 0.05, vol: 0.6 }), color: c.t.t3, width: 1.6 },
              { values: walk(8, 70, { drift: 0.03, vol: 0.9 }), color: c.t.bench, width: 1.6, dash: '4 3' },
              { values: walk(3, 70, { drift: -0.1, vol: 1 }), color: c.t.t2, width: 1.4, dash: '2 3' },
              { values: walk(14, 70, { drift: 0.09, vol: 0.5 }), color: c.t.accent, width: 2.4 },
            ],
            { style: c.d(0.8), grid: c.t.line, zero: c.t.t3 },
          );
          return `${rise(c, 0.1, text(X, TOP + 6, '2025.01.01 ~ 2026.10.23 · KRX 일봉', { size: 11, fill: c.t.t3 }))}
${statCard(c, X, TOP + 18, 120, '총수익률', '▲ +3.9%', '그냥 보유보다 +5.4%p', { color: c.t.up, offset: 0.2 })}
${statCard(c, X + 128, TOP + 18, 120, '최대 낙폭', '−2.8%', '', { offset: 0.3 })}
${statCard(c, X, TOP + 96, 120, '승률', '44.4%', '4승 5패', { offset: 0.4 })}
${statCard(c, X + 128, TOP + 96, 120, '거래 횟수', '11번', '끝난 9번 · 보유 2종목', { offset: 0.5 })}
${rise(c, 0.7, legend(c, X, TOP + 184, [['내 전략', c.t.accent], ['보유', c.t.t3], ['KODEX 200', c.t.bench, '4 3'], ['KOSPI', c.t.t2, '2 3']]))}
${ch.svg}`;
        },
      },
    ],
  },
  {
    id: 'criteria',
    tab: 'simulate',
    title: '선정 기준 검증',
    appBar: '시뮬레이션',
    lead: ['종목을 고르는 내 기준을', '과거 시점마다 적용해 결과를 확인해요.'],
    tips: [
      '시장 데이터 파일은 내 컴퓨터에서 KIS 키로 모아요. 방법은 [개발 문서](../development.md#시장-데이터-수집)에 있어요. 파일은 이 기기의 IndexedDB에만 저장돼요.',
      '조건은 시세(시가총액·거래대금·대장주·수익률·이동평균·52주 고점 대비·변동성·반등 신호), 환율·유가 민감도, 투자자 매매동향, 재무·가치(PER·PBR·ROE 등)로 나뉘어요.',
      '재선정일마다 그 전날까지의 데이터만으로 골라요. 매매동향은 하루, 재무는 분기 60일·연간 100일 늦게 반영해요.',
      '결과는 ① 선정만(동일 비중 보유)과 ② 선정 + 매매 규칙을 지수·ETF와 나란히 보여 줘요. 시장별 표도 있어요.',
      '`오늘 기준 미리 보기`에서 지금 조건에 맞는 종목을 `새 그룹으로 만들기`로 바로 관심 그룹에 넣어요.',
      '지금 상장된 종목만 들어 있어 상장폐지 종목이 빠져요(생존 편향).',
    ],
    steps: [
      {
        title: '시장 데이터 가져오기',
        sub: '수집 스크립트로 만든 파일을 `데이터 가져오기`',
        screen: (c) => `${segmented(X, TOP, W, ['매매 규칙', '선정 기준'], 1, c.t, { h: 38 })}
${rise(c, 0.2, `${card(X, TOP + 52, W, 104, c.t)}${text(X + 12, TOP + 76, '시장 데이터가 없어요. 수집 스크립트로', { size: 11.5, fill: c.t.t1 })}${text(X + 12, TOP + 93, '만든 파일을 가져와 주세요', { size: 11.5, fill: c.t.t1 })}${button(X + 12, TOP + 108, 112, '데이터 가져오기', c.t, { h: 34, size: 12 })}${text(X + 168, TOP + 130, '수집 방법', { size: 12, weight: 800, fill: c.t.t1, anchor: 'middle' })}`)}
${rise(c, 0.35, `${card(X, TOP + 170, W, 62, c.t)}${text(X + 12, TOP + 194, '새 기준', { size: 13, weight: 800, fill: c.t.t1 })}${text(X + 12, TOP + 214, 'KOSPI·KOSDAQ 주식 · 거래대금 10억↑ · 상위 10', { size: 10.5, fill: c.t.t2 })}`)}
${rise(c, 0.45, button(X, TOP + 248, W, '＋ 새 기준', c.t, { h: 42 }))}
${tapAt(c, X + 68, TOP + 125)}
${toast(c, '시장 데이터를 가져왔어요', 2.8)}`,
      },
      {
        title: '조건 켜기',
        sub: '시가총액·거래대금·반등 신호·환율·수급·재무 등',
        screen: (c) => {
          const rows = [
            ['시가총액', '회사 전체의 값어치예요', true],
            ['거래대금', '하루에 거래된 금액이에요', true],
            ['52주 고점 대비', '1년 최고가에서 얼마나 내려왔는지', false],
            ['반등 신호', '내 매수 패턴이 최근에 나타났는지', true],
            ['원/달러 민감도', '환율이 1% 오를 때 몇 % 움직였는지', false],
            ['순매수 규모', '외국인·기관·개인의 순매수 비율', false],
            ['ROE', '최근 4분기 순이익 ÷ 평균 자본', false],
          ];
          return `${rise(c, 0.1, `${text(X, TOP + 14, '조건', { size: 14, weight: 800, fill: c.t.t1 })}${text(R, TOP + 14, '3개 켬', { size: 11.5, fill: c.t.t3, anchor: 'end' })}`)}
${rows
  .map(([n, d, on], i) => {
    const y = TOP + 30 + i * 48;
    const flip = i === 3;
    return rise(
      c,
      0.2 + i * 0.07,
      `${card(X, y, W, 42, c.t, { rx: 12 })}${text(X + 12, y + 18, n, { size: 12.5, weight: 800, fill: c.t.t1 })}${text(X + 12, y + 33, d, { size: 10, fill: c.t.t3 })}${toggle(c, R - 46, y + 10, flip ? false : on)}${flip ? `<g class="pop" style="${c.d(2.4)}">${toggle(c, R - 46, y + 10, true)}</g>` : ''}`,
    );
  })
  .join('')}
${tapAt(c, R - 28, TOP + 30 + 3 * 48 + 21, 2.2)}`;
        },
      },
      {
        title: '고를 개수·재선정 정하고 실행',
        sub: '상위 N개를 매월·매주 다시 골라요',
        screen: (c) => `${foldCard(c, TOP, '고를 개수·정렬', '상위 10 · 거래대금 큰 순', { offset: 0.1, on: true })}
${foldCard(c, TOP + 54, '재선정·기간', '매월 · 2023.10.16~2026.10.16', { offset: 0.2 })}
${foldCard(c, TOP + 108, '비교 대상', 'KOSPI · KODEX 200', { offset: 0.3 })}
${foldCard(c, TOP + 162, '② 매매 규칙', '새 전략', { offset: 0.4 })}
${rise(
  c,
  0.5,
  `${card(X, TOP + 218, W, 84, c.t)}${text(X + 12, TOP + 240, '오늘 기준 미리 보기', { size: 12.5, weight: 800, fill: c.t.t1 })}${chip(X + 12, TOP + 252, '삼성전자', c.t, { size: 10.5, h: 22 }).svg}${chip(X + 82, TOP + 252, 'SK하이닉스', c.t, { size: 10.5, h: 22 }).svg}${chip(X + 162, TOP + 252, '한미반도체', c.t, { size: 10.5, h: 22 }).svg}${text(X + 12, TOP + 292, '… 10종목', { size: 10.5, fill: c.t.t3 })}`,
)}
${rise(c, 0.6, button(X, TOP + 316, W, '검증 실행', c.t, { h: 44, size: 14 }))}
${tapAt(c, X + W / 2, TOP + 338)}`,
      },
      {
        title: '결과 비교',
        sub: '선정만·선정 + 매매 규칙을 지수·ETF와 나란히',
        screen: (c) => {
          const box = { x: X, y: TOP + 122, w: W - 20, h: 156 };
          const ch = chart(
            box,
            [
              { values: walk(31, 70, { drift: 0.04, vol: 0.8 }), color: c.t.t2, width: 1.4, dash: '2 3' },
              { values: walk(44, 70, { drift: 0.06, vol: 0.7 }), color: c.t.etf, width: 1.6, dash: '4 3' },
              { values: walk(52, 70, { drift: 0.1, vol: 0.9 }), color: c.t.accent, width: 2.4 },
              { values: walk(61, 70, { drift: 0.08, vol: 0.6 }), color: c.t.s[0], width: 2 },
            ],
            { style: c.d(0.8), grid: c.t.line, zero: c.t.t3 },
          );
          const rows = [
            ['① 선정만', '+31.2%', '지수 대비 +12.4%p'],
            ['② 선정 + 매매 규칙', '+24.6%', '지수 대비 +5.8%p'],
          ];
          return `${rise(c, 0.1, text(X, TOP + 10, '요약', { size: 14, weight: 800, fill: c.t.t1 }))}
${rows
  .map(([n, v, d], i) => rise(c, 0.2 + i * 0.1, `${text(X, TOP + 36 + i * 30, n, { size: 12, weight: 700, fill: c.t.t1 })}${text(R - 96, TOP + 36 + i * 30, v, { size: 12.5, weight: 800, fill: c.t.up, anchor: 'end' })}${text(R, TOP + 36 + i * 30, d, { size: 10, fill: c.t.t3, anchor: 'end' })}`))
  .join('')}
${rise(c, 0.5, `${text(X, TOP + 92, '자산 곡선', { size: 13, weight: 800, fill: c.t.t1 })}${legend(c, X, TOP + 110, [['①', c.t.accent], ['②', c.t.s[0]], ['KODEX 200', c.t.etf, '4 3'], ['KOSPI', c.t.t2, '2 3']])}`)}
${ch.svg}
${rise(c, 1.6, text(X, TOP + 296, '세로 눈금은 재선정일이에요', { size: 10.5, fill: c.t.t3 }))}`;
        },
      },
    ],
  },
  {
    id: 'performance',
    tab: 'performance',
    title: '내 성과',
    appBar: '내 성과',
    lead: ['토스 계좌의 체결된 주문을', '같은 날 같은 금액으로 지수를 샀을 때와 비교해요.'],
    tips: [
      '실제 계좌는 공급자가 토스일 때 봐요. 데모 데이터에서는 `데모 계좌예요` 표시와 함께 가상 계좌로 둘러봐요.',
      '프록시는 주문 목록 **조회**(`GET /api/v1/orders`)만 전달하고 주문 경로는 계속 막아요. 이 기능이 생기기 전에 띄운 프록시는 새 버전으로 바꿔요.',
      '`기간`에서 전체나 연도를 고르면 그 기간만 따로 계산해요.',
      '토스 API에는 배당·입출금·입고 내역이 없고 시간외 종가 주문도 조회되지 않아요. 그래서 체결된 주문만으로 계산하고, 주문을 더한 수량이 보유 수량과 다르면 `맞지 않음`으로 알려요.',
      '가상 매수는 그날 종가로 계산해요. 해외 주문은 빼요.',
      '받은 주문은 이 기기의 IndexedDB에 남겨 다음에는 이어 받아요. 키 잠금 중에는 저장하지 않고, 키를 지우면 함께 지워요.',
    ],
    steps: [
      {
        title: '벤치마크 고르기',
        sub: '자동(시장 지수)·KOSPI·KOSDAQ·KODEX 200·KODEX 코스닥150',
        screen: (c) => {
          const opts = ['자동(시장 지수)', 'KOSPI', 'KOSDAQ', 'KODEX 200', 'KODEX 코스닥150'];
          return `${rise(c, 0.1, `${label(c, X, TOP + 4, '벤치마크')}${label(c, X + 132, TOP + 4, '기간')}${selectBox(c, X, TOP + 12, 124, '자동(시장 지수)')}${selectBox(c, X + 132, TOP + 12, W - 132, '전체')}`)}
${rise(
  c,
  0.4,
  `${card(X, TOP + 52, 180, opts.length * 32 + 8, c.t, { rx: 12 })}${opts
    .map((o, i) => `${i === 3 ? `<rect x="${X + 4}" y="${TOP + 56 + i * 32}" width="172" height="30" rx="8" fill="${c.t.accentSoft}"/>` : ''}${text(X + 14, TOP + 76 + i * 32, o, { size: 12.5, weight: i === 3 ? 800 : 500, fill: i === 3 ? c.t.accent : c.t.t1 })}`)
    .join('')}`,
)}
${tapAt(c, X + 60, TOP + 29, 0.2)}${tapAt(c, X + 60, TOP + 167, 2.2)}`;
        },
      },
      {
        title: 'IRR 비교',
        sub: '내 IRR과 벤치마크 IRR, 그 차이(초과)',
        screen: (c) => `${rise(c, 0.05, `${selectBox(c, X, TOP + 12, 124, 'KODEX 200')}${selectBox(c, X + 132, TOP + 12, W - 132, '전체')}`)}
${rise(c, 0.15, `${badge(c, X, TOP + 58, '데모 계좌예요')}${text(X + 78, TOP + 69, '2025.02.13 ~ 2026.10.23', { size: 10.5, fill: c.t.t3 })}`)}
${statCard(c, X, TOP + 82, 80, '내 IRR', '−4.2%', '−205,565원', { color: c.t.down, offset: 0.3, h: 76 })}
${statCard(c, X + 84, TOP + 82, 80, 'KODEX 200', '−13.3%', '−646,387원', { color: c.t.down, offset: 0.45, h: 76 })}
${statCard(c, X + 168, TOP + 82, 80, '초과', '+9.1%p', '+440,822원', { color: c.t.up, offset: 0.6, h: 76 })}
${rise(c, 0.9, `${card(X, TOP + 176, W, 110, c.t)}${text(X + 12, TOP + 200, 'IRR은 넣은 돈의 시점과 크기를', { size: 11.5, fill: c.t.t2 })}${text(X + 12, TOP + 218, '함께 본 연 수익률(금액가중)이에요.', { size: 11.5, fill: c.t.t2 })}${text(X + 12, TOP + 244, '같은 날 같은 금액으로 벤치마크를', { size: 11.5, fill: c.t.t2 })}${text(X + 12, TOP + 262, '샀다고 치고 똑같이 계산해요.', { size: 11.5, fill: c.t.t2 })}`)}`,
      },
      {
        title: '평가금액 + 회수액',
        sub: '내 계좌·벤치마크·넣은 돈을 한 차트에',
        screen: (c) => {
          const steps = (seed, drift) => {
            const base = walk(seed, 70, { drift, vol: 0.5 });
            return base.map((v, i) => v + Math.floor(i / 12) * 6);
          };
          const ch = chart(
            { x: X, y: TOP + 80, w: W - 30, h: 200 },
            [
              { values: Array.from({ length: 70 }, (_, i) => Math.floor(i / 12) * 6 + 1.5), color: c.t.t2, width: 1.4, dash: '3 3' },
              { values: steps(71, -0.03), color: c.t.t3, width: 1.6 },
              { values: steps(74, 0.06), color: c.t.accent, width: 2.4 },
            ],
            { style: c.d(0.5), grid: c.t.line },
          );
          return `${rise(c, 0.1, text(X, TOP + 10, '평가금액 + 회수액', { size: 14, weight: 800, fill: c.t.t1 }))}
${rise(c, 0.2, `${text(X, TOP + 32, '2026.10.23', { size: 10.5, fill: c.t.t3 })}${legend(c, X, TOP + 50, [['내 계좌 515만', c.t.accent], ['KODEX 200 471만', c.t.t3]])}${legend(c, X, TOP + 66, [['넣은 돈 536만', c.t.t2, '3 3']])}`)}
${ch.svg}
${rise(c, 1.8, text(X, TOP + 304, '표 보기', { size: 12, weight: 700, fill: c.t.t2 }))}`;
        },
      },
      {
        title: '종목별 기여도',
        sub: '차이 큰 순, 수량이 다르면 `맞지 않음`',
        screen: (c) => {
          const rows = [
            ['DB하이텍', '+160,097원', '맞음'],
            ['SK하이닉스', '+108,248원', '맞음'],
            ['삼성전자', '+97,089원', '맞음'],
            ['한미반도체', '+75,388원', '맞지 않음'],
          ];
          return `${rise(c, 0.1, text(X, TOP + 10, '종목별 기여도', { size: 14, weight: 800, fill: c.t.t1 }))}
${rise(c, 0.15, `${label(c, X, TOP + 36, '종목')}${label(c, R - 70, TOP + 36, '차이')}${label(c, R, TOP + 36, '수량').replace('text-anchor="start"', 'text-anchor="end"')}`)}
${rows
  .map(([n, v, q], i) => {
    const y = TOP + 62 + i * 36;
    const bad = q !== '맞음';
    return rise(c, 0.3 + i * 0.12, `<path d="M${X} ${y - 18} H${R}" stroke="${c.t.line}"/>${text(X, y, n, { size: 13, weight: 700, fill: c.t.t1 })}${text(R - 50, y, v, { size: 12, weight: 800, fill: c.t.up, anchor: 'end' })}${text(R, y, q, { size: 11, weight: bad ? 800 : 500, fill: bad ? c.t.warn : c.t.t3, anchor: 'end' })}`);
  })
  .join('')}
${rise(c, 1.0, `${card(X, TOP + 214, W, 70, c.t, { fill: c.t.surface2 })}${text(X + 12, TOP + 236, '수량이 맞지 않는 종목', { size: 11.5, weight: 800, fill: c.t.warn })}${text(X + 12, TOP + 254, '한미반도체: 주문 합계 7주, 보유 8주', { size: 11, fill: c.t.t2 })}${text(X + 12, TOP + 271, '입고했거나 시간외 종가로 샀을 수 있어요', { size: 10.5, fill: c.t.t3 })}`)}`;
        },
      },
    ],
  },
  {
    id: 'settings',
    tab: 'settings',
    title: '설정과 연결',
    appBar: '설정',
    lead: ['데이터 공급자를 고르고 프록시와 키를 넣어', '실제 시세로 바꿔요.'],
    tips: [
      '증권사 키가 없어도 `데모 데이터`로 모든 화면을 써 볼 수 있어요.',
      '`도움말`에서 `도움말 보기`로 메뉴별 도움말을 열고, `처음 안내 다시 보기`로 메뉴 처음 안내를 다시 띄워요. 화면마다 앱 바의 물음표 단추로도 그 메뉴 도움말을 열어요.',
      '증권사 API는 브라우저에서 바로 부를 수 없어(CORS) 작은 프록시를 거쳐요. 공급자별 준비는 [증권사 연결](../providers.md)에 있어요.',
      '키와 설정은 이 브라우저에만 저장돼요. 토스 키는 주문 권한을 가지니 `키를 암호로 잠그기`를 켜 두세요. 다 쓴 공용 기기에서는 `이 기기에서 키 삭제`를 눌러요.',
      '`표시`에서 테마(시스템·라이트·다크)와 상승·하락 색(한국식 빨강▲ 파랑▼ / 글로벌 초록▲ 빨강▼)을 골라요.',
      '`데이터`에서 관심종목(그룹·설정)을 내보내고 가져오거나, 시장 데이터 파일을 가져오고, 캐시를 비워요. `프로필`로 설정 묶음을 여럿 둘 수 있어요.',
    ],
    steps: [
      {
        title: '공급자 고르기',
        sub: '한국투자증권(KIS)·토스증권·데모 데이터 중에서',
        screen: (c) => {
          const items = [
            ['한국투자증권 (KIS)', '✓ KRX·NXT·통합 전환', '✓ Cloudflare Worker 프록시(무료)'],
            ['토스증권', '– 통합 시세만 (KRX·NXT 구분 불가)', '– 고정 IP 프록시 필요(집 PC·NAS)'],
            ['데모 데이터', '✓ 키 없이 모든 화면 체험', '– 가상 시세'],
          ];
          return `${rise(c, 0.1, label(c, X, TOP + 6, '데이터 공급자'))}
${items
  .map(([n, a, b], i) => {
    const y = TOP + 18 + i * 92;
    const on = i === 0;
    const radio = (sel) => `<circle cx="${X + 20}" cy="${y + 24}" r="8" fill="none" stroke="${sel ? c.t.accent : c.t.t3}" stroke-width="2"/>${sel ? `<circle cx="${X + 20}" cy="${y + 24}" r="4" fill="${c.t.accent}"/>` : ''}`;
    return rise(
      c,
      0.2 + i * 0.1,
      `${card(X, y, W, 82, c.t)}${on ? `<g class="fade" style="${c.d(2.4)}"><rect x="${X}" y="${y}" width="${W}" height="82" rx="14" fill="${c.t.accentSoft}" stroke="${c.t.accent}"/></g>` : ''}${radio(false)}${on ? `<g class="fade" style="${c.d(2.4)}">${radio(true)}</g>` : ''}${text(X + 36, y + 29, n, { size: 13.5, weight: 800, fill: c.t.t1 })}${text(X + 36, y + 50, a, { size: 10.5, fill: a.startsWith('✓') ? c.t.ok : c.t.t3 })}${text(X + 36, y + 67, b, { size: 10.5, fill: b.startsWith('✓') ? c.t.ok : c.t.t3 })}`,
    );
  })
  .join('')}
${tapAt(c, X + 20, TOP + 42)}`;
        },
      },
      {
        title: '프록시와 키 넣기',
        sub: '프록시 URL·토큰과 App Key·App Secret',
        screen: (c) => {
          const f = (y, name, value, ph) =>
            `${label(c, X + 12, y, name)}<rect x="${X + 12}" y="${y + 6}" width="${W - 24}" height="32" rx="9" fill="${c.t.bg}" stroke="${c.t.line}"/>${text(X + 22, y + 27, value, { size: 11.5, fill: ph ? c.t.t3 : c.t.t1 })}`;
          return `${rise(c, 0.1, label(c, X, TOP + 6, '연결'))}
${rise(c, 0.2, `${card(X, TOP + 16, W, 268, c.t)}${f(TOP + 38, '프록시 URL', 'https://gazua-proxy.…workers.dev')}${f(TOP + 92, '프록시 토큰 (선택)', '••••••••')}${f(TOP + 146, 'App Key', '••••••••••••')}${f(TOP + 200, 'App Secret', '••••••••••••')}${button(X + 12, TOP + 244, 80, '저장', c.t, { h: 30, size: 12 })}`)}
${tapAt(c, X + 52, TOP + 259, 2.4)}
${toast(c, '저장했어요', 2.9)}`;
        },
      },
      {
        title: '연결 진단',
        sub: '프록시 → CORS → 토큰 → 시세 순서로 확인해요',
        screen: (c) => {
          const steps = ['프록시 응답', 'CORS 허용', '토큰 발급', '시세 조회 (삼성전자)'];
          return `${rise(c, 0.1, label(c, X, TOP + 6, '연결 진단'))}
${rise(c, 0.15, `${card(X, TOP + 16, W, 236, c.t)}${text(X + 12, TOP + 40, '프록시 → CORS → 토큰 → 시세 순서로', { size: 11, fill: c.t.t2 })}${text(X + 12, TOP + 56, '어디서 막히는지 확인해요.', { size: 11, fill: c.t.t2 })}`)}
${steps
  .map((s, i) => {
    const y = TOP + 88 + i * 34;
    const ms = ['184ms', '96ms', '412ms', '238ms'][i];
    return `${text(X + 34, y, s, { size: 12.5, weight: 700, fill: c.t.t1, cls: 'rise', style: c.d(0.3) })}<circle cx="${X + 20}" cy="${y - 4}" r="9" fill="${c.t.surface2}"/>${text(X + 20, y, i + 1, { size: 10, weight: 800, fill: c.t.t3, anchor: 'middle' })}<g class="pop" style="${c.d(0.9 + i * 0.4)}"><circle cx="${X + 20}" cy="${y - 4}" r="9" fill="${c.t.ok}"/>${text(X + 20, y, '✓', { size: 10, weight: 800, fill: c.t.surface, anchor: 'middle' })}${text(R - 12, y, ms, { size: 11.5, fill: c.t.t3, anchor: 'end' })}</g>`;
  })
  .join('')}
${rise(c, 0.3, button(X + 12, TOP + 210, 96, '진단 시작', c.t, { h: 30, size: 12 }))}
${tapAt(c, X + 60, TOP + 225, 0.4)}`;
        },
      },
      {
        title: '키 잠그기',
        sub: '켜면 앱을 열 때마다 암호를 물어요',
        screen: (c) => `${rise(c, 0.1, label(c, X, TOP + 6, '키 보호'))}
${rise(c, 0.2, `${card(X, TOP + 16, W, 120, c.t)}${text(X + 12, TOP + 44, '키를 암호로 잠그기', { size: 13, weight: 800, fill: c.t.t1 })}${toggle(c, R - 48, TOP + 30, false)}${text(X + 12, TOP + 68, '켜면 앱을 열 때마다 암호를 물어요.', { size: 10.5, fill: c.t.t3 })}${text(X + 12, TOP + 84, '풀린 키와 토큰은 메모리에만 있어요.', { size: 10.5, fill: c.t.t3 })}${text(X + 12, TOP + 118, '이 기기에서 키 삭제', { size: 12, weight: 800, fill: c.t.err })}`)}
<g class="pop" style="${c.d(1.0)}">${toggle(c, R - 48, TOP + 30, true)}</g>
${tapAt(c, R - 30, TOP + 41, 0.6)}
${rise(c, 1.4, `${card(X, TOP + 150, W, 92, c.t)}${label(c, X + 12, TOP + 172, '잠금 암호')}<rect x="${X + 12}" y="${TOP + 180}" width="${W - 24}" height="32" rx="9" fill="${c.t.bg}" stroke="${c.t.accent}"/>${text(X + 22, TOP + 201, '••••••••', { size: 12, fill: c.t.t1 })}`)}
${rise(c, 1.6, `${label(c, X, TOP + 268, '표시')}${segmented(X, TOP + 278, W, ['시스템', '라이트', '다크'], 0, c.t)}`)}`,
      },
    ],
  },
];
