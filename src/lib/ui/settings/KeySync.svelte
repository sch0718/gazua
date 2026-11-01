<script lang="ts">
  // 설정 › 동기화·공유 › 키 동기화(설계 5.5~5.16, 9절). 지금 프로필 한 줄, 공급자 체크, 알림, 동기화 암호 시트, 위험 안내.
  // 암호 문자열은 KDF가 끝나면 바로 비운다. 마스터 키·받은 평문은 이 컴포넌트에 두지 않는다(컨트롤러가 쥔다).
  import { onDestroy } from 'svelte';
  import { Sheet, showSnackbar, Toggle } from '@sch0718/ui-svelte';
  import { KeyLockNotSavedError, StoredKeysNotRemovedError, type App } from '../../state/app.svelte';
  import type { SyncController } from '../../sync/controller.svelte';
  import { checkSyncPassphrase, EDGE_SPACE_TEXT, hasEdgeSpace, PASSPHRASE_TEXT } from '../../sync/keyCrypto';
  import { KEY_TEXT, PROVIDER_LABEL, type KeyResult } from '../../sync/keySync';
  import type { KeyProvider } from '../../sync/keyWire';
  import { KEYS_NOT_REMOVED, keyLockFailureText } from './KeyLock.svelte';

  let {
    app,
    sync,
    confirmFn = (m: string) => window.confirm(m),
  }: { app: App; sync: SyncController; confirmFn?: (message: string) => boolean } = $props();

  type SheetKind = null | 'risk' | 'create' | 'enter' | 'change' | 'lockpass';
  type PassSheet = 'create' | 'enter' | 'change' | 'lockpass';
  type Next = null | { kind: 'enable'; providers: KeyProvider[] } | { kind: 'receive' } | { kind: 'upload' };
  type Field = 'pass' | 'pass2' | 'current' | 'lock' | null;

  const PROVIDERS: KeyProvider[] = ['kis', 'toss'];
  const REMOTE: (string | null)[] = ['available', 'newer', 'conflict', 'rollback'];
  const TITLES: Record<PassSheet, string> = { create: '동기화 암호 정하기', enter: '동기화 암호 입력', change: '동기화 암호 바꾸기', lockpass: '이 기기 잠금 암호 입력' };
  const uid = Math.random().toString(36).slice(2, 8);
  const errorId = `${uid}-error`;

  const view = $derived(sync.keys.view);
  const id = $derived(app.meta.activeProfileId);
  const name = $derived(app.meta.profiles.find((p) => p.id === id)?.name ?? '');
  const st = $derived(view.states.find((s) => s.profileId === id));
  const has = $derived({ kis: !!app.secrets?.kis, toss: !!app.secrets?.toss });
  const offReason = $derived(!view.uploaded.includes(id) ? KEY_TEXT.notUploaded : !has.kis && !has.toss ? KEY_TEXT.noKeys : null);
  const on = $derived(!!st?.active);
  const dirty = $derived(!!st && st.active && st.localSeq > st.uploadedSeq);
  const canUpload = $derived(!!st && st.providers.some((p) => has[p]));
  const missing = $derived<KeyProvider>(st?.providers.find((p) => !has[p]) ?? st?.providers[0] ?? 'kis');
  const others = $derived(view.states.filter((s) => s.profileId !== id && s.active && REMOTE.includes(s.notice)));
  const otherName = (pid: string) => app.meta.profiles.find((p) => p.id === pid)?.name ?? '프로필';

  let sheet = $state<SheetKind>(null);
  let next = $state<Next>(null);
  let pick = $state<KeyProvider[]>([]);
  let understood = $state(false);
  let pass = $state('');
  let pass2 = $state('');
  let current = $state('');
  let lockPass = $state('');
  let error = $state<string | null>(null);
  let errorField = $state<Field>(null);
  let busy = $state(false);
  let receiving = $state(false);
  let message = $state<string | null>(null);
  let offerDelete = $state(false);
  /** 서버에 올리는 동작 중(켜기·이 기기 키 올리기·공급자 바꾸기). aria-live로 알린다(9절) */
  let uploading = $state(false);
  const needLock = $derived(next?.kind === 'receive' && app.settings.keyLock);
  const passSheet = $derived(sheet !== null && sheet !== 'risk' ? sheet : null);

  function invalid(field: Field) {
    return errorField === field && error ? { 'aria-invalid': 'true' as const, 'aria-describedby': errorId } : {};
  }
  function fail(field: Field, text: string | null) {
    errorField = field;
    error = text;
  }
  function clearFields() {
    pass = '';
    pass2 = '';
    current = '';
    lockPass = '';
    error = null;
    errorField = null;
  }
  function open(kind: SheetKind) {
    clearFields();
    sheet = kind;
  }
  /** 사용자가 닫기(Esc·바깥·취소). KDF 중에는 닫히지 않는다. 받기 중이면 컨트롤러가 쥔 풀린 키도 버린다 */
  function close() {
    if (busy) return;
    if (next?.kind === 'receive') sync.keys.cancelReceive();
    sheet = null;
    next = null;
    clearFields();
  }
  // 화면을 떠나면 받기 확인 사이에 쥔 평문을 남기지 않는다
  onDestroy(() => sync.keys.cancelReceive());
  /** 동작이 끝나 닫는다 */
  function closeNow() {
    sheet = null;
    clearFields();
  }
  function report(r: KeyResult) {
    if (r.ok) {
      message = null;
      offerDelete = false;
      if (r.notes.length > 0) showSnackbar(r.notes.join(' '));
      return;
    }
    offerDelete = !!r.offerDelete;
    if (r.error instanceof KeyLockNotSavedError) message = keyLockFailureText(r.error);
    else if (r.error instanceof StoredKeysNotRemovedError) message = KEYS_NOT_REMOVED;
    else message = r.message;
  }
  /** 실패를 보인다. 암호가 필요하면 하던 일을 기억한 채 입력 시트를 연다 */
  function afterFail(r: Extract<KeyResult, { ok: false }>, keep: Next) {
    if (r.needsPass) {
      next = keep;
      open('enter');
      if (r.message) fail('pass', r.message);
      return;
    }
    next = null;
    closeNow();
    report(r);
  }

  function onToggle(nextOn: boolean) {
    message = null;
    if (nextOn) {
      if (offReason) return;
      pick = has.kis ? ['kis'] : [];
      understood = false;
      open('risk');
      return;
    }
    void turnOff();
  }
  async function turnOff() {
    if (!confirmFn(KEY_TEXT.offConfirm + (st && st.revision === 0 ? KEY_TEXT.offConfirmKnown : ''))) return;
    report(await sync.keys.disable(id));
  }
  function continueRisk() {
    if (!understood || pick.length === 0) return;
    next = { kind: 'enable', providers: [...pick] };
    sheet = null;
    if (!view.vault) open('create');
    else if (!view.remembered) open('enter');
    else void runNext();
  }
  async function runNext() {
    const n = next;
    if (!n) return closeNow();
    if (n.kind === 'receive') return doReceive();
    uploading = true;
    const r = await (n.kind === 'enable' ? sync.keys.enable(id, n.providers) : sync.keys.uploadLocal(id)).finally(() => (uploading = false));
    if (!r.ok) return afterFail(r, n);
    next = null;
    closeNow();
    report(r);
  }
  function receive() {
    message = null;
    next = { kind: 'receive' };
    if (!view.remembered) open('enter');
    else if (app.settings.keyLock) open('lockpass');
    else void doReceive();
  }
  async function doReceive() {
    if (receiving) return;
    receiving = true;
    try {
      const lp = lockPass === '' ? undefined : lockPass;
      const prep = await sync.keys.prepareReceive(id);
      if (!prep.ok) return afterFail(prep, { kind: 'receive' });
      const ask =
        st?.notice === 'rollback'
          ? KEY_TEXT.rollbackReceive
          : st?.notice === 'conflict'
            ? KEY_TEXT.conflictReceive
            : prep.overwrite.length > 0
              ? KEY_TEXT.overwrite(prep.overwrite)
              : null;
      if (ask && !confirmFn(ask)) {
        sync.keys.cancelReceive();
        next = null;
        closeNow();
        return;
      }
      const r = await sync.keys.commitReceive(lp);
      if (!r.ok && r.message === KEY_TEXT.wrongLockPass) {
        lockPass = '';
        if (sheet === null) open('lockpass');
        return fail('lock', KEY_TEXT.wrongLockPass);
      }
      if (!r.ok) return afterFail(r, { kind: 'receive' });
      next = null;
      closeNow();
      report(r);
    } finally {
      receiving = false;
    }
  }
  function uploadLocal() {
    if (!confirmFn(KEY_TEXT.uploadConfirm)) return;
    message = null;
    next = { kind: 'upload' };
    if (!view.remembered) open('enter');
    else void runNext();
  }
  async function wipeFlow() {
    if (!confirmFn(KEY_TEXT.wipeConfirm)) return;
    report(await sync.keys.wipe());
  }
  function forgotPass() {
    next = null;
    closeNow();
    void wipeFlow();
  }
  function pickProvider(p: KeyProvider, checked: boolean) {
    pick = checked ? PROVIDERS.filter((x) => x === p || pick.includes(x)) : pick.filter((x) => x !== p);
  }
  async function setProvider(p: KeyProvider, checked: boolean, input: HTMLInputElement) {
    if (!st) return;
    const chosen = st.providers;
    const list = checked ? PROVIDERS.filter((x) => x === p || chosen.includes(x)) : chosen.filter((x) => x !== p);
    uploading = true;
    const r = await sync.keys.setProviders(id, list).finally(() => (uploading = false));
    if (!r.ok) input.checked = chosen.includes(p);
    report(r);
  }

  async function submitPass(e: SubmitEvent) {
    e.preventDefault();
    if (busy) return;
    const kind = sheet;
    if (kind === 'enter' && pass === '') return;
    if (kind === 'change' && current === '') return;
    if ((kind === 'enter' || kind === 'lockpass') && needLock && lockPass === '') return;
    if (kind === 'create' || kind === 'change') {
      const problem = checkSyncPassphrase(pass, pass2);
      if (problem) return fail(problem === 'mismatch' ? 'pass2' : 'pass', PASSPHRASE_TEXT[problem]);
    }
    busy = true;
    error = null;
    errorField = null;
    try {
      if (kind === 'create') {
        const r = await sync.keys.createVault(pass);
        pass = '';
        pass2 = '';
        if (!r.ok) {
          if (r.needsPass) {
            sheet = 'enter';
            return fail('pass', r.message);
          }
          return fail(null, r.message);
        }
      } else if (kind === 'enter') {
        const r = await sync.keys.unlockVault(pass);
        pass = '';
        if (!r.ok) return fail('pass', r.message);
      } else if (kind === 'change') {
        const r = await sync.keys.changePassphrase(current, pass);
        current = '';
        pass = '';
        pass2 = '';
        if (!r.ok) return fail(r.message === KEY_TEXT.wrongPass ? 'current' : r.message === KEY_TEXT.samePass ? 'pass' : null, r.message);
        closeNow();
        report(r);
        return;
      }
      if (!next) return closeNow();
      if (next.kind !== 'receive') closeNow();
      await runNext();
    } finally {
      busy = false;
    }
  }
