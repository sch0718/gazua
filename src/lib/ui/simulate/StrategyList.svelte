<script lang="ts">
  // 전략 목록(스펙 7.2): 행 = 이름 · 한 줄 요약 · 마지막 수정일, 행 메뉴 = 복제·이름 바꾸기·삭제.
  import { tick } from 'svelte';
  import type { App } from '../../state/app.svelte';
  import { MAX_STRATEGIES, NAME_MAX } from '../../sim/defaults';
  import { fromTemplate, TEMPLATES } from '../../sim/templates';
  import { STRATEGY_CAP_MESSAGE } from '../../sim/strategyStore';
  import type { Strategy } from '../../sim/types';
  import { kstDate } from '../../time/kst';
  import { Sheet } from '@sch0718/ui-svelte';
  import { showSnackbar } from '@sch0718/ui-svelte';
  import { fmtReturnPct, strategyLine } from './simText';
  import { compareTemplates, type CompareOutcome } from '../../sim/compareTemplates';
  import { duplicateStrategy, nextStrategyName } from './strategyActions.svelte';
  import { canShare, openShare } from '../../share/shareStore.svelte';
  import { built, strategySnapshot } from '../../share/snapshot';

  let { app }: { app: App } = $props();

  const full = () => app.strategies.length >= MAX_STRATEGIES;

  let picking = $state(false);

  function create() {
    if (full()) return showSnackbar(STRATEGY_CAP_MESSAGE);
    cmpGroup = defaultGroup();
    picking = true;
  }

  const defaultGroup = () => {
    const ids = app.watchlists.groups.map((g) => g.id);
    const last = app.settings.lastGroupId;
    return last && ids.includes(last) ? last : (ids[0] ?? null);
  };

  // 프리셋 비교(같은 그룹·최근 3년·처음 자금). 결과는 이 시트에만 둔다
  let cmpGroup = $state<string | null>(null);
  let cmpRun = 0;
  let cmp = $state.raw<null | { kind: 'loading'; done: number; total: number } | CompareOutcome>(null);
  const cmpLoading = $derived(cmp !== null && 'kind' in cmp ? cmp : null);
  const cmpOf = (id: string) => (cmp && 'ok' in cmp && cmp.ok ? cmp.rows.find((r) => r.template.id === id) : undefined);
  const holdPct = $derived(cmp && 'ok' in cmp && cmp.ok && cmp.rows[0] ? cmp.rows[0].summary.totalReturnPct - cmp.rows[0].summary.vsHoldPp : null);
  const CMP_FAIL: Record<string, string> = {
    noSymbols: '그룹에 종목이 없어요',
    noData: '기간 안에 데이터가 없어요',
    error: '일봉을 받지 못했어요. 연결 설정을 확인해 주세요',
  };

  async function runCompare() {
    const groupId = cmpGroup;
    if (!groupId) return;
    const id = ++cmpRun;
    cmp = { kind: 'loading', done: 0, total: 0 };
    const out = await compareTemplates({
      provider: app.provider,
      watchlists: app.watchlists,
      groupId,
      now: Date.now(),
      onProgress: (p) => {
        if (id === cmpRun) cmp = { kind: 'loading', done: p.done, total: p.total };
      },
      isCancelled: () => id !== cmpRun,
    }).catch((error: unknown): CompareOutcome => ({ ok: false, reason: 'error', error }));
    if (id === cmpRun) cmp = out;
  }

  function closePicker() {
    picking = false;
    cmpRun++;
    cmp = null;
  }

  function createFrom(t: (typeof TEMPLATES)[number]) {
    const groupId = cmp && 'ok' in cmp && cmp.ok && cmpGroup ? cmpGroup : defaultGroup();
    closePicker();
    const s = fromTemplate(t, Date.now(), groupId, nextStrategyName(app.strategies));
    app.setStrategies([...app.strategies, s]);
    app.navigate({ name: 'simulate', strategyId: s.id });
  }

  let listEl = $state<HTMLElement>();
  let menuId = $state<string | null>(null);
  let renaming = $state(false);
  let draft = $state('');
  let nameError = $state('');
  const target = $derived(app.strategies.find((s) => s.id === menuId) ?? null);

  function closeMenu() {
    menuId = null;
    renaming = false;
  }

  function share(s: Strategy) {
    closeMenu();
    const watchlists = app.watchlists;
    openShare({
      kind: 'strategy',
      name: s.name,
      profileId: app.meta.activeProfileId,
      build: (hideCapital) => built(strategySnapshot(s, watchlists, { hideCapital, now: Date.now() })),
    });
  }

  function duplicate(s: Strategy) {
    closeMenu();
    if (duplicateStrategy(app, s) === null) showSnackbar(STRATEGY_CAP_MESSAGE);
  }

  function startRename(s: Strategy) {
    draft = s.name;
    nameError = '';
    renaming = true;
  }

  async function saveRename(s: Strategy) {
    const name = draft.trim().slice(0, NAME_MAX);
    if (!name) {
      // 같은 오류를 다시 띄울 때도 화면 낭독기가 읽도록 지웠다가 다시 넣는다
      nameError = '';
      await tick();
      nameError = '이름을 적어 주세요';
      return;
    }
    app.setStrategies(app.strategies.map((x) => (x.id === s.id ? { ...x, name, updatedAt: Date.now() } : x)));
    closeMenu();
  }

  // 지운 행의 메뉴 버튼은 사라지므로 시트가 닫힐 때 같은 자리의 다음 행 → 이전 행 → ＋ 새 전략 순으로 포커스한다.
  let neighbors: string[] = [];
  // 가져온 ID에는 따옴표 등이 들어올 수 있어 선택자에 끼우지 않고 dataset으로 비교한다.
  const returnFocus = () => {
    const rows = [...(listEl?.querySelectorAll<HTMLElement>('[data-strategy-row]') ?? [])];
    for (const id of neighbors) {
      const el = rows.find((r) => r.dataset.strategyRow === id);
      if (el) return el;
    }
    return listEl?.querySelector<HTMLElement>('[data-new-strategy]');
  };

  function remove(s: Strategy) {
    closeMenu();
    const index = app.strategies.findIndex((x) => x.id === s.id);
    neighbors = [app.strategies[index + 1]?.id, app.strategies[index - 1]?.id].filter((id): id is string => !!id);
    app.setStrategies(app.strategies.filter((x) => x.id !== s.id));
    showSnackbar(`'${s.name}'을(를) 삭제했어요`, {
      label: '되돌리기',
      run: () => {
        if (app.strategies.some((x) => x.id === s.id)) return;
        if (full()) return showSnackbar(STRATEGY_CAP_MESSAGE);
        const next = [...app.strategies];
        next.splice(Math.min(index, next.length), 0, s);
        app.setStrategies(next);
      },
    });
  }

  const modified = (s: Strategy) => kstDate(s.updatedAt).slice(5).replace('-', '.');
