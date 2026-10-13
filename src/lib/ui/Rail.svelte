<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { App } from '../state/app.svelte';

  // PC 레일(≥1024, 스펙 7.6): 프로필 · 관심 그룹 · (화면별 내용) · 설정.
  // 화면별 내용(children)도 `ritem`·`rlabel` 클래스로 같은 모양을 쓴다.
  let { app, children }: { app: App; children?: Snippet } = $props();

  const route = $derived(app.route);
  const profile = $derived(app.meta.profiles.find((p) => p.id === app.meta.activeProfileId));
</script>

<div class="rail-body">
  <div class="brand"><i aria-hidden="true"></i>가즈아</div>
  {#if app.meta.profiles.length > 1}
    <button type="button" class="ritem" onclick={() => app.navigate({ name: 'profiles' })}>
      {profile?.name}<em>▾</em>
    </button>
  {:else}
    <div class="ritem static">{profile?.name}</div>
  {/if}
  <div class="rlabel">관심 그룹</div>
  {#each app.watchlists.groups as g (g.id)}
    <button
      type="button"
      class="ritem"
      class:on={route.name === 'compare' && route.groupId === g.id}
      aria-current={route.name === 'compare' && route.groupId === g.id ? 'page' : undefined}
      onclick={() => app.navigate({ name: 'compare', groupId: g.id })}
    >
      {g.name}<em>{g.items.length}</em>
    </button>
  {/each}
  {@render children?.()}
  <button
    type="button"
    class="ritem sim-item"
    class:on={route.name === 'simulate'}
    aria-current={route.name === 'simulate' ? 'page' : undefined}
    onclick={() => app.navigate({ name: 'simulate' })}
  >
    시뮬레이션
  </button>
  <button
    type="button"
    class="ritem"
    class:on={route.name === 'settings'}
    onclick={() => app.navigate({ name: 'settings' })}
  >
    설정
  </button>
</div>

<style>
  .rail-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
  }
  .brand {
    font-weight: 800;
    font-size: 19px;
    padding: 4px 10px 14px;
    letter-spacing: -0.02em;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .brand i {
    width: 24px;
    height: 24px;
    border-radius: 8px;
    background: linear-gradient(135deg, var(--s1), var(--s3));
    display: block;
  }
  .rail-body :global(.ritem) {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 10px;
    min-height: var(--touch);
    border-radius: 10px;
    font-size: 14px;
    color: var(--t2);
    text-align: left;
    width: 100%;
  }
  .rail-body :global(button.ritem:hover) {
    background: var(--surface2);
  }
  .rail-body :global(.ritem.on) {
    background: var(--surface2);
    color: var(--t1);
    font-weight: 700;
  }
  .rail-body :global(.ritem em) {
    margin-left: auto;
    font-style: normal;
    font-size: 12px;
    color: var(--t3);
  }
  .rail-body :global(.rlabel) {
    font-size: var(--fs-label);
    font-weight: 700;
    color: var(--t3);
    padding: 14px 10px 4px;
    letter-spacing: 0.04em;
  }
  .sim-item {
    margin-top: auto;
  }
</style>
