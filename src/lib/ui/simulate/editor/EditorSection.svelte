<script lang="ts">
  // 접고 펼치는 구역 하나: 머리(제목 + 한 줄 요약)와, 펼쳤을 때 이 구역의 경고(Banner) + 본문.
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
  <button type="button" class="head" aria-expanded={open} aria-controls={bodyId} onclick={ontoggle}>
    <b>{title}</b>
    <span class="sum">{summary}</span>
    {#if issues.length}<span class="flag" class:blocked aria-hidden="true">!</span>{/if}
    <span class="chev" aria-hidden="true">{open ? '⌃' : '⌄'}</span>
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
    width: 100%;
    min-height: 56px;
    display: grid;
    grid-template-columns: auto 1fr auto auto;
    align-items: center;
    gap: 12px;
    padding: 8px 16px;
    text-align: left;
  }
  b {
    font-size: var(--fs-body);
    font-weight: 700;
    white-space: nowrap;
  }
  .sum {
    font-size: var(--fs-sub);
    color: var(--t2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: right;
  }
  .chev {
    color: var(--t3);
  }
  .flag {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 12px;
    font-weight: 800;
    background: var(--warn);
    color: var(--surface);
  }
  .flag.blocked {
    background: var(--err);
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
    gap: 8px;
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
  .body :global(.act.danger) {
    color: var(--down);
  }
</style>
