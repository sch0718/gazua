<script lang="ts">
  // 시장 데이터 안내(스펙 4·7.2): 없으면 카드, 30일 넘게 지났으면 닫을 수 있는 경고.
  import type { MarketDataInfo } from '../../marketData/store';
  import { Banner } from '@sch0718/ui-svelte';
  import { NO_DATA_TEXT, STALE_DAYS, staleText } from './screenText';

  // 수집 방법은 개발 문서(docs/development.md)에 있다
  const HOWTO_URL = 'https://github.com/sch0718/gazua/blob/main/docs/development.md#시장-데이터-수집';

  let {
    info,
    ageDays,
    onimport,
    ondismiss,
  }: { info: MarketDataInfo | null; ageDays: number | null; onimport: () => void; ondismiss: () => void } = $props();
</script>

{#if info === null}
  <div class="card">
    <p>{NO_DATA_TEXT}</p>
    <div class="acts">
      <button type="button" class="primary" onclick={onimport}>데이터 가져오기</button>
      <a class="how" href={HOWTO_URL} target="_blank" rel="noopener noreferrer">수집 방법</a>
    </div>
  </div>
{:else if ageDays !== null && ageDays > STALE_DAYS}
  <Banner tone="warn" message={staleText(ageDays)} actionLabel="닫기" onaction={ondismiss} />
{/if}

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    background: var(--surface);
    border-radius: var(--r-card);
    color: var(--t2);
  }
  p {
    margin: 0;
    font-size: var(--fs-body);
    color: var(--t1);
    word-break: keep-all;
  }
  .acts {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .primary,
  .how {
    min-height: var(--touch);
    padding: 0 20px;
    border-radius: 12px;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
  }
  .primary {
    background: var(--accent);
    color: var(--on-accent);
  }
  .how {
    background: var(--surface2);
    color: var(--t1);
  }
</style>
