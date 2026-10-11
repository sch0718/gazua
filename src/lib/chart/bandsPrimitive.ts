import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  Time,
} from 'lightweight-charts';
import type { DaySession } from '../market/sessions';

export interface BandSpan {
  start: number;
  end: number;
}

export interface BandLabel extends BandSpan {
  /** 넓은 것부터. 칸에 들어가는 첫 문구를 쓰고, 다 안 들어가면 생략한다 */
  texts: string[];
}

/** 1일 차트 배경: 프리·애프터 음영, 단일가 세로 사선, 맨 위 구간 라벨. 시각은 epoch ms */
export interface SessionBands {
  shades: BandSpan[];
  auctions: BandSpan[];
  labels: BandLabel[];
}

type Segment = BandSpan & { session: DaySession };
type Group = BandSpan & { regular: boolean; texts: string[]; unified: string | null };

const PRIORITY: [DaySession['venue'], DaySession['kind']][] = [
  ['KRX', 'continuous'],
  ['NXT', 'continuous'],
  ['KRX', 'auction'],
  ['NXT', 'auction'],
];

// 스펙 5.2: `NXT 프리 │ KRX 정규 │ NXT │ KRX 애프터`, 통합 모드는 `프리 │ 정규 │ 애프터`.
const PHASE_TEXT: Record<string, { texts: string[]; unified: string }> = {
  'NXT:pre': { texts: ['NXT 프리', '프리'], unified: '프리' },
  'KRX:regular': { texts: ['KRX 정규', '정규'], unified: '정규' },
  'NXT:regular': { texts: ['NXT 정규', '정규'], unified: '정규' },
  'NXT:after': { texts: ['NXT'], unified: '애프터' },
  'KRX:after': { texts: ['KRX 애프터', '애프터'], unified: '애프터' },
};

/** 시장 전체 기준으로 시간축을 자른다. 겹치면 KRX 접속 > NXT 접속 > KRX 단일가 > NXT 단일가. */
function sweep(sessions: DaySession[]): Segment[] {
  const bounds = [...new Set(sessions.flatMap((s) => [s.start, s.end]))].sort((a, b) => a - b);
  const result: Segment[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const start = bounds[i];
    const end = bounds[i + 1];
    const active = sessions.filter((s) => s.start <= start && start < s.end);
    const session = PRIORITY.map(([v, k]) => active.find((s) => s.venue === v && s.kind === k)).find(Boolean);
    if (!session) continue;
    const last = result.at(-1);
    if (last && last.end === start && last.session === session) last.end = end;
    else result.push({ start, end, session });
  }
  return result;
}

const sameVenueContinuous = (a: Segment | undefined, venue: string) =>
  a !== undefined && a.session.kind === 'continuous' && a.session.venue === venue;

/** 단일가는 같은 거래소의 이웃 접속매매 구간(앞 우선)에 붙여 라벨·음영 단위를 만든다. */
function groupsOf(segments: Segment[]): Group[] {
  const groups: Group[] = [];
  let pendingStart: number | null = null;
  segments.forEach((seg, i) => {
    const { venue, kind, label } = seg.session;
    if (kind === 'continuous') {
      const text = PHASE_TEXT[`${venue}:${label}`];
      groups.push({
        start: pendingStart ?? seg.start,
        end: seg.end,
        regular: label === 'regular',
        texts: text?.texts ?? [],
        unified: text?.unified ?? null,
      });
      pendingStart = null;
      return;
    }
    const prev = segments[i - 1];
    const next = segments[i + 1];
    if (sameVenueContinuous(prev, venue) && prev.end === seg.start && groups.length > 0) {
      groups[groups.length - 1].end = seg.end;
    } else if (sameVenueContinuous(next, venue) && next.start === seg.end) {
      pendingStart = seg.start;
    } else {
      groups.push({ start: seg.start, end: seg.end, regular: false, texts: [], unified: null });
    }
  });
  return groups;
}

function mergeAdjacent<T extends BandSpan>(spans: T[], same: (a: T, b: T) => boolean): T[] {
  const result: T[] = [];
  for (const s of spans) {
    const last = result.at(-1);
    if (last && last.end === s.start && same(last, s)) last.end = s.end;
    else result.push({ ...s });
  }
  return result;
}

/** 그날 세션으로 배경 음영·단일가·라벨 구간을 계산한다. unified면 통합 모드 라벨을 쓴다. */
export function sessionBands(sessions: DaySession[], unified: boolean): SessionBands {
  const segments = sweep(sessions);
  const groups = groupsOf(segments);
  const shades = mergeAdjacent(
    groups.filter((g) => !g.regular).map(({ start, end }) => ({ start, end })),
    () => true,
  );
  const auctions = mergeAdjacent(
    segments.filter((s) => s.session.kind === 'auction').map(({ start, end }) => ({ start, end })),
    () => true,
  );
  const labels = unified
    ? mergeAdjacent(
        groups.filter((g) => g.unified !== null).map((g) => ({ start: g.start, end: g.end, texts: [g.unified!] })),
        (a, b) => a.texts[0] === b.texts[0],
      )
    : groups.filter((g) => g.texts.length > 0).map((g) => ({ start: g.start, end: g.end, texts: g.texts }));
  return { shades, auctions, labels };
}

