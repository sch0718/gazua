<script lang="ts">
  // 설정 › 동기화의 관리 목록: 로그인한 기기(철회), 삭제한 프로필(30일 복구), 지금 프로필의 과거 버전(새 프로필로 복원), 내 공유(철회).
  // 펼칠 때만 서버에서 읽는다(무료 할당량 절약).
  import type { App } from '../../state/app.svelte';
  import type { DeviceSession, IndexRow, ShareRow } from '../../sync/api';
  import type { SyncController } from '../../sync/controller.svelte';
  import { SHARE_KIND_LABEL as KIND } from '../../share/kinds';
  import { showSnackbar } from '@sch0718/ui-svelte';

  let { app, sync, confirmFn = (m: string) => window.confirm(m) }: { app: App; sync: SyncController; confirmFn?: (m: string) => boolean } = $props();

  let devices = $state<DeviceSession[] | null>(null);
  let deleted = $state<IndexRow[] | null>(null);
  let revisions = $state<{ revision: number; createdAt: number; deleted: boolean }[] | null>(null);
  let shares = $state<ShareRow[] | null>(null);

  const fmt = (t: number) => new Date(t).toLocaleString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const nowMs = () => Date.now();

  const loadDevices = async () => (devices = await sync.sessions());
  const loadDeleted = async () => (deleted = (await sync.remoteProfiles())?.filter((p) => p.deletedAt !== null) ?? null);
  // 과거 버전 목록은 불러온 프로필에 묶는다. 프로필을 바꾸면 그 프로필 것으로 다시 읽는다(다른 프로필에서 복원하지 않게).
  let revisionsFor = $state<string | null>(null);
  let revisionsOpen = false;
  const loadRevisions = async () => {
    const id = app.meta.activeProfileId;
    revisionsFor = id;
    revisions = null;
    const got = await sync.revisions(id);
    if (revisionsFor === id) revisions = got;
  };
  $effect(() => {
    const id = app.meta.activeProfileId;
    if (revisionsFor !== null && id !== revisionsFor) {
      revisions = null;
      revisionsFor = null;
      if (revisionsOpen) void loadRevisions();
    }
  });
  const loadShares = async () => (shares = await sync.shares());

  function onToggle(e: Event, load: () => Promise<unknown>) {
    if ((e.currentTarget as HTMLDetailsElement).open) void load();
  }

  async function revoke(d: DeviceSession) {
    if (!confirmFn(`「${d.label}」을 로그아웃할까요? 그 기기는 다시 로그인해야 동기화해요.`)) return;
    if (await sync.revokeSession(d.id)) await loadDevices();
  }
  async function revokeOthers() {
    if (!confirmFn('이 기기를 뺀 모든 기기를 로그아웃할까요?')) return;
    if (await sync.revokeSession('others')) await loadDevices();
  }
  async function restore(p: IndexRow) {
    if (await sync.restoreDeleted(p.profileId)) {
      showSnackbar('프로필을 복구했어요');
      await loadDeleted();
    }
  }
  async function restoreRevision(rev: number) {
    if (revisionsFor === null) return;
    const id = await sync.restoreRevision(revisionsFor, rev);
    if (id) showSnackbar('새 프로필로 복원했어요. 프로필 목록에서 볼 수 있어요');
  }
  async function revokeShare(s: ShareRow) {
    if (!confirmFn(`「${s.title}」 공유를 철회할까요? 링크로 더는 볼 수 없어요.`)) return;
    if (await sync.revokeShare(s.id)) await loadShares();
  }
  const shareState = (s: ShareRow) => (s.revokedAt ? '철회됨' : s.expiresAt <= nowMs() ? '만료됨' : `${fmt(s.expiresAt)}까지`);
</script>

