<script lang="ts">
  // 내 성과(스펙 4장): 토스 계좌의 체결 주문을 같은 날 같은 금액으로 벤치마크를 산 경우와 비교한다.
  import { onDestroy, untrack, type Snippet } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { benchLabel, benchOfFor } from '../lib/perf/compose';
  import { buildTimeline } from '../lib/perf/portfolio';
  import { BENCH_CHOICES, type BenchChoice, type SideSummary } from '../lib/perf/types';
  import { periodRanges, viewOf } from '../lib/perf/view';
  import type { App } from '../lib/state/app.svelte';
  import { kstHHMM } from '../lib/ui/compare/compareText';
  import { Badge } from '@sch0718/ui-svelte';
  import { fmtWon } from '../lib/ui/format';
  import Layout from '../lib/ui/Layout.svelte';
  import ContributionTable from '../lib/ui/perf/ContributionTable.svelte';
  import PerfChart from '../lib/ui/perf/PerfChart.svelte';
  import { createPerfController } from '../lib/ui/perf/perfController.svelte';
  import { irrText, PERF_LIMITS, perfErrorText, periodText, ppText, RECONCILE_REASON, signClass, signedWon } from '../lib/ui/perf/perfText';
  import { dotDate } from '../lib/ui/simulate/simText';
  import Rail from '../lib/ui/Rail.svelte';

  let { app, barEnd, now = Date.now }: { app: App; barEnd: Snippet<[boolean]>; now?: () => number } = $props();

  const ctl = createPerfController(
    {
      get provider() {
        return app.provider;
      },
      get orderCache() {
        return app.orderCache;
      },
      get profileId() {
        return app.meta.activeProfileId;
      },
    },
    { now: untrack(() => now) },
  );
  onDestroy(() => ctl.cancel());

  // 폰 폭(<600)에서는 앱 바에 상태 칩을 그리지 않는다(제목과 아이콘 3개가 들어가야 한다). 시뮬레이션과 같다.
  const compactQuery = typeof matchMedia === 'function' ? new MediaQuery('max-width: 599px') : null;
  const compact = $derived(compactQuery?.current ?? false);

  /** 카드 아래 줄: `+60,218원 · 기간 +2.2%` */
  const subLine = (s: SideSummary) =>
    [signedWon(s.profit), periodText(s)].filter(Boolean).join(' · ');

  const choice = $derived<BenchChoice>(app.settings.perfBenchmark ?? app.settings.benchmark);
  let rangeId = $state('all');

  // 공급자·프로필이 바뀌면 다시 받는다
  $effect(() => {
    void app.provider;
    void app.meta.activeProfileId;
    untrack(() => {
      rangeId = 'all';
      ctl.load(choice);
    });
  });

  function setChoice(v: string) {
    const next = BENCH_CHOICES.find((c) => c.id === v)?.id;
    if (!next) return;
    app.updateSettings({ perfBenchmark: next });
  }

  const data = $derived(ctl.state.kind === 'done' ? ctl.state.data : null);
  const pending = $derived(data?.pendingBench ?? null);
  // 고른 벤치마크의 시리즈가 없으면 받는다. 다른 시리즈를 받는 중이면 끝난 뒤 다시 돈다(useBench는 있으면 아무것도 안 한다)
  $effect(() => {
    const c = choice;
    if (data && pending === null) untrack(() => ctl.useBench(c));
  });
  const timeline = $derived(
    data && pending === null ? buildTimeline(data.trades, data.stocks, benchOfFor(choice, data.metas, data.series), { names: data.names }) : null,
  );
  const ranges = $derived(timeline ? periodRanges(timeline.days) : []);
  const range = $derived(ranges.find((r) => r.id === rangeId) ?? ranges[0] ?? null);
  const view = $derived(timeline && range ? viewOf(timeline, range.a, range.b) : null);
  const benchName = $derived(benchLabel(choice));
  const failedNames = $derived((data?.failedBench ?? []).filter((b) => (choice === 'AUTO' ? b === 'KOSPI' || b === 'KOSDAQ' : b === choice)).map((b) => benchLabel(b as BenchChoice)));
  const uncompared = $derived(view?.rows.reduce((n, r) => n + r.uncompared, 0) ?? 0);
  const mismatched = $derived(
    data ? [...data.reconcile.bySymbol].flatMap(([symbol, r]) => (r.status === 'more' || r.status === 'less' ? [{ symbol, ...r, status: r.status }] : [])) : [],
  );
</script>

