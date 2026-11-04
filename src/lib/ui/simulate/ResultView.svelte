<script lang="ts">
  import { patternEntryOf } from '../../sim/patternBlock';
  // 결과 보기(스펙 7.4): 머리줄 · 요약 카드 · 자산 곡선 · 비교 기준 · 탭 · 한계 안내.
  // 탭 본문은 TradeList·SymbolTab·SkipList로 나눴다.
  import type { Skip, Trade } from '../../sim/types';
  import type { Issue } from '../../sim/validate';
  import { Badge } from '@sch0718/ui-svelte';
  import { Segmented } from '@sch0718/ui-svelte';
  import EquityChart, { EQUITY_LINES, type EquityKey } from './EquityChart.svelte';
  import LineSwatch from './LineSwatch.svelte';
  import type { DoneState } from './runController.svelte';
  import { FEW_TRADES_TEXT, fmtPp, fmtReturnPct, LIMITATIONS, MIN_CLOSED_TRADES, nearMissText, resultHeadline, returnClass, skipCounts, skipReasonLabel, trendReturn } from './simText';
  import SkipList from './SkipList.svelte';
  import SymbolTab from './SymbolTab.svelte';
  import TradeChartSheet from './TradeChartSheet.svelte';
  import TradeList from './TradeList.svelte';
  import type { CardCapture } from '../../share/shareStore.svelte';
  import { cardAlt, composeCard, readCardColors, simResultCardText } from '../../share/cardImage';
  import { tick, untrack } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import DayPanel from './DayPanel.svelte';
  import ReplayBar from './ReplayBar.svelte';
  import { createReplay, replayMotion, type Replay } from './replay.svelte';

  // 'state' 이름은 $state 룬과 겹쳐서 done으로 받는다.
  let {
    state: done,
    colorConvention,
    theme,
    stale = false,
    onEdit,
    onShare,
    readonly = false,
    hideAmounts = false,
    skippedCounts,
    pnlPct,
    sampledNote,
  }: {
    state: DoneState;
    colorConvention: 'kr' | 'global';
    /** 앱 테마(app.settings.theme). 바뀌면 자산 곡선 색을 다시 읽는다 */
    theme?: string;
    /** 규칙이 바뀌어 지난 실행의 결과다: `이전 결과` 표시와 왼쪽 강조선(흐리게 하지 않는다) */
    stale?: boolean;
    /** 편집으로 돌아간다. 읽기 전용(받은 공유)이면 없다 */
    onEdit?: (section?: Issue['section']) => void;
    /** 결과 공유(로그인했을 때만 넘긴다) */
    onShare?: () => void;
    /** 받은 공유: 규칙 고치기·거래 차트 시트를 숨기고 거래 줄을 누를 수 없게 */
    readonly?: boolean;
    /** 자금 숨김 공유: 거래 수량을 숨기고 종목별은 자금 대비 %로 */
    hideAmounts?: boolean;
    /** 건너뛴 신호 목록 없이 받은 이유별 개수(공유에서 skipped.rows가 null일 때) */
    skippedCounts?: [Skip['reason'], number][];
    /** 종목별 자금 대비 %(hideAmounts일 때) */
    pnlPct?: Record<string, number>;
    /** 곡선을 솎은 공유의 안내(차트 아래) */
    sampledNote?: string;
  } = $props();

  const result = $derived(done.result);
  const meta = $derived(done.meta);
  const sum = $derived(result.summary);
  const benchSymbol = $derived(meta.strategy.benchmarks.symbol);
  const benchName = $derived(benchSymbol ? (meta.names[benchSymbol] ?? benchSymbol) : null);
  // 거래 차트 시트에서 강조할 돌파 기준선(돌파 트리거를 쓸 때만)
  const breakout = $derived(patternEntryOf(meta.strategy)?.triggers.breakout ?? { on: false, level: 'B' as const });

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
      // 값은 보유 중 포함 거래 수, 부가 줄의 끝난 거래 = roundTrips − openPositions(= 승 + 패)
      sub: [
        `끝난 ${sum.roundTrips - sum.openPositions}번`,
        sum.openPositions ? `아직 보유 ${sum.openPositions}종목` : '',
        sum.avgHoldDays === null ? '' : `평균 ${Math.round(sum.avgHoldDays)}일`,
      ]
        .filter(Boolean)
        .join(' · '),
      main: false,
    },
  ]);

  // 끝난 거래 = 승 + 패. 거래 0건 화면에서는 쓰지 않는다
  const fewTrades = $derived(sum.roundTrips - sum.openPositions < MIN_CLOSED_TRADES);

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
  // 재생(설계 §3·§4.1): 결과마다 컨트롤러를 하나 만들고, 결과가 바뀌거나 화면을 떠나면 정리한다.
  // createReplay가 자기 $state를 읽어도 이 effect의 의존성이 되지 않게 untrack으로 감싼다. 첫 렌더에서는 undefined다.
  let replay = $state.raw<Replay>();
  $effect(() => {
    const n = result.equity.length;
    const r = untrack(() => createReplay({ length: n }));
    replay = r;
    return () => r.destroy();
  });
  const timeline = $derived(result.timeline);
  const dates = $derived(result.equity.map((e) => e.date));
  // 엔진 버그 방어: 길이가 다르면 재생을 숨긴다
  const timelineBroken = $derived(timeline !== undefined && timeline.length !== result.equity.length);
  $effect(() => {
    if (timelineBroken) console.error('재생 기록 길이가 자산 곡선과 달라 재생을 숨겨요', timeline?.length, result.equity.length);
  });
  // 재생 막대·패널: 기록이 있고 길이가 맞고, 거래일 2일 이상, 거래 1건 이상(거래 0건이면 자산 곡선이 없다)
  const canReplay = $derived(timeline !== undefined && !timelineBroken && result.equity.length >= 2 && !noTrades);
  // 재생을 건드리기 전에는 차트를 지금 그대로(upTo 없음) 둔다
  const upTo = $derived(canReplay && replay?.touched ? replay.index : undefined);
  const frame = $derived(canReplay && replay && timeline ? (timeline[replay.index] ?? null) : null);
  const dayTrades = $derived(frame ? result.trades.filter((t) => t.date === frame.date) : []);
  const daySkipped = $derived(frame ? result.skipped.filter((k) => k.date === frame.date) : []);
  // 움직임 줄이기면 효과 없이 값만 바꾼다. svelte/motion의 prefersReducedMotion은 불러오는 순간 matchMedia를 불러 jsdom에서 깨진다
  const reducedQuery = typeof matchMedia === 'function' ? new MediaQuery('(prefers-reduced-motion: reduce)') : null;
  const motion = $derived(replay ? replayMotion(replay, reducedQuery?.current ?? false) : false);

  /** 「그날 상황 보기」: 날짜는 그대로 두고 패널을 펼쳐 초점을 옮긴다 */
  async function openDay() {
    if (replay) replay.seek(replay.index);
    await tick();
    root?.querySelector<HTMLElement>('section[aria-label="그날 상황"]')?.focus();
  }
  /** 공유 카드는 늘 최종 곡선·마커 없음으로 찍히게, 대화상자를 열기 전에 재생을 처음 상태로 되돌린다 */
  async function share() {
    replay?.reset();
    await tick();
    onShare?.();
  }
  // 건너뜀 수·이유: 목록이 없으면(개수만 받은 공유) summary와 받은 개수로 센다
  const skipN = $derived(skippedCounts ? sum.skippedSignals : result.skipped.length);
  const skipList = $derived(
    skippedCounts ? skippedCounts.filter(([, n]) => n > 0).map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n) : skipCounts(result.skipped),
  );
  // 가장 많은 이유가 현금·금액이면 기간·자금을 고치라고 안내하고 그 구역을 연다
  const cashIssue = $derived.by(() => {
    const top = skipList[0]?.reason ?? null;
    return top === '현금 부족' || top === '1주가 1회 금액보다 비쌈';
  });
  let equityChart = $state<ReturnType<typeof EquityChart>>();
  let root = $state<HTMLElement>();
  /** 지금 보이는 수익 곡선으로 카드를 만든다. 거래 0건이라 곡선이 없으면 null(설계 4.1) */
  export function capture(): CardCapture | null {
    if (result.trades.length === 0 || !root) return null;
    const chart = equityChart?.screenshot();
    if (!chart) return null;
    const cs = getComputedStyle(document.documentElement);
    const swatches = Object.fromEntries(EQUITY_LINES.map((l) => [l.key, cs.getPropertyValue(l.color[0]).trim() || l.color[1]]));
    const text = simResultCardText(done, swatches);
    return { canvas: composeCard(chart, text, readCardColors(root)), alt: cardAlt(text, '시뮬레이션 결과'), line: null };
  }
