<script lang="ts">
  import type { TradeInterval, Venue } from '../market/tradable';
  import { kstDate, kstEpoch, kstMinuteOfDay } from '../time/kst';
  import type { ChartSeriesInput } from './lineData';

  interface Props {
    series: ChartSeriesInput[];
    /** epoch ms → 차트와 같은 X 좌표(px). 범위 밖이면 null */
    xOf: (t: number) => number | null;
    width: number;
    /** KST 날짜. 없으면 첫 구간의 날짜로 08:00–20:00 범위를 정한다 */
    day?: string;
  }

  let { series, xOf, width, day }: Props = $props();

  const LANE_H = 6;
  const LANE_GAP = 5;
  const TOP = 4;
  const MIN_TEXT_W = 28;
  const VENUE_TEXT: Record<Venue, string> = { KRX: 'KRX', NXT: 'NXT', UNIFIED: '통합' };

  type Segment =
    | { kind: 'continuous' | 'auction'; start: number; end: number; venue: Venue; fallback: boolean }
    | { kind: 'gap'; start: number; end: number };

  interface Rect {
    x: number;
    w: number;
    fill: string;
    label: string;
    opacity?: number;
    text?: string;
  }

  const visible = $derived(series.filter((s) => !s.hidden));
  const laneDay = $derived(
    day ?? (() => {
      const first = visible.find((s) => s.intervals.length > 0)?.intervals[0];
      return first ? kstDate(first.start) : undefined;
    })(),
  );

  const hm = (t: number) => {
    const m = kstMinuteOfDay(t);
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  };

  /** 08:00–20:00 안에서 구간 사이 빈 곳을 '거래 불가'로 채운다. */
  function segments(intervals: TradeInterval[], from: number, to: number): Segment[] {
    const result: Segment[] = [];
    let cursor = from;
    for (const iv of [...intervals].sort((a, b) => a.start - b.start)) {
      const start = Math.max(iv.start, from);
      const end = Math.min(iv.end, to);
      if (end <= start) continue;
      if (start > cursor) result.push({ kind: 'gap', start: cursor, end: start });
      result.push({ kind: iv.kind, start, end, venue: iv.venue, fallback: iv.fallback === true });
      cursor = Math.max(cursor, end);
    }
    if (cursor < to) result.push({ kind: 'gap', start: cursor, end: to });
    return result;
  }

  function toRect(seg: Segment, slot: number): Rect | null {
    const a = xOf(seg.start);
    const b = xOf(seg.end);
    if (a === null && b === null) return null;
    // 차트를 확대·이동하면 보이는 범위 밖으로 나간 부분은 자른다.
    const x1 = Math.max(0, a ?? 0);
    const x2 = Math.min(width, b ?? width);
    if (x2 <= x1) return null;
    const range = `${hm(seg.start)}–${hm(seg.end)}`;
    if (seg.kind === 'gap') {
      return { x: x1 + 0.5, w: Math.max(0, x2 - x1 - 1), fill: 'url(#lane-hatch)', label: `거래 불가 ${range}` };
    }
    const venue = VENUE_TEXT[seg.venue];
    if (seg.kind === 'auction') {
      return { x: x1, w: Math.max(1.5, x2 - x1), fill: 'url(#lane-auction)', label: `${venue} 단일가 ${range}` };
    }
    return {
      x: x1 + 0.5,
      w: Math.max(0, x2 - x1 - 1),
      fill: `var(--s${slot})`,
      label: `${venue} ${range}`,
      opacity: seg.fallback ? 0.55 : undefined,
      text: x2 - x1 >= MIN_TEXT_W ? venue : undefined,
    };
  }

  const rows = $derived.by(() => {
    if (laneDay === undefined) return visible.map((s) => ({ s, rects: [] as Rect[] }));
    const from = kstEpoch(laneDay, '08:00:00');
    const to = kstEpoch(laneDay, '20:00:00');
    return visible.map((s) => ({
      s,
      rects: segments(s.intervals, from, to)
        .map((seg) => toRect(seg, s.slot))
        .filter((r): r is Rect => r !== null),
    }));
  });

  const height = $derived(rows.length === 0 ? 0 : TOP + rows.length * (LANE_H + LANE_GAP) - LANE_GAP);
</script>

<svg class="lanes" {width} {height} role="group" aria-label="종목별 거래 가능 시간">
  <defs>
    <pattern id="lane-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="4" stroke="var(--hatch)" stroke-width="1.5" />
    </pattern>
    <pattern id="lane-auction" width="3" height="3" patternUnits="userSpaceOnUse">
      <line x1="0" y1="0" x2="0" y2="3" stroke="var(--hatch)" stroke-width="1" />
    </pattern>
  </defs>
  {#each rows as { s, rects }, i (s.id)}
    {@const y = TOP + i * (LANE_H + LANE_GAP)}
    <g data-lane={s.id} role="group" aria-label={s.label}>
      {#each rects as r (r.label)}
        <rect
          x={r.x}
          {y}
          width={r.w}
          height={LANE_H}
          rx={r.fill.startsWith('var') || r.fill === 'url(#lane-hatch)' ? 2 : 0}
          fill={r.fill}
          opacity={r.opacity}
          stroke={r.fill === 'url(#lane-hatch)' ? 'var(--line)' : undefined}
          stroke-width={r.fill === 'url(#lane-hatch)' ? 0.5 : undefined}
          role="img"
          aria-label={r.label}
        />
        {#if r.text}
          <text x={r.x + 3.5} y={y + 5.3} aria-hidden="true">{r.text}</text>
        {/if}
      {/each}
    </g>
  {/each}
</svg>

<style>
  .lanes {
    display: block;
    overflow: visible;
  }
  text {
    font-size: 6px;
    font-weight: 800;
    fill: #fff;
    pointer-events: none;
  }
</style>
