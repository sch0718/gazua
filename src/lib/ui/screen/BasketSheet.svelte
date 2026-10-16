<script lang="ts">
  // 묶음 관리 시트(스펙 4.2·5.1): 만들기 · 이름 바꾸기 · 삭제(되돌리기) · 종목 추가와 빼기 · 관심 그룹·테마에서 가져오기.
  // 종목이 0개인 묶음은 저장하지 않는다. 새 묶음은 이 시트 안(drafts)에만 있다가 종목이 하나 생기면 저장한다.
  // 저장된 묶음에서 마지막 종목을 빼면 묶음 삭제로 보고 되돌리기를 준다.
  import { tick, untrack } from 'svelte';
  import AddStockSheet from '../../../sheets/AddStockSheet.svelte';
  import type { UniverseItem } from '../../data/universe';
  import { BASKET_CAP_MESSAGE, BASKET_SYMBOLS_MAX, MAX_BASKETS, newBasket, type Basket } from '../../screen/baskets';
  import { NAME_MAX } from '../../sim/defaults';
  import type { MarketThemeSummary } from '../../marketData/store';
  import type { App } from '../../state/app.svelte';
  import Sheet from '../components/Sheet.svelte';
  import { showSnackbar } from '../components/snackbarStore.svelte';
  import { NEED_RECOLLECT_TEXT, nextCriteriaName } from './screenText';

  let {
    open,
    app,
    onclose,
    names = {},
    loadItems,
    themes,
    loadThemeSymbols,
    returnTo,
  }: {
    open: boolean;
    app: App;
    onclose: () => void;
    /** 종목 코드 → 이름 */
    names?: Record<string, string>;
    loadItems?: () => Promise<UniverseItem[]>;
    /** 테마 요약(없거나 비면 테마에서 가져오기를 끈다) */
    themes?: MarketThemeSummary[];
    /** 테마 코드 → 그 테마의 종목 코드. 파일 본문을 읽으므로 가져올 때만 부른다 */
    loadThemeSymbols?: (code: string) => Promise<string[]>;
    /** 시트를 완전히 닫은 뒤 포커스를 돌려줄 요소(`묶음 관리` 버튼) */
    returnTo?: () => HTMLElement | null | undefined;
  } = $props();

  const SYMBOL_RE = /^[0-9A-Z]{6}$/;
  const SYMBOLS_FULL = `묶음의 종목은 ${BASKET_SYMBOLS_MAX}개까지예요`;
  const uid = Math.random().toString(36).slice(2, 9);

  // 저장하지 않은 새 묶음(종목 0개)
  let drafts = $state<Basket[]>([]);
  let view = $state<string | null>(null);
  let adding = $state(false);
  let nameText = $state('');
  let nameError = $state('');
  let groupId = $state('');
  let themeCode = $state('');
  let importing = $state(false);
  let listEl = $state<HTMLElement>();
  let bodyEl = $state<HTMLElement>();

  const rows = $derived<Basket[]>([...app.baskets, ...drafts]);
  const current = $derived(rows.find((b) => b.id === view) ?? null);
  const isDraft = (id: string) => drafts.some((b) => b.id === id);
  const groups = $derived(app.watchlists.groups);
  const themeList = $derived(themes ?? []);
  const nameOf = (s: string) => names[s] ?? s;

  // 시트를 닫으면 만들다 만 묶음과 보던 화면을 버린다(저장된 묶음은 그대로)
  $effect(() => {
    if (open) return;
    untrack(() => {
      drafts = [];
      view = null;
      adding = false;
      nameError = '';
    });
  });
  $effect(() => {
    if (!groups.some((g) => g.id === groupId)) groupId = groups[0]?.id ?? '';
  });
  $effect(() => {
    if (!themeList.some((t) => t.code === themeCode)) themeCode = themeList[0]?.code ?? '';
  });

  /** 저장소에 쓴다. 한도를 넘는 값은 저장소가 거절하므로 스낵바로 알린다 */
  function save(list: Basket[]): boolean {
    try {
      app.setBaskets(list);
      return true;
    } catch (e) {
      showSnackbar(e instanceof Error ? e.message : BASKET_CAP_MESSAGE);
      return false;
    }
  }

  async function focusList(index: number) {
    await tick();
    const dels = listEl?.querySelectorAll<HTMLElement>('[data-basket-delete]');
    (dels?.[index] ?? dels?.[dels.length - 1] ?? listEl?.querySelector<HTMLElement>('[data-new-basket]'))?.focus();
  }

  async function openDetail(id: string, focusName = true) {
    const b = rows.find((x) => x.id === id);
    if (!b) return;
    view = id;
    nameText = b.name;
    nameError = '';
    await tick();
    if (focusName) bodyEl?.querySelector<HTMLElement>('input[data-basket-name]')?.focus();
  }

  async function backToList() {
    const id = view;
    view = null;
    await tick();
    const btn = [...(listEl?.querySelectorAll<HTMLElement>('[data-basket-open]') ?? [])].find((b) => b.dataset.basketOpen === id);
    (btn ?? listEl?.querySelector<HTMLElement>('[data-new-basket]'))?.focus();
  }

  function create() {
    if (rows.length >= MAX_BASKETS) return showSnackbar(BASKET_CAP_MESSAGE);
    const b = newBasket(Date.now(), nextCriteriaName(rows, '새 묶음'));
    drafts = [...drafts, b];
    void openDetail(b.id);
  }

  /** 묶음 하나를 바꾼다. 종목이 있으면 저장하고, 없으면 새 묶음은 시트에만 둔다 */
  function put(next: Basket): boolean {
    next = { ...next, updatedAt: Date.now() };
    if (next.symbols.length === 0) {
      if (isDraft(next.id)) drafts = drafts.map((d) => (d.id === next.id ? next : d));
      return true;
    }
    if (isDraft(next.id)) {
      if (!save([...app.baskets, next])) return false;
      drafts = drafts.filter((d) => d.id !== next.id);
      return true;
    }
    return save(app.baskets.map((b) => (b.id === next.id ? next : b)));
  }

  function deleteBasket(b: Basket) {
    if (isDraft(b.id)) {
      drafts = drafts.filter((d) => d.id !== b.id);
      return;
    }
    const index = app.baskets.findIndex((x) => x.id === b.id);
    if (!save(app.baskets.filter((x) => x.id !== b.id))) return;
    const profile = app.meta.activeProfileId;
    showSnackbar(`'${b.name}' 묶음을 삭제했어요`, {
      label: '되돌리기',
      focus: () =>
        open && !adding ? ([...(listEl?.querySelectorAll<HTMLElement>('[data-basket-delete]') ?? [])].find((e) => e.dataset.basketDelete === b.id) ?? null) : null,
      run: () => {
        if (app.meta.activeProfileId !== profile) return showSnackbar('다른 프로필에서는 되돌릴 수 없어요');
        if (app.baskets.some((x) => x.id === b.id)) return;
        if (app.baskets.length >= MAX_BASKETS) return showSnackbar(BASKET_CAP_MESSAGE);
        const next = [...app.baskets];
        next.splice(Math.min(index, next.length), 0, b);
        save(next);
      },
    });
  }

  function removeFromList(b: Basket) {
    const index = rows.findIndex((x) => x.id === b.id);
    deleteBasket(b);
    void focusList(index);
  }

  /** 종목을 더한다(중복은 건너뛰고 300개에서 멈춘다). 안내는 부르는 쪽이 한 번에 한다 */
  function addSymbols(syms: string[]): { added: number; truncated: number; failed: boolean } {
    const b = current;
    if (!b) return { added: 0, truncated: 0, failed: false };
    const have = new Set(b.symbols);
    const fresh = [...new Set(syms)].filter((s) => SYMBOL_RE.test(s) && !have.has(s));
    const room = BASKET_SYMBOLS_MAX - b.symbols.length;
    const take = fresh.slice(0, Math.max(0, room));
    const truncated = fresh.length - take.length;
    if (take.length === 0) return { added: 0, truncated, failed: false };
    const ok = put({ ...b, symbols: [...b.symbols, ...take] });
    return { added: ok ? take.length : 0, truncated, failed: !ok };
  }

  /** 가져오기 결과를 안내 하나로 합친다. 저장이 실패했으면 저장소의 오류 안내만 남긴다 */
  function report(r: { added: number; truncated: number; failed: boolean }) {
    if (r.failed) return;
    if (r.added === 0) return void showSnackbar(r.truncated > 0 ? SYMBOLS_FULL : '새로 넣을 종목이 없어요');
    showSnackbar(`종목 ${r.added}개를 가져왔어요${r.truncated > 0 ? `. ${BASKET_SYMBOLS_MAX}개를 넘는 ${r.truncated}개는 뺐어요` : ''}`);
  }

  async function removeSymbol(sym: string) {
    const b = current;
    if (!b) return;
    const symbols = b.symbols.filter((s) => s !== sym);
    if (symbols.length === 0 && !isDraft(b.id)) {
      // 저장된 묶음의 마지막 종목: 묶음을 지우는 것과 같다
      const index = rows.findIndex((x) => x.id === b.id);
      view = null;
      deleteBasket(b);
      return void focusList(index);
    }
    put({ ...b, symbols });
    await tick();
    const xs = bodyEl?.querySelectorAll<HTMLElement>('[data-symbol-remove]');
    (xs?.[Math.min(b.symbols.indexOf(sym), (xs?.length ?? 1) - 1)] ?? bodyEl?.querySelector<HTMLElement>('[data-add-stocks]'))?.focus();
  }

  function commitName() {
    const b = current;
    if (!b) return;
    const name = nameText.trim().slice(0, NAME_MAX);
    if (!name) {
      nameError = '이름을 적어 주세요';
      return;
    }
    nameError = '';
    nameText = name;
    if (name !== b.name) put({ ...b, name });
  }
  function onNameKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitName();
    }
  }

  function fromGroup() {
    const g = groups.find((x) => x.id === groupId);
    if (!g) return;
    report(addSymbols(g.items.map((i) => i.symbol)));
  }

  async function fromTheme() {
    if (!themeCode || !loadThemeSymbols || importing) return;
    importing = true;
    try {
      report(addSymbols(await loadThemeSymbols(themeCode)));
    } catch {
      showSnackbar('테마 종목을 불러오지 못했어요');
    } finally {
      importing = false;
    }
  }

  // 종목 추가 시트가 닫히면 이 시트가 다시 열린다. 두 시트의 포커스 복원이 끝난 뒤 `종목 추가`로 돌려놓는다
  async function endAdding() {
    adding = false;
    await tick();
    await tick();
    bodyEl?.querySelector<HTMLElement>('[data-add-stocks]')?.focus();
  }
  // 완전히 닫을 때는 시트가 기억한 요소가 이미 사라졌을 수 있어 부른 버튼으로 돌린다
  async function close() {
    onclose();
    await tick();
    await tick();
    const el = returnTo?.();
    if (el?.isConnected) el.focus();
  }

  const themeOff = $derived(themeList.length === 0 || !loadThemeSymbols);