</script>

<section bind:this={root} class="result" class:stale aria-label="시뮬레이션 결과">
  <p class="head">
    {#if stale}<Badge tone="nxt">이전 결과</Badge>{/if}
    <span>{resultHeadline(meta.from, meta.to, meta.venueLabel, meta.fetchedAt, meta.strategy.period.from)}</span>
    {#if meta.demo}<Badge>데모 데이터</Badge>{/if}
    {#if onShare}<button type="button" class="share" onclick={share}>결과 공유</button>{/if}
  </p>

  {#if noTrades}
    <div class="empty">
      {#if skipN === 0}
        <p class="big">기간 동안 매수 신호가 한 번도 나지 않았어요</p>
        {#if result.nearMiss}<p>{nearMissText(result.nearMiss, meta.strategy)}</p>{/if}
      {:else}
        <p class="big">매수 신호가 {skipN}번 났지만 한 번도 사지 못했어요</p>
        <ul class="why-list" aria-label="건너뛴 이유">
          {#each skipList as c (c.reason)}
            <li>{skipReasonLabel(c.reason)} <span class="num">{c.n}번</span></li>
          {/each}
        </ul>
        {#if !readonly && cashIssue}<p>기간·자금에서 회당 비중이나 처음 자금을 늘려 보세요</p>{/if}
      {/if}
      {#if !readonly && onEdit}
        <button type="button" class="fix" onclick={() => (cashIssue ? onEdit('capital') : onEdit())}>규칙 고치기</button>
      {/if}
      {#if skippedCounts}
        <p>{skipN > 0 ? '목록은 크기 때문에 빼고 보냈어요' : '건너뛴 신호가 없어요'}</p>
      {/if}
    </div>
    {#if !skippedCounts && skipN > 0}
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
    {#if fewTrades}<p class="few">{FEW_TRADES_TEXT}</p>{/if}

    {#key result}
      <EquityChart bind:this={equityChart}
        equity={result.equity}
        initial={meta.strategy.capital.initial}
        labels={{ benchmark: benchName, index: meta.strategy.benchmarks.index }}
        {theme}
        {sampledNote}
        {upTo}
        trades={result.trades}
      />
    {/key}

    {#if canReplay && replay}
      <ReplayBar {replay} {dates} />
      {#if replay.touched && frame}
        <DayPanel {frame} trades={dayTrades} skipped={daySkipped} names={meta.names} initial={meta.strategy.capital.initial} strategy={meta.strategy} {motion} />
      {:else}
        <button type="button" class="open-day" onclick={openDay}>그날 상황 보기</button>
      {/if}
    {/if}

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
        { value: 'skipped', label: `건너뛴 신호 ${skipN}` },
      ]}
    />
    <div class="tab">
      {#if tab === 'trades'}
        <TradeList trades={result.trades} names={meta.names} onTrade={readonly ? undefined : pick} hideQty={hideAmounts} />
      {:else if tab === 'symbols'}
        <SymbolTab perSymbol={result.perSymbol} axisFrom={meta.from} failed={meta.failed} {colorConvention} pnlPct={hideAmounts ? (pnlPct ?? {}) : undefined} />
      {:else}
        <SkipList skipped={result.skipped} names={meta.names} counts={skippedCounts} />
      {/if}
    </div>
  {/if}

  {#if !readonly}
    <TradeChartSheet
      open={picked !== null}
      trade={picked}
      trades={result.trades}
      candles={picked ? (meta.candles[picked.symbol] ?? []) : []}
      name={picked ? (meta.names[picked.symbol] ?? picked.symbol) : ''}
      level={breakout.on ? breakout.level : null}
      onclose={() => (picked = null)}
    />
  {/if}

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
  /* 지난 실행의 결과: 투명도 대신 왼쪽 강조선(글자 대비·거래 차트 시트는 그대로) */
  .result.stale {
    border-left: 3px solid var(--accent); /* impeccable-disable-line side-tab -- 지난 실행 결과 표시(투명도 대신 고른 강조선) */
  }
  .share {
    margin-left: auto;
    min-height: var(--touch);
    padding: 0 12px;
    border-radius: 12px;
    background: var(--surface2);
    font-weight: 700;
  }
  .few {
    margin: 0;
    font-size: var(--fs-sub);
    color: var(--warn);
  }
  .open-day {
    align-self: flex-start;
    min-height: var(--touch);
    padding: 0 12px;
    border-radius: 12px;
    background: var(--surface2);
    font-weight: 700;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    margin: 0;
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  .head :global(.badge) {
    margin: 0;
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
     카드가 컨테이너일 때(@container)만 카드 폭(cqi)을 쓰고, 아니면 화면 폭으로 카드 안쪽을 어림한다:
     한 칸 화면 (100vw − 2×gutter − 칸 사이 8px) ÷ 2 − 카드 여백 24px, PC 좌우 화면(≥1024)은 레일 240px·칸 사이 16px을 빼고 반의 반.
     어림 경로는 --fs-title 아래로 줄이지 않는다. 숫자는 자르지 않는다(말줄임·강제 줄바꿈 없음) */
  .value.main {
    --card-inner: calc(50vw - var(--gutter) - 28px);
    white-space: nowrap;
    max-width: 100%;
    font-size: max(var(--fs-title), min(var(--fs-headline), calc(var(--card-inner) / (var(--chars) * 0.66))));
  }
  @media (min-width: 1024px) {
    .value.main {
      --card-inner: calc((min(100vw, 1600px) - 256px) / 4 - var(--gutter) - 28px);
    }
  }
  @container (min-width: 0px) {
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
