<script lang="ts">
  // 프로필(스펙 7.4): 목록·전환·추가·이름 변경·삭제(확인 후). 마지막 프로필은 지울 수 없다.
  import { tick } from 'svelte';
  import type { App } from '../../state/app.svelte';
  import { showSnackbar } from '@sch0718/ui-svelte';

  let {
    app,
    confirmFn = (m: string) => window.confirm(m),
  }: { app: App; confirmFn?: (message: string) => boolean } = $props();

  const uid = Math.random().toString(36).slice(2, 8);
  let renaming = $state<string | null>(null);
  let renameValue = $state('');
  let adding = $state(false);
  let newName = $state('');
  let renameInput = $state<HTMLInputElement>();

  const profiles = $derived(app.meta.profiles);
  const activeId = $derived(app.meta.activeProfileId);

  async function startRename(id: string, name: string) {
    renaming = id;
    renameValue = name;
    await tick();
    renameInput?.select();
  }

  function commitRename() {
    if (renaming === null) return;
    app.renameProfile(renaming, renameValue);
    renaming = null;
  }

  function onRenameKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      renaming = null;
    }
  }

  function remove(id: string, name: string) {
    if (profiles.length <= 1) return;
    if (!confirmFn(`'${name}' 프로필을 지울까요? 이 프로필의 관심종목과 키도 함께 지워져요.`)) return;
    app.deleteProfile(id);
    showSnackbar(`'${name}' 프로필을 지웠어요`);
  }

  function add(e: SubmitEvent) {
    e.preventDefault();
    const p = app.addProfile(newName);
    newName = '';
    adding = false;
    showSnackbar(`'${p.name}' 프로필을 만들었어요`, { label: '전환', run: () => app.switchProfile(p.id) });
  }
</script>

<div class="card">
  <ul>
    {#each profiles as p (p.id)}
      <li>
        {#if renaming === p.id}
          <label class="sr-only" for="{uid}-rename">프로필 이름</label>
          <input
            id="{uid}-rename"
            bind:this={renameInput}
            bind:value={renameValue}
            maxlength="30"
            autocomplete="off"
            onkeydown={onRenameKey}
          />
          <button type="button" class="btn" onclick={commitRename}>저장</button>
        {:else}
          <span class="avatar" aria-hidden="true">{p.name.slice(0, 1)}</span>
          <span class="name">{p.name}</span>
          {#if p.id === activeId}
            <span class="badge">사용 중</span>
          {:else}
            <button type="button" class="btn" aria-label="{p.name} 프로필로 전환" onclick={() => app.switchProfile(p.id)}>
              전환
            </button>
          {/if}
          <button type="button" class="icon" aria-label="{p.name} 이름 바꾸기" onclick={() => startRename(p.id, p.name)}>
            ✎
          </button>
          <button
            type="button"
            class="icon danger"
            aria-label="{p.name} 삭제"
            title={profiles.length <= 1 ? '마지막 프로필은 지울 수 없어요' : undefined}
            disabled={profiles.length <= 1}
            onclick={() => remove(p.id, p.name)}
          >
            ✕
          </button>
        {/if}
      </li>
    {/each}
  </ul>
  {#if adding}
    <form class="add-form" onsubmit={add}>
      <label for="{uid}-new">새 프로필 이름</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input id="{uid}-new" bind:value={newName} maxlength="30" autocomplete="off" autofocus />
      <button type="submit" class="btn accent">추가</button>
    </form>
  {:else}
    <button type="button" class="add" onclick={() => (adding = true)}>＋ 새 프로필</button>
  {/if}
</div>

<style>
  .card {
    background: var(--surface);
    border-radius: var(--r-card);
    padding: 4px 16px 8px;
  }
  ul {
    list-style: none;
  }
  li {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 56px;
    border-bottom: 1px solid var(--line);
  }
  .avatar {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 700;
    flex: none;
  }
  .name {
    flex: 1;
    min-width: 0;
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .badge {
    font-size: var(--fs-label);
    font-weight: 700;
    color: var(--accent);
    background: var(--accent-soft);
    border-radius: var(--r-chip);
    padding: 2px 8px;
  }
  input {
    flex: 1;
    min-width: 0;
    min-height: var(--touch);
    padding: 0 12px;
    border-radius: 12px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--t1);
  }
  .btn {
    min-height: var(--touch);
    padding: 0 12px;
    border-radius: 10px;
    background: var(--surface2);
    color: var(--t1);
    font-weight: 700;
    font-size: var(--fs-sub);
  }
  .btn.accent {
    background: var(--accent);
    color: var(--on-accent);
  }
  .icon {
    width: var(--touch);
    height: var(--touch);
    border-radius: 10px;
    color: var(--t2);
    flex: none;
  }
  .icon.danger {
    color: var(--err);
  }
  .icon:disabled {
    color: var(--t3);
    opacity: 0.5;
    cursor: not-allowed;
  }
  .add {
    min-height: var(--touch);
    color: var(--accent);
    font-weight: 700;
  }
  .add-form {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 10px 0;
  }
  .add-form label {
    width: 100%;
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
</style>
