<script lang="ts">
  // 자산 곡선 선 견본: 범례와 비교 기준 행이 같이 쓴다. 점선이면 점선으로, 높이는 선 굵기(1·1.5·2px)대로 그린다.
  import type { EquityLine } from './EquityChart.svelte';

  let { line }: { line: Pick<EquityLine, 'color' | 'width' | 'dashed'> } = $props();
</script>

<i class="swatch" class:dashed={line.dashed} style:--c="var({line.color[0]})" style:height="{line.width}px" aria-hidden="true"></i>

<style>
  .swatch {
    flex: none;
    display: inline-block;
    width: 16px;
    background: var(--c);
    vertical-align: middle;
  }
  .swatch.dashed {
    background: repeating-linear-gradient(90deg, var(--c) 0 4px, transparent 4px 7px);
  }
</style>
