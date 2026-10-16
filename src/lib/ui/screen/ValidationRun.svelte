<script lang="ts">
  // 검증 실행 중과 실패(스펙 7.4·8.2): 진행 `재선정일 계산 중 14/48`을 role=status로 알리고 취소를 둔다.
  // 계산이 NaN·Infinity 등으로 실패하면 결과 대신 실패 화면을 보인다.
  import type { WorkerErrorCode } from '../../screen/runValidation';
  import { FAILURE_TEXT } from './screenText';

  let {
    running,
    progress,
    error = null,
    oncancel,
    onfix,
  }: {
    running: boolean;
    progress: { done: number; total: number };
    error?: WorkerErrorCode | null;
    oncancel: () => void;
    /** 실패 화면의 `기준 고치기` */
    onfix: () => void;
  } = $props();

  // total이 0이면 아직 몇 개인지 모르니 숫자 없이
  const text = $derived(progress.total ? `재선정일 계산 중 ${progress.done}/${progress.total}` : '재선정일 계산 중');
</script>

{#if error}
  <section class="fail" aria-label="검증 실패">
    <p role="alert">{FAILURE_TEXT[error]}</p>
    <button type="button" class="btn" onclick={onfix}>기준 고치기</button>
  </section>
{:else if running}
  <section class="run" aria-label="검증 진행">
    <div
      class="bar"
      role="progressbar"
      aria-label="재선정일 계산"
      aria-valuemin={progress.total ? 0 : undefined}
      aria-valuemax={progress.total || undefined}
      aria-valuenow={progress.total ? progress.done : undefined}
    >
      <i style:width="{progress.total ? (progress.done / progress.total) * 100 : 0}%"></i>
    </div>
    <p role="status">{text}</p>
    <button type="button" class="btn" onclick={oncancel}>취소</button>
  </section>
{/if}

<style>
  .run,
  .fail {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 24px 0;
    color: var(--t2);
  }
  p {
    margin: 0;
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
  .btn {
    align-self: flex-start;
    min-height: var(--touch);
    padding: 0 20px;
    border-radius: 12px;
    background: var(--surface2);
    color: var(--t1);
    font-weight: 700;
  }
</style>
