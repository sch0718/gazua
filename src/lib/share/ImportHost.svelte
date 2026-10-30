<script lang="ts">
  // 받은 공유 가져오기 확인 창(설계 4.8). 관문·온보딩을 지나 일반 화면이 되면 대기 값을 읽어 연다.
  // 확인 없이는 아무것도 저장하지 않고, 기존 데이터를 덮어쓰지 않고 늘 새로 만든다(설계 5.4).
  import { Sheet, showSnackbar } from '@sch0718/ui-svelte';
  import { tick, untrack } from 'svelte';
  import type { UniverseItem } from '../data/universe';
  import type { App } from '../state/app.svelte';
  import type { RouteName } from '../state/routes';
  import { sharedUniverse } from '../../sheets/universeSource';
  import { applyImport, planImport, type ImportApplied, type ImportPlan, type ImportState } from './importPlan';
  import { isKakaoInApp } from './inApp';
  import { clearImport, markImported, peekImport, wasImported, type PendingImport } from './pendingImport';
  import { compareViewText } from './shareText';

  let {
    app,
    universe = sharedUniverse,
    ua = globalThis.navigator?.userAgent ?? '',
    now = Date.now,
  }: {
    app: App;
    universe?: () => Promise<UniverseItem[]>;
    ua?: string;
    now?: () => number;
  } = $props();

  /** 관문(profiles·unlock)·온보딩·공유 화면에서는 열지 않는다 */
  const NORMAL: readonly RouteName[] = ['compare', 'simulate', 'performance', 'settings', 'help'];

  let pending = $state.raw<PendingImport | null>(null);
  let plan = $state.raw<ImportPlan | null>(null);
  let codes = $state.raw<ReadonlySet<string> | null>(null);
  let applyView = $state(true);
  let loading = false;

  const current = (): ImportState => ({ watchlists: app.watchlists, strategies: app.strategies, criteria: app.criteria, baskets: app.baskets, universe: codes });
  const profileName = $derived(app.meta.profiles.find((p) => p.id === app.meta.activeProfileId)?.name ?? '');

  $effect(() => {
    const name = app.route.name;
    if (!NORMAL.includes(name)) {
      // 관문·공유 화면으로 옮기면 창만 닫는다. 대기 값은 복귀할 때 다시 읽는다.
      pending = null;
      plan = null;
      return;
    }
    untrack(() => {
      if (pending || loading) return;
      const p = peekImport(now());
      if (!p) return;
      if (wasImported(p.id)) {
        clearImport();
        showSnackbar('이미 가져왔어요');
        return;
      }
      loading = true;
      let timeout: ReturnType<typeof setTimeout>;
      const timedOut = new Promise<null>((resolve) => {
        timeout = setTimeout(() => resolve(null), 10_000);
      });
      // 목록을 받지 못해도 가져올 수 있다. 늦은 응답은 계획을 바꾸지 않는다.
      Promise.race([
        universe().then(
          (items) => new Set(items.map((u) => u.s)),
          () => null,
        ),
        timedOut,
      ])
        .finally(() => clearTimeout(timeout))
        .then((set) => {
          loading = false;
          if (!NORMAL.includes(app.route.name)) return;
          codes = set;
          applyView = true;
          plan = planImport(p, current());
          pending = p;
        });
    });
  });

  function close() {
    clearImport();
    pending = null;
    plan = null;
  }

  /** 이동한 화면의 첫 제목으로 포커스(설계 8절) */
  async function focusLanding() {
    await tick();
    for (const selector of ['[data-landing-title]', 'main h1', 'main h2', 'h1, h2', 'main']) {
      for (const el of document.querySelectorAll<HTMLElement>(selector)) {
        if (el.hidden || getComputedStyle(el).display === 'none') continue;
        const addedTabindex = !el.hasAttribute('tabindex');
        if (addedTabindex) el.setAttribute('tabindex', '-1');
        el.focus();
        if (document.activeElement === el) return;
        if (addedTabindex) el.removeAttribute('tabindex');
      }
    }
  }

  function write(applied: ImportApplied, before: ImportState) {
    // 묶음 → 기준 순서. 기준 쓰기가 실패하면 방금 더한 묶음을 되돌린다(설계 4.8)
    if (applied.baskets) app.setBaskets(applied.baskets);
    try {
      if (applied.criteria) app.setCriteria(applied.criteria);
    } catch (e) {
      if (applied.baskets) app.setBaskets(before.baskets);
      throw e;
    }
    if (applied.strategies) app.setStrategies(applied.strategies);
    if (applied.watchlists) app.setWatchlists(applied.watchlists);
    if (applied.settings) app.updateSettings(applied.settings);
  }

  function save() {
    const p = pending;
    if (!p || !plan || plan.blocked) return;
    // 두 탭이 함께 창을 띄운 경우: 쓰기 직전에 한 번 더 본다
    if (wasImported(p.id)) {
      close();
      showSnackbar('이미 가져왔어요');
      return;
    }
    const before = current();
    try {
      const applied = applyImport(p, before, { now: now(), applyView });
      write(applied, before);
      markImported(p.id);
      close();
      app.navigate(applied.route);
      showSnackbar('가져왔어요');
      void focusLanding();
    } catch {
      showSnackbar('가져오지 못했어요');
    }
  }
</script>

<Sheet open={pending !== null && plan !== null} title="이 프로필에 저장할까요?" onclose={close}>
  {#if pending && plan}
    <div class="imp">
      {#if isKakaoInApp(ua)}<p class="where">지금 이 브라우저(카카오톡)에 저장돼요</p>{/if}
      <p>「{profileName}」 프로필에 저장해요</p>
      <ul class="lines" aria-label="만들 것">
        {#each plan.lines as line, i (i)}<li>{line}</li>{/each}
      </ul>
      {#if plan.notes.length > 0}
        <ul class="notes" aria-label="안내">
          {#each plan.notes as note, i (i)}<li>{note}</li>{/each}
        </ul>
      {/if}
      {#if plan.view}
        <label class="check">
          <input type="checkbox" bind:checked={applyView} />
          보기 설정도 적용
        </label>
        <p class="sub">{compareViewText(plan.view)}</p>
      {/if}
      {#if plan.blocked}
        <p class="err" role="alert">{plan.blocked}</p>
        <p class="sub">목록을 정리한 뒤 공유 링크를 다시 열면 가져올 수 있어요</p>
        <button type="button" class="primary" onclick={close}>닫기</button>
      {:else}
        <button type="button" class="primary" onclick={save}>저장</button>
        <button type="button" class="ghost" onclick={close}>저장하지 않기</button>
      {/if}
    </div>
  {/if}
</Sheet>

<style>
  .imp {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 0 20px 8px;
    font-size: var(--fs-body);
  }
  .where {
    font-weight: 700;
  }
  .lines,
  .notes {
    background: var(--surface2);
    border-radius: 12px;
    padding: 10px 14px 10px 28px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .notes,
  .sub {
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  .check {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: var(--touch);
  }
  .err {
    color: var(--err);
  }
  .primary,
  .ghost {
    min-height: var(--touch);
    border-radius: 12px;
    font-weight: 700;
  }
  .primary {
    background: var(--accent);
    color: var(--on-accent);
  }
  .ghost {
    background: var(--surface2);
  }
</style>
