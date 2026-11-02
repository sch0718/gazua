<script lang="ts">
  // 먼저 요청한 CLI의 이름·시각·위치를 조회하고, 확인한 코드만 승인·거절한다.
  import { Sheet } from '@sch0718/ui-svelte';
  import type { SyncController } from '../../sync/controller.svelte';
  import { agoText, cliCodeComplete, formatCliCode } from '../../sync/cliCode';

  let { sync, now = () => Date.now() }: { sync: SyncController; now?: () => number } = $props();
  type Info = { code: string; label: string; createdAt: number; geo: string | null; scope: 'read' | 'market-upload' };
  const FAIL_TEXT = {
    'invalid-code': '코드가 맞지 않거나 시간이 지났어요. `gazua login`을 다시 실행해 주세요',
    outdated: '서버 업데이트가 필요해요',
    error: '확인하지 못했어요. 잠시 뒤 다시 시도해 주세요',
  } as const;

  let code = $state('');
  let info = $state<Info | null>(null);
  let note = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);
  let busy = $state(false);
  const detail = $derived(info ? (info.geo ? `${info.geo}, ${agoText(info.createdAt, now())}` : agoText(info.createdAt, now())) : '');

  async function lookup(e: Event) {
    e.preventDefault();
    if (busy || !cliCodeComplete(code)) return;
    busy = true;
    note = null;
    const asked = code;
    const r = await sync.cliApprove(asked);
    busy = false;
    if (code !== asked) return; // 조회 중 입력이 바뀌면 옛 코드 정보를 버린다.
    if (r.ok) info = { code: asked, ...r.info };
    else note = { kind: 'error', text: FAIL_TEXT[r.reason] };
  }

  async function decide(approve: boolean) {
    if (busy || !info) return;
    busy = true;
    const target = info.code;
    const r = await sync.cliApprove(target, approve);
    busy = false;
    info = null;
    if (r.ok) {
      note = { kind: 'ok', text: approve ? '연결했어요. 터미널로 돌아가세요' : '거절했어요' };
      if (code === target) code = '';
    } else {
      note = { kind: 'error', text: FAIL_TEXT[r.reason] };
    }
  }
</script>

<div class="row col" role="group" aria-label="CLI 연결">
  <div class="text">
    <b>CLI 연결</b>
    <p>터미널에서 <code>gazua login</code>을 실행하면 나오는 코드를 넣어 주세요.</p>
  </div>
  <form class="line" onsubmit={lookup}>
    <input
      id="cli-code"
      aria-label="CLI 코드"
      autocomplete="off"
      autocapitalize="characters"
      spellcheck="false"
      maxlength="9"
      placeholder="XXXX-XXXX"
      value={code}
      oninput={(e) => {
        code = formatCliCode(e.currentTarget.value);
        e.currentTarget.value = code;
        if (info && info.code !== code) info = null;
      }}
    />
    <button type="submit" class="btn primary" disabled={busy || !cliCodeComplete(code)}>확인</button>
  </form>
  {#if note}
    <p class={note.kind === 'error' ? 'warn' : 'done'} role={note.kind === 'error' ? 'alert' : 'status'}>{note.text}</p>
  {/if}
</div>

<Sheet open={info !== null} title={info?.scope === 'market-upload' ? '시장 파일 올리기를 허락할까요?' : '읽기 전용 접근을 허락할까요?'} onclose={() => (info = null)}>
  {#if info}
    <div class="sheet-form">
      {#if info.scope === 'market-upload'}
        <p><code>{info.label}</code>에서 요청했어요({detail}). 시장 파일 목록을 올리고 지울 수 있어요. 관심 그룹·전략·키는 읽지 못해요. 직접 실행한 명령에서 나온 코드만 승인하세요.</p>
      {:else}
        <p><code>{info.label}</code>에서 요청했어요({detail}). 관심 그룹·전략을 읽을 수 있고, 바꾸거나 주문할 수는 없어요. 직접 실행한 명령에서 나온 코드만 승인하세요.</p>
      {/if}
      <div class="actions">
        <button type="button" class="btn" disabled={busy} onclick={() => decide(false)}>거절</button>
        <button type="button" class="btn primary" disabled={busy} onclick={() => decide(true)}>허락</button>
      </div>
    </div>
  {/if}
</Sheet>

<style>
  .row {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 0;
    border-bottom: 1px solid var(--line);
  }
  .text b { font-size: var(--fs-body); }
  .text p,
  .sheet-form p {
    font-size: var(--fs-sub);
    color: var(--t2);
    margin-top: 2px;
  }
  code {
    font-family: var(--mono, ui-monospace, monospace);
    overflow-wrap: anywhere;
  }
  .line { display: flex; gap: 8px; }
  input {
    flex: 1;
    min-width: 0;
    min-height: var(--touch);
    border-radius: 10px;
    border: 1px solid var(--line);
    padding: 0 10px;
    background: var(--surface);
    color: var(--t1);
    letter-spacing: 0.12em;
    text-transform: uppercase;
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
  .btn.primary { background: var(--accent); color: var(--on-accent, #fff); }
  .btn:disabled { opacity: 0.5; }
  .warn { font-size: var(--fs-sub); color: var(--warn); }
  .done { font-size: var(--fs-sub); color: var(--t1); }
  .sheet-form { display: flex; flex-direction: column; gap: 12px; }
  .actions { display: flex; gap: 8px; justify-content: flex-end; }
</style>
