<script lang="ts">
  // 선정 기준 목록(스펙 7.2): 행 = 이름 · 조건 요약 · 마지막 결과(이 탭에서 실행한 경우만), 행 메뉴 = 복제·이름 바꾸기·삭제.
  import { tick } from 'svelte';
  import { CRITERIA_CAP_MESSAGE } from '../../screen/criteriaStore';
  import { MAX_CRITERIA, NAME_MAX, newCriteria } from '../../screen/defaults';
  import type { SelectionCriteria } from '../../screen/types';
  import type { App } from '../../state/app.svelte';
  import Sheet from '../components/Sheet.svelte';
  import { showSnackbar } from '../components/snackbarStore.svelte';
  import { duplicateCriteria } from './criteriaActions.svelte';
  import { criteriaLine, nextCriteriaName } from './screenText';

  let {
    app,
    dataRange,
    lastResults = {},
  }: {
    app: App;
    /** 새 기준의 기본 기간을 정한다(데이터가 없으면 null) */
    dataRange: { from: string; to: string } | null;
    /** 기준 id → `① +12.3% vs KOSPI +8.1%` */
    lastResults?: Record<string, string>;
  } = $props();

  const full = () => app.criteria.length >= MAX_CRITERIA;

  function create() {
    if (full()) return showSnackbar(CRITERIA_CAP_MESSAGE);
    const c = newCriteria(Date.now(), dataRange, nextCriteriaName(app.criteria));
    app.setCriteria([...app.criteria, c]);
    app.navigate({ name: 'simulate', tab: 'criteria', criteriaId: c.id });
  }

  let listEl = $state<HTMLElement>();
  let menuId = $state<string | null>(null);
  let renaming = $state(false);
  let draft = $state('');
  let nameError = $state('');
  const target = $derived(app.criteria.find((c) => c.id === menuId) ?? null);

  function closeMenu() {
    menuId = null;
    renaming = false;
  }

  function duplicate(c: SelectionCriteria) {
    closeMenu();
    if (duplicateCriteria(app, c) === null) showSnackbar(CRITERIA_CAP_MESSAGE);
  }

  function startRename(c: SelectionCriteria) {
    draft = c.name;
    nameError = '';
    renaming = true;
  }

  async function saveRename(c: SelectionCriteria) {
    const name = draft.trim().slice(0, NAME_MAX);
    if (!name) {
      // 같은 오류를 다시 띄울 때도 화면 낭독기가 읽도록 지웠다가 다시 넣는다
      nameError = '';
      await tick();
      nameError = '이름을 적어 주세요';
      return;
    }
    app.setCriteria(app.criteria.map((x) => (x.id === c.id ? { ...x, name, updatedAt: Date.now() } : x)));
    closeMenu();
  }

  // 지운 행의 메뉴 버튼은 사라지므로 시트가 닫힐 때 같은 자리의 다음 행 → 이전 행 → ＋ 새 기준 순으로 포커스한다.
  let neighbors: string[] = [];
  // 가져온 ID에는 따옴표 등이 들어올 수 있어 선택자에 끼우지 않고 dataset으로 비교한다.
  const returnFocus = () => {
    const rows = [...(listEl?.querySelectorAll<HTMLElement>('[data-criteria-row]') ?? [])];
    for (const id of neighbors) {
      const el = rows.find((r) => r.dataset.criteriaRow === id);
      if (el) return el;
    }
    return listEl?.querySelector<HTMLElement>('[data-new-criteria]');
  };

  function remove(c: SelectionCriteria) {
    closeMenu();
    const index = app.criteria.findIndex((x) => x.id === c.id);
    neighbors = [app.criteria[index + 1]?.id, app.criteria[index - 1]?.id].filter((id): id is string => !!id);
    app.setCriteria(app.criteria.filter((x) => x.id !== c.id));
    showSnackbar(`'${c.name}'을(를) 삭제했어요`, {
      label: '되돌리기',
      run: () => {
        if (app.criteria.some((x) => x.id === c.id)) return;
        if (full()) return showSnackbar(CRITERIA_CAP_MESSAGE);
        const next = [...app.criteria];
        next.splice(Math.min(index, next.length), 0, c);
        app.setCriteria(next);
      },
    });
  }
</script>

<div class="list" bind:this={listEl}>
  {#if app.criteria.length === 0}
    <div class="empty">
      <p>내 선정 기준이 과거에 얼마나 잘 맞았는지 시험해 보세요</p>
      <button type="button" class="primary" data-new-criteria onclick={create}>＋ 새 기준</button>
    </div>
  {:else}
    <ul>
      {#each app.criteria as c (c.id)}
        <li>
          <button type="button" class="row" data-criteria-row={c.id} onclick={() => app.navigate({ name: 'simulate', tab: 'criteria', criteriaId: c.id })}>
            <span class="name">{c.name}</span>
            <span class="line">{criteriaLine(c)}</span>
            {#if lastResults[c.id]}<span class="last">{lastResults[c.id]}</span>{/if}
          </button>
          <button type="button" class="more" aria-label="{c.name} 메뉴" onclick={() => (menuId = c.id)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" />
            </svg>
          </button>
        </li>
      {/each}
    </ul>
    <button type="button" class="primary add" data-new-criteria onclick={create}>＋ 새 기준</button>
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
          aria-label="기준 이름"
          maxlength={NAME_MAX}
          bind:value={draft}
          oninput={() => (nameError = '')}
          aria-invalid={nameError ? 'true' : undefined}
          aria-describedby={nameError ? 'crit-rename-err' : undefined}
          data-autofocus
        />
        {#if nameError}<p id="crit-rename-err" class="err" role="alert">{nameError}</p>{/if}
        <button type="submit" class="primary">저장</button>
      </form>
    {:else}
      <div class="menu">
        <button type="button" onclick={() => duplicate(target)}>복제</button>
        <button type="button" onclick={() => startRename(target)}>이름 바꾸기</button>
        <button type="button" class="danger" onclick={() => remove(target)}>삭제</button>
      </div>
    {/if}
  {/if}
</Sheet>

<style>
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
    word-break: keep-all;
    overflow-wrap: anywhere;
  }
  .last {
    font-size: var(--fs-label);
    color: var(--t2);
    font-weight: 700;
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
    padding: 48px 16px;
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
