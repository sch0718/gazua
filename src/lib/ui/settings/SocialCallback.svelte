<script lang="ts">
  // 공급자에서 돌아온 로그인 결과와 다시 할 일을 보여 준다.
  import { onMount } from 'svelte';
  import { showSnackbar } from '@sch0718/ui-svelte';
  import type { SyncController } from '../../sync/controller.svelte';
  import { PROVIDER_NAMES, type SocialOutcome, type SocialReturn } from '../../sync/social';
  import { socialFailureText } from '../../sync/socialText';

  let {
    sync,
    ret,
    ondone,
    copy = (text: string) => navigator.clipboard.writeText(text),
    escapeAfter = 10_000,
    userAgent = navigator.userAgent,
  }: {
    sync: SyncController;
    ret: SocialReturn;
    ondone: (hash: string) => void;
    copy?: (text: string) => Promise<void>;
    escapeAfter?: number;
    userAgent?: string;
  } = $props();

  let outcome = $state<SocialOutcome | null>(null);
  let copied = $state('');
  // 다시 로그인이 남긴 오류만 보여요. 처음 실패는 제목·설명이 이미 알려요.
  let retried = $state(false);
  let canEscape = $state(false);
  let accountCode = $state<HTMLElement | undefined>(undefined);
  const providerName = $derived(ret.callback ? PROVIDER_NAMES[ret.callback.provider] : '카카오·네이버');
  const failure = $derived(outcome && !outcome.ok ? outcome : null);
  const canChooseAccount = $derived(failure?.provider === 'kakao' && !/KAKAOTALK/i.test(userAgent));
  const text = $derived(failure ? socialFailureText(failure) : null);

  onMount(() => {
    let alive = true;
    const timer = setTimeout(() => { canEscape = true; }, escapeAfter);
    void sync.completeSocialSignIn(ret, {
      onLate: (late) => {
        if (!alive) return;
        if (late.ok) ondone(ret.returnHash);
        else outcome = late;
      },
    }).then((result) => {
      if (!alive) return;
      if (result.ok) {
        showSnackbar(`${PROVIDER_NAMES[result.provider]} 계정으로 로그인했어요`);
        ondone(ret.returnHash);
      } else outcome = result;
    });
    return () => { alive = false; clearTimeout(timer); };
  });

  async function retryLogin() {
    if (!failure?.provider) return;
    retried = true;
    await sync.signInWith(failure.provider, ret.label, ret.returnHash);
  }

  async function copyAccount() {
    if (!failure?.account) return;
    try {
      await copy(failure.account);
      copied = '복사했어요';
    } catch {
      if (accountCode) {
        const range = document.createRange();
        range.selectNodeContents(accountCode);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      copied = '복사하지 못했어요. 값을 길게 눌러 복사해 주세요';
    }
  }
</script>

<main class="callback">
  <div class="card">
    {#if failure && text}
      <div role="alert">
        <h1>{text.title}</h1>
        <p>{text.detail}</p>
      </div>
      {#if failure.reason === 'not-allowed' && failure.account}
        <code bind:this={accountCode}>{failure.account}</code>
        <button type="button" class="btn" onclick={copyAccount}>계정 값 복사</button>
        {#if copied}<p role="status">{copied}</p>{/if}
      {/if}
      {#if retried && sync.error}<p role="alert">{sync.error}</p>{/if}
      {#if failure.reason === 'not-allowed' && failure.provider && !canChooseAccount}
        <p>다른 계정으로 로그인하려면 {PROVIDER_NAMES[failure.provider]}에서 로그아웃한 뒤 다시 로그인해 주세요.</p>
      {/if}
      <div class="actions">
        {#if failure.provider && sync.providers[failure.provider]}
          <button type="button" class="btn primary" disabled={sync.busy} onclick={retryLogin}>다시 로그인</button>
          {#if failure.reason === 'not-allowed' && canChooseAccount}
            <button type="button" class="btn" disabled={sync.busy} onclick={() => { retried = true; return sync.signInWith(failure.provider!, ret.label, ret.returnHash, { reauth: true }); }}>다른 계정으로 로그인</button>
          {/if}
        {/if}
        <button type="button" class="btn" onclick={() => ondone(ret.returnHash)}>돌아가기</button>
      </div>
    {:else}
      <p role="status">{providerName}로 로그인하는 중…</p>
      {#if canEscape}
        <p>시간이 걸리고 있어요. 돌아가서 다시 시도할 수 있어요.</p>
        <button type="button" class="btn" onclick={() => { sync.abandonSocialSignIn(); ondone(ret.returnHash); }}>돌아가기</button>
      {/if}
    {/if}
  </div>
</main>

<style>
  .callback {
    flex: 1;
    display: grid;
    place-items: center;
    padding: 24px 16px;
  }
  .card {
    width: 100%;
    max-width: 440px;
    box-sizing: border-box;
    background: var(--surface);
    border-radius: var(--r-card);
    padding: 24px 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  h1 {
    font-size: var(--fs-body);
    font-weight: 700;
  }
  p {
    font-size: var(--fs-sub);
    color: var(--t2);
    line-height: 1.6;
    margin-top: 6px;
  }
  code {
    display: block;
    padding: 12px;
    background: var(--surface2);
    border-radius: 10px;
    overflow-wrap: anywhere;
    user-select: text;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .btn {
    flex: 1;
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
  .btn:disabled {
    opacity: 0.5;
  }
</style>
