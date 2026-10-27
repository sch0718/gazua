<script lang="ts">
  // 오늘 기준 선별(스펙 7.4-1): 상위 N개와 `관심 그룹으로 만들기`. 관심 그룹은 최대 MAX_ITEMS종목이라 위에서부터 채운다.
  import type { Selection } from '../../screen/select';
  import type { App } from '../../state/app.svelte';
  import { NAME_MAX } from '../../screen/defaults';
  import { MAX_ITEMS } from '../../state/watchlist';
  import { Sheet } from '@sch0718/ui-svelte';
  import { dotDate } from '../simulate/simText';
  import { cutText, freeSlots, picksToGroup, picksToNewGroup, type PickGroupResult } from './pickGroup';

  let {
    app,
    selection,
    names,
    criteriaName,
  }: {
    app: App;
    selection: Selection;
    names: Record<string, string>;
    criteriaName: string;
  } = $props();

  const symbols = $derived(selection.picked.map((p) => p.symbol));
  const nameOf = (s: string) => names[s] ?? s;

  let sheet = $state(false);
  let newName = $state('');
  let done = $state.raw<PickGroupResult | null>(null);

  function openSheet() {
    newName = criteriaName;
    sheet = true;
  }
  function create() {
    // 이름을 비우면 기준 이름을 쓴다
    done = picksToNewGroup(app, newName.trim() || criteriaName, symbols);
    sheet = false;
  }
  function addTo(id: string) {
    done = picksToGroup(app, id, symbols);
    sheet = false;
  }
  const goCompare = () => done && app.navigate({ name: 'compare', groupId: done.groupId });
</script>

<section class="today" aria-labelledby="today-h">
  <h3 id="today-h">오늘 기준 선별</h3>
  {#if selection.picked.length === 0}
    <p class="none">오늘 기준으로 조건을 통과한 종목이 없어요</p>
  {:else}
    <p class="sub">{dotDate(selection.date)} 기준 · 통과 {selection.passed}개 중 상위 {selection.picked.length}개</p>
    <ol>
      {#each selection.picked as p, i (p.symbol)}
        <li><span class="rank num">{i + 1}</span><span class="nm">{nameOf(p.symbol)}</span><small>{p.symbol}</small></li>
      {/each}
    </ol>
    <button type="button" class="btn" onclick={openSheet}>관심 그룹으로 만들기</button>
    {#if done}
      <div class="done" role="status">
        <p>'{done.groupName}'에 {done.added}개를 넣었어요{done.already > 0 ? `(이미 있던 ${done.already}개는 건너뛰었어요)` : ''}</p>
        {#if done.cut > 0}<p>{done.already === 0 ? cutText(done.room) : `빈자리가 모자라 ${done.cut}개는 넣지 못했어요`}</p>{/if}
        <button type="button" class="link" onclick={goCompare}>비교 화면에서 보기</button>
      </div>
    {/if}
  {/if}
</section>

<Sheet open={sheet} title="관심 그룹으로 만들기" onclose={() => (sheet = false)}>
  <div class="sheet">
    <form
      onsubmit={(e) => {
        e.preventDefault();
        create();
      }}
    >
      <label>
        새 그룹 이름
        <input bind:value={newName} maxlength={NAME_MAX} data-autofocus />
      </label>
      <button type="submit" class="btn">새 그룹으로 만들기</button>
      {#if symbols.length > MAX_ITEMS}<p class="hint">관심 그룹은 {MAX_ITEMS}종목까지라 위에서부터 {MAX_ITEMS}개만 넣어요</p>{/if}
    </form>
    <h3 class="sub-h">기존 그룹에 더하기</h3>
    <ul>
      {#each app.watchlists.groups as g (g.id)}
        {@const free = freeSlots(app, g.id)}
        <li>
          <button type="button" class="row" disabled={free === 0} onclick={() => addTo(g.id)}>
            <span>{g.name}</span>
            <small>{free === 0 ? '가득 찼어요' : `빈자리 ${free}`}</small>
          </button>
        </li>
      {/each}
    </ul>
  </div>
</Sheet>

<style>
  h3 {
    margin: 0 0 6px;
    font-size: var(--fs-title);
  }
  .sub-h {
    margin: 16px 0 4px;
    font-size: var(--fs-body);
  }
  p {
    margin: 0;
  }
  .sub,
  .none,
  .hint {
    color: var(--t2);
    font-size: var(--fs-sub);
  }
  ol {
    list-style: none;
    margin: 8px 0 12px;
    padding: 0;
  }
  li {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 6px 0;
    border-bottom: 1px solid var(--line);
  }
  .rank {
    width: 1.6em;
    color: var(--t3);
  }
  .nm {
    font-weight: 600;
  }
  small {
    color: var(--t3);
  }
  .btn,
  .link {
    min-height: var(--touch);
    padding: 0 20px;
    border-radius: 12px;
    font-weight: 700;
  }
  .btn {
    background: var(--accent);
    color: var(--on-accent);
  }
  .link {
    background: var(--accent-soft);
    color: var(--accent);
    align-self: flex-start;
  }
  .done {
    margin-top: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    color: var(--t2);
  }
  .sheet {
    padding: 4px 20px 20px;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  input {
    min-height: var(--touch);
    padding: 0 12px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--surface2);
    color: var(--t1);
    font-size: var(--fs-body);
  }
  .sheet ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .sheet li {
    padding: 0;
    border: 0;
  }
  .row {
    width: 100%;
    min-height: var(--touch);
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 12px;
    border-radius: 10px;
    text-align: left;
  }
  .row:hover:not(:disabled) {
    background: var(--surface2);
  }
  .row:disabled {
    opacity: 0.55;
  }
</style>
