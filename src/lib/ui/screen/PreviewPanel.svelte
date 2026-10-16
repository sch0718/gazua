<script lang="ts">
  // 오늘 기준 미리 보기(스펙 7.3): 데이터 마지막 날 기준 통과 수와 뽑힌 종목 이름.
  import type { Selection } from '../../screen/select';

  let {
    hasData,
    asOf,
    selection,
    pending,
    failed,
    names,
  }: {
    hasData: boolean;
    /** 데이터 마지막 날 */
    asOf: string | null;
    selection: Selection | null;
    /** 새로 계산하는 중(이전 결과는 그대로 보인다) */
    pending: boolean;
    failed: boolean;
    names: Record<string, string>;
  } = $props();

  const titleId = `preview-${Math.random().toString(36).slice(2, 9)}`;
</script>

<section class="preview" aria-labelledby={titleId}>
  <h3 id={titleId}>오늘 기준 미리 보기</h3>
  {#if !hasData}
    <p class="muted">시장 데이터를 가져오면 미리 볼 수 있어요</p>
  {:else}
    {#if asOf}<p class="muted">{asOf} 기준</p>{/if}
    <p class="state" role="status">{pending ? '계산하는 중이에요' : ''}</p>
    {#if failed}
      <p class="err">미리 보기를 계산하지 못했어요</p>
    {:else if selection}
      <p class="count">통과 {selection.passed}개 · 상위 {selection.picked.length}개</p>
      <ol>
        {#each selection.picked as p (p.symbol)}
          <li><span class="n">{names[p.symbol] ?? p.symbol}</span><span class="c num">{p.symbol}</span></li>
        {/each}
      </ol>
    {/if}
  {/if}
</section>

<style>
  .preview {
    background: var(--surface);
    border-radius: var(--r-card);
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  h3 {
    margin: 0;
    font-size: var(--fs-body);
    font-weight: 700;
  }
  p {
    margin: 0;
  }
  .muted,
  .state {
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  /* 비어 있어도 라이브 영역은 남기고(알림이 읽히도록) 자리는 차지하지 않게 한다 */
  .state:empty {
    margin-top: -6px;
  }
  .count {
    font-weight: 700;
  }
  .err {
    color: var(--err);
    font-size: var(--fs-sub);
  }
  ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  li {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    min-height: 32px;
    align-items: center;
    font-size: var(--fs-sub);
  }
  .c {
    color: var(--t3);
  }
</style>
