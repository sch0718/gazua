<script lang="ts">
  // 결과 자리(스펙 7.5): 안내(idle) · 받는 중 · 일부 실패 · 연결 오류 · 데이터 없음 · 엔진 예외 · 결과(규칙이 바뀌면 배너).
  import type { ErrorActionTarget } from '../../providers/errors';
  import type { Trade } from '../../sim/types';
  import type { Issue } from '../../sim/validate';
  import { connectionIssue, META_ERROR } from '../compare/loadIssue';
  import Banner from '../components/Banner.svelte';
  import ResultView from './ResultView.svelte';
  import type { RunState } from './runController.svelte';

  // 'state' 이름은 $state 룬과 겹쳐서 run으로 받는다.
  let {
    state: run,
    colorConvention,
    stale = false,
    onEdit,
    onRetry,
    onCancel,
    onTrade,
    onIssueAction,
  }: {
    state: RunState;
    colorConvention: 'kr' | 'global';
    /** 결과를 낸 뒤 규칙이 바뀌었다(넓은 화면). 배너를 보이고 본문을 흐리게 한다 */
    stale?: boolean;
    /** 편집으로 돌아간다. section이 있으면 그 구역을 연다 */
    onEdit: (section?: Issue['section']) => void;
    onRetry: () => void;
    onCancel: () => void;
    onTrade: (t: Trade) => void;
    onIssueAction: (target: ErrorActionTarget) => void;
  } = $props();

  const names = (list: { symbol: string; name?: string }[]) => list.map((f) => f.name ?? f.symbol).join(', ');
  const NO_DATA = '기간 안에 데이터가 없어요';
</script>

{#if run.kind === 'done'}
  {#if stale}
    <Banner
      tone="info"
      message="규칙이 바뀌었어요. 다시 실행하면 결과에 반영돼요"
      actionLabel="다시 실행"
      onaction={onRetry}
    />
  {/if}
  <div class:dim={stale}>
    <ResultView state={run} {colorConvention} {onEdit} {onTrade} />
  </div>
{:else if run.kind === 'idle'}
  <p class="hint">규칙을 정하고 시뮬레이션 실행을 누르면 여기에 결과가 나와요</p>
{:else}
  <section class="panel" aria-label="시뮬레이션 결과">
    {#if run.kind === 'loading'}
      {@const p = run.progress}
      {@const sc = run.scope}
      <!-- total이 0이면 아직 몇 개인지 모르니 숫자 없이 보인다 -->
      <div
        class="bar"
        role="progressbar"
        aria-label="일봉 받는 중"
        aria-valuemin={p.total ? 0 : undefined}
        aria-valuemax={p.total || undefined}
        aria-valuenow={p.total ? p.done : undefined}
      >
        <i style:width="{p.total ? (p.done / p.total) * 100 : 0}%"></i>
      </div>
      <p role="status">{p.total ? `일봉 받는 중 ${p.done}/${p.total}` : '일봉 받는 중'}{p.waiting ? ' · 잠시 대기 중' : ''}</p>
      <p class="sub">종목 {sc.stocks}개 · 지수{sc.benchmark ? ' · 비교 기준' : ''}</p>
      <div class="actions"><button type="button" onclick={onCancel}>취소</button></div>
    {:else if run.kind === 'partial'}
      {@const noData = run.failed.filter((f) => f.reason === NO_DATA)}
      {@const noFetch = run.failed.filter((f) => f.reason !== NO_DATA)}
      {#if noFetch.length}
        <p>{names(noFetch)} 일봉을 받지 못했어요{noData.length ? '' : '. 빼고 계속할까요?'}</p>
      {/if}
      {#if noData.length}
        <p>{names(noData)}은(는) 이 기간에 데이터가 없어요. 빼고 계속할까요?</p>
      {/if}
      <div class="actions">
        <button type="button" class="primary" onclick={run.proceed}>빼고 계속</button>
        <button type="button" onclick={onCancel}>취소</button>
      </div>
    {:else if run.kind === 'error'}
      {@const issue = connectionIssue(run.error, run.text ?? META_ERROR)}
      <Banner tone="error" message={issue.text} actionLabel={issue.action.label} onaction={() => onIssueAction(issue.action.target)} />
      <div class="actions"><button type="button" onclick={onRetry}>다시 시도</button></div>
    {:else if run.kind === 'noData'}
      <p>기간 안에 받은 데이터가 없어요</p>
      {#if run.failed.length}
        <ul class="failed">
          {#each run.failed as f (f.symbol)}
            <li>{f.name ?? f.symbol} ({f.reason})</li>
          {/each}
        </ul>
      {/if}
      <div class="actions"><button type="button" class="primary" onclick={() => onEdit()}>규칙 고치기</button></div>
    {:else}
      <p>계산 중 문제가 생겼어요</p>
      <div class="actions"><button type="button" class="primary" onclick={onRetry}>다시 실행</button></div>
    {/if}
  </section>
{/if}

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 24px 16px;
    color: var(--t2);
  }
  p {
    margin: 0;
  }
  .hint {
    margin: 0;
    padding: 24px 16px;
    color: var(--t2);
    text-align: center;
  }
  .sub {
    font-size: var(--fs-sub);
    color: var(--t3);
  }
  .dim {
    opacity: 0.5;
  }
  .bar {
    height: 6px;
    border-radius: 3px;
    background: var(--line);
    overflow: hidden;
  }
  .bar i {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width var(--dur-fast) var(--ease);
  }
  .failed {
    margin: 0;
    padding-left: 18px;
    font-size: 13px;
  }
  .actions {
    display: flex;
    gap: 8px;
  }
  .actions button {
    min-height: 44px;
    padding: 0 16px;
    border-radius: 12px;
    background: var(--surface2);
    color: var(--t1);
    font-weight: 700;
  }
  .actions .primary {
    background: var(--accent);
    color: var(--on-accent);
  }
</style>