</script>

<div class="list" bind:this={listEl}>
  {#if app.strategies.length === 0}
    <div class="empty">
      <p>내 매매 규칙을 과거 데이터로 시험해 보세요</p>
      <button type="button" class="primary" data-new-strategy onclick={create}>＋ 새 전략</button>
    </div>
  {:else}
    <ul>
      {#each app.strategies as s (s.id)}
        <li>
          <button type="button" class="row" data-strategy-row={s.id} onclick={() => app.navigate({ name: 'simulate', strategyId: s.id })}>
            <span class="name">{s.name}</span>
            <span class="line">{strategyLine(s, app.watchlists)}</span>
            <span class="date">최근 수정 {modified(s)}</span>
          </button>
          <button type="button" class="more" aria-label="{s.name} 메뉴" onclick={() => (menuId = s.id)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" />
            </svg>
          </button>
        </li>
      {/each}
    </ul>
    <button type="button" class="primary add" data-new-strategy onclick={create}>＋ 새 전략</button>
  {/if}
</div>

<Sheet open={target !== null} title={renaming ? '이름 바꾸기' : (target?.name ?? '')} onclose={closeMenu} {returnFocus}>
  {#if target}
    {#if renaming}
      <form
        class="rename"
        onsubmit={(e) => {
          e.preventDefault();
          saveRename(target);
        }}
      >
        <input
          aria-label="전략 이름"
          maxlength={NAME_MAX}
          bind:value={draft}
          oninput={() => (nameError = '')}
          aria-invalid={nameError ? 'true' : undefined}
          aria-describedby={nameError ? 'rename-err' : undefined}
          data-autofocus
        />
        {#if nameError}<p id="rename-err" class="err" role="alert">{nameError}</p>{/if}
        <button type="submit" class="primary">저장</button>
      </form>
    {:else}
      <div class="menu">
        <button type="button" onclick={() => duplicate(target)}>복제</button>
        <button type="button" onclick={() => startRename(target)}>이름 바꾸기</button>
        {#if canShare()}<button type="button" onclick={() => share(target)}>공유</button>{/if}
        <button type="button" class="danger" onclick={() => remove(target)}>삭제</button>
      </div>
    {/if}
  {/if}
</Sheet>

<Sheet open={picking} title="어떤 전략으로 시작할까요?" onclose={closePicker} returnFocus={() => listEl?.querySelector<HTMLElement>('[data-new-strategy]')}>
  <div class="picker">
    {#if app.watchlists.groups.length > 0}
      <div class="cmp">
        <label class="cmp-label" for="cmp-group">내 종목으로 먼저 비교해 보기</label>
        <div class="cmp-row">
          <select id="cmp-group" bind:value={cmpGroup} disabled={cmpLoading !== null} onchange={() => ((cmpRun += 1), (cmp = null))}>
            {#each app.watchlists.groups as g (g.id)}<option value={g.id}>{g.name}</option>{/each}
          </select>
          <button type="button" class="ghost" disabled={cmpLoading !== null || !cmpGroup} onclick={() => void runCompare()}>
            {cmpLoading ? cmpLoading.total > 0 ? `받는 중… ${cmpLoading.done}/${cmpLoading.total}` : '받는 중…' : '비교'}
          </button>
        </div>
        <p class="cmp-note" aria-live="polite">
          {#if cmp && 'ok' in cmp && cmp.ok}
            {cmp.from.replaceAll('-', '.')}~{cmp.to.replaceAll('-', '.')} · {cmp.symbols}종목{cmp.failed > 0 ? `(${cmp.failed}종목 못 받음)` : ''} · 그냥 보유 {holdPct === null ? '—' : fmtReturnPct(holdPct, true)}. 과거 결과일 뿐 앞으로를 약속하지 않아요
          {:else if cmp && 'ok' in cmp && cmp.reason !== 'cancelled'}
            <span class="err" role="alert">{CMP_FAIL[cmp.reason]}</span>
          {:else}
            같은 종목·최근 3년·처음 자금 1,000만 원으로 아래 전략을 모두 돌려요
          {/if}
        </p>
      </div>
    {/if}
    <ul class="templates">
      {#each TEMPLATES as t (t.id)}
        {@const r = cmpOf(t.id)}
        <li>
          <button type="button" class="tpl" onclick={() => createFrom(t)}>
            <b>{t.name}</b>
            <span>{t.desc}</span>
            {#if t.source}<small>근거: {t.source}</small>{/if}
            {#if r}
              <span class="stats">
                총수익 {fmtReturnPct(r.summary.totalReturnPct, true)} · 최대 낙폭 {fmtReturnPct(-Math.abs(r.summary.mddPct))} · 거래 {r.summary.roundTrips}회{r.summary.winRatePct === null ? '' : ` · 승률 ${Math.round(r.summary.winRatePct)}%`}
              </span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  </div>
</Sheet>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 0 var(--gutter) 16px;
  }
  .cmp {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .cmp-label {
    font-size: var(--fs-sub);
    font-weight: 700;
  }
  .cmp-row {
    display: flex;
    gap: 8px;
  }
  .cmp-row select {
    flex: 1;
    min-width: 0;
    min-height: var(--touch);
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--t1);
    padding: 0 10px;
  }
  .ghost {
    min-height: var(--touch);
    padding: 0 16px;
    border-radius: 12px;
    background: var(--surface2);
    color: var(--t1);
    font-weight: 700;
    white-space: nowrap;
  }
  .ghost:disabled {
    opacity: 0.6;
  }
  .cmp-note,
  .tpl small {
    font-size: var(--fs-label);
    color: var(--t3);
  }
  .stats {
    font-size: var(--fs-sub);
    color: var(--t1);
    font-weight: 600;
  }
  .templates {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .tpl {
    width: 100%;
    min-height: 56px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    text-align: left;
  }
  .list {
    max-width: 720px;
    padding: 4px var(--gutter) 48px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  li {
    display: flex;
    align-items: stretch;
    background: var(--surface);
    border-radius: var(--r-card);
  }
  .row {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 14px 4px 14px 16px;
    text-align: left;
    border-radius: var(--r-card);
  }
  .name {
    font-size: var(--fs-body);
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .line {
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  .date {
    font-size: var(--fs-label);
    color: var(--t3);
  }
  .more {
    width: 48px;
    flex: none;
    display: grid;
    place-items: center;
    color: var(--t2);
    border-radius: var(--r-card);
  }
  .more:hover {
    background: var(--surface2);
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding: 64px 16px;
    color: var(--t2);
    text-align: center;
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
  .add {
    margin-top: 16px;
    width: 100%;
  }
  .menu {
    display: flex;
    flex-direction: column;
    padding: 0 8px;
  }
  .menu button {
    min-height: var(--touch);
    padding: 0 12px;
    text-align: left;
    font-size: var(--fs-body);
    border-radius: 10px;
  }
  .menu button:hover {
    background: var(--surface2);
  }
  .danger {
    color: var(--err);
  }
  .rename {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 4px 20px;
  }
  .err {
    margin: -4px 0 0;
    font-size: var(--fs-sub);
    color: var(--err);
  }
  .rename input {
    min-height: var(--touch);
    padding: 0 12px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--surface2);
    color: var(--t1);
    font-size: var(--fs-body);
  }
</style>