export interface BandsColors {
  band: string;
  hatch: string;
  label: string;
  font: string;
}

export type BandsInput =
  | { mode: 'intraday'; bands: SessionBands; xOf: (t: number) => number | null }
  | {
      mode: 'daily';
      halts: { t: number; labels: string[] }[];
      /** 그 거래일 칸의 가운데 x와 폭(px). 축에 없으면 null */
      dayBand: (t: number) => { x: number; w: number } | null;
    };

type RenderTarget = Parameters<IPrimitivePaneRenderer['draw']>[0];
type Ctx = CanvasRenderingContext2D;

const LABEL_Y = 4;
const LABEL_PAD = 4;

/**
 * 첫 번째 보이는 실선 시리즈에 붙이는 배경 프리미티브.
 * 1일: 프리·애프터 음영(--band), 단일가 세로 사선(--hatch), 맨 위 구간 라벨.
 * 일봉: 거래정지일에 사선 세로 띠 + `거래정지 · 종목` 라벨.
 */
export class SessionBandsPrimitive implements ISeriesPrimitive<Time> {
  private readonly views: readonly IPrimitivePaneView[];

  /** 입력이 바뀌면 CompareChart가 시리즈와 함께 새로 만들어 붙인다. */
  constructor(
    private readonly input: BandsInput,
    private readonly colors: BandsColors,
  ) {
    const renderer: IPrimitivePaneRenderer = { draw: (target) => this.draw(target) };
    this.views = [{ zOrder: () => 'bottom', renderer: () => renderer }];
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  private draw(target: RenderTarget): void {
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      context.save();
      context.font = `600 10px ${this.colors.font}`;
      context.textBaseline = 'top';
      if (this.input.mode === 'intraday') this.drawIntraday(context, mediaSize.height, this.input);
      else this.drawDaily(context, mediaSize.width, mediaSize.height, this.input);
      context.restore();
    });
  }

  private drawIntraday(ctx: Ctx, height: number, input: Extract<BandsInput, { mode: 'intraday' }>): void {
    const span = (s: BandSpan) => {
      const a = input.xOf(s.start);
      const b = input.xOf(s.end);
      return a === null || b === null ? null : { x: a, w: b - a };
    };
    ctx.fillStyle = this.colors.band;
    for (const s of input.bands.shades) {
      const r = span(s);
      if (r) ctx.fillRect(r.x, 0, r.w, height);
    }
    for (const s of input.bands.auctions) {
      const r = span(s);
      if (r) this.verticalHatch(ctx, r.x, Math.max(1.5, r.w), height);
    }
    ctx.fillStyle = this.colors.label;
    ctx.textAlign = 'center';
    for (const l of input.bands.labels) {
      const r = span(l);
      if (!r) continue;
      const text = l.texts.find((t) => ctx.measureText(t).width <= r.w - LABEL_PAD);
      if (text) ctx.fillText(text, r.x + r.w / 2, LABEL_Y);
    }
  }

  private drawDaily(ctx: Ctx, width: number, height: number, input: Extract<BandsInput, { mode: 'daily' }>): void {
    for (const halt of input.halts) {
      const band = input.dayBand(halt.t);
      if (!band) continue;
      ctx.globalAlpha = 0.7;
      this.diagonalHatch(ctx, band.x - band.w / 2, band.w, height);
      ctx.globalAlpha = 1;
      const text = `거래정지 · ${halt.labels.join(', ')}`;
      const half = ctx.measureText(text).width / 2;
      const cx = Math.min(Math.max(band.x, half + 2), width - half - 2);
      ctx.fillStyle = this.colors.label;
      ctx.textAlign = 'center';
      ctx.fillText(text, cx, LABEL_Y);
    }
  }

  private verticalHatch(ctx: Ctx, x: number, w: number, h: number): void {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, 0, w, h);
    ctx.clip();
    ctx.strokeStyle = this.colors.hatch;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let lx = x; lx < x + w; lx += 3) {
      ctx.moveTo(lx + 0.5, 0);
      ctx.lineTo(lx + 0.5, h);
    }
    ctx.stroke();
    ctx.restore();
  }

  private diagonalHatch(ctx: Ctx, x: number, w: number, h: number): void {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, 0, w, h);
    ctx.clip();
    ctx.strokeStyle = this.colors.hatch;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let d = -h; d < w; d += 5) {
      ctx.moveTo(x + d, h);
      ctx.lineTo(x + d + h, 0);
    }
    ctx.stroke();
    ctx.restore();
  }
}
