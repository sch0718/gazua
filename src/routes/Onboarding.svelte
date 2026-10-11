<script lang="ts">
  // 첫 실행 온보딩(스펙 7.5, 목업 ⑥): ① 환영 → ② 공급자 → ③ 프록시 → ④ 키 → ⑤ 진단.
  // 어느 단계에서든 `데모로 둘러보기`로 빠져나가면 데모 모드로 들어가고 상단에 데모 배너가 뜬다.
  import { tick, untrack } from 'svelte';
  import type { App } from '../lib/state/app.svelte';
  import { createGroup, addItem } from '../lib/state/watchlist';
  import type { Group } from '../lib/state/schema';
  import { EXAMPLE_SYMBOLS } from '../lib/ui/compare/compareView';
  import ConnectionForm from '../lib/ui/settings/ConnectionForm.svelte';
  import Diagnostics from '../lib/ui/settings/Diagnostics.svelte';
  import KeyLock from '../lib/ui/settings/KeyLock.svelte';
  import ProviderCards from '../lib/ui/settings/ProviderCards.svelte';

  let {
    app,
    fetchImpl,
    now = () => Date.now(),
  }: { app: App; fetchImpl?: typeof fetch; now?: () => number } = $props();

  const STEPS = 5;
  const README = 'https://github.com/sch0718/gazua/blob/main/proxy/README.md';

  let step = $state(1);
  // 목업 ⑥처럼 처음엔 KIS가 골라져 있다.
  let choice = $state<'kis' | 'toss' | 'demo'>(
    untrack(() => (app.settings.provider === 'demo' ? 'kis' : app.settings.provider)),
  );
  let lockPrompt = $state(false);
  let diagnosed = $state(false);

  const provider = $derived(app.settings.provider);

  // 단계가 바뀌면 새 단계의 제목으로 포커스를 옮긴다(스크린리더가 새 내용을 읽도록). 처음 열 때는 옮기지 않는다.
  let heading = $state<HTMLElement>();
  let shownStep = untrack(() => step);
  $effect(() => {
    const current = step;
    if (current === shownStep) return;
    shownStep = current;
    void tick().then(() => heading?.focus());
  });

  function go(n: number) {
    step = Math.min(STEPS, Math.max(1, n));
    lockPrompt = false;
    if (step !== 5) diagnosed = false;
  }

  function demo() {
    app.updateSettings({ provider: 'demo', onboarded: true });
    app.navigate({ name: 'compare' });
  }

  function chooseProvider() {
    if (choice === 'demo') return demo();
    if (app.settings.provider !== choice) app.updateSettings({ provider: choice });
    go(3);
  }

  function keysSaved() {
    // 토스 키는 주문 권한이 있어 잠금을 권한다(강제하지 않는다).
    if (app.settings.provider === 'toss' && !app.settings.keyLock) {
      lockPrompt = true;
      return;
    }
    go(5);
  }

  /** 첫 그룹에 예시 종목을 채운다(가득 차면 들어가는 만큼만). 그룹이 없으면 `반도체` 그룹을 만든다. */
  function withExample(): string | undefined {
    let w = app.watchlists;
    if (w.groups.length === 0) w = createGroup(w, '반도체');
    const first = w.groups[0];
    let filled: Group = first;
    for (const s of EXAMPLE_SYMBOLS) {
      try {
        filled = addItem(filled, s, now());
      } catch {
        break;
      }
    }
    app.setWatchlists({ ...w, groups: w.groups.map((g) => (g.id === first.id ? filled : g)) });
    return first.id;
  }

  function finish(example: boolean) {
    const groupId = example ? withExample() : app.watchlists.groups[0]?.id;
    app.updateSettings({ onboarded: true });
    app.navigate(groupId ? { name: 'compare', groupId } : { name: 'compare' });
  }
</script>