<div class="manage">
  <details ontoggle={(e) => onToggle(e, loadDevices)}>
    <summary>로그인한 기기</summary>
    {#if devices === null}
      <p class="muted">불러오는 중…</p>
    {:else}
      <ul>
        {#each devices as d (d.id)}
          <li>
            <span><b>{d.label}</b>{#if d.current} <em>이 기기</em>{/if}<br /><small>마지막 사용 {fmt(d.lastUsedAt)} · {fmt(d.expiresAt)}에 만료</small></span>
            {#if !d.current}<button type="button" class="btn" aria-label="{d.label} 로그아웃" onclick={() => revoke(d)}>로그아웃</button>{/if}
          </li>
        {/each}
      </ul>
      {#if devices.length > 1}<button type="button" class="btn" onclick={revokeOthers}>다른 기기 모두 로그아웃</button>{/if}
    {/if}
  </details>

  <details ontoggle={(e) => onToggle(e, loadDeleted)}>
    <summary>삭제한 프로필</summary>
    {#if deleted === null}
      <p class="muted">불러오는 중…</p>
    {:else if deleted.length === 0}
      <p class="muted">30일 안에 지운 프로필이 없어요.</p>
    {:else}
      <ul>
        {#each deleted as p (p.profileId)}
          <li>
            <span>지운 날 {fmt(p.deletedAt!)}<br /><small>{fmt(p.purgeAt!)}까지 복구할 수 있어요</small></span>
            <button type="button" class="btn" aria-label="{fmt(p.deletedAt!)}에 지운 프로필 복구" onclick={() => restore(p)}>복구</button>
          </li>
        {/each}
      </ul>
    {/if}
  </details>

  <details
    ontoggle={(e) => {
      revisionsOpen = (e.currentTarget as HTMLDetailsElement).open;
      onToggle(e, loadRevisions);
    }}
  >
    <summary>지금 프로필의 과거 버전</summary>
    {#if revisions === null}
      <p class="muted">아직 서버에 올리지 않았거나 불러오는 중이에요.</p>
    {:else}
      <ul>
        {#each revisions.filter((r) => !r.deleted) as r (r.revision)}
          <li>
            <span>버전 {r.revision}<br /><small>{fmt(r.createdAt)}</small></span>
            <button type="button" class="btn" aria-label="버전 {r.revision}을 새 프로필로 복원" onclick={() => restoreRevision(r.revision)}>새 프로필로 복원</button>
          </li>
        {/each}
      </ul>
      <p class="muted">최근 10개까지 남아요. 복원하면 지금 프로필은 그대로 두고 「이름 (복원)」 프로필을 새로 만들어요.</p>
    {/if}
  </details>

  <details ontoggle={(e) => onToggle(e, loadShares)}>
    <summary>내 공유</summary>
    {#if shares === null}
      <p class="muted">불러오는 중…</p>
    {:else if shares.length === 0}
      <p class="muted">만든 공유가 없어요. 그룹 관리·전략·선정 기준 메뉴의 「공유」로 만들어요.</p>
    {:else}
      <ul>
        {#each shares as s (s.id)}
          <li>
            <span><b>{s.title}</b> <small>{KIND[s.kind]}</small><br /><small>{shareState(s)}</small></span>
            {#if !s.revokedAt && s.expiresAt > nowMs()}<button type="button" class="btn" aria-label="{s.title} 공유 철회" onclick={() => revokeShare(s)}>철회</button>{/if}
          </li>
        {/each}
      </ul>
    {/if}
  </details>
</div>

<style>
  .manage {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 8px;
  }
  details {
    background: var(--surface);
    border-radius: var(--r-card);
    padding: 0 16px;
  }
  summary {
    cursor: pointer;
    min-height: var(--touch);
    display: flex;
    align-items: center;
    font-weight: 700;
    font-size: var(--fs-body);
  }
  ul {
    display: flex;
    flex-direction: column;
  }
  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 0;
    border-top: 1px solid var(--line);
    font-size: var(--fs-body);
  }
  small,
  .muted {
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  .muted {
    padding: 8px 0 12px;
  }
  em {
    font-style: normal;
    font-size: var(--fs-label);
    color: var(--accent);
    font-weight: 700;
  }
  .btn {
    flex: none;
    min-height: var(--touch);
    padding: 0 14px;
    border-radius: 12px;
    background: var(--surface2);
    color: var(--t1);
    font-weight: 700;
    margin-bottom: 8px;
  }
  li .btn {
    margin-bottom: 0;
  }
</style>
