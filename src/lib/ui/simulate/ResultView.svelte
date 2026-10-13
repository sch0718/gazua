<script lang="ts">
  // 결과 보기(스펙 7.4): 머리줄 · 요약 카드 · 자산 곡선 · 비교 기준 · 탭 · 한계 안내.
  // 탭 본문은 TradeList·SymbolTab·SkipList로 나눴다.
  import type { Trade } from '../../sim/types';
  import type { Issue } from '../../sim/validate';
  import Badge from '../components/Badge.svelte';
  import Segmented from '../components/Segmented.svelte';
  import EquityChart, { EQUITY_LINES, type EquityKey } from './EquityChart.svelte';
  import LineSwatch from './LineSwatch.svelte';
  import type { DoneState } from './runController.svelte';
  import { dominantSkipReason, fmtPp, fmtReturnPct, LIMITATIONS, nearMissText, resultHeadline, returnClass, skipCounts, skipReasonLabel, trendReturn } from './simText';
  import SkipList from './SkipList.svelte';
  import SymbolTab from './SymbolTab.svelte';
  import TradeChartSheet from './TradeChartSheet.svelte';
  import TradeList from './TradeList.svelte';

  // 'state' 이름은 $state 룬과 겹쳐서 done으로 받는다.
  let {
    state: done,
    colorConvention,
    theme,
    onEdit,
  }: {
    state: DoneState;
    colorConvention: 'kr' | 'global';
    /** 앱 테마(app.settings.theme). 바뀌면 자산 곡선 색을 다시 읽는다 */
    theme?: string;
    /** 편집으로 돌아간다. section이 있으면 그 구역을 연다 */
    onEdit: (section?: Issue['section']) => void;
  } = $props();

  const result = $derived(done.result);
  const meta = $derived(done.meta);
  const sum = $derived(result.summary);
  const benchSymbol = $derived(meta.strategy.benchmarks.symbol);
  const benchName = $derived(benchSymbol ? (meta.names[benchSymbol] ?? benchSymbol) : null);
  // 거래 차트 시트에서 강조할 돌파 기준선(돌파 트리거를 쓸 때만)
  const breakout = $derived(meta.strategy.entry.triggers.breakout);

  // 누른 거래: 그 포지션의 거래 차트 시트를 연다
  let picked = $state<Trade | null>(null);
  const pick = (t: Trade) => (picked = t);

  let tab = $state<'trades' | 'symbols' | 'skipped'>('trades');

  const oneDecimal = (v: number) => `${(Math.round(v * 10) / 10).toFixed(1)}%`;

  const cards = $derived([
    { label: '총수익률', value: trendReturn(sum.totalReturnPct), cls: returnClass(sum.totalReturnPct), sub: `그냥 보유보다 ${fmtPp(sum.vsHoldPp)}`, main: true },
    { label: '최대 낙폭', value: fmtReturnPct(sum.mddPct), cls: '', sub: '', main: false },
    { label: '승률', value: sum.winRatePct === null ? '—' : oneDecimal(sum.winRatePct), cls: '', sub: `${sum.wins}승 ${sum.losses}패`, main: false },
    {
      label: '거래 횟수',
      value: `${sum.roundTrips}번`,
      cls: '',
      // 거래 횟수는 끝난 거래만 센다(보유 중인 종목은 따로)
      sub: [
        `끝난 ${sum.roundTrips}번`,
        sum.openPositions ? `아직 보유 ${sum.openPositions}종목` : '',
        sum.avgHoldDays === null ? '' : `평균 ${Math.round(sum.avgHoldDays)}일`,
      ]
        .filter(Boolean)
        .join(' · '),
      main: false,
    },
  ]);

  type Row = { key: EquityKey; label: string; value: number | null; failed: string | null };
  const rows = $derived.by(() => {
    const out: Row[] = [
      { key: 'strategy', label: '내 전략', value: sum.totalReturnPct, failed: null },
      { key: 'hold', label: '같은 종목 사서 보유', value: result.benchmarks.holdReturnPct, failed: null },
    ];
    if (benchName !== null) {
      const v = result.benchmarks.benchmarkReturnPct;
      out.push({ key: 'benchmark', label: benchName, value: v, failed: meta.benchmarkFailed || v === null ? '받지 못했어요' : null });
    }
    const iv = result.benchmarks.indexReturnPct;
    out.push({ key: 'index', label: meta.strategy.benchmarks.index, value: iv, failed: meta.indexFailed ?? (iv === null ? '받지 못했어요' : null) });
    return out;
  });
  const lineOf = (k: EquityKey) => EQUITY_LINES.find((l) => l.key === k)!;

  const noTrades = $derived(result.trades.length === 0);
  // 가장 많은 이유가 현금·금액이면 기간·자금을 고치라고 안내하고 그 구역을 연다
  const cashIssue = $derived.by(() => {
    const top = dominantSkipReason(result.skipped);
    return top === '현금 부족' || top === '1주가 1회 금액보다 비쌈';
  });
</script>

