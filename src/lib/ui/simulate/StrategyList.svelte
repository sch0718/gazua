<script lang="ts">
  // 전략 목록(스펙 7.2): 행 = 이름 · 한 줄 요약 · 마지막 수정일, 행 메뉴 = 복제·이름 바꾸기·삭제.
  import { tick } from 'svelte';
  import type { App } from '../../state/app.svelte';
  import { MAX_STRATEGIES, NAME_MAX, newStrategy } from '../../sim/defaults';
  import { STRATEGY_CAP_MESSAGE } from '../../sim/strategyStore';
  import type { Strategy } from '../../sim/types';
  import { kstDate } from '../../time/kst';
  import Sheet from '../components/Sheet.svelte';
  import { showSnackbar } from '../components/snackbarStore.svelte';
  import { strategyLine } from './simText';
  import { duplicateStrategy, nextStrategyName } from './strategyActions.svelte';

  let { app }: { app: App } = $props();

  const full = () => app.strategies.length >= MAX_STRATEGIES;

  function create() {
    if (full()) return showSnackbar(STRATEGY_CAP_MESSAGE);
    const ids = app.watchlists.groups.map((g) => g.id);
    const last = app.settings.lastGroupId;
    const groupId = last && ids.includes(last) ? last : (ids[0] ?? null);
    const s = newStrategy(Date.now(), groupId, nextStrategyName(app.strategies));
    app.setStrategies([...app.strategies, s]);
    app.navigate({ name: 'simulate', strategyId: s.id });
  }

  let listEl = $state<HTMLElement>();
  let menuId = $state<string | null>(null);
  let renaming = $state(false);
  let draft = $state('');
  let nameError = $state('');
  const target = $derived(app.strategies.find((s) => s.id === menuId) ?? null);

  function closeMenu() {
    menuId = null;
    renaming = false;
  }

  function duplicate(s: Strategy) {
    closeMenu();
    if (duplicateStrategy(app, s) === null) showSnackbar(STRATEGY_CAP_MESSAGE);
  }

  function startRename(s: Strategy) {
    draft = s.name;
    nameError = '';
    renaming = true;
  }

  async function saveRename(s: Strategy) {
    const name = draft.trim().slice(0, NAME_MAX);
    if (!name) {
      // 같은 오류를 다시 띄울 때도 화면 낭독기가 읽도록 지웠다가 다시 넣는다
      nameError = '';
      await tick();
      nameError = '이름을 적어 주세요';
      return;
    }
    app.setStrategies(app.strategies.map((x) => (x.id === s.id ? { ...x, name, updatedAt: Date.now() } : x)));
    closeMenu();
  }

  // 지운 행의 메뉴 버튼은 사라지므로 시트가 닫힐 때 같은 자리의 다음 행 → 이전 행 → ＋ 새 전략 순으로 포커스한다.
  let neighbors: string[] = [];
  const returnFocus = () => {
    for (const id of neighbors) {
      const el = listEl?.querySelector<HTMLElement>(`[data-strategy-row="${id}"]`);
      if (el) return el;
    }
    return listEl?.querySelector<HTMLElement>('[data-new-strategy]');
  };

  function remove(s: Strategy) {
    closeMenu();
    const index = app.strategies.findIndex((x) => x.id === s.id);
    neighbors = [app.strategies[index + 1]?.id, app.strategies[index - 1]?.id].filter((id): id is string => !!id);
    app.setStrategies(app.strategies.filter((x) => x.id !== s.id));
    showSnackbar(`'${s.name}'을(를) 삭제했어요`, {
      label: '되돌리기',
      run: () => {
        if (app.strategies.some((x) => x.id === s.id)) return;
        if (full()) return showSnackbar(STRATEGY_CAP_MESSAGE);
        const next = [...app.strategies];
        next.splice(Math.min(index, next.length), 0, s);
        app.setStrategies(next);
      },
    });
  }

  const modified = (s: Strategy) => kstDate(s.updatedAt).slice(5).replace('-', '.');