<Layout>
  {#snippet rail()}
    <Rail {app} />
  {/snippet}

  {#snippet bar()}
    <button type="button" class="back" aria-label="비교로 돌아가기" onclick={() => app.navigate({ name: 'compare' })}>‹</button>
    <span class="title">내 성과</span>
    {@render barEnd(compact)}
  {/snippet}

  {#snippet main()}
    <div class="perf">
      {#if ctl.state.kind === 'unsupported'}
        <section class="empty">
          <h2>내 성과는 토스증권 계좌에서 볼 수 있어요</h2>
          <p>설정에서 데이터 공급자를 토스로 바꾸고 프록시와 키를 넣어 주세요.</p>
          <button type="button" class="primary" onclick={() => app.navigate({ name: 'settings' })}>설정 열기</button>
        </section>
      {:else if ctl.state.kind === 'error'}
        <section class="empty" role="alert">
          <h2>{perfErrorText(ctl.state.error)}</h2>
          <button type="button" class="primary" onclick={() => ctl.load(choice)}>다시 시도</button>
        </section>
      {:else if ctl.state.kind === 'empty'}
        <section class="empty">
          <h2>체결된 국내 주문이 없어요</h2>
          {#if ctl.state.foreign > 0}<p>해외 주문 {ctl.state.foreign}건은 뺐어요.</p>{/if}
        </section>
      {:else if !data}
        <p class="status" role="status">
          {#if ctl.state.kind === 'loading' && ctl.state.stage === 'prices'}
            시세를 받는 중 · {ctl.state.done}/{ctl.state.total}
          {:else if ctl.state.kind === 'loading'}
            주문 내역을 받는 중 · {fmtWon(ctl.state.rows)}건
          {:else}
            불러오는 중
          {/if}
        </p>
      {:else}
        <div class="controls">
          <label class="ctl">
            <span>벤치마크</span>
            <select class="pick" value={choice} onchange={(e) => setChoice(e.currentTarget.value)}>
              {#each BENCH_CHOICES as c (c.id)}
                <option value={c.id}>{c.label}</option>
              {/each}
            </select>
          </label>
          <label class="ctl">
            <span>기간</span>
            <select class="pick" value={range?.id ?? 'all'} onchange={(e) => (rangeId = e.currentTarget.value)} disabled={ranges.length === 0}>
              {#each ranges as r (r.id)}
                <option value={r.id}>{r.label}</option>
              {/each}
            </select>
          </label>
        </div>
        <p class="meta">
          {#if data.demo}<Badge>데모 계좌예요</Badge>{/if}
          {#if view}<span>{dotDate(view.from)} ~ {dotDate(view.to)}</span>{/if}
          {#if !data.demo}
            <span>마지막으로 받은 때 {kstHHMM(data.syncedAt)}</span>
            <button type="button" class="link" onclick={() => ctl.load(choice, { full: true })}>처음부터 다시 받기</button>
          {/if}
        </p>

        {#if pending}
          <p class="status" role="status">{benchLabel(pending as BenchChoice)} 시세를 받는 중이에요</p>
        {:else if view}
          <section class="cards" aria-label="요약">
            <div class="card">
              <h3>내 IRR</h3>
              <p class="big num {signClass(view.actual.irr)}">{irrText(view.actual.irr)}</p>
              <p class="sub num">{subLine(view.actual)}</p>
            </div>
            <div class="card">
              <h3>{benchName} IRR</h3>
              <p class="big num {signClass(view.virtual.irr)}">{irrText(view.virtual.irr)}</p>
              <p class="sub num">{subLine(view.virtual)}</p>
            </div>
            <div class="card">
              <h3>초과</h3>
              <p class="big num {signClass(view.excessIrrPp)}">{ppText(view.excessIrrPp)}</p>
              <p class="sub num {signClass(view.excessProfit)}">{signedWon(view.excessProfit)}</p>
            </div>
          </section>

          <div class="split">
            <section class="pane" aria-labelledby="perf-chart-h">
              <h2 id="perf-chart-h">평가금액 + 회수액</h2>
              <PerfChart curve={view.curve} {benchName} theme={app.settings.theme} />
            </section>
            <section class="pane" aria-labelledby="perf-rows-h">
              <h2 id="perf-rows-h">종목별 기여도</h2>
              <ContributionTable rows={view.rows} reconcile={data.reconcile} />
            </section>
          </div>
        {/if}

        <section class="notes" aria-label="안내">
          {#if mismatched.length > 0 || data.reconcile.unrecorded.length > 0}
            <h2>수량이 맞지 않는 종목</h2>
            <ul>
              {#each mismatched as m (m.symbol)}
                <li>{data.names.get(m.symbol) ?? m.symbol}: 주문 합계 {fmtWon(m.computed)}주, 보유 {fmtWon(m.held ?? 0)}주 · {RECONCILE_REASON[m.status]}</li>
              {/each}
              {#each data.reconcile.unrecorded as h (h.symbol)}
                <li>{h.name}: 주문 기록 없이 {fmtWon(h.quantity)}주 보유 · 계산에 넣지 않았어요</li>
              {/each}
            </ul>
          {/if}
          {#if timeline && timeline.missing.length > 0}
            <p>시세를 받지 못해 뺀 종목: {timeline.missing.map((m) => m.name).join(', ')}</p>
          {/if}
          {#if data.estimatedSplits.length > 0}
            <p>일부 체결일의 시세가 없어 분할 배율을 체결가로 추정했어요: {data.estimatedSplits.map((s) => data.names.get(s) ?? s).join(', ')}</p>
          {/if}
          {#if view?.rows.some((row) => row.splitAdjusted)}
            <p>분할 배율은 시세로 계산해요. 가격 반올림 때문에 수량과 수익률에 오차가 있을 수 있어요.</p>
          {/if}
          {#if failedNames.length > 0}
            <p>{failedNames.join(', ')} 시세를 받지 못해 비교하지 못했어요</p>
          {/if}
          {#if uncompared > 0}
            <p>벤치마크와 비교 못 한 거래 {uncompared}건은 벤치마크 쪽에서 뺐어요</p>
          {/if}
          {#if data.foreign > 0}
            <p>해외 주문 {data.foreign}건은 뺐어요</p>
          {/if}
          <p class="limits">{PERF_LIMITS}</p>
        </section>
      {/if}
    </div>
  {/snippet}
</Layout>

<style>
  .back {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    font-size: 24px;
    color: var(--t2);
    flex: none;
  }
  .back:hover {
    background: var(--surface2);
  }
  .title {
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1 1 auto;
    min-width: 0;
  }
  .perf {
    padding: 4px var(--gutter) 24px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .empty {
    padding: 32px 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
    align-items: flex-start;
  }
  .empty h2 {
    font-size: var(--fs-title);
    margin: 0;
  }
  .empty p {
    margin: 0;
    color: var(--t2);
  }
  .primary {
    min-height: var(--touch);
    padding: 0 16px;
    border-radius: 12px;
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
  }
  .status {
    color: var(--t2);
    margin: 16px 0;
  }
  .controls {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .ctl {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: var(--fs-sub);
    color: var(--t3);
    min-width: 0;
  }
  .pick {
    width: 100%;
    min-width: 0;
    min-height: var(--touch);
    padding: 0 10px;
    border-radius: 10px;
    border: 1px solid transparent;
    background: var(--surface2);
    color: var(--t1);
    font: inherit;
    font-size: 16px;
  }
  .pick:focus {
    border-color: var(--accent);
    outline: none;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
    align-items: center;
    margin: 0;
    color: var(--t3);
    font-size: var(--fs-sub);
  }
  .link {
    min-height: var(--touch);
    padding: 0 6px;
    color: var(--accent);
    font-size: var(--fs-sub);
    text-decoration: underline;
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-card);
    padding: 10px 12px;
    min-width: 0;
  }
  .card h3 {
    margin: 0;
    font-size: var(--fs-sub);
    font-weight: 500;
    color: var(--t3);
    overflow-wrap: anywhere;
  }
  .card .big {
    margin: 4px 0 2px;
    /* 폰의 세 칸에서도 `+10.3%p`가 한 줄에 들어가게 폭에 맞춰 줄인다 */
    font-size: clamp(15px, 4.4vw, 20px);
    font-weight: 700;
    white-space: nowrap;
  }
  .card .sub {
    margin: 0;
    font-size: var(--fs-sub);
    color: var(--t2);
    overflow-wrap: anywhere;
  }
  .num {
    font-variant-numeric: tabular-nums;
  }
  .up {
    color: var(--up);
  }
  .down {
    color: var(--down);
  }
  .card .sub.up {
    color: var(--up);
  }
  .card .sub.down {
    color: var(--down);
  }
  .split {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .pane h2,
  .notes h2 {
    font-size: var(--fs-body);
    margin: 0 0 8px;
  }
  .notes {
    color: var(--t2);
    font-size: var(--fs-sub);
  }
  .notes p,
  .notes ul {
    margin: 0 0 6px;
  }
  .notes ul {
    padding-left: 18px;
  }
  .limits {
    color: var(--t3);
  }
  @media (max-width: 359px) {
    .cards {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  @media (min-width: 1024px) {
    .perf {
      padding: 8px 24px 24px;
    }
    .split {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      align-items: start;
    }
  }
</style>
