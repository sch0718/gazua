<script lang="ts">
  import type { DaySession } from '../market/sessions';
  import CompareChart from './CompareChart.svelte';
  import type { ChartSeriesInput } from './lineData';

  // 테스트 전용: 비교 화면처럼 크로스헤어 콜백에서 스크럽 상태를 읽고 쓴다.
  let {
    series,
    sessions,
    unit = '%',
  }: { series: ChartSeriesInput[]; sessions: DaySession[]; unit?: '%' | 'x' | '조' } = $props();

  let scrubT = $state<number | null>(null);
  let frozen = $state<string[] | null>(null);
  let calls = $state(0);

  function oncrosshair(t: number | null) {
    calls++;
    if (t === null) {
      scrubT = null;
      frozen = null;
      return;
    }
    if (scrubT === null) frozen = series.map((s) => s.id);
    scrubT = t;
  }
</script>

<CompareChart {series} mode="intraday" {sessions} markers={false} {unit} directLabels {oncrosshair} />
<p data-testid="scrub">{scrubT ?? 'none'}|{frozen?.join(',') ?? ''}|{calls}</p>
<button type="button" onclick={() => (scrubT = (scrubT ?? 0) + 60_000)}>scrub</button>
