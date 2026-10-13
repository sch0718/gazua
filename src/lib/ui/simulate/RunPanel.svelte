<script lang="ts">
  // 결과 자리(스펙 7.5): 안내(idle) · 받는 중 · 일부 실패 · 연결 오류 · 데이터 없음 · 엔진 예외 · 결과(규칙이 바뀌면 배너).
  // 상태가 바뀌면 늘 있는 라이브 영역 하나로 알리고(연결 오류는 Banner alert), 누른 버튼이 사라지면 포커스를 이 자리로 옮긴다.
  import { untrack } from 'svelte';
  import type { ErrorActionTarget } from '../../providers/errors';
  import type { SimFailure, SimFailureReason } from '../../sim/loadSimData';
  import type { Issue } from '../../sim/validate';
  import { connectionIssue, META_ERROR } from '../compare/loadIssue';
  import Banner from '../components/Banner.svelte';
  import ResultView from './ResultView.svelte';
  import type { RunState } from './runController.svelte';

  // 'state' 이름은 $state 룬과 겹쳐서 run으로 받는다.
  let {
    state: run,
    colorConvention,
    theme,
    stale = false,
    onEdit,
    onRetry,
    onCancel,
    onIssueAction,
  }: {
    state: RunState;
    colorConvention: 'kr' | 'global';
    /** 앱 테마(app.settings.theme). 결과 차트 색을 다시 읽는 신호 */
    theme?: string;
    /** 결과를 낸 뒤 규칙이 바뀌었다. 배너를 보이고 결과에 `이전 결과` 표시 */
    stale?: boolean;
    /** 편집으로 돌아간다. section이 있으면 그 구역을 연다 */
    onEdit: (section?: Issue['section']) => void;
    onRetry: () => void;
    onCancel: () => void;
    onIssueAction: (target: ErrorActionTarget) => void;
  } = $props();

  const names = (list: SimFailure[]) => list.map((f) => f.name ?? f.symbol).join(', ');
  // 일부 실패: 사유별 한 줄(일봉 · 종목 정보 · 기간 안 데이터 없음). 질문은 마지막 줄에만
  const PARTIAL_LINE: [SimFailureReason, (names: string) => string][] = [
    ['받지 못했어요', (n) => `${n} 일봉을 받지 못했어요`],
    ['종목 정보를 받지 못했어요', (n) => `${n} 종목 정보를 받지 못했어요`],
    ['기간 안에 데이터가 없어요', (n) => `${n}은(는) 이 기간에 데이터가 없어요`],
  ];
  function partialLines(failed: SimFailure[]): string[] {
    const lines = PARTIAL_LINE.flatMap(([reason, line]) => {
      const list = failed.filter((f) => f.reason === reason);
      return list.length ? [line(names(list))] : [];
    });
    return lines.map((l, i) => (i === lines.length - 1 ? `${l}. 빼고 계속할까요?` : l));
  }

  const NO_DATA_TEXT = '기간 안에 받은 데이터가 없어요';
  const CRASH_TEXT = '계산 중 문제가 생겼어요';
  // 라이브 영역 글: 받는 중은 시작·대기만(n/m은 넣지 않는다), 끝나면 결과·질문·문구. 연결 오류는 Banner가 알린다
  const announce = $derived.by(() => {
    switch (run.kind) {
      case 'loading':
        return run.progress.waiting ? '일봉 받는 중 · 잠시 대기 중' : '일봉 받는 중';
      case 'done':
        return '결과가 나왔어요';
      case 'partial':
        return partialLines(run.failed).join(' ');
      case 'noData':
        return NO_DATA_TEXT;
      case 'crash':
        return CRASH_TEXT;
      default:
        return '';
    }
  });

  let root: HTMLDivElement;
  /** 결과 자리로 포커스(좁은 화면에서 실행을 시작해 편집기가 내려갈 때) */
  export function focus() {
    root?.focus();
  }
  // 상태가 바뀌어 누른 버튼(다시 시도·다시 실행·빼고 계속·취소)이 사라졌으면 포커스를 결과 자리로.
  // 포커스가 패널 밖(편집기 등)에 있으면 건드리지 않는다. 처음 그릴 때는 옮기지 않는다
  let prevKind: RunState['kind'] | null = null;
  $effect(() => {
    const kind = run.kind;
    untrack(() => {
      if (prevKind !== null && prevKind !== kind) {
        const a = document.activeElement;
        if (!a || a === document.body || root.contains(a)) root.focus();
      }
      prevKind = kind;
    });
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="run-panel" bind:this={root} tabindex="-1">
  <p class="sr-only" role="status" data-live>{announce}</p>
  {#if run.kind === 'done'}
    {#if stale}
      <Banner
        tone="info"
        message="규칙이 바뀌었어요. 다시 실행하면 결과에 반영돼요"
        actionLabel="다시 실행"
        onaction={onRetry}
      />
    {/if}
    <ResultView state={run} {colorConvention} {theme} {stale} {onEdit} />
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
        <p>{p.total ? `일봉 받는 중 ${p.done}/${p.total}` : '일봉 받는 중'}{p.waiting ? ' · 잠시 대기 중' : ''}</p>
        <p class="sub">종목 {sc.stocks}개 · 지수{sc.benchmark ? ' · 비교 기준' : ''}</p>
        <div class="actions"><button type="button" onclick={onCancel}>취소</button></div>
      {:else if run.kind === 'partial'}
        {#each partialLines(run.failed) as line (line)}
          <p>{line}</p>
        {/each}
        <div class="actions">
          <button type="button" class="primary" onclick={run.proceed}>빼고 계속</button>
          <button type="button" onclick={onCancel}>취소</button>
        </div>
      {:else if run.kind === 'error'}
        {@const issue = connectionIssue(run.error, run.text ?? META_ERROR)}
        <Banner tone="error" message={issue.text} actionLabel={issue.action.label} onaction={() => onIssueAction(issue.action.target)} />
        <div class="actions"><button type="button" onclick={onRetry}>다시 시도</button></div>
      {:else if run.kind === 'noData'}
        <p>{NO_DATA_TEXT}</p>
        {#if run.failed.length}
          <ul class="failed">
            {#each run.failed as f (f.symbol)}
              <li>{f.name ?? f.symbol} ({f.reason})</li>
            {/each}
          </ul>
        {/if}
        <div class="actions"><button type="button" class="primary" onclick={() => onEdit()}>규칙 고치기</button></div>
      {:else}
        <p>{CRASH_TEXT}</p>
        <div class="actions"><button type="button" class="primary" onclick={onRetry}>다시 실행</button></div>
      {/if}
    </section>
  {/if}
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 24px var(--gutter);
    color: var(--t2);
  }
  p {
    margin: 0;
  }
  .hint {
    margin: 0;
    padding: 24px var(--gutter);
    color: var(--t2);
    text-align: center;
  }
  .sub {
    font-size: var(--fs-sub);
    color: var(--t3);
  }
  /* 코드로만 포커스를 받는 자리(Tab 정지점 아님): 테두리 없이 */
  .run-panel:focus {
    outline: none;
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
    font-size: var(--fs-sub);
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
