<script lang="ts">
  // 시뮬레이션 화면의 탭: 매매 규칙 · 선정 기준(스펙 7.1). 키보드 규칙은 GroupTabs와 같다.
  // roving tabindex: 선택된 탭만 탭 정지점. 화살표는 포커스만 옮기고 Enter·Space(click)가 선택한다(수동 활성화).
  export type SimulateTab = 'rules' | 'criteria';

  let { tab, onselect, panelId }: { tab: SimulateTab; onselect: (tab: SimulateTab) => void; panelId?: string } = $props();

  const TABS: { key: SimulateTab; label: string }[] = [
    { key: 'rules', label: '매매 규칙' },
    { key: 'criteria', label: '선정 기준' },
  ];
  const uid = Math.random().toString(36).slice(2, 9);
  let buttons = $state<HTMLButtonElement[]>([]);
  let focusIdx = $state<number | null>(null);

  // 탭이 바뀌면 포커스 위치를 선택된 탭으로 되돌린다.
  $effect(() => {
    void tab;
    focusIdx = null;
  });
  const tabStop = $derived(focusIdx ?? TABS.findIndex((t) => t.key === tab));

  function onkeydown(e: KeyboardEvent, index: number) {
    // 브라우저·보조기술 단축키(Alt+←, Ctrl+Home 등)는 가로채지 않는다
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const n = TABS.length;
    let next: number;
    if (e.key === 'ArrowRight') next = (index + 1) % n;
    else if (e.key === 'ArrowLeft') next = (index - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    else return;
    e.preventDefault();
    focusIdx = next;
    buttons[next]?.focus();
  }
</script>

<div class="tabs" role="tablist" aria-label="시뮬레이션">
  {#each TABS as t, i (t.key)}
    <button
      type="button"
      role="tab"
      id="sim-tab-{uid}-{t.key}"
      class="tab"
      class:on={t.key === tab}
      aria-selected={t.key === tab}
      aria-controls={t.key === tab ? panelId : undefined}
      tabindex={i === tabStop ? 0 : -1}
      bind:this={buttons[i]}
      onclick={() => onselect(t.key)}
      onkeydown={(e) => onkeydown(e, i)}
    >
      {t.label}
    </button>
  {/each}
</div>

<style>
  .tabs {
    display: flex;
    gap: 4px;
    padding: 0 var(--gutter) 8px;
    max-width: 720px;
  }
  .tab {
    flex: 1;
    min-height: var(--touch);
    border-radius: 12px;
    font-size: var(--fs-body);
    font-weight: 700;
    color: var(--t2);
    background: var(--surface);
  }
  .tab.on {
    color: var(--on-accent);
    background: var(--accent);
  }
</style>
