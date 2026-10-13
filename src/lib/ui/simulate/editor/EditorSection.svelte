<script lang="ts">
  // 접고 펼치는 구역 하나: 머리(제목 / 두 줄까지의 요약, 경고 표시, 셰브런)와, 펼쳤을 때 이 구역의 경고(Banner) + 본문.
  import type { Snippet } from 'svelte';
  import type { Issue } from '../../../sim/validate';
  import Banner from '../../components/Banner.svelte';

  let {
    title,
    summary,
    open,
    ontoggle,
    issues = [],
    children,
  }: {
    title: string;
    summary: string;
    open: boolean;
    ontoggle: () => void;
    /** id는 포커스를 옮길 때 쓰는 Banner의 id */
    issues?: { id: string; issue: Issue }[];
    children: Snippet;
  } = $props();

  const bodyId = `sec-${Math.random().toString(36).slice(2, 9)}`;
  const blocked = $derived(issues.some((x) => x.issue.blocking));
</script>

<section class="sec" class:open>
  <!-- 접혀 있으면 본문이 없으므로 aria-controls를 두지 않는다 -->
  <button type="button" class="head" aria-expanded={open} aria-controls={open ? bodyId : undefined} onclick={ontoggle}>
    <span class="txt">
      <b>{title}</b>
      <span class="sum num">{summary}</span>
    </span>
    {#if issues.length}
      <!-- 막는 경고 !(--err), 확인할 점 △(--warn): 색만으로 구분하지 않는다 -->
      <span class="flag" class:blocked aria-hidden="true">{blocked ? '!' : '△'}</span>
      <span class="sr-only">{blocked ? '· 고쳐야 실행돼요' : '· 확인할 점이 있어요'}</span>
    {/if}
    <span class="chev" class:open aria-hidden="true">▾</span>
  </button>
  {#if open}
    <div class="body" id={bodyId}>
      {#each issues as { id, issue } (id)}
        <Banner {id} message={issue.text} tone={issue.blocking ? 'error' : 'warn'} />
      {/each}
      {@render children()}
    </div>
  {/if}
</section>

<style>
  .sec {
    background: var(--surface);
    border-radius: var(--r-card);
    overflow: hidden;
  }
  .head {
    position: relative;
    width: 100%;
    min-height: 56px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    text-align: left;
  }
  .txt {
    grid-column: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  b {
    font-size: var(--fs-body);
    font-weight: 700;
  }
  .sum {
    font-size: var(--fs-sub);
    color: var(--t2);
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    word-break: keep-all;
    overflow-wrap: anywhere;
  }
  .flag {
    grid-column: 2;
    width: 20px;
    height: 20px;
    display: grid;
    place-items: center;
    font-size: 14px;
    font-weight: 800;
    line-height: 1;
    color: var(--warn);
  }
  .flag.blocked {
    border-radius: 50%;
    font-size: 12px;
    background: var(--err);
    color: var(--surface);
  }
  /* 경고 표시가 없어도 셰브런은 늘 마지막 칸에 */
  .chev {
    grid-column: -2 / -1;
    font-size: var(--fs-body);
    color: var(--t3);
    transition: transform var(--dur-base) var(--ease);
  }
  .chev.open {
    transform: rotate(180deg);
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 4px 16px 16px;
  }
  .body :global(.banner) {
    border-radius: 10px;
    justify-content: flex-start;
    text-align: left;
    padding: 8px 12px;
  }
  .body :global(.row) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  /* 토글만 있는 줄: 라벨 … [토글] (설정 화면과 같은 순서). 라벨을 누르면 토글이 바뀐다 */
  .body :global(.row > label) {
    flex: 1;
    min-width: 0;
    font-size: var(--fs-body);
    color: var(--t1);
    word-break: keep-all;
    cursor: pointer;
  }
  .body :global(.group-title) {
    margin: 4px 0 0;
    font-size: var(--fs-sub);
    font-weight: 700;
    color: var(--t2);
  }
  .body :global(.hint) {
    margin: 0;
    font-size: var(--fs-sub);
    color: var(--t3);
  }
  .body :global(.act) {
    min-height: var(--touch);
    padding: 0 14px;
    border-radius: 12px;
    background: var(--surface2);
    font-weight: 700;
    font-size: 14px;
  }
  /* 목록·단계에서 하나를 빼는 ✕ (종목 구역·익절 단계) */
  .body :global(.x) {
    width: var(--touch);
    height: var(--touch);
    flex: none;
    color: var(--t3);
  }
  /* 삭제는 앱 전체와 같이 --err (--down은 하락 뜻이라 쓰지 않는다) */
  .body :global(.act.danger) {
    color: var(--err);
  }
  .body :global(.x.danger) {
    color: var(--err);
  }
</style>
