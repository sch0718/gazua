<script lang="ts" module>
  export const KEY_LOCKED_ELSEWHERE = '다른 탭에서 키를 암호로 잠갔어요. 새로고침한 뒤 다시 저장해 주세요';
</script>

<script lang="ts">
  // 연결 설정(스펙 7.4): 프록시 URL·프록시 토큰(선택)·공급자 키. 키는 비밀번호 칸으로 받고 저장 뒤엔 끝 4자리만 보인다.
  // 붙여넣으면 앞뒤 공백·줄바꿈을 지운다. 온보딩은 section으로 프록시 칸(③)과 키 칸(④)을 따로 쓴다.
  import { untrack } from 'svelte';
  import { KeyLockedElsewhereError, type App } from '../../state/app.svelte';
  import { trimCredential, type Secrets } from '../../state/secrets';
  import { showSnackbar } from '../components/snackbarStore.svelte';
  import { KEY_FIELDS, maskTail, mergeKeys, normalizeProxyUrl } from './connection';

  let {
    app,
    section = 'all',
    submitLabel = '저장',
    onsaved,
  }: {
    app: App;
    section?: 'all' | 'proxy' | 'keys';
    submitLabel?: string;
    onsaved?: () => void;
  } = $props();

  const uid = Math.random().toString(36).slice(2, 8);
  const showProxy = $derived(section !== 'keys');
  const showKeys = $derived(section !== 'proxy');
  const provider = $derived(app.settings.provider);
  const fields = $derived(provider === 'demo' ? null : KEY_FIELDS[provider]);

  // 입력 칸의 시작값. 이후 앱 설정이 바뀌어도 입력 중인 값을 덮어쓰지 않는다.
  let proxyUrl = $state(untrack(() => app.settings.proxyUrl));
  let proxyToken = $state('');
  let clearToken = $state(false);
  let keyA = $state('');
  let keyB = $state('');
  let passphrase = $state('');
  let editing = $state<Record<string, boolean>>({});
  let error = $state<string | null>(null);
  /** 오류가 가리키는 칸(aria-invalid). */
  let errorField = $state<'url' | 'keys' | 'pass' | null>(null);
  const errorId = `${uid}-error`;

  function fail(field: 'url' | 'keys' | 'pass' | null, message: string) {
    errorField = field;
    error = message;
  }

  /** 오류가 이 칸을 가리키면 aria-invalid·aria-describedby를 단다. */
  function invalid(field: 'url' | 'keys' | 'pass') {
    return errorField === field && error
      ? { 'aria-invalid': 'true' as const, 'aria-describedby': errorId }
      : {};
  }
  let busy = $state(false);

  /** 공급자를 바꾸면 입력 중이던 키를 버린다. */
  let lastProvider = untrack(() => app.settings.provider);
  $effect(() => {
    if (provider === lastProvider) return;
    lastProvider = provider;
    keyA = '';
    keyB = '';
    editing = {};
    error = null;
    errorField = null;
  });

  function savedKey(name: string): string {
    const s = app.secrets;
    if (!s) return '';
    if (provider === 'kis') return s.kis?.[name as 'appKey' | 'appSecret'] ?? '';
    if (provider === 'toss') return s.toss?.[name as 'clientId' | 'clientSecret'] ?? '';
    return '';
  }

  const savedToken = $derived(clearToken ? '' : (app.secrets?.proxyToken ?? ''));
  const dirtyKeys = $derived(trimCredential(keyA) !== '' || trimCredential(keyB) !== '');
  const dirtySecrets = $derived(
    (showKeys && dirtyKeys) || (showProxy && (trimCredential(proxyToken) !== '' || clearToken)),
  );
  const needsPassphrase = $derived(app.settings.keyLock && dirtySecrets);

  function pasteTrimmed(e: ClipboardEvent, set: (v: string) => void) {
    const text = e.clipboardData?.getData('text');
    if (text == null) return;
    e.preventDefault();
    set(trimCredential(text));
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (busy) return;
    error = null;
    errorField = null;

    let url = app.settings.proxyUrl;
    if (showProxy) {
      const r = normalizeProxyUrl(proxyUrl);
      if (!r.ok) return fail('url', r.reason);
      if (section === 'proxy' && r.url === '') return fail('url', '프록시 URL을 입력해 주세요');
      url = r.url;
    }

    let next: Secrets = { ...(app.secrets ?? {}) };
    if (showKeys && fields) {
      const merged = mergeKeys(app.secrets, provider as 'kis' | 'toss', keyA, keyB);
      if (!merged.ok) return fail('keys', merged.reason);
      if (merged.secrets) next = { ...merged.secrets };
      else if (section === 'keys' && !savedKey(fields[0].name)) return fail('keys', '키를 입력해 주세요');
    }
    if (showProxy) {
      const token = trimCredential(proxyToken);
      if (token) next.proxyToken = token;
      else if (clearToken) delete next.proxyToken;
    }

    busy = true;
    try {
      const lockPass = app.settings.keyLock && dirtySecrets ? passphrase : undefined;
      if (lockPass !== undefined) {
        if (lockPass === '') return fail('pass', '키가 잠겨 있어요. 암호를 입력해 주세요');
        if (!(await app.verifyPassphrase(lockPass))) return fail('pass', '암호가 맞지 않아요');
      }
      if (showProxy && url !== app.settings.proxyUrl) app.updateSettings({ proxyUrl: url });
      if (dirtySecrets) await app.setSecrets(next, lockPass);
      proxyUrl = url;
      proxyToken = '';
      clearToken = false;
      keyA = '';
      keyB = '';
      passphrase = '';
      editing = {};
      if (section === 'all') showSnackbar('저장했어요');
      onsaved?.();
    } catch (err) {
      fail(null, err instanceof KeyLockedElsewhereError ? KEY_LOCKED_ELSEWHERE : '저장하지 못했어요. 다시 시도해 주세요');
    } finally {
      busy = false;
    }
  }
