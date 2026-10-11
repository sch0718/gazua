<script lang="ts">
  import { tick } from 'svelte';
  import type { App } from '../lib/state/app.svelte';
  import type { Group } from '../lib/state/schema';
  import { moveGroup, renameGroup } from '../lib/state/watchlist';
  import Sheet from '../lib/ui/components/Sheet.svelte';
  import { deleteGroupWithUndo } from './groupActions';

  // 그룹 관리 시트(스펙 7.3): 이름 바꾸기·순서·삭제(확인 + 되돌리기). 그룹은 하나 이상 남긴다.
  let { open, app, onclose }: { open: boolean; app: App; onclose: () => void } = $props();

  const groups = $derived(app.watchlists.groups);
  const lastOne = $derived(groups.length <= 1);

  let editing = $state<string | null>(null);
  let draft = $state('');
  let renameError = $state(false);
  let confirming = $state<Group | null>(null);
  let cancelBtn = $state<HTMLButtonElement>();

  async function startRename(g: Group) {
    editing = g.id;
    draft = g.name;
    renameError = false;
    await tick();
    document.querySelector<HTMLInputElement>('input[data-rename]')?.select();
  }

  function commitRename() {
    if (!editing) return;
    if (draft.trim() === '') {
      renameError = true;
      return;
    }
    app.setWatchlists(renameGroup(app.watchlists, editing, draft));
    editing = null;
  }

  function onRenameKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename();
    } else if (e.key === 'Escape') {
      // 시트까지 닫히지 않게 여기서 멈춘다.
      e.preventDefault();
      e.stopPropagation();
      editing = null;
    }
  }

  function move(index: number, by: -1 | 1) {
    const to = index + by;
    if (to < 0 || to >= groups.length) return;
    app.setWatchlists(moveGroup(app.watchlists, index, to));
  }

  async function askDelete(g: Group) {
    if (lastOne) return;
    confirming = g;
    await tick();
    cancelBtn?.focus();
  }

  function confirmDelete() {
    const g = confirming;
    confirming = null;
    if (!g) return;
    const wasActive = app.route.name === 'compare' && app.route.groupId === g.id;
    if (!deleteGroupWithUndo(app, g.id)) return;
    if (wasActive) app.navigate({ name: 'compare', groupId: app.watchlists.groups[0].id });
  }
</script>

<Sheet {open} title="그룹 관리" {onclose}>
  {#if lastOne}
    <p class="sub" id="last-group-reason">그룹은 하나 이상 있어야 해요</p>
  {/if}
  <ul>
    {#each groups as g, i (g.id)}
      <li class="grow">
        {#if editing === g.id}
          <div class="edit">
            <input
              data-rename
              bind:value={draft}
              aria-label="그룹 이름"
              aria-invalid={renameError}
              onkeydown={onRenameKey}
              onblur={commitRename}
            />
            {#if renameError}<span class="err" role="alert">이름을 입력해 주세요</span>{/if}
          </div>
        {:else}
          <div class="info">
            <b class="name">{g.name}</b>
            <em>{g.items.length}종목</em>
          </div>
          <button type="button" class="icon" aria-label="{g.name} 이름 바꾸기" onclick={() => startRename(g)}>✎</button>
        {/if}
        <button type="button" class="icon" aria-label="{g.name} 위로" disabled={i === 0} onclick={() => move(i, -1)}>↑</button>
        <button
          type="button"
          class="icon"
          aria-label="{g.name} 아래로"
          disabled={i === groups.length - 1}
          onclick={() => move(i, 1)}>↓</button
        >
        <button
          type="button"
          class="icon danger"
          aria-label="{g.name} 삭제"
          aria-disabled={lastOne ? 'true' : undefined}
          aria-describedby={lastOne ? 'last-group-reason' : undefined}
          onclick={() => askDelete(g)}>✕</button
        >
      </li>
    {/each}
  </ul>

  {#if confirming}
    <div class="confirm" role="alertdialog" aria-labelledby="group-delete-q">
      <p id="group-delete-q">'{confirming.name}' 그룹과 종목 {confirming.items.length}개를 삭제할까요?</p>
      <div class="btns">
        <button type="button" class="btn ghost" bind:this={cancelBtn} onclick={() => (confirming = null)}>취소</button>
        <button type="button" class="btn danger" onclick={confirmDelete}>삭제</button>
      </div>
    </div>
  {/if}
</Sheet>

<style>
  .sub {
    font-size: 13px;
    color: var(--t2);
    padding: 0 20px 10px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0 8px;
  }
  .grow {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px 4px 4px 12px;
    min-height: 56px;
  }
  .info,
  .edit {
    flex: 1;
    min-width: 0;
  }
  .name {
    font-size: 15px;
    font-weight: 700;
    display: block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .info em {
    font-style: normal;
    font-size: 12px;
    color: var(--t3);
  }
  .edit input {
    width: 100%;
    font-size: 16px;
    padding: 8px 10px;
    border-radius: 10px;
    border: 1.5px solid var(--accent);
    background: var(--surface2);
    color: var(--t1);
  }
  .err {
    font-size: 12px;
    color: var(--err);
  }
  .icon {
    width: var(--touch);
    height: var(--touch);
    border-radius: 12px;
    display: grid;
    place-items: center;
    color: var(--t2);
    flex: none;
  }
  .icon:hover:not(:disabled) {
    background: var(--surface2);
  }
  .icon:disabled,
  .icon[aria-disabled='true'] {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .icon.danger {
    color: var(--err);
  }
  .confirm {
    margin: 12px 16px 0;
    padding: 14px;
    border-radius: 16px;
    background: var(--surface2);
  }
  .confirm p {
    font-size: 15px;
    font-weight: 700;
  }
  .btns {
    display: flex;
    gap: 8px;
    padding-top: 12px;
  }
  .btn {
    flex: 1;
    padding: 12px 18px;
    border-radius: 14px;
    font-weight: 800;
    font-size: 15px;
    min-height: 46px;
    background: var(--surface);
    color: var(--t1);
  }
  .btn.danger {
    background: var(--err);
    color: #fff;
  }
</style>
