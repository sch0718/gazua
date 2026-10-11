<script lang="ts">
  import type { App } from '../lib/state/app.svelte';

  let { app }: { app: App } = $props();

  let adding = $state(false);
  let name = $state('');

  function add(e: SubmitEvent) {
    e.preventDefault();
    app.addProfile(name);
    name = '';
    adding = false;
  }
</script>

<section class="picker">
  <h1>프로필을 골라 주세요</h1>
  <ul>
    {#each app.meta.profiles as p (p.id)}
      <li>
        <button type="button" class="profile" onclick={() => app.switchProfile(p.id)}>
          <span class="avatar" aria-hidden="true">{p.name.slice(0, 1)}</span>
          {p.name}
        </button>
      </li>
    {/each}
  </ul>
  {#if adding}
    <form onsubmit={add}>
      <label for="profile-name">새 프로필 이름</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input id="profile-name" bind:value={name} maxlength="30" autocomplete="off" autofocus />
      <button type="submit" class="primary">추가</button>
    </form>
  {:else}
    <button type="button" class="add" onclick={() => (adding = true)}>＋ 새 프로필</button>
  {/if}
</section>

<style>
  .picker {
    max-width: 420px;
    margin: 0 auto;
    padding: 48px var(--gutter) 32px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  h1 {
    font-size: 22px;
    font-weight: 800;
    letter-spacing: -0.02em;
  }
  ul {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .profile {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 12px 16px;
    min-height: 56px;
    border-radius: var(--r-card);
    background: var(--surface);
    font-size: var(--fs-title);
    font-weight: 700;
    text-align: left;
  }
  .profile:hover {
    background: var(--surface2);
  }
  .avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 15px;
  }
  .add {
    color: var(--accent);
    font-weight: 700;
    min-height: var(--touch);
    align-self: flex-start;
  }
  form {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  label {
    width: 100%;
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  input {
    flex: 1;
    min-height: var(--touch);
    padding: 0 12px;
    border-radius: 12px;
    border: 1px solid var(--line);
    background: var(--surface);
  }
  .primary {
    min-height: var(--touch);
    padding: 0 16px;
    border-radius: 12px;
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 700;
  }
</style>
