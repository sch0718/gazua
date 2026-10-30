<script lang="ts">
  // 거래 내역(스펙 7.4-5): 리더보드 행 구조. 1줄 종목명 + 오른쪽 값, 2줄 날짜 · 사유(매도 줄은 끝에 `평단 대비`), 행 끝 ›. 해마다 연도 제목(h2)과 그해 목록.
  // 상승·하락 색 관례는 CSS 변수(--up/--down)가 맡으므로 관례 값은 받지 않는다.
  import type { Trade } from '../../sim/types';
  import { fmtWon } from '../format';
  import { returnClass, shortDate, trendReturn } from './simText';

  let {
    trades,
    names,
    onTrade,
    hideQty = false,
  }: {
    trades: Trade[];
    names: Record<string, string>;
    /** 없으면(받은 공유) 줄을 누를 수 없고 버튼이 아닌 목록 항목으로 그린다 */
    onTrade?: (t: Trade) => void;
    /** 자금 숨김 공유: 수량 없이 가격만 */
    hideQty?: boolean;
  } = $props();

  const isBuy = (t: Trade) => t.kind === 'buy' || t.kind === 'add';
  // 엔진의 `1단계 익절 80%`는 판 비율이라 `1단계 익절(80% 매도)`로 보인다
  const reason = (r: string) => r.replace(/^(\d+단계 익절) (\d+)%$/, '$1($2% 매도)');
  const why = (t: Trade) => (t.kind === 'buy' ? `${t.reason} 매수` : t.kind === 'add' ? '추가 매수' : reason(t.reason));

  const uid = Math.random().toString(36).slice(2, 9);
  const rows = $derived(
    trades.map((t) => {
      const value = isBuy(t)
        ? { text: hideQty ? `${fmtWon(t.price)}원` : `${t.qty}주 · ${fmtWon(t.price)}원`, cls: '' }
        : t.pnlPct === undefined
          ? null
          : { text: trendReturn(t.pnlPct), cls: returnClass(t.pnlPct) };
      const name = names[t.symbol] ?? t.symbol;
      // 매도 줄 %는 평균 단가 대비 가격 변화(비용 제외)라 시트의 포지션 결과와 부호가 다를 수 있다
      const sub = `${shortDate(t.date)} · ${why(t)}${isBuy(t) ? '' : ' · 평단 대비'}`;
      return { t, name, value, sub, label: [name, value?.text, sub].filter(Boolean).join(' · ') };
    }),
  );
  const hasSell = $derived(trades.some((t) => !isBuy(t)));
  // 해마다 제목 하나 + 그해 거래 목록(제목이 목록 항목 수에 섞이지 않게)
  const years = $derived.by(() => {
    const out: { year: string; rows: typeof rows }[] = [];
    for (const r of rows) {
      const year = r.t.date.slice(0, 4);
      if (out.at(-1)?.year !== year) out.push({ year, rows: [] });
      out.at(-1)!.rows.push(r);
    }
    return out;
  });
</script>

{#if hasSell}
  <p class="note">매도 줄 %는 평균 단가 대비예요(수수료·세금 제외){onTrade ? '. 포지션 결과는 행을 눌러 확인해 주세요' : ''}</p>
{/if}
<div class="rows" role="group" aria-label="거래 내역">
  {#each years as y, yi (yi)}
    <h2 id="tl-{uid}-y{yi}">{y.year}년</h2>
    <ul aria-labelledby="tl-{uid}-y{yi}">
      {#each y.rows as r, i (i)}
        <li>
          {#if onTrade}
            <button type="button" aria-label={r.label} onclick={() => onTrade(r.t)}>
              <span class="nm">{r.name}</span>
              {#if r.value}<span class="val num {r.value.cls}">{r.value.text}</span>{/if}
              <span class="sub num">{r.sub}</span>
              <span class="chev" aria-hidden="true">›</span>
            </button>
          {:else}
            <div class="item">
              <span class="nm">{r.name}</span>
              {#if r.value}
                <span class="sr-only"> · </span>
                <span class="val num {r.value.cls}">{r.value.text}</span>
              {/if}
              <span class="sr-only"> · </span>
              <span class="sub num">{r.sub}</span>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/each}
</div>

<style>
  .note {
    margin: 0;
    padding: 4px 4px 0;
    font-size: var(--fs-sub);
    color: var(--t3);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  /* 설정 화면 구역 제목(h2)과 같은 모양 */
  h2 {
    margin: 0;
    font-size: var(--fs-label);
    font-weight: 700;
    color: var(--t3);
    letter-spacing: 0.04em;
    padding: 18px 4px 8px;
  }
  h2:first-child {
    padding-top: 4px;
  }
  button,
  .item {
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
