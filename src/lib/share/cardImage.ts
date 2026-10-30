// 카카오 카드 이미지(설계 4.3): 차트 캡처에 글자를 직접 그려 1600×800 canvas 하나로 합친다. 새 라이브러리를 쓰지 않는다.
import type { ValidationResult } from '../screen/runValidation';
import { kstDate } from '../time/kst';
import { kstHHMM } from '../ui/compare/compareText';
import type { DoneState } from '../ui/simulate/runController.svelte';
import { dotDate, fmtReturnPct, returnClass, trendReturn } from '../ui/simulate/simText';
import { shareTitle } from './snapshot';

export interface CardText {
  /** 굵은 제목(그룹·전략·기준 이름) */
  title: string;
  /** 기간 · 지표 · 기준 시각 같은 한 줄 */
  subtitle: string;
  /** 오른쪽 값 목록. swatch는 선 색(DOM 범례는 캡처에 들어가지 않아 여기 그린다) */
  rows: { label: string; value: string; tone: 'up' | 'down' | 'flat'; swatch?: string }[];
  /** 아래 줄: 시세 출처(데모면 '데모 데이터') */
  footer: string;
}
export interface CardColors {
  bg: string;
  text: string;
  sub: string;
  up: string;
  down: string;
  accent: string;
}

export const CARD_WIDTH = 1600;
export const CARD_HEIGHT = 800;
/** 카카오 업로드 한도 */
export const CARD_FILE_MAX = 5 * 1024 * 1024;
export const PROVIDER_NAME: Record<'kis' | 'toss' | 'demo', string> = { kis: '한국투자증권', toss: '토스증권', demo: '데모 데이터' };

// 표시 800×400 기준 배치: 위 64px 띠, 왼쪽 약 62% 차트, 오른쪽 값 목록, 맨 아래 24px 출처
const W = 800;
const H = 400;
const CHART = { x: 16, y: 72, w: 480, h: 296 };
const LIST_X = 512;

export function composeCard(chart: HTMLCanvasElement, text: CardText, colors: CardColors): HTMLCanvasElement {
  const card = document.createElement('canvas');
  card.width = CARD_WIDTH;
  card.height = CARD_HEIGHT;
  const g = card.getContext('2d');
  if (!g) throw new Error('canvas 2d를 쓸 수 없어요');
  g.scale(CARD_WIDTH / W, CARD_HEIGHT / H);
  const font = getComputedStyle(document.body).fontFamily || 'sans-serif';
  g.fillStyle = colors.bg;
  g.fillRect(0, 0, W, H);
  g.textBaseline = 'top';
  g.fillStyle = colors.accent;
  g.font = `800 18px ${font}`;
  g.fillText('가즈아', 24, 12);
  g.fillStyle = colors.text;
  g.font = `700 20px ${font}`;
  g.fillText(text.title, 100, 10, 680);
  g.fillStyle = colors.sub;
  g.font = `400 13px ${font}`;
  g.fillText(text.subtitle, 100, 38);
  if (chart.width > 0 && chart.height > 0) {
    const r = Math.min(CHART.w / chart.width, CHART.h / chart.height);
    const w = chart.width * r;
    const h = chart.height * r;
    g.drawImage(chart, CHART.x, CHART.y + (CHART.h - h) / 2, w, h);
  }
  text.rows.slice(0, 5).forEach((row, i) => {
    const y = 80 + i * 56;
    if (row.swatch) {
      g.fillStyle = row.swatch;
      g.fillRect(LIST_X, y + 4, 10, 10);
    }
    g.fillStyle = colors.sub;
    g.font = `400 13px ${font}`;
    const x = LIST_X + (row.swatch ? 16 : 0);
    g.fillText(row.label, x, y, W - x - 16);
    g.fillStyle = row.tone === 'up' ? colors.up : row.tone === 'down' ? colors.down : colors.text;
    g.font = `700 20px ${font}`;
    g.fillText(row.value, LIST_X, y + 20, W - LIST_X - 16);
  });
  g.fillStyle = colors.sub;
  g.font = `400 12px ${font}`;
  g.fillText(text.footer, 24, H - 20);
  return card;
}

