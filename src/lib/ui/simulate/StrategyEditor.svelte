<script lang="ts">
  // 전략 편집(스펙 7.3): 접힌 7개 구역 + 맨 아래 실행 버튼. 고치는 즉시 작업본에 반영하고 500ms 쉬면 저장한다.
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import type { UniverseItem } from '../../data/universe';
  import { MAX_STRATEGIES, NAME_MAX } from '../../sim/defaults';
  import type { Strategy } from '../../sim/types';
  import { strategyIssues, type Issue } from '../../sim/validate';
  import type { App } from '../../state/app.svelte';
  import { sharedUniverse } from '../../../sheets/universeSource';
  import { showSnackbar } from '../components/snackbarStore.svelte';
  import BenchmarkSection from './editor/BenchmarkSection.svelte';
  import CostSection from './editor/CostSection.svelte';
  import EditorSection from './editor/EditorSection.svelte';
  import EntrySection from './editor/EntrySection.svelte';
  import ExitSection from './editor/ExitSection.svelte';
  import PeriodSection from './editor/PeriodSection.svelte';
  import ScaleInSection from './editor/ScaleInSection.svelte';
  import UniverseSection from './editor/UniverseSection.svelte';
  import { sectionSummary } from './simText';
  import { STRATEGY_CAP_MESSAGE } from '../../sim/strategyStore';
  import { duplicateStrategy } from './strategyActions.svelte';

  let {
    app,
    strategy,
    onRun,
    ondraft,
    openRequest = null,
    loadItems = sharedUniverse,
  }: {
    app: App;
    strategy: Strategy;
    /** 막는 경고가 없을 때 저장 대기분을 저장한 뒤 작업본(사본)을 넘긴다 */
    onRun: (draft: Strategy) => void;
    /** 작업본이 바뀔 때마다(처음 포함) 사본을 알린다. 결과가 오래됐는지 비교하는 데 쓴다 */
    ondraft?: (draft: Strategy) => void;
    /** 결과 화면에서 `규칙 고치기`로 들어올 때 열 구역. seq가 바뀔 때마다 한 번 연다 */
    openRequest?: { section: Issue['section']; seq: number } | null;
    loadItems?: () => Promise<UniverseItem[]>;
  } = $props();

  const SAVE_MS = 500;
  type Key = 'universe' | 'period' | 'entry' | 'scaleIn' | 'exit' | 'benchmarks' | 'costs';
  const SECTIONS: { key: Key; title: string }[] = [
    { key: 'universe', title: '종목' },
    { key: 'period', title: '기간·자금' },
    { key: 'entry', title: '매수' },
    { key: 'scaleIn', title: '분할 매수' },
    { key: 'exit', title: '매도' },
    { key: 'benchmarks', title: '비교 기준' },
    { key: 'costs', title: '비용' },
  ];
  // 자금(capital) 경고는 기간·자금 구역에서 보인다(분할 매수를 켰으면 분할 매수 구역에도, sectionIssues).
  const keyOf = (s: Issue['section']): Key => (s === 'capital' ? 'period' : s);

  // 작업본: 편집은 여기에 바로 반영하고, 저장은 디바운스한다. 편집기는 전략마다 새로 만들어진다.
  const profile = untrack(() => app.meta.activeProfileId);
  let draft = $state<Strategy>(untrack(() => $state.snapshot(strategy) as Strategy));
  let nameText = $state(untrack(() => strategy.name));
  let openKeys = $state<Partial<Record<Key, boolean>>>({});
  let universe = $state.raw<UniverseItem[] | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;
  const uid = Math.random().toString(36).slice(2, 9);

  // 불변식: flush는 저장된 전략 전체를 작업본으로 덮어쓴다. 그래도 안전한 이유 —
  // 목록과 편집은 동시에 열리지 않고(다른 곳에서 이 전략을 고치지 않는다), 실행은 전략을 쓰지 않는다(작업본 사본만 읽는다).
  function flush() {
    clearTimeout(timer);
    timer = undefined;
    if (!dirty) return;
    dirty = false;
    // 프로필이 바뀌었거나 전략이 지워졌으면 다른 곳을 건드리지 않는다.
    if (app.meta.activeProfileId !== profile || !app.strategies.some((s) => s.id === draft.id)) return;
    const next = { ...($state.snapshot(draft) as Strategy), updatedAt: Date.now() };
    app.setStrategies(app.strategies.map((s) => (s.id === next.id ? next : s)));
  }

  function update(fn: (s: Strategy) => void) {
    fn(draft);
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(flush, SAVE_MS);
  }

  $effect(() => {
    const snap = $state.snapshot(draft) as Strategy;
    untrack(() => ondraft?.(snap));
  });

  onDestroy(flush);
  onMount(() => {
    loadItems().then(
      (items) => (universe = items),
      () => {}, // 이름을 못 찾으면 종목 코드로 보인다
    );
    // 탭을 닫거나 앱을 내리면 500ms를 기다리지 않고 저장한다(모바일은 unload가 오지 않을 수 있다)
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  });

  const names = $derived(universe ? Object.fromEntries(universe.map((u) => [u.s, u.n])) : {});
  const benchName = $derived(draft.benchmarks.symbol ? (names[draft.benchmarks.symbol] ?? null) : null);
  const issues = $derived(strategyIssues(draft, app.watchlists));
  const issueRows = $derived(issues.map((issue, i) => ({ id: `ed-${uid}-issue-${i}`, issue })));

  // 분할 매수를 켜면 추가 매수가 자금 부족의 원인이므로 자금 경고를 분할 매수 구역에도 보인다(id는 겹치지 않게).
  function sectionIssues(key: Key) {
    const rows = issueRows.filter((r) => keyOf(r.issue.section) === key);
    if (key !== 'scaleIn' || !draft.scaleIn.on) return rows;
    const capital = issueRows.filter((r) => r.issue.section === 'capital').map((r) => ({ id: `${r.id}-scale`, issue: r.issue }));
    return [...rows, ...capital];
  }

  function summary(key: Key): string {
    const sum = (k: Issue['section']) => sectionSummary(draft, k, app.watchlists, benchName);
    return key === 'period' ? `${sum('period')} · ${sum('capital')}` : sum(key);
  }

  // 요청 번호(seq)가 새로 올 때만 연다 — 사용자가 접은 구역을 다시 열지 않는다
  let handledSeq = -1;
  $effect(() => {
    const req = openRequest;
    if (!req || req.seq === handledSeq) return;
    handledSeq = req.seq;
    openKeys[keyOf(req.section)] = true;
  });

  const toggle = (key: Key) => (openKeys[key] = !openKeys[key]);

  async function run() {
    const first = issueRows.find((r) => r.issue.blocking);
    if (!first) {
      flush();
      return onRun($state.snapshot(draft) as Strategy);
    }
    openKeys[keyOf(first.issue.section)] = true;
    await tick();
    document.getElementById(first.id)?.focus();
  }

  function duplicate() {
    flush(); // 사본은 방금 고친 내용까지 담는다
    const id = duplicateStrategy(app, draft);
    if (id === null) return showSnackbar(STRATEGY_CAP_MESSAGE);
    app.navigate({ name: 'simulate', strategyId: id });
  }

  function rename() {
    const name = nameText.trim().slice(0, NAME_MAX);
    if (name) update((x) => (x.name = name));
  }
