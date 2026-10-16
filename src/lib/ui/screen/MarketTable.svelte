<script lang="ts">
  // 시장별 표(스펙 7.4-4): KOSPI 주식 · KOSDAQ 주식 · ETF의 ① 총수익률, 최대 낙폭, 평균 선정 수, 지수 대비.
  // 후보 범위에 원래 없던 시장도 비교로 계산하므로 원래 범위에는 표시를 단다.
  import type { ValidationResult } from '../../screen/runValidation';
  import Badge from '../components/Badge.svelte';
  import { fmtReturnPct, returnClass, trendReturn } from '../simulate/simText';
  import { trendPp, vsIndex } from './screenText';

  let { result }: { result: ValidationResult } = $props();

  const LABEL = { KOSPI: 'KOSPI 주식', KOSDAQ: 'KOSDAQ 주식', ETF: 'ETF' } as const;
  // 지수 대비는 첫 비교 지수(`indices[0]`) 기준이다. ① 요약·지수보다 나은 구간 수와 같다
  const v = $derived(vsIndex(result));
  const index = $derived(v?.stats ?? null);
</script>

<section class="mt" aria-labelledby="mt-h">
  <h3 id="mt-h">시장별 보기</h3>
  <div class="scroll">
    <table>
      <thead>
        <tr><th scope="col">시장</th><th scope="col">① 총수익률</th><th scope="col">최대 낙폭</th><th scope="col">평균 선정 수</th><th scope="col">지수 대비</th></tr>
      </thead>
      <tbody>
        {#each result.byMarket as m (m.key)}
          {@const vs = index ? m.stats.totalPct - index.totalPct : null}
          <tr>
            <th scope="row">{LABEL[m.key]}{#if m.inPool}<Badge tone="nxt">원래 범위</Badge>{/if}</th>
            <td class="num {returnClass(m.stats.totalPct)}">{trendReturn(m.stats.totalPct)}</td>
            <td class="num">{fmtReturnPct(m.stats.mddPct)}</td>
            <td class="num">{(Math.round(m.avgPicked * 10) / 10).toFixed(1)}개</td>
            <td class="num {vs === null ? '' : returnClass(vs)}">{vs === null ? '—' : trendPp(vs)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <p class="cap">{v === null ? '비교 지수가 없어 지수 대비는 보이지 않아요' : index ? `지수 대비는 ${v.id} 기준이에요` : `지수 대비: ${v.id} ${v.reason}`}</p>
</section>

<style>
  h3 {
    margin: 0 0 8px;
    font-size: var(--fs-title);
  }
  .cap {
    margin: 6px 0 0;
    font-size: var(--fs-sub);
    color: var(--t3);
  }
  .scroll {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-sub);
  }
  th,
  td {
    padding: 10px 6px;
    text-align: right;
    white-space: nowrap;
    border-bottom: 1px solid var(--line);
  }
  thead th {
    color: var(--t3);
    font-weight: 600;
  }
  th:first-child,
  td:first-child {
    text-align: left;
  }
  tbody th {
    font-weight: 700;
    color: var(--t1);
  }
  tbody th :global(.badge) {
    margin-left: 6px;
  }
</style>