/** JPEG 0.85로 만든다. 실패하거나 5 MB(카카오 한도)를 넘으면 null */
export function cardFile(canvas: HTMLCanvasElement): Promise<File | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob(
        (b) => resolve(b && b.size > 0 && b.size <= CARD_FILE_MAX ? new File([b], 'gazua-card.jpg', { type: 'image/jpeg' }) : null),
        'image/jpeg',
        0.85,
      );
    } catch {
      resolve(null);
    }
  });
}

/** 지금 테마의 CSS 변수를 읽는다. 색 관례(colorConvention)는 보낸 사람 것을 따른다 */
export function readCardColors(el: Element): CardColors {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    bg: v('--bg', '#ffffff'),
    text: v('--t1', '#111111'),
    sub: v('--t2', '#5c5c66'),
    up: v('--up', '#e5383b'),
    down: v('--down', '#2f6fde'),
    accent: v('--accent', '#5b47e0'),
  };
}

export function toneOf(v: number | null): 'up' | 'down' | 'flat' {
  return returnClass(v) || 'flat';
}

/** `{제목} {종류} 캡처: {부제}, {값 목록을 쉼표로}` */
export function cardAlt(text: CardText, kind: string): string {
  return `${text.title} ${kind} 캡처: ${text.subtitle}${text.rows.map((r) => `, ${r.label} ${r.value}`).join('')}`;
}

const stamp = (at: number) => `${kstDate(at).slice(5).replace('-', '.')} ${kstHHMM(at)}`;

export function compareCardText(a: {
  title: string;
  period: string;
  metric: string;
  at: number;
  rows: { name: string; value: string; tone: 'up' | 'down' | 'flat'; swatch?: string }[];
  provider: 'kis' | 'toss' | 'demo';
}): CardText {
  return {
    title: a.title,
    subtitle: `${a.period} · ${a.metric} · ${stamp(a.at)} 기준`,
    rows: a.rows.slice(0, 5).map((r) => ({ label: r.name, value: r.value, tone: r.tone, ...(r.swatch ? { swatch: r.swatch } : {}) })),
    footer: PROVIDER_NAME[a.provider],
  };
}

/** 카카오 설명 둘째 줄 후보: `삼성전자 +3.2% · SK하이닉스 +2.1% · 10.29 14:32 기준` */
export function compareCardLine(rows: readonly { name: string; value: string }[], at: number): string {
  return [...rows.map((r) => `${r.name} ${r.value}`), `${stamp(at)} 기준`].join(' · ');
}

export function simResultCardText(done: DoneState, swatches: Partial<Record<'strategy' | 'hold' | 'index', string>> = {}): CardText {
  const { result, meta } = done;
  const s = result.summary;
  return {
    title: shareTitle(meta.strategy.name),
    subtitle: `${dotDate(meta.from)} ~ ${dotDate(meta.to)}`,
    rows: [
      { label: '총수익률', value: trendReturn(s.totalReturnPct), tone: toneOf(s.totalReturnPct), swatch: swatches.strategy },
      { label: '최대 낙폭', value: fmtReturnPct(s.mddPct), tone: toneOf(s.mddPct) },
      { label: '같은 종목 보유', value: trendReturn(result.benchmarks.holdReturnPct), tone: toneOf(result.benchmarks.holdReturnPct), swatch: swatches.hold },
      { label: meta.strategy.benchmarks.index, value: trendReturn(result.benchmarks.indexReturnPct), tone: toneOf(result.benchmarks.indexReturnPct), swatch: swatches.index },
    ],
    footer: meta.demo ? '데모 데이터' : meta.venueLabel,
  };
}

export function validationCardText(result: ValidationResult, title: string, swatches: Record<string, string> = {}): CardText {
  const rows: CardText['rows'] = [{ label: '① 선정만', value: trendReturn(result.hold.stats.totalPct), tone: toneOf(result.hold.stats.totalPct), swatch: swatches.hold }];
  if (result.trading) rows.push({ label: '② 선정 + 매매 규칙', value: trendReturn(result.trading.stats.totalPct), tone: toneOf(result.trading.stats.totalPct), swatch: swatches.trading });
  const idx = result.indices[0];
  if (idx) rows.push({ label: idx.id, value: idx.stats ? trendReturn(idx.stats.totalPct) : '—', tone: toneOf(idx.stats?.totalPct ?? null), swatch: swatches[`idx-${idx.id}`] });
  return { title, subtitle: `${dotDate(result.axis[0])} ~ ${dotDate(result.axis[result.axis.length - 1])}`, rows, footer: '시장 데이터 파일' };
}