</script>

<Sheet open={open && !adding} title="묶음 관리" onclose={close}>
  {#if view === null || !current}
    <div class="wrap" bind:this={listEl}>
      {#if rows.length === 0}
        <p class="hint">만든 묶음이 없어요. 자주 보는 종목을 묶어 두면 후보 범위로 쓸 수 있어요</p>
      {:else}
        <ul class="list">
          {#each rows as b (b.id)}
            <li class="brow">
              <button type="button" class="open" data-basket-open={b.id} aria-label="{b.name} 편집" onclick={() => openDetail(b.id)}>
                <b class="nm">{b.name}</b>
                <em class="num">{b.symbols.length}종목{isDraft(b.id) ? ' · 저장 전' : ''}</em>
              </button>
              <button type="button" class="del" data-basket-delete={b.id} aria-label="{b.name} 삭제" onclick={() => removeFromList(b)}>✕</button>
            </li>
          {/each}
        </ul>
      {/if}
      <button type="button" class="btn" data-new-basket disabled={rows.length >= MAX_BASKETS} onclick={create}>＋ 새 묶음</button>
      {#if rows.length >= MAX_BASKETS}<p class="hint">{BASKET_CAP_MESSAGE}</p>{/if}
    </div>
  {:else}
    {@const b = current}
    <div class="wrap" bind:this={bodyEl}>
      <button type="button" class="back" onclick={backToList}>‹ 묶음 목록</button>
      <label class="field">
        <span>이름</span>
        <input
          data-basket-name
          maxlength={NAME_MAX}
          bind:value={nameText}
          onblur={commitName}
          onkeydown={onNameKey}
          aria-invalid={nameError ? 'true' : undefined}
          aria-describedby={nameError ? `bk-${uid}-err` : undefined}
        />
      </label>
      {#if nameError}<p class="err" id="bk-{uid}-err" role="alert">{nameError}</p>{/if}

      <p class="sub" role="status">종목 {b.symbols.length}/{BASKET_SYMBOLS_MAX}{isDraft(b.id) ? ' · 종목을 1개 이상 넣으면 저장돼요' : ''}</p>
      <ul class="syms" aria-label="묶음 종목">
        {#each b.symbols as s (s)}
          <li class="brow">
            <span class="nm">{nameOf(s)} <small class="num">{s}</small></span>
            <button type="button" class="del" data-symbol-remove={s} aria-label="{nameOf(s)} 빼기" onclick={() => removeSymbol(s)}>✕</button>
          </li>
        {/each}
      </ul>
      <button type="button" class="btn" data-add-stocks data-autofocus disabled={b.symbols.length >= BASKET_SYMBOLS_MAX} onclick={() => (adding = true)}>종목 추가</button>

      <p class="group-title">가져오기</p>
      <div class="imp">
        <select aria-label="가져올 관심 그룹" bind:value={groupId} disabled={groups.length === 0}>
          {#each groups as g (g.id)}<option value={g.id}>{g.name} ({g.items.length}종목)</option>{/each}
        </select>
        <button type="button" class="btn" disabled={!groups.find((g) => g.id === groupId)?.items.length} onclick={fromGroup}>관심 그룹에서 가져오기</button>
      </div>
      <div class="imp">
        <select aria-label="가져올 테마" bind:value={themeCode} disabled={themeOff}>
          {#each themeList as t (t.code)}<option value={t.code}>{t.name} ({t.count}종목)</option>{/each}
        </select>
        <button type="button" class="btn" disabled={themeOff || importing} onclick={fromTheme}>테마에서 가져오기</button>
      </div>
      {#if themeOff}<p class="hint">테마: {NEED_RECOLLECT_TEXT}</p>{/if}
    </div>
  {/if}
</Sheet>

<AddStockSheet
  open={adding}
  {app}
  mode="multi"
  title="묶음에 종목 추가"
  metas={{}}
  now={Date.now()}
  {loadItems}
  picked={current?.symbols ?? []}
  max={BASKET_SYMBOLS_MAX}
  limitMessage={SYMBOLS_FULL}
  onpick={(item) => {
    const r = addSymbols([item.s]);
    if (r.truncated > 0) showSnackbar(SYMBOLS_FULL);
  }}
  onclose={endAdding}
/>

<style>
  .wrap {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 0 16px 16px;
  }
  .list,
  .syms {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .syms {
    max-height: 260px;
    overflow-y: auto;
  }
  .brow {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: var(--touch);
  }
  .open {
    flex: 1;
    min-width: 0;
    min-height: var(--touch);
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 0 8px;
    text-align: left;
    border-radius: 10px;
  }
  .open:hover {
    background: var(--surface2);
  }
  .nm {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
    word-break: keep-all;
  }
  .open em {
    font-style: normal;
    font-size: var(--fs-sub);
    color: var(--t3);
    flex: none;
  }
  small {
    color: var(--t3);
  }
  .del {
    min-width: var(--touch);
    min-height: var(--touch);
    color: var(--err);
    flex: none;
  }
  .btn {
    min-height: var(--touch);
    padding: 0 14px;
    border-radius: 12px;
    background: var(--surface2);
    font-weight: 700;
  }
  .btn:disabled {
    opacity: 0.5;
  }
  .back {
    align-self: flex-start;
    min-height: var(--touch);
    padding: 0 8px;
    color: var(--t2);
    font-weight: 700;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  .field input,
  select {
    width: 100%;
    min-width: 0;
    min-height: var(--touch);
    padding: 0 12px;
    border-radius: 10px;
    border: 1px solid transparent;
    background: var(--surface2);
    color: var(--t1);
    font: inherit;
    font-size: 16px;
  }
  .field input:focus,
  select:focus {
    border-color: var(--accent);
    outline: none;
  }
  .field input[aria-invalid='true'] {
    border-color: var(--err);
  }
  .err {
    margin: 0;
    font-size: var(--fs-sub);
    color: var(--err);
  }
  .sub,
  .hint {
    margin: 0;
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  .group-title {
    margin: 4px 0 0;
    font-size: var(--fs-sub);
    font-weight: 700;
    color: var(--t2);
  }
  .imp {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
</style>