</script>

{#snippet secretField(
  id: string,
  label: string,
  saved: string,
  value: string,
  set: (v: string) => void,
  kind: 'keys' | null,
)}
  <div class="field">
    {#if saved && !editing[id]}
      <span class="label">{label}</span>
      <div class="saved">
        <span class="mask num">{maskTail(saved)}</span>
        <button type="button" class="link" aria-label="{label} 변경" onclick={() => (editing = { ...editing, [id]: true })}>
          변경
        </button>
      </div>
    {:else}
      <label for="{uid}-{id}">{label}</label>
      <input
        id="{uid}-{id}"
        type="password"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        {value}
        {...kind ? invalid(kind) : {}}
        oninput={(e) => set(e.currentTarget.value)}
        onpaste={(e) => pasteTrimmed(e, set)}
      />
    {/if}
  </div>
{/snippet}

<form class="card" onsubmit={save} novalidate>
  {#if showProxy}
    <div class="field">
      <label for="{uid}-url">프록시 URL</label>
      <input
        id="{uid}-url"
        type="url"
        inputmode="url"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        placeholder="https://gazua-proxy.example.workers.dev"
        bind:value={proxyUrl}
        {...invalid('url')}
        onpaste={(e) => pasteTrimmed(e, (v) => (proxyUrl = v))}
      />
    </div>
    {@render secretField('token', '프록시 토큰 (선택)', savedToken, proxyToken, (v) => (proxyToken = v), null)}
    {#if savedToken && !editing.token}
      <button type="button" class="link small" onclick={() => (clearToken = true)}>프록시 토큰 지우기</button>
    {/if}
  {/if}

  {#if showKeys}
    {#if fields}
      {@render secretField(fields[0].name, fields[0].label, savedKey(fields[0].name), keyA, (v) => (keyA = v), 'keys')}
      {@render secretField(fields[1].name, fields[1].label, savedKey(fields[1].name), keyB, (v) => (keyB = v), 'keys')}
    {:else}
      <p class="note">데모 데이터는 키 없이 볼 수 있어요. 공급자를 고르면 키를 넣을 수 있어요.</p>
    {/if}
  {/if}

  {#if needsPassphrase}
    <div class="field">
      <label for="{uid}-pass">잠금 암호</label>
      <input
        id="{uid}-pass"
        type="password"
        autocomplete="current-password"
        bind:value={passphrase}
        {...invalid('pass')}
      />
    </div>
  {/if}

  {#if error}<p id={errorId} class="error" role="alert">{error}</p>{/if}
  <div class="actions">
    <button type="submit" class="primary" disabled={busy}>{submitLabel}</button>
  </div>
</form>

<style>
  .card {
    background: var(--surface);
    border-radius: var(--r-card);
    padding: 4px 16px 16px;
    display: flex;
    flex-direction: column;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px 0;
    border-bottom: 1px solid var(--line);
  }
  label,
  .label {
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  input {
    min-height: var(--touch);
    padding: 0 12px;
    border-radius: 12px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--t1);
    font-size: var(--fs-body);
  }
  .saved {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .mask {
    font-size: var(--fs-body);
    letter-spacing: 0.04em;
  }
  .link {
    color: var(--accent);
    font-size: var(--fs-sub);
    font-weight: 700;
    min-height: var(--touch);
    min-width: var(--touch);
  }
  .link.small {
    align-self: flex-start;
    color: var(--t2);
    font-weight: 600;
  }
  .note {
    color: var(--t2);
    font-size: var(--fs-sub);
    padding: 12px 0;
  }
  .error {
    color: var(--err);
    font-size: var(--fs-sub);
    padding-top: 10px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    padding-top: 12px;
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
</style>
