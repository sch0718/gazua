<script lang="ts">
  // 설정 › 동기화(제안서 7절 1단계): Google·카카오·네이버 로그인, 동기화 켜기·상태, 충돌 사본 고르기. 기기·삭제한 프로필·과거 버전·내 공유는 SyncManage.
  import type { App } from '../../state/app.svelte';
  import type { SyncController } from '../../sync/controller.svelte';
  import type { ProfileDocV1 } from '../../sync/dto';
  import type { Resolution } from '../../sync/engine';
  import type { Conflict } from '../../sync/store';
  import { isInAppBrowser, PROVIDER_NAMES, type LoginProvider } from '../../sync/social';
  import SyncManage from './SyncManage.svelte';

  let { app, sync, userAgent = navigator.userAgent }: { app: App; sync: SyncController; userAgent?: string } = $props();

  const providerNames = $derived((['google', 'kakao', 'naver'] as LoginProvider[]).filter((p) => sync.providers[p]).map((p) => PROVIDER_NAMES[p]).join('·'));

  const uid = Math.random().toString(36).slice(2, 8);
  let label = $state('');
  let confirm = $state<{ upload: string[]; download: number } | null>(null);

  const status = $derived(sync.status);
  const fmtTime = (t: number) => new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const PHASE: Record<string, string> = {
    off: '꺼짐',
    syncing: '동기화 중…',
    offline: '오프라인이에요. 연결되면 다시 보내요',
    auth: '다시 로그인해야 해요',
    'not-allowed': '허용되지 않은 계정이에요',
    limit: '서버 한도에 걸렸어요. 잠시 뒤 다시 시도해요',
    error: '오류가 났어요. 잠시 뒤 다시 시도해요',
  };
  const statusText = $derived(
    status.phase === 'idle' ? (status.lastSyncAt ? `동기화됨 · ${fmtTime(status.lastSyncAt)}` : '켜짐') : (PHASE[status.phase] ?? status.phase),
  );
  const profileName = (id: string, fallback: string) => app.meta.profiles.find((p) => p.id === id)?.name ?? fallback;
  const summary = (d: ProfileDocV1) =>
    `그룹 ${d.watchlists.groups.length} · 전략 ${d.strategies.length} · 기준 ${d.criteria.length} · 묶음 ${d.baskets.length}`;

  async function askEnable() {
    confirm = await sync.preview();
  }
  async function enable() {
    confirm = null;
    await sync.setEnabled(true);
  }
  const resolve = (c: Conflict, choice: Resolution) => sync.resolve(c.profileId, choice);
</script>

