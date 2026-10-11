<script lang="ts">
  import type { DaySession } from '../../market/sessions';
  import type { App } from '../../state/app.svelte';
  import type { Group } from '../../state/schema';
  import AddStockSheet from '../../../sheets/AddStockSheet.svelte';
  import GroupSheet from '../../../sheets/GroupSheet.svelte';
  import MetricSheet, { type MetricCtx } from '../../../sheets/MetricSheet.svelte';
  import StockDetailSheet from '../../../sheets/StockDetailSheet.svelte';
  import type { CompareController } from './compareController.svelte';

  export type CompareSheet = 'add' | 'metric' | 'detail' | 'group' | null;

  // 비교 화면의 시트들. 종목 상세는 1024 미만에서만 시트(≥1024는 오른쪽 패널 안에 그린다).
  let {
    sheet = $bindable(),
    app,
    group,
    ctl,
    selected,
    wide,
    metricCtx,
    now,
    sessions,
    isOpenToday,
  }: {
    sheet: CompareSheet;
    app: App;
    group: Group | undefined;
    ctl: Pick<CompareController, 'metas' | 'entries'>;
    selected: string | null;
    wide: boolean;
    metricCtx: MetricCtx;
    now: number;
    sessions: DaySession[];
    isOpenToday: boolean;
  } = $props();

  const close = () => (sheet = null);
  const detailSymbol = $derived(selected && group?.items.some((i) => i.symbol === selected) ? selected : null);
</script>

{#if group}
  <AddStockSheet open={sheet === 'add'} {app} groupId={group.id} metas={ctl.metas} {now} onclose={close} />
  {#if detailSymbol && !wide}
    <StockDetailSheet
      open={sheet === 'detail'}
      {app}
      groupId={group.id}
      symbol={detailSymbol}
      meta={ctl.metas[detailSymbol]}
      series={ctl.entries[detailSymbol]?.series ?? null}
      {now}
      {sessions}
      {isOpenToday}
      onclose={close}
    />
  {/if}
{/if}
<MetricSheet
  open={sheet === 'metric'}
  current={app.settings.metric}
  ctx={metricCtx}
  onselect={(metric) => app.updateSettings({ metric })}
  onclose={close}
/>
<GroupSheet open={sheet === 'group'} {app} onclose={close} />