</script>

<div class="list" bind:this={listEl}>
  {#if app.strategies.length === 0}
    <div class="empty">
      <p>내 매매 규칙을 과거 데이터로 시험해 보세요</p>
      <button type="button" class="primary" data-new-strategy onclick={create}>＋ 새 전략</button>
    </div>
  {:else}
    <ul>
      {#each app.strategies as s (s.id)}
        <li>
          <button type="button" class="row" data-strategy-row={s.id} onclick={() => app.navigate({ name: 'simulate', strategyId: s.id })}>
            <span class="name">{s.name}</span>
            <span class="line">{strategyLine(s, app.watchlists)}</span>
            <span class="date">최근 수정 {modified(s)}</span>
          </button>
          <button type="button" class="more" aria-label="{s.name} 메뉴" onclick={() => (menuId = s.id)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" />
            </svg>
          </button>
        </li>
      {/each}
    </ul>
    <button type="button" class="primary add" data-new-strategy onclick={create}>＋ 새 전략</button>
  {/if}
</div>

<Sheet open={target !== null} title={renaming ? '이름 바꾸기' : (target?.name ?? '')} onclose={closeMenu} {returnFocus}>
  {#if target}
    {#if renaming}
      <form
        class="rename"
        onsubmit={(e) => {
          e.preventDefault();
          saveRename(target);
        }}
      >
        <input
          aria-label="전략 이름"
          maxlength={NAME_MAX}
          bind:value={draft}
          oninput={() => (nameError = '')}
          aria-invalid={nameError ? 'true' : undefined}
          aria-describedby={nameError ? 'rename-err' : undefined}
          data-autofocus
        />
        {#if nameError}<p id="rename-err" class="err" role="alert">{nameError}</p>{/if}
        <button type="submit" class="primary">저장</button>
      </form>
    {:else}
      <div class="menu">
        <button type="button" onclick={() => duplicate(target)}>복제</button>
        <button type="button" onclick={() => startRename(target)}>이름 바꾸기</button>
        <button type="button" class="danger" onclick={() => remove(target)}>삭제</button>
      </div>
    {/if}
  {/if}
</Sheet>

<style>
  .list {
    max-width: 720px;
    padding: 4px var(--gutter) 48px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  li {
    display: flex;
    align-items: stretch;
    background: var(--surface);
    border-radius: var(--r-card);
  }
  .row {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 14px 4px 14px 16px;
    text-align: left;
    border-radius: var(--r-card);
  }
  .name {
    font-size: var(--fs-body);
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .line {
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  .date {
    font-size: var(--fs-label);
    color: var(--t3);
  }
  .more {
    width: 48px;
    flex: none;
    display: grid;
    place-items: center;
    color: var(--t2);
    border-radius: var(--r-card);
  }
  .more:hover {
    background: var(--surface2);
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding: 64px 16px;
    color: var(--t2);
    text-align: center;
  }
  .primary {
    min-height: var(--touch);
    padding: 0 20px;
    border-radius: 12px;
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 700;
  }
  .primary:disabled {
    opacity: 0.5;
  }
  .add {
    margin-top: 16px;
    width: 100%;
  }
  .menu {
    display: flex;
    flex-direction: column;
    padding: 0 8px;
  }
  .menu button {
    min-height: var(--touch);
    padding: 0 12px;
    text-align: left;
    font-size: var(--fs-body);
    border-radius: 10px;
  }
  .menu button:hover {
    background: var(--surface2);
  }
  .danger {
    color: var(--err);
  }
  .rename {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 4px 20px;
  }
  .err {
    margin: -4px 0 0;
    font-size: var(--fs-sub);
    color: var(--err);
  }
  .rename input {
    min-height: var(--touch);
    padding: 0 12px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--surface2);
    color: var(--t1);
    font-size: var(--fs-body);
  }
</style>
