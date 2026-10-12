<script lang="ts">
  import type { Group } from '../../state/schema';

  // 앱 바의 그룹 탭(가로 스크롤) + 새 그룹 + 그룹 관리. ≥1024에서는 레일이 그룹을 보여 주므로 숨긴다.
  let {
    groups,
    currentId,
    onselect,
    onadd,
    onmanage,
  }: {
    groups: Group[];
    currentId: string | undefined;
    onselect: (id: string) => void;
    onadd: () => void;
    onmanage: () => void;
  } = $props();
</script>

<div class="tabs">
  <!-- tablist의 자식은 tab뿐이어야 하므로(aria-required-children) 새 그룹·그룹 관리 버튼은 바깥에 둔다. -->
  <div class="list" role="tablist" aria-label="관심 그룹">
    {#each groups as g (g.id)}
      <button
        type="button"
        role="tab"
        class="tab"
        class:on={g.id === currentId}
        aria-selected={g.id === currentId}
        onclick={() => onselect(g.id)}
      >
        {g.name}
      </button>
    {/each}
  </div>
  <button type="button" class="tab add" aria-label="새 그룹" onclick={onadd}>＋</button>
  <button type="button" class="tab add" aria-label="그룹 관리" aria-haspopup="dialog" onclick={onmanage}>⋯</button>
</div>

<style>
  .tabs {
    display: flex;
    gap: 2px;
    overflow-x: auto;
    scrollbar-width: none;
    min-width: 0;
    flex: 1 1 auto;
  }
  .tabs::-webkit-scrollbar {
    display: none;
  }
  .list {
    display: flex;
    gap: 2px;
  }
  .tab {
    font-size: 18px;
    font-weight: 700;
    color: var(--t3);
    padding: 0 8px;
    min-height: var(--touch);
    white-space: nowrap;
    letter-spacing: -0.01em;
    border-radius: 10px;
  }
  .tab.on {
    color: var(--t1);
  }
  .tab.add {
    min-width: var(--touch);
    font-weight: 500;
  }
  @media (min-width: 1024px) {
    .tabs {
      display: none;
    }
  }
</style>