<div class="onboarding">
  <div
    class="steps"
    role="progressbar"
    aria-label="온보딩 진행"
    aria-valuemin={1}
    aria-valuemax={STEPS}
    aria-valuenow={step}
    aria-valuetext="{STEPS}단계 중 {step}단계"
  >
    {#each Array.from({ length: STEPS }, (_, i) => i + 1) as n (n)}
      <i class:on={n <= step}></i>
    {/each}
  </div>

  <div class="appbar">
    {#if step > 1}
      <button type="button" class="back" aria-label="이전 단계" onclick={() => (lockPrompt ? (lockPrompt = false) : go(step - 1))}>
        ‹
      </button>
    {/if}
    {#if step > 1}
      <button type="button" class="demo" onclick={demo}>데모로 둘러보기</button>
    {/if}
  </div>

  <section class="body">
    {#if step === 1}
      <h1 class="page-title" tabindex="-1" bind:this={heading}>가즈아</h1>
      <p class="sub">관심 종목을 한 차트에 겹쳐 놓고, 어느 종목이 더 올랐는지 한눈에 비교해요.</p>
      <div class="actions">
        <button type="button" class="primary" onclick={() => go(2)}>내 API로 시작</button>
        <button type="button" class="ghost" onclick={demo}>데모로 둘러보기</button>
      </div>
    {:else if step === 2}
      <h1 class="page-title" tabindex="-1" bind:this={heading}>어디서 시세를<br />가져올까요?</h1>
      <p class="sub">키와 설정은 이 브라우저에만 저장돼요. 서버로 보내지 않아요.</p>
      <ProviderCards variant="onboarding" value={choice} onchange={(v) => (choice = v)} />
      <div class="actions">
        <button type="button" class="primary" onclick={chooseProvider}>
          {choice === 'demo' ? '데모로 시작' : '다음 — 프록시 연결'}
        </button>
      </div>
    {:else if step === 3}
      <h1 class="page-title" tabindex="-1" bind:this={heading}>프록시 주소를<br />알려 주세요</h1>
      <p class="sub">
        {#if provider === 'toss'}
          토스증권은 허용한 IP에서만 호출돼요. 집 PC·NAS처럼 고정 IP가 있는 곳에 프록시를 띄워 주세요.
        {:else}
          브라우저는 증권사 API를 바로 부를 수 없어서 작은 프록시를 거쳐요. 무료 Cloudflare Worker로 만들 수 있어요.
        {/if}
      </p>
      <a class="guide" href={README} target="_blank" rel="noopener noreferrer">배포 방법 보기</a>
      <ConnectionForm {app} section="proxy" submitLabel="다음 — 키 입력" onsaved={() => go(4)} />
    {:else if step === 4}
      <h1 class="page-title" tabindex="-1" bind:this={heading}>키를 넣어 주세요</h1>
      {#if lockPrompt}
        <p class="sub">키를 저장했어요. 토스 키로는 주문도 할 수 있으니 암호로 잠가 두면 안전해요.</p>
        <KeyLock {app} />
        <div class="actions">
          {#if app.settings.keyLock}
            <button type="button" class="primary" onclick={() => go(5)}>다음 — 연결 진단</button>
          {:else}
            <button type="button" class="ghost" onclick={() => go(5)}>나중에 잠글게요</button>
          {/if}
        </div>
      {:else}
        <p class="sub">
          {#if provider === 'toss'}
            토스증권 WTS › 설정 › Open API에서 발급한 Client ID와 Client Secret을 넣어 주세요.
          {:else}
            KIS Developers에서 발급한 App Key와 App Secret을 넣어 주세요.
          {/if}
        </p>
        <ConnectionForm {app} section="keys" submitLabel="다음 — 연결 진단" onsaved={keysSaved} />
      {/if}
    {:else}
      <h1 class="page-title" tabindex="-1" bind:this={heading}>연결을 확인할게요</h1>
      <p class="sub">프록시 → CORS → 토큰 → 시세 순서로 확인해요. 막히면 무엇을 고치면 되는지 알려 드려요.</p>
      <Diagnostics {app} {fetchImpl} onsuccess={() => (diagnosed = true)} />
      {#if diagnosed}
        <div class="actions">
          <button type="button" class="primary" onclick={() => finish(true)}>예시 그룹으로 시작</button>
          <button type="button" class="ghost" onclick={() => finish(false)}>빈 그룹으로 시작</button>
        </div>
      {/if}
    {/if}
  </section>
</div>

<style>
  .onboarding {
    width: 100%;
    max-width: 520px;
    margin: 0 auto;
    padding: 12px 0 40px;
  }
  .steps {
    display: flex;
    gap: 6px;
    padding: 4px 20px 0;
  }
  .steps i {
    height: 4px;
    flex: 1;
    border-radius: 2px;
    background: var(--line);
    transition: background var(--dur-base) var(--ease);
  }
  .steps i.on {
    background: var(--accent);
  }
  .appbar {
    display: flex;
    align-items: center;
    min-height: 52px;
    padding: 0 8px;
  }
  .back {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    font-size: 24px;
    color: var(--t2);
  }
  .demo {
    margin-left: auto;
    min-height: var(--touch);
    padding: 0 12px;
    font-size: 14px;
    color: var(--t2);
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 0 20px;
  }
  .page-title:focus {
    outline: none;
  }
  .page-title {
    font-size: 26px;
    font-weight: 800;
    letter-spacing: -0.02em;
    line-height: 1.25;
    margin-top: 12px;
  }
  .sub {
    font-size: 14px;
    color: var(--t2);
    margin-bottom: 4px;
  }
  .guide {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    min-height: var(--touch);
    color: var(--accent);
    font-weight: 700;
    font-size: 14px;
  }
  .actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 12px;
  }
  .primary,
  .ghost {
    min-height: 50px;
    border-radius: 14px;
    font-weight: 800;
    font-size: var(--fs-body);
  }
  .primary {
    background: var(--accent);
    color: var(--on-accent);
  }
  .ghost {
    background: var(--surface2);
    color: var(--t1);
  }
</style>
