<script lang="ts">
  import { StoredKeysNotRemovedError, type App } from '../lib/state/app.svelte';
  import { WrongPassphraseError } from '../lib/state/secrets';
  import { showSnackbar } from '@sch0718/ui-svelte';
  import { KEYS_NOT_REMOVED } from '../lib/ui/settings/KeyLock.svelte';

  let { app, confirmFn = (m: string) => window.confirm(m) }: { app: App; confirmFn?: (message: string) => boolean } =
    $props();

  let passphrase = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (busy || passphrase === '') return;
    busy = true;
    error = null;
    try {
      await app.unlock(passphrase);
      passphrase = '';
    } catch (err) {
      error = err instanceof WrongPassphraseError ? '암호가 맞지 않아요' : '잠금을 풀지 못했어요. 다시 시도해 주세요';
    } finally {
      busy = false;
    }
  }

  function clearKeys() {
    if (!confirmFn('이 기기에 저장된 키를 지울까요? 지운 뒤에는 키를 다시 입력해야 해요.')) return;
    try {
      app.clearSecrets();
    } catch (err) {
      // 이 화면은 곧 닫히므로(잠금이 풀린다) 화면 아래 알림으로 알린다.
      if (!(err instanceof StoredKeysNotRemovedError)) throw err;
      showSnackbar(KEYS_NOT_REMOVED);
    }
  }
</script>

<section class="unlock">
  <h1>잠금 해제</h1>
  <p class="sub">저장된 키가 암호로 잠겨 있어요. 암호를 입력해 주세요.</p>
  <form onsubmit={submit}>
    <label for="unlock-passphrase">암호</label>
    <!-- svelte-ignore a11y_autofocus -->
    <input
      id="unlock-passphrase"
      type="password"
      autocomplete="current-password"
      bind:value={passphrase}
      aria-invalid={error ? 'true' : undefined}
      aria-describedby={error ? 'unlock-error' : undefined}
      autofocus
    />
    {#if error}<p id="unlock-error" class="error" role="alert">{error}</p>{/if}
    <button type="submit" class="primary" disabled={busy || passphrase === ''}>
      {busy ? '여는 중…' : '잠금 해제'}
    </button>
  </form>
  <button type="button" class="link" onclick={clearKeys}>이 기기에서 키 삭제</button>
</section>

<style>
  .unlock {
    max-width: 420px;
    margin: 0 auto;
    padding: 48px var(--gutter) 32px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  h1 {
    font-size: 22px;
    font-weight: 800;
    letter-spacing: -0.02em;
  }
  .sub {
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 8px;
  }
  label {
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  input {
    min-height: var(--touch);
    padding: 0 12px;
    border-radius: 12px;
    border: 1px solid var(--line);
    background: var(--surface);
  }
  .error {
    color: var(--err);
    font-size: var(--fs-sub);
  }
  .primary {
    min-height: var(--touch);
    border-radius: 12px;
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 700;
  }
  .primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .link {
    align-self: flex-start;
    min-height: var(--touch);
    color: var(--t2);
    font-size: var(--fs-sub);
    text-decoration: underline;
  }
</style>