</script>

<div class="editor">
  <div class="top">
    <input class="name" aria-label="전략 이름" maxlength={NAME_MAX} bind:value={nameText} oninput={rename} onblur={() => (nameText = draft.name)} />
    <button type="button" class="dup" disabled={app.strategies.length >= MAX_STRATEGIES} onclick={duplicate}>복제</button>
  </div>

  {#each SECTIONS as { key, title } (key)}
    <EditorSection
      {title}
      summary={summary(key)}
      open={!!openKeys[key]}
      ontoggle={() => toggle(key)}
      issues={sectionIssues(key)}
    >
      {#if key === 'universe'}
        <UniverseSection {app} s={draft} {update} {names} {loadItems} />
      {:else if key === 'period'}
        <PeriodSection s={draft} {update} />
      {:else if key === 'entry'}
        <EntrySection s={draft} {update} />
      {:else if key === 'scaleIn'}
        <ScaleInSection s={draft} {update} />
      {:else if key === 'exit'}
        <ExitSection s={draft} {update} />
      {:else if key === 'benchmarks'}
        <BenchmarkSection {app} s={draft} {update} {names} {loadItems} />
      {:else}
        <CostSection s={draft} {update} />
      {/if}
    </EditorSection>
  {/each}

  <div class="runbar">
    <button type="button" class="run" onclick={run}>시뮬레이션 실행</button>
  </div>
</div>

<style>
  .editor {
    max-width: 720px;
    padding: 4px var(--gutter) 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .top {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .name {
    flex: 1;
    min-width: 0;
    min-height: var(--touch);
    padding: 0 12px;
    border-radius: 10px;
    border: 1px solid transparent;
    background: var(--surface);
    color: var(--t1);
    font-size: 18px;
    font-weight: 700;
  }
  .name:focus {
    border-color: var(--accent);
    outline: none;
  }
  .dup {
    min-height: var(--touch);
    padding: 0 16px;
    border-radius: 12px;
    background: var(--surface);
    font-weight: 700;
  }
  .dup:disabled {
    opacity: 0.5;
  }
  .runbar {
    position: sticky;
    bottom: 0;
    padding: 12px 0 calc(12px + env(safe-area-inset-bottom));
    background: linear-gradient(to bottom, transparent, var(--bg) 24%);
  }
  .run {
    width: 100%;
    min-height: 52px;
    border-radius: 14px;
    background: var(--accent);
    color: var(--on-accent);
    font-size: 16px;
    font-weight: 800;
  }
</style>
