<script lang="ts">
  // 종목: 관심 그룹을 고르거나, 종목 추가 시트로 직접 고른다(최대 8개).
  import type { UniverseItem } from '../../../data/universe';
  import { MAX_SYMBOLS } from '../../../sim/defaults';
  import type { Strategy } from '../../../sim/types';
  import { resolveSymbols } from '../../../sim/validate';
  import type { App } from '../../../state/app.svelte';
  import AddStockSheet from '../../../../sheets/AddStockSheet.svelte';
  import { Chip } from '@sch0718/ui-svelte';
  import { Segmented } from '@sch0718/ui-svelte';

  let {
    app,
    s,
    update,
    names,
    loadItems,
  }: {
    app: App;
    s: Strategy;
    update: (fn: (s: Strategy) => void) => void;
    names: Record<string, string>;
    loadItems?: () => Promise<UniverseItem[]>;
  } = $props();

  let adding = $state(false);
  const groups = $derived(app.watchlists.groups);
  const symbols = $derived(s.universe.kind === 'symbols' ? s.universe.symbols : []);
  const groupMissing = $derived(s.universe.kind === 'group' && !groups.some((g) => g.id === (s.universe as { groupId: string }).groupId));

  function setKind(kind: string) {
    if (kind === 'symbols') {
      const now = resolveSymbols(s, app.watchlists); // 지금 그룹의 종목에서 시작한다
      update((x) => {
        x.universe = { kind: 'symbols', symbols: now };
      });
    } else {
      const last = app.settings.lastGroupId;
      const id = groups.find((g) => g.id === last)?.id ?? groups[0]?.id;
      if (id)
        update((x) => {
          x.universe = { kind: 'group', groupId: id };
        });
    }
  }

  const label = (sym: string) => names[sym] ?? sym;
</script>

<Segmented
  onSurface
  label="종목 고르는 방법"
  value={s.universe.kind}
  onchange={setKind}
  options={[
    { value: 'group', label: '그룹 고르기' },
    { value: 'symbols', label: '직접 고르기' },
  ]}
/>

{#if s.universe.kind === 'group'}
  <div class="chips">
    {#each groups as g (g.id)}
      <Chip selected={s.universe.groupId === g.id} onclick={() =>
          update((x) => {
            x.universe = { kind: 'group', groupId: g.id };
          })}>
        {g.name}
      </Chip>
    {/each}
  </div>
  {#if groupMissing}
    <p class="hint">고른 그룹이 지워졌어요. 다시 골라 주세요.</p>
  {:else}
    <p class="hint">실행할 때 그룹에 들어 있는 종목을 쓰고, 최대 {MAX_SYMBOLS}종목까지 시험해요.</p>
  {/if}
{:else}
  <ul class="picked">
    {#each symbols as sym (sym)}
      <li>
        <span>{label(sym)}<em>{sym}</em></span>
        <button type="button" class="x" aria-label="{label(sym)} 빼기" onclick={() =>
          update((x) => {
            x.universe = { kind: 'symbols', symbols: symbols.filter((y) => y !== sym) };
          })}>
          ✕
        </button>
      </li>
    {/each}
  </ul>
  <p class="hint">{symbols.length}/{MAX_SYMBOLS}종목</p>
  <button type="button" class="act" onclick={() => (adding = true)}>＋ 종목 추가</button>
  <AddStockSheet
    open={adding}
    {app}
    mode="multi"
    title="종목 고르기"
    metas={{}}
    now={Date.now()}
    picked={symbols}
    max={MAX_SYMBOLS}
    limitMessage="{MAX_SYMBOLS}종목까지 넣을 수 있어요"
    {loadItems}
    onpick={(item) =>
      update((x) => {
        if (x.universe.kind === 'symbols' && !x.universe.symbols.includes(item.s)) x.universe.symbols.push(item.s);
      })}
    onclose={() => (adding = false)}
  />
{/if}

<style>
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .picked {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .picked li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: var(--touch);
    border-bottom: 1px solid var(--line);
  }
  .picked em {
    margin-left: 8px;
    font-style: normal;
    font-size: var(--fs-sub);
    color: var(--t3);
  }
</style>
