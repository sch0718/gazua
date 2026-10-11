<script lang="ts">
  // 키 보호(스펙 10.2): `키를 암호로 잠그기` 토글, 이 기기에서 키 삭제, 토스 키 잠금 권장.
  // 켜기 = 암호 두 번 → setSecrets(키, 암호). 끄기 = 현재 암호 확인 → disableKeyLock().
  import type { App } from '../../state/app.svelte';
  import Sheet from '../components/Sheet.svelte';
  import { showSnackbar } from '../components/snackbarStore.svelte';
  import Toggle from '../components/Toggle.svelte';

  let {
    app,
    confirmFn = (m: string) => window.confirm(m),
  }: { app: App; confirmFn?: (message: string) => boolean } = $props();

  const MIN_LENGTH = 4;
  const uid = Math.random().toString(36).slice(2, 8);

  let dialog = $state<'lock' | 'unlock' | null>(null);
  let pass = $state('');
  let confirmPass = $state('');
  let error = $state<string | null>(null);
  /** 오류가 가리키는 칸. */
  let errorField = $state<'new' | 'confirm' | 'current' | null>(null);
  const errorId = `${uid}-error`;

  function fail(field: 'new' | 'confirm' | 'current' | null, message: string) {
    errorField = field;
    error = message;
  }

  function invalid(field: 'new' | 'confirm' | 'current') {
    return errorField === field && error
      ? { 'aria-invalid': 'true' as const, 'aria-describedby': errorId }
      : {};
  }
  let busy = $state(false);
  let dismissed = $state(false);

  const recommend = $derived(
    !dismissed && app.settings.provider === 'toss' && !!app.secrets?.toss && !app.settings.keyLock,
  );

  function open(kind: 'lock' | 'unlock') {
    pass = '';
    confirmPass = '';
    error = null;
    errorField = null;
    dialog = kind;
  }

  function close() {
    if (busy) return;
    dialog = null;
    pass = '';
    confirmPass = '';
    error = null;
    errorField = null;
  }

  /** 다른 화면(예: 권장 배너)에서 잠금 대화상자를 연다. */
  export function openLockDialog() {
    open('lock');
  }

  function onToggle(next: boolean) {
    if (next) return open('lock');
    // 저장된 키가 없으면 확인할 암호도 없다.
    if (app.secrets === null) {
      app.disableKeyLock();
      return;
    }
    open('unlock');
  }

  async function lock(e: SubmitEvent) {
    e.preventDefault();
    if (busy) return;
    if (pass.length < MIN_LENGTH) return fail('new', `암호를 ${MIN_LENGTH}자 이상 입력해 주세요`);
    if (pass !== confirmPass) return fail('confirm', '암호가 서로 달라요');
    busy = true;
    try {
      await app.setSecrets(app.secrets ?? {}, pass);
      busy = false;
      close();
      showSnackbar('키를 암호로 잠갔어요');
    } catch {
      fail(null, '잠그지 못했어요. 다시 시도해 주세요');
    } finally {
      busy = false;
    }
  }

  async function unlockOff(e: SubmitEvent) {
    e.preventDefault();
    if (busy || pass === '') return;
    busy = true;
    try {
      if (!(await app.verifyPassphrase(pass))) {
        fail('current', '암호가 맞지 않아요');
        return;
      }
      app.disableKeyLock();
      busy = false;
      close();
      showSnackbar('잠금을 껐어요');
    } catch {
      fail(null, '잠금을 끄지 못했어요. 다시 시도해 주세요');
    } finally {
      busy = false;
    }
  }

  function clearKeys() {
    if (!confirmFn('이 기기에 저장된 키를 지울까요? 지운 뒤에는 키를 다시 입력해야 해요.')) return;
    app.clearSecrets();
    showSnackbar('이 기기에서 키를 지웠어요');
  }
</script>

