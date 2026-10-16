<script lang="ts">
  // 선정 기준 편집(스펙 7.3): 접힌 6개 구역(조건만 처음부터 열림) + 미리 보기 + 맨 아래 실행 버튼.
  // 고치는 즉시 작업본에 반영하고 500ms 쉬면 저장한다. 미리 보기는 0.3초 쉬면 다시 계산한다(Worker).
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import AddStockSheet from '../../../sheets/AddStockSheet.svelte';
  import { sharedUniverse } from '../../../sheets/universeSource';
  import type { UniverseItem } from '../../data/universe';
  import type { MarketDataInfo, MarketSector, MarketThemeSummary } from '../../marketData/store';
  import { CRITERIA_CAP_MESSAGE } from '../../screen/criteriaStore';
  import { BENCH_MAX, MAX_CRITERIA, MAX_INITIAL, NAME_MAX, TAKE_MAX } from '../../screen/defaults';
  import { rankFlowOf } from '../../screen/precompute';
  import type { WorkerInput } from '../../screen/runValidation';
  import type { Selection } from '../../screen/select';
  import type { FlowWho, SelectionCriteria } from '../../screen/types';
  import { criteriaIssues, type Issue } from '../../screen/validate';
  import { PreviewError } from '../../screen/validationController.svelte';
  import { newStrategy } from '../../sim/defaults';
  import type { Strategy } from '../../sim/types';
  import type { Basket } from '../../screen/baskets';
  import type { App } from '../../state/app.svelte';
  import Segmented from '../components/Segmented.svelte';
  import { showSnackbar } from '../components/snackbarStore.svelte';
  import Toggle from '../components/Toggle.svelte';
  import EditorSection from '../simulate/editor/EditorSection.svelte';
  import EntrySection from '../simulate/editor/EntrySection.svelte';
  import NumberField from '../simulate/editor/NumberField.svelte';
  import BasketPicker from './BasketPicker.svelte';
  import ConditionRow from './ConditionRow.svelte';
  import FlowConditions from './FlowConditions.svelte';
  import MacroConditions from './MacroConditions.svelte';
  import { duplicateCriteria } from './criteriaActions.svelte';
  import PreviewPanel from './PreviewPanel.svelte';
  import SectorPicker from './SectorPicker.svelte';
  import { CONDITION_HELP, CONDITION_LABEL, FLOW_WHO_LABEL, FLOW_WHO_ORDER, NO_DATA_RUN_REASON, poolScopeText, rebalanceLabel, SERIES_LABEL } from './screenText';
  import ThemePicker from './ThemePicker.svelte';

  const EOK_MAX = 10_000_000;

  let {
    app,
    criteria,
    info,
    sectors,
    preview,
    onRun,
    ondraft,
    loadItems = sharedUniverse,
    themes,
    loadThemeSymbols,
  }: {
    app: App;
    criteria: SelectionCriteria;
    /** 가져온 시장 데이터 요약. null이면 실행과 미리 보기를 막는다 */
    info: MarketDataInfo | null;
    sectors: MarketSector[];
    preview: (input: WorkerInput) => Promise<Selection>;
    /** 막는 경고가 없을 때 저장 대기분을 저장한 뒤 작업본(사본)을 넘긴다 */
    onRun: (draft: SelectionCriteria) => void;
    ondraft?: (draft: SelectionCriteria) => void;
    loadItems?: () => Promise<UniverseItem[]>;
    /** 파일의 테마 요약(읽는 중이면 undefined, v1이면 빈 배열) */
    themes?: MarketThemeSummary[];
    /** 테마의 종목 코드(묶음으로 가져오기용) */
    loadThemeSymbols?: (code: string) => Promise<string[]>;
  } = $props();

  const SAVE_MS = 500;
  const PREVIEW_MS = 300;
  type Key = Issue['section'];
  const SECTIONS: { key: Key; title: string }[] = [
    { key: 'pool', title: '후보 범위' },
    { key: 'conditions', title: '조건' },
    { key: 'rank', title: '고를 개수·정렬' },
    { key: 'period', title: '재선정·기간' },
    { key: 'benchmarks', title: '비교 대상' },
    { key: 'trading', title: '② 매매 규칙' },
  ];

  const profile = untrack(() => app.meta.activeProfileId);
  let draft = $state<SelectionCriteria>(untrack(() => $state.snapshot(criteria) as SelectionCriteria));
  let nameText = $state(untrack(() => criteria.name));
  let nameError = $state('');
  let openKeys = $state<Partial<Record<Key, boolean>>>({ conditions: true });
  let universe = $state.raw<UniverseItem[] | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;
  let root: HTMLElement;
  const uid = Math.random().toString(36).slice(2, 9);

  // 목록과 편집은 동시에 열리지 않으므로(다른 곳에서 이 기준을 고치지 않는다) 저장은 기준 전체를 작업본으로 덮어쓴다.
  function flush() {
    clearTimeout(timer);
    timer = undefined;
    if (!dirty) return;
    dirty = false;
    // 프로필이 바뀌었거나 기준이 지워졌으면 다른 곳을 건드리지 않는다.
    if (app.meta.activeProfileId !== profile || !app.criteria.some((c) => c.id === draft.id)) return;
    const next = { ...($state.snapshot(draft) as SelectionCriteria), updatedAt: Date.now() };
    app.setCriteria(app.criteria.map((c) => (c.id === next.id ? next : c)));
  }

  function update(fn: (c: SelectionCriteria) => void) {
    fn(draft);
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(flush, SAVE_MS);
  }

  $effect(() => {
    const snap = $state.snapshot(draft) as SelectionCriteria;
    untrack(() => ondraft?.(snap));
  });

  onDestroy(flush);
  onMount(() => {
    loadItems().then(
      (items) => (universe = items),
      () => {}, // 이름을 못 찾으면 종목 코드로 보인다
    );
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  });
  const names = $derived(universe ? Object.fromEntries(universe.map((u) => [u.s, u.n])) : {});

  // ── 틀린 숫자 입력: 고칠 때까지 실행을 막는다 ──
  // 칸이 사라져도(구역이 접혀도) 틀린 글은 여기에 남는다. 칸은 다시 만들어질 때 이 글로 시작한다.
  const invalid = new SvelteMap<string, string>();
  const nf = (key: string) => ({
    keepInvalid: true,
    invalidText: invalid.get(key),
    oninvalid: (bad: boolean, text: string) => {
      if (bad) invalid.set(key, text);
      else if (invalid.has(key)) invalid.delete(key);
    },
  });
  const sectionOfInvalid = (key: string): Key => (key.startsWith('take') || key.startsWith('rank-') ? 'rank' : key === 'cap' || key === 'fee' ? 'period' : 'conditions');

  // ── 경고 ──
  // 이 데이터에 환율·유가·테마가 있는가(v1이거나 환율·유가 계열이 비면 새 조건은 쓸 수 없다)
  const v1 = $derived(info !== null && (info.version ?? 1) < 2);
  const noMacro = $derived(info !== null && !info.hasMacro);
  const noFlow = $derived(info !== null && !info.hasFlow);
  const dataInfo = $derived(info ? { hasMacro: !!info.hasMacro, hasFlow: !!info.hasFlow, hasFin: !!info.hasFin, themeCodes: v1 ? [] : themes?.map((t) => t.code) } : undefined);
  const issues = $derived(criteriaIssues(draft, app.strategies, dataInfo, app.baskets));
  const issueRows = $derived(issues.map((issue, i) => ({ id: `ed-${uid}-issue-${i}`, issue })));
  const sectionIssues = (key: Key) => issueRows.filter((r) => r.issue.section === key);

  // ── 미리 보기: 이름·수정 시각만 바뀐 것은 다시 계산하지 않는다 ──
  const previewKey = $derived(
    JSON.stringify({ ...($state.snapshot(draft) as SelectionCriteria), name: '', updatedAt: 0 }) +
      app.strategies.map((s) => `${s.id}:${s.updatedAt}`).join() +
      app.baskets.map((b) => `${b.id}:${b.updatedAt}`).join(),
  );
  // 막는 경고가 있으면 미리 보기를 돌리지 않는다(돌리면 0으로 보여 오해하기 쉽다)
  const previewBlocked = $derived(issues.some((i) => i.blocking));
  let previewSel = $state.raw<Selection | null>(null);
  let previewPending = $state(false);
  let previewFailed = $state(false);
  let previewSeq = 0;
  let previewTimer: ReturnType<typeof setTimeout> | undefined;

  async function runPreview() {
    const seq = ++previewSeq;
    previewPending = true;
    previewFailed = false;
    try {
      const sel = await preview({
        criteria: $state.snapshot(draft) as SelectionCriteria,
        strategies: $state.snapshot(app.strategies) as Strategy[],
        baskets: $state.snapshot(app.baskets) as Basket[],
      });
      if (seq === previewSeq) previewSel = sel;
    } catch (e) {
      // 취소(다음 계산이나 실행에 밀림)는 조용히 둔다
      if (seq === previewSeq && !(e instanceof PreviewError && e.code === 'cancelled')) previewFailed = true;
    } finally {
      if (seq === previewSeq) previewPending = false;
    }
  }

  $effect(() => {
    void previewKey;
    const has = info !== null && !previewBlocked;
    untrack(() => {
      clearTimeout(previewTimer);
      previewSeq++; // 이미 나간 계산의 답은 이 편집보다 옛것이다
      previewPending = has;
      if (has) previewTimer = setTimeout(runPreview, PREVIEW_MS);
    });
    return () => clearTimeout(previewTimer);
  });
  onDestroy(() => previewSeq++);

  // ── 구역·실행 ──
  let runButton: HTMLButtonElement;
  /** 맨 아래 실행 버튼으로 포커스(실행을 취소하고 돌아왔을 때) */
  export function focusRun() {
    runButton?.focus();
  }
  const toggleSection = (key: Key) => (openKeys[key] = !openKeys[key]);
  const runReasonId = `ed-${uid}-run-reason`;

  const clampDate = (d: string, r: { from: string; to: string }) => (d < r.from ? r.from : d > r.to ? r.to : d);

  async function run() {
    if (!info) return;
    // 1) 틀린 숫자가 남은 칸: 구역을 열고 그 칸으로(접혀서 칸이 없어도 막는다)
    if (invalid.size > 0) {
      const key = invalid.keys().next().value as string;
      openKeys[sectionOfInvalid(key)] = true;
      await tick();
      root.querySelector<HTMLElement>('input[aria-invalid="true"]')?.focus();
      return;
    }
    // 2) 기간이 데이터 밖이면 데이터 범위로 맞춘다(스펙 8.1)
    const from = clampDate(draft.period.from, info.range);
    const to = clampDate(draft.period.to, info.range);
    if (from !== draft.period.from || to !== draft.period.to) {
      update((c) => {
        c.period = { from, to };
      });
      showSnackbar('데이터 범위에 맞췄어요');
      await tick();
    }
    // 3) 막는 경고: 그 구역을 열고 첫 경고로
    const first = issueRows.find((r) => r.issue.blocking);
    if (first) {
      openKeys[first.issue.section] = true;
      await tick();
      document.getElementById(first.id)?.focus();
      return;
    }
    flush();
    onRun($state.snapshot(draft) as SelectionCriteria);
  }

  function duplicate() {
    flush(); // 사본은 방금 고친 내용까지 담는다
    const id = duplicateCriteria(app, draft);
    if (id === null) return showSnackbar(CRITERIA_CAP_MESSAGE);
    app.navigate({ name: 'simulate', tab: 'criteria', criteriaId: id });
  }

  function rename() {
    const name = nameText.trim().slice(0, NAME_MAX);
    nameError = name ? '' : '이름을 적어 주세요';
    if (name) update((c) => (c.name = name));
  }

  function summary(key: Key): string {
    const d = draft;
    switch (key) {
      case 'pool': {
        const types = d.pool.types.map((t) => (t === 'STOCK' ? '주식' : 'ETF')).join('·');
        return `${d.pool.markets.join('·')} ${types} · ${poolScopeText(d.pool, sectors)}`;
      }
      case 'conditions': {
        const { macro, flow, fin, ...simple } = d.conditions;
        const n = +flow.amount.on + +flow.streak.on + Object.values(fin).filter((x) => x.on).length + Object.values(simple).filter((x) => x.on).length + SERIES.reduce((a, k) => a + +macro[k].beta.on + +macro[k].trend.on, 0);
        return n ? `${n}개 켬` : '켠 조건 없음';
      }
      case 'rank':
        return `상위 ${d.rank.take} · ${RANK_LABEL[d.rank.by]}`;
      case 'period':
        return `${rebalanceLabel(d.rebalance)} · ${d.period.from.replaceAll('-', '.')}~${d.period.to.replaceAll('-', '.')}`;
      case 'benchmarks':
        return [...d.benchmarks.indices, ...d.benchmarks.symbols.map((s) => names[s] ?? s)].join(' · ') || '없음';
      default:
        return d.trading.strategyId === null ? '쓰지 않음' : (app.strategies.find((s) => s.id === d.trading.strategyId)?.name ?? '전략 없음');
    }
  }

  const SERIES = ['usdkrw', 'wti'] as const;
  const RANK_LABEL = { marketCap: '시가총액 큰 순', tradingValue: '거래대금 큰 순', return: '수익률 높은 순', lowVolatility: '변동성 낮은 순', macroBeta: '민감도 큰 순', flow: '수급 큰 순', fin: '재무 순' } as const;

  // 정렬을 바꾸면 숨는 칸(수급 기간)의 틀린 글은 버린다(칸 없이 실행을 막지 않게)
  function setRankBy(v: string) {
    if (v !== 'flow') invalid.delete('rank-flow-days');
    update((c) => (c.rank.by = v as SelectionCriteria['rank']['by']));
  }

  // ── 후보 범위 ──
  function setMember<T extends string>(list: T[], v: T, on: boolean): T[] {
    return on ? [...list.filter((x) => x !== v), v] : list.filter((x) => x !== v);
  }
  // 하나는 남아야 한다(빈 후보 범위는 저장 때 기본값으로 되돌려진다)
  function setMarket(m: 'KOSPI' | 'KOSDAQ', on: boolean) {
    const next = setMember(draft.pool.markets, m, on);
    if (next.length > 0)
      update((c) => {
        c.pool.markets = next;
      });
  }
  function setType(t: 'STOCK' | 'ETF', on: boolean) {
    const next = setMember(draft.pool.types, t, on);
    if (next.length > 0)
      update((c) => {
        c.pool.types = next;
      });
  }

  // ── 반등 신호 패턴 ──
  const pattern = $derived(draft.conditions.rebound.pattern);
  const strategyIds = $derived(app.strategies.map((s) => s.id));
  let customMemo: Strategy['entry'] | null = untrack(() =>
    draft.conditions.rebound.pattern.from === 'custom' ? ($state.snapshot(draft.conditions.rebound.pattern.entry) as Strategy['entry']) : null,
  );
  function setPatternFrom(from: string) {
    if (from === pattern.from) return;
    if (from === 'strategy') {
      const first = app.strategies[0];
      if (!first) return;
      if (pattern.from === 'custom') customMemo = $state.snapshot(pattern.entry) as Strategy['entry'];
      for (const k of [...invalid.keys()]) if (k.startsWith('entry-')) invalid.delete(k); // 숨는 매수 칸의 틀린 글은 버린다
      update((c) => {
        c.conditions.rebound.pattern = { from: 'strategy', strategyId: first.id };
      });
    } else {
      const ref = pattern.from === 'strategy' ? app.strategies.find((s) => s.id === pattern.strategyId) : undefined;
      const entry = customMemo ?? (ref ? (structuredClone($state.snapshot(ref.entry)) as Strategy['entry']) : newStrategy(Date.now(), null).entry);
      update((c) => {
        c.conditions.rebound.pattern = { from: 'custom', entry };
      });
    }
  }
  // 매수 섹션은 전략 모양을 기대하므로 entry만 가진 겉모양을 넘긴다
  const entryHost = $derived(pattern.from === 'custom' ? ({ entry: pattern.entry } as unknown as Strategy) : null);
  const updateEntry = (fn: (s: Strategy) => void) =>
    update((c) => {
      const p = c.conditions.rebound.pattern;
      if (p.from === 'custom') fn({ entry: p.entry } as unknown as Strategy);
    });

  // ── 비교 대상 ──
  let picking = $state(false);
  function addBenchmark(item: UniverseItem) {
    if (draft.benchmarks.symbols.includes(item.s) || draft.benchmarks.symbols.length >= BENCH_MAX) return;
    update((c) => c.benchmarks.symbols.push(item.s));
  }
