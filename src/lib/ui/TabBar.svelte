<script lang="ts">
  import type { App } from '../state/app.svelte';

  // 폰·태블릿(<1024) 아래 탭 막대. 아이콘만 있던 앱 바 단추 대신 이름을 붙여 둔다.
  // PC(≥1024)는 레일에 같은 메뉴가 있어 숨긴다.
  let { app }: { app: App } = $props();

  type Tab = { id: 'compare' | 'performance' | 'simulate' | 'settings'; label: string; icon: string };
  const TABS: Tab[] = [
    { id: 'compare', label: '관심 종목', icon: 'M4 19h16M6 16l4-5 3 3 5-7' },
    { id: 'performance', label: '내 성과', icon: 'M3 7h18v13H3zM8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M7 15l3-3 2 2 5-5' },
    { id: 'simulate', label: '시뮬레이션', icon: 'M5 4l14 8-14 8z' },
    {
      id: 'settings',
      label: '설정',
      icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.4z',
    },
  ];
  const current = $derived(app.route.name);
</script>

<nav class="tabbar" aria-label="주요 메뉴">
  {#each TABS as t (t.id)}
    <button
      type="button"
      class:on={current === t.id}
      aria-current={current === t.id ? 'page' : undefined}
      onclick={() => {
        app.navigate({ name: t.id });
        // 탭을 바꾸면(같은 탭을 다시 눌러도) 새 화면을 맨 위부터 보여 준다
        window.scrollTo(0, 0);
      }}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d={t.icon} />
      </svg>
      <span>{t.label}</span>
    </button>
  {/each}
</nav>

<style>
  .tabbar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 70;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    height: var(--tabbar-h);
    padding-bottom: env(safe-area-inset-bottom, 0px);
    box-sizing: border-box;
    background: var(--surface);
    border-top: 1px solid var(--line);
  }
  button {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    min-height: var(--touch);
    color: var(--t3);
    font-size: 11px;
    font-weight: 600;
  }
  button.on {
    color: var(--t1);
    font-weight: 800;
  }
  button.on svg {
    color: var(--accent);
  }
  @media (min-width: 1024px) {
    .tabbar {
      display: none;
    }
  }
</style>