{#if recommend}
  <div class="recommend" role="status">
    <span>토스 키는 주문 권한이 있어요. 암호로 잠그는 걸 권해요</span>
    <div class="row">
      <button type="button" class="accent" onclick={() => open('lock')}>잠그기</button>
      <button type="button" class="ghost" aria-label="권장 닫기" onclick={() => (dismissed = true)}>✕</button>
    </div>
  </div>
{/if}

<div class="card">
  <div class="toggle-row">
    <div>
      <b>키를 암호로 잠그기</b>
      <p>켜면 앱을 열 때마다 암호를 물어요. 풀린 키와 토큰은 메모리에만 있어요.</p>
    </div>
    <Toggle checked={app.settings.keyLock} label="키를 암호로 잠그기" onchange={onToggle} />
  </div>
  <button type="button" class="danger" disabled={app.secrets === null} onclick={clearKeys}>이 기기에서 키 삭제</button>
</div>

<Sheet open={dialog === 'lock'} title="키를 암호로 잠그기" onclose={close}>
  <form class="sheet-form" onsubmit={lock} novalidate>
    <p class="hint">암호를 잊으면 키를 다시 입력해야 해요. 암호는 어디에도 저장하지 않아요.</p>
    <label for="{uid}-new">암호</label>
    <input id="{uid}-new" type="password" autocomplete="new-password" bind:value={pass} {...invalid('new')} data-autofocus />
    <label for="{uid}-confirm">암호 확인</label>
    <input id="{uid}-confirm" type="password" autocomplete="new-password" bind:value={confirmPass} {...invalid('confirm')} />
    {#if error}<p id={errorId} class="error" role="alert">{error}</p>{/if}
    <div class="row end">
      <button type="button" class="ghost" onclick={close}>취소</button>
      <button type="submit" class="accent" disabled={busy}>{busy ? '잠그는 중…' : '잠그기'}</button>
    </div>
  </form>
</Sheet>

<Sheet open={dialog === 'unlock'} title="잠금 끄기" onclose={close}>
  <form class="sheet-form" onsubmit={unlockOff} novalidate>
    <p class="hint">잠금을 끄면 키를 이 브라우저에 암호 없이 저장해요.</p>
    <label for="{uid}-current">현재 암호</label>
    <input id="{uid}-current" type="password" autocomplete="current-password" bind:value={pass} {...invalid('current')} data-autofocus />
    {#if error}<p id={errorId} class="error" role="alert">{error}</p>{/if}
    <div class="row end">
      <button type="button" class="ghost" onclick={close}>취소</button>
      <button type="submit" class="accent" disabled={busy || pass === ''}>끄기</button>
    </div>
  </form>
</Sheet>

<style>
  .recommend {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px 12px;
    padding: 10px 14px;
    margin-bottom: 8px;
    border-radius: var(--r-card);
    background: color-mix(in srgb, var(--warn) 12%, var(--surface));
    color: var(--warn);
    font-size: var(--fs-sub);
    font-weight: 600;
  }
  .card {
    background: var(--surface);
    border-radius: var(--r-card);
    padding: 4px 16px 8px;
  }
  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 0;
    border-bottom: 1px solid var(--line);
  }
  .toggle-row b {
    font-size: var(--fs-body);
  }
  .toggle-row p {
    font-size: var(--fs-sub);
    color: var(--t2);
    margin-top: 2px;
  }
  .danger {
    min-height: var(--touch);
    color: var(--err);
    font-size: var(--fs-body);
    font-weight: 600;
  }
  .danger:disabled {
    color: var(--t3);
    cursor: not-allowed;
  }
  .sheet-form {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 0 var(--gutter) 16px;
  }
  .hint {
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  label {
    font-size: var(--fs-sub);
    color: var(--t2);
    margin-top: 4px;
  }
  input {
    min-height: var(--touch);
    padding: 0 12px;
    border-radius: 12px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--t1);
  }
  .error {
    color: var(--err);
    font-size: var(--fs-sub);
  }
  .row {
    display: flex;
    gap: 8px;
  }
  .row.end {
    justify-content: flex-end;
    margin-top: 8px;
  }
  .accent,
  .ghost {
    min-height: var(--touch);
    min-width: var(--touch);
    padding: 0 16px;
    border-radius: 12px;
    font-weight: 700;
  }
  .accent {
    background: var(--accent);
    color: var(--on-accent);
  }
  .accent:disabled {
    opacity: 0.5;
  }
  .ghost {
    background: var(--surface2);
    color: var(--t1);
  }
</style>
