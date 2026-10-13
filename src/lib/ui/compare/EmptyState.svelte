<script lang="ts">
  // 그룹에 종목이 없을 때(스펙 7.2 빈 상태).
  let { onadd, onexample }: { onadd: () => void; onexample: () => void } = $props();
</script>

<div class="empty">
  <b>비교할 종목을 추가해 보세요</b>
  <p>한 차트에 최대 8종목까지 나란히 비교할 수 있어요.</p>
  <div class="row">
    <button type="button" class="btn" data-empty-add onclick={onadd}>＋ 종목 추가</button>
    <button type="button" class="btn ghost" onclick={onexample}>예시 그룹 불러오기</button>
  </div>
</div>

<style>
  .empty {
    padding: 48px var(--gutter) 40px;
    text-align: center;
  }
  b {
    font-size: 18px;
    display: block;
    margin-bottom: 6px;
  }
  p {
    color: var(--t2);
    font-size: 14px;
    margin: 0 0 18px;
  }
  .row {
    display: flex;
    gap: 8px;
    justify-content: center;
    flex-wrap: wrap;
  }
  .btn {
    padding: 12px 18px;
    border-radius: 14px;
    font-weight: 800;
    font-size: var(--fs-body);
    background: var(--t1);
    color: var(--bg);
    min-height: 46px;
  }
  .btn.ghost {
    background: var(--surface2);
    color: var(--t1);
  }
</style>
