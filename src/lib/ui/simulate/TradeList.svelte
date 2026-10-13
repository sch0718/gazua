<script lang="ts">
  // 거래 내역(스펙 7.4-5): 리더보드 행 구조. 1줄 종목명 + 오른쪽 값, 2줄 날짜 · 사유, 행 끝 ›. 해가 바뀌면 연도 구분선.
  // 상승·하락 색 관례는 CSS 변수(--up/--down)가 맡으므로 관례 값은 받지 않는다.
  import type { Trade } from '../../sim/types';
  import { fmtWon } from '../format';
  import { returnClass, shortDate, trendReturn } from './simText';

  let { trades, names, onTrade }: { trades: Trade[]; names: Record<string, string>; onTrade: (t: Trade) => void } = $props();

  const isBuy = (t: Trade) => t.kind === 'buy' || t.kind === 'add';
  // 엔진의 `1단계 익절 80%`는 판 비율이라 `1단계 익절(80% 매도)`로 보인다
  const reason = (r: string) => r.replace(/^(\d+단계 익절) (\d+)%$/, '$1($2% 매도)');
  const why = (t: Trade) => (t.kind === 'buy' ? `${t.reason} 매수` : t.kind === 'add' ? '추가 매수' : reason(t.reason));

  const rows = $derived(
    trades.map((t, i) => {
      const value = isBuy(t)
        ? { text: `${t.qty}주 · ${fmtWon(t.price)}원`, cls: '' }
        : t.pnlPct === undefined
          ? null
          : { text: trendReturn(t.pnlPct), cls: returnClass(t.pnlPct) };
      const name = names[t.symbol] ?? t.symbol;
      const sub = `${shortDate(t.date)} · ${why(t)}`;
      const year = t.date.slice(0, 4);
      return {
        t,
        name,
        value,
        sub,
        // 첫 행과 해가 바뀐 행 앞에 구분선
        year: i === 0 || trades[i - 1].date.slice(0, 4) !== year ? year : null,
        label: [name, value?.text, sub].filter(Boolean).join(' · '),
      };
    }),
  );
</script>

<ul class="rows" aria-label="거래 내역">
  {#each rows as r, i (i)}
    {#if r.year}
      <li class="year"><h2>{r.year}년</h2></li>
    {/if}
    <li>
      <button type="button" aria-label={r.label} onclick={() => onTrade(r.t)}>
        <span class="nm">{r.name}</span>
        {#if r.value}<span class="val num {r.value.cls}">{r.value.text}</span>{/if}
        <span class="sub num">{r.sub}</span>
        <span class="chev" aria-hidden="true">›</span>
      </button>
    </li>
  {/each}
</ul>

<style>
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  /* 설정 화면 구역 제목(h2)과 같은 모양 */
  .year h2 {
    margin: 0;
    font-size: var(--fs-label);
    font-weight: 700;
    color: var(--t3);
    letter-spacing: 0.04em;
    padding: 18px 4px 8px;
  }
  .year:first-child h2 {
    padding-top: 4px;
  }
  button {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    grid-template-areas:
      'nm val chev'
      'sub sub chev';
    column-gap: 8px;
    row-gap: 2px;
    align-items: center;
    width: 100%;
    min-height: var(--touch);
    padding: 8px 4px;
    text-align: left;
    border-bottom: 1px solid var(--line);
  }
  .nm {
    grid-area: nm;
    font-size: var(--fs-body);
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .val {
    grid-area: val;
    font-size: var(--fs-body);
    font-weight: 700;
    text-align: right;
    white-space: nowrap;
  }
  .sub {
    grid-area: sub;
    font-size: var(--fs-sub);
    color: var(--t3);
  }
  .chev {
    grid-area: chev;
    font-size: var(--fs-title);
    color: var(--t3);
  }
</style>
