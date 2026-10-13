<script lang="ts">
  // A·B·L이 무엇인지 보여 주는 접이식 도움말(스펙 4, 7.3).
  let open = $state(false);
  const id = `pattern-help-${Math.random().toString(36).slice(2, 9)}`;
  const LABEL =
    '주가가 올라 A(하락이 시작되기 전 가장 높은 종가)에서 꺾여 내려가다가, 잠깐 반등한 B(마지막 반등 고점)를 찍고, L(그 뒤 가장 낮은 종가)까지 떨어진 다음 다시 오르는 그림';
</script>

<div class="help">
  <button type="button" class="q" aria-expanded={open} aria-controls={id} onclick={() => (open = !open)}>
    전 고점이 뭔가요?
  </button>
  {#if open}
    <div class="panel" {id}>
      <svg viewBox="0 0 260 116" role="img" aria-label={LABEL}>
        <line class="guide" x1="72" y1="18" x2="252" y2="18" />
        <line class="guide" x1="126" y1="40" x2="252" y2="40" />
        <polyline class="price" points="6,92 40,56 72,18 100,60 126,40 168,96 202,72 226,52 252,34" />
        <circle class="dot" cx="72" cy="18" r="3.5" />
        <circle class="dot" cx="126" cy="40" r="3.5" />
        <circle class="dot" cx="168" cy="96" r="3.5" />
        <text x="72" y="11" text-anchor="middle">A</text>
        <text x="126" y="33" text-anchor="middle">B</text>
        <text x="168" y="111" text-anchor="middle">L</text>
      </svg>
      <ul>
        <li><b>A</b> 하락이 시작되기 전 고점이에요. 마지막으로 전량 판 뒤(처음이면 기간 시작부터) 가장 높았던 종가예요.</li>
        <li><b>B</b> A와 저점 사이에서 마지막으로 반등했던 고점이에요. 반등이 없었으면 A와 같아요.</li>
        <li><b>L</b> A 뒤에 가장 낮았던 종가(저점)예요.</li>
      </ul>
      <p>모두 종가 기준이에요. 전량 매도한 날부터는 그날 종가를 새 A로 보고 다시 세요.</p>
    </div>
  {/if}
</div>

<style>
  .q {
    min-height: var(--touch);
    color: var(--accent);
    font-weight: 700;
    font-size: 14px;
  }
  .panel {
    padding: 8px 12px 12px;
    border-radius: 12px;
    background: var(--surface2);
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  svg {
    width: 100%;
    max-width: 320px;
    display: block;
    margin: 0 auto 8px;
  }
  .price {
    fill: none;
    stroke: var(--t2);
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .guide {
    stroke: var(--t3);
    stroke-width: 1;
    stroke-dasharray: 3 3;
  }
  .dot {
    fill: var(--accent);
  }
  text {
    fill: var(--accent);
    font-size: 12px;
    font-weight: 800;
  }
  ul {
    list-style: none;
    margin: 0 0 6px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  li b {
    color: var(--accent);
    margin-right: 4px;
  }
  p {
    margin: 0;
    color: var(--t3);
  }
</style>
