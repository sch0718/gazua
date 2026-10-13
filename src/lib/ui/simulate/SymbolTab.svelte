<script lang="ts">
  // 종목별 탭: 종목 손익·거래 수, 늦게 참여한 종목은 시작일, 받지 못한 종목은 제외 사유.
  import type { SimFailure } from '../../sim/loadSimData';
  import type { SimResult } from '../../sim/types';
  import { trendClass } from '../format';
  import { dotDate, startsLate, trendWon } from './simText';

  let {
    perSymbol,
    axisFrom,
    failed,
    colorConvention,
  }: {
    perSymbol: SimResult['perSymbol'];
    /** 실제 데이터 축의 시작일(meta.from). 축 전체가 늦은 것은 머리줄이 알린다 */
    axisFrom: string;
    failed: SimFailure[];
    colorConvention: 'kr' | 'global';
  } = $props();
</script>

<ul class="rows" aria-label="종목별">
  {#each perSymbol as p (p.symbol)}
    <li>
      <div class="line">
        <span class="name">{p.name}</span>
        <span class="num {trendClass(p.pnl, colorConvention)}">{trendWon(p.pnl)}</span>
      </div>
      <div class="sub">
        <span>거래 {p.roundTrips}번</span>
        {#if p.firstDate && startsLate(p.firstDate, axisFrom)}
          <span>{dotDate(p.firstDate)}부터 참여</span>
        {/if}
      </div>
    </li>
  {/each}
  {#each failed as f (f.symbol)}
    <li class="out">제외: {f.name ?? f.symbol} ({f.reason})</li>
  {/each}
</ul>

<style>
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    padding: 10px 0;
    border-bottom: 1px solid var(--line);
    font-size: var(--fs-body);
  }
  .line {
    display: flex;
    justify-content: space-between;
  }
  .name {
    font-weight: 600;
  }
  .sub {
    display: flex;
    gap: 10px;
    font-size: var(--fs-sub);
    color: var(--t3);
    margin-top: 2px;
  }
  .out {
    color: var(--t2);
  }
</style>
