<script lang="ts">
  // 선정 이력(스펙 7.4-5): 재선정일마다 통과 수 · 뽑힌 종목 · 그 구간 종목별 수익률. 행을 펼치면 조건 계산값.
  import type { ValidationResult } from '../../screen/runValidation';
  import { dotDate, returnClass, trendReturn } from '../simulate/simText';
  import type { MacroSeriesKey } from '../../screen/types';
  import { FLOW_VALUE_KEYS, flowValueLines, MACRO_VALUE_KEYS, macroValueLines, NOT_BOUGHT_TEXT, SOLD_AT_LAST_CLOSE_TEXT, valueText, type FlowRunSnap } from './screenText';

  let {
    result,
    names,
    lookback,
    flow,
  }: {
    result: ValidationResult;
    names: Record<string, string>;
    /** 실행할 때 기준의 흐름 기간(`최근 20일`). 없으면 `최근 흐름`으로 보인다 */
    lookback?: Partial<Record<MacroSeriesKey, number>>;
    /** 실행할 때 기준의 수급 주체·기간. 수급 값 줄의 이름에 쓴다 */
    flow: FlowRunSnap;
  } = $props();

  let open = $state<Record<string, boolean>>({});
  const segmentOf = (date: string) => result.hold.segments.find((s) => s.from === date);
  const nameOf = (s: string) => names[s] ?? s;
</script>

<section class="hist" aria-labelledby="hist-h">
  <h3 id="hist-h">선정 이력</h3>
  <ul>
    {#each result.rebalances as r (r.date)}
      {@const seg = segmentOf(r.date)}
      {@const isOpen = !!open[r.date]}
      <li>
        {#if r.picked.length === 0}
          <!-- 펼칠 내용이 없는 행은 버튼이 아니다 -->
          <div class="head">
            <span class="date num">{dotDate(r.date)}</span>
            <span class="sum">통과 0개 · 현금</span>
          </div>
        {:else}
          <button type="button" class="head" aria-expanded={isOpen} aria-controls="hist-{r.date}" onclick={() => (open[r.date] = !isOpen)}>
            <span class="date num">{dotDate(r.date)}</span>
            <span class="sum">통과 {r.passed}개 · {r.picked.length}종목 선정</span>
            <span class="chev" aria-hidden="true">{isOpen ? '▴' : '▾'}</span>
          </button>
        {/if}
        <div id="hist-{r.date}">
          {#if r.picked.length > 0}
            <ul class="picks">
              {#each r.picked as p (p.symbol)}
                {@const sp = seg?.picked.find((x) => x.symbol === p.symbol)}
                <li>
                  <div class="line">
                    <span class="nm">{nameOf(p.symbol)} <small>{p.symbol}</small></span>
                    {#if sp?.notBought}
                      <span class="flag">{NOT_BOUGHT_TEXT[sp.notBoughtReason ?? 'noBar']}</span>
                    {:else if sp && sp.retPct !== null}
                      <b class="num {returnClass(sp.retPct)}">{trendReturn(sp.retPct)}</b>
                    {:else}
                      <span class="flag">—</span>
                    {/if}
                  </div>
                  {#if sp?.soldAtLastClose}<div class="flag">{SOLD_AT_LAST_CLOSE_TEXT}</div>{/if}
                  {#if isOpen}
                    <dl class="vals">
                      {#each Object.entries(p.values).filter(([k]) => !MACRO_VALUE_KEYS.has(k) && !FLOW_VALUE_KEYS.has(k)) as [k, v] (k)}
                        {@const t = valueText(k, v)}
                        <div><dt>{t.label}</dt><dd class="num">{t.text}</dd></div>
                      {/each}
                    </dl>
                    {#each macroValueLines(p.values, lookback) as line (line)}
                      <p class="mv num" data-macro-value>{line}</p>
                    {/each}
                    {#each flowValueLines(p.values, flow) as line (line)}
                      <p class="mv num" data-flow-value>{line}</p>
                    {/each}
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </li>
    {/each}
  </ul>
</section>

<style>
  h3 {
    margin: 0 0 8px;
    font-size: var(--fs-title);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .hist > ul > li {
    border-bottom: 1px solid var(--line);
  }
  .head {
    width: 100%;
    min-height: var(--touch);
    display: flex;
    align-items: center;
    gap: 12px;
    text-align: left;
  }
  .date {
    color: var(--t2);
  }
  .sum {
    flex: 1;
    font-weight: 700;
  }
  .chev {
    color: var(--t3);
  }
  .picks {
    padding: 0 0 8px;
    font-size: var(--fs-sub);
  }
  .picks li {
    padding: 4px 0;
  }
  .line {
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }
  small {
    color: var(--t3);
  }
  .flag {
    color: var(--t3);
    font-size: var(--fs-sub);
  }
  .vals {
    margin: 4px 0 0;
    display: flex;
    flex-wrap: wrap;
    gap: 2px 14px;
    color: var(--t2);
  }
  .vals div {
    display: flex;
    gap: 4px;
  }
  .vals dt {
    color: var(--t3);
  }
  .vals dd {
    margin: 0;
  }
  .mv {
    margin: 2px 0 0;
    color: var(--t2);
  }
</style>