<section class="result" aria-label="시뮬레이션 결과">
  <p class="head">
    <span>{resultHeadline(meta.from, meta.to, meta.venueLabel, meta.fetchedAt, meta.strategy.period.from)}</span>
    {#if meta.demo}<Badge>데모 데이터</Badge>{/if}
  </p>

  {#if noTrades}
    <div class="empty">
      {#if result.skipped.length === 0}
        <p class="big">기간 동안 매수 신호가 한 번도 나지 않았어요</p>
        {#if result.nearMiss}<p>{nearMissText(result.nearMiss, meta.strategy)}</p>{/if}
      {:else}
        <p class="big">매수 신호가 {result.skipped.length}번 났지만 한 번도 사지 못했어요</p>
        <ul class="why-list" aria-label="건너뛴 이유">
          {#each skipCounts(result.skipped) as c (c.reason)}
            <li>{skipReasonLabel(c.reason)} <span class="num">{c.n}번</span></li>
          {/each}
        </ul>
        {#if cashIssue}<p>기간·자금에서 회당 비중이나 처음 자금을 늘려 보세요</p>{/if}
      {/if}
      <button type="button" class="fix" onclick={() => (cashIssue ? onEdit('capital') : onEdit())}>규칙 고치기</button>
    </div>
    {#if result.skipped.length > 0}
      <SkipList skipped={result.skipped} names={meta.names} />
    {/if}
  {:else}
    <ul class="cards" aria-label="요약">
      {#each cards as c (c.label)}
        <li class="card">
          <span class="label">{c.label}</span>
          <b class="num value {c.cls}" class:main={c.main} style:--chars={c.main ? c.value.length : null}>{c.value}</b>
          {#if c.sub}<small class="num">{c.sub}</small>{/if}
        </li>
      {/each}
    </ul>

    {#key result}
      <EquityChart
        equity={result.equity}
        initial={meta.strategy.capital.initial}
        labels={{ benchmark: benchName, index: meta.strategy.benchmarks.index }}
        {theme}
      />
    {/key}

    <ul class="bench" aria-label="비교 기준">
      {#each rows as r (r.label)}
        <li>
          <span class="who"><LineSwatch line={lineOf(r.key)} />{r.label}</span>
          {#if r.failed}
            <span class="failed">{r.failed}</span>
          {:else}
            <b class="num {returnClass(r.value)}">{trendReturn(r.value)}</b>
          {/if}
        </li>
      {/each}
    </ul>

    <Segmented
      label="결과 보기"
      value={tab}
      onchange={(v) => (tab = v as typeof tab)}
      options={[
        { value: 'trades', label: '거래 내역' },
        { value: 'symbols', label: '종목별' },
        { value: 'skipped', label: `건너뛴 신호 ${result.skipped.length}` },
      ]}
    />
    <div class="tab">
      {#if tab === 'trades'}
        <TradeList trades={result.trades} names={meta.names} onTrade={pick} />
      {:else if tab === 'symbols'}
        <SymbolTab perSymbol={result.perSymbol} axisFrom={meta.from} failed={meta.failed} {colorConvention} />
      {:else}
        <SkipList skipped={result.skipped} names={meta.names} />
      {/if}
    </div>
  {/if}

  <TradeChartSheet
    open={picked !== null}
    trade={picked}
    trades={result.trades}
    candles={picked ? (meta.candles[picked.symbol] ?? []) : []}
    name={picked ? (meta.names[picked.symbol] ?? picked.symbol) : ''}
    level={breakout.on ? breakout.level : null}
    onclose={() => (picked = null)}
  />

  <ul class="limits" aria-label="결과 해석 한계">
    {#each LIMITATIONS as line (line)}
      <li>{line}</li>
    {/each}
  </ul>
</section>

<style>
  .result {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 16px var(--gutter);
    font-size: var(--fs-body);
  }
  .head {
    margin: 0;
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  .cards {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    /* 긴 값이 칸을 밀어 넓히지 않게 */
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .cards li {
    min-width: 0;
    /* 총수익률 긴 값의 글자 크기를 카드 폭에 맞춘다(cqi) */
    container-type: inline-size;
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
  }
  /* 총수익률은 한 줄, 기본은 headline. `▲ +125.3%`처럼 길면 반 카드 안쪽 폭(375px에서 143.5px)에 맞춰 줄인다.
     글자당 0.66em으로 넉넉히 잡는다(실측 약 0.64em). 넓은 카드에서는 그대로 headline.
     컨테이너 단위(cqi)를 모르는 브라우저는 폰 폭의 카드 안쪽(50vw − 44px)으로 계산한다 */
  .value.main {
    white-space: nowrap;
    font-size: min(var(--fs-headline), calc((50vw - 44px) / (var(--chars) * 0.66)));
  }
  @supports (width: 1cqi) {
    .value.main {
      font-size: min(var(--fs-headline), calc(100cqi / (var(--chars) * 0.66)));
    }
  }
  small {
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  .bench {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .bench li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    padding: 8px 0;
    border-bottom: 1px solid var(--line);
    font-size: var(--fs-body);
  }
  .who {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .failed {
    color: var(--t3);
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    color: var(--t2);
  }
  .empty p {
    margin: 0;
  }
  .why-list {
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: var(--fs-sub);
  }
  .big {
    font-size: var(--fs-title);
    font-weight: 700;
    color: var(--t1);
  }
  .fix {
    margin-top: 6px;
    min-height: 44px;
    padding: 0 16px;
    border-radius: 12px;
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 700;
  }
  .limits {
    margin: 0;
    padding-left: 18px;
    font-size: var(--fs-sub);
    color: var(--t3);
  }
</style>
