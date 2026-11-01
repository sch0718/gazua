<script lang="ts">
  // 그날 보유 한 종목(설계 §4.4): 수량·평단·종가·평가액·수익률·보유 시작일, 손절·다음 추가·평단·익절 눈금과 종가 점.
  // 막대는 그림이라 화면 낭독기에서 숨기고, 같은 눈금을 아래 목록에 글로 둔다.
  import type { HoldingFrame } from '../../sim/types';
  import { fmtWon } from '../format';
  import { dotDate, PRICE_BASIS_NOTE, priceMarks, returnClass, STOP_PENDING_NOTE, trendReturn } from './simText';

  let { h, name, motion = false }: { h: HoldingFrame; name: string; motion?: boolean } = $props();

  const bar = $derived(priceMarks(h));
  const won = (n: number) => `${fmtWon(n)}원`;
</script>

<article class="holding" aria-label={name}>
  <p class="top"><b class="nm">{name}</b> <b class="num {returnClass(h.pnlPct)}">{trendReturn(h.pnlPct)}</b></p>
  <dl class="facts num">
    <div><dt>수량</dt> <dd>{fmtWon(h.qty)}주</dd></div>
    <div><dt>평단</dt> <dd>{won(h.avgPrice)}</dd></div>
    <div><dt>종가</dt> <dd>{won(h.close)}</dd></div>
    <div><dt>평가액</dt> <dd>{won(h.value)}</dd></div>
    <div><dt>보유 시작</dt> <dd>{dotDate(h.openDate)}</dd></div>
  </dl>
  <div class="bar" class:slide={motion} aria-hidden="true">
    {#each bar.marks as m (m.key)}<i class="tick {m.kind}" style:left="{m.left}%"></i>{/each}
    <span class="dot" style:left="{bar.dot}%"></span>
  </div>
  <ul class="levels num" aria-label="가격 눈금">
    {#each bar.marks as m (m.key)}<li>{m.label} {won(m.price)}</li>{/each}
  </ul>
  {#if h.stop === null}<p class="hint">{STOP_PENDING_NOTE}</p>{/if}
  <p class="hint">{PRICE_BASIS_NOTE}</p>
</article>

<style>
  .holding {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px;
    border-radius: var(--r-card);
    background: var(--surface);
  }
  .top {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    margin: 0;
  }
  .nm {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .facts {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 2px 12px;
    margin: 0;
    font-size: var(--fs-sub);
  }
  .facts div {
    display: flex;
    justify-content: space-between;
    gap: 6px;
  }
  dt {
    color: var(--t3);
  }
  dd {
    margin: 0;
  }
  .bar {
    position: relative;
    height: 16px;
    margin: 4px 5px;
  }
  .bar::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 7px;
    height: 2px;
    border-radius: 1px;
    background: var(--line);
  }
  .tick {
    position: absolute;
    top: 2px;
    width: 2px;
    height: 12px;
    margin-left: -1px;
    background: var(--t3);
  }
  .tick.stop {
    background: var(--down);
  }
  .tick.add {
    background: var(--accent);
  }
  .tick.avg {
    background: var(--t1);
  }
  .tick.take {
    background: var(--up);
  }
  .dot {
    position: absolute;
    top: 3px;
    width: 10px;
    height: 10px;
    margin-left: -5px;
    border-radius: 50%;
    background: var(--accent);
  }
  /* 하루만 움직일 때만(부모가 motion으로 판정) 점이 미끄러진다 */
  .slide .dot {
    transition: left 150ms ease;
  }
  @media (prefers-reduced-motion: reduce) {
    .slide .dot {
      transition: none;
    }
  }
  .levels {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 2px 12px;
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  .hint {
    margin: 0;
    font-size: var(--fs-sub);
    color: var(--t3);
  }
</style>