</script>

<div class="editor" bind:this={root}>
  <div class="top">
    <div class="name-field">
      <input
        class="name"
        aria-label="기준 이름"
        maxlength={NAME_MAX}
        bind:value={nameText}
        oninput={rename}
        onblur={() => {
          if (!nameError) nameText = draft.name;
        }}
        aria-invalid={nameError ? 'true' : undefined}
        aria-describedby={nameError ? `ed-${uid}-name-err` : undefined}
      />
      {#if nameError}<p class="name-err" id="ed-{uid}-name-err" role="alert">{nameError}</p>{/if}
    </div>
    <button type="button" class="dup" disabled={app.criteria.length >= MAX_CRITERIA} onclick={duplicate}>복제</button>
  </div>

  {#each SECTIONS as { key, title } (key)}
    <EditorSection {title} summary={summary(key)} open={!!openKeys[key]} ontoggle={() => toggleSection(key)} issues={sectionIssues(key)}>
      {#if key === 'pool'}
        <p class="group-title">시장</p>
        <div class="row">
          <label for="{uid}-kospi">KOSPI</label>
          <Toggle id="{uid}-kospi" label="KOSPI" checked={draft.pool.markets.includes('KOSPI')} onchange={(v) => setMarket('KOSPI', v)} />
        </div>
        <div class="row">
          <label for="{uid}-kosdaq">KOSDAQ</label>
          <Toggle id="{uid}-kosdaq" label="KOSDAQ" checked={draft.pool.markets.includes('KOSDAQ')} onchange={(v) => setMarket('KOSDAQ', v)} />
        </div>
        <p class="group-title">종류</p>
        <div class="row">
          <label for="{uid}-stock">주식</label>
          <Toggle id="{uid}-stock" label="주식" checked={draft.pool.types.includes('STOCK')} onchange={(v) => setType('STOCK', v)} />
        </div>
        <div class="row">
          <label for="{uid}-etf">ETF</label>
          <Toggle id="{uid}-etf" label="ETF" checked={draft.pool.types.includes('ETF')} onchange={(v) => setType('ETF', v)} />
        </div>
        <p class="hint">시장과 종류는 하나씩은 골라야 해요.</p>
        <div class="row">
          <label for="{uid}-managed">관리종목·거래정지 제외</label>
          <Toggle id="{uid}-managed" label="관리종목·거래정지 제외" checked={draft.pool.excludeManaged} onchange={(v) => update((c) => (c.pool.excludeManaged = v))} />
        </div>
        <p class="hint">수집일 기준이에요.</p>
        <p class="group-title">업종</p>
        <SectorPicker {sectors} selected={draft.pool.sectors} onchange={(next) =>
            update((c) => {
              c.pool.sectors = next;
            })} />
        <p class="group-title">테마</p>
        <ThemePicker {themes} selected={draft.pool.themes} disabled={v1} onchange={(next) =>
            update((c) => {
              c.pool.themes = next;
            })} />
        <p class="group-title">내 묶음</p>
        <BasketPicker {app} selected={draft.pool.baskets} {names} {loadItems} {themes} {loadThemeSymbols} onchange={(next) =>
            update((c) => {
              c.pool.baskets = next;
            })} />
        <p class="hint">업종·테마·내 묶음은 하나라도 고르면 그 종목들의 합집합이 후보예요. 아무것도 안 고르면 전체예요.</p>
      {:else if key === 'conditions'}
        {@const k = draft.conditions}
        <ConditionRow label={CONDITION_LABEL.marketCap} help={CONDITION_HELP.marketCap} on={k.marketCap.on} ontoggle={(v) => update((c) => (c.conditions.marketCap.on = v))}>
          <NumberField label="최소 시가총액" value={k.marketCap.minEok} min={0} max={EOK_MAX} suffix="억 원 이상" muted={!k.marketCap.on} {...nf('mc')} onchange={(v) => update((c) => (c.conditions.marketCap.minEok = v))} />
        </ConditionRow>
        <ConditionRow label={CONDITION_LABEL.tradingValue} help={CONDITION_HELP.tradingValue} on={k.tradingValue.on} ontoggle={(v) => update((c) => (c.conditions.tradingValue.on = v))}>
          <NumberField label="평균 거래대금 기간" value={k.tradingValue.days} min={1} max={250} step={1} suffix="일 평균" muted={!k.tradingValue.on} {...nf('tv-d')} onchange={(v) => update((c) => (c.conditions.tradingValue.days = v))} />
          <NumberField label="최소 평균 거래대금" value={k.tradingValue.minEok} min={0} max={EOK_MAX} suffix="억 원 이상" muted={!k.tradingValue.on} {...nf('tv-m')} onchange={(v) => update((c) => (c.conditions.tradingValue.minEok = v))} />
        </ConditionRow>
        <ConditionRow label={CONDITION_LABEL.leader} help={CONDITION_HELP.leader} on={k.leader.on} ontoggle={(v) => update((c) => (c.conditions.leader.on = v))}>
          <Segmented
            onSurface
            label="업종 단계"
            value={String(k.leader.level)}
            onchange={(v) => update((c) => (c.conditions.leader.level = v === '2' ? 2 : 1))}
            options={[
              { value: '1', label: '대분류' },
              { value: '2', label: '중분류' },
            ]}
          />
          <NumberField label="최대 순위" value={k.leader.maxRank} min={1} max={100} step={1} suffix="위 이내" muted={!k.leader.on} {...nf('ld')} onchange={(v) => update((c) => (c.conditions.leader.maxRank = v))} />
        </ConditionRow>
        <ConditionRow label={CONDITION_LABEL.returnRange} help={CONDITION_HELP.returnRange} on={k.returnRange.on} ontoggle={(v) => update((c) => (c.conditions.returnRange.on = v))}>
          <NumberField label="수익률 기간" value={k.returnRange.days} min={1} max={250} step={1} suffix="일" muted={!k.returnRange.on} {...nf('rr-d')} onchange={(v) => update((c) => (c.conditions.returnRange.days = v))} />
          <NumberField label="최소 수익률" value={k.returnRange.minPct} min={-100} max={1000} suffix="% 이상" muted={!k.returnRange.on} {...nf('rr-a')} onchange={(v) => update((c) => (c.conditions.returnRange.minPct = v))} />
          <NumberField label="최대 수익률" value={k.returnRange.maxPct} min={-100} max={1000} suffix="% 이하" muted={!k.returnRange.on} {...nf('rr-b')} onchange={(v) => update((c) => (c.conditions.returnRange.maxPct = v))} />
        </ConditionRow>
        <ConditionRow label={CONDITION_LABEL.vsMa} help={CONDITION_HELP.vsMa} on={k.vsMa.on} ontoggle={(v) => update((c) => (c.conditions.vsMa.on = v))}>
          <NumberField label="이동평균 기간" value={k.vsMa.period} min={2} max={250} step={1} suffix="일선" muted={!k.vsMa.on} {...nf('ma')} onchange={(v) => update((c) => (c.conditions.vsMa.period = v))} />
          <Segmented
            onSurface
            label="이동평균 기준"
            value={k.vsMa.side}
            onchange={(v) => update((c) => (c.conditions.vsMa.side = v === 'below' ? 'below' : 'above'))}
            options={[
              { value: 'above', label: '위' },
              { value: 'below', label: '아래' },
            ]}
          />
        </ConditionRow>
        <ConditionRow label={CONDITION_LABEL.fromHigh} help={CONDITION_HELP.fromHigh} on={k.fromHigh.on} ontoggle={(v) => update((c) => (c.conditions.fromHigh.on = v))}>
          <NumberField label="최소 하락폭" value={k.fromHigh.minPct} min={0} max={100} suffix="% 이상" muted={!k.fromHigh.on} {...nf('fh-a')} onchange={(v) => update((c) => (c.conditions.fromHigh.minPct = v))} />
          <NumberField label="최대 하락폭" value={k.fromHigh.maxPct} min={0} max={100} suffix="% 이하" muted={!k.fromHigh.on} {...nf('fh-b')} onchange={(v) => update((c) => (c.conditions.fromHigh.maxPct = v))} />
        </ConditionRow>
        <ConditionRow label={CONDITION_LABEL.volatility} help={CONDITION_HELP.volatility} on={k.volatility.on} ontoggle={(v) => update((c) => (c.conditions.volatility.on = v))}>
          <NumberField label="변동성 기간" value={k.volatility.days} min={2} max={250} step={1} suffix="일" muted={!k.volatility.on} {...nf('vo-d')} onchange={(v) => update((c) => (c.conditions.volatility.days = v))} />
          <NumberField label="최대 변동성" value={k.volatility.maxPct} min={0} max={100} suffix="% 이하" muted={!k.volatility.on} {...nf('vo-m')} onchange={(v) => update((c) => (c.conditions.volatility.maxPct = v))} />
        </ConditionRow>
        <ConditionRow label={CONDITION_LABEL.rebound} help={CONDITION_HELP.rebound} on={k.rebound.on} ontoggle={(v) => update((c) => (c.conditions.rebound.on = v))}>
          <NumberField label="반등 확인 기간" value={k.rebound.withinDays} min={1} max={60} step={1} suffix="거래일 이내" muted={!k.rebound.on} {...nf('rb')} onchange={(v) => update((c) => (c.conditions.rebound.withinDays = v))} />
          <Segmented
            wide
            onSurface
            label="반등 패턴"
            value={pattern.from}
            onchange={setPatternFrom}
            options={[
              { value: 'strategy', label: '전략에서 불러오기', disabled: app.strategies.length === 0 && pattern.from !== 'strategy' },
              { value: 'custom', label: '직접 정하기' },
            ]}
          />
          {#if pattern.from === 'strategy'}
            {@const known = strategyIds.includes(pattern.strategyId)}
            <select
              class="pick"
              aria-label="반등 패턴 전략"
              onchange={(e) => {
                const strategyId = e.currentTarget.value;
                update((c) => {
                  c.conditions.rebound.pattern = { from: 'strategy', strategyId };
                });
              }}
            >
              {#if !known}<option value="" disabled selected>지워진 전략이에요. 다시 골라 주세요</option>{/if}
              {#each app.strategies as s (s.id)}
                <option value={s.id} selected={known && s.id === pattern.strategyId}>{s.name}</option>
              {/each}
            </select>
          {:else if entryHost}
            <EntrySection s={entryHost} update={updateEntry} nf={(k) => nf(`entry-${k}`)} />
          {/if}
        </ConditionRow>
        <MacroConditions macro={k.macro} unavailable={noMacro} {nf} update={(fn) => update((c) => fn(c.conditions.macro))} />
        <FlowConditions flow={k.flow} unavailable={noFlow} {nf} update={(fn) => update((c) => fn(c.conditions.flow))} />
      {:else if key === 'rank'}
        <Segmented
          wide
          onSurface
          label="정렬 기준"
          value={draft.rank.by}
          onchange={setRankBy}
          options={[
            { value: 'marketCap', label: '시가총액 큰 순' },
            { value: 'tradingValue', label: '거래대금 큰 순' },
            { value: 'return', label: '수익률 높은 순' },
            { value: 'lowVolatility', label: '변동성 낮은 순' },
            { value: 'macroBeta', label: '민감도 큰 순' },
            { value: 'flow', label: '수급 순' },
          ]}
        />
        {#if draft.rank.by === 'macroBeta'}
          <select
            class="pick"
            aria-label="민감도 계열"
            onchange={(e) => update((c) => (c.rank.series = e.currentTarget.value === 'wti' ? 'wti' : 'usdkrw'))}
          >
            {#each SERIES as s (s)}
              <option value={s} selected={(draft.rank.series ?? 'usdkrw') === s}>{SERIES_LABEL[s]}</option>
            {/each}
          </select>
        {:else if draft.rank.by === 'flow'}
          {@const rf = rankFlowOf(draft)}
          <Segmented
            wide
            onSurface
            label="수급 주체"
            value={rf.who}
            onchange={(v) =>
              update((c) => {
                c.rank.flow = { ...rankFlowOf(c), who: FLOW_WHO_ORDER.includes(v as FlowWho) ? (v as FlowWho) : 'foreign' };
              })}
            options={FLOW_WHO_ORDER.map((w) => ({ value: w, label: FLOW_WHO_LABEL[w] }))}
          />
          <div class="row">
            <NumberField label="수급 기간" value={rf.days} min={5} max={120} step={1} suffix="일" {...nf('rank-flow-days')} onchange={(v) =>
                update((c) => {
                  c.rank.flow = { ...rankFlowOf(c), days: v };
                })} />
          </div>
        {/if}
        <p class="hint">조건을 통과한 종목을 이 순서로 줄 세워 위에서부터 골라요. 같으면 종목코드 순이에요.</p>
        <div class="row">
          <NumberField label="고를 개수" value={draft.rank.take} min={1} max={TAKE_MAX} step={1} suffix="개" {...nf('take')} onchange={(v) => update((c) => (c.rank.take = v))} />
        </div>
      {:else if key === 'period'}
        <Segmented
          onSurface
          label="재선정 주기"
          value={draft.rebalance}
          onchange={(v) => update((c) => (c.rebalance = v as SelectionCriteria['rebalance']))}
          options={[
            { value: 'monthly', label: '매월' },
            { value: 'quarterly', label: '분기' },
            { value: 'semiannual', label: '반기' },
          ]}
        />
        <p class="hint">재선정일 시가에 사고팔아요. 날짜는 한국 시간 기준이에요.</p>
        <div class="dates">
          <label>
            <span>시작일</span>
            <input type="date" value={draft.period.from} onchange={(e) => /^\d{4}-\d{2}-\d{2}$/.test(e.currentTarget.value) ? update((c) => (c.period.from = e.currentTarget.value)) : (e.currentTarget.value = draft.period.from)} />
          </label>
          <label>
            <span>종료일</span>
            <input type="date" value={draft.period.to} onchange={(e) => /^\d{4}-\d{2}-\d{2}$/.test(e.currentTarget.value) ? update((c) => (c.period.to = e.currentTarget.value)) : (e.currentTarget.value = draft.period.to)} />
          </label>
        </div>
        <div class="row">
          <NumberField label="처음 자금" value={draft.capital} min={1} max={MAX_INITIAL} step={1} suffix="원" format="won" {...nf('cap')} onchange={(v) => update((c) => (c.capital = v))} />
        </div>
        <div class="row">
          <NumberField label="수수료" value={draft.costs.feePct} min={0} max={1} suffix="% (사고팔 때 각각)" {...nf('fee')} onchange={(v) => update((c) => (c.costs.feePct = v))} />
        </div>
      {:else if key === 'benchmarks'}
        <p class="hint">① 선정만 보유한 결과를 아래 지수·종목과 견줘요.</p>
        <div class="row">
          <label for="{uid}-bk">KOSPI 지수</label>
          <Toggle id="{uid}-bk" label="KOSPI 지수" checked={draft.benchmarks.indices.includes('KOSPI')} onchange={(v) => update((c) => {
                c.benchmarks.indices = setMember(c.benchmarks.indices, 'KOSPI', v);
              })} />
        </div>
        <div class="row">
          <label for="{uid}-bq">KOSDAQ 지수</label>
          <Toggle id="{uid}-bq" label="KOSDAQ 지수" checked={draft.benchmarks.indices.includes('KOSDAQ')} onchange={(v) => update((c) => {
                c.benchmarks.indices = setMember(c.benchmarks.indices, 'KOSDAQ', v);
              })} />
        </div>
        <p class="group-title">비교 종목 (최대 {BENCH_MAX}개)</p>
        {#each draft.benchmarks.symbols as sym (sym)}
          <div class="row">
            <span class="grow">{names[sym] ?? sym}</span>
            <button type="button" class="act danger" aria-label="{names[sym] ?? sym} 비교 종목 지우기" onclick={() =>
                update((c) => {
                  c.benchmarks.symbols = c.benchmarks.symbols.filter((x) => x !== sym);
                })}>지우기</button>
          </div>
        {/each}
        <button type="button" class="act" disabled={draft.benchmarks.symbols.length >= BENCH_MAX} onclick={() => (picking = true)}>비교 종목 추가</button>
        <AddStockSheet open={picking} {app} mode="single" title="비교 종목" metas={{}} now={Date.now()} {loadItems} onpick={addBenchmark} onclose={() => (picking = false)} />
      {:else}
        <p class="hint">고른 매매 규칙(전략)을 선정된 종목마다 적용한 결과(②)를 함께 봐요. 쓰지 않으면 ①만 봐요.</p>
        {@const tid = draft.trading.strategyId}
        {@const tknown = tid === null || strategyIds.includes(tid)}
        <select
          class="pick"
          aria-label="매매 규칙 전략"
          onchange={(e) => update((c) => (c.trading.strategyId = e.currentTarget.value === '' ? null : e.currentTarget.value))}
        >
          <option value="" selected={tid === null}>쓰지 않음 (① 선정만 보기)</option>
          {#if !tknown}<option value="__gone" disabled selected>지워진 전략이에요. 다시 골라 주세요</option>{/if}
          {#each app.strategies as s (s.id)}
            <option value={s.id} selected={s.id === tid}>{s.name}</option>
          {/each}
        </select>
      {/if}
    </EditorSection>
  {/each}

  <PreviewPanel
    hasData={info !== null}
    asOf={info?.range.to ?? null}
    selection={previewSel}
    pending={previewPending}
    failed={previewFailed}
    blocked={previewBlocked}
    {names}
  />

  <div class="runbar">
    {#if !info}<p class="reason" id={runReasonId}>{NO_DATA_RUN_REASON}</p>{/if}
    <button type="button" class="run" bind:this={runButton} disabled={!info} aria-describedby={info ? undefined : runReasonId} onclick={run}>검증 실행</button>
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
    align-items: flex-start;
  }
  .name-field {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .name-err {
    margin: 0;
    font-size: var(--fs-sub);
    color: var(--err);
  }
  .name {
    width: 100%;
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
  .dup:disabled,
  .act:disabled {
    opacity: 0.5;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .dates {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 12px;
  }
  .dates label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  .dates input,
  .pick {
    width: 100%;
    min-width: 0;
    min-height: var(--touch);
    padding: 0 10px;
    border-radius: 10px;
    border: 1px solid transparent;
    background: var(--surface2);
    color: var(--t1);
    font: inherit;
    font-size: 16px;
  }
  .dates input:focus,
  .pick:focus {
    border-color: var(--accent);
    outline: none;
  }
  .runbar {
    position: sticky;
    bottom: 0;
    padding: 12px 0 calc(12px + env(safe-area-inset-bottom));
    background: linear-gradient(to bottom, transparent, var(--bg) 24%);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .reason {
    margin: 0;
    text-align: center;
    font-size: var(--fs-sub);
    color: var(--t2);
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
  .run:disabled {
    opacity: 0.5;
  }
</style>