<div class="card">
  {#if !sync.configured}
    <div class="row">
      <div class="text">
        <b>이 빌드에는 동기화가 설정되지 않았어요</b>
        <p>sync-worker를 배포하고 로그인 설정을 넣은 빌드에서 쓸 수 있어요. 지금처럼 이 브라우저에만 저장돼요.</p>
      </div>
    </div>
  {:else if !sync.account}
    <div class="row col">
      <div class="text">
        <b>여러 기기에서 같은 프로필 쓰기</b>
        <p>
          {#if providerNames}{providerNames} 중 쓸 수 있는 계정으로 로그인하면 그룹·전략·선정 기준·묶음·분석 설정(기간·지표·벤치마크·색·정렬)을 기기끼리 맞춰요.{/if}
          키·계좌·주문 내역·성과·프록시 주소·테마는 올리지 않아요. 올린 데이터는 암호화하지 않은 채 서버(Cloudflare)에 저장돼요.
        </p>
      </div>
      <label class="field" for="sync-label-{uid}">
        이 기기 이름(선택)
        <input id="sync-label-{uid}" maxlength="40" bind:value={label} placeholder="예: 회사 노트북" />
      </label>
      {#if sync.providers.google}
        <button type="button" class="btn primary" disabled={sync.busy} onclick={() => sync.signIn(label)}>Google로 로그인</button>
      {/if}
      {#if sync.providers.kakao}
        <button type="button" class="btn kakao" disabled={sync.busy} onclick={() => sync.signInWith('kakao', label)}>카카오로 로그인</button>
      {/if}
      {#if sync.providers.naver}
        <button type="button" class="btn naver" disabled={sync.busy} onclick={() => sync.signInWith('naver', label)}>네이버로 로그인</button>
      {/if}
      {#if !providerNames}
        <p class="warn">이 빌드에는 로그인 방법이 설정되지 않았어요</p>
      {/if}
      {#if sync.providers.google && isInAppBrowser(userAgent)}
        <p class="warn">카카오톡·네이버 앱 안의 브라우저에서는 Google 로그인이 막혀요. {sync.providers.kakao ? '카카오로 로그인을 쓰거나 ' : ''}오른쪽 위 메뉴에서 다른 브라우저로 열어 주세요.</p>
      {/if}
    </div>
  {:else}
    <div class="row">
      <div class="text">
        <b>{sync.account.display}</b>
        <p>{PROVIDER_NAMES[sync.account.provider]} 계정으로 로그인됨</p>
        {#if sync.account.provider !== 'google' && sync.account.display !== sync.account.id}
          <small class="muted">{sync.account.id}</small>
        {/if}
      </div>
      <button type="button" class="btn" disabled={sync.busy} onclick={() => sync.signOut()}>로그아웃</button>
    </div>
    <div class="row">
      <div class="text">
        <b>동기화</b>
        <p role="status">{statusText}{status.pending > 0 ? ` · 보낼 변경 ${status.pending}건` : ''}</p>
      </div>
      {#if status.enabled}
        <span class="actions">
          <button type="button" class="btn" disabled={sync.busy || status.phase === 'syncing'} onclick={() => sync.syncNow()}>지금 동기화</button>
          <button type="button" class="btn" disabled={sync.busy} onclick={() => sync.setEnabled(false)}>끄기</button>
        </span>
      {:else if !confirm}
        <button type="button" class="btn primary" disabled={sync.busy} onclick={askEnable}>동기화 켜기</button>
      {/if}
    </div>
    {#if confirm}
      <div class="row col" role="group" aria-label="동기화 켜기 확인">
        <p>
          이 기기의 프로필 {confirm.upload.length}개{confirm.upload.length ? `(${confirm.upload.join(', ')})` : ''}를 올리고, 서버의 프로필
          {confirm.download}개를 이 기기에 추가해요. 이 기기의 프로필을 서버 값으로 덮어쓰지 않아요.
        </p>
        <span class="actions">
          <button type="button" class="btn" onclick={() => (confirm = null)}>취소</button>
          <button type="button" class="btn primary" onclick={enable}>켜기</button>
        </span>
      </div>
    {/if}
    {#if status.volatile}
      <p class="warn">이 브라우저는 IndexedDB를 쓸 수 없어 보낼 변경을 탭을 닫으면 잃을 수 있어요. 닫기 전에 지금 동기화를 눌러 주세요.</p>
    {/if}
    {#each status.notices as n, i (i)}
      <p class="warn">{n} <button type="button" class="link" onclick={() => sync.clearNotices()}>닫기</button></p>
    {/each}
    {#each status.rejected as r (r.profileId)}
      <p class="warn">「{profileName(r.profileId, '프로필')}」을 서버가 받지 않았어요({r.code === 'too-large' ? '256 KiB 초과' : r.code}). 줄이면 다시 보내요.</p>
    {/each}
  {/if}
  {#if sync.error}
    <p class="warn" role="alert">{sync.error}</p>
  {/if}
</div>

{#if status.conflicts.length > 0}
  <h3>충돌한 프로필 {status.conflicts.length}개</h3>
  <ul class="conflicts">
    {#each status.conflicts as c (c.profileId)}
      <li class="card">
        {#if c.kind === 'edit'}
          <b>「{profileName(c.profileId, c.local.name)}」을 두 기기에서 바꿨어요</b>
          <p>이 기기: {summary(c.local)}</p>
          <p>서버: {summary(c.remote)} (「{c.remote.name}」)</p>
          <span class="actions">
            <button type="button" class="btn" onclick={() => resolve(c, 'keep-local')}>이 기기 것 유지</button>
            <button type="button" class="btn" onclick={() => resolve(c, 'take-remote')}>서버 것 받기</button>
            <button type="button" class="btn primary" onclick={() => resolve(c, 'keep-both')}>둘 다 남기기</button>
          </span>
        {:else}
          <b>「{profileName(c.profileId, c.local.name)}」은 다른 기기에서 지웠어요</b>
          <p>
            이 기기에 보내지 않은 변경이 있어요({summary(c.local)}).
            {c.purgeAt ? `${fmtTime(c.purgeAt)}까지 복구할 수 있어요.` : '서버에서는 이미 정리됐어요. 남기면 새로 올려요.'}
          </p>
          <span class="actions">
            <button type="button" class="btn" onclick={() => resolve(c, 'delete-local')}>이 기기에서도 지우기</button>
            <button type="button" class="btn primary" onclick={() => resolve(c, 'restore')}>{c.purgeAt ? '복구하고 이 기기 것 올리기' : '이 기기 것 다시 올리기'}</button>
          </span>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

{#if sync.account}
  <SyncManage {app} {sync} />
{/if}

<style>
  .card {
    background: var(--surface);
    border-radius: var(--r-card);
    padding: 4px 16px 8px;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px 12px;
    padding: 12px 0;
    border-bottom: 1px solid var(--line);
  }
  .row.col {
    flex-direction: column;
    align-items: stretch;
  }
  .row:last-child {
    border-bottom: 0;
  }
  .text b {
    font-size: var(--fs-body);
    word-break: break-all;
  }
  .text p,
  .row p,
  li p {
    font-size: var(--fs-sub);
    color: var(--t2);
    margin-top: 2px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  .field input {
    min-height: var(--touch);
    border-radius: 10px;
    border: 1px solid var(--line);
    padding: 0 10px;
    background: var(--surface);
    color: var(--t1);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: flex-end;
  }
  .btn {
    flex: none;
    min-height: var(--touch);
    padding: 0 14px;
    border-radius: 12px;
    background: var(--surface2);
    color: var(--t1);
    font-weight: 700;
  }
  .btn.primary {
    background: var(--accent);
    color: var(--on-accent, #fff);
  }
  .btn.kakao {
    background: #FEE500;
    color: rgba(0,0,0,0.85);
  }
  .btn.naver {
    background: #03C75A;
    color: #fff;
  }
  .muted {
    color: var(--t3);
    font-size: var(--fs-sub);
    overflow-wrap: anywhere;
  }
  .btn:disabled {
    opacity: 0.5;
  }
  .link {
    text-decoration: underline;
    color: var(--t1);
    min-height: var(--touch);
  }
  .warn {
    font-size: var(--fs-sub);
    color: var(--warn);
    padding: 8px 0;
  }
  h3 {
    font-size: var(--fs-label);
    font-weight: 700;
    color: var(--t3);
    padding: 14px 4px 6px;
  }
  .conflicts {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .conflicts li {
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .conflicts .actions {
    margin-top: 8px;
    justify-content: flex-start;
  }
</style>