</script>

{#snippet providerChecks(chosen: KeyProvider[], onpick: (p: KeyProvider, checked: boolean, input: HTMLInputElement) => void, prefix: string, pending: boolean = false)}
  <fieldset class="providers">
    <legend>올릴 키</legend>
    {#each PROVIDERS as p (p)}
      {@const checked = chosen.includes(p)}
      {@const noKey = !has[p] && !checked}
      {@const last = checked && chosen.length === 1}
      <div class="check-row">
        <label class="check">
          <input
            type="checkbox"
            {checked}
            disabled={pending || noKey || last}
            aria-describedby={noKey || last ? `${prefix}-${p}-why` : undefined}
            onchange={(e) => onpick(p, e.currentTarget.checked, e.currentTarget)}
          />
          {PROVIDER_LABEL[p]} 키
        </label>
        {#if noKey}
          <small id="{prefix}-{p}-why">{KEY_TEXT.noKeyHere}</small>
        {:else if last}
          <small id="{prefix}-{p}-why">{KEY_TEXT.keepOne}</small>
        {/if}
      </div>
    {/each}
    {#if chosen.includes('toss')}
      <p class="warn" role="status">{KEY_TEXT.tossWarning}</p>
    {/if}
  </fieldset>
{/snippet}

{#if view.support !== null}
  <section class="card keys" aria-labelledby="{uid}-title">
    <h3 id="{uid}-title">키 동기화 (암호화)</h3>
    {#if view.support === false}
      <p class="hint">{KEY_TEXT.oldWorker}</p>
    {:else if view.support === true}
      <div class="row">
        <div class="text">
          <b>이 프로필의 키도 동기화</b>
          <p>지금 프로필 「{name}」</p>
        </div>
        <Toggle
          checked={on}
          label="이 프로필의 키도 동기화"
          disabled={!on && offReason !== null}
          describedby={!on && offReason ? `${uid}-why` : undefined}
          onchange={onToggle}
        />
      </div>
      <p class="hint">고른 키를 동기화 암호로 잠가 올려요. 프록시 토큰은 올리지 않아요.</p>
      {#if !on && offReason}
        <p id="{uid}-why" class="hint">{offReason}</p>
      {/if}
      {#if on && st && st.revision > 0}
        {@render providerChecks(st.providers, setProvider, `${uid}-on`, uploading)}
      {/if}

      {#if view.accountNotice === 'vault-changed'}
        <p class="notice" role="status">
          {KEY_TEXT.vaultChanged}
          <button type="button" class="link" onclick={() => ((next = null), open('enter'))}>입력</button>
          <button type="button" class="link" onclick={() => sync.keys.dismissAccount()}>닫기</button>
        </p>
      {:else if view.accountNotice === 'vault-gone'}
        <p class="notice" role="status">
          {KEY_TEXT.noVault}
          <button type="button" class="link" onclick={() => sync.keys.dismissAccount()}>닫기</button>
        </p>
      {/if}

      {#if st?.notice === 'removed'}
        <p class="notice" role="status">
          {KEY_TEXT.removed}
          <button type="button" class="link" onclick={() => sync.keys.dismiss(id)}>닫기</button>
        </p>
      {:else if on && st}
        {#if st.notice === 'available' || st.notice === 'newer'}
          <p class="notice" role="status">
            {st.notice === 'available' ? KEY_TEXT.available : KEY_TEXT.newer}
            <button type="button" class="link" disabled={busy || receiving} onclick={receive}>받기</button>
          </p>
        {:else if st.notice === 'conflict' || st.notice === 'rollback'}
          <div class="notice" role="status">
            <p>{st.notice === 'conflict' ? KEY_TEXT.conflictNotice : KEY_TEXT.rollback}</p>
            <span class="actions">
              <button type="button" class="link" disabled={!canUpload} onclick={uploadLocal}>이 기기 키 올리기</button>
              <button type="button" class="link" disabled={busy || receiving} onclick={receive}>서버 키 받기</button>
            </span>
          </div>
        {:else if st.notice === 'missing-key'}
          <p class="notice" role="status">{KEY_TEXT.missingKey(missing)}</p>
        {/if}
        {#if dirty && !view.remembered}
          <p class="notice" role="status">
            {KEY_TEXT.pendingUpload}
            <button type="button" class="link" onclick={() => ((next = null), open('enter'))}>입력</button>
          </p>
        {/if}
      {/if}

      <p class="sr" aria-live="polite">{uploading ? '올리는 중…' : ''}</p>
      {#if view.problem}
        <p class="warn" role="status">{view.problem}</p>
      {/if}
      {#if message}
        <p class="warn" role="alert">
          {message}
          {#if offerDelete}<button type="button" class="link" onclick={() => void turnOff()}>서버 키 지우기(이 프로필)</button>{/if}
        </p>
      {/if}

      {#if view.vault}
        <div class="row">
          <p class="text">{view.remembered ? '동기화 암호: 이 탭에서 기억 중' : '동기화 암호: 기억하지 않음'}</p>
          {#if view.remembered}
            <button type="button" class="btn" onclick={() => sync.keys.forget()}>잊기</button>
          {:else}
            <button type="button" class="btn" onclick={() => ((next = null), open('enter'))}>입력</button>
          {/if}
        </div>
        <div class="row actions">
          <button type="button" class="btn" onclick={() => ((next = null), open('change'))}>동기화 암호 바꾸기</button>
          <button type="button" class="btn danger" onclick={() => void wipeFlow()}>서버의 키 모두 지우기</button>
        </div>
      {/if}

      {#if others.length > 0}
        <ul class="others" aria-label="다른 프로필의 키 알림">
          {#each others as o (o.profileId)}
            <li>「{otherName(o.profileId)}」 받을 키가 있어요 — {KEY_TEXT.otherProfile}</li>
          {/each}
        </ul>
      {/if}
    {/if}
  </section>
{/if}

<Sheet open={sheet === 'risk'} title="키를 서버에 올리기 전에 확인해 주세요" onclose={close}>
  <div class="sheet-form">
    <ul class="risk">
      <li>KIS 앱 키는 계좌를 연결하면 주문 API도 부를 수 있어요. 토스 키도 주문 권한이 있어요.</li>
      <!-- 문구는 설계 5.16 그대로. 한 줄로 둔다(줄바꿈이 글자 사이에 공백을 넣지 않게) -->
      <li>서버(Cloudflare)에는 동기화 암호로 잠근 암호문만 올라가요. 암호는 서버로 보내지 않아요. 그래도 서버 자료가 새어 나가면 암호를 하나씩 대입해 풀어 볼 수 있어요. 짧거나 다른 곳에서 쓰는 암호는 피해 주세요. 이 기기 잠금 암호와 같은 암호를 쓰면, 키를 담아 내보낸 파일이나 이 기기 저장소에서 잠금 암호를 알아낸 사람이 서버 키도 풀 수 있어요.</li>
      <li>동기화 암호를 잊으면 서버 사본은 아무도 되살릴 수 없어요. 그때는 서버의 키를 모두 지우고 새 암호로 다시 시작해요.</li>
      <li>받은 기기는 그 기기의 키 잠금 설정대로 키를 보관해요. 여기서 끄거나 지워도 이미 받은 기기의 키는 남아요.</li>
    </ul>
    {@render providerChecks(pick, pickProvider, `${uid}-risk`)}
    <label class="check"><input type="checkbox" bind:checked={understood} data-autofocus /> 위 내용을 이해했어요</label>
    <div class="row end">
      <button type="button" class="ghost" onclick={close}>취소</button>
      <button type="button" class="accent" disabled={!understood || pick.length === 0} onclick={continueRisk}>계속</button>
    </div>
  </div>
</Sheet>

<Sheet open={passSheet !== null} title={passSheet ? TITLES[passSheet] : ''} onclose={close}>
  <form class="sheet-form" onsubmit={submitPass} novalidate>
    {#if passSheet === 'change'}
      <label for="{uid}-current">현재 동기화 암호</label>
      <input id="{uid}-current" type="password" autocomplete="current-password" bind:value={current} {...invalid('current')} data-autofocus />
    {/if}
    {#if passSheet === 'create' || passSheet === 'enter' || passSheet === 'change'}
      <label for="{uid}-pass">{passSheet === 'change' ? '새 동기화 암호' : '동기화 암호'}</label>
      <input
        id="{uid}-pass"
        type="password"
        autocomplete={passSheet === 'enter' ? 'current-password' : 'new-password'}
        bind:value={pass}
        {...invalid('pass')}
        data-autofocus={passSheet !== 'change' ? true : undefined}
      />
      {#if passSheet !== 'enter' && hasEdgeSpace(pass)}<p class="hint">{EDGE_SPACE_TEXT}</p>{/if}
    {/if}
    {#if passSheet === 'create' || passSheet === 'change'}
      <label for="{uid}-pass2">{passSheet === 'change' ? '새 동기화 암호 확인' : '동기화 암호 확인'}</label>
      <input id="{uid}-pass2" type="password" autocomplete="new-password" bind:value={pass2} {...invalid('pass2')} />
    {/if}
    {#if needLock && (passSheet === 'enter' || passSheet === 'lockpass')}
      <label for="{uid}-lock">이 기기 잠금 암호</label>
      <input
        id="{uid}-lock"
        type="password"
        autocomplete="current-password"
        bind:value={lockPass}
        {...invalid('lock')}
        data-autofocus={passSheet === 'lockpass' ? true : undefined}
      />
    {/if}
    {#if error}<p id={errorId} class="error" role="alert">{error}</p>{/if}
    <p class="sr" aria-live="polite">{busy ? '확인하는 중…' : ''}</p>
    <div class="row end">
      {#if passSheet === 'enter'}
        <button type="button" class="link" disabled={busy} onclick={forgotPass}>암호를 잊었어요</button>
      {/if}
      <button type="button" class="ghost" disabled={busy} onclick={close}>취소</button>
      <button type="submit" class="accent" disabled={busy}>{busy ? '확인하는 중…' : '확인'}</button>
    </div>
  </form>
</Sheet>

<style>
  .card {
    background: var(--surface);
    border-radius: var(--r-card);
    padding: 4px 16px 8px;
    margin-top: 8px;
  }
  h3 {
    font-size: var(--fs-body);
    font-weight: 700;
    padding: 12px 0 4px;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px 12px;
    padding: 10px 0;
  }
  .row.end {
    justify-content: flex-end;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .text b {
    font-size: var(--fs-body);
  }
  .text p,
  .hint,
  .notice,
  .others li {
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  .warn {
    font-size: var(--fs-sub);
    color: var(--warn);
    padding: 6px 0;
  }
  .error {
    font-size: var(--fs-sub);
    color: var(--warn);
  }
  .providers {
    border: 0;
    padding: 4px 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .providers legend {
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  .check-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .check {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: var(--touch);
  }
  .check-row small {
    color: var(--t3);
    font-size: var(--fs-sub);
  }
  .risk {
    list-style: disc;
    padding-left: 20px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  .sheet-form {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .sheet-form input[type='password'] {
    min-height: var(--touch);
    border-radius: 10px;
    border: 1px solid var(--line);
    padding: 0 10px;
    background: var(--surface);
    color: var(--t1);
  }
  .btn,
  .accent,
  .ghost {
    min-height: var(--touch);
    padding: 0 14px;
    border-radius: 12px;
    font-weight: 700;
  }
  .btn,
  .ghost {
    background: var(--surface2);
    color: var(--t1);
  }
  .accent {
    background: var(--accent);
    color: var(--on-accent, #fff);
  }
  .accent:disabled,
  .btn:disabled {
    opacity: 0.5;
  }
  .danger {
    color: var(--warn);
  }
  .link {
    text-decoration: underline;
    color: var(--t1);
    min-height: var(--touch);
  }
  .link:disabled {
    opacity: 0.5;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
</style>
