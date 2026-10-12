<script lang="ts">
  // 결과 자리(스펙 7.5): 받는 중 · 일부 실패 · 연결 오류 · 데이터 없음 · 엔진 예외 · 결과.
  import type { ErrorActionTarget } from '../../providers/errors';
  import type { Trade } from '../../sim/types';
  import { META_ERROR } from '../compare/compareController.svelte';
  import { connectionIssue } from '../compare/loadIssue';
  import Banner from '../components/Banner.svelte';
  import ResultView from './ResultView.svelte';
  import type { RunState } from './runController.svelte';

  // 'state' 이름은 $state 룬과 겹쳐서 run으로 받는다.
  let {
    state: run,
    colorConvention,
    onEdit,
    onRetry,
    onCancel,
    onTrade,
    onIssueAction,
  }: {
    state: RunState;
    colorConvention: 'kr' | 'global';
    onEdit: () => void;
    onRetry: () => void;
    onCancel: () => void;
    onTrade: (t: Trade) => void;
    onIssueAction: (target: ErrorActionTarget) => void;
  } = $props();

  const names = (list: { symbol: string; name?: string }[]) => list.map((f) => f.name ?? f.symbol).join(', ');
</script>

{#if run.kind === 'done'}
  <ResultView state={run} {colorConvention} {onEdit} {onTrade} />
{:else if run.kind !== 'idle'}
  <section class="panel" aria-label="시뮬레이션 결과">
    {#if run.kind === 'loading'}
      {@const p = run.progress}
      <div class="bar" role="progressbar" aria-label="일봉 받는 중" aria-valuemin={0} aria-valuemax={p.total} aria-valuenow={p.done}>
        <i style:width="{p.total ? (p.done / p.total) * 100 : 0}%"></i>
      </div>
      <p role="status">일봉 받는 중 {p.done}/{p.total}{p.waiting ? ' · 잠시 대기 중' : ''}</p>
      <div class="actions"><button type="button" onclick={onCancel}>취소</button></div>
    {:else if run.kind === 'partial'}
      <p>{names(run.failed)} 일봉을 받지 못했어요. 빼고 계속할까요?</p>
      <div class="actions">
        <button type="button" class="primary" onclick={run.proceed}>빼고 계속</button>
        <button type="button" onclick={onCancel}>취소</button>
      </div>
    {:else if run.kind === 'error'}
      {@const issue = connectionIssue(run.error, META_ERROR)}
      <Banner tone="error" message={issue.text} actionLabel={issue.action.label} onaction={() => onIssueAction(issue.action.target)} />
      <div class="actions"><button type="button" onclick={onRetry}>다시 실행</button></div>
    {:else if run.kind === 'noData'}
      <p>기간 안에 받은 데이터가 없어요</p>
      {#if run.failed.length}
        <ul class="failed">
          {#each run.failed as f (f.symbol)}
            <li>{f.name ?? f.symbol} ({f.reason})</li>
          {/each}
        </ul>
      {/if}
      <div class="actions"><button type="button" class="primary" onclick={onEdit}>규칙 고치기</button></div>
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
  .bar {
    height: 6px;
    border-radius: 3px;
    background: var(--surface2);
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
