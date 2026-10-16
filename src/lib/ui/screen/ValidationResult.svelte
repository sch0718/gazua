<script lang="ts">
  // 검증 결과(스펙 7.4): 오늘 기준 선별 · 요약 카드 · 자산 곡선 · 시장별 표 · 선정 이력 · 해석 도움말.
  import type { ValidationResult } from '../../screen/runValidation';
  import type { App } from '../../state/app.svelte';
  import Banner from '../components/Banner.svelte';
  import EquityChart, { type CurveLine } from '../simulate/EquityChart.svelte';
  import { fmtReturnPct, returnClass, trendReturn } from '../simulate/simText';
  import MarketTable from './MarketTable.svelte';
  import SelectionHistory from './SelectionHistory.svelte';
  import TodayPicks from './TodayPicks.svelte';
  import { ALL_EMPTY_TEXT, FEW_SEGMENTS_TEXT, HELP_ALWAYS, SPARSE_TEXT, trendPp, WARMUP_TEXT } from './screenText';

  let {
    app,
    result,
    names,
    criteriaName,
    capital,
    theme,
  }: {
    app: App;
    result: ValidationResult;
    names: Record<string, string>;
    criteriaName: string;
    /** 곡선의 시작 자본(수익률 기준) */
    capital: number;
    theme?: string;
  } = $props();

  interface Card {
    id: string;
    label: string;
    stats: ValidationResult['hold']['stats'] | null;
    /** 곡선이 없을 때의 사유 */
    reason?: string;
    beat?: ValidationResult['hold']['beat'];
    main?: boolean;
  }

  const first = $derived(result.indices.find((i) => i.stats)?.stats ?? null);
  const cards = $derived<Card[]>([
    { id: 'hold', label: '① 선정만', stats: result.hold.stats, beat: result.hold.beat, main: true },
    ...(result.trading ? [{ id: 'trading', label: '② 선정 + 매매 규칙', stats: result.trading.stats } as Card] : []),
    ...result.indices.map((i) => ({ id: `idx-${i.id}`, label: i.id, stats: i.stats, reason: i.reason ?? '받지 못했어요' })),
    ...result.benchmarks.map((b) => ({ id: `etf-${b.symbol}`, label: b.name, stats: b.stats, reason: b.reason ?? '받지 못했어요' })),
  ]);

  // 곡선 모양: 기존 자산 곡선의 팔레트(강조 · 지정 종목 · 지수 점선 · 보유 회색)를 재사용한다
  const INDEX_STYLES: CurveLine['color'][] = [['--t2', '#5b6069'], ['--s4', '#eda100']];
  const BENCH_STYLES: Pick<CurveLine, 'color' | 'width' | 'dashed'>[] = [
    { color: ['--t3', '#676d77'], width: 1, dashed: false },
    { color: ['--s2', '#1baf7a'], width: 1, dashed: false },
    { color: ['--s5', '#e87ba4'], width: 1, dashed: false },
  ];
  const curves = $derived<CurveLine[]>([
    { id: 'hold', name: '① 선정만', color: ['--accent', '#5b47e0'], width: 2, dashed: false, points: result.hold.equity },
    ...(result.trading ? [{ id: 'trading', name: '② 선정 + 매매 규칙', color: ['--line-bench', '#d95926'] as CurveLine['color'], width: 2, dashed: true, points: result.trading.curve }] : []),
    ...result.indices.flatMap((i, k) => (i.curve ? [{ id: `idx-${i.id}`, name: i.id, color: INDEX_STYLES[k % INDEX_STYLES.length], width: 1.5, dashed: true, points: i.curve }] : [])),
    ...result.benchmarks.flatMap((b, k) => (b.curve ? [{ id: `etf-${b.symbol}`, name: b.name, ...BENCH_STYLES[k % BENCH_STYLES.length], points: b.curve }] : [])),
  ]);
  const rebalanceDates = $derived(result.rebalances.map((r) => r.date));

  const note = (n: ValidationResult['notes'][number]) => result.notes.includes(n);
</script>

<div class="vr">
  {#if note('allEmpty')}<Banner tone="warn" message={ALL_EMPTY_TEXT} />{/if}

  <TodayPicks {app} selection={result.today} {names} {criteriaName} />

  <section aria-labelledby="sum-h">
    <h3 id="sum-h">요약</h3>
    <ul class="cards">
      {#each cards as c (c.id)}
        <li class="card" data-card={c.id}>
          <span class="label">{c.label}</span>
          {#if c.stats}
            {@const s = c.stats}
            <b class="num value {returnClass(s.totalPct)}">{trendReturn(s.totalPct)}</b>
            <small class="num">연환산 {fmtReturnPct(s.cagrPct, true)} · 최대 낙폭 {fmtReturnPct(s.mddPct)}</small>
            {#if c.id.startsWith('idx-') === false}
              {@const vs = first ? s.totalPct - first.totalPct : null}
              <small class="num">지수 대비 <b class={vs === null ? '' : returnClass(vs)}>{vs === null ? '—' : trendPp(vs)}</b></small>
            {/if}
            {#if c.beat}<small class="num">지수보다 나은 구간 {c.beat.beat}/{c.beat.total}</small>{/if}
          {:else}
            <span class="miss">{c.reason}</span>
          {/if}
        </li>
      {/each}
      {#if !result.trading}
        <li class="card" data-card="trading"><span class="label">② 선정 + 매매 규칙</span><span class="miss">매매 규칙을 고르면 함께 볼 수 있어요</span></li>
      {/if}
    </ul>
  </section>

  <section aria-labelledby="eq-h">
    <h3 id="eq-h">자산 곡선</h3>
    {#key result}
      <EquityChart initial={capital} {curves} {rebalanceDates} {theme} />
    {/key}
    <p class="cap">세로 눈금은 재선정일이에요</p>
  </section>

  <MarketTable {result} />
  <SelectionHistory {result} {names} />

  <ul class="help" aria-label="결과 해석 도움말">
    {#each HELP_ALWAYS as line (line)}<li>{line}</li>{/each}
    {#if note('fewSegments')}<li>{FEW_SEGMENTS_TEXT}</li>{/if}
    {#if note('warmup')}<li>{WARMUP_TEXT}</li>{/if}
    {#if note('sparseAxis')}<li>{SPARSE_TEXT}</li>{/if}
  </ul>
</div>

<style>
  .vr {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }
  h3 {
    margin: 0 0 8px;
    font-size: var(--fs-title);
  }
  .cards {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .card {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 12px;
    border-radius: var(--r-card);
    background: var(--surface);
  }
  .label {
    font-size: var(--fs-sub);
    color: var(--t3);
  }
  .value {
    font-size: var(--fs-title);
    font-weight: 700;
    white-space: nowrap;
  }
  small {
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  .miss {
    color: var(--t2);
    font-size: var(--fs-sub);
  }
  .cap {
    margin: 4px 0 0;
    font-size: var(--fs-sub);
    color: var(--t3);
  }
  .help {
    margin: 0;
    padding-left: 18px;
    font-size: var(--fs-sub);
    color: var(--t3);
  }
</style>
