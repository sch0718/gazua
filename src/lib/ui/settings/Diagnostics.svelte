<script lang="ts">
  // 연결 진단(스펙 7.4, 목업 ⑤): 4단계가 차례로 진행되고, 실패한 단계에 원인과 해결책을 보인다.
  import { onDestroy } from 'svelte';
  import { runDiagnostics, type DiagStep } from '../../providers/diagnostics';
  import { describeError } from '../../providers/errors';
  import type { App } from '../../state/app.svelte';
  import { showSnackbar } from '../components/snackbarStore.svelte';

  let {
    app,
    fetchImpl,
    onsuccess,
  }: { app: App; fetchImpl?: typeof fetch; onsuccess?: () => void } = $props();

  const MARKS = ['①', '②', '③', '④'];

  let steps = $state<DiagStep[] | null>(null);
  let running = $state(false);
  let runId = 0;
  onDestroy(() => {
    runId++;
  });

  const provider = $derived(app.settings.provider);

  async function start() {
    const p = provider;
    if (p === 'demo' || running) return;
    const id = ++runId;
    running = true;
    try {
      const result = await runDiagnostics({
        proxyUrl: app.settings.proxyUrl,
        provider: p,
        secrets: app.secrets ?? {},
        fetchImpl,
        onStep: (s) => {
          if (id === runId) steps = s;
        },
      });
      if (id !== runId) return;
      steps = result;
      if (result.every((s) => s.status === 'ok')) onsuccess?.();
    } finally {
      if (id === runId) running = false;
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      showSnackbar('주소를 복사했어요');
    } catch {
      showSnackbar('복사하지 못했어요. 직접 입력해 주세요');
    }
  }
</script>

<div class="card">
  {#if provider === 'demo'}
    <p class="note">데모 데이터는 진단할 연결이 없어요. 공급자를 고르고 프록시와 키를 넣어 주세요.</p>
  {:else}
    {#if steps}
      <ul class="diag" aria-live="polite">
        {#each steps as s (s.id)}
          <li class={s.status}>
            <span class="ck" aria-hidden="true">
              {s.status === 'ok' ? '✓' : s.status === 'fail' ? '!' : s.status === 'running' ? '…' : s.id}
            </span>
            <span class="label">{MARKS[s.id - 1]} {s.label}</span>
            <span class="ms num">
              {#if s.status === 'ok'}{s.ms}ms{:else if s.status === 'running'}확인 중{:else if s.status === 'fail'}실패{:else if s.status === 'skipped'}건너뜀{/if}
            </span>
          </li>
          {#if s.status === 'fail' && s.error}
            <li class="fix">
              <b>{describeError(s.error).title}</b>
              {#if s.hint}<span>{s.hint}</span>{/if}
              {#if s.copy}
                <button type="button" class="link" onclick={() => copy(s.copy!)}>허용할 주소 복사</button>
              {/if}
            </li>
          {/if}
        {/each}
      </ul>
    {:else}
      <p class="note">프록시 → CORS → 토큰 → 시세 순서로 어디서 막히는지 확인해요.</p>
    {/if}
    <button type="button" class="wide" disabled={running} onclick={start}>
      {running ? '진단 중…' : steps ? '다시 진단' : '진단 시작'}
    </button>
  {/if}
</div>

<style>
  .card {
    background: var(--surface);
    border-radius: var(--r-card);
    padding: 4px 14px 14px;
  }
  .note {
    color: var(--t2);
    font-size: var(--fs-sub);
    padding: 12px 0;
  }
  .diag {
    list-style: none;
    padding: 4px 0 12px;
  }
  .diag li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
    font-size: 14px;
  }
  .ck {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 12px;
    font-weight: 800;
    color: #fff;
    background: var(--line);
    flex: none;
  }
  .ok .ck {
    background: var(--ok);
  }
  .fail .ck {
    background: var(--err);
  }
  .running .ck {
    background: var(--accent);
  }
  .pending,
  .skipped {
    opacity: 0.45;
  }
  .ms {
    margin-left: auto;
    font-size: 12px;
    color: var(--t3);
  }
  .diag li.fix {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    font-size: 12.5px;
    color: var(--t2);
    background: var(--surface2);
    border-radius: 10px;
    padding: 8px 10px;
    margin: 0 0 6px 32px;
  }
  .fix b {
    color: var(--t1);
  }
  .link {
    color: var(--accent);
    font-weight: 700;
    min-height: var(--touch);
  }
  .wide {
    width: 100%;
    min-height: var(--touch);
    border-radius: 12px;
    background: var(--t1);
    color: var(--bg);
    font-weight: 700;
  }
  .wide:disabled {
    opacity: 0.6;
  }
</style>
